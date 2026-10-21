import { ApiFout } from '../types';
import { BASIS } from './api';

/** Aanroepen voor het beheer. De sessie zit in een HttpOnly-cookie; hier is geen token om te bewaren. */
async function call<T>(pad: string, init?: { method?: string; body?: unknown; ruw?: { data: Blob; type: string } }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASIS}${pad}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers: { 'Content-Type': init?.ruw?.type ?? 'application/json' },
      body: init?.ruw ? init.ruw.data : init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiFout('NETWERK', 'Geen verbinding. Controleer je internet en probeer opnieuw.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiFout(data?.fout ?? 'SERVERFOUT', data?.melding ?? 'Er ging iets mis.', data?.velden, data?.id);
  return data as T;
}

export type Rol = 'platformbeheerder' | 'schoolbeheerder' | 'organisator' | 'onthaal';

export interface EvenementKort {
  id: string;
  titel: string;
  slug: string;
  start: string;
  eind: string;
  status: string;
  inschrijvingTot: string | null;
  deelnemers: number;
  wachtlijst: number;
  bewaartermijn: number;
  heeftPrivacytekst: number;
  mailMislukt: number;
}

export interface Profiel {
  email: string;
  rol: Rol;
  voornaam: string;
  naam: string;
  heeftWachtwoord: boolean;
  heeftAuthenticator: boolean;
  passkeys: { id: string; naam: string; aangemaakt: string; laatstGebruikt: string | null }[];
  evenementen: EvenementKort[];
}

export interface BeheerGebruiker {
  id: string;
  voornaam: string;
  naam: string;
  email: string;
  actief: number;
  rol: Rol;
  heeftAuthenticator: number;
  heeftWachtwoord: number;
  aantalPasskeys: number;
  uitnodigingOpen: number;
  laatsteAanmelding: string | null;
  evenementIds: string[];
}

export interface Uitnodiging {
  uitnodigingscode: string;
  geldigTot: string;
}

export interface Koppeling {
  geheim: string;
  otpauth: string;
}

const post = <T>(pad: string, body: unknown = {}) => call<T>(pad, { method: 'POST', body });

