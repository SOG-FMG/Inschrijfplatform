import { domeinTekst, isToegelatenEmail } from '../../kern/installatie';
import { controleerToegang, heeftRecht, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';

/**
 * Instellingen van een evenement: algemeen, doelgroepen, dagen, dagdelen, tijdsblokken en sessies (lesjes).
 *
 * Eén schema per soort beschrijft welke kolommen aanpasbaar zijn, hoe ze gevalideerd worden en
 * welk label het scherm toont. De frontend bouwt zijn formulieren uit hetzelfde schema, zodat een
 * nieuwe kolom maar op één plaats toegevoegd moet worden. Kolommen die hier niet staan (id's,
 * ouder-id's, created_*), kunnen via deze routes nooit gewijzigd worden.
 */

export type Soort = 'evenement' | 'doelgroep' | 'dag' | 'dagdeel' | 'tijdsblok' | 'sessie';
type VeldType = 'tekst' | 'lang' | 'datum' | 'uur' | 'datumtijd' | 'getal' | 'jaNee' | 'keuze' | 'slug' | 'email' | 'lijst' | 'ref' | 'kleur' | 'logo';

export interface Veld {
  naam: string;
  label: string;
  type: VeldType;
  verplicht?: boolean;
  opties?: { waarde: string; label: string }[];
  ref?: 'doelgroep' | 'soort' | 'locatie';
  min?: number;
  max?: number;
  hulp?: string;
  /** E-mailadres moet van het eigen domein zijn (er gaan persoonsgegevens naartoe). */
  intern?: boolean;
  /** Waarde voor een nieuw record. */
  standaard?: unknown;
}

interface Definitie {
  tabel: string;
  id: string;
  ouder?: { kolom: string; soort: Soort };
  /** Kolom die getoond wordt als naam van het record. */
  titel: string;
  gewijzigd?: boolean; // heeft modified_by/modified_at en created_by
  velden: Veld[];
}

const opties = (...w: [string, string][]) => w.map(([waarde, label]) => ({ waarde, label }));
const STATUS_ACTIEF = opties(['actief', 'Actief'], ['geannuleerd', 'Geannuleerd']);
const volgorde: Veld = { naam: 'volgorde', label: 'Volgorde', type: 'getal', min: 0, verplicht: true, standaard: 1 };

export const SCHEMA: Record<Soort, Definitie> = {
  evenement: {
    tabel: 'evenementen',
    id: 'evenement_id',
    titel: 'titel',
    gewijzigd: true,
    velden: [
      { naam: 'titel', label: 'Titel', type: 'tekst', verplicht: true },
      { naam: 'slug', label: 'Adres (slug)', type: 'slug', verplicht: true, hulp: 'Deel van de link naar het formulier: kleine letters, cijfers en streepjes.' },
      { naam: 'status', label: 'Status', type: 'keuze', verplicht: true, standaard: 'concept',
        opties: opties(['concept', 'Concept (niet zichtbaar)'], ['gepubliceerd', 'Gepubliceerd'], ['gesloten', 'Gesloten'], ['gearchiveerd', 'Gearchiveerd']) },
      { naam: 'type_evenement', label: 'Soort evenement', type: 'tekst', verplicht: true, standaard: 'Infodag', hulp: 'Bv. Infodag, Opendeur, Studiedag' },
      { naam: 'organisator', label: 'Organisator', type: 'tekst' },
      { naam: 'omschrijving', label: 'Omschrijving', type: 'lang' },
      { naam: 'start_datum', label: 'Eerste dag', type: 'datum', verplicht: true },
      { naam: 'eind_datum', label: 'Laatste dag', type: 'datum', verplicht: true },
      { naam: 'inschrijving_vanaf', label: 'Inschrijven vanaf', type: 'datumtijd', hulp: 'Leeg = meteen' },
      { naam: 'inschrijving_tot', label: 'Inschrijven tot', type: 'datumtijd', hulp: 'Leeg = tot het evenement' },
      { naam: 'voorinschrijving', label: 'Voorinschrijving', type: 'jaNee', standaard: false },
      { naam: 'deelnemer_type', label: 'Deelnemers', type: 'keuze', verplicht: true, standaard: 'leerling',
        opties: opties(['leerling', 'Leerlingen (met ouder als contact)'], ['volwassene', 'Volwassenen']) },
      { naam: 'leerjaar_opties', label: 'Keuzes voor leerjaar', type: 'lijst', standaard: [], hulp: 'Gescheiden door komma’s, bv. 5de leerjaar, 6de leerjaar' },
      { naam: 'max_dagdelen', label: 'Max. aantal momenten per inschrijving', type: 'getal', min: 1, verplicht: true, standaard: 1 },
      { naam: 'contact_email', label: 'E-mailadres voor vragen', type: 'email',
        hulp: 'Voor extra info. Staat op het formulier, in de bevestigingsmail en op de persoonlijke pagina van de inschrijver.' },
      { naam: 'privacy_tekst', label: 'Privacytekst', type: 'lang' },
      { naam: 'bewaartermijn_dagen', label: 'Bewaartermijn (dagen na het evenement)', type: 'getal', min: 0, verplicht: true, standaard: 30 },
      { naam: 'logo', label: 'Logo', type: 'logo', hulp: 'PNG, JPG of WebP, max. 500 kB. Verschijnt bovenaan het formulier.' },
      { naam: 'logo_hoogte', label: 'Hoogte logo (pixels)', type: 'getal', min: 20, max: 400, hulp: 'Leeg = 135. De breedte past zich automatisch aan.' },
      { naam: 'kleur_primair', label: 'Hoofdkleur', type: 'kleur', hulp: 'Knoppen, titels en links. Leeg = standaard blauw.' },
      { naam: 'kleur_accent', label: 'Accentkleur', type: 'kleur', hulp: 'Markeringen en focus. Leeg = standaard.' },
      { naam: 'opmerkingen', label: 'Interne opmerkingen', type: 'lang' },
    ],
  },
  doelgroep: {
    tabel: 'doelgroepen',
    id: 'doelgroep_id',
    ouder: { kolom: 'evenement_id', soort: 'evenement' },
    titel: 'naam',
    velden: [
      { naam: 'naam', label: 'Naam', type: 'tekst', verplicht: true },
      { naam: 'beschrijving', label: 'Beschrijving', type: 'lang' },
      { naam: 'sessiekeuze', label: 'Kiest lesjes', type: 'jaNee', standaard: true, hulp: 'Uit = enkel een moment kiezen' },
      volgorde,
    ],
  },
  dag: {
    tabel: 'evenement_dagen',
    id: 'dag_id',
    ouder: { kolom: 'evenement_id', soort: 'evenement' },
    titel: 'naam',
    velden: [
      { naam: 'naam', label: 'Naam', type: 'tekst', verplicht: true, hulp: 'Bv. Zaterdag 23 januari' },
      { naam: 'datum', label: 'Datum', type: 'datum', verplicht: true },
      { naam: 'start_uur', label: 'Van', type: 'uur', verplicht: true },
      { naam: 'eind_uur', label: 'Tot', type: 'uur', verplicht: true },
      { naam: 'sessiekeuze_tot', label: 'Lesjes kiezen tot', type: 'datumtijd', hulp: 'Daarna enkel nog een moment kiezen' },
      { naam: 'status', label: 'Status', type: 'keuze', verplicht: true, standaard: 'actief', opties: STATUS_ACTIEF },
      volgorde,
    ],
  },
  dagdeel: {
    tabel: 'dagdelen',
    id: 'dagdeel_id',
    ouder: { kolom: 'dag_id', soort: 'dag' },
    titel: 'naam',
    velden: [
      { naam: 'naam', label: 'Naam', type: 'tekst', verplicht: true, hulp: 'Bv. Voormiddag' },
      { naam: 'start_uur', label: 'Van', type: 'uur', verplicht: true },
      { naam: 'eind_uur', label: 'Tot', type: 'uur', verplicht: true },
      { naam: 'capaciteit', label: 'Max. deelnemers', type: 'getal', min: 0, hulp: 'Leeg = onbeperkt' },
      { naam: 'status', label: 'Status', type: 'keuze', verplicht: true, standaard: 'actief', opties: STATUS_ACTIEF },
      volgorde,
    ],
  },
  tijdsblok: {
    tabel: 'tijdsblokken',
    id: 'tijdsblok_id',
    ouder: { kolom: 'dagdeel_id', soort: 'dagdeel' },
    titel: 'naam',
    velden: [
      { naam: 'naam', label: 'Naam', type: 'tekst', verplicht: true, hulp: 'Bv. Keuzelesje 1, Rondleiding' },
      { naam: 'type', label: 'Soort', type: 'keuze', verplicht: true, standaard: 'keuze',
        opties: opties(['keuze', 'Keuze (deelnemer kiest een lesje)'], ['programma', 'Programma (voor iedereen)']) },
      { naam: 'verplicht', label: 'Keuze verplicht', type: 'jaNee', standaard: false },
      { naam: 'omschrijving', label: 'Omschrijving', type: 'lang' },
      { naam: 'start_uur', label: 'Van', type: 'uur', verplicht: true },
      { naam: 'eind_uur', label: 'Tot', type: 'uur', verplicht: true },
      volgorde,
    ],
  },
  sessie: {
    tabel: 'sessies',
    id: 'sessie_id',
    ouder: { kolom: 'tijdsblok_id', soort: 'tijdsblok' },
    titel: 'titel',
    gewijzigd: true,
    velden: [
      { naam: 'titel', label: 'Titel', type: 'tekst', verplicht: true },
      { naam: 'code', label: 'Code', type: 'tekst', hulp: 'Zelfde code in een ander tijdsblok = zelfde lesje (niet twee keer te kiezen)' },
      { naam: 'soort_id', label: 'Soort', type: 'ref', ref: 'soort' },
      { naam: 'doelgroep_id', label: 'Doelgroep', type: 'ref', ref: 'doelgroep', hulp: 'Leeg = iedereen' },
      { naam: 'locatie_id', label: 'Lokaal', type: 'ref', ref: 'locatie' },
      { naam: 'capaciteit', label: 'Max. deelnemers', type: 'getal', min: 0, hulp: 'Leeg = onbeperkt' },
      { naam: 'lesgever', label: 'Leerkracht', type: 'tekst', hulp: 'Verschijnt op de rapporten' },
      { naam: 'lesgever_email', label: 'E-mail leerkracht', type: 'email', intern: true, hulp: 'Enkel een adres van de eigen organisatie (zelfde domein als de medewerkers). Krijgt de klaslijst via "Mailen".' },
      { naam: 'status', label: 'Status', type: 'keuze', verplicht: true, standaard: 'open',
        opties: opties(['open', 'Open'], ['gesloten', 'Gesloten'], ['geannuleerd', 'Geannuleerd']) },
      { naam: 'zichtbaar', label: 'Zichtbaar', type: 'jaNee', standaard: true },
      { naam: 'wachtlijst_toegelaten', label: 'Wachtlijst', type: 'jaNee', standaard: false },
      { naam: 'volzet_weergave', label: 'Als volzet', type: 'keuze', verplicht: true, standaard: 'tonen',
        opties: opties(['tonen', 'Tonen als volzet'], ['verbergen', 'Verbergen']) },
      { naam: 'uniek_per_deelnemer', label: 'Maar één keer te kiezen', type: 'jaNee', standaard: true },
      { naam: 'beschrijving', label: 'Beschrijving', type: 'lang' },
      { naam: 'kleur', label: 'Kleur', type: 'kleur' },
      volgorde,
      { naam: 'opmerkingen', label: 'Interne opmerkingen', type: 'lang' },
    ],
  },
};

export const isSoort = (s: string): s is Soort => s in SCHEMA;

/** Evenement waartoe een record hoort (voor de rechtencontrole). */
const EVENEMENT_VAN: Record<Soort, string> = {
  evenement: `select evenement_id from evenementen where evenement_id = ?`,
  doelgroep: `select evenement_id from doelgroepen where doelgroep_id = ?`,
  dag: `select evenement_id from evenement_dagen where dag_id = ?`,
  dagdeel: `select d.evenement_id from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id where dd.dagdeel_id = ?`,
  tijdsblok: `select d.evenement_id from tijdsblokken t join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
              join evenement_dagen d on d.dag_id = dd.dag_id where t.tijdsblok_id = ?`,
  sessie: `select d.evenement_id from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
           join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id where s.sessie_id = ?`,
};

async function evenementVan(env: Env, soort: Soort, id: string): Promise<string> {
  const r = await env.DB.prepare(EVENEMENT_VAN[soort]).bind(id).first<{ evenement_id: string }>();
  if (!r) throw new DbFout('GEEN_TOEGANG'); // zelfde antwoord als zonder rechten
  return r.evenement_id;
}

// ---------------------------------------------------------------------------
// Validatie
// ---------------------------------------------------------------------------
const leeg = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function zetOm(env: Env, v: Veld, waarde: unknown): unknown {
  const fout = (m: string) => new ValidatieFout({ [v.naam]: m });
  if (v.type === 'jaNee') return waarde === true || waarde === 1 || waarde === '1' ? 1 : 0;
  if (v.type === 'lijst') {
    const lijst = Array.isArray(waarde) ? waarde : String(waarde ?? '').split(',');
    const schoon = lijst.map((x) => String(x).trim().slice(0, 100)).filter(Boolean);
    if (schoon.length > 50) throw fout('Te veel waarden.');
    return JSON.stringify(schoon);
  }
  if (leeg(waarde)) {
    if (v.verplicht) throw fout('Verplicht.');
    return null;
  }
  const s = String(waarde).trim();
  switch (v.type) {
    case 'tekst':
    case 'ref':
      if (s.length > 200) throw fout('Maximaal 200 tekens.');
      return s;
    case 'lang':
      if (s.length > 5000) throw fout('Maximaal 5000 tekens.');
      return s;
    case 'datum':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw fout('Geef een geldige datum.');
      return s;
    case 'uur':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw fout('Geef een uur als 09:30.');
      return s;
    case 'datumtijd': {
      const t = Date.parse(s);
      if (Number.isNaN(t)) throw fout('Geef een geldige datum en tijd.');
      return new Date(t).toISOString();
    }
    case 'getal': {
      const n = Number(s);
      if (!Number.isInteger(n) || n > 1_000_000) throw fout('Geef een geheel getal.');
      if (v.min !== undefined && n < v.min) throw fout(`Minstens ${v.min}.`);
      if (v.max !== undefined && n > v.max) throw fout(`Hoogstens ${v.max}.`);
      return n;
    }
    case 'keuze':
      if (!v.opties?.some((o) => o.waarde === s)) throw fout('Maak een geldige keuze.');
      return s;
    case 'slug':
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length > 80) throw fout('Enkel kleine letters, cijfers en enkele streepjes.');
      return s;
    case 'kleur':
      if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw fout('Geef een kleur als #1d4f91.');
      return s.toLowerCase();
    case 'email':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) || s.length > 254) throw fout('Geef een geldig e-mailadres.');
      if (v.intern && !isToegelatenEmail(env, s)) throw fout(`Enkel ${domeinTekst(env)}.`);
      return s.toLowerCase();
  }
  return s;
}

