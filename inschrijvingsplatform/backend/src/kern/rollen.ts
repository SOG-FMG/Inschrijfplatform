import { audit } from './audit';
import { installatie } from './installatie';
import type { Module, Rol } from './module';
import type { Aanpassingen } from './register';
import type { Gebruiker } from './toegang';
import type { Env } from '../types';
import { ValidatieFout } from '../validatie';

/**
 * Rechten per rol aanpassen (Medewerkers → Rollen en rechten). Enkel rechten die een module als instelbaar markeert;
 * de rest blijft zoals in het manifest. De platformbeheerder heeft altijd alle rechten, behalve de rechten met
 * ookPlatformbeheerder: die staan ook voor hem in het raster (en zijn standaard meestal uit).
 */

/** De rollen in het raster, in deze volgorde. */
export const INSTELBARE_ROLLEN: Rol[] = ['platformbeheerder', 'schoolbeheerder', 'organisator', 'onthaal', 'sessiegever'];

/** Kan dit vakje gewijzigd worden? Voor de platformbeheerder enkel bij rechten met ookPlatformbeheerder. */
const wijzigbaar = (rol: Rol, r: { ookPlatformbeheerder?: boolean }) => rol !== 'platformbeheerder' || !!r.ookPlatformbeheerder;

const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** Naam van de rol op het scherm; de sessiegever heet zoals de installatie het noemt (bv. Lesgever). */
const rolNaam = (env: Env, rol: Rol) =>
  rol === 'sessiegever'
    ? hoofdletter(installatie(env).termen.sessiegever)
    : ({ platformbeheerder: 'Platformbeheerder', schoolbeheerder: 'Schoolbeheerder', organisator: 'Organisator', onthaal: 'Onthaal' } as Record<string, string>)[rol] ?? rol;

/** Aanpassingen voor één rol. Werkt ook als de tabel nog niet bestaat (dan geen aanpassingen). */
export async function leesAanpassingen(env: Env, rol: Rol): Promise<Aanpassingen> {
  try {
    const { results } = await env.DB.prepare(`select recht, toegestaan from rol_rechten where rol = ?`).bind(rol).all<{ recht: string; toegestaan: number }>();
    return new Map(results.map((r) => [`${rol} ${r.recht}`, r.toegestaan === 1]));
  } catch {
    return new Map();
  }
}

function instelbare(modules: Module[]) {
  return modules.flatMap((m) =>
    Object.entries(m.rechten ?? {})
      .filter(([, r]) => r.instelbaar)
      .map(([recht, r]) => ({ recht, module: m.naam, omschrijving: r.omschrijving, standaard: r.rollen, ookPlatformbeheerder: !!r.ookPlatformbeheerder })),
  );
}

/** Het raster: per instelbaar recht en per rol of het toegestaan is, en of dat de standaard is. */
export async function rollenEnRechten(env: Env, modules: Module[]) {
  const { results } = await env.DB.prepare(`select rol, recht, toegestaan from rol_rechten`).all<{ rol: string; recht: string; toegestaan: number }>();
  const aangepast = new Map(results.map((r) => [`${r.rol} ${r.recht}`, r.toegestaan === 1]));
  return {
    rollen: INSTELBARE_ROLLEN.map((rol) => ({ rol, naam: rolNaam(env, rol) })),
    rechten: instelbare(modules).map((r) => ({
      recht: r.recht,
      module: r.module,
      omschrijving: r.omschrijving,
      per: Object.fromEntries(
        INSTELBARE_ROLLEN.map((rol) => {
          if (!wijzigbaar(rol, r)) return [rol, { toegestaan: true, standaard: true, vast: true }];
          const standaard = r.standaard.includes(rol);
          const waarde = aangepast.get(`${rol} ${r.recht}`) ?? standaard;
          return [rol, { toegestaan: waarde, standaard, vast: false }];
        }),
      ),
    })),
  };
}

/** Eén vakje van het raster. Gelijk aan de standaard: de aanpassing verdwijnt. */
export async function zetRecht(env: Env, g: Gebruiker, modules: Module[], body: any, ip: string | null) {
  const rol = INSTELBARE_ROLLEN.find((r) => r === body?.rol);
  const recht = instelbare(modules).find((r) => r.recht === body?.recht);
  if (!rol || !recht || typeof body?.toegestaan !== 'boolean' || !wijzigbaar(rol, recht)) throw new ValidatieFout({ recht: 'Onbekend recht of rol.' });
  const standaard = recht.standaard.includes(rol);
  await env.DB.batch([
    body.toegestaan === standaard
      ? env.DB.prepare(`delete from rol_rechten where rol = ? and recht = ?`).bind(rol, recht.recht)
      : env.DB.prepare(
          `insert into rol_rechten (rol, recht, toegestaan, gewijzigd_door) values (?, ?, ?, ?)
           on conflict (rol, recht) do update set toegestaan = excluded.toegestaan, gewijzigd_door = excluded.gewijzigd_door,
             gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        ).bind(rol, recht.recht, body.toegestaan ? 1 : 0, g.gebruikerId),
    audit(env, g, 'rol_rechten', `${rol} ${recht.recht}`, 'RECHT', { toegestaan: body.toegestaan }, ip),
  ]);
  return rollenEnRechten(env, modules);
}
