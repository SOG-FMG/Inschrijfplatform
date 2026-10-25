import { blindeIndex, ontsleutel, versleutel } from '../crypto/versleuteling';
import type { Env } from '../types';
import { ValidatieFout } from '../validatie';
import type { Module } from './module';

/**
 * Contacten en personen (kern). Eén contact per e-mailadres; personen (bv. kinderen) horen bij een contact
 * en worden binnen dat contact herkend aan hun naam. Zie migrations/0009_kern_contacten.sql.
 *
 *   zelfde naam (woordvolgorde, hoofdletters, accenten tellen niet)  → zelfde persoon
 *   bijna dezelfde naam (tikfout, enkel de voornaam ...)             → twijfel: nieuwe persoon met mogelijk_dubbel_van
 *   andere naam                                                      → nieuwe persoon bij hetzelfde contact
 */

/** "Robin  Verlet", "verlet robin", "Verlet, Robin" → "robin verlet". */
export function normaliseerNaam(...delen: (string | null | undefined)[]): string {
  return delen
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export const naamSleutel = (env: Env, voornaam?: string | null, naam?: string | null) => blindeIndex(env, 'naam', normaliseerNaam(voornaam, naam));
export const emailSleutel = (env: Env, email: string) => blindeIndex(env, 'email', email.trim().toLowerCase());

function afstand(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let vorige = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, vorige + (a[i - 1] === b[j - 1] ? 0 : 1));
      vorige = tmp;
    }
  }
  return d[b.length];
}

/** Twee genormaliseerde namen die verschillen, maar waarschijnlijk dezelfde persoon zijn. */
export function lijktOp(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  if (afstand(a, b) <= 2) return true;
  const [wa, wb] = [a.split(' '), b.split(' ')];
  const [kort, lang] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return kort.every((w) => lang.includes(w)); // bv. enkel de voornaam, of een extra (tweede) voornaam
}

export interface Persoon {
  persoonId: string;
  contactId: string;
  voornaam: string | null;
  naam: string | null;
  sleutel: string;
}

export type Herkenning =
  | { status: 'zelfde'; persoonId: string; kandidaten: Persoon[] }
  | { status: 'twijfel'; kandidaten: Persoon[] }
  | { status: 'nieuw'; kandidaten: Persoon[] };

/** Herkent een naam tussen de personen van één contact. */
export function herken(personen: Persoon[], voornaam: string | null | undefined, naam: string | null | undefined, sleutel: string): Herkenning {
  const zelfde = personen.find((p) => p.sleutel === sleutel);
  if (zelfde) return { status: 'zelfde', persoonId: zelfde.persoonId, kandidaten: [zelfde] };
  const norm = normaliseerNaam(voornaam, naam);
  const kandidaten = personen.filter((p) => lijktOp(norm, normaliseerNaam(p.voornaam, p.naam)));
  return kandidaten.length ? { status: 'twijfel', kandidaten } : { status: 'nieuw', kandidaten: [] };
}

/** Contacten op e-mailadres (sleutel = blinde index). */
export async function contactenOpSleutel(env: Env, sleutels: string[]): Promise<Map<string, string>> {
  const uit = new Map<string, string>();
  for (let i = 0; i < sleutels.length; i += 400) {
    const { results } = await env.DB.prepare(`select contact_id, email_hash from contacten where email_hash in (select value from json_each(?))`)
      .bind(JSON.stringify(sleutels.slice(i, i + 400)))
      .all<{ contact_id: string; email_hash: string }>();
    for (const r of results) uit.set(r.email_hash, r.contact_id);
  }
  return uit;
}

