import type { ProgrammaDag } from '../../services/beheerApi';
import { leesDatum, schoon, type Datumvorm } from './importlogica';

/**
 * Inschrijvingen van vorige jaren uit een export van een formulier (bv. Google Formulieren, zie
 * "Bronnen instructie/Infodagen 2026 - Google Formulieren.pdf"), zonder schermen:
 *   - kolommen voorstellen (ook meerdere kolommen voor het moment en de keuzelesjes)
 *   - het moment lezen: "Zaterdag 24 januari - Voormiddag 10.00u. - 12.10u." → dag, datum, dagdeel en uren
 *   - het tijdsblok uit de kolomnaam: "Keuzelesje 1 - start 10.10 u." → "Keuzelesje 1" vanaf 10:10
 *   - het programma (dagen, dagdelen, tijdsblokken, lesjes) opbouwen uit wat in het bestand staat
 * Het tijdsblok volgt het moment dat de ouder koos, niet de kolom: in de exports staan lesjes soms in de kolommen
 * van een ander moment.
 */

export const INS_VELDEN = [
  { veld: 'ingediendOp', label: 'Tijdstempel (ingeschreven op)', woorden: ['tijdstempel', 'timestamp', 'ingediend', 'begintijd'] },
  { veld: 'email', label: 'E-mailadres', woorden: ['e-mail', 'email', 'mailadres'] },
  { veld: 'ouderVoornaam', label: 'Voornaam ouder', woorden: ['voornaam ouder'] },
  { veld: 'ouderNaam', label: 'Naam ouder', woorden: ['naam ouder', 'familienaam ouder'] },
  { veld: 'telefoon', label: 'Telefoonnummer', woorden: ['telefoon', 'gsm'] },
  { veld: 'kindVoornaam', label: 'Voornaam leerling', woorden: ['voornaam leerling', 'voornaam kind'] },
  { veld: 'kindNaam', label: 'Naam leerling', woorden: ['naam leerling', 'naam kind', 'familienaam'] },
  { veld: 'school', label: 'Huidige school', woorden: ['huidige school', 'school'] },
  { veld: 'leerjaar', label: 'Leerjaar', woorden: ['leerjaar', 'huidig schooljaar', 'klas'] },
  { veld: 'doelgroep', label: 'Stroom (doelgroep)', woorden: ['stroom', 'doelgroep'] },
  { veld: 'aanwezig', label: 'Aanwezig (kwam ook)', woorden: ['aanwezig', 'gekomen'] },
  { veld: 'opmerkingen', label: 'Opmerkingen', woorden: ['opmerking', 'vragen'] },
] as const;
export type InsVeld = (typeof INS_VELDEN)[number]['veld'];

export interface LesjeKolom { kolom: number; tijdsblok: string; start: string | null }

