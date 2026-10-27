import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { beheerApi, type Mailopmaak, type Mailsjabloon } from '../services/beheerApi';
import { datumTijd, foutTekst, Melding } from './ui';

/**
 * Mailteksten nalezen en aanpassen (module mailsjablonen). De lijst komt uit de manifesten van de actieve modules;
 * een aangepaste tekst vervangt de standaardtekst. Opmaak: lege regel = nieuwe alinea, **vet**, {{veld}},
 * {{#veld}}…{{/veld}} = enkel als ingevuld (zie backend/src/kern/sjablonen.ts).
 */
const OPMAAK = '__opmaak';

export function Mailteksten() {
  const [lijst, setLijst] = useState<Mailsjabloon[] | null>(null);
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(() => {
    beheerApi.mailsjablonen().then((l) => {
      setLijst(l);
      setGekozen((g) => g ?? l[0]?.sleutel ?? null);
    }).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  const sjabloon = lijst?.find((s) => s.sleutel === gekozen);
  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Mailteksten</h1>
          <p className="d-sub">Lees en wijzig de mails die het platform verstuurt. Velden zoals {'{{voornaam}}'} worden bij het versturen ingevuld.</p>
        </div>
      </header>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {!lijst ? <p>Laden…</p> : (
        <div className="mt-raster">
          <nav className="d-kaart mt-lijst" aria-label="Mails">
            <button type="button" className={`mt-keuze${gekozen === OPMAAK ? ' actief' : ''}`} aria-current={gekozen === OPMAAK} onClick={() => setGekozen(OPMAAK)}>
              <strong>Opmaak van alle mails</strong>
              <span className="d-klein">Banners bovenaan en onderaan, voettekst</span>
            </button>
            {lijst.map((s) => (
              <button key={s.sleutel} type="button" className={`mt-keuze${s.sleutel === gekozen ? ' actief' : ''}`} aria-current={s.sleutel === gekozen}
                onClick={() => setGekozen(s.sleutel)}>
                <strong>{s.naam}</strong>
                <span className="d-klein">{s.aangepast ? 'Aangepast' : 'Standaardtekst'} · {s.module}</span>
              </button>
            ))}
          </nav>
          {gekozen === OPMAAK && <Opmaak />}
          {sjabloon && <Editor key={`${sjabloon.sleutel}-${sjabloon.aangepast?.gewijzigdOp ?? ''}`} sjabloon={sjabloon} naVerandering={laad} />}
        </div>
      )}
    </>
  );
}

function Editor({ sjabloon, naVerandering }: { sjabloon: Mailsjabloon; naVerandering: () => void }) {
  const huidig = sjabloon.aangepast ?? sjabloon.standaard;
  const [onderwerp, setOnderwerp] = useState(huidig.onderwerp);
  const [tekst, setTekst] = useState(huidig.tekst);
  const [voorbeeld, setVoorbeeld] = useState<{ onderwerp: string; html: string; fouten: { onderwerp: string[]; tekst: string[] } } | null>(null);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const laatsteVeld = useRef<'onderwerp' | 'tekst'>('tekst');
  const onderwerpRef = useRef<HTMLInputElement>(null);
  const tekstRef = useRef<HTMLTextAreaElement>(null);
  const gewijzigd = onderwerp !== huidig.onderwerp || tekst !== huidig.tekst;

  // Voorbeeld met verzonnen waarden, kort na het typen.
  useEffect(() => {
    const t = setTimeout(() => {
      beheerApi.voorbeeldSjabloon(sjabloon.sleutel, onderwerp, tekst).then(setVoorbeeld).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [sjabloon.sleutel, onderwerp, tekst]);

  /** Veld invoegen waar de cursor staat (in het onderwerp of de tekst, wat het laatst actief was). */
  function voegIn(naam: string) {
    const invoer = `{{${naam}}}`;
    const el = laatsteVeld.current === 'onderwerp' ? onderwerpRef.current : tekstRef.current;
    const waarde = laatsteVeld.current === 'onderwerp' ? onderwerp : tekst;
    const [van, tot] = el ? [el.selectionStart ?? waarde.length, el.selectionEnd ?? waarde.length] : [waarde.length, waarde.length];
    const nieuw = waarde.slice(0, van) + invoer + waarde.slice(tot);
    (laatsteVeld.current === 'onderwerp' ? setOnderwerp : setTekst)(nieuw);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(van + invoer.length, van + invoer.length);
    });
  }

  const actie = async (werk: () => Promise<string>) => {
    setBezig(true);
    setMelding(null);
    try {
      setMelding({ soort: 'ok', tekst: await werk() });
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e) });
    } finally {
      setBezig(false);
    }
  };

  const fouten = [...(voorbeeld?.fouten.onderwerp ?? []), ...(voorbeeld?.fouten.tekst ?? [])];
  return (
    <section className="d-kaart mt-editor">
      <h2>{sjabloon.naam}</h2>
      <p className="d-klein">
        {sjabloon.omschrijving}{' '}
        {sjabloon.aangepast
          ? <>Aangepast {datumTijd(sjabloon.aangepast.gewijzigdOp)}{sjabloon.aangepast.gewijzigdDoor ? ` door ${sjabloon.aangepast.gewijzigdDoor}` : ''}.</>
          : 'Dit is de standaardtekst.'}
      </p>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}

      <div className="d-veld">
        <label htmlFor="mt-onderwerp">Onderwerp</label>
        <input id="mt-onderwerp" ref={onderwerpRef} value={onderwerp} maxLength={200}
          onFocus={() => (laatsteVeld.current = 'onderwerp')} onChange={(e) => setOnderwerp(e.target.value)} />
      </div>

      <div className="mt-velden" role="group" aria-label="Veld invoegen">
        <span className="d-klein">Veld invoegen:</span>
        {sjabloon.velden.map((v) => (
          <button key={v.naam} type="button" className="mt-veldknop" title={v.omschrijving} onClick={() => voegIn(v.naam)}>{`{{${v.naam}}}`}</button>
        ))}
      </div>

      <div className="d-veld">
        <label htmlFor="mt-tekst">Tekst</label>
        <textarea id="mt-tekst" ref={tekstRef} value={tekst} rows={16} className="mt-tekst"
          onFocus={() => (laatsteVeld.current = 'tekst')} onChange={(e) => setTekst(e.target.value)} />
        <span className="d-veld__hulp">
          Lege regel = nieuwe alinea · **vet** · {'{{#veld}}…{{/veld}}'} enkel als het veld ingevuld is · {'{{^veld}}…{{/veld}}'} enkel als het leeg is
        </span>
      </div>
      {fouten.length > 0 && <Melding soort="fout">{fouten.join(' ')}</Melding>}

      {/* Open: hier staat ook wáár je de waarde van een veld instelt (bv. contactEmail bij de instellingen van het evenement). */}
      <details className="d-info" open>
        <summary>Wat betekenen de velden, en waar stel je ze in?</summary>
        <dl className="d-gegevens">
          {sjabloon.velden.map((v) => <Fragment key={v.naam}><dt><code>{`{{${v.naam}}}`}</code></dt><dd>{v.omschrijving}</dd></Fragment>)}
        </dl>
      </details>

      <div className="d-knoppen d-knoppen--links">
        <button type="button" className="d-knop" disabled={bezig || !gewijzigd || fouten.length > 0}
          onClick={() => actie(async () => { await beheerApi.bewaarSjabloon(sjabloon.sleutel, onderwerp, tekst); naVerandering(); return 'Bewaard. Nieuwe mails gebruiken deze tekst.'; })}>
          Bewaren
        </button>
        <button type="button" className="d-knop d-knop--secundair" disabled={bezig || fouten.length > 0}
          onClick={() => actie(async () => {
            const r = await beheerApi.testSjabloon(sjabloon.sleutel, onderwerp, tekst);
            if (!r.ok) throw new Error(r.fout);
            return `Testmail verstuurd naar ${r.aan}, met verzonnen gegevens.`;
          }).catch(() => undefined)}>
          Testmail naar mezelf
        </button>
        {gewijzigd && <button type="button" className="d-knop d-knop--secundair" onClick={() => { setOnderwerp(huidig.onderwerp); setTekst(huidig.tekst); }}>Wijzigingen ongedaan maken</button>}
        {sjabloon.aangepast && (
          <button type="button" className="d-knop d-knop--secundair" disabled={bezig}
            onClick={() => confirm('De standaardtekst terugzetten? De aangepaste tekst gaat verloren.') &&
              actie(async () => { await beheerApi.standaardSjabloon(sjabloon.sleutel); naVerandering(); return 'Standaardtekst teruggezet.'; })}>
            Standaardtekst terugzetten
          </button>
        )}
      </div>

      <h3>Voorbeeld <span className="d-klein">(met verzonnen gegevens)</span></h3>
      {voorbeeld && (
        <div className="mt-voorbeeld">
          <p className="mt-onderwerp"><span className="d-klein">Onderwerp:</span> <strong>{voorbeeld.onderwerp}</strong></p>
          {/* sandbox: de HTML komt van onze eigen opmaak (alles ge-escaped), maar een voorbeeld hoort nooit scripts of links uit te voeren */}
          <iframe title="Voorbeeld van de mail" sandbox="" className="mt-iframe"
            srcDoc={`<!doctype html><meta charset="utf-8"><body style="font:15px/1.5 system-ui,sans-serif;margin:12px;color:#1b1f24">${voorbeeld.html}</body>`} />
        </div>
      )}
    </section>
  );
}

