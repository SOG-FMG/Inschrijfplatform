import { DbFout } from '../kern/fouten';
import type { Env } from '../types';

/**
 * WebAuthn (passkeys) zonder externe bibliotheek.
 *
 * - Registratie: de browser levert de publieke sleutel zelf aan (getPublicKey(), SPKI); attestation = 'none'.
 * - Aanmelden: handtekening over authenticatorData ‖ SHA-256(clientDataJSON), uitdaging eenmalig, origin en rpId vast.
 * - Altijd gebruikersverificatie vereist (pincode, vingerafdruk of gezichtsherkenning), dus een passkey is op zich al twee factoren.
 * - Ondersteund: ES256 (-7) en RS256 (-257). Dat dekt Windows Hello, Touch ID, Android en beveiligingssleutels.
 */

export const ALGORITMEN = [-7, -257] as const;

export const naarB64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const vanB64u = (s: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new DbFout('ONGELDIGE_GEGEVENS');
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};

/** rpId en origin volgen de publieke URL van de frontend. Een ander domein later = passkeys opnieuw registreren. */
export function rpInfo(env: Env) {
  const u = new URL(env.PUBLIC_APP_URL);
  return { rpId: u.hostname, origin: u.origin };
}

const ongeldig = () => new DbFout('AANMELDEN_MISLUKT');

function leesClientData(b64: unknown, type: string, origin: string) {
  if (typeof b64 !== 'string') throw ongeldig();
  const bytes = vanB64u(b64);
  let data: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw ongeldig();
  }
  if (data.type !== type || data.origin !== origin || data.crossOrigin === true || typeof data.challenge !== 'string') throw ongeldig();
  return { bytes, challenge: data.challenge };
}

/** Haalt de uitdaging uit clientDataJSON, nodig om ze in de database op te zoeken vóór de rest gecontroleerd wordt. */
export function uitdagingUitClientData(b64: unknown): string {
  try {
    const d = JSON.parse(new TextDecoder().decode(vanB64u(String(b64))));
    if (typeof d.challenge === 'string') return d.challenge;
  } catch {
    /* val door */
  }
  throw ongeldig();
}

async function controleerAuthData(env: Env, auth: Uint8Array) {
  if (auth.length < 37) throw ongeldig();
  const verwacht = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpInfo(env).rpId)));
  for (let i = 0; i < 32; i++) if (auth[i] !== verwacht[i]) throw ongeldig();
  const flags = auth[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw ongeldig(); // aanwezigheid (UP) én gebruikersverificatie (UV)
  return { flags, teller: new DataView(auth.buffer, auth.byteOffset).getUint32(33) };
}

function sleutelParams(alg: number): Parameters<SubtleCrypto["importKey"]>[2] {
  return alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
}

export interface RegistratieInvoer {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algoritme: number;
  naam?: string;
}

export async function verifieerRegistratie(env: Env, inv: RegistratieInvoer, uitdaging: string) {
  const { origin } = rpInfo(env);
  const cd = leesClientData(inv.clientDataJSON, 'webauthn.create', origin);
  if (cd.challenge !== uitdaging) throw ongeldig();
  if (!(ALGORITMEN as readonly number[]).includes(inv.algoritme)) throw ongeldig();
  const auth = vanB64u(inv.authenticatorData);
  const { flags } = await controleerAuthData(env, auth);
  // De sleutel-id uit authenticatorData moet overeenkomen met wat de browser meldt.
  if (!(flags & 0x40) || auth.length < 55) throw ongeldig();
  const idLengte = (auth[53] << 8) | auth[54];
  const id = naarB64u(auth.slice(55, 55 + idLengte));
  if (id !== inv.id) throw ongeldig();
  // Moet een geldige publieke sleutel zijn.
  try {
    await crypto.subtle.importKey('spki', vanB64u(inv.publicKey), sleutelParams(inv.algoritme), false, ['verify']);
  } catch {
    throw ongeldig();
  }
  return { credentialId: id, publicKey: inv.publicKey, algoritme: inv.algoritme };
}

export interface AanmeldInvoer {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  handtekening: string;
}

/** ECDSA-handtekeningen komen als DER uit WebAuthn; WebCrypto verwacht r‖s (2 × 32 bytes). */
function derNaarRaw(der: Uint8Array): Uint8Array {
  let i = 2;
  if (der[0] !== 0x30) throw ongeldig();
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const getal = () => {
    if (der[i++] !== 0x02) throw ongeldig();
    const lengte = der[i++];
    let x = der.slice(i, i + lengte);
    i += lengte;
    while (x.length > 32 && x[0] === 0) x = x.slice(1);
    if (x.length > 32) throw ongeldig();
    const uit = new Uint8Array(32);
    uit.set(x, 32 - x.length);
    return uit;
  };
  const r = getal();
  const s = getal();
  const raw = new Uint8Array(64);
  raw.set(r);
  raw.set(s, 32);
  return raw;
}

/** Geeft de nieuwe tellerstand terug. */
export async function verifieerAanmelding(
  env: Env,
  inv: AanmeldInvoer,
  uitdaging: string,
  sleutel: { public_key: string; algoritme: number; teller: number },
): Promise<number> {
  const { origin } = rpInfo(env);
  const cd = leesClientData(inv.clientDataJSON, 'webauthn.get', origin);
  if (cd.challenge !== uitdaging) throw ongeldig();
  const auth = vanB64u(inv.authenticatorData);
  const { teller } = await controleerAuthData(env, auth);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', cd.bytes));
  const gesigneerd = new Uint8Array(auth.length + hash.length);
  gesigneerd.set(auth);
  gesigneerd.set(hash, auth.length);

  const handtekening = vanB64u(inv.handtekening);
  const key = await crypto.subtle.importKey('spki', vanB64u(sleutel.public_key), sleutelParams(sleutel.algoritme), false, ['verify']);
  const geldig =
    sleutel.algoritme === -7
      ? await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derNaarRaw(handtekening), gesigneerd)
      : await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, handtekening, gesigneerd);
  if (!geldig) throw ongeldig();
  // Een teller die niet stijgt wijst op een gekloonde sleutel (veel authenticators sturen altijd 0).
  if ((teller !== 0 || sleutel.teller !== 0) && teller <= sleutel.teller) throw ongeldig();
  return teller;
}

