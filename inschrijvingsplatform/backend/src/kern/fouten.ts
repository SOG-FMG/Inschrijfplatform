/** Functionele fout met een vaste code; index.ts vertaalt die naar een Nederlandse melding. */
export class DbFout extends Error {
  constructor(
    public code: string,
    /** id van het volzette dagdeel/sessie, zodat de frontend het kan markeren */
    public detail?: string,
    public hint?: string,
  ) {
    super(code);
  }
}

/** Herkent de fouten die het schema zelf opwerpt (triggers, unieke indexen). */
export function vertaalD1Fout(e: unknown): DbFout | null {
  const m = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e);
  if (m.includes('SESSIE_VOLZET')) return new DbFout('SESSIE_VOLZET');
  if (m.includes('DAGDEEL_VOLZET')) return new DbFout('DAGDEEL_VOLZET');
  if (m.includes('deelnemers.dubbel_hash')) return new DbFout('DUBBELE_INSCHRIJVING');
  return null;
}

/** Voert een schrijfbatch uit (atomisch in D1) en zet schemafouten om naar DbFout. */
export async function schrijf(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    return await db.batch(stmts);
  } catch (e) {
    throw vertaalD1Fout(e) ?? e;
  }
}