/** Een verwijzing (doelgroep, soort, lokaal) moet bestaan, en een doelgroep moet bij hetzelfde evenement horen. */
async function controleerRef(env: Env, v: Veld, waarde: unknown, evenementId: string) {
  if (waarde === null || v.type !== 'ref') return;
  const sql = {
    doelgroep: `select 1 from doelgroepen where doelgroep_id = ?1 and evenement_id = ?2`,
    soort: `select 1 from soorten_onderdelen where soort_id = ?1`,
    locatie: `select 1 from locaties where locatie_id = ?1`,
  }[v.ref!];
  const ok = await env.DB.prepare(sql).bind(waarde, evenementId).first();
  if (!ok) throw new ValidatieFout({ [v.naam]: 'Maak een geldige keuze.' });
}

async function zetWaardenOm(env: Env, def: Definitie, invoer: Record<string, unknown>, nieuw: boolean, evenementId: string | null) {
  const uit: Record<string, unknown> = {};
  const fouten: Record<string, string> = {};
  for (const v of def.velden) {
    if (v.type === 'logo') continue; // enkel via de uploadroute
    const aanwezig = Object.prototype.hasOwnProperty.call(invoer, v.naam);
    if (!aanwezig && !nieuw) continue; // gedeeltelijke wijziging
    const waarde = aanwezig ? invoer[v.naam] : v.standaard;
    try {
      uit[v.naam] = zetOm(env, v, waarde);
      if (evenementId) await controleerRef(env, v, uit[v.naam], evenementId);
    } catch (e) {
      if (e instanceof ValidatieFout) Object.assign(fouten, e.velden);
      else throw e;
    }
  }
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);
  return uit;
}

