import { useCallback, useEffect, useRef, useState } from 'react';
import { LesjeKiezer } from '../components/LesjeKiezer';
import { Scanner } from '../components/Scanner';
import { aanwezigheidApi, leesCheckinQr, type ScanResultaat, VIA_TEKST } from '../services/aanwezigheidApi';
import { beheerApi } from '../services/beheerApi';
import { ApiFout } from '../types';
import './dag.css';

/**
 * /checkin/<token>?v=<versie>: het adres in de QR-code van de mail (en op het etiket).
 *   - Een medewerker (onthaal, organisator) ziet het scanresultaat in een kleur:
 *       groen   in orde (meteen aangemeld, met "Ongedaan maken")
 *       geel    let op: oude mail, ander dagdeel of wachtlijst (eerst nakijken, dan "Toch aanmelden")
 *       rood    geen geldige inschrijving voor vandaag: naar de balie
 *       blauw   al aangemeld
 *   - Wie niet aangemeld is (bv. een ouder die de eigen code scant), krijgt uitleg en geen gegevens.
 */

const KLEUR = {
  groen: { titel: 'In orde', teken: '✓' },
  geel: { titel: 'Let op', teken: '!' },
  rood: { titel: 'Naar de balie', teken: '✕' },
  blauw: { titel: 'Al aangemeld', teken: 'i' },
} as const;

const uur = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
const datumKort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }) : '';
const DOOR = { ouder: 'door de ouder', school: 'door de school', wachtlijst: 'door de wachtlijst' } as const;

type Staat =
  | { soort: 'laden' }
  | { soort: 'publiek' }
  | { soort: 'fout'; tekst: string }
  | { soort: 'resultaat'; r: ScanResultaat; net?: 'aangemeld' | 'ongedaan' };

