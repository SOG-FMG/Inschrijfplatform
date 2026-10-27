import { call, post } from './beheerApi';

/**
 * Aanwezigheid op de dag zelf en sessiegevers (backend/src/modules/evenementen/routes-aanwezigheid.ts).
 * Medewerkers gebruiken /api/beheer, sessiegevers /api/sessiegever (eigen aanmelding met een code per mail).
 */

export type Kleur = 'rood' | 'blauw' | 'geel' | 'groen';
export type Via = 'qr' | 'balie' | 'klas';

export const VIA_TEKST: Record<Via, string> = { qr: 'met QR', balie: 'aan de balie', klas: 'in de klas' };

export interface ScanResultaat {
  kleur: Kleur;
  code: 'OK' | 'ONBEKEND' | 'GEANNULEERD' | 'ANDERE_DAG' | 'AL_AANGEMELD' | 'OUDE_MAIL' | 'ANDER_DAGDEEL' | 'WACHTLIJST';
  melding: string;
  deelnemer?: { id: string; referentie: string; voornaam: string; naam: string };
  evenement?: { id: string; titel: string };
  gewijzigd?: { op: string | null; door: 'ouder' | 'school' | 'wachtlijst' | null };
  momenten?: { dagdeelId: string; dag: string; datum: string; dagdeel: string; startUur: string; eindUur: string; aanwezig: boolean; op: string | null; via: Via | null }[];
  keuzes?: { sessieId: string; datum: string; titel: string; tijdsblok: string; startUur: string; lokaal: string | null; status: string }[];
}

export interface OverzichtDeelnemer {
  id: string;
  referentie: string;
  voornaam: string;
  naam: string;
  school: string;
  leerjaar: string;
  dagdeelId: string;
  aanwezig: boolean;
  op: string | null;
  via: Via | null;
  heeftQr: boolean;
  /** De school weet dat die niet komt: geen herinnering meer, maar wel nog ingeschreven. */
  komtNiet: boolean;
  lesjes: { sessieId: string; titel: string; tijdsblok: string; startUur: string; status: string; klas: 'aanwezig' | 'afwezig' | null }[];
}

/** Moment waar een deelnemer naartoe verplaatst kan worden (uit lesOpties). */
export interface MomentOptie {
  id: string;
  dag: string;
  datum: string;
  dagdeel: string;
  startUur: string;
  eindUur: string;
  capaciteit: number | null;
  bevestigd: number;
  vol: boolean;
  gekozen: boolean;
}

export interface AanwezigheidOverzicht {
  evenement: string;
  dagen: { id: string; naam: string; datum: string }[];
  dag: { id: string; naam: string; datum: string } | null;
  dagdelen: { id: string; naam: string; startUur: string; eindUur: string; totaal: number; aanwezig: number }[];
  deelnemers: OverzichtDeelnemer[];
  rechten?: { lesjeWijzigen: boolean; overboeken: boolean; inchecken: boolean };
}

export interface LesOptie {
  id: string;
  titel: string;
  beschrijving: string | null;
  lokaal: string | null;
  lesgever: string | null;
  capaciteit: number | null;
  bevestigd: number;
  wachtlijst: number;
  open: boolean;
  vol: boolean;
  /** Status van de huidige keuze in dit tijdsblok (bevestigd/wachtlijst), of null. */
  gekozen: string | null;
}

export interface LesBlok {
  id: string;
  naam: string;
  startUur: string;
  eindUur: string;
  dag: string;
  dagdeel: string;
  sessies: LesOptie[];
}

export interface TabelDeelnemer {
  id: string;
  voornaam: string;
  naam: string;
  school: string;
  leerjaar: string;
  status: 'bevestigd' | 'wachtlijst';
  opSchool: boolean;
  via: Via | null;
  op: string | null;
  klas: 'aanwezig' | 'afwezig' | null;
  extra: Record<string, string>;
}

