import { sessieEmail } from '../auth/sessie';
import { DbFout } from './fouten';
import { isToegelatenEmail } from './installatie';
import type { Env } from '../types';

/**
 * Vervangt Supabase Auth + Row Level Security.
 *
 * 1. Aanmelden: authenticator-app (TOTP) of passkey, zie src/auth. Na het aanmelden staat er een
 *    sessiecookie; hier wordt het omgezet naar een e-mailadres. Enkel gebruikers in de tabel
 *    gebruikers (actief) komen binnen, de hoofdadmin staat in wrangler.toml (HOOFDADMIN_EMAIL).
 * 2. Rechten: per evenement, met dezelfde regels als is_beheerder() in de PostgreSQL-versie.
 *    Elke beheerroute roept controleerToegang() aan vóór ze gegevens leest of schrijft.
 */

export interface Gebruiker {
  gebruikerId: string;
  email: string;
  rol: 'platformbeheerder' | 'schoolbeheerder' | 'organisator' | 'onthaal';
  schoolId: string | null;
  /** Aangemeld met een sessie maar nog zonder wachtwoord (account van vóór de wachtwoordstap): eerst instellen. */
  moetWachtwoordInstellen: boolean;
  /**
   * Rechten uit de manifesten van de actieve modules (kern/register.ts), ingevuld door index.ts.
   * Rechten bepalen WAT iemand mag; de rol bepaalt daarnaast het BEREIK (welke evenementen, zie controleerToegang).
   */
  rechten: string[];
}

/** Mag deze gebruiker dit? Gebruik dit in plaats van rolnamen te vergelijken. */
export const heeftRecht = (g: Gebruiker, recht: string) => g.rechten.includes(recht);

export async function huidigeGebruiker(request: Request, env: Env): Promise<Gebruiker> {
  const { email, viaSessie } = await aangemeldEmail(request, env);
  // Enkel de aanmelddomeinen van deze installatie (AANMELD_DOMEINEN): een gebruikersrij met een ander adres geeft nooit toegang.
  if (!isToegelatenEmail(env, email)) throw new DbFout('GEEN_TOEGANG');
  const g = await env.DB.prepare(
    `select g.gebruiker_id, g.email, g.school_id, r.code as rol, g.wachtwoord_hash is not null as heeft_wachtwoord
     from gebruikers g join rollen r on r.rol_id = g.rol_id
     where g.email = ? and g.actief = 1`,
  )
    .bind(email)
    .first<{ gebruiker_id: string; email: string; school_id: string | null; rol: Gebruiker['rol']; heeft_wachtwoord: number }>();
  if (!g) throw new DbFout('GEEN_TOEGANG');
  return {
    gebruikerId: g.gebruiker_id,
    email: g.email,
    rol: g.rol,
    schoolId: g.school_id,
    moetWachtwoordInstellen: viaSessie && !g.heeft_wachtwoord,
    rechten: [],
  };
}

/** Gooit GEEN_TOEGANG tenzij de gebruiker dit evenement mag lezen (of, met schrijven, wijzigen). */
export async function controleerToegang(env: Env, g: Gebruiker, evenementId: string, schrijven = false): Promise<void> {
  if (g.rol === 'platformbeheerder') return;
  const ok = await env.DB.prepare(
    `select 1 from evenementen e
     where e.evenement_id = ?1
       and (exists (select 1 from evenement_beheerders b
                    where b.evenement_id = e.evenement_id and b.gebruiker_id = ?2
                      and (?3 = 0 or b.rol = 'organisator'))
            or (?4 = 'schoolbeheerder' and e.school_id = ?5))`,
  )
    .bind(evenementId, g.gebruikerId, schrijven ? 1 : 0, g.rol, g.schoolId)
    .first();
  if (!ok) throw new DbFout('GEEN_TOEGANG');
}

/** De evenementen die deze gebruiker mag lezen; null = alle (platformbeheerder). Zelfde regels als controleerToegang. */
export async function leesbareEvenementen(env: Env, g: Gebruiker): Promise<Set<string> | null> {
  if (g.rol === 'platformbeheerder') return null;
  const { results } = await env.DB.prepare(
    `select e.evenement_id from evenementen e
     where exists (select 1 from evenement_beheerders b where b.evenement_id = e.evenement_id and b.gebruiker_id = ?1)
        or (?2 = 'schoolbeheerder' and e.school_id = ?3)`,
  )
    .bind(g.gebruikerId, g.rol, g.schoolId)
    .all<{ evenement_id: string }>();
  return new Set(results.map((r) => r.evenement_id));
}

async function aangemeldEmail(request: Request, env: Env): Promise<{ email: string; viaSessie: boolean }> {
  const email = await sessieEmail(request, env);
  if (email) return { email, viaSessie: true };
  // Lokale ontwikkeling zonder aanmelden: enkel op localhost en enkel als het expliciet ingesteld is.
  const host = new URL(request.url).hostname;
  if (env.DEV_BEHEER_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return { email: env.DEV_BEHEER_EMAIL.toLowerCase(), viaSessie: false };
  throw new DbFout('NIET_AANGEMELD');
}
