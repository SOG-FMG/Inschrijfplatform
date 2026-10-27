import { useCallback, useEffect, useMemo, useState } from 'react';
import { LesjeKiezer } from '../components/LesjeKiezer';
import { Scanner } from '../components/Scanner';
import { aanwezigheidApi, type AanwezigheidOverzicht, leesCheckinQr, type OverzichtDeelnemer, VIA_TEKST } from '../services/aanwezigheidApi';
import type { Profiel } from '../services/beheerApi';
import '../pages/dag.css';
import { foutTekst, Link, Melding, Qr } from './ui';

/**
 * Aanwezigheid op de dag zelf (/dashboard/evenementen/<id>/aanwezigheid): wie is er al, hoe aangemeld (QR, balie,
 * in de klas), aanwezig zetten aan de balie, een ander lesje kiezen. Ververst zichzelf elke 15 seconden.
 * Daarnaast: de QR-code mailen aan inschrijvingen van vóór de QR-code.
 */

const uur = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '');
type Filter = 'alle' | 'nog' | 'aanwezig';

export function Aanwezigheid({ evenementId, profiel }: { evenementId: string; profiel: Profiel }) {
  const [data, setData] = useState<AanwezigheidOverzicht | null>(null);
  const [dag, setDag] = useState<string | undefined>();
  const [zoek, setZoek] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState('');
  const [kiezen, setKiezen] = useState<OverzichtDeelnemer | null>(null);
  const [scannen, setScannen] = useState(false);

  const laad = useCallback(() => {
    aanwezigheidApi
      .overzicht(evenementId, dag)
      .then((d) => {
        setData(d);
        setFout('');
      })
      .catch((e) => setFout(foutTekst(e)));
  }, [evenementId, dag]);
  useEffect(laad, [laad]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && laad(), 15_000);
    return () => clearInterval(t);
  }, [laad]);

  const lijst = useMemo(() => {
    const z = zoek.trim().toLowerCase();
    return (data?.deelnemers ?? []).filter(
      (d) =>
        (filter === 'alle' || (filter === 'aanwezig') === d.aanwezig) &&
        (!z || `${d.voornaam} ${d.naam} ${d.school} ${d.referentie}`.toLowerCase().includes(z)),
    );
  }, [data, zoek, filter]);

  /**
   * Uitschrijven en "komt niet" horen bij het beheer van de inschrijving, niet bij de check-in: ze vragen
   * schrijfrechten op het evenement, en die heeft het onthaal niet. De API controleert dat ook zelf.
   */
  const mag = profiel.rol !== 'onthaal';

  const doe = async (d: OverzichtDeelnemer, werk: () => Promise<unknown>) => {
    setBezig(d.id);
    setFout('');
    try {
      await werk();
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig('');
    }
  };

  const komtNiet = (d: OverzichtDeelnemer) =>
    doe(d, () => aanwezigheidApi.zetKomtNiet(d.id, !d.komtNiet));

  const uitschrijven = (d: OverzichtDeelnemer) => {
    const vraag =
      `${d.voornaam} ${d.naam} uitschrijven?\n\n` +
      'De inschrijving wordt geannuleerd: de plaats komt vrij, de wachtlijst schuift door en er gaan geen ' +
      'berichten meer naartoe. De gegevens blijven in de cijfers en het logboek staan.';
    if (!confirm(vraag)) return;
    return doe(d, () => aanwezigheidApi.schrijfUit(d.id));
  };

  const zet = async (d: OverzichtDeelnemer, aanwezig: boolean) => {
    setBezig(d.id);
    try {
      await aanwezigheidApi.zetAanwezig(d.id, aanwezig);
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    }
    setBezig('');
  };

  if (!data) return fout ? <Melding soort="fout">{fout}</Melding> : <p>Even geduld…</p>;
  const rechten = data.rechten ?? { lesjeWijzigen: false, overboeken: false, inchecken: false };
  const dagdeelNaam = new Map(data.dagdelen.map((d) => [d.id, d.naam]));
  const totaal = data.dagdelen.reduce((n, d) => n + d.totaal, 0);
  const aanwezig = data.dagdelen.reduce((n, d) => n + d.aanwezig, 0);
  const pagina = `${location.origin}/dashboard/evenementen/${evenementId}/aanwezigheid`;

  return (
    <>
      <p className="d-kruimel"><Link href="/dashboard">Evenementen</Link> › {data.evenement}</p>
      <header className="d-paginakop">
        <div>
          <h1>Aanwezigheid</h1>
          <p className="d-sub">
            {data.dag ? <><strong>{aanwezig} van {totaal}</strong> aanwezig op {data.dag.naam}.</> : 'Dit evenement heeft geen dagen.'} De lijst ververst zichzelf.
          </p>
        </div>
        {rechten.inchecken && <button type="button" className="d-knop" onClick={() => setScannen(true)}>QR-code scannen</button>}
      </header>

      {fout && <Melding soort="fout">{fout}</Melding>}

      <div className="d-raster aw-tellers">
        {data.dagdelen.map((d) => (
          <div key={d.id} className="d-kaart">
            <h2>{d.naam} <span className="d-klein">{d.startUur} – {d.eindUur}</span></h2>
            <p className="aw-teller"><strong>{d.aanwezig}</strong> van {d.totaal} aanwezig</p>
            <div className="aw-balk" aria-hidden="true"><span style={{ width: `${d.totaal ? (100 * d.aanwezig) / d.totaal : 0}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="d-werkbalk">
        {data.dagen.length > 1 && (
          <select value={data.dag?.id ?? ''} onChange={(e) => setDag(e.target.value)} aria-label="Dag">
            {data.dagen.map((d) => <option key={d.id} value={d.id}>{d.naam}</option>)}
          </select>
        )}
        <input type="search" placeholder="Zoeken op naam, school of referentie…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoeken" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Toon">
          <option value="alle">Iedereen</option>
          <option value="nog">Nog niet aangemeld</option>
          <option value="aanwezig">Aanwezig</option>
        </select>
      </div>

      <div className="d-tabelvak">
        <table className="d-tabel">
          <thead>
            <tr>
              <th>Naam</th>
              <th>School</th>
              <th>Moment</th>
              <th>Lesjes</th>
              <th>Aanwezig</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            {lijst.map((d) => (
              <tr key={`${d.id}-${d.dagdeelId}`}>
                <td>
                  <strong>{d.voornaam} {d.naam}</strong>
                  <div className="d-klein">ref. {d.referentie}{!d.heeftQr && ' · geen QR-code'}</div>
                </td>
                <td>{d.school}<div className="d-klein">{d.leerjaar}</div></td>
                <td>{dagdeelNaam.get(d.dagdeelId)}</td>
                <td>
                  {d.lesjes.length === 0 && <span className="d-klein">—</span>}
                  {d.lesjes.map((l) => (
                    <div key={l.sessieId}>
                      {l.startUur} {l.titel}
                      {l.status === 'wachtlijst' && <span className="d-nee"> · wachtlijst</span>}
                      {l.klas === 'aanwezig' && <span className="d-ok"> · in de klas</span>}
                      {l.klas === 'afwezig' && <span className="d-nee"> · niet in de klas</span>}
                    </div>
                  ))}
                </td>
                <td>
                  {d.aanwezig ? (
                    <span className="aw-status aw-status--ja">✓ Aanwezig</span>
                  ) : (
                    <span className="aw-status aw-status--nee">✕ Nog niet</span>
                  )}
                  {d.aanwezig && <div className="d-klein">{d.via ? `Aangemeld ${VIA_TEKST[d.via]}` : 'Aangemeld'} om {uur(d.op)}</div>}
                  {d.komtNiet && <div className="d-klein d-nee">Komt niet · geen herinnering</div>}
                </td>
                <td className="d-acties">
                  {rechten.inchecken && (
                    d.aanwezig
                      ? <button type="button" className="d-link" disabled={bezig === d.id} onClick={() => zet(d, false)}>Ongedaan maken</button>
                      : <button type="button" className="d-knop d-knop--klein" disabled={bezig === d.id} onClick={() => zet(d, true)}>Aanwezig</button>
                  )}
                  {rechten.lesjeWijzigen && <button type="button" className="d-link" onClick={() => setKiezen(d)}>Aanpassen…</button>}
                  {mag && (
                    <>
                      <button type="button" className="d-link" disabled={bezig === d.id} onClick={() => komtNiet(d)}>
                        {d.komtNiet ? 'Komt toch' : 'Komt niet'}
                      </button>
                      <button type="button" className="d-link d-link--gevaar" disabled={bezig === d.id} onClick={() => uitschrijven(d)}>Uitschrijven</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lijst.length === 0 && <p className="d-klein" style={{ padding: '8px 10px' }}>Niemand gevonden.</p>}
      </div>

      <div className="d-raster">
        <section className="d-kaart aw-qr">
          <Qr tekst={pagina} label="QR-code om deze pagina op je smartphone te openen" />
          <div>
            <h2>Op je smartphone</h2>
            <p>Scan deze code om dit overzicht op je smartphone te openen. Je meldt je daar aan zoals hier.</p>
          </div>
        </section>
        {/* Mails versturen vraagt schrijfrechten op het evenement (organisator); de API controleert dat ook. */}
        {profiel.rol !== 'onthaal' && <QrMails evenementId={evenementId} />}
      </div>

      {kiezen && (
        <LesjeKiezer
          deelnemerId={kiezen.id}
          naam={`${kiezen.voornaam} ${kiezen.naam}`}
          overboeken={rechten.overboeken}
          onSluit={() => setKiezen(null)}
          onGekozen={() => {
            setKiezen(null);
            laad();
          }}
        />
      )}
      {scannen && (
        <Scanner
          onSluit={() => setScannen(false)}
          onCode={(t) => {
            const qr = leesCheckinQr(t);
            if (qr) location.assign(`/checkin/${qr.token}${qr.v ? `?v=${encodeURIComponent(qr.v)}` : ''}`);
          }}
        />
      )}
    </>
  );
}

/** Inschrijvingen van vóór de QR-code: de QR-code alsnog mailen, per reeks van 25. */
function QrMails({ evenementId }: { evenementId: string }) {
  const [te, setTe] = useState<number | null>(null);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState('');
  useEffect(() => {
    aanwezigheidApi.qrMails(evenementId).then((r) => setTe(r.teVersturen)).catch(() => setTe(null));
  }, [evenementId]);

  const verstuur = async () => {
    if (!confirm(`De QR-code mailen aan ${te} inschrijving(en) die er nog geen kregen?`)) return;
    setBezig(true);
    setMelding('');
    let totaal = 0;
    let mislukt = 0;
    try {
      // Per reeks; stopt als er niets meer te versturen is of als een hele reeks mislukt.
      for (;;) {
        const r = await aanwezigheidApi.verstuurQrMails(evenementId);
        totaal += r.verstuurd;
        mislukt += r.mislukt;
        setTe(r.teVersturen);
        if (!r.teVersturen || !r.verstuurd) break;
      }
      setMelding(`${totaal} mail(s) verstuurd${mislukt ? `, ${mislukt} mislukt` : ''}.`);
    } catch (e) {
      setMelding(foutTekst(e));
    }
    setBezig(false);
  };

  return (
    <section className="d-kaart">
      <h2>QR-code mailen</h2>
      <p>Wie inschreef vóór de QR-code bestond, heeft er nog geen in de mail. Stuur hen een mail met hun inschrijving en de QR-code, bij voorkeur een week vooraf.</p>
      {te === null ? <p className="d-klein">Even geduld…</p> : <p><strong>{te}</strong> inschrijving(en) zonder QR-code in de mail.</p>}
      {melding && <Melding soort="ok">{melding}</Melding>}
      <button type="button" className="d-knop" disabled={!te || bezig} onClick={verstuur}>{bezig ? 'Bezig met versturen…' : 'QR-code mailen'}</button>
    </section>
  );
}