export interface SessieTabel {
  sessie: {
    id: string; titel: string; beschrijving: string | null; capaciteit: number | null; lesgever: string | null; lokaal: string | null;
    tijdsblok: string; startUur: string; eindUur: string; dag: string; datum: string; evenement: string; evenementId: string; bevestigd: number;
  };
  velden: { id: string; label: string }[];
  vandaag: boolean;
  deelnemers: TabelDeelnemer[];
  rechten: string[];
}

export type ScanInSessie =
  | { resultaat: 'onbekend' }
  | { resultaat: 'aangeduid' | 'toegevoegd'; deelnemerId: string; naam: string }
  | { resultaat: 'niet_op_lijst'; deelnemerId: string; naam: string; lesjes: { titel: string; startUur: string; lokaal: string | null }[]; kanToevoegen: boolean };

export interface MijnSessies {
  voornaam: string;
  naam: string;
  email: string;
  rechten: string[];
  sessies: { id: string; titel: string; evenement: string; dag: string; datum: string; tijdsblok: string; startUur: string; eindUur: string; lokaal: string | null; capaciteit: number | null; bevestigd: number; wachtlijst: number }[];
}

export interface SessiegeverBeheer {
  termen: { sessiegever: string; sessiegevers: string };
  evenement: string;
  velden: string[];
  extraVelden: { id: string; label: string }[];
  sessies: { id: string; titel: string; dag: string; datum: string; tijdsblok: string; startUur: string; lesgeverTekst: string | null; lesgeverEmail: string | null; sessiegevers: string[] }[];
  sessiegevers: { id: string; voornaam: string; naam: string; email: string; uitgenodigdOp: string | null; sessies: string[] }[];
}

export interface RollenRechten {
  rollen: { rol: string; naam: string }[];
  rechten: { recht: string; module: string; omschrijving: string; per: Record<string, { toegestaan: boolean; standaard: boolean; vast: boolean }> }[];
}

const patch = <T>(pad: string, body: unknown) => call<T>(pad, { method: 'PATCH', body });
const verwijder = <T>(pad: string) => call<T>(pad, { method: 'DELETE' });

