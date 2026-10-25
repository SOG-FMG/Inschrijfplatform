import { useCallback, useEffect, useState } from 'react';
import { Scanner } from '../components/Scanner';
import {
  leesCheckinQr, type MijnSessies, type ScanInSessie, type SessieTabel, sessiegeverApi, tabelApi, type TabelDeelnemer, VIA_TEKST,
} from '../services/aanwezigheidApi';
import { useInstallatie } from '../services/installatie';
import { ApiFout } from '../types';
import './dag.css';

/**
 * Pagina's voor sessiegevers (lesgever, spreker, ...: de term volgt de installatie). Geen medewerkers: ze melden
 * zich aan met hun e-mailadres en een code per mail, en zien enkel hun eigen sessies.
 *   /sessiegever   aanmelden en "Mijn sessies"
 *   /les/<id>      de live tabel van één sessie (ook voor medewerkers, via de QR-code op de klaslijst)
 */

const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const uur = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '');
const fout = (e: unknown, standaard = 'Er ging iets mis.') => (e instanceof Error && e.message ? e.message : standaard);

/** Aanmelden in twee stappen: e-mailadres, dan de code uit de mail. */
function Aanmelden({ naKlaar, term }: { naKlaar: () => void; term: string }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stap, setStap] = useState<'email' | 'code'>('email');
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState('');
  const terug = encodeURIComponent(location.pathname);

  const vraag = async () => {
    setBezig(true);
    setMelding('');
    try {
      await sessiegeverApi.vraagCode(email.trim());
      setStap('code');
    } catch (e) {
      setMelding(fout(e));
    }
    setBezig(false);
  };
  const meldAan = async () => {
    setBezig(true);
    setMelding('');
    try {
      await sessiegeverApi.meldAan(email.trim(), code.replace(/\s/g, ''));
      naKlaar();
    } catch (e) {
      setMelding(e instanceof ApiFout && e.code === 'AANMELDEN_MISLUKT' ? 'Deze code klopt niet of is verlopen. Vraag een nieuwe code aan.' : fout(e));
    }
    setBezig(false);
  };

  return (
    <main className="pagina">
      <section className="kaartblok">
        <h1>Aanmelden als {term}</h1>
        {stap === 'email' ? (
          <form onSubmit={(e) => { e.preventDefault(); vraag(); }}>
            <p>Vul je e-mailadres in. Je krijgt een code per mail; een wachtwoord is niet nodig.</p>
            <label className="dag-veld">
              E-mailadres
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className="dag-knop" disabled={bezig || !email.includes('@')}>Stuur me een code</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); meldAan(); }}>
            <p>Is <strong>{email}</strong> geregistreerd als {term}, dan krijg je binnen een minuut een mail met een code van 6 cijfers. Ze is 10 minuten geldig.</p>
            <label className="dag-veld">
              Code
              <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <div className="dag-knoppen">
              <button type="submit" className="dag-knop" disabled={bezig || code.replace(/\s/g, '').length !== 6}>Aanmelden</button>
              <button type="button" className="dag-knop dag-knop--licht" onClick={() => { setStap('email'); setCode(''); }}>Ander adres of nieuwe code</button>
            </div>
          </form>
        )}
        {melding && <p className="dag-melding dag-melding--fout" role="alert">{melding}</p>}
        <p className="dag-klein"><a href={`/dashboard?na=${terug}`}>Medewerker? Meld je aan via het dashboard</a></p>
      </section>
    </main>
  );
}

/** /sessiegever */
export function SessiegeverPagina() {
  const { termen } = useInstallatie();
  const [ik, setIk] = useState<MijnSessies | null | 'laden'>('laden');
  const laad = useCallback(() => {
    sessiegeverApi.ik().then(setIk).catch(() => setIk(null));
  }, []);
  useEffect(laad, [laad]);

  if (ik === 'laden') return <main className="dag-pagina" aria-busy="true"><p>Even geduld…</p></main>;
  if (!ik) return <Aanmelden naKlaar={laad} term={termen.sessiegever} />;
  return (
    <main className="dag-pagina">
      <header className="dag-kop">
        <h1>Mijn sessies</h1>
        <p className="dag-klein">{ik.voornaam} {ik.naam} · {ik.email}</p>
      </header>
      {ik.sessies.length === 0 && <p>Er zijn geen (komende) sessies aan je gekoppeld.</p>}
      <ul className="dag-kaarten">
        {ik.sessies.map((s) => (
          <li key={s.id}>
            <a className="dag-kaart" href={`/les/${s.id}`}>
              <strong>{s.titel}</strong>
              <span>{s.dag} · {s.tijdsblok} {s.startUur} – {s.eindUur}{s.lokaal ? ` · lokaal ${s.lokaal}` : ''}</span>
              <span>{s.bevestigd}{s.capaciteit != null ? ` van ${s.capaciteit}` : ''} ingeschreven{s.wachtlijst ? ` · ${s.wachtlijst} op de wachtlijst` : ''}</span>
              <span className="dag-klein">{s.evenement}</span>
            </a>
          </li>
        ))}
      </ul>
      <button type="button" className="dag-knop dag-knop--licht" onClick={() => sessiegeverApi.meldAf().finally(laad)}>Afmelden</button>
    </main>
  );
}

