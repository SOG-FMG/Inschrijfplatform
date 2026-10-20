import type { Env } from '../types';

/**
 * Versleuteling van persoonsgegevens op applicatieniveau.
 *
 * Eén geheim (ENCRYPTION_KEY, 32 bytes hex) → via HKDF twee onafhankelijke sleutels:
 *  - AES-256-GCM voor de *_enc-kolommen
 *  - HMAC-SHA256 voor blinde indexen (zoeken en dubbels weigeren zonder te ontsleutelen)
 * Dezelfde sleutel voor beide doeleinden gebruiken is af te raden; afleiden lost dat op.
 *
 * Formaat: 'v1.' + base64(iv ‖ ciphertext). Het versieprefix laat later sleutelrotatie toe.
 */

const VERSIE = 'v1';
const enc = new TextEncoder();

interface Sleutels {
  aes: CryptoKey;
  hmac: CryptoKey;
}

let cache: { geheim: string; sleutels: Promise<Sleutels> } | null = null;

function sleutels(env: Env): Promise<Sleutels> {
  if (cache?.geheim !== env.ENCRYPTION_KEY) {
    cache = { geheim: env.ENCRYPTION_KEY, sleutels: afleiden(env.ENCRYPTION_KEY) };
    cache.sleutels.catch(() => (cache = null));
  }
  return cache.sleutels;
}

async function afleiden(geheim: string | undefined): Promise<Sleutels> {
  if (!geheim || !/^[0-9a-fA-F]{64}$/.test(geheim)) {
    throw new Error('ENCRYPTION_KEY ontbreekt of is geen 64 hex-tekens (32 bytes).');
  }
  const basis = await crypto.subtle.importKey('raw', hexNaarBytes(geheim), 'HKDF', false, ['deriveKey']);
  const hkdf = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: enc.encode(info) });
  const [aes, hmac] = await Promise.all([
    crypto.subtle.deriveKey(hkdf(`inschrijvingsplatform/aes-gcm/${VERSIE}`), basis, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    crypto.subtle.deriveKey(hkdf(`inschrijvingsplatform/hmac/${VERSIE}`), basis, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, [
      'sign',
    ]),
  ]);
  return { aes, hmac };
}

/** Versleutelt een waarde; lege waarden blijven null (niets te beschermen). */
export async function versleutel(env: Env, tekst: string | null | undefined): Promise<string | null> {
  if (tekst == null || tekst === '') return null;
  const { aes } = await sleutels(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(tekst)));
  const samen = new Uint8Array(iv.length + data.length);
  samen.set(iv);
  samen.set(data, iv.length);
  return `${VERSIE}.${naarBase64(samen)}`;
}

export async function ontsleutel(env: Env, waarde: string | null | undefined): Promise<string | null> {
  if (waarde == null) return null;
  const [versie, b64] = waarde.split('.', 2);
  if (versie !== VERSIE || !b64) throw new Error(`Onbekend versleutelingsformaat '${versie}'.`);
  const { aes } = await sleutels(env);
  const samen = vanBase64(b64);
  const tekst = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: samen.slice(0, 12) }, aes, samen.slice(12));
  return new TextDecoder().decode(tekst);
}

/** HMAC-SHA256 (hex) over de genormaliseerde delen. Deterministisch, dus bruikbaar in een unieke index. */
export async function blindeIndex(env: Env, ...delen: string[]): Promise<string> {
  const { hmac } = await sleutels(env);
  const invoer = delen.map((d) => d.normalize('NFC')).join('\u001f');
  return naarHex(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, enc.encode(invoer))));
}

export async function sha256(tekst: string): Promise<string> {
  return naarHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(tekst))));
}

function hexNaarBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const naarHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const naarBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const vanBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
