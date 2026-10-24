import { ontsleutel, sha256, versleutel } from '../crypto/versleuteling';
import { DbFout } from '../kern/fouten';
import { isToegelatenEmail } from '../kern/installatie';
import { heeftRecht, type Gebruiker } from '../kern/toegang';
import type { Env } from '../types';
import { isUuid } from '../validatie';
import {
  beeindigSessie,
  controleerLimiet,
  controleerOrigin,
  maakUitdaging,
  startSessie,
  telMislukking,
  verbruikUitdaging,
  wisTeller,
} from './sessie';
import { controleerTotp, gelijk, naarBase32, nieuwTotpGeheim } from './totp';
import { controleerWachtwoord, hashWachtwoord, wachtwoordProbleem } from './wachtwoord';
import { ALGORITMEN, naarB64u, rpInfo, uitdagingUitClientData, verifieerAanmelding, verifieerRegistratie } from './webauthn';

const ISSUER = 'Inschrijfplatform';
const ROLLEN_BEHEER = ['platformbeheerder', 'organisator', 'onthaal'] as const;
const UITNODIGING_DAGEN = 7;

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

async function leesBody(request: Request): Promise<any> {
  const tekst = await request.text();
  if (tekst.length > 16 * 1024) throw new DbFout('ONGELDIGE_GEGEVENS');
  return JSON.parse(tekst);
}

