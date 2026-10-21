// Demomodus: bootst de Worker + databaseregels na in de browser (localStorage).
// Bedoeld om het formulier te testen en te tonen; er wordt niets verstuurd.
import evenementJson from '../demo/evenement.json';
import {
  ApiFout,
  type Evenement,
  type Keuze,
  type Moment,
  type RegistratieAanvraag,
  type RegistratieAntwoord,
  type RegistratieOverzicht,
  type School,
} from '../types';
import type { Api } from './api';

const SLEUTEL = 'inschrijvingsplatform-demo-v1';

interface DemoRegistratie {
  overzicht: RegistratieOverzicht;
  sessies: string[];
  dagdelen: string[];
  doelgroepId?: string;
  sleutel: string;
}

interface DemoStaat {
  bezetting: Record<string, number>;
  registraties: Record<string, DemoRegistratie>;
}

const basis = evenementJson as unknown as Evenement;

/** Startbezetting zodat er in de demo meteen volzette en bijna volle sessies zijn. */
function startBezetting(): Record<string, number> {
  const b: Record<string, number> = {};
  let n = 7;
  for (const dag of basis.dagen)
    for (const dd of dag.dagdelen)
      for (const tb of dd.tijdsblokken)
        for (const s of tb.sessies) {
          if (s.capaciteit === null) continue;
          n = (n * 31 + 11) % 97;
          b[s.id] = Math.min(s.capaciteit, Math.floor((n / 97) * s.capaciteit));
        }
  const eersteBlok = basis.dagen[0]?.dagdelen[0]?.tijdsblokken.find((t) => t.type === 'keuze');
  const ned = eersteBlok?.sessies.find((s) => s.code === 'nederlands');
  if (ned?.capaciteit) b[ned.id] = ned.capaciteit;
  return b;
}

function lees(): DemoStaat {
  try {
    const raw = localStorage.getItem(SLEUTEL);
    if (raw) return JSON.parse(raw) as DemoStaat;
  } catch {
    /* geen opslag beschikbaar */
  }
  return { bezetting: startBezetting(), registraties: {} };
}

function schrijf(staat: DemoStaat) {
  try {
    localStorage.setItem(SLEUTEL, JSON.stringify(staat));
  } catch {
    /* geen opslag beschikbaar: demo werkt dan enkel binnen deze pagina */
  }
}

let geheugen: DemoStaat | null = null;
const staat = () => (geheugen ??= lees());
const wacht = (ms = 350) => new Promise((r) => setTimeout(r, ms));

function metBezetting(): Evenement {
  const b = staat().bezetting;
  const ev: Evenement = structuredClone(basis);
  for (const dag of ev.dagen)
    for (const dd of dag.dagdelen)
      for (const tb of dd.tijdsblokken)
        for (const s of tb.sessies) {
          if (s.capaciteit === null) continue;
          const bezet = b[s.id] ?? 0;
          s.vrij = Math.max(s.capaciteit - bezet, 0);
          s.volzet = bezet >= s.capaciteit;
        }
  return ev;
}

