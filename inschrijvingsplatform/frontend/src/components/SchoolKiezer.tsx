import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
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

/** Maximaal aantal suggesties in de lijst; de gebruiker typt verder om te verfijnen. */
const MAX_SUGGESTIES = 50;

/**
 * Zoekveld op de officiële scholenlijst. Staat de school er niet in,
 * dan wordt de vrije tekst bewaard als 'andere school'.
 *
 * Eigen combobox i.p.v. <datalist>: de native lijst kapt lange namen af en is niet te stylen.
 */
export function SchoolKiezer({ tekst, onWijzig, fout, label = 'Huidige school' }: Props) {
  const [scholen, setScholen] = useState<School[]>([]);
  const [open, setOpen] = useState(false);
  const [actief, setActief] = useState(-1);
  const lijstId = useId();
  const optieId = (i: number) => `${lijstId}-optie-${i}`;

  useEffect(() => {
    api.haalScholen().then(setScholen).catch(() => setScholen([]));
  }, []);

  const items = useMemo(() => scholen.map((s) => ({ school: s, label: schoolLabel(s), laag: schoolLabel(s).toLowerCase() })), [scholen]);
  const perLabel = useMemo(() => new Map(items.map((i) => [i.laag, i.school])), [items]);
  const gekozen = perLabel.get(tekst.trim().toLowerCase());

  // Alle getypte woorden moeten ergens in de naam of gemeente voorkomen.
  const suggesties = useMemo(() => {
    const woorden = tekst.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (woorden.length === 0) return [];
    return items.filter((i) => woorden.every((w) => i.laag.includes(w))).slice(0, MAX_SUGGESTIES);
  }, [items, tekst]);

  const zichtbaar = open && suggesties.length > 0;

  useEffect(() => {
    if (actief >= 0) document.getElementById(optieId(actief))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief]);

  const kies = (i: number) => {
    const s = suggesties[i];
    if (!s) return;
    onWijzig(s.label, s.school.id);
    setOpen(false);
    setActief(-1);
  };

  const toets = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!zichtbaar) setOpen(true);
      else setActief((a) => Math.min(a + 1, suggesties.length - 1));
    } else if (e.key === 'ArrowUp' && zichtbaar) {
      e.preventDefault();
      setActief((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && zichtbaar && actief >= 0) {
      e.preventDefault();
      kies(actief);
    } else if (e.key === 'Escape' && zichtbaar) {
      e.preventDefault();
      setOpen(false);
      setActief(-1);
    }
  };

  return (
    <Tekstveld
      id="veld-school"
      label={label}
      waarde={tekst}
      verplicht
      autoComplete="off"
      fout={fout}
      hulp={
        tekst && !gekozen && scholen.length > 0
          ? 'Niet in de lijst? Typ dan de volledige naam en gemeente van de school.'
          : 'Begin te typen en kies je school uit de lijst.'
      }
      onWijzig={(v) => {
        onWijzig(v, perLabel.get(v.trim().toLowerCase())?.id);
        setOpen(true);
        setActief(-1);
      }}
      invoerProps={{
        role: 'combobox',
        'aria-autocomplete': 'list',
        'aria-expanded': zichtbaar,
        'aria-controls': lijstId,
        'aria-activedescendant': zichtbaar && actief >= 0 ? optieId(actief) : undefined,
        onKeyDown: toets,
        onFocus: () => { if (!gekozen) setOpen(true); },
        onBlur: () => { setOpen(false); setActief(-1); },
      }}
      onderInvoer={
        <ul id={lijstId} role="listbox" aria-label={`${label}: suggesties`} className={`suggesties${zichtbaar ? ' suggesties--open' : ''}`}>
          {suggesties.map((s, i) => (
            <li
              key={s.school.id}
              id={optieId(i)}
              role="option"
              aria-selected={i === actief}
              className={`suggesties__optie${i === actief ? ' suggesties__optie--actief' : ''}`}
              // mousedown voorkomt dat het invoerveld de focus (en dus de lijst) verliest vóór de klik
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => kies(i)}
              onMouseMove={() => { if (actief !== i) setActief(i); }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      }
    />
  );
}
