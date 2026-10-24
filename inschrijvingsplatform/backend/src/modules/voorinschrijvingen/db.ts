import { blindeIndex, versleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';
import type { Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';

/** Eén rij zoals de frontend ze stuurt, na het koppelen van kolommen en scholen. */
export interface ImportRij {
  ingediendOp?: string | null;
  schooljaar?: string | null;
  klas?: string | null;
  schoolId?: string | null;
  schoolAndere?: string | null;
  kindNaam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  opmerkingen?: string | null;
}

export const MAX_RIJEN = 5000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const tekst = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function datum(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export async function importeer(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const naam = tekst(body?.naam, 120);
  const rijen: ImportRij[] = Array.isArray(body?.rijen) ? body.rijen : [];
  const fouten: Record<string, string> = {};
  if (!naam) fouten.naam = 'Geef de import een naam, bv. "Voorinschrijvingen 2025-2026".';
  if (!rijen.length) fouten.rijen = 'Er zijn geen rijen om te importeren.';
  if (rijen.length > MAX_RIJEN) fouten.rijen = `Maximaal ${MAX_RIJEN} rijen per import.`;
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);

  // Enkel scholen uit de officiële lijst.
  const schoolIds = [...new Set(rijen.map((r) => r.schoolId).filter((x): x is string => typeof x === 'string' && !!x))];
  const gekend = new Set<string>();
  for (let i = 0; i < schoolIds.length; i += 90) {
    const deel = schoolIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`select school_id from scholen where school_id in (${deel.map(() => '?').join(',')})`)
      .bind(...deel)
      .all<{ school_id: string }>();
    results.forEach((r) => gekend.add(r.school_id));
  }
  const onbekend = schoolIds.find((s) => !gekend.has(s));
  if (onbekend) throw new ValidatieFout({ rijen: 'Een gekozen school staat niet in de lijst. Vernieuw de pagina en probeer opnieuw.' });

  const importId = crypto.randomUUID();
  const klaar = [];
  for (const r of rijen) {
    const email = tekst(r.email, 254)?.toLowerCase() ?? null;
    const geldigEmail = email && EMAIL.test(email) ? email : null;
    klaar.push({
      id: crypto.randomUUID(),
      op: datum(r.ingediendOp),
      jaar: tekst(r.schooljaar, 60),
      klas: tekst(r.klas, 60),
      school: r.schoolId && gekend.has(r.schoolId) ? r.schoolId : null,
      andere: r.schoolId ? null : tekst(r.schoolAndere, 200),
      kind: await versleutel(env, tekst(r.kindNaam, 200)),
      email: await versleutel(env, email),
      tel: await versleutel(env, tekst(r.telefoon, 40)),
      opm: await versleutel(env, tekst(r.opmerkingen, 2000)),
      hash: geldigEmail ? await blindeIndex(env, 'email', geldigEmail) : null,
    });
  }

  // Rijen als JSON, ingevoegd met json_each: weinig query's, ook bij duizenden rijen. D1 voert de batch atomisch uit.
  const v = (veld: string) => `json_extract(j.value, '$.${veld}')`;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`insert into voorinschrijvingen_importen (import_id, naam, bestandsnaam, aantal, created_by) values (?, ?, ?, ?, ?)`)
      .bind(importId, naam, tekst(body?.bestandsnaam, 200), rijen.length, g.gebruikerId),
  ];
  for (let i = 0; i < klaar.length; i += 400) {
    stmts.push(
      env.DB.prepare(
        `insert into voorinschrijvingen (id, import_id, ingediend_op, schooljaar, klas, school_id, school_andere,
                                         kind_naam_enc, email_enc, telefoon_enc, opmerkingen_enc, email_hash)
         select ${v('id')}, ?1, ${v('op')}, ${v('jaar')}, ${v('klas')}, ${v('school')}, ${v('andere')},
                ${v('kind')}, ${v('email')}, ${v('tel')}, ${v('opm')}, ${v('hash')}
         from json_each(?2) j`,
      ).bind(importId, JSON.stringify(klaar.slice(i, i + 400))),
    );
  }
  stmts.push(audit(env, g, 'voorinschrijvingen_importen', importId, 'IMPORT', { rijen: rijen.length }, ip));
  await env.DB.batch(stmts);
  return { importId, aantal: rijen.length };
}

