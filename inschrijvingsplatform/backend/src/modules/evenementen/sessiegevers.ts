import { controleerOrigin, https, leesCookie, willekeurigToken } from '../../auth/sessie';
import { sha256 } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';
import { installatie, isToegelatenEmail } from '../../kern/installatie';
import type { Module } from '../../kern/module';
import { leesAanpassingen } from '../../kern/rollen';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import { verstuur } from '../../mail';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { plaatshouders, vandaag } from './capaciteit';
import { aanmeldcodemail, sessiegevermail } from './mails';

/**
 * Sessiegevers: wie een sessie geeft. Zo heet het intern; op het scherm en in mails gebruikt de installatie haar
 * eigen term (installatie(env).termen: lesgever, spreker, artiest). Een sessiegever is geen medewerker en staat apart
 * van de medewerkers. Een organisator registreert sessiegevers vooraf en koppelt ze aan sessies.
 *
 * Aanmelden: met een code per mail (6 cijfers, 10 minuten, één keer, 5 pogingen), enkel voor adressen van
 * AANMELD_DOMEINEN. Dat wijkt af van het beleid voor accounts (een mailcode is daar geen volwaardige aanmelding);
 * aanvaard voor deze beperkte toegang: enkel de eigen sessies, en geldig tot 5 dagen na de laatste eigen sessie.
 */

export const DAGEN_NA_LAATSTE_SESSIE = 5;
const CODE_MINUTEN = 10;
const MAX_POGINGEN = 5;
/** Minimale tijd tussen twee codes voor hetzelfde adres. */
const CODE_WACHT_SECONDEN = 60;

/** Velden die een organisator extra kan openzetten voor sessiegevers (naast wat op het rapport staat). */
export const EXTRA_VELDEN = {
  email: 'E-mailadres',
  contact: 'Contactpersoon (ouder)',
  telefoon: 'Telefoonnummer',
  opmerkingen: 'Opmerkingen',
} as const;
export type ExtraVeld = keyof typeof EXTRA_VELDEN;

const isoNu = () => new Date().toISOString();
const naamUitEmail = (e: unknown) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

// ---------------------------------------------------------------------------
// Wie is aangemeld als sessiegever
// ---------------------------------------------------------------------------

export interface Sessiegever {
  sessiegeverId: string;
  voornaam: string;
  naam: string;
  email: string;
  rechten: string[];
}

const cookieNaam = (env: Env) => (https(env) ? '__Host-sessiegever' : 'sessiegever');

/** Rechten van de rol sessiegever: standaard uit de manifesten, met de aanpassingen uit Rollen en rechten. */
async function rechtenSessiegever(env: Env, modules: Module[]): Promise<string[]> {
  const aanpassingen = await leesAanpassingen(env, 'sessiegever');
  return modules.flatMap((m) =>
    Object.entries(m.rechten ?? {})
      .filter(([naam, r]) => (r.instelbaar ? aanpassingen.get(`sessiegever ${naam}`) : undefined) ?? r.rollen.includes('sessiegever'))
      .map(([naam]) => naam),
  );
}

/** De aangemelde sessiegever, of null. */
export async function huidigeSessiegever(request: Request, env: Env, modules: Module[]): Promise<Sessiegever | null> {
  const token = leesCookie(request, cookieNaam(env));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const r = await env.DB.prepare(
    `select g.sessiegever_id, g.voornaam, g.naam, g.email from sessiegever_sessies s join sessiegevers g on g.sessiegever_id = s.sessiegever_id
     where s.sessie_hash = ? and s.verloopt_op > ? and g.actief = 1`,
  )
    .bind(await sha256(token), isoNu())
    .first<{ sessiegever_id: string; voornaam: string; naam: string; email: string }>();
  if (!r || !isToegelatenEmail(env, r.email)) return null;
  controleerOrigin(request, env);
  return { sessiegeverId: r.sessiegever_id, voornaam: r.voornaam, naam: r.naam, email: r.email, rechten: await rechtenSessiegever(env, modules) };
}

export async function vereisSessiegever(request: Request, env: Env, modules: Module[]): Promise<Sessiegever> {
  const s = await huidigeSessiegever(request, env, modules);
  if (!s) throw new DbFout('NIET_AANGEMELD');
  return s;
}

