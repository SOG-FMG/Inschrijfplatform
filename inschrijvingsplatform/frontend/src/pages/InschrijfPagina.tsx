import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MomentKiezer } from '../components/MomentKiezer';
import { Overzicht } from '../components/Overzicht';
import { SchoolKiezer } from '../components/SchoolKiezer';
import { SessieKiezer, sessiesVoor } from '../components/SessieKiezer';
import { Stappen } from '../components/Stappen';
import { Turnstile, TURNSTILE_SITEKEY } from '../components/Turnstile';
import { Keuzerondjes, Tekstveld } from '../components/Velden';
import { api, isDemo } from '../services/api';
import { zetHuisstijl } from '../services/huisstijl';
import { log } from '../services/logboek';
import { ApiFout, type Evenement, type Keuze, type Moment, type RegistratieAntwoord, type Tijdsblok } from '../types';

interface Formulier {
  doelgroepId: string;
  email: string;
  contactVoornaam: string;
  contactNaam: string;
  telefoon: string;
  voornaam: string;
  naam: string;
  schoolTekst: string;
  schoolId?: string;
  leerjaar: string;
  functie: string;
  opmerkingen: string;
  dagdelen: string[];
  /** tijdsblokId → sessieId ('' = bewust geen keuze) */
  keuzes: Record<string, string>;
  privacy: boolean;
  website: string;
}

