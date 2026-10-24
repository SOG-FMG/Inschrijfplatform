import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { beheerApi, type BeheerMelding, type Logregel, type MeldingStatus } from '../services/beheerApi';
import { datumTijd, foutTekst, Melding, Venster } from './ui';

/**
 * Meldingen via de knop "Probleem of idee?" (enkel platformbeheerders; de API controleert dat ook).
 * Toont per melding de omschrijving, de technische context, de schermafbeelding en het logboek uit
 * de browser. Bovenaan staan de fouten die in meerdere meldingen terugkomen.
 */

const STATUS: Record<MeldingStatus, { tekst: string; soort: string }> = {
  nieuw: { tekst: 'Nieuw', soort: 'concept' },
  in_behandeling: { tekst: 'In behandeling', soort: 'gesloten' },
  afgehandeld: { tekst: 'Afgehandeld', soort: 'gepubliceerd' },
};
const TYPENAAM = { probleem: 'Probleem', wens: 'Wens' } as const;

const isFout = (r: Logregel) => r.niveau === 'fout';
const isOpvallend = (r: Logregel) => r.niveau === 'fout' || r.niveau === 'waarschuwing';

/** Maakt van een foutregel een "soort" fout: id's, getallen en tijden weg, zodat gelijke fouten samen tellen. */
const foutSoort = (bericht: string) =>
  bericht
    .split('\n')[0]
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
    .replace(/\b[0-9a-f]{16}\b/gi, ':ray')
    .replace(/\d+(\s?ms)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

/** Request-id's uit API-regels ("… → 500 in 120 ms [8c1f…]"), om in de Worker-logs op te zoeken. */
const requestIds = (logboek: Logregel[]) =>
  [...new Set(logboek.filter(isOpvallend).flatMap((r) => [...r.bericht.matchAll(/\[([0-9a-z-]{8,})\]/gi)].map((m) => m[1])))];

const uur = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** Platte tekst om in een issue, mail of bij een ontwikkelaar te plakken. Zonder e-mailadres van de melder. */
function alsTekst(m: BeheerMelding): string {
  const ctx = Object.entries(m.context ?? {}).map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const log = m.logboek.map((r) => `${r.t}  ${r.niveau.padEnd(12)} ${r.bericht}`).join('\n');
  return [
    `Melding ${m.referentie} (${TYPENAAM[m.type]}, ${STATUS[m.status].tekst}) - ${m.created_at}`,
    '',
    m.omschrijving,
    '',
    `Pagina: ${m.pagina ?? '-'}`,
    `Versie: ${m.app_versie ?? '-'}`,
    `Browser: ${m.browser ?? '-'}`,
    `Request-id's: ${requestIds(m.logboek).join(', ') || '-'}`,
    'Context:',
    ctx,
    '',
    `Logboek (${m.logboek.length} regels):`,
    log,
  ].join('\n');
}

export function Meldingen() {
  const [lijst, setLijst] = useState<BeheerMelding[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [status, setStatus] = useState<'open' | 'alle' | MeldingStatus>('open');
  const [type, setType] = useState<'' | BeheerMelding['type']>('');
  const [zoek, setZoek] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const laad = useCallback(() => {
    setFout(null);
    beheerApi.meldingen().then(setLijst).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  const zichtbaar = useMemo(() => {
    const z = zoek.trim().toLowerCase();
    return (lijst ?? []).filter((m) => {
      if (status === 'open' ? m.status === 'afgehandeld' : status !== 'alle' && m.status !== status) return false;
      if (type && m.type !== type) return false;
      if (!z) return true;
      return [m.referentie, m.omschrijving, m.pagina ?? '', m.app_versie ?? '', ...m.logboek.map((r) => r.bericht)].some((s) => s.toLowerCase().includes(z));
    });
  }, [lijst, status, type, zoek]);

  const tellers = useMemo(() => {
    const t = { nieuw: 0, in_behandeling: 0, afgehandeld: 0, metFouten: 0 };
    for (const m of lijst ?? []) {
      t[m.status]++;
      if (m.logboek.some(isFout)) t.metFouten++;
    }
    return t;
  }, [lijst]);

  // Fouten die in meerdere (zichtbare) meldingen terugkomen: wat eerst aanpakken.
  const topFouten = useMemo(() => {
    const per = new Map<string, { aantal: number; refs: string[]; laatst: string; versies: Set<string> }>();
    for (const m of zichtbaar) {
      for (const soort of new Set(m.logboek.filter(isFout).map((r) => foutSoort(r.bericht)))) {
        const g = per.get(soort) ?? { aantal: 0, refs: [], laatst: m.created_at, versies: new Set<string>() };
        g.aantal++;
        g.refs.push(m.referentie);
        if (m.created_at > g.laatst) g.laatst = m.created_at;
        if (m.app_versie) g.versies.add(m.app_versie);
        per.set(soort, g);
      }
    }
    return [...per.entries()].sort((a, b) => b[1].aantal - a[1].aantal || b[1].laatst.localeCompare(a[1].laatst)).slice(0, 10);
  }, [zichtbaar]);

  const zetStatus = async (m: BeheerMelding, nieuw: MeldingStatus) => {
    setFout(null);
    try {
      await beheerApi.zetStatusMelding(m.melding_id, nieuw);
      setLijst((l) => l?.map((x) => (x.melding_id === m.melding_id ? { ...x, status: nieuw } : x)) ?? null);
    } catch (e) {
      setFout(foutTekst(e));
    }
  };

  const geopend = lijst?.find((m) => m.melding_id === open);

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Meldingen</h1>
          <p className="d-sub">
            Problemen en wensen via de knop <em>Probleem of idee?</em>, met het logboek uit de browser. Meldingen worden na 90 dagen automatisch verwijderd.
          </p>
        </div>
        <button type="button" className="d-knop d-knop--secundair" onClick={laad}>Vernieuwen</button>
      </header>
      {fout && <Melding soort="fout">{fout}</Melding>}

      {!lijst ? (
        <p>Laden…</p>
      ) : (
        <>
          <div className="m-tellers">
            <Teller label="Nieuw" waarde={tellers.nieuw} />
            <Teller label="In behandeling" waarde={tellers.in_behandeling} />
            <Teller label="Afgehandeld" waarde={tellers.afgehandeld} />
            <Teller label="Met fouten in het logboek" waarde={tellers.metFouten} />
          </div>

          <div className="d-werkbalk">
            <input type="search" placeholder="Zoeken (ook in het logboek)…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoeken" />
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
              <option value="open">Openstaand</option>
              <option value="nieuw">Nieuw</option>
              <option value="in_behandeling">In behandeling</option>
              <option value="afgehandeld">Afgehandeld</option>
              <option value="alle">Alle</option>
            </select>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Soort">
              <option value="">Problemen en wensen</option>
              <option value="probleem">Enkel problemen</option>
              <option value="wens">Enkel wensen</option>
            </select>
          </div>

          {topFouten.length > 0 && (
            <section className="d-kaart">
              <h2>Meest voorkomende fouten</h2>
              <p className="d-klein">Fouten uit het browserlogboek van de meldingen hierboven gefilterd, gegroepeerd (getallen en id's weggelaten).</p>
              <div className="d-tabelvak">
                <table className="d-tabel d-tabel--compact">
                  <thead>
                    <tr>
                      <th className="getal">Meldingen</th>
                      <th>Fout</th>
                      <th>Versies</th>
                      <th>Laatst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFouten.map(([soort, g]) => (
                      <tr key={soort}>
                        <td className="getal">{g.aantal}</td>
                        <td>
                          <code className="m-code">{soort}</code>
                          <div className="d-klein">
                            {g.refs.slice(0, 6).map((r, i) => (
                              <span key={r}>
                                {i > 0 && ', '}
                                <button type="button" className="d-link" onClick={() => setOpen(zichtbaar.find((m) => m.referentie === r)?.melding_id ?? null)}>{r}</button>
                              </span>
                            ))}
                            {g.refs.length > 6 && <> en {g.refs.length - 6} meer</>}
                          </div>
                        </td>
                        <td className="d-klein">{[...g.versies].join(', ') || '—'}</td>
                        <td className="d-klein">{datumTijd(g.laatst)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!zichtbaar.length ? (
            <Melding>Geen meldingen voor deze keuze.</Melding>
          ) : (
            <div className="d-tabelvak">
              <table className="d-tabel">
                <thead>
                  <tr>
                    <th>Ontvangen</th>
                    <th>Ref.</th>
                    <th>Soort</th>
                    <th>Omschrijving</th>
                    <th>Pagina</th>
                    <th>Versie</th>
                    <th className="getal">Fouten</th>
                    <th>Status</th>
                    <th>Acties</th>
                  </tr>
                </thead>
                <tbody>
                  {zichtbaar.map((m) => {
                    const fouten = m.logboek.filter(isFout).length;
                    return (
                      <tr key={m.melding_id} className={m.status === 'afgehandeld' ? 'd-gedimd' : undefined}>
                        <td>{datumTijd(m.created_at)}</td>
                        <td><code>{m.referentie}</code></td>
                        <td>{TYPENAAM[m.type]}</td>
                        <td><div className="m-omschrijving">{m.omschrijving}</div></td>
                        <td className="d-klein m-pagina">{m.pagina ? new URL(m.pagina, location.origin).pathname : '—'}</td>
                        <td className="d-klein">{m.app_versie ?? '—'}</td>
                        <td className="getal">{fouten ? <span className="d-nee">{fouten}</span> : '—'}</td>
                        <td><span className={`d-badge d-badge--${STATUS[m.status].soort} m-nowrap`}>{STATUS[m.status].tekst}</span></td>
                        <td className="d-acties">
                          <button type="button" className="d-link" onClick={() => setOpen(m.melding_id)}>Bekijken</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {geopend && <Detail melding={geopend} onSluit={() => setOpen(null)} onStatus={(s) => zetStatus(geopend, s)} />}
    </>
  );
}

function Teller({ label, waarde }: { label: string; waarde: number }) {
  return (
    <div className="d-kaart m-teller">
      <strong>{waarde}</strong>
      <span>{label}</span>
    </div>
  );
}

function Detail({ melding: m, onSluit, onStatus }: { melding: BeheerMelding; onSluit: () => void; onStatus: (s: MeldingStatus) => void }) {
  const [enkelOpvallend, setEnkelOpvallend] = useState(false);
  const [gekopieerd, setGekopieerd] = useState(false);
  const regels = enkelOpvallend ? m.logboek.filter(isOpvallend) : m.logboek;
  const ids = requestIds(m.logboek);

  return (
    <Venster titel={`Melding ${m.referentie}`} onSluit={onSluit} breed>
      <div className="d-knoppen d-knoppen--links">
        {(Object.keys(STATUS) as MeldingStatus[]).map((s) => (
          <button key={s} type="button" className={`d-knop d-knop--klein${s === m.status ? '' : ' d-knop--secundair'}`} aria-pressed={s === m.status}
            onClick={() => s !== m.status && onStatus(s)}>
            {STATUS[s].tekst}
          </button>
        ))}
        <button type="button" className="d-knop d-knop--klein d-knop--secundair"
          onClick={() => navigator.clipboard?.writeText(alsTekst(m)).then(() => setGekopieerd(true))}>
          {gekopieerd ? '✓ Gekopieerd' : 'Kopiëren als tekst'}
        </button>
      </div>

      <h3>{TYPENAAM[m.type]}</h3>
      <p className="m-tekst">{m.omschrijving}</p>
      {m.email && <p>Contact: <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Je melding ${m.referentie}`)}`}>{m.email}</a></p>}

      <h3>Technische gegevens</h3>
      <dl className="d-gegevens">
        <dt>Ontvangen</dt><dd>{datumTijd(m.created_at)}</dd>
        <dt>Pagina</dt><dd className="m-breek">{m.pagina ?? '—'}</dd>
        <dt>Versie</dt><dd>{m.app_versie ?? '—'}</dd>
        <dt>Browser</dt><dd className="m-breek">{m.browser ?? '—'}</dd>
        {Object.entries(m.context ?? {}).map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt><dd>{v === true ? 'ja' : v === false ? 'nee' : String(v ?? '—')}</dd>
          </Fragment>
        ))}
        {ids.length > 0 && (
          <>
            <dt>Request-id's</dt>
            <dd className="m-breek"><code>{ids.join(', ')}</code> <span className="d-klein">(zoek in Cloudflare → Workers → Observability)</span></dd>
          </>
        )}
      </dl>

      {m.screenshot && (
        <>
          <h3>Schermafbeelding</h3>
          <a href={beheerApi.screenshotUrl(m.screenshot)} target="_blank" rel="noreferrer">
            <img className="m-screenshot" src={beheerApi.screenshotUrl(m.screenshot)} alt={`Schermafbeelding bij melding ${m.referentie}`} />
          </a>
        </>
      )}

      <h3>Logboek <span className="d-klein">({m.logboek.length} regels, oudste eerst)</span></h3>
      {m.logboek.length > 0 && (
        <label className="d-klein">
          <input type="checkbox" checked={enkelOpvallend} onChange={(e) => setEnkelOpvallend(e.target.checked)} /> Enkel waarschuwingen en fouten
        </label>
      )}
      {!regels.length ? (
        <p className="d-klein">Geen regels.</p>
      ) : (
        <div className="d-tabelvak">
          <table className="d-tabel d-tabel--compact m-logboek">
            <tbody>
              {regels.map((r, i) => (
                <tr key={i} className={`m-log--${r.niveau}`}>
                  <td className="m-tijd">{uur(r.t)}</td>
                  <td className="m-niveau">{r.niveau}</td>
                  <td><code className="m-code">{r.bericht}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Venster>
  );
}