/** Tot wanneer een sessiegever kan aanmelden: einde van de dag, 5 dagen na de laatste eigen sessie. Null = geen sessies. */
async function geldigTot(env: Env, sessiegeverId: string): Promise<string | null> {
  const r = await env.DB.prepare(
    `select max(d.datum) as laatste from sessie_sessiegevers sg join sessies s on s.sessie_id = sg.sessie_id
     join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
     join evenement_dagen d on d.dag_id = dd.dag_id where sg.sessiegever_id = ?`,
  )
    .bind(sessiegeverId)
    .first<{ laatste: string | null }>();
  if (!r?.laatste) return null;
  const tot = new Date(`${r.laatste}T23:59:59Z`);
  tot.setUTCDate(tot.getUTCDate() + DAGEN_NA_LAATSTE_SESSIE);
  return tot.toISOString();
}

/** Mag deze sessiegever deze sessie openen? Gekoppeld, en de sessie is niet langer dan 5 dagen voorbij. */
export async function controleerSessieVanSessiegever(env: Env, s: Sessiegever, sessieId: string, recht: string): Promise<void> {
  if (!s.rechten.includes(recht)) throw new DbFout('GEEN_TOEGANG');
  const r = await env.DB.prepare(
    `select d.datum from sessie_sessiegevers sg join sessies s on s.sessie_id = sg.sessie_id
     join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
     join evenement_dagen d on d.dag_id = dd.dag_id where sg.sessiegever_id = ? and sg.sessie_id = ?`,
  )
    .bind(s.sessiegeverId, sessieId)
    .first<{ datum: string }>();
  if (!r) throw new DbFout('GEEN_TOEGANG');
  const grens = new Date(`${r.datum}T00:00:00Z`);
  grens.setUTCDate(grens.getUTCDate() + DAGEN_NA_LAATSTE_SESSIE);
  if (vandaag() > grens.toISOString().slice(0, 10)) throw new DbFout('GEEN_TOEGANG');
}

// ---------------------------------------------------------------------------
// Aanmelden met een code per mail
// ---------------------------------------------------------------------------

const codeHash = (sessiegeverId: string, code: string) => sha256(`${sessiegeverId}:${code}`);

/**
 * Vraagt een code aan. Antwoordt altijd hetzelfde: zo kan niemand nagaan welke adressen geregistreerd zijn.
 * De mail vertrekt op de achtergrond, zodat ook de antwoordtijd niets verraadt.
 */
export async function vraagCode(env: Env, body: any, waitUntil: (p: Promise<unknown>) => void) {
  const email = naamUitEmail(body?.email);
  const antwoord = { ok: true };
  if (!email || !isToegelatenEmail(env, email)) return antwoord;
  const g = await env.DB.prepare(`select sessiegever_id, voornaam from sessiegevers where email = ? and actief = 1`)
    .bind(email)
    .first<{ sessiegever_id: string; voornaam: string }>();
  if (!g) return antwoord;
  const tot = await geldigTot(env, g.sessiegever_id);
  if (!tot || tot < isoNu()) return antwoord;
  const vorige = await env.DB.prepare(`select aangemaakt_op from sessiegever_codes where sessiegever_id = ?`)
    .bind(g.sessiegever_id)
    .first<{ aangemaakt_op: string }>();
  if (vorige && Date.parse(vorige.aangemaakt_op) > Date.now() - CODE_WACHT_SECONDEN * 1000) return antwoord;

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await env.DB.prepare(
    `insert into sessiegever_codes (sessiegever_id, code_hash, verloopt_op, pogingen, aangemaakt_op) values (?, ?, ?, 0, ?)
     on conflict (sessiegever_id) do update set code_hash = excluded.code_hash, verloopt_op = excluded.verloopt_op,
       pogingen = 0, aangemaakt_op = excluded.aangemaakt_op`,
  )
    .bind(g.sessiegever_id, await codeHash(g.sessiegever_id, code), new Date(Date.now() + CODE_MINUTEN * 60_000).toISOString(), isoNu())
    .run();
  waitUntil(verstuur(env, aanmeldcodemail({ aan: email, voornaam: g.voornaam, code, minuten: CODE_MINUTEN })).catch((e) => console.error('aanmeldcode', String(e).slice(0, 200))));
  return antwoord;
}