const LEEG: Formulier = {
  doelgroepId: '', email: '', contactVoornaam: '', contactNaam: '', telefoon: '', voornaam: '', naam: '',
  schoolTekst: '', leerjaar: '', functie: '', opmerkingen: '', dagdelen: [], keuzes: {}, privacy: false, website: '',
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEFOON = /^[+0-9 ()./-]{8,20}$/;

type Fouten = Record<string, string>;

export function InschrijfPagina({ slug }: { slug: string }) {
  const [evenement, setEvenement] = useState<Evenement | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [f, setF] = useState<Formulier>(LEEG);
  const [stap, setStap] = useState(0);
  const [fouten, setFouten] = useState<Fouten>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [volzetGemeld, setVolzetGemeld] = useState<string>();
  const [bezig, setBezig] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [antwoord, setAntwoord] = useState<RegistratieAntwoord | null>(null);
  const kopRef = useRef<HTMLHeadingElement>(null);
  const foutRef = useRef<HTMLDivElement>(null);

  const wijzig = <K extends keyof Formulier>(k: K, v: Formulier[K]) => {
    setF((oud) => ({ ...oud, [k]: v }));
    setFouten((oud) => {
      if (!oud[k as string]) return oud;
      const { [k as string]: _weg, ...rest } = oud;
      return rest;
    });
  };

  const laad = useCallback(async () => {
    try {
      const ev = await api.haalEvenement(slug);
      setEvenement(ev);
      zetHuisstijl(ev.kleurPrimair, ev.kleurAccent);
      return ev;
    } catch (e) {
      setLaadFout(e instanceof ApiFout ? e.message : 'Het formulier kon niet geladen worden.');
      return null;
    }
  }, [slug]);

  useEffect(() => {
    laad();
  }, [laad]);

  useEffect(() => {
    if (evenement) document.title = `Inschrijven – ${evenement.titel}`;
  }, [evenement]);

  const doelgroep = evenement?.doelgroepen.find((g) => g.id === f.doelgroepId);
  const leerling = evenement?.deelnemerType !== 'volwassene';

  /** Keuzeblokken die bij de gekozen momenten en doelgroep horen. */
  const keuzeBlokken = useMemo(() => {
    if (!evenement || (doelgroep && !doelgroep.sessiekeuze)) return [];
    const blokken: Tijdsblok[] = [];
    for (const dag of evenement.dagen) {
      if (!dag.sessiekeuzeOpen) continue;
      for (const dd of dag.dagdelen) {
        if (!f.dagdelen.includes(dd.id)) continue;
        for (const tb of dd.tijdsblokken) {
          if (tb.type === 'keuze' && sessiesVoor(tb, f.doelgroepId).length > 0) blokken.push(tb);
        }
      }
    }
    return blokken;
  }, [evenement, doelgroep, f.dagdelen, f.doelgroepId]);

  const stappen = keuzeBlokken.length > 0 || stap < 2 ? ['Gegevens', 'Moment', 'Keuzes', 'Controleren'] : ['Gegevens', 'Moment', 'Controleren'];
  const stapNaam = stappen[stap];

  // Bij een nieuwe stap: focus op de titel (schermlezers) en bovenaan beginnen
  useEffect(() => {
    kopRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    log('info', antwoord ? 'stap: bevestiging' : `stap: ${stapNaam}`);
  }, [stap, antwoord]);

  // Verse bezetting ophalen bij het kiezen; keuzes die intussen volzet zijn wissen
  useEffect(() => {
    if (stapNaam !== 'Moment' && stapNaam !== 'Keuzes') return;
    laad().then((ev) => {
      if (!ev) return;
      const vol = new Map<string, string>();
      for (const dag of ev.dagen)
        for (const dd of dag.dagdelen)
          for (const tb of dd.tijdsblokken)
            for (const s of tb.sessies) if (s.volzet && !s.wachtlijst) vol.set(s.id, s.titel);
      setF((oud) => {
        const weg = Object.entries(oud.keuzes).filter(([, s]) => vol.has(s));
        if (!weg.length) return oud;
        setMelding(`Intussen volzet: ${weg.map(([, s]) => vol.get(s)).join(', ')}. Maak een nieuwe keuze.`);
        const keuzes = { ...oud.keuzes };
        for (const [tb] of weg) delete keuzes[tb];
        return { ...oud, keuzes };
      });
    });
  }, [stapNaam, laad]);

  if (laadFout) {
    return (
      <main className="pagina">
        <div className="melding melding--fout" role="alert">{laadFout}</div>
      </main>
    );
  }
  if (!evenement) {
    return (
      <main className="pagina" aria-busy="true">
        <p className="laden">Formulier wordt geladen…</p>
      </main>
    );
  }

  const valideer = (naam: string): Fouten => {
    const fo: Fouten = {};
    if (naam === 'Gegevens') {
      if (!EMAIL.test(f.email.trim())) fo.email = 'Vul een geldig e-mailadres in.';
      if (leerling && !f.contactVoornaam.trim()) fo.contactVoornaam = 'Vul je voornaam in.';
      if (f.telefoon.trim() && !TELEFOON.test(f.telefoon.trim())) fo.telefoon = 'Vul een geldig telefoonnummer in, bv. 0470 12 34 56.';
      if (!f.voornaam.trim()) fo.voornaam = 'Vul de voornaam in.';
      if (!f.naam.trim()) fo.naam = 'Vul de naam in.';
      if (!f.schoolTekst.trim()) fo.school = leerling ? 'Kies de huidige school.' : 'Vul je school of dienst in.';
      if (leerling && evenement.leerjaarOpties.length && !f.leerjaar) fo.leerjaar = 'Kies het huidige leerjaar.';
      if (evenement.doelgroepen.length && !f.doelgroepId) fo.doelgroep = 'Maak een keuze.';
    }
    if (naam === 'Moment' && f.dagdelen.length === 0) fo.dagdelen = 'Kies een moment.';
    if (naam === 'Keuzes') {
      for (const tb of keuzeBlokken) {
        const k = f.keuzes[tb.id];
        if (k === undefined || (tb.verplicht && k === '')) fo[tb.id] = `Maak een keuze voor ${tb.naam.toLowerCase()}.`;
      }
    }
    if (naam === 'Controleren' && !f.privacy) fo.privacy = 'Je moet de privacyverklaring aanvaarden om in te schrijven.';
    return fo;
  };

  const toonFouten = (fo: Fouten) => {
    setFouten(fo);
    setTimeout(() => foutRef.current?.focus(), 0);
  };

  const volgende = (e: FormEvent) => {
    e.preventDefault();
    setMelding(null);
    const fo = valideer(stapNaam);
    if (Object.keys(fo).length) return toonFouten(fo);
    setFouten({});
    if (stapNaam === 'Controleren') verzend();
    else setStap((s) => s + 1);
  };

  const gaNaar = (naam: string) => setStap(Math.max(stappen.indexOf(naam), 0));

  const verzend = async () => {
    const relevant = new Set(keuzeBlokken.map((t) => t.id));
    const sessies = Object.entries(f.keuzes).filter(([tb, s]) => relevant.has(tb) && s).map(([, s]) => s);
    setBezig(true);
    try {
      const res = await api.registreer(slug, {
        deelnemer: {
          naam: f.naam.trim(),
          voornaam: f.voornaam.trim(),
          email: f.email.trim(),
          contactVoornaam: leerling ? f.contactVoornaam.trim() : undefined,
          contactNaam: leerling ? f.contactNaam.trim() || undefined : undefined,
          telefoon: f.telefoon.trim() || undefined,
          schoolId: f.schoolId,
          schoolAndere: f.schoolId ? undefined : f.schoolTekst.trim(),
          leerjaar: leerling ? f.leerjaar || undefined : undefined,
          functie: leerling ? undefined : f.functie.trim() || undefined,
          opmerkingen: f.opmerkingen.trim() || undefined,
          doelgroepId: f.doelgroepId || undefined,
          privacyAkkoord: f.privacy,
        },
        dagdelen: f.dagdelen,
        sessies,
        turnstileToken,
        website: f.website,
      });
      setAntwoord(res);
    } catch (e) {
      const fout = e instanceof ApiFout ? e : new ApiFout('SERVERFOUT', 'Er ging iets mis. Probeer het later opnieuw.');
      setMelding(fout.message);
      if (fout.code === 'SESSIE_VOLZET' || fout.code === 'ONGELDIGE_SESSIEKEUZE' || fout.code === 'ZELFDE_ONDERDEEL_DUBBEL') {
        setVolzetGemeld(fout.id);
        if (fout.id) setF((oud) => ({ ...oud, keuzes: Object.fromEntries(Object.entries(oud.keuzes).filter(([, s]) => s !== fout.id)) }));
        gaNaar('Keuzes');
      } else if (fout.code === 'DAGDEEL_VOLZET' || fout.code === 'ONGELDIG_DAGDEEL') {
        setF((oud) => ({ ...oud, dagdelen: oud.dagdelen.filter((d) => d !== fout.id) }));
        gaNaar('Moment');
      } else if (fout.code === 'VALIDATIE' && fout.velden) {
        gaNaar('Gegevens');
        setFouten({ ...fout.velden, school: fout.velden.schoolId ?? fout.velden.schoolAndere ?? '' });
      }
    } finally {
      setBezig(false);
    }
  };

  const nieuweInschrijving = () => {
    // Zelfde ouder, ander kind: contactgegevens en moment behouden
    setF((oud) => ({ ...LEEG, email: oud.email, contactVoornaam: oud.contactVoornaam, contactNaam: oud.contactNaam, telefoon: oud.telefoon }));
    setAntwoord(null);
    setTurnstileToken(undefined);
    setStap(0);
    laad();
  };

  const kop = (
    <header className="kop">
      {evenement.logo && <img src={evenement.logo} alt="" className="kop__logo" style={{ height: evenement.logoHoogte ?? 135 }} />}
      {evenement.organisator && <p className="kop__organisator">{evenement.organisator}</p>}
      <h1>{evenement.titel}</h1>
      {isDemo && (
        <p className="demo-banner">
          Demomodus – er wordt niets verstuurd of bewaard buiten deze browser.
        </p>
      )}
    </header>
  );

  if (antwoord) {
    return (
      <main className="pagina">
        {kop}
        <section className="kaartblok bevestiging" aria-labelledby="bevestiging-kop">
          <div className="bevestiging__icoon" aria-hidden="true">✓</div>
          <h2 id="bevestiging-kop" ref={kopRef} tabIndex={-1}>Je inschrijving is gelukt!</h2>
          <p>
            We stuurden een bevestiging naar <strong className="pii">{f.email}</strong>. Je referentie is <strong>{antwoord.referentie}</strong>.
          </p>
          <Overzicht momenten={antwoord.momenten} keuzes={antwoord.keuzes} />
          {antwoord.keuzes.some((k) => k.status === 'wachtlijst') && (
            <p className="info">Je staat voor minstens één onderdeel op de wachtlijst. Komt er een plaats vrij, dan krijg je een mail.</p>
          )}
          <p className="info">
            Bekijken of annuleren kan later via de persoonlijke link in je mail
            {isDemo && <> (demo: <a href={antwoord.beheerUrl}>open de beheerlink</a>)</>}.
          </p>
          <div className="knoppen">
            <button type="button" className="knop knop--secundair" onClick={nieuweInschrijving}>
              Nog een kind inschrijven
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!evenement.inschrijvingOpen) {
    return (
      <main className="pagina">
        {kop}
        <div className="melding" role="status">
          De inschrijvingen zijn momenteel gesloten.
          {evenement.contactEmail && <> Vragen? Mail naar <a href={`mailto:${evenement.contactEmail}`}>{evenement.contactEmail}</a>.</>}
        </div>
      </main>
    );
  }

  const foutLijst = Object.entries(fouten).filter(([, v]) => v);
  const gekozenMomenten: Moment[] = [];
  const gekozenKeuzes: Keuze[] = [];
  for (const dag of evenement.dagen)
    for (const dd of dag.dagdelen) {
      if (!f.dagdelen.includes(dd.id)) continue;
      gekozenMomenten.push({ dag: dag.naam, dagdeel: dd.naam, startUur: dd.startUur, eindUur: dd.eindUur });
      for (const tb of dd.tijdsblokken) {
        if (!keuzeBlokken.includes(tb)) continue;
        const s = tb.sessies.find((x) => x.id === f.keuzes[tb.id]);
        gekozenKeuzes.push({
          titel: s?.titel ?? 'Geen keuze', tijdsblok: tb.naam, startUur: tb.startUur, locatie: s?.locatie ?? null,
          status: s?.volzet && s.wachtlijst ? 'wachtlijst' : 'bevestigd',
        });
      }
    }
  const schoolLabel = leerling ? 'Huidige school' : 'School of dienst';

  return (
    <main className="pagina">
      {kop}
      {stap === 0 && evenement.omschrijving && <p className="intro">{evenement.omschrijving}</p>}
      <Stappen stappen={stappen} huidig={stap} onGaNaar={setStap} />

      <form className="kaartblok" onSubmit={volgende} noValidate>
        <h2 ref={kopRef} tabIndex={-1} className="stap-titel">
          {stapNaam === 'Gegevens' && (leerling ? 'Over jou en je kind' : 'Je gegevens')}
          {stapNaam === 'Moment' && 'Kies je moment'}
          {stapNaam === 'Keuzes' && 'Stel je programma samen'}
          {stapNaam === 'Controleren' && 'Controleer en verstuur'}
        </h2>

        {foutLijst.length > 0 && (
          <div className="melding melding--fout" role="alert" tabIndex={-1} ref={foutRef}>
            <p><strong>Nog {foutLijst.length === 1 ? 'één punt' : `${foutLijst.length} punten`} in orde brengen:</strong></p>
            <ul>
              {foutLijst.map(([veld, tekst]) => (
                <li key={veld}><a href={`#veld-${veld}`}>{tekst}</a></li>
              ))}
            </ul>
          </div>
        )}
        {melding && foutLijst.length === 0 && <div className="melding melding--waarschuwing" role="alert">{melding}</div>}

        {stapNaam === 'Gegevens' && (
          <>
            {leerling ? (
              <>
                <h3 className="groepstitel">Ouder of voogd</h3>
                <Tekstveld id="veld-email" label="E-mailadres" type="email" autoComplete="email" verplicht
                  waarde={f.email} onWijzig={(v) => wijzig('email', v)} fout={fouten.email}
                  hulp="Hierop ontvang je de bevestiging en praktische info." />
                <div className="rij">
                  <Tekstveld id="veld-contactVoornaam" label="Voornaam" autoComplete="given-name" verplicht
                    waarde={f.contactVoornaam} onWijzig={(v) => wijzig('contactVoornaam', v)} fout={fouten.contactVoornaam} />
                  <Tekstveld id="veld-contactNaam" label="Naam" autoComplete="family-name"
                    waarde={f.contactNaam} onWijzig={(v) => wijzig('contactNaam', v)} />
                </div>
                <Tekstveld id="veld-telefoon" label="Telefoonnummer" type="tel" autoComplete="tel"
                  waarde={f.telefoon} onWijzig={(v) => wijzig('telefoon', v)} fout={fouten.telefoon}
                  hulp="Enkel om je te bereiken bij wijzigingen op de dag zelf." />

                <h3 className="groepstitel">Leerling</h3>
                <div className="rij">
                  <Tekstveld id="veld-voornaam" label="Voornaam leerling" verplicht autoComplete="off"
                    waarde={f.voornaam} onWijzig={(v) => wijzig('voornaam', v)} fout={fouten.voornaam} />
                  <Tekstveld id="veld-naam" label="Naam leerling" verplicht autoComplete="off"
                    waarde={f.naam} onWijzig={(v) => wijzig('naam', v)} fout={fouten.naam} />
                </div>
              </>
            ) : (
              <>
                <div className="rij">
                  <Tekstveld id="veld-voornaam" label="Voornaam" verplicht autoComplete="given-name"
                    waarde={f.voornaam} onWijzig={(v) => wijzig('voornaam', v)} fout={fouten.voornaam} />
                  <Tekstveld id="veld-naam" label="Naam" verplicht autoComplete="family-name"
                    waarde={f.naam} onWijzig={(v) => wijzig('naam', v)} fout={fouten.naam} />
                </div>
                <Tekstveld id="veld-email" label="E-mailadres" type="email" autoComplete="email" verplicht
                  waarde={f.email} onWijzig={(v) => wijzig('email', v)} fout={fouten.email} />
                <Tekstveld id="veld-telefoon" label="Telefoonnummer" type="tel" autoComplete="tel"
                  waarde={f.telefoon} onWijzig={(v) => wijzig('telefoon', v)} fout={fouten.telefoon} />
                <Tekstveld id="veld-functie" label="Functie" autoComplete="organization-title"
                  waarde={f.functie} onWijzig={(v) => wijzig('functie', v)} />
              </>
            )}
            <SchoolKiezer label={schoolLabel} tekst={f.schoolTekst} fout={fouten.school}
              onWijzig={(tekst, id) => { wijzig('schoolTekst', tekst); wijzig('schoolId', id); setFouten((o) => ({ ...o, school: '' })); }} />
            {leerling && evenement.leerjaarOpties.length > 0 && (
              <Keuzerondjes id="veld-leerjaar" legende="Huidig leerjaar" naam="leerjaar" verplicht
                opties={evenement.leerjaarOpties.map((o) => ({ waarde: o, label: o }))}
                waarde={f.leerjaar} onWijzig={(v) => wijzig('leerjaar', v)} fout={fouten.leerjaar} />
            )}
            {evenement.doelgroepen.length > 0 && (
              <Keuzerondjes id="veld-doelgroep" legende={leerling ? 'Ik wil info en proeflesjes voor' : 'Ik schrijf me in als'}
                naam="doelgroep" verplicht
                opties={evenement.doelgroepen.map((g) => ({ waarde: g.id, label: g.naam, beschrijving: g.beschrijving }))}
                waarde={f.doelgroepId} onWijzig={(v) => { wijzig('doelgroepId', v); wijzig('keuzes', {}); }} fout={fouten.doelgroep} />
            )}
            {/* Honeypot tegen spambots: onzichtbaar voor mensen en schermlezers */}
            <div className="honeypot" aria-hidden="true">
              <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => wijzig('website', e.target.value)} /></label>
            </div>
          </>
        )}

        {stapNaam === 'Moment' && (
          <MomentKiezer evenement={evenement} gekozen={f.dagdelen} fout={fouten.dagdelen}
            toonSessiekeuzeInfo={!doelgroep || doelgroep.sessiekeuze}
            onWijzig={(d) => { wijzig('dagdelen', d); setMelding(null); }} />
        )}

        {stapNaam === 'Keuzes' && (
          <>
            <p className="info">Een gekozen lesje kan je maar één keer volgen. Volzette onderdelen kan je niet meer kiezen.</p>
            {evenement.dagen.flatMap((dag) =>
              dag.dagdelen.filter((dd) => f.dagdelen.includes(dd.id)).map((dd) => (
                <SessieKiezer key={dd.id} dagNaam={dag.naam} dagdeel={dd} doelgroepId={f.doelgroepId}
                  sessiekeuze={dag.sessiekeuzeOpen && (!doelgroep || doelgroep.sessiekeuze)}
                  keuzes={f.keuzes} fouten={fouten} volzetGemeld={volzetGemeld}
                  onKies={(tb, s) => { wijzig('keuzes', { ...f.keuzes, [tb]: s }); setFouten((o) => ({ ...o, [tb]: '' })); setMelding(null); }} />
              )),
            )}
          </>
        )}

        {stapNaam === 'Controleren' && (
          <>
            <dl className="samenvatting">
              {leerling && <><dt>Ouder of voogd</dt><dd>{[f.contactVoornaam, f.contactNaam].filter(Boolean).join(' ')}</dd></>}
              <dt>E-mailadres</dt><dd>{f.email}</dd>
              {f.telefoon && <><dt>Telefoon</dt><dd>{f.telefoon}</dd></>}
              <dt>{leerling ? 'Leerling' : 'Naam'}</dt><dd>{f.voornaam} {f.naam}</dd>
              <dt>{schoolLabel}</dt><dd>{f.schoolTekst}</dd>
              {f.leerjaar && <><dt>Leerjaar</dt><dd>{f.leerjaar}</dd></>}
              {doelgroep && <><dt>Keuze</dt><dd>{doelgroep.naam}</dd></>}
            </dl>
            <button type="button" className="link-knop" onClick={() => gaNaar('Gegevens')}>Gegevens wijzigen</button>
            <h3 className="groepstitel">Je programma</h3>
            <Overzicht momenten={gekozenMomenten} keuzes={gekozenKeuzes} />
            <button type="button" className="link-knop" onClick={() => gaNaar('Moment')}>Moment of keuzes wijzigen</button>

            <Tekstveld id="veld-opmerkingen" label="Opmerkingen of vragen" meerregelig
              waarde={f.opmerkingen} onWijzig={(v) => wijzig('opmerkingen', v)}
              hulp="Bijvoorbeeld als je kind extra ondersteuning nodig heeft. Vermeld geen medische details." />

            <div className={`veld vinkje${fouten.privacy ? ' veld--fout' : ''}`} id="veld-privacy">
              <details className="privacy">
                <summary>Hoe gaan we om met je gegevens?</summary>
                <p>{evenement.privacyTekst ?? `Je gegevens worden enkel gebruikt voor de organisatie van ${evenement.titel} en ${evenement.bewaartermijnDagen} dagen na afloop verwijderd.`}</p>
              </details>
              <label>
                <input type="checkbox" checked={f.privacy} onChange={(e) => wijzig('privacy', e.target.checked)}
                  aria-invalid={fouten.privacy ? true : undefined} aria-describedby={fouten.privacy ? 'privacy-fout' : undefined} />
                <span>Ik heb gelezen hoe mijn gegevens verwerkt worden en ga hiermee akkoord. <span className="verplicht" aria-hidden="true">*</span></span>
              </label>
              {fouten.privacy && <p className="foutmelding" id="privacy-fout">{fouten.privacy}</p>}
            </div>
            <Turnstile onToken={setTurnstileToken} />
          </>
        )}

        <div className="knoppen">
          {stap > 0 && (
            <button type="button" className="knop knop--secundair" onClick={() => { setFouten({}); setMelding(null); setStap((s) => s - 1); }}>
              Vorige
            </button>
          )}
          <button type="submit" className="knop" disabled={bezig || (stapNaam === 'Controleren' && !!TURNSTILE_SITEKEY && !turnstileToken)}>
            {stapNaam === 'Controleren' ? (bezig ? 'Bezig met versturen…' : 'Inschrijving versturen') : 'Volgende'}
          </button>
        </div>
      </form>

      {evenement.contactEmail && (
        <footer className="voet">
          Hulp nodig bij het inschrijven? Mail naar <a href={`mailto:${evenement.contactEmail}`}>{evenement.contactEmail}</a>
          {' '}of vraag het aan het secretariaat – we schrijven je graag in.
        </footer>
      )}
    </main>
  );
}