/** Personen van deze contacten, met ontsleutelde namen (enkel voor herkennen en voor de beheerder). */
export async function personenVan(env: Env, contactIds: string[]): Promise<Map<string, Persoon[]>> {
  const uit = new Map<string, Persoon[]>();
  for (let i = 0; i < contactIds.length; i += 400) {
    const { results } = await env.DB.prepare(
      `select persoon_id, contact_id, voornaam_enc, naam_enc, naam_sleutel from personen where contact_id in (select value from json_each(?))`,
    )
      .bind(JSON.stringify(contactIds.slice(i, i + 400)))
      .all<{ persoon_id: string; contact_id: string; voornaam_enc: string | null; naam_enc: string | null; naam_sleutel: string }>();
    for (const r of results) {
      const lijst = uit.get(r.contact_id) ?? [];
      lijst.push({
        persoonId: r.persoon_id,
        contactId: r.contact_id,
        // Onleesbaar (bv. een andere sleutel): de persoon blijft herkenbaar via naam_sleutel, enkel zonder naam.
        voornaam: await ontsleutel(env, r.voornaam_enc).catch(() => null),
        naam: await ontsleutel(env, r.naam_enc).catch(() => '(onleesbaar)'),
        sleutel: r.naam_sleutel,
      });
      uit.set(r.contact_id, lijst);
    }
  }
  return uit;
}

export interface ContactGegevens {
  email: string;
  voornaam?: string | null;
  naam?: string | null;
  telefoon?: string | null;
}

/** Zoekt of maakt het contact; ingevulde gegevens overschrijven de vorige (de laatste zijn het meest actueel). */
export async function bewaarContact(env: Env, c: ContactGegevens): Promise<string> {
  const sleutel = await emailSleutel(env, c.email);
  const enc = {
    email: await versleutel(env, c.email.trim().toLowerCase()),
    voornaam: await versleutel(env, c.voornaam || null),
    naam: await versleutel(env, c.naam || null),
    telefoon: await versleutel(env, c.telefoon || null),
  };
  // Eén instructie, ook bij twee gelijktijdige aanvragen: de unieke index op email_hash beslist.
  const r = await env.DB.prepare(
    `insert into contacten (contact_id, email_hash, email_enc, voornaam_enc, naam_enc, telefoon_enc) values (?1, ?2, ?3, ?4, ?5, ?6)
     on conflict (email_hash) do update set
       voornaam_enc = coalesce(excluded.voornaam_enc, voornaam_enc),
       naam_enc = coalesce(excluded.naam_enc, naam_enc),
       telefoon_enc = coalesce(excluded.telefoon_enc, telefoon_enc),
       gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     returning contact_id`,
  )
    .bind(crypto.randomUUID(), sleutel, enc.email, enc.voornaam, enc.naam, enc.telefoon)
    .first<{ contact_id: string }>();
  return r!.contact_id;
}

/** Naam en telefoon bijwerken (niet het e-mailadres: dat bepaalt welk contact het is). */
export async function werkContactBij(env: Env, contactId: string, c: Omit<ContactGegevens, 'email'>) {
  await env.DB.prepare(
    `update contacten set voornaam_enc = coalesce(?, voornaam_enc), naam_enc = coalesce(?, naam_enc), telefoon_enc = coalesce(?, telefoon_enc),
       gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where contact_id = ?`,
  )
    .bind(await versleutel(env, c.voornaam || null), await versleutel(env, c.naam || null), await versleutel(env, c.telefoon || null), contactId)
    .run();
}

export async function nieuwePersoonStmt(env: Env, contactId: string, voornaam: string | null, naam: string | null, mogelijkDubbelVan?: string | null) {
  const persoonId = crypto.randomUUID();
  const stmt = env.DB.prepare(
    `insert into personen (persoon_id, contact_id, voornaam_enc, naam_enc, naam_sleutel, mogelijk_dubbel_van) values (?, ?, ?, ?, ?, ?)`,
  ).bind(persoonId, contactId, await versleutel(env, voornaam), await versleutel(env, naam), await naamSleutel(env, voornaam, naam), mogelijkDubbelVan ?? null);
  return { persoonId, stmt };
}

/**
 * Koppelt een inschrijving aan contact en persoon (voor het publieke formulier: niemand om te vragen,
 * dus bij twijfel een nieuwe persoon met mogelijk_dubbel_van, die een beheerder later samenvoegt).
 */
