import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { School } from '../types';
import { Tekstveld } from './Velden';

interface Props {
  tekst: string;
  onWijzig: (tekst: string, schoolId: string | undefined) => void;
  fout?: string;
  label?: string;
}

export const schoolLabel = (s: School) => (s.gemeente ? `${s.naam} (${s.gemeente})` : s.naam);

/**
 * Zoekveld op de officiële scholenlijst. Staat de school er niet in,
 * dan wordt de vrije tekst bewaard als 'andere school'.
 */
export function SchoolKiezer({ tekst, onWijzig, fout, label = 'Huidige school' }: Props) {
  const [scholen, setScholen] = useState<School[]>([]);

  useEffect(() => {
    api.haalScholen().then(setScholen).catch(() => setScholen([]));
  }, []);

  const perLabel = useMemo(() => new Map(scholen.map((s) => [schoolLabel(s).toLowerCase(), s])), [scholen]);
  const gekozen = perLabel.get(tekst.trim().toLowerCase());

  return (
    <>
      <Tekstveld
        id="veld-school"
        label={label}
        waarde={tekst}
        verplicht
        lijst="scholenlijst"
        autoComplete="off"
        fout={fout}
        hulp={
          tekst && !gekozen && scholen.length > 0
            ? 'Niet in de lijst? Typ dan de volledige naam en gemeente van de school.'
            : 'Begin te typen en kies je school uit de lijst.'
        }
        onWijzig={(v) => onWijzig(v, perLabel.get(v.trim().toLowerCase())?.id)}
      />
      <datalist id="scholenlijst">
        {scholen.map((s) => (
          <option key={s.id} value={schoolLabel(s)} />
        ))}
      </datalist>
    </>
  );
}
