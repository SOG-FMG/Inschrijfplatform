import type { Gebruiker } from './toegang';
import { isUuid } from '../validatie';
import { KERN_VERSIE, type Module, type Recht, type Route, type Taak } from './module';

/**
 * Het module-register: welke modules actief zijn in deze installatie (MODULES in wrangler.toml), en
 * welke route, welk recht en welke foutcode bij welke module hoort. Een fout in een manifest (onbekende
 * module, ontbrekende afhankelijkheid, twee modules met dezelfde route) stopt het laden: beter meteen een
 * duidelijke fout bij het deployen dan een half werkende installatie.
 */

const SOORTEN: Record<string, string> = {
  id: '[A-Za-z0-9-]{1,64}',
  uuid: '[0-9a-f-]{36}',
  slug: '[a-z0-9-]{1,80}',
  token: '[A-Za-z0-9_-]{43}',
  woord: '[a-z]+',
};

interface GecompileerdeRoute {
  module: Module;
  route: Route;
  regex: RegExp;
  namen: string[];
  uuids: string[];
}

export interface Treffer {
  module: Module;
  route: Route;
  params: Record<string, string>;
}

export interface Register {
  /** Actieve modules, in volgorde van laden (afhankelijkheden eerst). */
  actief: Module[];
  zoek(toegang: Route['toegang'], methode: string, pad: string): Treffer | null;
  /** Foutcodes van alle modules (ook niet-actieve: een code blijft herkenbaar). */
  fouten: Record<string, [number, string]>;
  heeftRecht(g: Gebruiker, recht: string): boolean;
  taken: { module: Module; taak: Taak }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileer(module: Module, route: Route): GecompileerdeRoute {
  if (!route.pad.startsWith('/')) throw new Error(`Module ${module.id}: pad "${route.pad}" moet met / beginnen.`);
  const namen: string[] = [];
  const uuids: string[] = [];
  const delen = route.pad
    .slice(1)
    .split('/')
    .map((deel) => {
      if (!deel.startsWith(':')) return escape(deel);
      const [naam, soort = 'id'] = deel.slice(1).split(':');
      if (!SOORTEN[soort]) throw new Error(`Module ${module.id}: onbekende soort ":${soort}" in "${route.pad}".`);
      if (namen.includes(naam)) throw new Error(`Module ${module.id}: parameter "${naam}" staat twee keer in "${route.pad}".`);
      namen.push(naam);
      if (soort === 'uuid') uuids.push(naam);
      return `(${SOORTEN[soort]})`;
    });
  return { module, route, regex: new RegExp(`^/${delen.join('/')}$`), namen, uuids };
}

const hoofdversie = (v: string) => Number(v.replace(/^[\^~]/, '').split('.')[0]);

export function maakRegister(alle: Module[], keuze?: string): Register {
  const perId = new Map<string, Module>();
  for (const m of alle) {
    if (!/^[a-z][a-z0-9]*$/.test(m.id)) throw new Error(`Ongeldige module-id "${m.id}" (kleine letters en cijfers).`);
    if (perId.has(m.id)) throw new Error(`Module "${m.id}" is twee keer geregistreerd.`);
    if (hoofdversie(m.vereistKern) !== hoofdversie(KERN_VERSIE)) {
      throw new Error(`Module ${m.id} vereist kern ${m.vereistKern}, deze kern is ${KERN_VERSIE}.`);
    }
    perId.set(m.id, m);
  }

  // Welke modules aan staan: MODULES (komma-gescheiden), of alle als MODULES ontbreekt.
  const gekozen = (keuze ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of gekozen) if (!perId.has(id)) throw new Error(`MODULES vermeldt onbekende module "${id}".`);
  const isActief = (m: Module) => m.altijdActief || !gekozen.length || gekozen.includes(m.id);

  // Afhankelijkheden eerst, en ze moeten zelf actief zijn.
  const actief: Module[] = [];
  const bezig = new Set<string>();
  const voegToe = (m: Module) => {
    if (actief.includes(m)) return;
    if (bezig.has(m.id)) throw new Error(`Kringverwijzing tussen modules bij "${m.id}".`);
    bezig.add(m.id);
    for (const dep of m.afhankelijkVan ?? []) {
      const d = perId.get(dep);
      if (!d) throw new Error(`Module ${m.id} hangt af van onbekende module "${dep}".`);
      if (!isActief(d)) throw new Error(`Module ${m.id} vereist module "${dep}"; zet die ook in MODULES.`);
      voegToe(d);
    }
    bezig.delete(m.id);
    actief.push(m);
  };
  for (const m of alle) if (isActief(m)) voegToe(m);

  const rechten = new Map<string, Recht>();
  for (const m of alle) {
    for (const [naam, recht] of Object.entries(m.rechten ?? {})) {
      if (!naam.startsWith(`${m.id}.`)) throw new Error(`Recht "${naam}" moet beginnen met "${m.id}.".`);
      rechten.set(naam, recht);
    }
  }

  const fouten: Record<string, [number, string]> = {};
  for (const m of alle) {
    for (const [code, waarde] of Object.entries(m.fouten ?? {})) {
      if (fouten[code]) throw new Error(`Foutcode ${code} bestaat al (module ${m.id}).`);
      fouten[code] = waarde;
    }
  }

  const routes: Record<Route['toegang'], GecompileerdeRoute[]> = { publiek: [], beheer: [] };
  const gezien = new Map<string, string>();
  for (const m of actief) {
    for (const r of m.routes ?? []) {
      if (r.toegang === 'beheer' && r.recht && !rechten.has(r.recht)) throw new Error(`Module ${m.id}: onbekend recht "${r.recht}".`);
      const c = compileer(m, r);
      const sleutel = `${r.toegang} ${r.methode} ${c.regex.source}`;
      if (gezien.has(sleutel)) throw new Error(`Route ${r.methode} ${r.pad} bestaat al in module ${gezien.get(sleutel)}.`);
      gezien.set(sleutel, m.id);
      routes[r.toegang].push(c);
    }
  }

  return {
    actief,
    fouten,
    taken: actief.flatMap((module) => (module.taken ?? []).map((taak) => ({ module, taak }))),
    zoek(toegang, methode, pad) {
      for (const c of routes[toegang]) {
        if (c.route.methode !== methode) continue;
        const m = c.regex.exec(pad);
        if (!m) continue;
        const params = Object.fromEntries(c.namen.map((n, i) => [n, m[i + 1]]));
        if (c.uuids.some((n) => !isUuid(params[n]))) continue;
        return { module: c.module, route: c.route, params };
      }
      return null;
    },
    heeftRecht(g, recht) {
      // De platformbeheerder van een organisatie heeft alle rechten (zoals vroeger); andere rollen volgens het manifest.
      if (g.rol === 'platformbeheerder') return true;
      return rechten.get(recht)?.rollen.includes(g.rol) ?? false;
    },
  };
}
