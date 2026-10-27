// Vorm van publiek_evenement() in de database
export interface Sessie {
  id: string;
  code: string | null;
  titel: string;
  beschrijving: string | null;
  soort: string | null;
  doelgroepId: string | null;
  locatie: string | null;
  kleur: string | null;
  capaciteit: number | null;
  vrij: number | null;
  volzet: boolean;
  wachtlijst: boolean;
  uniek: boolean;
}

export interface Tijdsblok {
  id: string;
  naam: string;
  omschrijving: string | null;
  startUur: string;
  eindUur: string;
  type: 'keuze' | 'programma';
  verplicht: boolean;
  sessies: Sessie[];
}

export interface Dagdeel {
  id: string;
  naam: string;
  startUur: string;
  eindUur: string;
  capaciteit: number | null;
  vrij: number | null;
  tijdsblokken: Tijdsblok[];
}

export interface Dag {
  id: string;
  naam: string;
  datum: string;
  sessiekeuzeOpen: boolean;
  dagdelen: Dagdeel[];
}

export interface Doelgroep {
  id: string;
  naam: string;
  beschrijving: string | null;
  sessiekeuze: boolean;
}

export interface Evenement {
  evenementId: string;
  slug: string;
  titel: string;
  omschrijving: string | null;
  typeEvenement: string;
  organisator: string | null;
  deelnemerType: 'leerling' | 'volwassene';
  leerjaarOpties: string[];
  maxDagdelen: number;
  contactEmail: string | null;
  privacyTekst: string | null;
  bewaartermijnDagen: number;
  logo: string | null;
  logoHoogte?: number | null;
  afbeelding: string | null;
  kleurPrimair?: string | null;
  kleurAccent?: string | null;
  inschrijvingVanaf: string | null;
  inschrijvingTot: string | null;
  inschrijvingOpen: boolean;
  doelgroepen: Doelgroep[];
  dagen: Dag[];
}

export interface School {
  id: string;
  naam: string;
  gemeente: string;
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
  leerjaar?: string;
  functie?: string;
  opmerkingen?: string;
  doelgroepId?: string;
  privacyAkkoord: boolean;
}

export interface RegistratieAanvraag {
  deelnemer: DeelnemerInvoer;
  dagdelen: string[];
  sessies: string[];
  turnstileToken?: string;
  /** Token van de uitnodiging (link uit een mail), zodat de inschrijving aan het juiste gezin en kind gekoppeld wordt. */
  uitnodiging?: string;
  website?: string;
}

/** Publiek voorinschrijvingsformulier, met de huisstijl van het gekozen evenement. */
export interface VoorinschrijfFormulier {
  slug: string;
  titel: string;
  intro: string | null;
  schooljaar: string | null;
  leerjaarOpties: string[];
  privacyTekst: string | null;
  contactEmail: string | null;
  open: boolean;
  organisator: string | null;
  logo: string | null;
  logoHoogte: number | null;
  kleurPrimair: string | null;
  kleurAccent: string | null;
}

export interface Voorinschrijving {
  ouderVoornaam: string;
  ouderNaam?: string;
  email: string;
  telefoon?: string;
  kindVoornaam: string;
  kindNaam: string;
  schoolId?: string;
  schoolAndere?: string;
  klas?: string;
  opmerkingen?: string;
  privacyAkkoord: boolean;
  turnstileToken?: string;
  website?: string;
}

/** Wat het formulier vooraf invult vanuit een uitnodiging. Zonder contact = al gebruikt voor dit kind. */
export interface Voorinvulling {
  slug: string;
  evenement: string;
  status: 'aangemaakt' | 'verstuurd' | 'gebruikt' | 'afgemeld';
  contact?: { email: string; voornaam: string | null; naam: string | null; telefoon: string | null };
  persoon?: { voornaam: string | null; naam: string | null } | null;
  school?: School | null;
  schoolAndere?: string | null;
  leerjaar?: string | null;
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
  tijdsblokId?: string;
  titel: string;
  tijdsblok: string;
  startUur: string;
  locatie: string | null;
  status: string;
}

export interface RegistratieAntwoord {
  referentie: string;
  evenement: string;
  contactEmail: string | null;
  momenten: Moment[];
  keuzes: Keuze[];
  beheerUrl: string;
}

export interface RegistratieOverzicht {
  referentie: string;
  evenement: string;
  slug: string;
  contactEmail: string | null;
  status: 'actief' | 'geannuleerd';
  voornaam: string | null;
  naam: string | null;
  annuleerbaar: boolean;
  momenten: Moment[];
  keuzes: Keuze[];
  /** Lesjes wijzigen via de persoonlijke link; null als dat niet (meer) kan. */
  wijzigen?: KeuzeWijziging | null;
}

export interface KeuzeWijziging {
  doelgroepId: string;
  dagen: { dagNaam: string; dagdeel: Dagdeel }[];
  /** Huidige keuze per keuzeblok (tijdsblok-id → sessie-id, '' = geen). */
  keuzes: Record<string, string>;
}

/** "Probleem of idee melden": wat de gebruiker schrijft + technische context voor debugging. */
export interface Melding {
  type: 'probleem' | 'wens';
  omschrijving: string;
  email?: string;
  pagina: string;
  appVersie: string;
  browser: string;
  context: Record<string, string | number | boolean | null>;
  logboek: { t: string; niveau: string; bericht: string }[];
  screenshot?: string;
  turnstileToken?: string;
  website?: string;
}

export class ApiFout extends Error {
  constructor(
    public code: string,
    melding: string,
    public velden?: Record<string, string>,
    public id?: string,
    /** Extra velden die de API bij deze fout meestuurt, bv. omgewisseld en mailVerstuurd bij een dubbele inschrijving. */
    public extra?: Record<string, unknown>,
  ) {
    super(melding);
  }
}