/** Controleert de code en start een sessie. Geeft de Set-Cookie terug. */
export async function meldAanMetCode(env: Env, request: Request, body: any): Promise<{ cookie: string; voornaam: string }> {
  const email = naamUitEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
  const mislukt = new DbFout('AANMELDEN_MISLUKT');
  if (!email || !/^\d{6}$/.test(code) || !isToegelatenEmail(env, email)) throw mislukt;
  const r = await env.DB.prepare(
    `select g.sessiegever_id, g.voornaam, c.code_hash, c.verloopt_op, c.pogingen from sessiegevers g
     join sessiegever_codes c on c.sessiegever_id = g.sessiegever_id where g.email = ? and g.actief = 1`,
  )
    .bind(email)
    .first<{ sessiegever_id: string; voornaam: string; code_hash: string; verloopt_op: string; pogingen: number }>();
  if (!r || r.verloopt_op < isoNu()) throw mislukt;
  if (r.pogingen >= MAX_POGINGEN) throw new DbFout('TE_VEEL_POGINGEN');
  if ((await codeHash(r.sessiegever_id, code)) !== r.code_hash) {
    await env.DB.prepare(`update sessiegever_codes set pogingen = pogingen + 1 where sessiegever_id = ?`).bind(r.sessiegever_id).run();
    throw mislukt;
  }
  const tot = await geldigTot(env, r.sessiegever_id);
  if (!tot || tot < isoNu()) throw mislukt;
  const token = willekeurigToken();
  await env.DB.batch([
    env.DB.prepare(`delete from sessiegever_codes where sessiegever_id = ?`).bind(r.sessiegever_id),
    env.DB.prepare(`insert into sessiegever_sessies (sessie_hash, sessiegever_id, verloopt_op, ip_adres) values (?, ?, ?, ?)`)
      .bind(await sha256(token), r.sessiegever_id, tot, request.headers.get('CF-Connecting-IP')),
    audit(env, null, 'sessiegevers', r.sessiegever_id, 'AANGEMELD', undefined, request.headers.get('CF-Connecting-IP')),
  ]);
  const seconden = Math.max(60, Math.floor((Date.parse(tot) - Date.now()) / 1000));
  return {
    voornaam: r.voornaam,
    cookie: `${cookieNaam(env)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconden}${https(env) ? '; Secure' : ''}`,
  };
}

export async function meldAfSessiegever(env: Env, request: Request): Promise<string> {
  const token = leesCookie(request, cookieNaam(env));
  if (token) await env.DB.prepare(`delete from sessiegever_sessies where sessie_hash = ?`).bind(await sha256(token)).run();
  return `${cookieNaam(env)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${https(env) ? '; Secure' : ''}`;
}

/** De eigen sessies, met plaatsen, voor de pagina "Mijn sessies". */
export async function mijnSessies(env: Env, s: Sessiegever) {
  const grens = new Date();
  grens.setUTCDate(grens.getUTCDate() - DAGEN_NA_LAATSTE_SESSIE);
  const { results } = await env.DB.prepare(
    `select s.sessie_id as id, s.titel, e.titel as evenement, d.naam as dag, d.datum, t.naam as tijdsblok, t.start_uur as startUur,
            t.eind_uur as eindUur, coalesce(l.lokaal, l.naam) as lokaal, s.capaciteit,
            (select count(*) from inschrijvingen i where i.sessie_id = s.sessie_id and i.status = 'bevestigd') as bevestigd,
            (select count(*) from inschrijvingen i where i.sessie_id = s.sessie_id and i.status = 'wachtlijst') as wachtlijst
     from sessie_sessiegevers sg join sessies s on s.sessie_id = sg.sessie_id
     join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
     join evenement_dagen d on d.dag_id = dd.dag_id join evenementen e on e.evenement_id = d.evenement_id
     left join locaties l on l.locatie_id = s.locatie_id
     where sg.sessiegever_id = ? and d.datum >= ?
     order by d.datum, t.start_uur`,
  )
    .bind(s.sessiegeverId, grens.toISOString().slice(0, 10))
    .all();
  return { voornaam: s.voornaam, naam: s.naam, email: s.email, rechten: s.rechten, sessies: results };
}

// ---------------------------------------------------------------------------
// Beheer: de lijst sessiegevers (Dashboard → <evenement> → Sessiegevers)
// ---------------------------------------------------------------------------