const tekst = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function gebeurtenis(env: Env, gebruikerId: string | null, recordId: string, actie: string, ip: string | null, nieuw?: unknown) {
  return env.DB.prepare(
    `insert into audit_log (log_id, gebruiker_id, entiteit, record_id, actie, nieuwe_waarde, ip_adres) values (?, ?, 'aanmelden', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), gebruikerId, recordId, actie, nieuw === undefined ? null : JSON.stringify(nieuw), ip)
    .run();
}

/**
 * Beperkt het gokken: per IP-adres (20) en per e-mailadres (5) binnen 15 minuten, enkel mislukte pogingen tellen.
 * Een geslaagde poging wist de teller van het e-mailadres.
 */
async function metLimiet<T>(env: Env, request: Request, email: string, werk: () => Promise<T>): Promise<T> {
  const sleutels = [`i:${request.headers.get('CF-Connecting-IP') ?? 'onbekend'}`];
  if (email) sleutels.push(`e:${email}`);
  await controleerLimiet(env, sleutels[0], 20);
  if (email) await controleerLimiet(env, sleutels[1], 5);
  try {
    const r = await werk();
    if (email) await wisTeller(env, sleutels[1]);
    return r;
  } catch (e) {
    if (e instanceof DbFout) for (const s of sleutels) await telMislukking(env, s);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Uitnodigingscodes en activeren
// ---------------------------------------------------------------------------
const normaliseerCode = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const groepeer = (c: string) => c.match(/.{1,4}/g)!.join('-');

async function maakUitnodiging(env: Env, gebruikerId: string) {
  const code = naarBase32(crypto.getRandomValues(new Uint8Array(10))); // 16 tekens = 80 bit
  const tot = new Date(Date.now() + UITNODIGING_DAGEN * 86_400_000).toISOString();
  await env.DB.prepare(`update gebruikers set uitnodiging_hash = ?, uitnodiging_tot = ? where gebruiker_id = ?`)
    .bind(await sha256(code), tot, gebruikerId)
    .run();
  return { uitnodigingscode: groepeer(code), geldigTot: tot };
}

/** Controleert e-mailadres + code. Elke fout geeft dezelfde melding, zodat niemand kan nagaan wie een account heeft. */
async function controleerActivatie(env: Env, emailInvoer: unknown, codeInvoer: unknown): Promise<{ gebruikerId: string; email: string }> {
  const weiger = () => new DbFout('ONGELDIGE_UITNODIGING');
  const email = String(emailInvoer ?? '').trim().toLowerCase();
  const code = normaliseerCode(codeInvoer);
  if (!isToegelatenEmail(env, email) || code.length !== 16) throw weiger();

  const hoofd = env.HOOFDADMIN_EMAIL?.trim().toLowerCase();
  const setup = normaliseerCode(env.HOOFDADMIN_SETUP_CODE);
  const isHoofdadmin = !!hoofd && email === hoofd && isToegelatenEmail(env, hoofd);
  const setupGeldig = isHoofdadmin && setup.length === 16 && gelijk(setup, code);

  let g = await env.DB.prepare(
    `select g.gebruiker_id, g.actief, g.uitnodiging_hash, g.uitnodiging_tot,
            coalesce((select bevestigd from gebruiker_totp t where t.gebruiker_id = g.gebruiker_id), 0) as heeft_totp,
            (select count(*) from passkeys p where p.gebruiker_id = g.gebruiker_id) as passkeys
     from gebruikers g where g.email = ?`,
  )
    .bind(email)
    .first<{ gebruiker_id: string; actief: number; uitnodiging_hash: string | null; uitnodiging_tot: string | null; heeft_totp: number; passkeys: number }>();

  if (!g) {
    if (!setupGeldig) throw weiger();
    // Eerste keer: de hoofdadmin uit de configuratie wordt platformbeheerder.
    const lokaal = email.split('@')[0];
    await env.DB.prepare(
      `insert into gebruikers (naam, voornaam, email, rol_id) select ?, ?, ?, rol_id from rollen where code = 'platformbeheerder'`,
    )
      .bind(lokaal, 'Hoofdadmin', email)
      .run();
    g = await env.DB.prepare(`select gebruiker_id, 1 as actief, null as uitnodiging_hash, null as uitnodiging_tot, 0 as heeft_totp, 0 as passkeys from gebruikers where email = ?`)
      .bind(email)
      .first<any>();
    if (!g) throw weiger();
    return { gebruikerId: g.gebruiker_id, email };
  }
  if (!g.actief || g.heeft_totp || g.passkeys) throw weiger(); // al geactiveerd: eerst laten resetten
  if (setupGeldig) return { gebruikerId: g.gebruiker_id, email };
  const verlopen = !g.uitnodiging_tot || g.uitnodiging_tot < new Date().toISOString();
  if (verlopen || !g.uitnodiging_hash || !gelijk(g.uitnodiging_hash, await sha256(code))) throw weiger();
  return { gebruikerId: g.gebruiker_id, email };
}

async function activeerStart(env: Env, request: Request, body: any): Promise<Response> {
  const email = String(body?.email ?? '').trim().toLowerCase();
  return metLimiet(env, request, email, async () => {
    const { gebruikerId } = await controleerActivatie(env, body?.email, body?.code);
    const geheim = nieuwTotpGeheim();
    await env.DB.prepare(
      `insert into gebruiker_totp (gebruiker_id, secret_enc, bevestigd) values (?, ?, 0)
       on conflict (gebruiker_id) do update set secret_enc = excluded.secret_enc, bevestigd = 0, laatste_stap = 0`,
    )
      .bind(gebruikerId, await versleutel(env, geheim))
      .run();
    const otpauth = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(email)}?secret=${geheim}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
    return json({ geheim, otpauth });
  });
}

async function activeerBevestig(env: Env, request: Request, body: any): Promise<Response> {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const probleem = wachtwoordProbleem(body?.wachtwoord, email);
  if (probleem) return json({ fout: 'VALIDATIE', melding: probleem, velden: { wachtwoord: probleem } }, 400);
  return metLimiet(env, request, email, async () => {
    const { gebruikerId } = await controleerActivatie(env, body?.email, body?.code);
    const t = await env.DB.prepare(`select secret_enc from gebruiker_totp where gebruiker_id = ? and bevestigd = 0`)
      .bind(gebruikerId)
      .first<{ secret_enc: string }>();
    if (!t) throw new DbFout('ONGELDIGE_UITNODIGING');
    const stap = await controleerTotp((await ontsleutel(env, t.secret_enc))!, String(body?.totp ?? '').replace(/\s/g, ''), 0);
    if (stap === null) throw new DbFout('AANMELDEN_MISLUKT');
    await env.DB.batch([
      env.DB.prepare(`update gebruiker_totp set bevestigd = 1, laatste_stap = ? where gebruiker_id = ?`).bind(stap, gebruikerId),
      env.DB.prepare(`update gebruikers set uitnodiging_hash = null, uitnodiging_tot = null, wachtwoord_hash = ? where gebruiker_id = ?`).bind(
        await hashWachtwoord(body.wachtwoord),
        gebruikerId,
      ),
    ]);
    await gebeurtenis(env, gebruikerId, gebruikerId, 'ACTIVEREN', request.headers.get('CF-Connecting-IP'));
    return json({ ok: true }, 200, { 'Set-Cookie': await startSessie(env, request, gebruikerId, 'totp') });
  });
}

// ---------------------------------------------------------------------------
// Aanmelden
// ---------------------------------------------------------------------------
async function aanmeldenTotp(env: Env, request: Request, body: any): Promise<Response> {
  const email = String(body?.email ?? '').trim().toLowerCase();
  return metLimiet(env, request, email, async () => {
    const r = await env.DB.prepare(
      `select g.gebruiker_id, g.wachtwoord_hash, t.secret_enc, t.laatste_stap from gebruikers g join gebruiker_totp t on t.gebruiker_id = g.gebruiker_id
       where g.email = ? and g.actief = 1 and t.bevestigd = 1`,
    )
      .bind(email)
      .first<{ gebruiker_id: string; wachtwoord_hash: string | null; secret_enc: string; laatste_stap: number }>();
    // Het wachtwoord wordt altijd berekend (ook bij een onbekend adres), zodat de responstijd niets verraadt.
    const wachtwoordOk = await controleerWachtwoord(String(body?.wachtwoord ?? ''), r?.wachtwoord_hash);
    if (!r || !isToegelatenEmail(env, email)) throw new DbFout('AANMELDEN_MISLUKT');
    // Accounts van vóór de wachtwoordstap hebben nog geen wachtwoord: die moeten er meteen één instellen (zie beheerRoute).
    if (r.wachtwoord_hash && !wachtwoordOk) throw new DbFout('AANMELDEN_MISLUKT');
    const stap = await controleerTotp((await ontsleutel(env, r.secret_enc))!, String(body?.code ?? '').replace(/\s/g, ''), r.laatste_stap);
    if (stap === null) throw new DbFout('AANMELDEN_MISLUKT');
    // Atomisch: twee gelijktijdige aanvragen met dezelfde code kunnen niet allebei slagen.
    const upd = await env.DB.prepare(`update gebruiker_totp set laatste_stap = ? where gebruiker_id = ? and laatste_stap < ?`)
      .bind(stap, r.gebruiker_id, stap)
      .run();
    if (!upd.meta.changes) throw new DbFout('AANMELDEN_MISLUKT');
    await gebeurtenis(env, r.gebruiker_id, r.gebruiker_id, 'AANMELDEN_TOTP', request.headers.get('CF-Connecting-IP'));
    return json({ ok: true }, 200, { 'Set-Cookie': await startSessie(env, request, r.gebruiker_id, 'totp') });
  });
}

async function passkeyOptiesLogin(env: Env): Promise<Response> {
  const challenge = await maakUitdaging(env, 'login', null);
  return json({ challenge, rpId: rpInfo(env).rpId, userVerification: 'required', timeout: 120_000 });
}

async function aanmeldenPasskey(env: Env, request: Request, body: any): Promise<Response> {
  return metLimiet(env, request, '', async () => {
    const challenge = uitdagingUitClientData(body?.clientDataJSON);
    await verbruikUitdaging(env, challenge, 'login');
    const k = await env.DB.prepare(
      `select p.credential_id, p.public_key, p.algoritme, p.teller, p.gebruiker_id from passkeys p
       join gebruikers g on g.gebruiker_id = p.gebruiker_id where p.credential_id = ? and g.actief = 1`,
    )
      .bind(String(body?.id ?? ''))
      .first<{ credential_id: string; public_key: string; algoritme: number; teller: number; gebruiker_id: string }>();
    if (!k) throw new DbFout('AANMELDEN_MISLUKT');
    const teller = await verifieerAanmelding(env, body, challenge, k);
    await env.DB.prepare(`update passkeys set teller = ?, laatst_gebruikt = ? where credential_id = ?`)
      .bind(teller, new Date().toISOString(), k.credential_id)
      .run();
    await gebeurtenis(env, k.gebruiker_id, k.gebruiker_id, 'AANMELDEN_PASSKEY', request.headers.get('CF-Connecting-IP'));
    return json({ ok: true }, 200, { 'Set-Cookie': await startSessie(env, request, k.gebruiker_id, 'passkey') });
  });
}

/** Publieke routes onder /api/auth (geen sessie nodig). */
export async function authRoute(request: Request, env: Env, pad: string): Promise<Response> {
  const m = request.method;
  if (m !== 'POST') return json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
  controleerOrigin(request, env);
  if (pad === '/afmelden') return json({ ok: true }, 200, { 'Set-Cookie': await beeindigSessie(request, env) });
  if (pad === '/passkey/opties') return passkeyOptiesLogin(env);
  const body = await leesBody(request);
  if (pad === '/activeren/start') return activeerStart(env, request, body);
  if (pad === '/activeren/bevestig') return activeerBevestig(env, request, body);
  if (pad === '/aanmelden') return aanmeldenTotp(env, request, body);
  if (pad === '/passkey/aanmelden') return aanmeldenPasskey(env, request, body);
  return json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
}

// ---------------------------------------------------------------------------
// Aangemeld: eigen profiel en passkeys; gebruikersbeheer voor platformbeheerders
// ---------------------------------------------------------------------------
async function profiel(env: Env, g: Gebruiker): Promise<Response> {
  const [ik, passkeys, evenementen] = await env.DB.batch<any>([
    env.DB.prepare(
      `select voornaam, naam, wachtwoord_hash is not null as heeftWachtwoord,
              coalesce((select bevestigd from gebruiker_totp t where t.gebruiker_id = g.gebruiker_id), 0) as heeftAuthenticator
       from gebruikers g where gebruiker_id = ?`,
    ).bind(g.gebruikerId),
    env.DB.prepare(`select credential_id as id, naam, created_at as aangemaakt, laatst_gebruikt as laatstGebruikt from passkeys where gebruiker_id = ? order by created_at`).bind(g.gebruikerId),
    env.DB.prepare(
      `select e.evenement_id as id, e.titel, e.slug, e.start_datum as start, e.eind_datum as eind, e.status,
              e.inschrijving_tot as inschrijvingTot, e.bewaartermijn_dagen as bewaartermijn,
              (e.privacy_tekst is not null and trim(e.privacy_tekst) <> '') as heeftPrivacytekst,
              (select count(*) from mail_berichten mb join deelnemers d2 on d2.deelnemer_id = mb.deelnemer_id
                 where d2.evenement_id = e.evenement_id and mb.status = 'mislukt') as mailMislukt,
              (select count(*) from deelnemers d where d.evenement_id = e.evenement_id and d.status = 'actief') as deelnemers,
              (select count(distinct i.deelnemer_id) from inschrijvingen i where i.evenement_id = e.evenement_id and i.status = 'wachtlijst') as wachtlijst
       from evenementen e
       where ?1 = 'platformbeheerder'
          or exists (select 1 from evenement_beheerders b where b.evenement_id = e.evenement_id and b.gebruiker_id = ?2)
          or (?1 = 'schoolbeheerder' and e.school_id = ?3)
       order by e.start_datum desc`,
    ).bind(g.rol, g.gebruikerId, g.schoolId),
  ]);
  const r = ik.results[0] ?? {};
  return json({
    email: g.email,
    rol: g.rol,
    rechten: g.rechten,
    voornaam: r.voornaam,
    naam: r.naam,
    heeftWachtwoord: !!r.heeftWachtwoord,
    heeftAuthenticator: !!r.heeftAuthenticator,
    passkeys: passkeys.results,
    evenementen: evenementen.results,
  });
}

async function passkeyOptiesRegistratie(env: Env, g: Gebruiker): Promise<Response> {
  const challenge = await maakUitdaging(env, 'registratie', g.gebruikerId);
  const bestaand = await env.DB.prepare(`select credential_id from passkeys where gebruiker_id = ?`).bind(g.gebruikerId).all<{ credential_id: string }>();
  return json({
    challenge,
    rp: { id: rpInfo(env).rpId, name: ISSUER },
    user: { id: naarB64u(new TextEncoder().encode(g.gebruikerId)), name: g.email, displayName: g.email },
    pubKeyCredParams: ALGORITMEN.map((alg) => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none',
    excludeCredentials: bestaand.results.map((r) => ({ type: 'public-key', id: r.credential_id })),
    timeout: 120_000,
  });
}

async function passkeyOpslaan(env: Env, request: Request, g: Gebruiker, body: any): Promise<Response> {
  const challenge = uitdagingUitClientData(body?.clientDataJSON);
  const u = await verbruikUitdaging(env, challenge, 'registratie');
  if (u.gebruikerId !== g.gebruikerId) throw new DbFout('AANMELDEN_MISLUKT');
  const k = await verifieerRegistratie(env, body, challenge);
  const aantal = await env.DB.prepare(`select count(*) as n from passkeys where gebruiker_id = ?`).bind(g.gebruikerId).first<{ n: number }>();
  if ((aantal?.n ?? 0) >= 10) throw new DbFout('ONGELDIGE_GEGEVENS');
  try {
    await env.DB.prepare(`insert into passkeys (credential_id, gebruiker_id, public_key, algoritme, naam) values (?, ?, ?, ?, ?)`)
      .bind(k.credentialId, g.gebruikerId, k.publicKey, k.algoritme, tekst(body?.naam, 40) || 'Passkey')
      .run();
  } catch {
    throw new DbFout('ONGELDIGE_GEGEVENS'); // sleutel bestaat al
  }
  await gebeurtenis(env, g.gebruikerId, g.gebruikerId, 'PASSKEY_TOEGEVOEGD', request.headers.get('CF-Connecting-IP'));
  return json({ ok: true }, 201);
}

async function lijstGebruikers(env: Env): Promise<Response> {
  const r = await env.DB.prepare(
    `select g.gebruiker_id as id, g.voornaam, g.naam, g.email, g.actief, r.code as rol,
            coalesce((select bevestigd from gebruiker_totp t where t.gebruiker_id = g.gebruiker_id), 0) as heeftAuthenticator,
            (select count(*) from passkeys p where p.gebruiker_id = g.gebruiker_id) as aantalPasskeys,
            (g.uitnodiging_hash is not null and g.uitnodiging_tot > ?) as uitnodigingOpen,
            g.wachtwoord_hash is not null as heeftWachtwoord,
            (select max(a.datum) from audit_log a where a.gebruiker_id = g.gebruiker_id and a.entiteit = 'aanmelden'
               and a.actie like 'AANMELDEN%') as laatsteAanmelding,
            (select json_group_array(b.evenement_id) from evenement_beheerders b where b.gebruiker_id = g.gebruiker_id) as evenementIds
     from gebruikers g join rollen r on r.rol_id = g.rol_id order by g.naam, g.voornaam`,
  )
    .bind(new Date().toISOString())
    .all<any>();
  return json(r.results.map((g) => ({ ...g, evenementIds: JSON.parse(g.evenementIds ?? '[]') })));
}

async function maakGebruiker(env: Env, request: Request, g: Gebruiker, body: any): Promise<Response> {
  const email = tekst(body?.email, 254).toLowerCase();
  const voornaam = tekst(body?.voornaam, 100);
  const naam = tekst(body?.naam, 100);
  const rol = tekst(body?.rol, 30);
  if (!isToegelatenEmail(env, email) || !voornaam || !naam || !(ROLLEN_BEHEER as readonly string[]).includes(rol)) throw new DbFout('ONGELDIGE_GEGEVENS');
  const evenementIds: string[] = Array.isArray(body?.evenementIds) ? body.evenementIds.filter((x: unknown) => typeof x === 'string' && isUuid(x)) : [];

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`insert into gebruikers (gebruiker_id, naam, voornaam, email, rol_id) select ?, ?, ?, ?, rol_id from rollen where code = ?`)
      .bind(id, naam, voornaam, email, rol)
      .run();
  } catch {
    throw new DbFout('GEBRUIKER_BESTAAT');
  }
  if (rol !== 'platformbeheerder' && evenementIds.length) {
    await env.DB.batch(
      evenementIds.map((e) =>
        env.DB.prepare(`insert or ignore into evenement_beheerders (evenement_id, gebruiker_id, rol) select evenement_id, ?, ? from evenementen where evenement_id = ?`).bind(id, rol, e),
      ),
    );
  }
  const uitnodiging = await maakUitnodiging(env, id);
  await gebeurtenis(env, g.gebruikerId, id, 'GEBRUIKER_AANGEMAAKT', request.headers.get('CF-Connecting-IP'), { rol });
  return json({ id, ...uitnodiging }, 201);
}

/** Verwijdert authenticator, passkeys en sessies en geeft een nieuwe uitnodigingscode (verloren telefoon of laptop). */
async function resetGebruiker(env: Env, request: Request, g: Gebruiker, id: string): Promise<Response> {
  if (id === g.gebruikerId) throw new DbFout('GEEN_TOEGANG'); // niet jezelf buitensluiten
  const bestaat = await env.DB.prepare(`select 1 from gebruikers where gebruiker_id = ?`).bind(id).first();
  if (!bestaat) throw new DbFout('GEEN_TOEGANG');
  await env.DB.batch([
    env.DB.prepare(`delete from gebruiker_totp where gebruiker_id = ?`).bind(id),
    env.DB.prepare(`delete from passkeys where gebruiker_id = ?`).bind(id),
    env.DB.prepare(`delete from beheer_sessies where gebruiker_id = ?`).bind(id),
    env.DB.prepare(`update gebruikers set wachtwoord_hash = null where gebruiker_id = ?`).bind(id),
  ]);
  const uitnodiging = await maakUitnodiging(env, id);
  await gebeurtenis(env, g.gebruikerId, id, 'GEBRUIKER_RESET', request.headers.get('CF-Connecting-IP'));
  return json(uitnodiging);
}

/** Naam, rol, evenementen of actief aanpassen. Jezelf kan je niet deactiveren of je rol afnemen; de hoofdadmin blijft platformbeheerder. */
async function bewerkGebruiker(env: Env, request: Request, g: Gebruiker, id: string, body: any): Promise<Response> {
  const doel = await env.DB.prepare(`select g.email, r.code as rol from gebruikers g join rollen r on r.rol_id = g.rol_id where g.gebruiker_id = ?`)
    .bind(id)
    .first<{ email: string; rol: string }>();
  if (!doel) throw new DbFout('GEEN_TOEGANG');
  const isHoofdadmin = !!env.HOOFDADMIN_EMAIL && doel.email.toLowerCase() === env.HOOFDADMIN_EMAIL.trim().toLowerCase();
  const stmts: D1PreparedStatement[] = [];
  const gewijzigd: Record<string, unknown> = {};

  if (body?.actief !== undefined) {
    if (typeof body.actief !== 'boolean') throw new DbFout('ONGELDIGE_GEGEVENS');
    if (id === g.gebruikerId || isHoofdadmin) throw new DbFout('GEEN_TOEGANG');
    stmts.push(env.DB.prepare(`update gebruikers set actief = ? where gebruiker_id = ?`).bind(body.actief ? 1 : 0, id));
    if (!body.actief) stmts.push(env.DB.prepare(`delete from beheer_sessies where gebruiker_id = ?`).bind(id));
    gewijzigd.actief = body.actief;
  }
  for (const veld of ['voornaam', 'naam'] as const) {
    if (body?.[veld] === undefined) continue;
    const waarde = tekst(body[veld], 100);
    if (!waarde) throw new DbFout('ONGELDIGE_GEGEVENS');
    stmts.push(env.DB.prepare(`update gebruikers set ${veld} = ? where gebruiker_id = ?`).bind(waarde, id));
    gewijzigd[veld] = true;
  }
  const rol = body?.rol === undefined ? doel.rol : tekst(body.rol, 30);
  if (body?.rol !== undefined && rol !== doel.rol) {
    if (!(ROLLEN_BEHEER as readonly string[]).includes(rol)) throw new DbFout('ONGELDIGE_GEGEVENS');
    if (id === g.gebruikerId || isHoofdadmin) throw new DbFout('GEEN_TOEGANG');
    stmts.push(env.DB.prepare(`update gebruikers set rol_id = (select rol_id from rollen where code = ?) where gebruiker_id = ?`).bind(rol, id));
    gewijzigd.rol = rol;
  }
  if (Array.isArray(body?.evenementIds)) {
    const ids: string[] = body.evenementIds.filter((x: unknown) => typeof x === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(x));
    stmts.push(env.DB.prepare(`delete from evenement_beheerders where gebruiker_id = ?`).bind(id));
    if (rol !== 'platformbeheerder') {
      const bRol = rol === 'onthaal' ? 'onthaal' : 'organisator';
      for (const e of ids) {
        stmts.push(
          env.DB.prepare(`insert or ignore into evenement_beheerders (evenement_id, gebruiker_id, rol) select evenement_id, ?, ? from evenementen where evenement_id = ?`).bind(id, bRol, e),
        );
      }
    }
    gewijzigd.evenementen = ids.length;
  }
  if (!stmts.length) return json({ ok: true });
  await env.DB.batch(stmts);
  await gebeurtenis(env, g.gebruikerId, id, 'GEBRUIKER_GEWIJZIGD', request.headers.get('CF-Connecting-IP'), gewijzigd);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Eigen account: wachtwoord en authenticator
// ---------------------------------------------------------------------------
async function wijzigWachtwoord(env: Env, request: Request, g: Gebruiker, body: any): Promise<Response> {
  const probleem = wachtwoordProbleem(body?.nieuw, g.email);
  if (probleem) return json({ fout: 'VALIDATIE', melding: probleem, velden: { nieuw: probleem } }, 400);
  return metLimiet(env, request, g.email, async () => {
    const r = await env.DB.prepare(`select wachtwoord_hash from gebruikers where gebruiker_id = ?`).bind(g.gebruikerId).first<{ wachtwoord_hash: string | null }>();
    // Wie al een wachtwoord heeft, moet het huidige kennen (een open laptop is niet genoeg).
    if (r?.wachtwoord_hash && !(await controleerWachtwoord(String(body?.huidig ?? ''), r.wachtwoord_hash))) {
      throw new DbFout('HUIDIG_WACHTWOORD_FOUT');
    }
    await env.DB.prepare(`update gebruikers set wachtwoord_hash = ? where gebruiker_id = ?`).bind(await hashWachtwoord(body.nieuw), g.gebruikerId).run();
    await gebeurtenis(env, g.gebruikerId, g.gebruikerId, 'WACHTWOORD_GEWIJZIGD', request.headers.get('CF-Connecting-IP'));
    return json({ ok: true });
  });
}

async function authenticatorStart(env: Env, g: Gebruiker): Promise<Response> {
  const geheim = nieuwTotpGeheim();
  const versleuteld = await versleutel(env, geheim);
  await env.DB.prepare(
    `insert into gebruiker_totp (gebruiker_id, secret_enc, bevestigd, nieuw_secret_enc) values (?1, ?2, 0, ?2)
     on conflict (gebruiker_id) do update set nieuw_secret_enc = excluded.nieuw_secret_enc`,
  )
    .bind(g.gebruikerId, versleuteld)
    .run();
  const otpauth = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(g.email)}?secret=${geheim}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
  return json({ geheim, otpauth });
}

/** Wisselt pas naar het nieuwe geheim als de code eruit klopt; tot dan blijft de oude app werken. */
async function authenticatorBevestig(env: Env, request: Request, g: Gebruiker, body: any): Promise<Response> {
  return metLimiet(env, request, g.email, async () => {
    const t = await env.DB.prepare(`select nieuw_secret_enc from gebruiker_totp where gebruiker_id = ? and nieuw_secret_enc is not null`)
      .bind(g.gebruikerId)
      .first<{ nieuw_secret_enc: string }>();
    if (!t) throw new DbFout('AANMELDEN_MISLUKT');
    const stap = await controleerTotp((await ontsleutel(env, t.nieuw_secret_enc))!, String(body?.code ?? '').replace(/\s/g, ''), 0);
    if (stap === null) throw new DbFout('AANMELDEN_MISLUKT');
    await env.DB.prepare(
      `update gebruiker_totp set secret_enc = nieuw_secret_enc, nieuw_secret_enc = null, bevestigd = 1, laatste_stap = ? where gebruiker_id = ?`,
    )
      .bind(stap, g.gebruikerId)
      .run();
    await gebeurtenis(env, g.gebruikerId, g.gebruikerId, 'AUTHENTICATOR_GEWIJZIGD', request.headers.get('CF-Connecting-IP'));
    return json({ ok: true });
  });
}

/** Routes onder /api/beheer die over het aanmelden zelf gaan. Geeft null als het pad hier niet thuishoort. */
export async function aanmeldBeheerRoute(request: Request, env: Env, g: Gebruiker, pad: string): Promise<Response | null> {
  const m = request.method;
  let p: RegExpMatchArray | null;

  if (m === 'GET' && pad === '/ik') return profiel(env, g);
  if (m === 'POST' && pad === '/account/wachtwoord') return wijzigWachtwoord(env, request, g, await leesBody(request));
  if (g.moetWachtwoordInstellen) throw new DbFout('WACHTWOORD_INSTELLEN'); // al de rest pas na het instellen van een wachtwoord
  if (m === 'POST' && pad === '/account/authenticator/start') return authenticatorStart(env, g);
  if (m === 'POST' && pad === '/account/authenticator/bevestig') return authenticatorBevestig(env, request, g, await leesBody(request));
  if (m === 'POST' && pad === '/passkeys/opties') return passkeyOptiesRegistratie(env, g);
  if (m === 'POST' && pad === '/passkeys') return passkeyOpslaan(env, request, g, await leesBody(request));
  if (m === 'DELETE' && (p = pad.match(/^\/passkeys\/([A-Za-z0-9_-]{16,512})$/))) {
    await env.DB.prepare(`delete from passkeys where credential_id = ? and gebruiker_id = ?`).bind(p[1], g.gebruikerId).run();
    return json({ ok: true });
  }

  if (pad === '/gebruikers' || pad.startsWith('/gebruikers/')) {
    if (!heeftRecht(g, 'kern.gebruikers.beheren')) throw new DbFout('GEEN_TOEGANG');
    if (m === 'GET' && pad === '/gebruikers') return lijstGebruikers(env);
    if (m === 'POST' && pad === '/gebruikers') return maakGebruiker(env, request, g, await leesBody(request));
    if (m === 'POST' && (p = pad.match(/^\/gebruikers\/([0-9a-f-]{36})\/reset$/)) && isUuid(p[1])) return resetGebruiker(env, request, g, p[1]);
    if (m === 'PATCH' && (p = pad.match(/^\/gebruikers\/([0-9a-f-]{36})$/)) && isUuid(p[1])) {
      return bewerkGebruiker(env, request, g, p[1], await leesBody(request));
    }
  }
  return null;
}