/**
 * Banner bovenaan en onderaan en een eigen voettekst, voor alle mails. Onder elke mail staat daarnaast altijd
 * wie ze verstuurt, via welk platform en waarom de ontvanger ze krijgt (niet aan te passen).
 */
function Opmaak() {
  const [o, setO] = useState<Mailopmaak | null>(null);
  const [voettekst, setVoettekst] = useState('');
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(() => {
    beheerApi.mailopmaak().then((x) => { setO(x); setVoettekst(x.voettekst); }).catch((e) => setMelding({ soort: 'fout', tekst: foutTekst(e) }));
  }, []);
  useEffect(laad, [laad]);

  const actie = async (werk: () => Promise<string>) => {
    setBezig(true);
    setMelding(null);
    try {
      setMelding({ soort: 'ok', tekst: await werk() });
      laad();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e) });
    } finally {
      setBezig(false);
    }
  };

  if (!o) return <section className="d-kaart mt-editor"><p>Laden…</p></section>;
  const banner = (plaats: 'kop' | 'voet', titel: string, url: string | null) => {
    const b = o.banners[plaats];
    return (
      <div className="mt-banner">
        <h3>{titel}</h3>
        <p className="d-klein">
          Aanbevolen: <strong>{b.breedte} × {b.hoogte} px</strong> (getoond op {b.toon} px), PNG of JPG, hoogstens 500 kB.
          Minstens 600 px breed. Zet geen belangrijke tekst enkel in de afbeelding: sommige mailprogramma's tonen afbeeldingen pas na een klik.
        </p>
        {url ? <img src={url} alt={titel} className="mt-bannerbeeld" /> : <p className="d-klein"><em>Geen banner.</em></p>}
        <div className="d-knoppen d-knoppen--links">
          <label className="d-knop d-knop--secundair">
            {url ? 'Andere afbeelding kiezen' : 'Afbeelding kiezen'}
            <input type="file" accept="image/png,image/jpeg" className="sr-only" disabled={bezig}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) actie(async () => {
                  const r = await beheerApi.uploadBanner(plaats, f);
                  return `Banner bewaard (${r.afmetingen.breedte} × ${r.afmetingen.hoogte} px).`;
                });
              }} />
          </label>
          {url && (
            <button type="button" className="d-knop d-knop--secundair" disabled={bezig}
              onClick={() => confirm(`${titel} weghalen?`) && actie(async () => { await beheerApi.verwijderBanner(plaats); return 'Banner weggehaald.'; })}>
              Weghalen
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="d-kaart mt-editor">
      <h2>Opmaak van alle mails</h2>
      <p className="d-klein">Geldt voor elke mail van het platform. Bekijk het resultaat in het voorbeeld van een mailtekst, of stuur er een testmail mee.</p>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}

      <div className="d-veld">
        <label className="d-keuze">
          <input type="checkbox" checked={o.logoUitHuisstijl} disabled={bezig}
            onChange={(e) => {
              const aan = e.target.checked;
              actie(async () => {
                await beheerApi.bewaarLogoUitHuisstijl(aan);
                return aan ? 'Mails gebruiken bovenaan het logo van het evenement.' : 'Mails gebruiken bovenaan de banner.';
              });
            }} />
          Afbeelding uit Instellingen → Algemeen → Huisstijl gebruiken
        </label>
        <span className="d-veld__hulp">
          Aan: bovenaan de mail komt het logo van het evenement waarover de mail gaat, zodat elk evenement zijn eigen
          huisstijl volgt. Heeft dat evenement geen logo, dan komt de banner hieronder alsnog bovenaan.
        </span>
      </div>

      {banner('kop', 'Banner bovenaan', o.kopBanner)}
      {banner('voet', 'Banner onderaan', o.voetBanner)}

      <h3>Voettekst</h3>
      <div className="d-veld">
        <label htmlFor="mt-voettekst">Eigen tekst onderaan elke mail (bv. adres, telefoon, website)</label>
        <textarea id="mt-voettekst" value={voettekst} rows={4} className="mt-tekst" maxLength={2000} onChange={(e) => setVoettekst(e.target.value)} />
        <span className="d-veld__hulp">Velden: {o.velden.map((v) => `{{${v.naam}}}`).join(', ')} · **vet** · lege regel = nieuwe alinea</span>
      </div>
      <p className="d-klein">
        Daaronder staat altijd, en die regel kan je niet weghalen: <em>"Deze mail werd verstuurd door [organisatie] via het inschrijvingsplatform [adres].
        Je ontvangt ze omdat [reden van deze mail]."</em> Zo weet elke ontvanger van wie de mail komt en waarom.
      </p>
      <div className="d-knoppen d-knoppen--links">
        <button type="button" className="d-knop" disabled={bezig || voettekst === o.voettekst}
          onClick={() => actie(async () => { await beheerApi.bewaarVoettekst(voettekst); return 'Voettekst bewaard.'; })}>
          Voettekst bewaren
        </button>
      </div>
    </section>
  );
}