/** Sessies van het evenement met hun sessiegevers, en alle sessiegevers om te kiezen. */
export async function sessiegeversVanEvenement(env: Env, g: Gebruiker, evenementId: string) {
  await controleerToegang(env, g, evenementId);
  const db = env.DB;
  const [ev, sessies, koppelingen, alle] = await db.batch<any>([
    db.prepare(`select titel, sessiegever_velden from evenementen where evenement_id = ?`).bind(evenementId),
    db.prepare(
      `select s.sessie_id as id, s.titel, d.naam as dag, d.datum, t.naam as tijdsblok, t.start_uur as startUur,
              s.lesgever as lesgeverTekst, s.lesgever_email as lesgeverEmail
       from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? and t.type = 'keuze' and s.status <> 'geannuleerd'
       order by d.datum, t.start_uur, s.volgorde, s.titel`,
    ).bind(evenementId),
    db.prepare(
      `select sg.sessie_id, sg.sessiegever_id from sessie_sessiegevers sg join sessies s on s.sessie_id = sg.sessie_id
       join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ?`,
    ).bind(evenementId),
    db.prepare(`select sessiegever_id as id, voornaam, naam, email, uitgenodigd_op as uitgenodigdOp from sessiegevers where actief = 1 order by naam, voornaam`),
  ]);
  if (!ev.results.length) throw new DbFout('GEEN_TOEGANG');
  const per = new Map<string, string[]>();
  for (const k of koppelingen.results as { sessie_id: string; sessiegever_id: string }[]) per.set(k.sessie_id, [...(per.get(k.sessie_id) ?? []), k.sessiegever_id]);
  const t = installatie(env).termen;
  return {
    termen: t,
    evenement: ev.results[0].titel as string,
    velden: (JSON.parse(ev.results[0].sessiegever_velden ?? '[]') as string[]).filter((v) => v in EXTRA_VELDEN),
    extraVelden: Object.entries(EXTRA_VELDEN).map(([id, label]) => ({ id, label })),
    sessies: (sessies.results as any[]).map((s) => ({ ...s, sessiegevers: per.get(s.id) ?? [] })),
    sessiegevers: (alle.results as any[]).map((x) => ({
      ...x,
      sessies: [...per.entries()].filter(([, ids]) => ids.includes(x.id)).map(([sid]) => sid),
    })),
  };
}

function valideerSessiegever(env: Env, body: any) {
  const fouten: Record<string, string> = {};
  const voornaam = typeof body?.voornaam === 'string' ? body.voornaam.trim().slice(0, 100) : '';
  const naam = typeof body?.naam === 'string' ? body.naam.trim().slice(0, 100) : '';
  const email = naamUitEmail(body?.email);
  if (!voornaam) fouten.voornaam = 'Vul de voornaam in.';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fouten.email = 'Vul een geldig e-mailadres in.';
  else if (!isToegelatenEmail(env, email)) fouten.email = 'Enkel adressen van de toegelaten domeinen kunnen aanmelden.';
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);
  return { voornaam, naam, email };
}

export async function maakSessiegever(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const v = valideerSessiegever(env, body);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(`insert into sessiegevers (sessiegever_id, voornaam, naam, email, created_at) values (?, ?, ?, ?, ?)`).bind(id, v.voornaam, v.naam, v.email, isoNu()),
      audit(env, g, 'sessiegevers', id, 'AANGEMAAKT', undefined, ip),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ValidatieFout({ email: 'Er bestaat al iemand met dit e-mailadres.' });
    throw e;
  }
  return { id };
}

export async function wijzigSessiegever(env: Env, g: Gebruiker, id: string, body: any, ip: string | null) {
  const v = valideerSessiegever(env, body);
  try {
    const r = await env.DB.prepare(`update sessiegevers set voornaam = ?, naam = ?, email = ? where sessiegever_id = ?`).bind(v.voornaam, v.naam, v.email, id).run();
    if (!r.meta.changes) throw new DbFout('GEEN_TOEGANG');
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ValidatieFout({ email: 'Er bestaat al iemand met dit e-mailadres.' });
    throw e;
  }
  // Een ander adres: lopende aanmeldingen vervallen.
  await env.DB.batch([
    env.DB.prepare(`delete from sessiegever_sessies where sessiegever_id = ?`).bind(id),
    audit(env, g, 'sessiegevers', id, 'GEWIJZIGD', undefined, ip),
  ]);
  return { ok: true };
}

