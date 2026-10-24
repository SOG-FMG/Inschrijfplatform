import type { Gebruiker } from './toegang';
import type { Env } from '../types';

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

export interface Recht {
  omschrijving: string;
  /** Rollen die dit recht krijgen tot rollen instelbaar worden (stap 0.7). */
  rollen: Gebruiker['rol'][];
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
}

export const defineModule = (m: Module): Module => m;
