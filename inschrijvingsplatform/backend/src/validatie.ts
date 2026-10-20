import type { RegistratieInvoer } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEFOON = /^[+0-9 ()./-]{8,20}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

function tekst(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new Error('type');
  const t = v.trim();
  if (t.length > max) throw new Error('lengte');
  return t || undefined;
}

/**
 * Valideert en normaliseert de invoer. Gooit een lijst van veldfouten
 * (veldnaam → boodschap) zodat de frontend ze bij het juiste veld kan tonen.
 */
export function valideerRegistratie(body: any): RegistratieInvoer {
  const fouten: Record<string, string> = {};
  const d = body?.deelnemer ?? {};
  const veld = (naam: string, max: number, verplicht = false) => {
    try {
      const v = tekst(d[naam], max);
      if (verplicht && !v) fouten[naam] = 'Dit veld is verplicht.';
      return v;
    } catch {
      fouten[naam] = `Maximaal ${max} tekens.`;
      return undefined;
    }
  };

  const deelnemer = {
    naam: veld('naam', 100, true)!,
    voornaam: veld('voornaam', 100, true)!,
    email: veld('email', 254, true)?.toLowerCase()!,
    contactVoornaam: veld('contactVoornaam', 100),
    contactNaam: veld('contactNaam', 100),
    telefoon: veld('telefoon', 20),
    schoolId: veld('schoolId', 36),
    schoolAndere: veld('schoolAndere', 200),
    gemeente: veld('gemeente', 100),
    leerjaar: veld('leerjaar', 50),
    functie: veld('functie', 100),
    opmerkingen: veld('opmerkingen', 1000),
    doelgroepId: veld('doelgroepId', 36),
    privacyAkkoord: d.privacyAkkoord === true,
  };

  if (deelnemer.email && !EMAIL.test(deelnemer.email)) fouten.email = 'Geen geldig e-mailadres.';
  if (deelnemer.telefoon && !TELEFOON.test(deelnemer.telefoon)) fouten.telefoon = 'Geen geldig telefoonnummer.';
  if (deelnemer.schoolId && !isUuid(deelnemer.schoolId)) fouten.schoolId = 'Ongeldige school.';
  if (deelnemer.doelgroepId && !isUuid(deelnemer.doelgroepId)) fouten.doelgroepId = 'Ongeldige keuze.';
  if (!deelnemer.privacyAkkoord) fouten.privacyAkkoord = 'Je moet de privacyverklaring aanvaarden.';

  const dagdelen = Array.isArray(body?.dagdelen) ? body.dagdelen : [];
  const sessies = Array.isArray(body?.sessies) ? body.sessies : [];
  if (dagdelen.length === 0 || dagdelen.length > 10 || !dagdelen.every(isUuid)) fouten.dagdelen = 'Kies een moment.';
  if (sessies.length > 20 || !sessies.every(isUuid)) fouten.sessies = 'Ongeldige keuze.';

  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);

  return {
    deelnemer,
    dagdelen,
    sessies,
    turnstileToken: typeof body.turnstileToken === 'string' ? body.turnstileToken : undefined,
    website: typeof body.website === 'string' ? body.website : undefined,
  };
}

export class ValidatieFout extends Error {
  constructor(public velden: Record<string, string>) {
    super('VALIDATIE');
  }
}
