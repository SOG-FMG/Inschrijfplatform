/** TOTP (RFC 6238): HMAC-SHA1, 30 seconden, 6 cijfers – compatibel met elke authenticator-app. */

const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STAP_MS = 30_000;

export function naarBase32(bytes: Uint8Array): string {
  let bits = 0;
  let waarde = 0;
  let uit = '';
  for (const b of bytes) {
    waarde = (waarde << 8) | b;
    bits += 8;
    while (bits >= 5) {
      uit += ALFABET[(waarde >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) uit += ALFABET[(waarde << (5 - bits)) & 31];
  return uit;
}

export function vanBase32(tekst: string): Uint8Array {
  let bits = 0;
  let waarde = 0;
  const uit: number[] = [];
  for (const c of tekst.toUpperCase().replace(/=+$/, '')) {
    const i = ALFABET.indexOf(c);
    if (i < 0) throw new Error('Ongeldige base32-tekens.');
    waarde = (waarde << 5) | i;
    bits += 5;
    if (bits >= 8) {
      uit.push((waarde >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(uit);
}

/** Nieuw geheim van 160 bit (de lengte die authenticator-apps verwachten). */
export const nieuwTotpGeheim = () => naarBase32(crypto.getRandomValues(new Uint8Array(20)));

export async function totpCode(geheim: string, stap: number): Promise<string> {
  const sleutel = await crypto.subtle.importKey('raw', vanBase32(geheim), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(stap / 2 ** 32));
  view.setUint32(4, stap >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', sleutel, buf));
  const o = h[19] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const huidigeStap = (nu = Date.now()) => Math.floor(nu / STAP_MS);

/** Vergelijking in constante tijd (bij gelijke lengte). */
export function gelijk(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let verschil = 0;
  for (let i = 0; i < a.length; i++) verschil |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return verschil === 0;
}

/**
 * Controleert een code met één stap speling (klokverschil). Geeft de gebruikte tijdstap terug, of null.
 * Een stap die al gebruikt werd (`laatsteStap`) of ouder is, wordt geweigerd: een afgekeken code is niet opnieuw bruikbaar.
 */
export async function controleerTotp(geheim: string, invoer: string, laatsteStap: number, nu = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(invoer)) return null;
  const stap = huidigeStap(nu);
  let gevonden: number | null = null;
  for (const s of [stap - 1, stap, stap + 1]) {
    if (gelijk(await totpCode(geheim, s), invoer) && s > laatsteStap) gevonden = s;
  }
  return gevonden;
}