export async function koppelAanContact(
  env: Env,
  contact: ContactGegevens,
  persoon: { voornaam: string; naam: string },
  /** Vast contact (via een uitnodiging): ook als het e-mailadres in het formulier gewijzigd werd. */
  vastContactId?: string,
): Promise<{ contactId: string; persoonId: string }> {
  const contactId = vastContactId ?? (await bewaarContact(env, contact));
  if (vastContactId) await werkContactBij(env, vastContactId, contact);
  const personen = (await personenVan(env, [contactId])).get(contactId) ?? [];
  const h = herken(personen, persoon.voornaam, persoon.naam, await naamSleutel(env, persoon.voornaam, persoon.naam));
  if (h.status === 'zelfde') return { contactId, persoonId: h.persoonId };
  const nieuw = await nieuwePersoonStmt(env, contactId, persoon.voornaam, persoon.naam, h.status === 'twijfel' ? h.kandidaten[0].persoonId : null);
  await nieuw.stmt.run();
  return { contactId, persoonId: nieuw.persoonId };
}

/** Ontsleutelde gegevens van een contact (voor een vooraf ingevuld formulier en voor mails). */
export async function leesContact(env: Env, contactId: string) {
  const r = await env.DB.prepare(`select email_enc, voornaam_enc, naam_enc, telefoon_enc from contacten where contact_id = ?`)
    .bind(contactId)
    .first<{ email_enc: string; voornaam_enc: string | null; naam_enc: string | null; telefoon_enc: string | null }>();
  if (!r) return null;
  return {
    email: (await ontsleutel(env, r.email_enc)) ?? '',
    voornaam: await ontsleutel(env, r.voornaam_enc),
    naam: await ontsleutel(env, r.naam_enc),
    telefoon: await ontsleutel(env, r.telefoon_enc),
  };
}

// ---------------------------------------------------------------------------
// Een heel bestand tegelijk herkennen en bewaren (imports: voorinschrijvingen, inschrijvingen van vorige jaren)
// ---------------------------------------------------------------------------

/** Eén rij van een import: het contactadres (geldig en in kleine letters, of null) en de naam van de persoon. */
export interface PersoonInvoer {
  email: string | null;
  voornaam: string | null;
  naam: string | null;
  /** Bij een twijfel: id van de bestaande persoon, 'rij:<n>' (persoon van een eerdere rij in dit bestand) of 'nieuw'. */
  persoonKeuze?: string | null;
}

export interface RijPlan {
  contact: 'nieuw' | 'bestaand' | 'geen';
  status: 'zelfde' | 'twijfel' | 'nieuw' | 'geen';
  /** Kandidaten bij twijfel: bestaande personen, of 'rij:<n>' voor een persoon van een eerdere rij in dit bestand. */
  kandidaten: { id: string; naam: string }[];
  /** Uiteindelijke keuze (na persoonKeuze): bestaande persoon, 'rij:<n>', of 'nieuw'. */
  persoon?: string;
  sleutel?: string;
  emailSleutel?: string;
}

const volledigeNaam = (p: { voornaam: string | null; naam: string | null }) => [p.voornaam, p.naam].filter(Boolean).join(' ');

/**
 * Per rij: nieuw of bestaand contact, en zelfde, twijfel of nieuwe persoon (dezelfde regels als herken()).
 * Personen die het bestand zelf aanmaakt, tellen mee voor de volgende rijen (bv. twee keer hetzelfde kind).
 * Met `metKeuzes` moet elke twijfel een persoonKeuze hebben (de nakijkstap in het dashboard).
 */