export async function importen(env: Env) {
  const { results } = await env.DB.prepare(
    `select import_id as id, naam, bestandsnaam, aantal, geanonimiseerd_op as geanonimiseerdOp, created_at as aangemaakt
     from voorinschrijvingen_importen order by created_at desc`,
  ).all();
  return results;
}

async function bestaat(env: Env, importId: string) {
  const r = await env.DB.prepare(`select 1 from voorinschrijvingen_importen where import_id = ?`).bind(importId).first();
  if (!r) throw new DbFout('IMPORT_NIET_GEVONDEN');
}

/** Wist alles wat naar een persoon wijst; schooljaar, klas, school en datum blijven voor de statistieken. */
export async function anonimiseer(env: Env, g: Gebruiker, importId: string, ip: string | null) {
  await bestaat(env, importId);
  await env.DB.batch([
    env.DB.prepare(
      `update voorinschrijvingen set kind_naam_enc = null, email_enc = null, telefoon_enc = null, opmerkingen_enc = null, email_hash = null
       where import_id = ?`,
    ).bind(importId),
    env.DB.prepare(`update voorinschrijvingen_importen set geanonimiseerd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where import_id = ?`).bind(importId),
    audit(env, g, 'voorinschrijvingen_importen', importId, 'ANONIMISEER', undefined, ip),
  ]);
  return { ok: true };
}

export async function verwijder(env: Env, g: Gebruiker, importId: string, ip: string | null) {
  await bestaat(env, importId);
  await env.DB.batch([
    env.DB.prepare(`delete from voorinschrijvingen where import_id = ?`).bind(importId),
    env.DB.prepare(`delete from voorinschrijvingen_importen where import_id = ?`).bind(importId),
    audit(env, g, 'voorinschrijvingen_importen', importId, 'VERWIJDER', undefined, ip),
  ]);
  return { ok: true };
}

/** Statistieken en controles per import. Geen persoonsgegevens: enkel aantallen. */
export async function statistieken(env: Env) {
  const lijst = (await importen(env)) as { id: string; naam: string; aantal: number; geanonimiseerdOp: string | null; aangemaakt: string }[];
  const uit = [];
  for (const imp of lijst) {
    const [scholen, klassen, maanden, schooljaren, controle] = await env.DB.batch<any>([
      env.DB.prepare(
        `select coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), v.school_andere, '(niet ingevuld)') as school,
                case when v.school_id is not null then 'lijst' when v.school_andere is not null then 'andere' else 'leeg' end as soort,
                count(*) as aantal
         from voorinschrijvingen v left join scholen s on s.school_id = v.school_id
         where v.import_id = ? group by 1, 2 order by aantal desc, school`,
      ).bind(imp.id),
      env.DB.prepare(`select coalesce(klas, '(niet ingevuld)') as klas, count(*) as aantal from voorinschrijvingen where import_id = ? group by 1 order by aantal desc`).bind(imp.id),
      env.DB.prepare(
        `select substr(ingediend_op, 1, 7) as maand, count(*) as aantal from voorinschrijvingen
         where import_id = ? and ingediend_op is not null group by 1 order by 1`,
      ).bind(imp.id),
      env.DB.prepare(`select coalesce(schooljaar, '(niet ingevuld)') as schooljaar, count(*) as aantal from voorinschrijvingen where import_id = ? group by 1 order by 1`).bind(imp.id),
      env.DB.prepare(
        `select
           (select count(*) from voorinschrijvingen where import_id = ?1 and email_hash is null) as zonderEmail,
           (select count(*) from (select email_hash from voorinschrijvingen where import_id = ?1 and email_hash is not null
                                  group by email_hash having count(*) > 1)) as dubbeleAdressen,
           (select count(distinct v.email_hash) from voorinschrijvingen v
              where v.import_id = ?1 and exists (select 1 from deelnemers d where d.email_hash = v.email_hash)) as ookIngeschreven,
           (select count(distinct v.email_hash) from voorinschrijvingen v
              where v.import_id = ?1 and exists (select 1 from voorinschrijvingen w where w.email_hash = v.email_hash and w.import_id <> ?1)) as ookInAndereImport,
           (select count(distinct email_hash) from voorinschrijvingen where import_id = ?1 and email_hash is not null) as adressen`,
      ).bind(imp.id),
    ]);
    uit.push({
      ...imp,
      scholen: scholen.results,
      klassen: klassen.results,
      maanden: maanden.results,
      schooljaren: schooljaren.results,
      controle: controle.results[0],
    });
  }
  return uit;
}
