import { useEffect, useRef, useState } from 'react';
import { aanwezigheidApi, type LesBlok, type LesOptie } from '../services/aanwezigheidApi';
import { ApiFout } from '../types';

/**
 * Een ander lesje kiezen voor een deelnemer (onthaal). Per tijdsblok de lesjes: het gekozen lesje aangeduid,
 * groen als er nog plaats is, rood als het vol zit, met "6 van 8 plaatsen bezet" en de details.
 * Een vol lesje kiezen (overboeken) kan enkel met het recht daarvoor, na een bevestiging.
 */
export function LesjeKiezer({ deelnemerId, naam, overboeken, onSluit, onGekozen }: {
  deelnemerId: string;
  naam: string;
  overboeken: boolean;
  onSluit: () => void;
  onGekozen: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [blokken, setBlokken] = useState<LesBlok[] | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState('');
  const [verwittig, setVerwittig] = useState(true);
  const [bevestig, setBevestig] = useState<LesOptie | null>(null);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal?.();
    aanwezigheidApi
      .lesjes(deelnemerId)
      .then((r) => setBlokken(r.blokken))
      .catch((e) => setFout(e instanceof ApiFout ? e.message : 'De lesjes konden niet geladen worden.'));
  }, [deelnemerId]);

  const kies = async (s: LesOptie, forceer: boolean) => {
    setBezig(s.id);
    setFout('');
    try {
      await aanwezigheidApi.kiesLesje(deelnemerId, s.id, forceer, verwittig);
      onGekozen();
    } catch (e) {
      setFout(e instanceof ApiFout ? e.message : 'Het lesje kon niet gewijzigd worden.');
      setBezig('');
    }
  };

  return (
    <dialog ref={ref} className="dag-venster" onClose={onSluit} aria-label={`Lesje aanpassen voor ${naam}`}>
      <header className="dag-venster__kop">
        <h2>Lesje aanpassen <span>{naam}</span></h2>
        <button type="button" className="dag-sluit" aria-label="Sluiten" onClick={onSluit}>×</button>
      </header>
      <div className="dag-venster__inhoud">
        {fout && <p className="dag-melding dag-melding--fout" role="alert">{fout}</p>}
        {!blokken && !fout && <p>Even geduld…</p>}
        {blokken?.length === 0 && <p>Er zijn geen lesjes te kiezen voor deze inschrijving.</p>}
        {blokken?.map((b) => (
          <section key={b.id} className="lk-blok">
            <h3>{b.naam} <span>{b.dag} · {b.startUur} – {b.eindUur}</span></h3>
            <ul className="lk-lijst">
              {b.sessies.map((s) => {
                const kan = s.open && (!s.vol || overboeken) && !s.gekozen;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`lk-lesje ${s.vol ? 'lk-lesje--vol' : 'lk-lesje--vrij'}${s.gekozen ? ' lk-lesje--gekozen' : ''}`}
                      disabled={!kan || !!bezig}
                      aria-pressed={!!s.gekozen}
                      onClick={() => (s.vol ? setBevestig(s) : kies(s, false))}
                    >
                      <span className="lk-lesje__titel">
                        {s.gekozen && <strong className="lk-gekozen">✓ Gekozen{s.gekozen === 'wachtlijst' ? ' (wachtlijst)' : ''}</strong>}
                        {s.titel}
                      </span>
                      <span className="lk-lesje__plaatsen">
                        {s.capaciteit == null ? `${s.bevestigd} ingeschreven, geen maximum` : `${s.bevestigd} van ${s.capaciteit} plaatsen bezet`}
                        {s.vol ? ' · vol' : ''}
                        {s.wachtlijst > 0 && ` · ${s.wachtlijst} op de wachtlijst`}
                      </span>
                      <span className="lk-lesje__info">
                        {[s.lokaal && `Lokaal ${s.lokaal}`, s.lesgever, !s.open && 'gesloten'].filter(Boolean).join(' · ')}
                      </span>
                      {s.beschrijving && <span className="lk-lesje__info">{s.beschrijving}</span>}
                      {bezig === s.id && <span className="lk-lesje__info">Bezig…</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <label className="dag-vinkje">
          <input type="checkbox" checked={verwittig} onChange={(e) => setVerwittig(e.target.checked)} />
          Verwittig de ouder per mail (met een nieuwe QR-code)
        </label>
        {bevestig && (
          <div className="dag-bevestig" role="alertdialog" aria-label="Overboeken bevestigen">
            <p>
              <strong>{bevestig.titel}</strong> zit vol ({bevestig.bevestigd} van {bevestig.capaciteit}). Toch overboeken?
            </p>
            <div className="dag-knoppen">
              <button type="button" className="dag-knop dag-knop--rood" onClick={() => { const s = bevestig; setBevestig(null); kies(s, true); }}>Ja, overboeken</button>
              <button type="button" className="dag-knop dag-knop--licht" onClick={() => setBevestig(null)}>Annuleren</button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