/**
 * Meerdere sessiegevers tegelijk (Contacten → Contacten plakken → als lesgever). Wie al bestaat (zelfde adres), blijft
 * zoals hij is; adressen buiten de toegelaten domeinen worden overgeslagen. Koppelen aan sessies gebeurt per evenement.
 */
export async function voegSessiegeversToe(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const rijen: any[] = Array.isArray(body?.rijen) ? body.rijen.slice(0, 500) : [];
  if (!rijen.length) throw new ValidatieFout({ rijen: 'Er zijn geen adressen om toe te voegen.' });
  const { results } = await env.DB.prepare(`select email from sessiegevers where email is not null`).all<{ email: string }>();
  const bestaand = new Set(results.map((x) => x.email.toLowerCase()));
  const verslag = { nieuw: 0, bestaand: 0, buitenDomein: 0, ongeldig: 0 };
  const stmts: D1PreparedStatement[] = [];
  for (const r of rijen) {
    const email = naamUitEmail(r?.email);
    const voornaam = typeof r?.voornaam === 'string' ? r.voornaam.trim().slice(0, 100) : '';
    const naam = typeof r?.naam === 'string' ? r.naam.trim().slice(0, 100) : '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !voornaam) { verslag.ongeldig++; continue; }
    if (!isToegelatenEmail(env, email)) { verslag.buitenDomein++; continue; }
    if (bestaand.has(email)) { verslag.bestaand++; continue; }
    bestaand.add(email);
    stmts.push(env.DB.prepare(`insert into sessiegevers (sessiegever_id, voornaam, naam, email, created_at) values (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), voornaam, naam, email, isoNu()));
    verslag.nieuw++;
  }
  await env.DB.batch([...stmts, audit(env, g, 'sessiegevers', '*', 'TOEGEVOEGD', verslag, ip)]);
  return verslag;
}

/** Verwijderen: koppelingen en aanmeldingen verdwijnen mee (cascade), de toegang is meteen weg. */
export async function verwijderSessiegever(env: Env, g: Gebruiker, id: string, ip: string | null) {
  await env.DB.batch([
    env.DB.prepare(`delete from sessiegevers where sessiegever_id = ?`).bind(id),
    audit(env, g, 'sessiegevers', id, 'VERWIJDERD', undefined, ip),
  ]);
  return { ok: true };
}

export async function evenementVanSessie(env: Env, sessieId: string): Promise<string> {
  const r = await env.DB.prepare(
    `select d.evenement_id from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
     join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id where s.sessie_id = ?`,
  )
    .bind(sessieId)
    .first<{ evenement_id: string }>();
  if (!r) throw new DbFout('GEEN_TOEGANG');
  return r.evenement_id;
}

/** Welke sessiegevers een sessie geeft (vervangt de koppelingen van die sessie). */
export async function koppelSessiegevers(env: Env, g: Gebruiker, sessieId: string, body: any, ip: string | null) {
  const evenementId = await evenementVanSessie(env, sessieId);
  await controleerToegang(env, g, evenementId, true);
  const ids = Array.isArray(body?.sessiegevers) ? [...new Set(body.sessiegevers as unknown[])].filter((x): x is string => typeof x === 'string').slice(0, 20) : null;
  if (!ids) throw new ValidatieFout({ sessiegevers: 'Ongeldige keuze.' });
  if (ids.length) {
    const n = await env.DB.prepare(`select count(*) as n from sessiegevers where sessiegever_id in (${plaatshouders(ids.length)})`).bind(...ids).first<{ n: number }>();
    if (n?.n !== ids.length) throw new ValidatieFout({ sessiegevers: 'Ongeldige keuze.' });
  }
  await env.DB.batch([
    env.DB.prepare(`delete from sessie_sessiegevers where sessie_id = ?`).bind(sessieId),
    ...ids.map((id) => env.DB.prepare(`insert into sessie_sessiegevers (id, sessie_id, sessiegever_id, rol) values (?, ?, ?, 'Hoofddocent')`).bind(crypto.randomUUID(), sessieId, id)),
    audit(env, g, 'sessies', sessieId, 'SESSIEGEVERS', { aantal: ids.length }, ip),
  ]);
  return { ok: true };
}

/**
 * Overnemen uit de vrije velden "lesgever" en "e-mail lesgever" bij de lesjes: per e-mailadres een sessiegever
 * (bestaat die al, dan wordt die gebruikt) en de koppeling met het lesje. Adressen buiten de domeinen slaan we over.
 */
export async function neemOverUitSessies(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const lijst = await sessiegeversVanEvenement(env, g, evenementId);
  const bestaand = new Map(lijst.sessiegevers.map((x) => [x.email?.toLowerCase(), x.id]));
  let nieuw = 0;
  let gekoppeld = 0;
  const overgeslagen: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const s of lijst.sessies) {
    const email = naamUitEmail(s.lesgeverEmail);
    if (!email) continue;
    if (!isToegelatenEmail(env, email)) {
      overgeslagen.push(email);
      continue;
    }
    let id = bestaand.get(email);
    if (!id) {
      id = crypto.randomUUID();
      const [voornaam, ...rest] = String(s.lesgeverTekst ?? email.split('@')[0]).trim().split(/\s+/);
      stmts.push(env.DB.prepare(`insert into sessiegevers (sessiegever_id, voornaam, naam, email, created_at) values (?, ?, ?, ?, ?)`).bind(id, voornaam || email, rest.join(' '), email, isoNu()));
      bestaand.set(email, id);
      nieuw++;
    }
    if (!s.sessiegevers.includes(id)) {
      stmts.push(env.DB.prepare(`insert into sessie_sessiegevers (id, sessie_id, sessiegever_id, rol) values (?, ?, ?, 'Hoofddocent')`).bind(crypto.randomUUID(), s.id, id));
      gekoppeld++;
    }
  }
  if (stmts.length) await env.DB.batch([...stmts, audit(env, g, 'evenementen', evenementId, 'SESSIEGEVERS_OVERGENOMEN', { nieuw, gekoppeld }, ip)]);
  return { nieuw, gekoppeld, overgeslagen: [...new Set(overgeslagen)].length };
}

/** Welke extra velden sessiegevers van dit evenement zien. */
export async function zetVelden(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const velden = Array.isArray(body?.velden) ? [...new Set(body.velden as unknown[])].filter((v): v is ExtraVeld => typeof v === 'string' && v in EXTRA_VELDEN) : null;
  if (!velden) throw new ValidatieFout({ velden: 'Ongeldige keuze.' });
  await env.DB.batch([
    env.DB.prepare(`update evenementen set sessiegever_velden = ? where evenement_id = ?`).bind(velden.length ? JSON.stringify(velden) : null, evenementId),
    audit(env, g, 'evenementen', evenementId, 'SESSIEGEVER_VELDEN', { velden }, ip),
  ]);
  return { velden };
}

/** Uitnodiging per mail aan de sessiegevers van dit evenement (allen, of enkel de gekozen ids). */
export async function nodigUit(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const lijst = await sessiegeversVanEvenement(env, g, evenementId);
  const gekozen = Array.isArray(body?.ids) ? new Set(body.ids as unknown[]) : null;
  const basis = env.PUBLIC_APP_URL.replace(/\/$/, '');
  let verstuurd = 0;
  let mislukt = 0;
  for (const x of lijst.sessiegevers) {
    if (!x.sessies.length || (gekozen && !gekozen.has(x.id))) continue;
    const sessies = lijst.sessies.filter((s) => x.sessies.includes(s.id));
    try {
      await verstuur(env, {
        ...sessiegevermail({ aan: x.email, voornaam: x.voornaam, evenement: lijst.evenement, term: lijst.termen.sessiegever, sessies, link: `${basis}/sessiegever` }),
        evenementId,
      });
      await env.DB.prepare(`update sessiegevers set uitgenodigd_op = ? where sessiegever_id = ?`).bind(isoNu(), x.id).run();
      verstuurd++;
    } catch (e) {
      console.error('sessiegevermail', String(e).slice(0, 200));
      mislukt++;
    }
  }
  await audit(env, g, 'evenementen', evenementId, 'SESSIEGEVERS_UITGENODIGD', { verstuurd, mislukt }, ip).run();
  return { verstuurd, mislukt };
}
