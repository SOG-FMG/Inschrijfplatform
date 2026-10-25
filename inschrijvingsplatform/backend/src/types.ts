export interface Env {
  DB: D1Database;
  /** Workers Rate Limiting (wrangler.toml [[ratelimits]]); ontbreekt lokaal en in tests = geen beperking. */
  RL_REGISTRATIE?: RateLimit;
  RL_MELDING?: RateLimit;
  /** R2 (jurisdictie EU): schermafbeeldingen bij meldingen. */
  STORAGE: R2Bucket;
  /** Naam van de organisatie van deze installatie (zie src/kern/installatie.ts). */
  ORGANISATIE_NAAM?: string;
  /** Komma-gescheiden e-maildomeinen voor medewerkers, bv. "onderwijs.gent.be". "*" = elk adres (enkel op uitnodiging). Leeg = niemand. */
  AANMELD_DOMEINEN?: string;
  /** Hoe deze organisatie een sessiegever noemt (lesgever, spreker, artiest). Enkel en meervoud. */
  TERM_SESSIEGEVER?: string;
  TERM_SESSIEGEVERS?: string;
  /** Komma-gescheiden ids van de actieve modules (src/modules/index.ts). Ontbreekt het, dan zijn alle modules actief. */
  MODULES?: string;
  /** Optioneel: mailbox die een seintje krijgt bij een nieuwe melding (enkel een adres van AANMELD_DOMEINEN). */
  MELDINGEN_MAIL?: string;
  /** Secret – 64 hex-tekens. Versleutelt de persoonsgegevens in D1. Kwijt = gegevens onleesbaar. */
  ENCRYPTION_KEY: string;
  /** Komma-gescheiden lijst van toegelaten origins, bv. https://inschrijven.example.be */
  ALLOWED_ORIGINS: string;
  /** Publieke URL van de frontend, voor de beheerlink in de bevestigingsmail. */
  PUBLIC_APP_URL: string;
  /** Cloudflare Turnstile (optioneel lokaal, verplicht in productie). */
  TURNSTILE_SECRET?: string;
  /** De hoofdadmin: de enige die zich de eerste keer kan activeren met HOOFDADMIN_SETUP_CODE. Moet een adres van AANMELD_DOMEINEN zijn. */
  HOOFDADMIN_EMAIL?: string;
  /** Secret – eenmalige code waarmee de hoofdadmin zijn authenticator/passkey koppelt (`wrangler secret put`). */
  HOOFDADMIN_SETUP_CODE?: string;
  /** Enkel lokaal (localhost): meld aan als deze medewerker, zonder authenticator. */
  DEV_BEHEER_EMAIL?: string;
  /** 'webhook' (Power Automate-flow die de mail verstuurt), 'graph' (Microsoft Graph) of 'log' (enkel loggen, voor ontwikkeling). */
  MAIL_PROVIDER?: 'webhook' | 'graph' | 'log';
  /** Secret – het webhook-adres van de flow (Teams Workflows / Power Automate). */
  MAIL_WEBHOOK_URL?: string;
  /** Secret – gedeeld geheim; de flow weigert aanvragen waarin het ontbreekt of niet klopt. */
  MAIL_WEBHOOK_SLEUTEL?: string;
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
  /** Token van een uitnodiging (link uit een mail): koppelt de inschrijving aan dat contact en die persoon. */
  uitnodiging?: string;
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
