export interface Env {
  DB: D1Database;
  /** Workers Rate Limiting (wrangler.toml [[ratelimits]]); ontbreekt lokaal en in tests = geen beperking. */
  RL_REGISTRATIE?: RateLimit;
  RL_MELDING?: RateLimit;
  /** R2 (jurisdictie EU): schermafbeeldingen bij meldingen. */
  STORAGE: R2Bucket;
  /** Optioneel: mailbox die een seintje krijgt bij een nieuwe melding (enkel @onderwijs.gent.be). */
  MELDINGEN_MAIL?: string;
  /** Secret – 64 hex-tekens. Versleutelt de persoonsgegevens in D1. Kwijt = gegevens onleesbaar. */
  ENCRYPTION_KEY: string;
  /** Komma-gescheiden lijst van toegelaten origins, bv. https://inschrijven.example.be */
  ALLOWED_ORIGINS: string;
  /** Publieke URL van de frontend, voor de beheerlink in de bevestigingsmail. */
  PUBLIC_APP_URL: string;
  /** Cloudflare Turnstile (optioneel lokaal, verplicht in productie). */
  TURNSTILE_SECRET?: string;
  /** De hoofdadmin: de enige die zich de eerste keer kan activeren met HOOFDADMIN_SETUP_CODE. Moet @onderwijs.gent.be zijn. */
  HOOFDADMIN_EMAIL?: string;
  /** Secret – eenmalige code waarmee de hoofdadmin zijn authenticator/passkey koppelt (`wrangler secret put`). */
  HOOFDADMIN_SETUP_CODE?: string;
  /** Enkel lokaal (localhost): meld aan als deze medewerker, zonder authenticator. */
  DEV_BEHEER_EMAIL?: string;
  /** 'graph' (Microsoft 365 via de eigen tenant) of 'log' (enkel loggen, voor ontwikkeling). */
  MAIL_PROVIDER?: 'graph' | 'log';
  GRAPH_TENANT_ID?: string;
  GRAPH_CLIENT_ID?: string;
  GRAPH_CLIENT_SECRET?: string;
  GRAPH_SENDER?: string;
}

export interface DeelnemerInvoer {
  naam: string;
  voornaam: string;
  email: string;
  contactVoornaam?: string;
  contactNaam?: string;
  telefoon?: string;
  schoolId?: string;
  schoolAndere?: string;
  gemeente?: string;
  leerjaar?: string;
  functie?: string;
  opmerkingen?: string;
  doelgroepId?: string;
  privacyAkkoord: boolean;
}

export interface RegistratieInvoer {
  deelnemer: DeelnemerInvoer;
  dagdelen: string[];
  sessies: string[];
  turnstileToken?: string;
  /** Honeypot: echte gebruikers laten dit veld leeg. */
  website?: string;
}

export interface Moment {
  dagdeelId?: string;
  dag: string;
  dagdeel: string;
  startUur: string;
  eindUur: string;
  status?: string;
}

export interface Keuze {
  sessieId?: string;
  titel: string;
  tijdsblok: string;
  startUur: string;
  locatie: string | null;
  status: string;
}

export interface RegistratieResultaat {
  deelnemerId: string;
  referentie: string;
  evenement: string;
  contactEmail: string | null;
  momenten: Moment[];
  keuzes: Keuze[];
}
