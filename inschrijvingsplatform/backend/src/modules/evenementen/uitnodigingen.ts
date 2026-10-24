import { ontsleutel, sha256, versleutel } from '../../crypto/versleuteling';
import { leesContact, personenVan } from '../../kern/contacten';
import { DbFout } from '../../kern/fouten';
import { nieuwToken } from '../../kern/http';
import type { Env } from '../../types';

/**
 * Uitnodigingen: een persoonlijke link naar het vooraf ingevulde formulier van een evenement, per persoon (kind),
 * of per contact ("een ander kind inschrijven"). Enkel de hash van de token dient om op te zoeken; de versleutelde
 * token laat toe dezelfde link opnieuw te sturen in een herinnering. Zie migraties/contacten.sql.
 */

export interface Voorinvullen {
  schoolId?: string | null;
  schoolAndere?: string | null;
  leerjaar?: string | null;
}

interface UitnodigingRij {
  uitnodiging_id: string;
  evenement_id: string;
  contact_id: string;
  persoon_id: string | null;
  voorinvullen_enc: string | null;
  verloopt_op: string;
  status: 'aangemaakt' | 'verstuurd' | 'gebruikt' | 'afgemeld';
}

async function zoek(env: Env, token: string) {
  return env.DB.prepare(
    `select uitnodiging_id, evenement_id, contact_id, persoon_id, voorinvullen_enc, verloopt_op, status from uitnodigingen where token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<UitnodigingRij>();
}

/** Voor het inschrijven: de uitnodiging moet bij dit evenement horen, geldig en (per kind) nog niet gebruikt zijn. */
export async function geldigeUitnodiging(env: Env, token: string, evenementId: string) {
  const u = await zoek(env, token);
  if (!u || u.evenement_id !== evenementId || Date.parse(u.verloopt_op) < Date.now() || u.status === 'afgemeld') throw new DbFout('UITNODIGING_ONGELDIG');
  if (u.persoon_id && u.status === 'gebruikt') throw new DbFout('UITNODIGING_GEBRUIKT');
  return { uitnodigingId: u.uitnodiging_id, contactId: u.contact_id, persoonId: u.persoon_id };
}

/** Wat het formulier vooraf invult. Enkel met de link; een verlopen of onbekende link geeft niets prijs. */
export async function voorinvulling(env: Env, token: string) {
  const u = await zoek(env, token);
  if (!u || Date.parse(u.verloopt_op) < Date.now()) throw new DbFout('UITNODIGING_ONGELDIG');
  const ev = await env.DB.prepare(`select slug, titel from evenementen where evenement_id = ?`).bind(u.evenement_id).first<{ slug: string; titel: string }>();
  const contact = await leesContact(env, u.contact_id);
  if (!ev || !contact) throw new DbFout('UITNODIGING_ONGELDIG');
  const persoon = u.persoon_id ? (await personenVan(env, [u.contact_id])).get(u.contact_id)?.find((p) => p.persoonId === u.persoon_id) : null;
  const extra: Voorinvullen = JSON.parse((await ontsleutel(env, u.voorinvullen_enc)) ?? '{}');
  const school = extra.schoolId
    ? await env.DB.prepare(`select school_id as id, naam, gemeente from scholen where school_id = ?`).bind(extra.schoolId).first()
    : null;
  return {
    slug: ev.slug,
    evenement: ev.titel,
    status: u.status,
    // Gebruikt door dit kind: niets meer invullen, de persoonlijke link uit de bevestigingsmail volstaat.
    ...(u.persoon_id && u.status === 'gebruikt'
      ? {}
      : {
          contact: { email: contact.email, voornaam: contact.voornaam, naam: contact.naam, telefoon: contact.telefoon },
          persoon: persoon ? { voornaam: persoon.voornaam, naam: persoon.naam } : null,
          school,
          schoolAndere: extra.schoolAndere ?? null,
          leerjaar: extra.leerjaar ?? null,
        }),
  };
}

/** "Dit kind komt niet": geen herinneringen meer voor dit kind en dit evenement. */
export async function meldAf(env: Env, token: string) {
  const u = await zoek(env, token);
  if (!u || !u.persoon_id || Date.parse(u.verloopt_op) < Date.now()) throw new DbFout('UITNODIGING_ONGELDIG');
  if (u.status === 'gebruikt') throw new DbFout('UITNODIGING_GEBRUIKT');
  await env.DB.prepare(`update uitnodigingen set status = 'afgemeld' where uitnodiging_id = ?`).bind(u.uitnodiging_id).run();
  return { ok: true };
}

export const markeerGebruiktStmt = (env: Env, uitnodigingId: string, deelnemerId: string) =>
  env.DB.prepare(`update uitnodigingen set status = 'gebruikt', deelnemer_id = ? where uitnodiging_id = ? and persoon_id is not null`).bind(deelnemerId, uitnodigingId);

export interface NieuweUitnodiging {
  contactId: string;
  persoonId: string | null;
  voorinvullen?: Voorinvullen;
  bron: string;
}

/**
 * Maakt uitnodigingen aan die nog niet bestaan (per evenement, contact en persoon één uitnodiging).
 * Geldig tot het einde van de inschrijfperiode (of de laatste dag van het evenement).
 */
export async function maakUitnodigingen(env: Env, evenementId: string, lijst: NieuweUitnodiging[]): Promise<number> {
  const ev = await env.DB.prepare(`select coalesce(inschrijving_tot, eind_datum || 'T23:59:59Z') as tot from evenementen where evenement_id = ?`)
    .bind(evenementId)
    .first<{ tot: string }>();
  if (!ev) throw new DbFout('EVENEMENT_NIET_GEVONDEN');
  let nieuw = 0;
  for (let i = 0; i < lijst.length; i += 50) {
    const stmts = [];
    for (const u of lijst.slice(i, i + 50)) {
      const token = nieuwToken();
      stmts.push(
        env.DB.prepare(
          `insert or ignore into uitnodigingen (uitnodiging_id, evenement_id, contact_id, persoon_id, token_hash, token_enc, voorinvullen_enc, bron, verloopt_op)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), evenementId, u.contactId, u.persoonId, await sha256(token), await versleutel(env, token),
          await versleutel(env, JSON.stringify(u.voorinvullen ?? {})), u.bron, ev.tot),
      );
    }
    const res = await env.DB.batch(stmts);
    nieuw += res.reduce((n, r) => n + r.meta.changes, 0);
  }
  return nieuw;
}

