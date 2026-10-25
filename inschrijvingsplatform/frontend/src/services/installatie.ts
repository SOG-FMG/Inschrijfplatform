import { useEffect, useState } from 'react';
import { BASIS, isDemo } from './api';

/**
 * Profiel van deze installatie (organisatie en aanmelddomeinen), van GET /api/installatie.
 * De API controleert de domeinen zelf; hier dient het enkel voor teksten en een vroege foutmelding.
 */
export interface Installatie {
  organisatie: string;
  aanmeldDomeinen: string[];
  /** Hoe deze organisatie dingen noemt (kleine letters), bv. sessiegever = lesgever of spreker. */
  termen: { sessiegever: string; sessiegevers: string };
  /** Actieve modules (backend/src/modules); leeg zolang het profiel laadt. */
  modules: string[];
}

const STANDAARD_TERMEN = { sessiegever: 'sessiegever', sessiegevers: 'sessiegevers' };
const LEEG: Installatie = { organisatie: '', aanmeldDomeinen: [], termen: STANDAARD_TERMEN, modules: [] };
let geladen: Promise<Installatie> | null = null;

export function laadInstallatie(): Promise<Installatie> {
  if (isDemo) return Promise.resolve({ organisatie: 'Demo', aanmeldDomeinen: ['*'], termen: STANDAARD_TERMEN, modules: [] });
  geladen ??= fetch(`${BASIS}/api/installatie`)
    .then((r) => (r.ok ? (r.json() as Promise<Installatie>) : LEEG))
    .then((i) => ({ ...i, termen: i.termen ?? STANDAARD_TERMEN }))
    .catch(() => {
      geladen = null; // later opnieuw proberen
      return LEEG;
    });
  return geladen;
}

/** Het profiel, of een leeg profiel zolang het laadt (teksten vallen dan terug op algemene woorden). */
export function useInstallatie(): Installatie {
  const [i, setI] = useState<Installatie>(LEEG);
  useEffect(() => {
    let actief = true;
    laadInstallatie().then((x) => actief && setI(x));
    return () => {
      actief = false;
    };
  }, []);
  return i;
}

/** Staat deze module aan? Zolang het profiel niet geladen is: ja (de API weigert toch wat uit staat). */
export const isModuleActief = (i: Installatie, id: string) => !i.modules.length || i.modules.includes(id);

const elkAdres = (i: Installatie) => !i.aanmeldDomeinen.length || i.aanmeldDomeinen.includes('*');

/** Zelfde regel als de API (backend/src/kern/installatie.ts). Onbekend profiel = niet blokkeren. */
export function isToegelatenEmail(i: Installatie, email: string): boolean {
  if (elkAdres(i)) return true;
  const domein = email.trim().toLowerCase().split('@')[1] ?? '';
  return i.aanmeldDomeinen.includes(domein);
}

/** "@onderwijs.gent.be", "@a.be of @b.be", of null als elk adres mag. */
export function domeinTekst(i: Installatie): string | null {
  if (elkAdres(i)) return null;
  const d = i.aanmeldDomeinen.map((x) => `@${x}`);
  return d.length === 1 ? d[0] : `${d.slice(0, -1).join(', ')} of ${d[d.length - 1]}`;
}

/** Voorbeeld voor een invulveld: "voornaam.naam@onderwijs.gent.be". */
export const voorbeeldAdres = (i: Installatie) => `voornaam.naam@${elkAdres(i) ? 'organisatie.be' : i.aanmeldDomeinen[0]}`;
