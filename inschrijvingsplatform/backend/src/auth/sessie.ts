import { sha256 } from '../crypto/versleuteling';
import { DbFout } from '../db/fouten';
import type { Env } from '../types';

/**
 * Sessies voor medewerkers. De browser krijgt een willekeurig token in een HttpOnly-cookie
 * (SameSite=Strict, Secure, __Host-prefix); in D1 staat enkel de SHA-256 ervan.
 * Frontend en API draaien onder dezelfde hostnaam (de frontend stuurt /api/* door), dus het cookie
 * is first-party en wordt nooit naar een andere site gestuurd.
 */

const SESSIE_UREN = 8;
const INACTIEF_UREN = 2;
const VENSTER_MINUTEN = 15;

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const uren = (u: number) => u * 3_600_000;

export function willekeurigToken(bytes = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const https = (env: Env) => new URL(env.PUBLIC_APP_URL).protocol === 'https:';
const cookieNaam = (env: Env) => (https(env) ? '__Host-beheer' : 'beheer');

function leesCookie(request: Request, naam: string): string | null {
  for (const deel of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = deel.trim().split('=');
    if (k === naam) return v.join('=');
  }
  return null;
}

/** Wijzigende aanvragen met een sessiecookie moeten van onze eigen frontend komen (aanvulling op SameSite=Strict). */
export function controleerOrigin(request: Request, env: Env): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  if (request.headers.get('Origin') !== new URL(env.PUBLIC_APP_URL).origin) throw new DbFout('GEEN_TOEGANG');
}

/** Maakt een sessie en geeft de Set-Cookie-header terug. */
export async function startSessie(env: Env, request: Request, gebruikerId: string, methode: 'totp' | 'passkey'): Promise<string> {
  const token = willekeurigToken();
  await env.DB.prepare(
    `insert into beheer_sessies (sessie_hash, gebruiker_id, methode, verloopt_op, laatst_gezien, ip_adres) values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256(token), gebruikerId, methode, iso(uren(SESSIE_UREN)), iso(), request.headers.get('CF-Connecting-IP'))
    .run();
  return `${cookieNaam(env)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSIE_UREN * 3600}${https(env) ? '; Secure' : ''}`;
}

/** E-mailadres van de aangemelde medewerker, of null zonder geldige sessie. */
export async function sessieEmail(request: Request, env: Env): Promise<string | null> {
  const token = leesCookie(request, cookieNaam(env));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await sha256(token);
  const r = await env.DB.prepare(
    `select g.email from beheer_sessies s join gebruikers g on g.gebruiker_id = s.gebruiker_id
     where s.sessie_hash = ? and s.verloopt_op > ? and s.laatst_gezien > ? and g.actief = 1`,
  )
    .bind(hash, iso(), iso(-uren(INACTIEF_UREN)))
    .first<{ email: string }>();
  if (!r) return null;
  controleerOrigin(request, env);
  await env.DB.prepare(`update beheer_sessies set laatst_gezien = ? where sessie_hash = ? and laatst_gezien < ?`)
    .bind(iso(), hash, iso(-300_000))
    .run();
  return r.email.toLowerCase();
}

/** Beëindigt de huidige sessie en geeft een Set-Cookie terug die het cookie wist. */
export async function beeindigSessie(request: Request, env: Env): Promise<string> {
  const token = leesCookie(request, cookieNaam(env));
  if (token) await env.DB.prepare(`delete from beheer_sessies where sessie_hash = ?`).bind(await sha256(token)).run();
  return `${cookieNaam(env)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${https(env) ? '; Secure' : ''}`;
}

// ---------------------------------------------------------------------------
// Pogingen beperken (gokken van codes)
// ---------------------------------------------------------------------------
export async function controleerLimiet(env: Env, sleutel: string, max: number): Promise<void> {
  const r = await env.DB.prepare(`select aantal from aanmeld_pogingen where sleutel = ? and venster_start > ?`)
    .bind(sleutel, iso(-VENSTER_MINUTEN * 60_000))
    .first<{ aantal: number }>();
  if (r && r.aantal >= max) throw new DbFout('TE_VEEL_POGINGEN');
}

export async function telMislukking(env: Env, sleutel: string): Promise<void> {
  const grens = iso(-VENSTER_MINUTEN * 60_000);
  await env.DB.prepare(
    `insert into aanmeld_pogingen (sleutel, aantal, venster_start) values (?1, 1, ?2)
     on conflict (sleutel) do update set
       aantal = case when venster_start < ?3 then 1 else aantal + 1 end,
       venster_start = case when venster_start < ?3 then ?2 else venster_start end`,
  )
    .bind(sleutel, iso(), grens)
    .run();
}

export const wisTeller = (env: Env, sleutel: string) => env.DB.prepare(`delete from aanmeld_pogingen where sleutel = ?`).bind(sleutel).run();

// ---------------------------------------------------------------------------
// WebAuthn-uitdagingen
// ---------------------------------------------------------------------------
export async function maakUitdaging(env: Env, doel: 'registratie' | 'login', gebruikerId: string | null): Promise<string> {
  const uitdaging = willekeurigToken(32);
  await env.DB.prepare(`insert into aanmeld_uitdagingen (uitdaging, doel, gebruiker_id, verloopt_op) values (?, ?, ?, ?)`)
    .bind(uitdaging, doel, gebruikerId, iso(5 * 60_000))
    .run();
  return uitdaging;
}

/** Verbruikt een uitdaging (eenmalig). Geeft de gebruiker terug waarvoor ze bedoeld was (null bij 'login'). */
export async function verbruikUitdaging(env: Env, uitdaging: string, doel: 'registratie' | 'login'): Promise<{ gebruikerId: string | null }> {
  const r = await env.DB.prepare(
    `delete from aanmeld_uitdagingen where uitdaging = ? and doel = ? and verloopt_op > ? returning gebruiker_id`,
  )
    .bind(uitdaging, doel, iso())
    .first<{ gebruiker_id: string | null }>();
  if (!r) throw new DbFout('AANMELDEN_MISLUKT');
  return { gebruikerId: r.gebruiker_id };
}

/** Dagelijks opruimen: verlopen sessies, uitdagingen en tellers. */
export async function ruimAanmeldingOp(env: Env): Promise<void> {
  const nu = iso();
  await env.DB.batch([
    env.DB.prepare(`delete from beheer_sessies where verloopt_op < ? or laatst_gezien < ?`).bind(nu, iso(-uren(INACTIEF_UREN))),
    env.DB.prepare(`delete from aanmeld_uitdagingen where verloopt_op < ?`).bind(nu),
    env.DB.prepare(`delete from aanmeld_pogingen where venster_start < ?`).bind(iso(-VENSTER_MINUTEN * 60_000)),
  ]);
}
