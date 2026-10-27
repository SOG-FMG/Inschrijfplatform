import type { Env } from '../../types';

/**
 * Welke momenten en tijdsblokken gelden voor welke doelgroep.
 *
 * Eén plaats voor die regel, want ze wordt op drie plaatsen gelezen: het publieke formulier
 * (evenement.ts), de controle bij het inschrijven en wijzigen (registratie.ts), en de instellingen.
 * Zou elk van die drie zijn eigen versie hebben, dan kan het formulier iets tonen dat de controle
 * weigert, of erger: iets weigeren dat het formulier wél aanbood.
 *
 * `null` betekent: alles mag. Ook een doelgroep met modus 'eigen' maar een lege selectie leest als
 * alles — een half ingestelde doelgroep mag het formulier niet leegmaken.
 */

export interface MomentBereik {
  dagdelen: Set<string> | null;
  tijdsblokken: Set<string> | null;
}

const ALLES: MomentBereik = { dagdelen: null, tijdsblokken: null };

export async function bereikPerDoelgroep(env: Env, evenementId: string): Promise<Map<string, MomentBereik>> {
  const db = env.DB;
  const [groepenR, ddR, tbR] = await db.batch<any>([
    db.prepare(`select doelgroep_id, momenten_modus, volgt_doelgroep_id from doelgroepen where evenement_id = ?`).bind(evenementId),
    db.prepare(
      `select k.dagdeel_id, k.doelgroep_id from dagdeel_doelgroepen k
       join doelgroepen g on g.doelgroep_id = k.doelgroep_id where g.evenement_id = ?`,
    ).bind(evenementId),
    db.prepare(
      `select k.tijdsblok_id, k.doelgroep_id from tijdsblok_doelgroepen k
       join doelgroepen g on g.doelgroep_id = k.doelgroep_id where g.evenement_id = ?`,
    ).bind(evenementId),
  ]);
  const groepen = groepenR.results as { doelgroep_id: string; momenten_modus: string; volgt_doelgroep_id: string | null }[];

  const gekozen = new Map<string, { dagdelen: Set<string>; tijdsblokken: Set<string> }>();
  const vak = (id: string) => {
    let v = gekozen.get(id);
    if (!v) gekozen.set(id, (v = { dagdelen: new Set(), tijdsblokken: new Set() }));
    return v;
  };
  for (const r of ddR.results as any[]) vak(r.doelgroep_id).dagdelen.add(r.dagdeel_id);
  for (const r of tbR.results as any[]) vak(r.doelgroep_id).tijdsblokken.add(r.tijdsblok_id);

  const eigenVan = (doelgroepId: string): MomentBereik => {
    const v = gekozen.get(doelgroepId);
    if (!v) return ALLES;
    return { dagdelen: v.dagdelen.size ? v.dagdelen : null, tijdsblokken: v.tijdsblokken.size ? v.tijdsblokken : null };
  };

  const perId = new Map(groepen.map((g) => [g.doelgroep_id, g]));
  const uit = new Map<string, MomentBereik>();
  for (const g of groepen) {
    if (g.momenten_modus === 'eigen') {
      uit.set(g.doelgroep_id, eigenVan(g.doelgroep_id));
    } else if (g.momenten_modus === 'volgt') {
      const doel = g.volgt_doelgroep_id ? perId.get(g.volgt_doelgroep_id) : undefined;
      // Maar één stap: volgt het doel zelf ook (of bestaat het niet meer), dan geldt alles. Zo kan er
      // nooit een kring ontstaan waarin dit zichzelf blijft opzoeken.
      uit.set(g.doelgroep_id, doel?.momenten_modus === 'eigen' ? eigenVan(doel.doelgroep_id) : ALLES);
    } else {
      uit.set(g.doelgroep_id, ALLES);
    }
  }
  return uit;
}

/** Mag deze doelgroep dit moment of tijdsblok? Zonder doelgroep, of een onbekende: alles mag. */
export function magDoelgroep(bereik: Map<string, MomentBereik>, doelgroepId: string | null | undefined, soort: 'dagdelen' | 'tijdsblokken', id: string) {
  if (!doelgroepId) return true;
  const set = bereik.get(doelgroepId)?.[soort];
  return !set || set.has(id);
}

/**
 * Welke doelgroepen mogen dit moment of tijdsblok zien? `null` als dat er allemaal zijn — dan hoeft het
 * formulier niets te filteren, en blijft het antwoord even groot als vroeger voor een evenement zonder
 * eigen instellingen.
 */
export function doelgroepenVoor(bereik: Map<string, MomentBereik>, alleGroepen: string[], soort: 'dagdelen' | 'tijdsblokken', id: string): string[] | null {
  const lijst = alleGroepen.filter((g) => magDoelgroep(bereik, g, soort, id));
  return lijst.length === alleGroepen.length ? null : lijst;
}