export async function planPersonen(env: Env, rijen: PersoonInvoer[], metKeuzes: boolean): Promise<RijPlan[]> {
  const sleutels = await Promise.all(rijen.map((r) => (r.email ? emailSleutel(env, r.email) : null)));
  const contacten = await contactenOpSleutel(env, [...new Set(sleutels.filter((s): s is string => !!s))]);
  const personen = await personenVan(env, [...contacten.values()]);
  const nieuwInBestand = new Map<string, Persoon[]>();

  const uit: RijPlan[] = [];
  for (let i = 0; i < rijen.length; i++) {
    const { voornaam, naam, persoonKeuze } = rijen[i];
    const es = sleutels[i];
    if (!es) {
      uit.push({ contact: 'geen', status: 'geen', kandidaten: [] });
      continue;
    }
    const contactId = contacten.get(es);
    if (!voornaam && !naam) {
      uit.push({ contact: contactId ? 'bestaand' : 'nieuw', status: 'geen', kandidaten: [], emailSleutel: es });
      continue;
    }
    const sleutel = await naamSleutel(env, voornaam, naam);
    const kandidaten = [...(contactId ? personen.get(contactId) ?? [] : []), ...(nieuwInBestand.get(es) ?? [])];
    const h = herken(kandidaten, voornaam, naam, sleutel);
    const p: RijPlan = {
      contact: contactId ? 'bestaand' : 'nieuw',
      status: h.status,
      kandidaten: h.kandidaten.map((k) => ({ id: k.persoonId, naam: volledigeNaam(k) })),
      sleutel,
      emailSleutel: es,
    };
    if (h.status === 'zelfde') p.persoon = h.persoonId;
    else if (h.status === 'nieuw') p.persoon = 'nieuw';
    else if (metKeuzes) {
      if (persoonKeuze === 'nieuw' || (persoonKeuze && h.kandidaten.some((x) => x.persoonId === persoonKeuze))) p.persoon = persoonKeuze;
      else throw new ValidatieFout({ rijen: `Rij ${i + 1}: kies of dit hetzelfde kind is of een ander kind.` });
    }
    if (p.persoon === 'nieuw') {
      const lijst = nieuwInBestand.get(es) ?? [];
      lijst.push({ persoonId: `rij:${i}`, contactId: '', voornaam, naam, sleutel });
      nieuwInBestand.set(es, lijst);
    }
    uit.push(p);
  }
  return uit;
}

/** Wat een import per rij over het contact weet (naast het e-mailadres uit PersoonInvoer). */
export interface ContactInvoer {
  telefoon?: string | null;
  /** Naam van het contact zelf (bv. de ouder), niet van de persoon. */
  contactVoornaam?: string | null;
  contactNaam?: string | null;
}

const perDeel = <T>(lijst: T[], n: number) => Array.from({ length: Math.ceil(lijst.length / n) }, (_, i) => lijst.slice(i * n, i * n + n));

/**
 * Instructies om de contacten en nieuwe personen van een geplande import te bewaren (om in de batch van de import
 * op te nemen: alles of niets). Eén contact per e-mailadres; de laatst ingevulde gegevens tellen.
 * Rijen als JSON (json_each), zodat ook duizenden rijen weinig instructies vragen.
 */
