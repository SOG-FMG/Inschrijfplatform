import type { School } from '../../types';

/**
 * Logica voor het importeren van een extern bestand (bv. een export van Microsoft Forms), zonder schermen:
 * CSV lezen, kolommen voorstellen, datums lezen en scholen koppelen aan de officiële lijst.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** UTF-8, en anders Windows-1252 (Excel op Windows). Een BOM wordt weggelaten. */
export function decodeer(buffer: ArrayBuffer): string {
  let tekst: string;
  try {
    tekst = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    tekst = new TextDecoder('windows-1252').decode(buffer);
  }
  return tekst.replace(/^﻿/, '');
}

/** Onzichtbare en kapotte tekens (Forms zet die achter sommige kolomnamen en antwoorden). */
export const schoon = (s: string) =>
  s.replace(/[�​-‍⁠﻿]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Leest CSV met ; of , (wat het meest voorkomt in de eerste regel), met aanhalingstekens. Lege rijen vallen weg. */
export function leesCsv(tekst: string): { kolommen: string[]; rijen: string[][] } {
  const eerste = tekst.split(/\r?\n/, 1)[0] ?? '';
  const scheiding = (eerste.match(/;/g)?.length ?? 0) >= (eerste.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rijen: string[][] = [];
  let rij: string[] = [];
  let veld = '';
  let inAanhaling = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (inAanhaling) {
      if (c === '"' && tekst[i + 1] === '"') { veld += '"'; i++; }
      else if (c === '"') inAanhaling = false;
      else veld += c;
    } else if (c === '"') inAanhaling = true;
    else if (c === scheiding) { rij.push(veld); veld = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && tekst[i + 1] === '\n') i++;
      rij.push(veld); rijen.push(rij); rij = []; veld = '';
    } else veld += c;
  }
  if (veld || rij.length) { rij.push(veld); rijen.push(rij); }
  const [kop = [], ...rest] = rijen.map((r) => r.map(schoon));
  return { kolommen: kop, rijen: rest.filter((r) => r.some((v) => v)) };
}

// ---------------------------------------------------------------------------
// Kolommen koppelen
// ---------------------------------------------------------------------------

export const VELDEN = [
  { veld: 'ingediendOp', label: 'Ingediend op', woorden: ['voltooien', 'ingediend', 'datum', 'tijd', 'begintijd'] },
  { veld: 'kindNaam', label: 'Naam van het kind', woorden: ['kind', 'leerling', 'naam'] },
  { veld: 'kindVoornaam', label: 'Voornaam van het kind (als die apart staat)', woorden: ['voornaam kind', 'voornaam leerling'] },
  { veld: 'schooljaar', label: 'Schooljaar', woorden: ['gewenst voor', 'schooljaar'] },
  { veld: 'school', label: 'Huidige school', woorden: ['school'] },
  { veld: 'klas', label: 'Huidige klas', woorden: ['klas', 'leerjaar'] },
  { veld: 'email', label: 'E-mailadres', woorden: ['mailadres', 'e-mail', 'email'] },
  { veld: 'telefoon', label: 'Telefoonnummer', woorden: ['telefoon', 'gsm'] },
  { veld: 'opmerkingen', label: 'Vragen of opmerkingen', woorden: ['opmerking', 'vragen'] },
] as const;
export type Veld = (typeof VELDEN)[number]['veld'];
export type Koppeling = Record<Veld, number | null>;

/**
 * Stelt per veld een kolom voor op basis van de kolomnaam. Voor het e-mailadres telt de inhoud: de kolom
 * met de meeste geldige adressen (Forms zet in "E-mail" vaak "anonymous", het echte adres staat in "Mailadres").
 */
export function stelKoppelingVoor(kolommen: string[], rijen: string[][]): Koppeling {
  const k = kolommen.map((c) => c.toLowerCase());
  const genomen = new Set<number>();
  const uit = {} as Koppeling;
  const adressen = (i: number) => rijen.filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r[i] ?? '')).length;
  const beste = kolommen.map((_, i) => i).sort((a, b) => adressen(b) - adressen(a))[0];
  if (beste !== undefined && adressen(beste) > 0) { uit.email = beste; genomen.add(beste); }
  for (const { veld, woorden } of VELDEN) {
    if (veld in uit) continue;
    const i = woorden.map((w) => k.findIndex((c, j) => !genomen.has(j) && c.includes(w))).find((j) => j >= 0);
    uit[veld] = i ?? null;
    if (i !== undefined) genomen.add(i);
  }
  // Naam van het kind: liefst een kolom met "kind" erin, anders de eerste naamkolom die gevuld is.
  if (uit.kindNaam !== null && !rijen.some((r) => r[uit.kindNaam!])) {
    const j = k.findIndex((c, x) => c.includes('naam') && rijen.some((r) => r[x]));
    uit.kindNaam = j >= 0 ? j : null;
  }
  return uit;
}

