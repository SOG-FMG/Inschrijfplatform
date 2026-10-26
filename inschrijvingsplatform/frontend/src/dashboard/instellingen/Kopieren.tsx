import { useState, type ReactNode } from 'react';
import { kopieerApi } from '../../services/beheerApi';
import { foutTekst, Melding, Venster } from '../ui';
import type { Rij } from './velden';

/**
 * Kopiëren binnen een evenement: sessies naar andere tijdsblokken, of een heel moment naar
 * een andere dag. De inschrijvingen gaan niet mee.
 */

function Vinkjes({ items, gekozen, onWijzig }: { items: { id: string; label: ReactNode; uit?: boolean }[]; gekozen: string[]; onWijzig: (ids: string[]) => void }) {
  return (
    <div className="kopie__lijst">
      {items.map((i) => (
        <label key={i.id} className={`d-keuze${i.uit ? ' kopie__uit' : ''}`}>
          <input
            type="checkbox"
            disabled={i.uit}
            checked={gekozen.includes(i.id)}
            onChange={(e) => onWijzig(e.target.checked ? [...gekozen, i.id] : gekozen.filter((x) => x !== i.id))}
          />
          <span>{i.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Wat je kopieert: één sessie (de knop in de tabel) of alle sessies van een tijdsblok. */
export interface SessieKopie {
  sessies: Rij[];
  tijdsblok: Rij;
  dagdeel: Rij;
  dag: Rij;
}

/**
 * Je kiest eerst het moment en daarin het tijdsblok waar de sessie naartoe moet. Zo kan je ze ook
 * van Keuzelesje 1 naar Keuzelesje 2 kopiëren, of naar meerdere blokken in één keer.
 */
export function KopieerSessies({ kopie, dagen, onSluit, onKlaar }: { kopie: SessieKopie; dagen: Rij[]; onSluit: () => void; onKlaar: () => void }) {
  const [bron, setBron] = useState<string[]>(kopie.sessies.map((s) => s.sessie_id));
  const [naar, setNaar] = useState<string[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<ReactNode>(null);
  const [bezig, setBezig] = useState(false);
  const een = kopie.sessies.length === 1;

  const kopieer = async () => {
    setBezig(true);
    setFout(null);
    try {
      const r = await kopieerApi.sessies(bron, naar);
      setResultaat(
        <>
          {r.gekopieerd} sessie(s) gekopieerd.
          {r.overgeslagen.length > 0 && <> Overgeslagen (stond er al): {r.overgeslagen.map((o) => `${o.titel} (${o.tijdsblok})`).join(', ')}.</>}
        </>,
      );
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e, 'Kopiëren mislukt.'));
    } finally {
      setBezig(false);
    }
  };

  return (
    <Venster titel={een ? `“${kopie.sessies[0].titel}” kopiëren` : `Sessies uit ${kopie.tijdsblok.naam} kopiëren`} onSluit={onSluit} breed>
      {resultaat ? (
        <>
          <Melding soort="ok">{resultaat}</Melding>
          <div className="d-knoppen"><button type="button" className="d-knop" onClick={onSluit}>Sluiten</button></div>
        </>
      ) : (
        <>
          {fout && <Melding soort="fout">{fout}</Melding>}
          <p className="d-klein">
            Staat nu in: <strong>{kopie.dag.naam}</strong> · {kopie.dagdeel.naam} · {kopie.tijdsblok.naam}
          </p>
          {!een && (
            <>
              <h3>Welke sessies?</h3>
              <Vinkjes items={kopie.sessies.map((s) => ({ id: s.sessie_id, label: s.titel }))} gekozen={bron} onWijzig={setBron} />
            </>
          )}
          <h3>Naar welk moment en tijdsblok?</h3>
          <p className="d-klein">
            Alle gegevens gaan mee (lokaal, leerkracht, maximum, doelgroep, …), de inschrijvingen niet.
            Een sessie met dezelfde code of titel die er al staat, wordt overgeslagen.
          </p>
          <div className="kopie__boom">
            {dagen.map((d) => (
              <div key={d.dag_id} className="kopie__dag">
                <strong>{d.naam}</strong>
                {d.dagdelen.length === 0 && <p className="d-klein">Geen momenten op deze dag.</p>}
                {d.dagdelen.map((dd: Rij) => (
                  <div key={dd.dagdeel_id} className="kopie__dagdeel">
                    <span className="kopie__moment">
                      {dd.naam} <span className="d-klein">{dd.start_uur}–{dd.eind_uur}</span>
                    </span>
                    <div className="kopie__blokken">
                      {dd.tijdsblokken.length === 0 ? (
                        <span className="d-klein">geen tijdsblokken</span>
                      ) : (
                        dd.tijdsblokken.map((t: Rij) => {
                          const uit = t.tijdsblok_id === kopie.tijdsblok.tijdsblok_id;
                          return (
                            <label key={t.tijdsblok_id} className={`d-keuze${uit ? ' kopie__uit' : ''}`}>
                              <input
                                type="checkbox"
                                disabled={uit}
                                checked={naar.includes(t.tijdsblok_id)}
                                onChange={(e) => setNaar((oud) => (e.target.checked ? [...oud, t.tijdsblok_id] : oud.filter((x) => x !== t.tijdsblok_id)))}
                              />
                              <span>{t.naam} {uit && <em className="d-klein">(staat hier al)</em>}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="d-knoppen">
            <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
            <button type="button" className="d-knop" disabled={bezig || !bron.length || !naar.length} onClick={kopieer}>{bezig ? 'Bezig…' : 'Kopiëren'}</button>
          </div>
        </>
      )}
    </Venster>
  );
}

/** Een moment met al zijn tijdsblokken en sessies naar een andere dag. */
export function KopieerDagdeel({ dagdeel, dag, dagen, onSluit, onKlaar }: { dagdeel: Rij; dag: Rij; dagen: Rij[]; onSluit: () => void; onKlaar: () => void }) {
  const [naar, setNaar] = useState<string[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<ReactNode>(null);
  const [bezig, setBezig] = useState(false);
  const doelen = dagen
    .filter((d) => d.dag_id !== dag.dag_id)
    .map((d) => ({ id: d.dag_id, label: <><strong>{d.naam}</strong> <span className="d-klein">({d.datum})</span></> }));

  const kopieer = async () => {
    setBezig(true);
    setFout(null);
    try {
      await kopieerApi.dagdeel(dagdeel.dagdeel_id, naar);
      setResultaat(<>“{dagdeel.naam}” is gekopieerd naar {naar.length} dag(en), met alle tijdsblokken en sessies.</>);
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e, 'Kopiëren mislukt.'));
    } finally {
      setBezig(false);
    }
  };

  return (
    <Venster titel={`${dagdeel.naam} kopiëren naar een andere dag`} onSluit={onSluit} breed>
      {resultaat ? (
        <>
          <Melding soort="ok">{resultaat}</Melding>
          <div className="d-knoppen"><button type="button" className="d-knop" onClick={onSluit}>Sluiten</button></div>
        </>
      ) : (
        <>
          {fout && <Melding soort="fout">{fout}</Melding>}
          <p>
            Maakt op de gekozen dag(en) een nieuw moment <strong>{dagdeel.naam}</strong> ({dagdeel.start_uur}–{dagdeel.eind_uur})
            met dezelfde tijdsblokken en sessies, zonder inschrijvingen.
          </p>
          <h3>Naar welke dag?</h3>
          {doelen.length ? <Vinkjes items={doelen} gekozen={naar} onWijzig={setNaar} /> : <Melding>Er is nog geen andere dag. Voeg die eerst toe bij Dagen.</Melding>}
          <div className="d-knoppen">
            <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
            <button type="button" className="d-knop" disabled={bezig || !naar.length} onClick={kopieer}>{bezig ? 'Bezig…' : 'Kopiëren'}</button>
          </div>
        </>
      )}
    </Venster>
  );
}