export async function bewaarPersonenStmts(env: Env, rijen: (PersoonInvoer & ContactInvoer)[], plannen: RijPlan[]) {
  const bestaand = await contactenOpSleutel(env, [...new Set(plannen.map((p) => p.emailSleutel).filter((s): s is string => !!s))]);
  const contactPer = new Map<string, { id: string; email: string; telefoon: string | null; voornaam: string | null; naam: string | null }>();
  rijen.forEach((r, i) => {
    const es = plannen[i].emailSleutel;
    if (!es || !r.email) return;
    const vorige = contactPer.get(es);
    contactPer.set(es, {
      id: bestaand.get(es) ?? vorige?.id ?? crypto.randomUUID(),
      email: r.email,
      telefoon: r.telefoon ?? vorige?.telefoon ?? null,
      voornaam: r.contactVoornaam ?? vorige?.voornaam ?? null,
      naam: r.contactNaam ?? vorige?.naam ?? null,
    });
  });
  const contactRijen = [];
  for (const [es, c] of contactPer) {
    contactRijen.push({
      id: c.id, sleutel: es, email: await versleutel(env, c.email), tel: await versleutel(env, c.telefoon),
      voornaam: await versleutel(env, c.voornaam), naam: await versleutel(env, c.naam),
    });
  }

  const persoonVanRij = new Map<number, string>();
  const persoonRijen = [];
  const contactIds: (string | null)[] = [];
  const persoonIds: (string | null)[] = [];
  for (let i = 0; i < rijen.length; i++) {
    const p = plannen[i];
    const contactId = p.emailSleutel ? contactPer.get(p.emailSleutel)?.id ?? null : null;
    let persoonId: string | null = null;
    if (p.persoon === 'nieuw' && contactId) {
      persoonId = crypto.randomUUID();
      persoonVanRij.set(i, persoonId);
      persoonRijen.push({
        id: persoonId, contact: contactId, sleutel: p.sleutel,
        voornaam: await versleutel(env, rijen[i].voornaam), naam: await versleutel(env, rijen[i].naam),
      });
    } else if (p.persoon?.startsWith('rij:')) persoonId = persoonVanRij.get(Number(p.persoon.slice(4))) ?? null;
    else if (p.persoon) persoonId = p.persoon;
    contactIds.push(contactId);
    persoonIds.push(persoonId);
  }

  const v = (veld: string) => `json_extract(j.value, '$.${veld}')`;
  const stmts: D1PreparedStatement[] = [];
  for (const deel of perDeel(contactRijen, 400)) {
    stmts.push(
      env.DB.prepare(
        `insert into contacten (contact_id, email_hash, email_enc, telefoon_enc, voornaam_enc, naam_enc)
         select ${v('id')}, ${v('sleutel')}, ${v('email')}, ${v('tel')}, ${v('voornaam')}, ${v('naam')} from json_each(?) j where true
         on conflict (email_hash) do update set telefoon_enc = coalesce(excluded.telefoon_enc, telefoon_enc),
           voornaam_enc = coalesce(excluded.voornaam_enc, voornaam_enc), naam_enc = coalesce(excluded.naam_enc, naam_enc),
           gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).bind(JSON.stringify(deel)),
    );
  }
  for (const deel of perDeel(persoonRijen, 400)) {
    stmts.push(
      env.DB.prepare(
        `insert into personen (persoon_id, contact_id, voornaam_enc, naam_enc, naam_sleutel)
         select ${v('id')}, ${v('contact')}, ${v('voornaam')}, ${v('naam')}, ${v('sleutel')} from json_each(?) j`,
      ).bind(JSON.stringify(deel)),
    );
  }
  const bestaandeIds = new Set(bestaand.values());
  return {
    stmts,
    contactIds,
    persoonIds,
    aantalContacten: contactRijen.length,
    nieuweContacten: contactRijen.filter((c) => !bestaandeIds.has(c.id)).length,
    nieuwePersonen: persoonRijen.length,
  };
}

const NAAM = /^[a-z_][a-z0-9_]*$/;

/**
 * Dagelijks: personen en contacten waar geen enkele module nog naar verwijst (bv. na het anonimiseren van een
 * evenement of een import), worden verwijderd. Welke kolommen verwijzen, staat in de manifesten (persoonsverwijzingen).
 */
export async function ruimContactenOp(env: Env, modules: Module[]): Promise<number> {
  const verwijzingen = modules.flatMap((m) => m.persoonsverwijzingen ?? []);
  for (const v of verwijzingen) {
    if (![v.tabel, v.persoon, v.contact].every((x) => x === undefined || NAAM.test(x))) throw new Error(`Ongeldige persoonsverwijzing ${JSON.stringify(v)}.`);
  }
  const persoonIn = verwijzingen.filter((v) => v.persoon).map((v) => `exists (select 1 from ${v.tabel} t where t.${v.persoon} = p.persoon_id)`);
  const contactIn = verwijzingen.filter((v) => v.contact).map((v) => `exists (select 1 from ${v.tabel} t where t.${v.contact} = c.contact_id)`);
  const [personen, contacten] = await env.DB.batch([
    env.DB.prepare(`delete from personen as p where not (${persoonIn.join(' or ') || '0'})`),
    env.DB.prepare(
      `delete from contacten as c where not exists (select 1 from personen p where p.contact_id = c.contact_id)
         and not (${contactIn.join(' or ') || '0'})`,
    ),
  ]);
  return personen.meta.changes + contacten.meta.changes;
}