/** Voor medewerkers (sessiecookie van het dashboard). */
export const aanwezigheidApi = {
  scan: (token: string, v: string | null) => call<ScanResultaat>(`/api/beheer/checkin/${token}${v ? `?v=${encodeURIComponent(v)}` : ''}`),
  meldAan: (token: string) => post<{ aangemeld: boolean }>(`/api/beheer/checkin/${token}`),
  maakOngedaan: (token: string) => verwijder<{ ok: true }>(`/api/beheer/checkin/${token}`),
  overzicht: (evenementId: string, dag?: string) => call<AanwezigheidOverzicht>(`/api/beheer/evenementen/${evenementId}/aanwezigheid${dag ? `?dag=${dag}` : ''}`),
  zetAanwezig: (deelnemerId: string, aanwezig: boolean) => post<{ aangemeld?: boolean; ok?: true }>(`/api/beheer/aanwezigheid/deelnemers/${deelnemerId}`, { aanwezig }),
  lesjes: (deelnemerId: string) => call<{ blokken: LesBlok[]; momenten: MomentOptie[] }>(`/api/beheer/aanwezigheid/deelnemers/${deelnemerId}/lesjes`),
  kiesLesje: (deelnemerId: string, sessieId: string, forceer: boolean, verwittig: boolean) =>
    post<{ status: string }>(`/api/beheer/aanwezigheid/deelnemers/${deelnemerId}/lesje`, { sessieId, forceer, verwittig }),
  qrMails: (evenementId: string) => call<{ teVersturen: number }>(`/api/beheer/evenementen/${evenementId}/qrcode-mails`),
  verstuurQrMails: (evenementId: string) => post<{ verstuurd: number; mislukt: number; teVersturen: number }>(`/api/beheer/evenementen/${evenementId}/qrcode-mails`),

  sessiegevers: (evenementId: string) => call<SessiegeverBeheer>(`/api/beheer/evenementen/${evenementId}/sessiegevers`),
  maakSessiegever: (w: { voornaam: string; naam: string; email: string }) => post<{ id: string }>('/api/beheer/sessiegevers', w),
  wijzigSessiegever: (id: string, w: { voornaam: string; naam: string; email: string }) => patch<{ ok: true }>(`/api/beheer/sessiegevers/${id}`, w),
  verwijderSessiegever: (id: string) => verwijder<{ ok: true }>(`/api/beheer/sessiegevers/${id}`),
  /** Uitschrijven = annuleren: plaats vrij, wachtlijst schuift door, cijfers en logboek blijven. */
  schrijfUit: (deelnemerId: string) => post<{ ok: true }>(`/api/beheer/deelnemers/${deelnemerId}/uitschrijven`, {}),
  /** "Komt niet": blijft ingeschreven en houdt zijn plaats, maar krijgt geen herinnering meer. */
  zetKomtNiet: (deelnemerId: string, komtNiet: boolean) => post<{ ok: true }>(`/api/beheer/deelnemers/${deelnemerId}/komt-niet`, { komtNiet }),
  /** Naar een ander moment; de lesjes van het oude moment vervallen. */
  verplaatsMoment: (deelnemerId: string, van: string, naar: string, forceer = false) =>
    post<{ ok: true }>(`/api/beheer/deelnemers/${deelnemerId}/dagdeel`, { van, naar, forceer }),
  koppel: (sessieId: string, sessiegevers: string[]) => patch<{ ok: true }>(`/api/beheer/sessies/${sessieId}/sessiegevers`, { sessiegevers }),
  neemOver: (evenementId: string) => post<{ nieuw: number; gekoppeld: number; overgeslagen: number }>(`/api/beheer/evenementen/${evenementId}/sessiegevers/overnemen`),
  nodigUit: (evenementId: string, ids?: string[]) => post<{ verstuurd: number; mislukt: number }>(`/api/beheer/evenementen/${evenementId}/sessiegevers/uitnodigen`, ids ? { ids } : {}),
  zetVelden: (evenementId: string, velden: string[]) => patch<{ velden: string[] }>(`/api/beheer/evenementen/${evenementId}/sessiegever-velden`, { velden }),

  rollenRechten: () => call<RollenRechten>('/api/beheer/rollen-rechten'),
  zetRecht: (rol: string, recht: string, toegestaan: boolean) => patch<RollenRechten>('/api/beheer/rollen-rechten', { rol, recht, toegestaan }),
};

/**
 * De tabel van een sessie, voor een sessiegever (/api/sessiegever) of een medewerker (/api/beheer).
 * Dezelfde pagina (/les/<id>) werkt zo voor beiden.
 */
export const tabelApi = (wie: 'sessiegever' | 'medewerker') => {
  const basis = (id: string) => (wie === 'sessiegever' ? `/api/sessiegever/sessies/${id}` : `/api/beheer/sessies/${id}`);
  return {
    tabel: (id: string) => call<SessieTabel>(wie === 'sessiegever' ? basis(id) : `${basis(id)}/tabel`),
    zetKlas: (id: string, deelnemerId: string, klas: 'aanwezig' | 'afwezig' | null) => post<{ ok: true }>(`${basis(id)}/deelnemers/${deelnemerId}`, { klas }),
    scan: (id: string, token: string, toevoegen = false) => post<ScanInSessie>(`${basis(id)}/scan`, { token, toevoegen }),
  };
};

export const sessiegeverApi = {
  vraagCode: (email: string) => post<{ ok: true }>('/api/sessiegever/code', { email }),
  meldAan: (email: string, code: string) => post<{ ok: true; voornaam: string }>('/api/sessiegever/aanmelden', { email, code }),
  meldAf: () => post<{ ok: true }>('/api/sessiegever/afmelden'),
  ik: () => call<MijnSessies>('/api/sessiegever/ik'),
};

/** Token en versie uit een gescande QR-code (onze eigen check-in-link), of null. */
export function leesCheckinQr(tekst: string): { token: string; v: string | null } | null {
  try {
    const u = new URL(tekst);
    const m = /^\/checkin\/([A-Za-z0-9_-]{43})$/.exec(u.pathname);
    return m ? { token: m[1], v: u.searchParams.get('v') } : null;
  } catch {
    return null;
  }
}