/** Vertaalt fouten van het schema (CHECK, UNIQUE, FOREIGN KEY) naar begrijpelijke meldingen. */
function vertaalSchemaFout(e: unknown): never {
  const m = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e);
  if (m.includes('UNIQUE') && m.includes('slug')) throw new ValidatieFout({ slug: 'Dit adres is al in gebruik door een ander evenement.' });
  if (m.includes('FOREIGN KEY')) throw new DbFout('IN_GEBRUIK');
  if (m.includes('CHECK')) {
    throw new ValidatieFout({ algemeen: 'Controleer de uren en datums: het einde moet na het begin liggen, en inschrijven moet eindigen na de start.' });
  }
  throw e;
}

// ---------------------------------------------------------------------------
// Lezen
// ---------------------------------------------------------------------------
export async function instellingen(env: Env, g: Gebruiker, evenementId: string) {
  await controleerToegang(env, g, evenementId);
  const kanSchrijven = await controleerToegang(env, g, evenementId, true).then(
    () => true,
    () => false,
  );
  const db = env.DB;
  const [ev, doelgroepen, dagen, dagdelen, tijdsblokken, sessies, tellingDagdeel, tellingSessie, soorten, locaties] = await db.batch<any>([
    db.prepare(`select * from evenementen where evenement_id = ?`).bind(evenementId),
    db.prepare(`select * from doelgroepen where evenement_id = ? order by volgorde, naam`).bind(evenementId),
    db.prepare(`select * from evenement_dagen where evenement_id = ? order by volgorde, datum`).bind(evenementId),
    db.prepare(`select dd.* from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ? order by dd.volgorde, dd.start_uur`).bind(evenementId),
    db.prepare(
      `select t.* from tijdsblokken t join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? order by t.volgorde, t.start_uur`,
    ).bind(evenementId),
    db.prepare(
      `select s.* from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ? order by s.volgorde, s.titel`,
    ).bind(evenementId),
    db.prepare(
      `select dagdeel_id as id, sum(status = 'bevestigd') as bevestigd, sum(status = 'wachtlijst') as wachtlijst
       from inschrijvingen where evenement_id = ? and sessie_id is null group by dagdeel_id`,
    ).bind(evenementId),
    db.prepare(
      `select sessie_id as id, sum(status = 'bevestigd') as bevestigd, sum(status = 'wachtlijst') as wachtlijst
       from inschrijvingen where evenement_id = ? and sessie_id is not null group by sessie_id`,
    ).bind(evenementId),
    db.prepare(`select soort_id as waarde, naam as label from soorten_onderdelen order by naam`),
    db.prepare(
      `select locatie_id as waarde, naam || coalesce(' – ' || nullif(lokaal, naam), '') as label from locaties
       where school_id is null or school_id = (select school_id from evenementen where evenement_id = ?) or ? = 'platformbeheerder'
       order by naam`,
    ).bind(evenementId, g.rol),
  ]);
  if (!ev.results[0]) throw new DbFout('GEEN_TOEGANG');

  const telling = (rijen: any[]) => new Map(rijen.map((r) => [r.id, { bevestigd: r.bevestigd ?? 0, wachtlijst: r.wachtlijst ?? 0 }]));
  const perDagdeel = telling(tellingDagdeel.results);
  const perSessie = telling(tellingSessie.results);
  const leeg0 = { bevestigd: 0, wachtlijst: 0 };
  const evenement = { ...ev.results[0], leerjaar_opties: JSON.parse(ev.results[0].leerjaar_opties ?? '[]') };

  return {
    kanSchrijven,
    schema: Object.fromEntries(Object.entries(SCHEMA).map(([k, d]) => [k, d.velden])),
    opties: {
      soort: soorten.results,
      locatie: locaties.results,
      doelgroep: doelgroepen.results.map((d: any) => ({ waarde: d.doelgroep_id, label: d.naam })),
    },
    evenement,
    doelgroepen: doelgroepen.results,
    dagen: dagen.results.map((d: any) => ({
      ...d,
      dagdelen: dagdelen.results
        .filter((dd: any) => dd.dag_id === d.dag_id)
        .map((dd: any) => ({
          ...dd,
          ingeschreven: perDagdeel.get(dd.dagdeel_id) ?? leeg0,
          tijdsblokken: tijdsblokken.results
            .filter((t: any) => t.dagdeel_id === dd.dagdeel_id)
            .map((t: any) => ({
              ...t,
              sessies: sessies.results
                .filter((s: any) => s.tijdsblok_id === t.tijdsblok_id)
                .map((s: any) => ({ ...s, ingeschreven: perSessie.get(s.sessie_id) ?? leeg0 })),
            })),
        })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Schrijven
// ---------------------------------------------------------------------------
export async function wijzig(env: Env, g: Gebruiker, soort: Soort, id: string, invoer: Record<string, unknown>, ip: string | null) {
  const def = SCHEMA[soort];
  const evenementId = await evenementVan(env, soort, id);
  await controleerToegang(env, g, evenementId, true);
  const waarden = await zetWaardenOm(env, def, invoer ?? {}, false, evenementId);
  const kolommen = Object.keys(waarden);
  if (!kolommen.length) return { ok: true };
  const extra = def.gewijzigd ? `, modified_by = ?, modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` : '';
  const bind = [...kolommen.map((k) => waarden[k]), ...(def.gewijzigd ? [g.gebruikerId] : []), id];
  try {
    await env.DB.batch([
      env.DB.prepare(`update ${def.tabel} set ${kolommen.map((k) => `${k} = ?`).join(', ')}${extra} where ${def.id} = ?`).bind(...bind),
      audit(env, g, def.tabel, id, 'WIJZIGEN', waarden, ip),
    ]);
  } catch (e) {
    vertaalSchemaFout(e);
  }
  return { ok: true };
}

export async function maak(env: Env, g: Gebruiker, soort: Soort, ouderId: string | null, invoer: Record<string, unknown>, ip: string | null) {
  const def = SCHEMA[soort];
  let evenementId: string | null = null;
  if (def.ouder) {
    if (!ouderId) throw new ValidatieFout({ algemeen: 'Ontbrekend bovenliggend onderdeel.' });
    evenementId = await evenementVan(env, def.ouder.soort, ouderId);
    await controleerToegang(env, g, evenementId, true);
  } else if (!heeftRecht(g, 'evenementen.aanmaken')) {
    throw new DbFout('GEEN_TOEGANG');
  }
  const waarden = await zetWaardenOm(env, def, invoer ?? {}, true, evenementId);
  const id = crypto.randomUUID();
  const kol: Record<string, unknown> = { [def.id]: id, ...waarden };
  if (def.ouder) kol[def.ouder.kolom] = ouderId;
  if (def.gewijzigd) kol.created_by = g.gebruikerId;
  const namen = Object.keys(kol);
  try {
    await env.DB.batch([
      env.DB.prepare(`insert into ${def.tabel} (${namen.join(', ')}) values (${namen.map(() => '?').join(', ')})`).bind(...namen.map((k) => kol[k])),
      audit(env, g, def.tabel, id, 'AANMAKEN', waarden, ip),
    ]);
  } catch (e) {
    vertaalSchemaFout(e);
  }
  return { id };
}

export async function verwijder(env: Env, g: Gebruiker, soort: Soort, id: string, ip: string | null) {
  if (soort === 'evenement') throw new DbFout('GEEN_TOEGANG'); // te ingrijpend: zet de status op gearchiveerd
  const def = SCHEMA[soort];
  const evenementId = await evenementVan(env, soort, id);
  await controleerToegang(env, g, evenementId, true);
  try {
    await env.DB.batch([
      env.DB.prepare(`delete from ${def.tabel} where ${def.id} = ?`).bind(id),
      audit(env, g, def.tabel, id, 'VERWIJDEREN', undefined, ip),
    ]);
  } catch (e) {
    vertaalSchemaFout(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Logo (R2). Enkel PNG, JPEG en WebP: geen SVG (kan scripts bevatten).
// ---------------------------------------------------------------------------
const LOGO_MAX = 500 * 1024;
const LOGO_TYPES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // 'RIFF' … 'WEBP'
};

export async function bewaarLogo(env: Env, g: Gebruiker, evenementId: string, request: Request, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const fout = (m: string) => new ValidatieFout({ logo: m });
  const handtekening = LOGO_TYPES[type];
  if (!handtekening) throw fout('Kies een PNG-, JPG- of WebP-bestand.');
  if (Number(request.headers.get('Content-Length') ?? 0) > LOGO_MAX) throw fout('Het bestand is groter dan 500 kB.');
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.length > LOGO_MAX) throw fout('Het bestand is groter dan 500 kB.');
  const webpOk = type !== 'image/webp' || String.fromCharCode(...data.slice(8, 12)) === 'WEBP';
  if (data.length < 12 || !handtekening.every((b, i) => data[i] === b) || !webpOk) throw fout('Dit bestand is geen geldige afbeelding.');

  await env.STORAGE.put(`logos/${evenementId}`, data, { httpMetadata: { contentType: type } });
  const logo = `/api/logo/${evenementId}?v=${Date.now()}`; // ?v= zodat browsers het nieuwe logo meteen tonen
  await env.DB.batch([
    env.DB.prepare(`update evenementen set logo = ?, modified_by = ?, modified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where evenement_id = ?`).bind(logo, g.gebruikerId, evenementId),
    audit(env, g, 'evenementen', evenementId, 'LOGO', { bytes: data.length, type }, ip),
  ]);
  return { logo };
}

export async function verwijderLogo(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  await env.STORAGE.delete(`logos/${evenementId}`);
  await env.DB.batch([
    env.DB.prepare(`update evenementen set logo = null where evenement_id = ?`).bind(evenementId),
    audit(env, g, 'evenementen', evenementId, 'LOGO_VERWIJDERD', undefined, ip),
  ]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Kopiëren naar andere momenten
// ---------------------------------------------------------------------------
/** Kolommen van een lesje die mee gekopieerd worden (alles uit het schema, zonder id's en tellingen). */
const SESSIE_KOLOMMEN = SCHEMA.sessie.velden.map((v) => v.naam);

/** Alle records moeten bij één evenement horen, waarop de gebruiker schrijfrechten heeft. */
async function zelfdeEvenement(env: Env, g: Gebruiker, delen: [Soort, string[]][]): Promise<string> {
  const ids = await Promise.all(delen.flatMap(([soort, lijst]) => lijst.map((id) => evenementVan(env, soort, id))));
  const evenementId = ids[0];
  if (!evenementId || ids.some((e) => e !== evenementId)) throw new DbFout('GEEN_TOEGANG');
  await controleerToegang(env, g, evenementId, true);
  return evenementId;
}

/**
 * Kopieert lesjes naar andere tijdsblokken (bv. Keuzelesje 1 → Keuzelesje 2, of naar de tweede dag).
 * Een lesje met dezelfde code of titel in het doelblok wordt overgeslagen, zodat opnieuw kopiëren geen dubbels geeft.
 */
export async function kopieerSessies(env: Env, g: Gebruiker, sessieIds: string[], naarTijdsblokIds: string[], ip: string | null) {
  await zelfdeEvenement(env, g, [['sessie', sessieIds], ['tijdsblok', naarTijdsblokIds]]);
  const db = env.DB;
  const lijst = (n: number) => Array(n).fill('?').join(', ');
  const [bron, doel] = await db.batch<any>([
    db.prepare(`select sessie_id, tijdsblok_id, code, titel from sessies where sessie_id in (${lijst(sessieIds.length)})`).bind(...sessieIds),
    db.prepare(
      `select t.tijdsblok_id, t.naam, s.code, s.titel from tijdsblokken t left join sessies s on s.tijdsblok_id = t.tijdsblok_id
       where t.tijdsblok_id in (${lijst(naarTijdsblokIds.length)})`,
    ).bind(...naarTijdsblokIds),
  ]);
  const gelijk = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const stmts: D1PreparedStatement[] = [];
  const overgeslagen: { titel: string; tijdsblok: string }[] = [];
  for (const t of naarTijdsblokIds) {
    const bestaand = doel.results.filter((r: any) => r.tijdsblok_id === t);
    for (const s of bron.results as any[]) {
      if (s.tijdsblok_id === t) continue;
      if (bestaand.some((b: any) => gelijk(b.code, s.code) || gelijk(b.titel, s.titel))) {
        overgeslagen.push({ titel: s.titel, tijdsblok: bestaand[0]?.naam ?? '' });
        continue;
      }
      const id = crypto.randomUUID();
      stmts.push(
        db.prepare(
          `insert into sessies (sessie_id, tijdsblok_id, created_by, ${SESSIE_KOLOMMEN.join(', ')})
           select ?, ?, ?, ${SESSIE_KOLOMMEN.join(', ')} from sessies where sessie_id = ?`,
        ).bind(id, t, g.gebruikerId, s.sessie_id),
        audit(env, g, 'sessies', id, 'KOPIEREN', { van: s.sessie_id, naar: t }, ip),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { gekopieerd: stmts.length / 2, overgeslagen };
}

/** Kopieert een moment (dagdeel) met al zijn tijdsblokken en lesjes naar andere dagen. */
export async function kopieerDagdeel(env: Env, g: Gebruiker, dagdeelId: string, naarDagIds: string[], ip: string | null) {
  await zelfdeEvenement(env, g, [['dagdeel', [dagdeelId]], ['dag', naarDagIds]]);
  const db = env.DB;
  const [blokken, sessies] = await db.batch<any>([
    db.prepare(`select tijdsblok_id from tijdsblokken where dagdeel_id = ?`).bind(dagdeelId),
    db.prepare(`select s.sessie_id, s.tijdsblok_id from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id where t.dagdeel_id = ?`).bind(dagdeelId),
  ]);
  const stmts: D1PreparedStatement[] = [];
  for (const dag of naarDagIds) {
    const nieuwDagdeel = crypto.randomUUID();
    stmts.push(
      db.prepare(
        `insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, capaciteit, volgorde, status)
         select ?, ?, naam, start_uur, eind_uur, capaciteit, volgorde, status from dagdelen where dagdeel_id = ?`,
      ).bind(nieuwDagdeel, dag, dagdeelId),
      audit(env, g, 'dagdelen', nieuwDagdeel, 'KOPIEREN', { van: dagdeelId, naar: dag }, ip),
    );
    for (const t of blokken.results as { tijdsblok_id: string }[]) {
      const nieuwBlok = crypto.randomUUID();
      stmts.push(
        db.prepare(
          `insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht)
           select ?, ?, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht from tijdsblokken where tijdsblok_id = ?`,
        ).bind(nieuwBlok, nieuwDagdeel, t.tijdsblok_id),
      );
      for (const s of (sessies.results as { sessie_id: string; tijdsblok_id: string }[]).filter((x) => x.tijdsblok_id === t.tijdsblok_id)) {
        stmts.push(
          db.prepare(
            `insert into sessies (sessie_id, tijdsblok_id, created_by, ${SESSIE_KOLOMMEN.join(', ')})
             select ?, ?, ?, ${SESSIE_KOLOMMEN.join(', ')} from sessies where sessie_id = ?`,
          ).bind(crypto.randomUUID(), nieuwBlok, g.gebruikerId, s.sessie_id),
        );
      }
    }
  }
  await db.batch(stmts);
  return { gekopieerd: naarDagIds.length };
}
