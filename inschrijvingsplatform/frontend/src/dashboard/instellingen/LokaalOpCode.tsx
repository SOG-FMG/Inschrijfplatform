import { useState } from 'react';
import { instellingenApi } from '../../services/beheerApi';
import { foutTekst, Melding, Venster } from '../ui';
import type { Rij } from './velden';

/**
 * Een lokaal in één keer aan alle lesjes met dezelfde sessiecode hangen.
 *
 * Een code betekent "zelfde lesje in een ander tijdsblok", dus dit raakt doorgaans elk tijdsblok en elke dag.
 * Daarom staat hier eerst de volledige lijst van lesjes die wijzigen, met hun huidige lokaal, en pas daarna de
 * knop. De lijst wordt uit de al geladen boom berekend; de API wijzigt enkel binnen dit evenement.
 */

interface Lesje {
  titel: string;
  dag: string;
  tijdsblok: string;
  locatieId: string | null;
}

/** Alle lesjes met een code, gegroepeerd per code (kleine letters, zodat "LAT" en "lat" samen horen). */
function perCode(dagen: Rij[]): Map<string, { code: string; lesjes: Lesje[] }> {
  const uit = new Map<string, { code: string; lesjes: Lesje[] }>();
  for (const dag of dagen) {
    for (const dd of dag.dagdelen as Rij[]) {
      for (const t of dd.tijdsblokken as Rij[]) {
        for (const s of t.sessies as Rij[]) {
          const code = String(s.code ?? '').trim();
          if (!code) continue;
          const sleutel = code.toLowerCase();
          if (!uit.has(sleutel)) uit.set(sleutel, { code, lesjes: [] });
          uit.get(sleutel)!.lesjes.push({ titel: s.titel, dag: dag.naam, tijdsblok: `${dd.naam} · ${t.naam}`, locatieId: s.locatie_id ?? null });
        }
      }
    }
  }
  return uit;
}

export function LokaalOpCode({
  locatie,
  evenementId,
  dagen,
  lokaalNaam,
  onSluit,
  onKlaar,
}: {
  locatie: Rij;
  evenementId: string;
  dagen: Rij[];
  /** Naam van een lokaal op het scherm, om het huidige lokaal per lesje te tonen. */
  lokaalNaam: (id: string | null) => string;
  onSluit: () => void;
  onKlaar: () => void;
}) {
  const codes = [...perCode(dagen).values()].sort((a, b) => a.code.localeCompare(b.code, 'nl'));
  const [gekozen, setGekozen] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');

  const groep = codes.find((c) => c.code === gekozen);
  // Lesjes die er nog niet staan: enkel die wijzigen echt.
  const wijzigen = groep?.lesjes.filter((l) => l.locatieId !== locatie.locatie_id) ?? [];

  const doorvoeren = async () => {
    setBezig(true);
    setFout('');
    try {
      const r = await instellingenApi.lokaalOpCode(evenementId, gekozen, String(locatie.locatie_id));
      onKlaar();
      onSluit();
      alert(`${r.aantal} lesje(s) kregen lokaal ${locatie.naam}.`);
    } catch (e) {
      setFout(foutTekst(e));
      setBezig(false);
    }
  };

  return (
    <Venster titel={`Lokaal ${locatie.naam} aan een sessiecode`} onSluit={onSluit} breed>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {codes.length === 0 ? (
        <Melding>
          Geen enkel lesje heeft een code. Een code vul je in bij een sessie (achter <strong>Meer…</strong>) en betekent
          "zelfde lesje in een ander tijdsblok".
        </Melding>
      ) : (
        <>
          <div className="d-veld">
            <label htmlFor="lok-code">Sessiecode</label>
            <select id="lok-code" value={gekozen} onChange={(e) => setGekozen(e.target.value)}>
              <option value="">— kies een code —</option>
              {codes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.lesjes.length} lesje{c.lesjes.length === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </div>

          {groep && (
            wijzigen.length === 0 ? (
              <Melding soort="ok">Alle lesjes met code {groep.code} staan al in {locatie.naam}.</Melding>
            ) : (
              <>
                <Melding soort="fout">
                  Let op: <strong>{wijzigen.length} lesje(s)</strong> krijgen lokaal <strong>{locatie.naam}</strong>.
                  Een code loopt over alle tijdsblokken en dagen, dus dit gaat verder dan één moment.
                </Melding>
                <div className="d-tabelvak">
                  <table className="d-tabel d-tabel--compact">
                    <thead>
                      <tr>
                        <th>Lesje</th>
                        <th>Dag</th>
                        <th>Moment en tijdsblok</th>
                        <th>Nu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wijzigen.map((l, i) => (
                        <tr key={i}>
                          <td>{l.titel}</td>
                          <td>{l.dag}</td>
                          <td>{l.tijdsblok}</td>
                          <td>{lokaalNaam(l.locatieId)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}

          <div className="d-knoppen">
            <button type="button" className="d-knop" disabled={bezig || wijzigen.length === 0} onClick={doorvoeren}>
              {bezig ? 'Bezig…' : `Ja, ${wijzigen.length} lesje(s) wijzigen`}
            </button>
            <button type="button" className="d-knop d-knop--secundair" disabled={bezig} onClick={onSluit}>Annuleren</button>
          </div>
        </>
      )}
    </Venster>
  );
}
