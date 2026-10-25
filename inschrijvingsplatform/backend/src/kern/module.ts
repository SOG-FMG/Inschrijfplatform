import type { Gebruiker } from './toegang';
import type { Env } from '../types';
import type { SjabloonDefinitie } from './sjablonen';

/**
 * Het modulecontract (zie Plan_Modulair_Platform.md, hoofdstuk 4). Een module beschrijft zich met
 * defineModule({...}); de kern (src/kern/register.ts) controleert het manifest, verdeelt de routes,
 * controleert rechten, vertaalt foutcodes en voert de taken uit.
 *
 * Wijzig je hier iets zodat bestaande modules niet meer werken, verhoog dan de hoofdversie van KERN_VERSIE.
 */
export const KERN_VERSIE = '1.0.0';

/** Wat elke route krijgt. */
export interface PubliekCtx {
  env: Env;
  request: Request;
  /** Waarden uit het pad, bv. { id: '…' } voor '/evenementen/:id'. */
  params: Record<string, string>;
  ip: string | null;
  /** Werk dat na het antwoord verder mag lopen (mails, logs). */
  waitUntil(p: Promise<unknown>): void;
  /** JSON-body, met een maximale grootte in bytes. */
  leesJson<T = any>(maxBytes: number): Promise<T>;
  /** De actieve modules van deze installatie (bv. om hun mailsjablonen op te zoeken). */
  modules: Module[];
}

/** Beheerroutes: altijd met een aangemelde medewerker. */
export interface BeheerCtx extends PubliekCtx {
  gebruiker: Gebruiker;
  /** Mag deze medewerker dit recht? (Rechten per evenement controleert de module zelf, zie controleerToegang.) */
  heeftRecht(recht: string): boolean;
}

/** Een handler geeft een Response terug, of gegevens die als JSON (200) verstuurd worden. */
export type Antwoord = Response | object;

type Methode = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Pad met parameters: '/evenementen/:id/rapport'. Een parameter kan een soort hebben: ':id:uuid'.
 * Soorten: id (standaard: letters, cijfers, streepjes, max. 64), uuid, slug, token (43 tekens), woord (kleine letters).
 * Publieke routes hangen onder /api, beheerroutes onder /api/beheer.
 * Nieuwe modules beginnen hun paden met hun eigen id, bv. '/tickets/voorstellingen/:id'.
 */
export type Route =
  | { methode: Methode; pad: string; toegang: 'publiek'; handler: (ctx: PubliekCtx) => Promise<Antwoord> }
  | { methode: Methode; pad: string; toegang: 'beheer'; recht?: string; handler: (ctx: BeheerCtx) => Promise<Antwoord> };

/** Rollen voor rechten: die van medewerkers, en de sessiegever (geen medewerker, zie modules/evenementen/sessiegevers.ts). */
export type Rol = Gebruiker['rol'] | 'sessiegever';

export interface Recht {
  omschrijving: string;
  /** Rollen die dit recht standaard krijgen. */
  rollen: Rol[];
  /** Aan te passen per rol in Medewerkers → Rollen en rechten (tabel rol_rechten). Zonder: vast volgens `rollen`. */
  instelbaar?: boolean;
  /**
   * Geldt ook voor de platformbeheerder (die anders altijd alles mag): standaard enkel als 'platformbeheerder' in
   * `rollen` staat, en aan te zetten in Rollen en rechten. Voor iets dat een organisatie bewust moet aanzetten,
   * zoals de contactgegevens van ouders in de contactenlijst. Enkel samen met `instelbaar`.
   */
  ookPlatformbeheerder?: boolean;
}

export interface Taak {
  naam: string;
  /**
   * Dagelijks (Cron Trigger). Geeft eventueel een aantal terug voor de logregel (bv. aantal verwijderde rijen).
   * `modules` = alle modules in de code (ook niet-actieve: hun tabellen bestaan in elke installatie).
   */
  uitvoeren(env: Env, ctx: { modules: Module[] }): Promise<number | void>;
}

/** Een kolom die naar een contact of persoon van de kern verwijst (zie kern/contacten.ts). */
export interface Persoonsverwijzing {
  tabel: string;
  persoon?: string;
  contact?: string;
}

/**
 * Waar iemand voorkomt, voor de contactenlijst (Dashboard → Contacten, kern/contactenlijst.ts). De kern voegt de
 * vermeldingen van alle modules samen per persoon: één e-mailadres = één persoon.
 */
export interface Vermelding {
  /** E-mailadres (medewerker, sessiegever), of een contact van de kern (ouder, inschrijver). Eén van beide. */
  email?: string | null;
  contactId?: string | null;
  /** Persoon van het contact waar het over gaat (bv. het kind bij een inschrijving). */
  persoonId?: string | null;
  /** Naam als die niet uit het contact komt (medewerker, sessiegever). */
  naam?: string | null;
  /** Soort, kort: 'Medewerker', 'Lesgever', 'Inschrijving', 'Voorinschrijving' … */
  soort: string;
  /** Waar precies, bv. "Infodagen 2025-2026 · Domein Kunst (Zaterdag 24 januari, 10:10)". */
  omschrijving: string;
  /** Evenement waar de vermelding bij hoort: wie dat evenement niet mag lezen, ziet de vermelding niet. */
  evenementId?: string | null;
  /** Pagina in het dashboard. */
  link?: string | null;
  datum?: string | null;
}

export interface ContactBron {
  id: string;
  /** Ouders en inschrijvers (buiten de organisatie): enkel met het recht kern.contacten.extern. */
  extern: boolean;
  /** evenementen: wat de medewerker mag lezen (null = alles). De kern filtert ook zelf op evenementId. */
  lees(env: Env, ctx: { gebruiker: Gebruiker; evenementen: Set<string> | null }): Promise<Vermelding[]>;
}

export interface Module {
  /** Kleine letters, uniek; ook het voorvoegsel van tabellen en rechten. */
  id: string;
  naam: string;
  versie: string;
  /** Hoofdversie van de kern waarvoor de module geschreven is, bv. '^1.0.0'. */
  vereistKern: string;
  afhankelijkVan?: string[];
  /** Altijd actief, ook als MODULES de module niet vermeldt. */
  altijdActief?: boolean;
  rechten?: Record<string, Recht>;
  routes?: Route[];
  /** Foutcodes (DbFout) met HTTP-status en melding voor de gebruiker. */
  fouten?: Record<string, [number, string]>;
  taken?: Taak[];
  /** Waar deze module naar contacten/personen verwijst; zolang een rij verwijst, blijft het contact bestaan. */
  persoonsverwijzingen?: Persoonsverwijzing[];
  /** Waar personen voorkomen in deze module, voor de contactenlijst. */
  contactBronnen?: ContactBron[];
  /** Mails van deze module die beheerders kunnen nalezen en aanpassen (module mailsjablonen). */
  mailsjablonen?: SjabloonDefinitie[];
}

export const defineModule = (m: Module): Module => m;
