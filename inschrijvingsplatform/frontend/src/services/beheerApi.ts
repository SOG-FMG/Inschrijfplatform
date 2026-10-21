import { ApiFout } from '../types';
import { BASIS } from './api';

/** Aanroepen voor medewerkers. De sessie zit in een HttpOnly-cookie; hier is geen token om te bewaren. */
async function call<T>(pad: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASIS}${pad}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiFout('NETWERK', 'Geen verbinding. Controleer je internet en probeer opnieuw.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFout(data?.fout ?? 'SERVERFOUT', data?.melding ?? 'Er ging iets mis.', data?.velden, data?.id);
  return data as T;
}

export interface Profiel {
  email: string;
  rol: 'platformbeheerder' | 'schoolbeheerder' | 'organisator' | 'onthaal';
  voornaam: string;
  naam: string;
  passkeys: { id: string; naam: string; aangemaakt: string; laatstGebruikt: string | null }[];
  evenementen: { id: string; titel: string; slug: string; start: string; status: string }[];
}

export interface BeheerGebruiker {
  id: string;
  voornaam: string;
  naam: string;
  email: string;
  actief: number;
  rol: string;
  heeftAuthenticator: number;
  aantalPasskeys: number;
  uitnodigingOpen: number;
}

export interface Uitnodiging {
  uitnodigingscode: string;
  geldigTot: string;
}

export const beheerApi = {
  profiel: () => call<Profiel>('/api/beheer/ik'),
  afmelden: () => call<{ ok: true }>('/api/auth/afmelden', { method: 'POST', body: {} }),
  aanmelden: (email: string, code: string) => call<{ ok: true }>('/api/auth/aanmelden', { method: 'POST', body: { email, code } }),
  activeerStart: (email: string, code: string) =>
    call<{ geheim: string; otpauth: string }>('/api/auth/activeren/start', { method: 'POST', body: { email, code } }),
  activeerBevestig: (email: string, code: string, totp: string) =>
    call<{ ok: true }>('/api/auth/activeren/bevestig', { method: 'POST', body: { email, code, totp } }),
  passkeyLoginOpties: () => call<any>('/api/auth/passkey/opties', { method: 'POST', body: {} }),
  passkeyLogin: (body: unknown) => call<{ ok: true }>('/api/auth/passkey/aanmelden', { method: 'POST', body }),
  passkeyRegistratieOpties: () => call<any>('/api/beheer/passkeys/opties', { method: 'POST', body: {} }),
  passkeyOpslaan: (body: unknown) => call<{ ok: true }>('/api/beheer/passkeys', { method: 'POST', body }),
  passkeyVerwijder: (id: string) => call<{ ok: true }>(`/api/beheer/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  gebruikers: () => call<BeheerGebruiker[]>('/api/beheer/gebruikers'),
  maakGebruiker: (g: { voornaam: string; naam: string; email: string; rol: string; evenementIds: string[] }) =>
    call<Uitnodiging & { id: string }>('/api/beheer/gebruikers', { method: 'POST', body: g }),
  resetGebruiker: (id: string) => call<Uitnodiging>(`/api/beheer/gebruikers/${id}/reset`, { method: 'POST', body: {} }),
  zetActief: (id: string, actief: boolean) => call<{ ok: true }>(`/api/beheer/gebruikers/${id}`, { method: 'PATCH', body: { actief } }),
  csvUrl: (evenementId: string) => `${BASIS}/api/beheer/evenementen/${evenementId}/deelnemers.csv`,
};

export type InstellingSoort = 'evenement' | 'doelgroep' | 'dag' | 'dagdeel' | 'tijdsblok' | 'sessie';

export interface InstellingVeld {
  naam: string;
  label: string;
  type: 'tekst' | 'lang' | 'datum' | 'uur' | 'datumtijd' | 'getal' | 'jaNee' | 'keuze' | 'slug' | 'email' | 'lijst' | 'ref';
  verplicht?: boolean;
  opties?: { waarde: string; label: string }[];
  ref?: 'doelgroep' | 'soort' | 'locatie';
  hulp?: string;
  standaard?: unknown;
}

export const instellingenApi = {
  lees: (evenementId: string) => call<any>(`/api/beheer/evenementen/${encodeURIComponent(evenementId)}/instellingen`),
  wijzig: (soort: InstellingSoort, id: string, waarden: Record<string, unknown>) =>
    call<{ ok: true }>(`/api/beheer/instellingen/${soort}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { waarden } }),
  maak: (soort: InstellingSoort, ouderId: string | null, waarden: Record<string, unknown>) =>
    call<{ id: string }>(`/api/beheer/instellingen/${soort}`, { method: 'POST', body: { ouderId, waarden } }),
  verwijder: (soort: InstellingSoort, id: string) =>
    call<{ ok: true }>(`/api/beheer/instellingen/${soort}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
