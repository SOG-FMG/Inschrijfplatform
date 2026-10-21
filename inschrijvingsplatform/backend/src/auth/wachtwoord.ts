import { gelijk } from './totp';

/**
 * Wachtwoorden: PBKDF2-SHA256 met 100 000 iteraties (het maximum dat Workers toelaat) en een willekeurig zout.
 * Formaat: 'pbkdf2-sha256$<iteraties>$<zout b64>$<hash b64>'.
 */

const ITERATIES = 100_000;
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const vanB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function afleiden(wachtwoord: string, zout: Uint8Array, iteraties: number): Promise<Uint8Array> {
  const sleutel = await crypto.subtle.importKey('raw', enc.encode(wachtwoord.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: zout, iterations: iteraties }, sleutel, 256));
}

export async function hashWachtwoord(wachtwoord: string): Promise<string> {
  const zout = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIES}$${b64(zout)}$${b64(await afleiden(wachtwoord, zout, ITERATIES))}`;
}

/** Ongeldige maar correct opgebouwde hash: zo kost een onbekend adres even veel tijd als een gekend adres. */
const DUMMY = `pbkdf2-sha256$${ITERATIES}$${'A'.repeat(22)}==$${'A'.repeat(43)}=`;

export async function controleerWachtwoord(wachtwoord: string, opgeslagen: string | null | undefined): Promise<boolean> {
  const [soort, iter, zout, hash] = (opgeslagen ?? DUMMY).split('$');
  const n = Number(iter);
  if (soort !== 'pbkdf2-sha256' || !Number.isInteger(n) || n < 1 || n > ITERATIES || !zout || !hash) return false;
  const berekend = b64(await afleiden(wachtwoord, vanB64(zout), n));
  return gelijk(berekend, hash) && opgeslagen != null;
}

/** Regels voor een nieuw wachtwoord. Geeft een melding of null. */
export function wachtwoordProbleem(wachtwoord: unknown, email: string): string | null {
  if (typeof wachtwoord !== 'string' || wachtwoord.length < 12) return 'Kies een wachtwoord van minstens 12 tekens.';
  if (wachtwoord.length > 200) return 'Het wachtwoord is te lang.';
  const laag = wachtwoord.toLowerCase();
  const lokaal = email.split('@')[0].toLowerCase();
  if (laag.includes(lokaal) || laag.includes('onderwijs') || /^(.)\1+$/.test(wachtwoord) || /^(0123456789|123456789|azerty|qwerty|wachtwoord|password)/.test(laag)) {
    return 'Dit wachtwoord is te makkelijk te raden. Kies iets anders (bv. een zin van vier woorden).';
  }
  return null;
}