/**
 * Splitst een naam in voornaam en familienaam. Forms vraagt vaak "Naam + Voornaam": dan is het laatste woord de
 * voornaam ("Van den Broeck Lotte"). Bij "voornaam naam" is het eerste woord de voornaam.
 */
export function splitsNaam(volledig: string, volgorde: 'naam-voornaam' | 'voornaam-naam'): { voornaam: string | null; naam: string | null } {
  const w = volledig.trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return { voornaam: null, naam: w[0] ?? null };
  return volgorde === 'naam-voornaam'
    ? { voornaam: w[w.length - 1], naam: w.slice(0, -1).join(' ') }
    : { voornaam: w[0], naam: w.slice(1).join(' ') };
}

// ---------------------------------------------------------------------------
// Datums
// ---------------------------------------------------------------------------

export type Datumvorm = 'DMJ' | 'MDJ';
const DATUM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** 'DMJ' of 'MDJ' als dat uit de waarden blijkt (een getal boven 12), anders null (dan kiest de gebruiker). */
export function herkenDatumvorm(waarden: string[]): Datumvorm | null {
  for (const w of waarden) {
    const m = DATUM.exec(w.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return 'DMJ';
    if (Number(m[2]) > 12) return 'MDJ';
  }
  return null;
}

/** "11/3/25 13:26:06" → "2025-03-11T13:26:06" (DMJ). ISO-datums blijven zoals ze zijn. Onleesbaar → null. */
export function leesDatum(w: string, vorm: Datumvorm): string | null {
  const s = w.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const m = DATUM.exec(s);
  if (!m) return null;
  const [dag, maand] = vorm === 'DMJ' ? [m[1], m[2]] : [m[2], m[1]];
  const jaar = m[3].length === 2 ? `20${m[3]}` : m[3];
  const twee = (x: string | undefined) => (x ?? '0').padStart(2, '0');
  if (Number(maand) < 1 || Number(maand) > 12 || Number(dag) < 1 || Number(dag) > 31) return null;
  return `${jaar}-${twee(maand)}-${twee(dag)}T${twee(m[4])}:${twee(m[5])}:${twee(m[6])}`;
}

// ---------------------------------------------------------------------------
// Scholen koppelen
// ---------------------------------------------------------------------------

/** Woorden die in veel schoolnamen staan en dus niets onderscheiden. */
const ALGEMEEN = new Set(['de', 'het', 't', 'van', 'der', 'den', 'en', 'school', 'basisschool', 'lagere', 'lager', 'vrije', 'gemeentelijke',
  'stedelijke', 'gesubsidieerde', 'katholieke', 'vbs', 'gbs', 'sbs', 'bs', 'vzw', 'campus', 'afdeling', 'onderwijs']);

export const woorden = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\bst\b\.?/g, 'sint').split(/[^a-z0-9]+/).filter((w) => w && !ALGEMEEN.has(w));

const gelijk = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

export interface Suggestie { school: School; score: number }
export type Zekerheid = 'zeker' | 'twijfel' | 'geen';

/**
 * Score 0..1: hoe goed de naam overeenkomt (onderscheidende woorden) en of de gemeente genoemd wordt.
 * Een algemene naam zonder onderscheidende woorden ("Gemeentelijke Basisschool") is nooit zeker.
 */
export function score(invoer: string, s: School): number {
  const iw = woorden(invoer);
  const gem = woorden(s.gemeente ?? '');
  const naam = woorden(s.naam);
  const gemeenteGenoemd = gem.some((g) => iw.some((w) => gelijk(w, g)));
  const iNaam = iw.filter((w) => !gem.some((g) => gelijk(w, g)));
  const raak = naam.filter((n) => iNaam.some((w) => gelijk(w, n))).length;
  // Beide enkel algemene woorden ("Gemeentelijke Basisschool" + gemeente): half, zodat het hoogstens een twijfel wordt.
  const naamScore = naam.length && iNaam.length ? (2 * raak) / (naam.length + iNaam.length) : !naam.length && !iNaam.length ? 0.5 : 0;
  return Math.round((0.75 * naamScore + (gemeenteGenoemd ? 0.25 : 0)) * 100) / 100;
}

export function koppelSchool(invoer: string, scholen: School[]): { zekerheid: Zekerheid; suggesties: Suggestie[] } {
  if (!woorden(invoer).length) return { zekerheid: 'geen', suggesties: [] };
  const suggesties = scholen
    .map((school) => ({ school, score: score(invoer, school) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const [eerste, tweede] = suggesties;
  if (!eerste || eerste.score < 0.35) return { zekerheid: 'geen', suggesties };
  const zeker = eerste.score >= 0.75 && (!tweede || eerste.score - tweede.score >= 0.15);
  return { zekerheid: zeker ? 'zeker' : 'twijfel', suggesties };
}