export const beheerApi = {
  profiel: () => call<Profiel>('/api/beheer/ik'),
  afmelden: () => post<{ ok: true }>('/api/auth/afmelden'),
  aanmelden: (email: string, wachtwoord: string, code: string) => post<{ ok: true }>('/api/auth/aanmelden', { email, wachtwoord, code }),
  activeerStart: (email: string, code: string) => post<Koppeling>('/api/auth/activeren/start', { email, code }),
  activeerBevestig: (email: string, code: string, totp: string, wachtwoord: string) =>
    post<{ ok: true }>('/api/auth/activeren/bevestig', { email, code, totp, wachtwoord }),
  passkeyLoginOpties: () => post<any>('/api/auth/passkey/opties'),
  passkeyLogin: (body: unknown) => post<{ ok: true }>('/api/auth/passkey/aanmelden', body),

  // eigen account
  wijzigWachtwoord: (huidig: string, nieuw: string) => post<{ ok: true }>('/api/beheer/account/wachtwoord', { huidig, nieuw }),
  authenticatorStart: () => post<Koppeling>('/api/beheer/account/authenticator/start'),
  authenticatorBevestig: (code: string) => post<{ ok: true }>('/api/beheer/account/authenticator/bevestig', { code }),
  passkeyRegistratieOpties: () => post<any>('/api/beheer/passkeys/opties'),
  passkeyOpslaan: (body: unknown) => post<{ ok: true }>('/api/beheer/passkeys', body),
  passkeyVerwijder: (id: string) => call<{ ok: true }>(`/api/beheer/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // medewerkers (platformbeheer)
  gebruikers: () => call<BeheerGebruiker[]>('/api/beheer/gebruikers'),
  maakGebruiker: (g: { voornaam: string; naam: string; email: string; rol: string; evenementIds: string[] }) =>
    post<Uitnodiging & { id: string }>('/api/beheer/gebruikers', g),
  bewerkGebruiker: (id: string, wijziging: Partial<{ voornaam: string; naam: string; rol: string; evenementIds: string[]; actief: boolean }>) =>
    call<{ ok: true }>(`/api/beheer/gebruikers/${id}`, { method: 'PATCH', body: wijziging }),
  resetGebruiker: (id: string) => post<Uitnodiging>(`/api/beheer/gebruikers/${id}/reset`),
  testMail: () => post<{ ok: boolean; provider: string; status?: string; fout?: string }>('/api/beheer/mail/test'),

  csvUrl: (evenementId: string) => `${BASIS}/api/beheer/evenementen/${evenementId}/deelnemers.csv`,
};

export type InstellingSoort = 'evenement' | 'doelgroep' | 'dag' | 'dagdeel' | 'tijdsblok' | 'sessie';

export interface InstellingVeld {
  naam: string;
  label: string;
  type: 'tekst' | 'lang' | 'datum' | 'uur' | 'datumtijd' | 'getal' | 'jaNee' | 'keuze' | 'slug' | 'email' | 'lijst' | 'ref' | 'kleur' | 'logo';
  verplicht?: boolean;
  opties?: { waarde: string; label: string }[];
  ref?: 'doelgroep' | 'soort' | 'locatie';
  min?: number;
  max?: number;
  hulp?: string;
  standaard?: unknown;
}

export const instellingenApi = {
  lees: (evenementId: string) => call<any>(`/api/beheer/evenementen/${encodeURIComponent(evenementId)}/instellingen`),
  wijzig: (soort: InstellingSoort, id: string, waarden: Record<string, unknown>) =>
    call<{ ok: true }>(`/api/beheer/instellingen/${soort}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { waarden } }),
  maak: (soort: InstellingSoort, ouderId: string | null, waarden: Record<string, unknown>) =>
    post<{ id: string }>(`/api/beheer/instellingen/${soort}`, { ouderId, waarden }),
  verwijder: (soort: InstellingSoort, id: string) =>
    call<{ ok: true }>(`/api/beheer/instellingen/${soort}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadLogo: (evenementId: string, bestand: File) =>
    call<{ logo: string }>(`/api/beheer/evenementen/${encodeURIComponent(evenementId)}/logo`, { method: 'POST', ruw: { data: bestand, type: bestand.type } }),
  verwijderLogo: (evenementId: string) => call<{ ok: true }>(`/api/beheer/evenementen/${encodeURIComponent(evenementId)}/logo`, { method: 'DELETE' }),
};

export const kopieerApi = {
  /** Lesjes naar andere tijdsblokken; een lesje dat er al staat (zelfde code of titel) wordt overgeslagen. */
  sessies: (ids: string[], naar: string[]) =>
    post<{ gekopieerd: number; overgeslagen: { titel: string; tijdsblok: string }[] }>('/api/beheer/kopieer', { soort: 'sessies', ids, naar }),
  /** Een moment (dagdeel) met tijdsblokken en lesjes naar andere dagen. */
  dagdeel: (id: string, naar: string[]) => post<{ gekopieerd: number }>('/api/beheer/kopieer', { soort: 'dagdeel', ids: [id], naar }),
};

// ---------------------------------------------------------------------------
// Rapporten
// ---------------------------------------------------------------------------
export interface RapportDeelnemer {
  voornaam: string;
  naam: string;
  school: string;
  leerjaar: string;
  status: 'bevestigd' | 'wachtlijst';
}

export interface RapportSessie {
  id: string;
  titel: string;
  locatieId: string | null;
  lokaal: string | null;
  lesgever: string | null;
  lesgeverEmail: string | null;
  capaciteit: number | null;
  status: string;
  zichtbaar: boolean;
  bevestigd: number;
  wachtlijst: number;
  deelnemers: RapportDeelnemer[];
}

export interface RapportTijdsblok {
  id: string;
  naam: string;
  startUur: string;
  eindUur: string;
  sessies: RapportSessie[];
  zonderKeuze: RapportDeelnemer[];
}

export interface RapportDagdeel {
  id: string;
  naam: string;
  startUur: string;
  eindUur: string;
  capaciteit: number | null;
  status: string;
  ingeschreven: number;
  tijdsblokken: RapportTijdsblok[];
}

export interface Rapport {
  kanSchrijven: boolean;
  evenement: { id: string; titel: string; slug: string };
  teksten: Record<string, string>;
  locaties: { waarde: string; label: string }[];
  dagen: { id: string; naam: string; datum: string; dagdelen: RapportDagdeel[] }[];
}

const rapportPad = (id: string) => `/api/beheer/evenementen/${encodeURIComponent(id)}/rapport`;

export const rapportApi = {
  lees: (evenementId: string) => call<Rapport>(rapportPad(evenementId)),
  bewaarTeksten: (evenementId: string, teksten: Record<string, string>) =>
    call<{ teksten: Record<string, string> }>(`${rapportPad(evenementId)}/teksten`, { method: 'PATCH', body: { teksten } }),
  mail: (evenementId: string, sessieIds: string[]) =>
    post<{ verzonden: number; zonderAdres: string[]; mislukt: string[] }>(`${rapportPad(evenementId)}/mail`, { sessieIds }),
};

// ---------------------------------------------------------------------------
// Etiketten
// ---------------------------------------------------------------------------
export interface EtiketRegel {
  tekst: string;
  pt: number;
  vet: boolean;
  /** Op één lijn, zo groot mogelijk tot `pt`. */
  passend: boolean;
  /** Herhaald voor elk lesje van de deelnemer. */
  perLesje: boolean;
}

export interface EtiketInstellingen {
  blad: { breedte: number; hoogte: number };
  kolommen: number;
  rijen: number;
  marge: { boven: number; onder: number; links: number; rechts: number };
  tussen: { horizontaal: number; verticaal: number };
  binnen: number;
  regels: EtiketRegel[];
}

export interface EtiketLesje {
  titel: string;
  locatieId: string | null;
  dagdeelId: string;
  moment: string;
  startUur: string;
  eindUur: string;
}

export interface EtiketDeelnemer {
  voornaam: string;
  naam: string;
  school: string;
  leerjaar: string;
  doelgroep: string;
  dagdelen: string[];
  lesjes: EtiketLesje[];
}

export interface EtiketLokaal {
  id: string;
  naam: string;
  lokaal: string | null;
  gebouw: string | null;
  verdieping: string | null;
}

export interface Etiketten {
  kanSchrijven: boolean;
  evenement: { id: string; titel: string; slug: string };
  instellingen: EtiketInstellingen | null;
  dagdelen: { id: string; naam: string }[];
  lokalen: EtiketLokaal[];
  deelnemers: EtiketDeelnemer[];
}

const etiketPad = (id: string) => `/api/beheer/evenementen/${encodeURIComponent(id)}/etiketten`;

export const etiketApi = {
  lees: (evenementId: string) => call<Etiketten>(etiketPad(evenementId)),
  bewaar: (evenementId: string, instellingen: EtiketInstellingen | null) =>
    call<{ instellingen: EtiketInstellingen | null }>(`${etiketPad(evenementId)}/instellingen`, { method: 'PATCH', body: { instellingen } }),
  zetVerdieping: (evenementId: string, locatieId: string, verdieping: string) =>
    call<{ verdieping: string | null }>(`${etiketPad(evenementId)}/lokalen/${encodeURIComponent(locatieId)}`, { method: 'PATCH', body: { verdieping } }),
};
