import type { Env } from '../types';
import type { Gebruiker } from './toegang';

/** Auditregel (wie, wat, wanneer). Nooit persoonsgegevens in oude/nieuwe waarde: enkel id's. */
export function audit(env: Env, g: Gebruiker | null, entiteit: string, recordId: string, actie: string, nieuw?: unknown, ip?: string | null) {
  return env.DB.prepare(
    `insert into audit_log (log_id, gebruiker_id, entiteit, record_id, actie, nieuwe_waarde, ip_adres) values (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), g?.gebruikerId ?? null, entiteit, recordId, actie, nieuw === undefined ? null : JSON.stringify(nieuw), ip ?? null);
}