export interface InsKoppeling {
  velden: Record<InsVeld, number | null>;
  /** Kolommen met het moment; per rij telt de laatste ingevulde (bv. "Moment" en "Moment B-stroom"). */
  momenten: number[];
  lesjes: LesjeKolom[];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function stelInsKoppelingVoor(kolommen: string[], rijen: string[][]): InsKoppeling {
  const k = kolommen.map((c) => c.toLowerCase());
  const genomen = new Set<number>();
  const velden = {} as Record<InsVeld, number | null>;
  const adressen = (i: number) => rijen.filter((r) => EMAIL.test((r[i] ?? '').trim())).length;
  const beste = kolommen.map((_, i) => i).sort((a, b) => adressen(b) - adressen(a))[0];
  const momenten = k.map((c, i) => (c.includes('moment') ? i : -1)).filter((i) => i >= 0);
  const lesjes = k
    .map((c, i) => (!momenten.includes(i) && /(^|[^a-z])(keuze|lesje)/.test(c) ? i : -1))
    .filter((i) => i >= 0)
    .map((i) => ({ kolom: i, ...leesTijdsblok(kolommen[i]) }));
  for (const i of [...momenten, ...lesjes.map((l) => l.kolom)]) genomen.add(i);
  if (beste !== undefined && adressen(beste) > 0) {
    velden.email = beste;
    genomen.add(beste);
  }
  for (const { veld, woorden } of INS_VELDEN) {
    if (veld in velden) continue;
    const i = woorden.map((w) => k.findIndex((c, j) => !genomen.has(j) && c.includes(w))).find((j) => j >= 0);
    velden[veld] = i ?? null;
    if (i !== undefined) genomen.add(i);
  }
  return { velden, momenten, lesjes };
}

/** Is de eerste regel een kopregel? Niet als ze leeg is of als de eerste cel een datum of e-mailadres is. */
export function heeftKopregel(kolommen: string[]): boolean {
  if (!kolommen.some((c) => c.trim())) return false;
  return !kolommen.some((c) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(c.trim()) || EMAIL.test(c.trim()));
}

// ---------------------------------------------------------------------------
// Uren, moment, tijdsblok, lesje
// ---------------------------------------------------------------------------

const UUR = /(\d{1,2})\s*[.:hu]\s*(\d{2})/g;
const twee = (n: number) => String(n).padStart(2, '0');
const uur = (h: number, m: number) => `${twee(Math.min(23, h))}:${twee(Math.min(59, m))}`;
const minuten = (u: string) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));
export const plusMinuten = (u: string, n: number) => {
  const t = Math.min(23 * 60 + 59, minuten(u) + n);
  return uur(Math.floor(t / 60), t % 60);
};

function uren(tekst: string): string[] {
  return [...tekst.matchAll(UUR)].map((m) => uur(Number(m[1]), Number(m[2]))).filter((u) => Number(u.slice(0, 2)) <= 23);
}

/** "Keuzelesje 1 - start 10.10 u." → { tijdsblok: "Keuzelesje 1", start: "10:10" }. */
export function leesTijdsblok(kop: string): { tijdsblok: string; start: string | null } {
  const tekst = schoon(kop);
  const naam = tekst.split(/\s+-\s+/)[0].trim() || tekst;
  return { tijdsblok: naam.slice(0, 100), start: uren(tekst)[0] ?? null };
}

