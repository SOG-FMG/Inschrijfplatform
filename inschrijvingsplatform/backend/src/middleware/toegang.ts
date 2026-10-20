import { DbFout } from '../db/fouten';
import type { Env } from '../types';

/**
 * Vervangt Supabase Auth + Row Level Security.
 *
 * 1. Aanmelden: Cloudflare Access (Zero Trust, met Entra ID als identity provider) staat
 *    vóór /api/beheer/* en geeft een ondertekend JWT mee (header Cf-Access-Jwt-Assertion).
 *    De Worker controleert handtekening, audience, issuer en vervaldatum zelf: wie de
 *    Worker rechtstreeks aanspreekt (bv. via workers.dev) komt er zo niet langs.
 * 2. Rechten: per evenement, met dezelfde regels als is_beheerder() in de PostgreSQL-versie.
 *    Elke beheerroute roept controleerToegang() aan vóór ze gegevens leest of schrijft.
 */

export interface Gebruiker {
  gebruikerId: string;
  email: string;
  rol: 'platformbeheerder' | 'schoolbeheerder' | 'organisator' | 'onthaal';
  schoolId: string | null;
}

/** Enkel accounts van dit domein krijgen toegang tot beheer en gegevens, ongeacht de Access-policy. */
export const TOEGELATEN_DOMEIN = 'onderwijs.gent.be';

export const isToegelatenEmail = (email: string) =>
  /^[^@\s]+@[^@\s]+$/.test(email) && email.toLowerCase().endsWith(`@${TOEGELATEN_DOMEIN}`);

export async function huidigeGebruiker(request: Request, env: Env): Promise<Gebruiker> {
  const email = await aangemeldEmail(request, env);
  // Tweede slot naast de Access-policy: een te ruime policy of een gebruikersrij
  // met een extern adres geeft zo nooit toegang.
  if (!isToegelatenEmail(email)) throw new DbFout('GEEN_TOEGANG');
  const g = await env.DB.prepare(
    `select g.gebruiker_id, g.email, g.school_id, r.code as rol
     from gebruikers g join rollen r on r.rol_id = g.rol_id
     where g.email = ? and g.actief = 1`,
  )
    .bind(email)
    .first<{ gebruiker_id: string; email: string; school_id: string | null; rol: Gebruiker['rol'] }>();
  if (!g) throw new DbFout('GEEN_TOEGANG');
  return { gebruikerId: g.gebruiker_id, email: g.email, rol: g.rol, schoolId: g.school_id };
}

/** Gooit GEEN_TOEGANG tenzij de gebruiker dit evenement mag lezen (of, met schrijven, wijzigen). */
export async function controleerToegang(env: Env, g: Gebruiker, evenementId: string, schrijven = false): Promise<void> {
  if (g.rol === 'platformbeheerder') return;
  const ok = await env.DB.prepare(
    `select 1 from evenementen e
     where e.evenement_id = ?1
       and (exists (select 1 from evenement_beheerders b
                    where b.evenement_id = e.evenement_id and b.gebruiker_id = ?2
                      and (?3 = 0 or b.rol = 'organisator'))
            or (?4 = 'schoolbeheerder' and e.school_id = ?5))`,
  )
    .bind(evenementId, g.gebruikerId, schrijven ? 1 : 0, g.rol, g.schoolId)
    .first();
  if (!ok) throw new DbFout('GEEN_TOEGANG');
}

async function aangemeldEmail(request: Request, env: Env): Promise<string> {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN) {
    if (!jwt) throw new DbFout('NIET_AANGEMELD');
    return verifieerAccessJwt(jwt, env.ACCESS_TEAM_DOMAIN.replace(/\/$/, ''), env.ACCESS_AUD);
  }
  // Lokale ontwikkeling zonder Access: enkel op localhost en enkel als het expliciet ingesteld is.
  const host = new URL(request.url).hostname;
  if (env.DEV_BEHEER_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return env.DEV_BEHEER_EMAIL.toLowerCase();
  throw new DbFout('NIET_AANGEMELD');
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT (RS256), sleutels per isolate gecachet
// ---------------------------------------------------------------------------
let jwks: { domein: string; opgehaald: number; sleutels: Map<string, CryptoKey> } | null = null;

async function accessSleutel(domein: string, kid: string): Promise<CryptoKey | undefined> {
  const leeftijd = jwks ? Date.now() - jwks.opgehaald : Infinity;
  // Vernieuwen na een uur, of bij een onbekende kid (sleutelrotatie) – maar hoogstens om de 5 minuten.
  if (!jwks || jwks.domein !== domein || leeftijd > 3_600_000 || (!jwks.sleutels.has(kid) && leeftijd > 300_000)) {
    const res = await fetch(`${domein}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access certs ${res.status}`);
    const { keys } = await res.json<{ keys: (JsonWebKey & { kid: string })[] }>();
    const sleutels = new Map<string, CryptoKey>();
    for (const k of keys) {
      sleutels.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    jwks = { domein, opgehaald: Date.now(), sleutels };
  }
  return jwks.sleutels.get(kid);
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function verifieerAccessJwt(jwt: string, domein: string, aud: string): Promise<string> {
  const weiger = () => new DbFout('NIET_AANGEMELD');
  const [h, p, s] = jwt.split('.');
  if (!h || !p || !s) throw weiger();
  let header, claims;
  try {
    header = b64urlJson(h);
    claims = b64urlJson(p);
  } catch {
    throw weiger();
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw weiger();
  const sleutel = await accessSleutel(domein, header.kid);
  if (!sleutel) throw weiger();
  const geldig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', sleutel, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  const nu = Date.now() / 1000;
  const audiences: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !geldig ||
    !audiences.includes(aud) ||
    claims.iss !== domein ||
    typeof claims.exp !== 'number' ||
    claims.exp < nu ||
    (typeof claims.nbf === 'number' && claims.nbf > nu + 60) ||
    typeof claims.email !== 'string'
  ) {
    throw weiger();
  }
  return claims.email.toLowerCase();
}