export function CheckinPagina({ token: startToken }: { token: string }) {
  const [scan, setScan] = useState({ token: startToken, v: new URLSearchParams(location.search).get('v') });
  const [staat, setStaat] = useState<Staat>({ soort: 'laden' });
  const [rechten, setRechten] = useState<string[]>([]);
  const [scannen, setScannen] = useState(false);
  const [kiezen, setKiezen] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState('');
  // Groen meldt automatisch aan, maar niet opnieuw na "Ongedaan maken". Eén aanmelding per scan, ook als de pagina
  // twee keer tegelijk laadt (React StrictMode in ontwikkeling): beide wachten op dezelfde aanvraag. Een nieuwe scan
  // van dezelfde persoon is een nieuw object, en toont dus wel "Al aangemeld".
  const automatisch = useRef(true);
  const auto = useRef(new WeakMap<object, Promise<unknown>>());

  const laad = useCallback(async (net?: 'aangemeld' | 'ongedaan') => {
    try {
      let r = await aanwezigheidApi.scan(scan.token, scan.v);
      const bezigOfGedaan = auto.current.get(scan);
      if (automatisch.current && (r.kleur === 'groen' || (r.code === 'AL_AANGEMELD' && bezigOfGedaan))) {
        let p = bezigOfGedaan;
        if (!p) auto.current.set(scan, (p = aanwezigheidApi.meldAan(scan.token)));
        await p;
        net = 'aangemeld';
        r = { ...r, kleur: 'groen', momenten: r.momenten?.map((m) => ({ ...m, aanwezig: true, op: m.op ?? new Date().toISOString(), via: m.via ?? 'qr' })) };
      }
      setStaat({ soort: 'resultaat', r, net });
    } catch (e) {
      if (e instanceof ApiFout && e.code === 'NIET_AANGEMELD') setStaat({ soort: 'publiek' });
      else if (e instanceof ApiFout && e.code === 'GEEN_TOEGANG') setStaat({ soort: 'fout', tekst: 'Je hebt geen toegang om bij dit evenement aan te melden.' });
      else setStaat({ soort: 'fout', tekst: e instanceof Error ? e.message : 'Er ging iets mis.' });
    }
  }, [scan]);

  useEffect(() => {
    setStaat({ soort: 'laden' });
    automatisch.current = true;
    laad();
  }, [laad]);
  useEffect(() => {
    beheerApi.profiel().then((p) => setRechten(p.rechten)).catch(() => undefined);
  }, []);

  const actie = async (wat: 'aan' | 'af') => {
    setBezig(true);
    try {
      if (wat === 'aan') await aanwezigheidApi.meldAan(scan.token);
      else {
        automatisch.current = false;
        await aanwezigheidApi.maakOngedaan(scan.token);
      }
      await laad(wat === 'aan' ? 'aangemeld' : 'ongedaan');
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Er ging iets mis.');
    }
    setBezig(false);
  };

  const gescand = (tekst: string) => {
    const qr = leesCheckinQr(tekst);
    if (!qr) {
      setMelding('Dit is geen QR-code van een inschrijving.');
      return;
    }
    setScannen(false);
    setMelding('');
    history.replaceState(null, '', `/checkin/${qr.token}${qr.v ? `?v=${encodeURIComponent(qr.v)}` : ''}`);
    setScan({ token: qr.token, v: qr.v });
  };

  if (staat.soort === 'laden') return <main className="dag-pagina" aria-busy="true"><p>Even geduld…</p></main>;
  if (staat.soort === 'publiek') return <Uitleg />;
  if (staat.soort === 'fout') return <main className="dag-pagina"><p className="dag-melding dag-melding--fout" role="alert">{staat.tekst}</p></main>;

  const { r, net } = staat;
  const k = KLEUR[r.kleur];
  const vandaag = r.momenten?.filter((m) => m.datum === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())) ?? [];
  const aanwezig = vandaag.find((m) => m.aanwezig || net === 'aangemeld');
  const lesjes = (r.keuzes ?? []).filter((x) => !vandaag.length || vandaag.some((m) => m.datum === x.datum));
  const kanAanmelden = !!r.deelnemer && r.code !== 'GEANNULEERD' && r.code !== 'AL_AANGEMELD' && net !== 'aangemeld' && rechten.includes('evenementen.inchecken');
  const kanLesje = !!r.deelnemer && r.code !== 'GEANNULEERD' && rechten.includes('evenementen.lesje_wijzigen');

  return (
    <main className={`dag-scan dag-scan--${r.kleur}`}>
      <div className="dag-scan__kop" role="status" aria-live="polite">
        <span className="dag-scan__teken" aria-hidden="true">{k.teken}</span>
        <div>
          <p className="dag-scan__titel">{net === 'aangemeld' ? 'Aangemeld' : k.titel}</p>
          {r.deelnemer && <p className="dag-scan__naam">{r.deelnemer.voornaam} {r.deelnemer.naam}</p>}
        </div>
      </div>

      <section className="dag-scan__vak">
        <p className="dag-scan__melding">{net === 'aangemeld' ? 'De aanwezigheid is geregistreerd.' : net === 'ongedaan' ? 'De aanmelding is ongedaan gemaakt.' : r.melding}</p>
        {r.code === 'OUDE_MAIL' && r.gewijzigd?.op && (
          <p>Gewijzigd op {datumKort(r.gewijzigd.op)} om {uur(r.gewijzigd.op)}{r.gewijzigd.door ? ` ${DOOR[r.gewijzigd.door]}` : ''}. Hieronder de huidige lesjes.</p>
        )}
        {aanwezig?.op && <p>Aangemeld om {uur(aanwezig.op)}{aanwezig.via ? ` ${VIA_TEKST[aanwezig.via]}` : ''}.</p>}
        {r.evenement && <p className="dag-klein">{r.evenement.titel}{r.deelnemer && ` · ref. ${r.deelnemer.referentie}`}</p>}

        {(vandaag.length > 0 || lesjes.length > 0) && (
          <ul className="dag-lesjes">
            {vandaag.map((m) => <li key={m.dagdeelId}><strong>{m.dagdeel}</strong> {m.startUur} – {m.eindUur}</li>)}
            {lesjes.map((x) => (
              <li key={x.sessieId} className={x.status === 'wachtlijst' ? 'dag-lesjes--wacht' : ''}>
                {x.startUur} {x.titel}{x.lokaal ? ` · lokaal ${x.lokaal}` : ''}{x.status === 'wachtlijst' ? ' · wachtlijst' : ''}
              </li>
            ))}
          </ul>
        )}
        {r.code === 'ANDERE_DAG' && r.momenten && (
          <ul className="dag-lesjes">{r.momenten.map((m) => <li key={m.dagdeelId}>{m.dag}: {m.dagdeel} {m.startUur} – {m.eindUur}</li>)}</ul>
        )}

        {melding && <p className="dag-melding dag-melding--fout" role="alert">{melding}</p>}
        <div className="dag-knoppen">
          {kanAanmelden && (
            <button type="button" className="dag-knop" disabled={bezig} onClick={() => actie('aan')}>
              {r.kleur === 'groen' ? 'Aanmelden' : 'Toch aanmelden'}
            </button>
          )}
          {(aanwezig || net === 'aangemeld') && rechten.includes('evenementen.inchecken') && (
            <button type="button" className="dag-knop dag-knop--licht" disabled={bezig} onClick={() => actie('af')}>Ongedaan maken</button>
          )}
          {kanLesje && <button type="button" className="dag-knop dag-knop--licht" onClick={() => setKiezen(true)}>Lesje aanpassen</button>}
        </div>
      </section>

      <button type="button" className="dag-knop dag-knop--groot" onClick={() => setScannen(true)}>Volgende scannen</button>
      {r.evenement && <a className="dag-terug" href={`/dashboard/evenementen/${r.evenement.id}/aanwezigheid`}>Naar het overzicht</a>}

      {scannen && <Scanner onCode={gescand} onSluit={() => setScannen(false)} uitleg={melding || undefined} />}
      {kiezen && r.deelnemer && (
        <LesjeKiezer
          deelnemerId={r.deelnemer.id}
          naam={`${r.deelnemer.voornaam} ${r.deelnemer.naam}`}
          overboeken={rechten.includes('evenementen.overboeken')}
          onSluit={() => setKiezen(false)}
          onGekozen={() => {
            setKiezen(false);
            laad();
          }}
        />
      )}
    </main>
  );
}

/** Voor wie niet aangemeld is: de ouder die de eigen code scant, of een medewerker die nog moet aanmelden. */
function Uitleg() {
  const terug = encodeURIComponent(location.pathname + location.search);
  return (
    <main className="pagina">
      <section className="kaartblok">
        <h1>QR-code voor het onthaal</h1>
        <p>Deze code is je toegangsbewijs. Toon de QR-code uit je bevestigingsmail bij aankomst aan het onthaal; daar wordt je aanwezigheid geregistreerd.</p>
        <p>Je inschrijving bekijken, wijzigen of annuleren doe je met de persoonlijke link in dezelfde mail.</p>
        <p className="dag-klein"><a href={`/dashboard?na=${terug}`}>Medewerker van het onthaal? Meld je aan</a></p>
      </section>
    </main>
  );
}
