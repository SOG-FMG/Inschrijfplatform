import { useEffect, useState } from 'react';
import { schoolLabel } from '../../components/SchoolKiezer';
import { api } from '../../services/api';
import type { PersoonControle } from '../../services/beheerApi';
import type { School } from '../../types';
import { koppelSchool, type Suggestie, type Zekerheid } from './importlogica';

/** Stappen die elke import van leerlingen deelt: scholen koppelen aan de officiële lijst, en kinderen nakijken. */

export const ANDERE = 'andere';

export interface SchoolKeuze { tekst: string; aantal: number; zekerheid: Zekerheid; suggesties: Suggestie[]; keuze: string }

/** De officiële scholenlijst, alfabetisch. */
export function useScholen(onFout: (melding: unknown) => void): School[] {
  const [scholen, setScholen] = useState<School[]>([]);
  useEffect(() => {
    api.haalScholen().then((s) => setScholen([...s].sort((a, b) => schoolLabel(a).localeCompare(schoolLabel(b), 'nl')))).catch(onFout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return scholen;
}

/** Unieke schoolnamen (met hun aantal) gekoppeld aan de lijst: zeker = gekozen, niet gevonden = "niet in de lijst". */
export function maakSchoolKeuzes(waarden: string[], scholen: School[]): SchoolKeuze[] {
  const tel = new Map<string, number>();
  for (const w of waarden) {
    const t = w.trim();
    if (t) tel.set(t, (tel.get(t) ?? 0) + 1);
  }
  return [...tel].sort((a, b) => b[1] - a[1]).map(([tekst, aantal]) => {
    const { zekerheid, suggesties } = koppelSchool(tekst, scholen);
    return { tekst, aantal, zekerheid, suggesties, keuze: zekerheid === 'zeker' ? suggesties[0].school.id : zekerheid === 'geen' ? ANDERE : '' };
  });
}

/** schoolId en schoolAndere voor de tekst uit het bestand. */
export function schoolVan(keuzes: SchoolKeuze[], tekst: string) {
  const t = tekst.trim();
  const keuze = t ? keuzes.find((k) => k.tekst === t)?.keuze : undefined;
  return { schoolId: keuze && keuze !== ANDERE ? keuze : null, schoolAndere: keuze === ANDERE ? t : null };
}

export function ScholenKoppelen({ keuzes, scholen, onWijzig }: { keuzes: SchoolKeuze[]; scholen: School[]; onWijzig: (k: SchoolKeuze[]) => void }) {
  const [enkelNakijken, setEnkelNakijken] = useState(true);
  const open = keuzes.filter((k) => !k.keuze).length;
  const zichtbaar = enkelNakijken ? keuzes.filter((k) => k.zekerheid !== 'zeker') : keuzes;
  return (
    <>
      <p className="d-klein">
        {keuzes.filter((k) => k.zekerheid === 'zeker').length} zeker gekoppeld, {keuzes.filter((k) => k.zekerheid === 'twijfel').length} twijfel,{' '}
        {keuzes.filter((k) => k.zekerheid === 'geen').length} niet gevonden (staan op "niet in de lijst").{' '}
        {open > 0 && <strong className="d-nee">Nog {open} te kiezen.</strong>}
      </p>
      <label className="d-klein">
        <input type="checkbox" checked={enkelNakijken} onChange={(e) => setEnkelNakijken(e.target.checked)} /> Enkel twijfels en niet gevonden
      </label>
      <div className="d-tabelvak">
        <table className="d-tabel d-tabel--compact">
          <thead><tr><th>In het bestand</th><th className="getal">Rijen</th><th>Zekerheid</th><th>School in de lijst</th></tr></thead>
          <tbody>
            {zichtbaar.map((k) => (
              <tr key={k.tekst}>
                <td>{k.tekst}</td>
                <td className="getal">{k.aantal}</td>
                <td><span className={`d-badge d-badge--${k.zekerheid === 'zeker' ? 'gepubliceerd' : k.zekerheid === 'twijfel' ? 'concept' : 'gesloten'}`}>{k.zekerheid}</span></td>
                <td>
                  <select aria-label={`School voor ${k.tekst}`} value={k.keuze}
                    onChange={(e) => onWijzig(keuzes.map((x) => (x.tekst === k.tekst ? { ...x, keuze: e.target.value } : x)))}>
                    <option value="">Kies…</option>
                    {k.suggesties.length > 0 && (
                      <optgroup label="Voorstellen">
                        {k.suggesties.map((s) => <option key={s.school.id} value={s.school.id}>{schoolLabel(s.school)} ({Math.round(s.score * 100)}%)</option>)}
                      </optgroup>
                    )}
                    <option value={ANDERE}>Niet in de lijst (tekst bewaren)</option>
                    <optgroup label="Alle scholen">
                      {scholen.map((s) => <option key={s.id} value={s.id}>{schoolLabel(s)}</option>)}
                    </optgroup>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export type PersoonNakijk = PersoonControle & { keuze: string };

/** Samenvatting van de nakijkstap en een keuze per twijfel (zelfde kind als … of een ander kind). */
export function KinderenNakijken({ personen, naam, onWijzig }: { personen: PersoonNakijk[]; naam: (rij: number) => string; onWijzig: (p: PersoonNakijk[]) => void }) {
  const open = personen.filter((p) => p.status === 'twijfel' && !p.keuze).length;
  const aantal = (f: (p: PersoonNakijk) => boolean) => personen.filter(f).length;
  return (
    <>
      <p className="d-klein">
        {aantal((p) => p.contact === 'nieuw')} rij(en) met een nieuw gezin, {aantal((p) => p.contact === 'bestaand')} met een bekend gezin
        {personen.some((p) => p.contact === 'geen') && `, ${aantal((p) => p.contact === 'geen')} zonder geldig e-mailadres of zonder moment (niet te koppelen)`} ·{' '}
        {aantal((p) => p.status === 'zelfde')} kind(eren) herkend, {aantal((p) => p.status === 'nieuw')} nieuw, {aantal((p) => p.status === 'twijfel')} twijfel.{' '}
        {open > 0 && <strong className="d-nee">Nog {open} te kiezen.</strong>}
      </p>
      {personen.some((p) => p.status === 'twijfel') && (
        <div className="d-tabelvak">
          <table className="d-tabel d-tabel--compact">
            <thead><tr><th className="getal">Rij</th><th>Kind in het bestand</th><th>Lijkt op</th></tr></thead>
            <tbody>
              {personen.map((p, i) => p.status !== 'twijfel' ? null : (
                <tr key={i}>
                  <td className="getal">{i + 1}</td>
                  <td className="pii">{naam(i)}</td>
                  <td>
                    <select aria-label={`Rij ${i + 1}`} value={p.keuze} onChange={(e) => onWijzig(personen.map((x, j) => (j === i ? { ...x, keuze: e.target.value } : x)))}>
                      <option value="">Kies…</option>
                      {p.kandidaten.map((k) => (
                        <option key={k.id} value={k.id}>
                          Zelfde kind als {k.naam}{k.id.startsWith('rij:') ? ` (rij ${Number(k.id.slice(4)) + 1} van dit bestand)` : ''}
                        </option>
                      ))}
                      <option value="nieuw">Een ander kind (broer of zus)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