const TOESTAND = {
  klas: { tekst: 'In het lesje', klasse: 'klas' },
  afwezig: { tekst: 'Niet in het lesje', klasse: 'afwezig' },
  school: { tekst: 'Op school', klasse: 'school' },
  nog: { tekst: 'Nog niet aangemeld', klasse: 'nog' },
} as const;
const toestand = (d: TabelDeelnemer) => (d.klas === 'aanwezig' ? 'klas' : d.klas === 'afwezig' ? 'afwezig' : d.opSchool ? 'school' : 'nog');

/** /les/<id>: de tabel van één sessie, live (ververst elke 15 seconden). */
export function LesPagina({ sessieId }: { sessieId: string }) {
  const { termen } = useInstallatie();
  const [wie, setWie] = useState<'sessiegever' | 'medewerker' | null>(null);
  const [tabel, setTabel] = useState<SessieTabel | null>(null);
  const [staat, setStaat] = useState<'laden' | 'aanmelden' | 'klaar' | 'geenToegang'>('laden');
  const [scannen, setScannen] = useState(false);
  const [scan, setScan] = useState<ScanInSessie | null>(null);
  const [gescandeTekst, setGescandeTekst] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState('');

  const laad = useCallback(async () => {
    // Eerst als sessiegever, dan als medewerker (dezelfde QR-code op de klaslijst voor beiden).
    for (const w of wie ? [wie] : (['sessiegever', 'medewerker'] as const)) {
      try {
        setTabel(await tabelApi(w).tabel(sessieId));
        setWie(w);
        setStaat('klaar');
        return;
      } catch (e) {
        if (e instanceof ApiFout && e.code === 'GEEN_TOEGANG') return setStaat('geenToegang');
        if (!(e instanceof ApiFout && e.code === 'NIET_AANGEMELD')) {
          setMelding(fout(e));
          return;
        }
      }
    }
    setStaat('aanmelden');
  }, [sessieId, wie]);

  useEffect(() => {
    laad();
  }, [laad]);
  useEffect(() => {
    if (staat !== 'klaar') return;
    const t = setInterval(() => document.visibilityState === 'visible' && laad(), 15_000);
    return () => clearInterval(t);
  }, [staat, laad]);

  if (staat === 'laden') return <main className="dag-pagina" aria-busy="true"><p>Even geduld…</p>{melding && <p className="dag-melding dag-melding--fout">{melding}</p>}</main>;
  if (staat === 'aanmelden') return <Aanmelden naKlaar={() => { setStaat('laden'); laad(); }} term={termen.sessiegever} />;
  if (staat === 'geenToegang' || !tabel || !wie) {
    return (
      <main className="pagina">
        <section className="kaartblok">
          <h1>Geen toegang</h1>
          <p>Je kan enkel de lijsten van je eigen sessies openen, tot 5 dagen na de sessie.</p>
          <p><a href="/sessiegever">Naar mijn sessies</a></p>
        </section>
      </main>
    );
  }

  const api = tabelApi(wie);
  const { sessie, deelnemers } = tabel;
  const kan = tabel.rechten.includes('evenementen.inchecken');
  const tel = (t: keyof typeof TOESTAND) => deelnemers.filter((d) => toestand(d) === t).length;

  const zet = async (d: TabelDeelnemer, klas: 'aanwezig' | 'afwezig' | null) => {
    setBezig(d.id);
    setMelding('');
    try {
      await api.zetKlas(sessie.id, d.id, klas);
      await laad();
    } catch (e) {
      setMelding(fout(e));
    }
    setBezig('');
  };
  const gescand = async (tekst: string, toevoegen = false) => {
    const qr = leesCheckinQr(tekst);
    setScannen(false);
    setGescandeTekst(tekst);
    if (!qr) return setScan({ resultaat: 'onbekend' });
    try {
      setScan(await api.scan(sessie.id, qr.token, toevoegen));
      await laad();
    } catch (e) {
      setMelding(fout(e));
    }
  };

  return (
    <main className="dag-pagina">
      <header className="dag-kop">
        <p className="dag-klein">{sessie.evenement}</p>
        <h1>{sessie.titel}</h1>
        <p>{sessie.dag} · {sessie.tijdsblok} {sessie.startUur} – {sessie.eindUur}{sessie.lokaal ? ` · lokaal ${sessie.lokaal}` : ''}</p>
        <p className="dag-klein">{sessie.bevestigd}{sessie.capaciteit != null ? ` van ${sessie.capaciteit}` : ''} ingeschreven{sessie.lesgever ? ` · ${hoofdletter(termen.sessiegever)}: ${sessie.lesgever}` : ''}</p>
      </header>

      <div className="dag-tellers" role="status">
        <span className="dag-teller dag-teller--klas">{tel('klas')} in het lesje</span>
        <span className="dag-teller dag-teller--school">{tel('school')} op school</span>
        <span className="dag-teller dag-teller--afwezig">{tel('afwezig')} niet hier</span>
        <span className="dag-teller dag-teller--nog">{tel('nog')} nog niet aangemeld</span>
      </div>

      {!tabel.vandaag && <p className="dag-melding">Aanduiden wie er is, kan op de dag van de sessie zelf. Nu zie je wie ingeschreven is.</p>}
      {melding && <p className="dag-melding dag-melding--fout" role="alert">{melding}</p>}
      {scan && <ScanMelding scan={scan} onSluit={() => setScan(null)} onToevoegen={() => gescand(gescandeTekst, true)} />}

      {kan && tabel.vandaag && <button type="button" className="dag-knop dag-knop--groot" onClick={() => setScannen(true)}>Etiket scannen</button>}

      <ul className="dag-rijen">
        {deelnemers.map((d) => {
          const t = TOESTAND[toestand(d)];
          return (
            <li key={d.id} className={`dag-rij dag-rij--${t.klasse}`}>
              <div className="dag-rij__wie">
                <strong>{d.voornaam} {d.naam}</strong>
                <span className="dag-klein">{[d.school, d.leerjaar, d.status === 'wachtlijst' && 'wachtlijst'].filter(Boolean).join(' · ')}</span>
                {tabel.velden.map((v) => d.extra[v.id] && <span key={v.id} className="dag-klein">{v.label}: {d.extra[v.id]}</span>)}
                <span className="dag-rij__toestand">
                  {t.tekst}
                  {toestand(d) === 'school' && d.via && ` (${VIA_TEKST[d.via]}, ${uur(d.op)})`}
                </span>
              </div>
              {kan && tabel.vandaag && (
                <div className="dag-rij__knoppen">
                  <button type="button" className="dag-knop dag-knop--klein dag-knop--licht dag-knop--hier" aria-pressed={d.klas === 'aanwezig'} disabled={bezig === d.id}
                    onClick={() => zet(d, d.klas === 'aanwezig' ? null : 'aanwezig')}>✓ Hier</button>
                  <button type="button" className="dag-knop dag-knop--klein dag-knop--licht" aria-pressed={d.klas === 'afwezig'} disabled={bezig === d.id}
                    onClick={() => zet(d, d.klas === 'afwezig' ? null : 'afwezig')}>Niet hier</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {deelnemers.length === 0 && <p>Nog niemand ingeschreven.</p>}
      {wie === 'sessiegever' && <a className="dag-terug" href="/sessiegever">Mijn sessies</a>}

      {scannen && <Scanner onCode={(t) => gescand(t)} onSluit={() => setScannen(false)} uitleg="Scan de QR-code op het etiket van de deelnemer." />}
    </main>
  );
}

function ScanMelding({ scan, onSluit, onToevoegen }: { scan: ScanInSessie; onSluit: () => void; onToevoegen: () => void }) {
  let inhoud;
  if (scan.resultaat === 'onbekend') inhoud = <p>Deze QR-code hoort niet bij een inschrijving voor dit evenement.</p>;
  else if (scan.resultaat === 'aangeduid') inhoud = <p><strong>{scan.naam}</strong> is aangeduid als in het lesje.</p>;
  else if (scan.resultaat === 'toegevoegd') inhoud = <p><strong>{scan.naam}</strong> zit nu in dit lesje en is aangeduid.</p>;
  else if (scan.resultaat === 'niet_op_lijst') {
    inhoud = (
      <>
        <p><strong>{scan.naam}</strong> staat niet op de lijst van dit lesje.</p>
        {scan.lesjes.length > 0 && <p>Ingeschreven voor: {scan.lesjes.map((l) => `${l.startUur} ${l.titel}${l.lokaal ? ` (lokaal ${l.lokaal})` : ''}`).join(', ')}.</p>}
        {scan.kanToevoegen ? (
          <button type="button" className="dag-knop" onClick={onToevoegen}>Toch in dit lesje zetten</button>
        ) : (
          <p>Meld dit aan het onthaal; daar kan het lesje aangepast worden.</p>
        )}
      </>
    );
  }
  return (
    <div className={`dag-melding ${scan.resultaat === 'aangeduid' || scan.resultaat === 'toegevoegd' ? 'dag-melding--ok' : 'dag-melding--let-op'}`} role="status">
      {inhoud}
      <button type="button" className="dag-link" onClick={onSluit}>Sluiten</button>
    </div>
  );
}