const MAANDEN = ['jan', 'feb', 'maa', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const maandNummer = (w: string) => {
  const x = w.toLowerCase();
  if (x.startsWith('mrt')) return 3;
  const i = MAANDEN.findIndex((m) => x.startsWith(m));
  return i >= 0 ? i + 1 : null;
};

export interface Moment { dagNaam: string; datum: string | null; dagdeel: string; start: string; eind: string }

/** Jaar van een maand binnen een schooljaar ("2025-2026"): september tot december = eerste jaar. */
const jaarIn = (schooljaar: string, maand: number) => Number(schooljaar.slice(maand >= 9 ? 0 : 5, maand >= 9 ? 4 : 9));

/**
 * "Zaterdag 24 januari - Voormiddag 10.00u. - 12.10u." → dag "Zaterdag 24 januari", datum 2026-01-24 (schooljaar
 * 2025-2026), dagdeel "Voormiddag", 10:00 tot 12:10. Ook "za 24/1 namiddag". Null als er geen datum in staat.
 */
export function leesMoment(tekst: string, schooljaar: string): Moment | null {
  const t = schoon(tekst);
  if (!t) return null;
  const [eerste, ...rest] = t.split(/\s+-\s+/);
  let dag: number | null = null;
  let maand: number | null = null;
  let jaar: number | null = null;
  const woord = /(\d{1,2})\s+([a-zA-Z]{3,})/.exec(t);
  const cijfers = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(t);
  if (woord && maandNummer(woord[2])) [dag, maand] = [Number(woord[1]), maandNummer(woord[2])];
  else if (cijfers) {
    [dag, maand] = [Number(cijfers[1]), Number(cijfers[2])];
    if (cijfers[3]) jaar = Number(cijfers[3].length === 2 ? `20${cijfers[3]}` : cijfers[3]);
  }
  const geldig = dag && maand && dag <= 31 && maand <= 12;
  const datum = geldig ? `${jaar ?? jaarIn(schooljaar, maand!)}-${twee(maand!)}-${twee(dag!)}` : null;

  const deel = rest.join(' - ') || t;
  const naamDeel = /(voormiddag|namiddag|middag|avond|ochtend)/i.exec(deel)?.[1] ?? (/^([^\d]+)/.exec(deel)?.[1] ?? '').replace(/\b(tussen|ts\.?|van|op)\b/gi, '').trim();
  const u = uren(deel);
  let dagdeel = naamDeel ? naamDeel.charAt(0).toUpperCase() + naamDeel.slice(1).toLowerCase() : '';
  const start = u[0] ?? (/namiddag/i.test(dagdeel) ? '13:00' : '09:00');
  if (!dagdeel) dagdeel = minuten(start) < 12 * 60 ? 'Voormiddag' : 'Namiddag';
  let eind = u[1] ?? plusMinuten(start, 180);
  if (eind <= start) eind = plusMinuten(start, 120);
  const dagNaam = (geldig ? eerste.trim() : t).slice(0, 100);
  return { dagNaam: dagNaam.charAt(0).toUpperCase() + dagNaam.slice(1), datum, dagdeel, start, eind };
}

export type Lesje = { soort: 'lesje'; titel: string } | { soort: 'geen' } | { soort: 'fout' } | null;

/** "- geen" → geen lesje; "#ERROR!" of "#REF!" → onbekend; "- Infomoment met ouder(s)" → het infomoment als lesje. */
export function leesLesje(w: string): Lesje {
  const t = schoon(w);
  if (!t) return null;
  if (t.startsWith('#')) return { soort: 'fout' };
  const titel = t.replace(/^[-–\s]+/, '').trim();
  if (!titel || /^geen\b/i.test(titel)) return { soort: 'geen' };
  return { soort: 'lesje', titel: titel.slice(0, 200) };
}

/** "A-stroom - leerlingen met getuigschrift lager onderwijs" → "A-stroom". */
export const leesDoelgroep = (w: string) => schoon(w).split(/\s+-\s+/)[0].slice(0, 100) || null;

const JA = /^(ja|j|x|1|true|waar|aanwezig|ok|yes)$/i;
export const leesAanwezig = (w: string) => JA.test(schoon(w));

/** Tijdstempel uit het formulier (Belgische tijd) → ISO met tijdzone, zodat de server hetzelfde moment bewaart. */
export function leesTijdstempel(w: string, vorm: Datumvorm): string | null {
  const lokaal = leesDatum(w.replace(/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(\d{1,2}:\d{2})$/, '$1 $2:00'), vorm);
  if (!lokaal) return null;
  const d = new Date(lokaal);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Programma opbouwen
// ---------------------------------------------------------------------------

export interface RijProgramma {
  dagdeel: string | null;
  sessies: string[];
  momentTekst: string;
  /** Aantal keuzes die onbekend waren in het bestand (#ERROR!). */
  onbekend: number;
}

export interface ProgrammaResultaat {
  dagen: ProgrammaDag[];
  rijen: RijProgramma[];
  /** Momenten zonder leesbare datum (met het aantal rijen). */
  onleesbaar: [string, number][];
  /** Aantal rijen en lesjes per sleutel, voor het voorbeeld. */
  aantal: Record<string, number>;
}

const sleutel = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function bouwProgramma(rijen: string[][], koppeling: InsKoppeling, schooljaar: string): ProgrammaResultaat {
  const dagen = new Map<string, ProgrammaDag>();
  const dagdelen = new Map<string, ProgrammaDag['dagdelen'][number]>();
  const blokken = new Map<string, ProgrammaDag['dagdelen'][number]['tijdsblokken'][number]>();
  const sessies = new Map<string, { sleutel: string; titels: Map<string, number> }>();
  const onleesbaar = new Map<string, number>();
  const aantal: Record<string, number> = {};
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const tel = (s: string) => (aantal[s] = (aantal[s] ?? 0) + 1);

  const uit: RijProgramma[] = rijen.map((r) => {
    const momentTekst = [...koppeling.momenten].map((k) => schoon(r[k] ?? '')).filter(Boolean).pop() ?? '';
    const leeg: RijProgramma = { dagdeel: null, sessies: [], momentTekst, onbekend: 0 };
    if (!momentTekst) return leeg;
    const m = leesMoment(momentTekst, schooljaar);
    if (!m?.datum) {
      onleesbaar.set(momentTekst, (onleesbaar.get(momentTekst) ?? 0) + 1);
      return leeg;
    }
    let dag = dagen.get(m.datum);
    if (!dag) dagen.set(m.datum, (dag = { sleutel: id('d'), naam: m.dagNaam, datum: m.datum, dagdelen: [] }));
    const ddSleutel = `${m.datum}|${sleutel(m.dagdeel)}`;
    let dd = dagdelen.get(ddSleutel);
    if (!dd) {
      dagdelen.set(ddSleutel, (dd = { sleutel: id('p'), naam: m.dagdeel, start: m.start, eind: m.eind, tijdsblokken: [] }));
      dag.dagdelen.push(dd);
    }
    tel(dd.sleutel);

    const gekozen: string[] = [];
    const gebruikteBlokken = new Set<string>();
    let onbekend = 0;
    for (const l of koppeling.lesjes) {
      const lesje = leesLesje(r[l.kolom] ?? '');
      if (!lesje) continue;
      const tbSleutel = `${ddSleutel}|${sleutel(l.tijdsblok)}`;
      if (gebruikteBlokken.has(tbSleutel)) continue; // een tweede kolom met hetzelfde tijdsblok
      gebruikteBlokken.add(tbSleutel);
      if (lesje.soort === 'fout') { onbekend++; continue; }
      if (lesje.soort === 'geen') continue;
      let tb = blokken.get(tbSleutel);
      if (!tb) {
        const start = l.start && l.start >= dd.start && l.start < dd.eind ? l.start : dd.start;
        blokken.set(tbSleutel, (tb = { sleutel: id('t'), naam: l.tijdsblok, start, eind: plusMinuten(start, 40), sessies: [] }));
        dd.tijdsblokken.push(tb);
      }
      const sSleutel = `${tbSleutel}|${sleutel(lesje.titel)}`;
      let s = sessies.get(sSleutel);
      if (!s) {
        sessies.set(sSleutel, (s = { sleutel: id('s'), titels: new Map() }));
        tb.sessies.push({ sleutel: s.sleutel, titel: lesje.titel });
      }
      s.titels.set(lesje.titel, (s.titels.get(lesje.titel) ?? 0) + 1);
      tel(s.sleutel);
      gekozen.push(s.sleutel);
    }
    return { dagdeel: dd.sleutel, sessies: gekozen, momentTekst, onbekend };
  });

  // Titel: de schrijfwijze die het meest voorkomt ("Lesje geschiedenis" en "Lesje Geschiedenis" zijn hetzelfde lesje).
  const titelVan = new Map([...sessies.values()].map((s) => [s.sleutel, [...s.titels].sort((a, b) => b[1] - a[1])[0][0]]));
  const lijst = [...dagen.values()].sort((a, b) => a.datum.localeCompare(b.datum));
  for (const d of lijst) {
    d.dagdelen.sort((a, b) => a.start.localeCompare(b.start));
    for (const dd of d.dagdelen) {
      dd.tijdsblokken.sort((a, b) => a.start.localeCompare(b.start) || a.naam.localeCompare(b.naam, 'nl'));
      for (const t of dd.tijdsblokken) {
        for (const s of t.sessies) s.titel = titelVan.get(s.sleutel) ?? s.titel;
        t.sessies.sort((a, b) => a.titel.localeCompare(b.titel, 'nl'));
      }
    }
  }
  return { dagen: lijst, rijen: uit, onleesbaar: [...onleesbaar].sort((a, b) => b[1] - a[1]), aantal };
}

/** Schooljaar van een datum: "2026-01-24" → "2025-2026". */
export function schooljaarVan(datum: string): string {
  const [j, m] = datum.split('-').map(Number);
  const begin = m >= 9 ? j : j - 1;
  return `${begin}-${begin + 1}`;
}
