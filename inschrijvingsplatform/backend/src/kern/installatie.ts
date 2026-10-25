import type { Env } from '../types';

/**
 * Het profiel van deze installatie (één organisatie). Staat in wrangler.toml [vars] en niet in de
 * database: wie de aanmelddomeinen wijzigt, wijzigt de beveiliging, en dat hoort via een deploy te
 * gaan en niet via een (mogelijk overgenomen) beheerdersaccount. Zie Plan_Modulair_Platform.md.
 */
export interface Installatie {
  organisatie: string;
  /** Toegelaten e-maildomeinen voor medewerkers, in kleine letters. ['*'] = elk adres (enkel op uitnodiging). */
  aanmeldDomeinen: string[];
  /**
   * Hoe deze organisatie dingen noemt. Intern heet het altijd zo (sessiegever); op het scherm en in mails de term
   * van de installatie, bv. lesgever (school) of spreker/artiest (cultuurcentrum). Kleine letters.
   */
  termen: { sessiegever: string; sessiegevers: string };
}

export function installatie(env: Env): Installatie {
  const enkel = env.TERM_SESSIEGEVER?.trim().toLowerCase() || 'sessiegever';
  return {
    organisatie: env.ORGANISATIE_NAAM?.trim() || 'Inschrijvingsplatform',
    aanmeldDomeinen: (env.AANMELD_DOMEINEN ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
    termen: { sessiegever: enkel, sessiegevers: env.TERM_SESSIEGEVERS?.trim().toLowerCase() || `${enkel}s` },
  };
}

const ELK_ADRES = '*';

/**
 * Is dit adres van een toegelaten domein? Geldt voor medewerkers en voor interne adressen (bv. de
 * leerkracht die een klaslijst krijgt). Zonder AANMELD_DOMEINEN is niemand toegelaten (dicht bij twijfel).
 */
export function isToegelatenEmail(env: Env, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || e.split('@').length !== 2) return false;
  const domeinen = installatie(env).aanmeldDomeinen;
  if (domeinen.includes(ELK_ADRES)) return true;
  const domein = e.split('@')[1];
  return domeinen.includes(domein);
}

/** Voor meldingen: "@onderwijs.gent.be", "@a.be of @b.be" of "een uitgenodigd adres". */
export function domeinTekst(env: Env): string {
  const d = installatie(env).aanmeldDomeinen;
  if (!d.length || d.includes(ELK_ADRES)) return 'een uitgenodigd adres';
  const met = d.map((x) => `@${x}`);
  return met.length === 1 ? met[0] : `${met.slice(0, -1).join(', ')} of ${met[met.length - 1]}`;
}