function zoekSessie(id: string) {
  for (const dag of basis.dagen)
    for (const dd of dag.dagdelen)
      for (const tb of dd.tijdsblokken) {
        const s = tb.sessies.find((x) => x.id === id);
        if (s) return { dag, dd, tb, s };
      }
  return null;
}

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const demoApi: Api = {
  async haalEvenement(slug) {
    await wacht();
    if (slug !== basis.slug) throw new ApiFout('EVENEMENT_NIET_GEVONDEN', 'Dit evenement bestaat niet of is niet meer beschikbaar.');
    return metBezetting();
  },

  async haalScholen() {
    const mod = await import('../demo/scholen.json');
    return mod.default as School[];
  },

  async registreer(_slug, a: RegistratieAanvraag): Promise<RegistratieAntwoord> {
    await wacht(700);
    const st = staat();
    const d = a.deelnemer;
    const sleutel = [d.email, d.naam, d.voornaam].map((x) => x.trim().toLowerCase()).join('|');
    if (Object.values(st.registraties).some((r) => r.sleutel === sleutel && r.overzicht.status === 'actief')) {
      throw new ApiFout('DUBBELE_INSCHRIJVING', 'Deze deelnemer is al ingeschreven met dit e-mailadres. Bekijk je bevestigingsmail.');
    }
    const gevonden = a.sessies.map((id) => zoekSessie(id));
    const codes = gevonden.filter((g) => g?.s.uniek && g.s.code).map((g) => g!.s.code);
    if (new Set(codes).size !== codes.length) {
      throw new ApiFout('ZELFDE_ONDERDEEL_DUBBEL', 'Je koos twee keer hetzelfde onderdeel. Kies iets anders.');
    }
    const keuzes: Keuze[] = [];
    for (const g of gevonden) {
      if (!g || !a.dagdelen.includes(g.dd.id)) throw new ApiFout('ONGELDIGE_SESSIEKEUZE', 'Een gekozen onderdeel is niet meer beschikbaar.');
      const bezet = st.bezetting[g.s.id] ?? 0;
      if (g.s.capaciteit !== null && bezet >= g.s.capaciteit) {
        throw new ApiFout('SESSIE_VOLZET', `Een gekozen onderdeel is intussen volzet. Kies een ander onderdeel. (${g.s.titel})`, undefined, g.s.id);
      }
      keuzes.push({ sessieId: g.s.id, tijdsblokId: g.tb.id, titel: g.s.titel, tijdsblok: g.tb.naam, startUur: g.tb.startUur, locatie: g.s.locatie, status: 'bevestigd' });
    }
    for (const g of gevonden) st.bezetting[g!.s.id] = (st.bezetting[g!.s.id] ?? 0) + 1;

    const momenten: Moment[] = [];
    for (const dag of basis.dagen)
      for (const dd of dag.dagdelen)
        if (a.dagdelen.includes(dd.id)) momenten.push({ dag: dag.naam, dagdeel: dd.naam, startUur: dd.startUur, eindUur: dd.eindUur });

    const t = token();
    const referentie = t.slice(0, 8).toUpperCase().replace(/[-_]/g, 'X');
    st.registraties[t] = {
      sleutel,
      sessies: a.sessies,
      dagdelen: a.dagdelen,
      doelgroepId: d.doelgroepId,
      overzicht: {
        referentie, evenement: basis.titel, slug: basis.slug, contactEmail: basis.contactEmail, status: 'actief',
        voornaam: d.voornaam, naam: d.naam, annuleerbaar: true,
        momenten: momenten.map((m) => ({ ...m, status: 'bevestigd' })), keuzes,
      },
    };
    schrijf(st);
    return {
      referentie, evenement: basis.titel, contactEmail: basis.contactEmail, momenten, keuzes,
      beheerUrl: `${location.origin}/beheer/${t}`,
    };
  },

  async haalRegistratie(t) {
    await wacht();
    const r = staat().registraties[t];
    if (!r) throw new ApiFout('REGISTRATIE_NIET_GEVONDEN', 'Deze inschrijving werd niet gevonden of is al geannuleerd.');
    return metWijzigen(r);
  },

  async wijzigKeuzes(t, sessies) {
    await wacht(500);
    const st = staat();
    const r = st.registraties[t];
    if (!r || r.overzicht.status !== 'actief') {
      throw new ApiFout('REGISTRATIE_NIET_GEVONDEN', 'Deze inschrijving werd niet gevonden of is al geannuleerd.');
    }
    const gevonden = sessies.map((id) => zoekSessie(id));
    const codes = gevonden.filter((g) => g?.s.uniek && g.s.code).map((g) => g!.s.code);
    if (new Set(codes).size !== codes.length) throw new ApiFout('ZELFDE_ONDERDEEL_DUBBEL', 'Je koos twee keer hetzelfde onderdeel. Kies iets anders.');
    for (const g of gevonden) {
      if (!g || !r.dagdelen.includes(g.dd.id)) throw new ApiFout('ONGELDIGE_SESSIEKEUZE', 'Een gekozen onderdeel is niet meer beschikbaar.');
      if (!r.sessies.includes(g.s.id) && g.s.capaciteit !== null && (st.bezetting[g.s.id] ?? 0) >= g.s.capaciteit) {
        throw new ApiFout('SESSIE_VOLZET', `Een gekozen onderdeel is intussen volzet. Kies een ander onderdeel. (${g.s.titel})`, undefined, g.s.id);
      }
    }
    for (const id of r.sessies) if (!sessies.includes(id)) st.bezetting[id] = Math.max((st.bezetting[id] ?? 1) - 1, 0);
    for (const id of sessies) if (!r.sessies.includes(id)) st.bezetting[id] = (st.bezetting[id] ?? 0) + 1;
    r.sessies = sessies;
    r.overzicht.keuzes = gevonden.map((g) => ({
      sessieId: g!.s.id, tijdsblokId: g!.tb.id, titel: g!.s.titel, tijdsblok: g!.tb.naam, startUur: g!.tb.startUur, locatie: g!.s.locatie, status: 'bevestigd',
    }));
    schrijf(st);
    return metWijzigen(r);
  },

  async annuleer(t) {
    await wacht(500);
    const st = staat();
    const r = st.registraties[t];
    if (!r || r.overzicht.status !== 'actief') {
      throw new ApiFout('REGISTRATIE_NIET_GEVONDEN', 'Deze inschrijving werd niet gevonden of is al geannuleerd.');
    }
    for (const id of r.sessies) st.bezetting[id] = Math.max((st.bezetting[id] ?? 1) - 1, 0);
    r.overzicht = {
      ...r.overzicht, status: 'geannuleerd', annuleerbaar: false,
      momenten: r.overzicht.momenten.map((m) => ({ ...m, status: 'geannuleerd' })),
      keuzes: r.overzicht.keuzes.map((k) => ({ ...k, status: 'geannuleerd' })),
    };
    schrijf(st);
    return r.overzicht;
  },

  async meld(melding) {
    await wacht();
    // Demo: niets versturen, enkel tonen wat er verstuurd zou worden.
    console.info('[demo] melding', { ...melding, screenshot: melding.screenshot ? `${melding.screenshot.length} tekens` : null });
    return { referentie: 'DEMO' };
  },
};

/** Zoals de Worker: de eigen dagdelen met vrije plaatsen en de huidige keuze per keuzeblok. */
function metWijzigen(r: DemoRegistratie): RegistratieOverzicht {
  if (r.overzicht.status !== 'actief') return { ...r.overzicht, wijzigen: null };
  const ev = metBezetting();
  const dagen = ev.dagen.flatMap((d) => d.dagdelen.filter((dd) => r.dagdelen.includes(dd.id)).map((dagdeel) => ({ dagNaam: d.naam, dagdeel })));
  const keuzes: Record<string, string> = {};
  for (const { dagdeel } of dagen) {
    for (const tb of dagdeel.tijdsblokken) {
      if (tb.type === 'keuze') keuzes[tb.id] = tb.sessies.find((s) => r.sessies.includes(s.id))?.id ?? '';
    }
  }
  return { ...r.overzicht, wijzigen: { doelgroepId: r.doelgroepId ?? '', dagen, keuzes } };
}

export function resetDemo() {
  geheugen = { bezetting: startBezetting(), registraties: {} };
  schrijf(geheugen);
}