export interface TeVersturen {
  contactId: string;
  uitnodigingIds: string[];
  email: string;
  voornaam: string | null;
  /** Per kind (persoon) en één voor "een ander kind" (persoon null). */
  links: { persoonId: string | null; voornaam: string | null; naam: string | null; token: string }[];
}

/**
 * Contacten om te mailen voor dit evenement en deze bron: bij een eerste uitnodiging wie nog niets kreeg,
 * bij een herinnering wie al een uitnodiging kreeg en voor minstens één kind nog niet reageerde.
 * Kinderen die ingeschreven of afgemeld zijn, staan niet meer in de mail.
 */
const WIE_TE_VERSTUREN = `evenement_id = ?1 and bron = ?2 and persoon_id is not null
       and not exists (select 1 from deelnemers d where d.evenement_id = u.evenement_id and d.persoon_id = u.persoon_id and d.status = 'actief')
       and status = case when ?3 = 'uitnodiging' then 'aangemaakt' else 'verstuurd' end
       and (?3 = 'uitnodiging' or laatst_verstuurd_op < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour'))`;

/** Aantal contacten dat nog een mail moet krijgen. */
export async function aantalTeVersturen(env: Env, evenementId: string, bron: string, soort: 'uitnodiging' | 'herinnering'): Promise<number> {
  const r = await env.DB.prepare(`select count(distinct contact_id) as n from uitnodigingen u where ${WIE_TE_VERSTUREN}`)
    .bind(evenementId, bron, soort)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function teVersturen(env: Env, evenementId: string, bron: string, soort: 'uitnodiging' | 'herinnering', max: number): Promise<TeVersturen[]> {
  const { results } = await env.DB.prepare(
    `select distinct contact_id from uitnodigingen u
     where ${WIE_TE_VERSTUREN}
     limit ?4`,
  )
    .bind(evenementId, bron, soort, max)
    .all<{ contact_id: string }>();
  const contactIds = results.map((r) => r.contact_id);
  if (!contactIds.length) return [];
  const { results: rijen } = await env.DB.prepare(
    `select uitnodiging_id, contact_id, persoon_id, token_enc, status from uitnodigingen u
     where evenement_id = ? and contact_id in (select value from json_each(?))
       and (persoon_id is null or (status in ('aangemaakt', 'verstuurd') and not exists (select 1 from deelnemers d where d.evenement_id = u.evenement_id and d.persoon_id = u.persoon_id and d.status = 'actief')))`,
  )
    .bind(evenementId, JSON.stringify(contactIds))
    .all<{ uitnodiging_id: string; contact_id: string; persoon_id: string | null; token_enc: string; status: string }>();
  const personen = await personenVan(env, contactIds);
  const uit: TeVersturen[] = [];
  for (const contactId of contactIds) {
    const contact = await leesContact(env, contactId);
    if (!contact?.email) continue;
    const eigen = rijen.filter((r) => r.contact_id === contactId);
    const links = [];
    for (const r of eigen) {
      const p = r.persoon_id ? personen.get(contactId)?.find((x) => x.persoonId === r.persoon_id) : null;
      links.push({ persoonId: r.persoon_id, voornaam: p?.voornaam ?? null, naam: p?.naam ?? null, token: (await ontsleutel(env, r.token_enc))! });
    }
    uit.push({ contactId, uitnodigingIds: eigen.map((r) => r.uitnodiging_id), email: contact.email, voornaam: contact.voornaam, links });
  }
  return uit;
}

export async function markeerVerstuurd(env: Env, uitnodigingIds: string[]) {
  if (!uitnodigingIds.length) return;
  await env.DB.prepare(
    `update uitnodigingen set status = case when status = 'aangemaakt' then 'verstuurd' else status end,
       aantal_verstuurd = aantal_verstuurd + 1, laatst_verstuurd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     where uitnodiging_id in (select value from json_each(?))`,
  )
    .bind(JSON.stringify(uitnodigingIds))
    .run();
}

/** Aantallen per status voor dit evenement en deze bron (enkel uitnodigingen per kind). */
export async function uitnodigingStatus(env: Env, evenementId: string, bron: string) {
  const { results } = await env.DB.prepare(
    `select status, count(*) as aantal from uitnodigingen where evenement_id = ? and bron = ? and persoon_id is not null group by status`,
  )
    .bind(evenementId, bron)
    .all<{ status: string; aantal: number }>();
  const telling = { aangemaakt: 0, verstuurd: 0, gebruikt: 0, afgemeld: 0 } as Record<string, number>;
  for (const r of results) telling[r.status] = r.aantal;
  return telling;
}
