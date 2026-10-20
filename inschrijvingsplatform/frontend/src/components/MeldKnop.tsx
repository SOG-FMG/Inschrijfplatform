import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../services/api';
import { anonimiseer, log, logboek } from '../services/logboek';
import { ApiFout, type Melding } from '../types';
import { Turnstile, TURNSTILE_SITEKEY } from './Turnstile';
import { Keuzerondjes, Tekstveld } from './Velden';

const MAX_SCREENSHOT = 3_500_000; // tekens data-URL (~2,6 MB), de Worker aanvaardt max. 3 MB

/**
 * Schermafbeelding van de pagina, gemaakt vóór het venster opent. Tijdens het maken
 * staat .screenshot-bezig op <html>: ingevulde velden en gegevens met .pii worden
 * dan onherkenbaar (zie styles.css). Mislukt het, dan gaat de melding zonder.
 */
async function maakScreenshot(): Promise<string | undefined> {
  const html = document.documentElement;
  html.classList.add('screenshot-bezig');
  try {
    const { toPng } = await import('html-to-image');
    const opties = {
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      // iframes (Turnstile) kunnen niet mee; de meldknop zelf hoort er niet op
      filter: (n: Node) => !(n instanceof HTMLIFrameElement) && !(n instanceof HTMLElement && n.classList.contains('meldknop')),
    };
    let png = await toPng(document.body, { ...opties, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) });
    if (png.length > MAX_SCREENSHOT) png = await toPng(document.body, { ...opties, pixelRatio: 0.6 });
    return png.length > MAX_SCREENSHOT ? undefined : png;
  } catch (e) {
    log('waarschuwing', `schermafbeelding mislukt: ${String(e)}`);
    return undefined;
  } finally {
    html.classList.remove('screenshot-bezig');
  }
}

function technischeGegevens(): Omit<Melding, 'type' | 'omschrijving' | 'email' | 'screenshot'> {
  return {
    pagina: anonimiseer(location.href),
    appVersie: __APP_VERSIE__,
    browser: navigator.userAgent,
    context: {
      scherm: `${screen.width}x${screen.height}`,
      venster: `${window.innerWidth}x${window.innerHeight}`,
      pixelratio: window.devicePixelRatio,
      taal: navigator.language,
      tijdzone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tijdstip: new Date().toISOString(),
      online: navigator.onLine,
      aanraakscherm: navigator.maxTouchPoints > 0,
      demo: isDemo,
    },
    logboek: logboek(),
  };
}

/** Vaste knop "Probleem of idee?" op elke pagina, met een meldvenster. */
export function MeldKnop() {
  const [open, setOpen] = useState(false);
  const [voorbereiden, setVoorbereiden] = useState(false);
  const [screenshot, setScreenshot] = useState<string>();
  const knop = useRef<HTMLButtonElement>(null);

  async function openen() {
    setVoorbereiden(true);
    log('info', 'meldvenster geopend');
    setScreenshot(await maakScreenshot());
    setVoorbereiden(false);
    setOpen(true);
  }

  function sluiten() {
    setOpen(false);
    setScreenshot(undefined);
    knop.current?.focus();
  }

  return (
    <>
      <button ref={knop} type="button" className="meldknop" onClick={openen} disabled={voorbereiden} aria-haspopup="dialog">
        {voorbereiden ? 'Even geduld…' : 'Probleem of idee?'}
      </button>
      {open && <MeldVenster screenshot={screenshot} onSluit={sluiten} />}
    </>
  );
}

function MeldVenster({ screenshot, onSluit }: { screenshot?: string; onSluit: () => void }) {
  const [type, setType] = useState<'' | Melding['type']>('');
  const [omschrijving, setOmschrijving] = useState('');
  const [email, setEmail] = useState('');
  const [metScreenshot, setMetScreenshot] = useState(true);
  const [website, setWebsite] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [referentie, setReferentie] = useState<string>();
  const venster = useRef<HTMLDivElement>(null);
  const [techniek] = useState(technischeGegevens);

  useEffect(() => {
    venster.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onSluit();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onSluit]);

  async function verstuur(e: React.FormEvent) {
    e.preventDefault();
    const fo: Record<string, string> = {};
    if (!type) fo.type = 'Kies wat je wil melden.';
    if (omschrijving.trim().length < 3) fo.omschrijving = 'Beschrijf kort wat er gebeurde of wat je wil.';
    setFouten(fo);
    if (Object.keys(fo).length) return;
    setBezig(true);
    setMelding(null);
    try {
      const r = await api.meld({
        ...techniek,
        logboek: logboek(),
        type: type as Melding['type'],
        omschrijving: omschrijving.trim(),
        email: email.trim() || undefined,
        screenshot: metScreenshot ? screenshot : undefined,
        turnstileToken,
        website,
      });
      setReferentie(r.referentie);
    } catch (fout) {
      if (fout instanceof ApiFout && fout.velden) setFouten(fout.velden);
      setMelding(fout instanceof Error ? fout.message : 'Versturen mislukt.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="meldvenster__achtergrond" onClick={(e) => e.target === e.currentTarget && onSluit()}>
      <div ref={venster} className="meldvenster kaartblok" role="dialog" aria-modal="true" aria-labelledby="meldvenster-titel">
        <h2 id="meldvenster-titel">Probleem of idee melden</h2>
        {referentie ? (
          <>
            <p role="status">Bedankt! Je melding is goed ontvangen{referentie !== 'DEMO' && <> (referentie <strong>{referentie}</strong>)</>}.</p>
            <div className="knoppen">
              <button type="button" className="knop" onClick={onSluit}>Sluiten</button>
            </div>
          </>
        ) : (
          <form onSubmit={verstuur} noValidate>
            {melding && <div className="melding melding--fout" role="alert"><p>{melding}</p></div>}
            <Keuzerondjes legende="Wat wil je melden?" naam="meldtype" verplicht waarde={type} fout={fouten.type}
              onWijzig={(v) => setType(v as Melding['type'])}
              opties={[
                { waarde: 'probleem', label: 'Er loopt iets mis' },
                { waarde: 'wens', label: 'Ik heb een wens of idee' },
              ]} />
            <Tekstveld id="meld-omschrijving" label={type === 'wens' ? 'Wat zou je graag willen?' : 'Wat gebeurde er?'} meerregelig verplicht
              waarde={omschrijving} onWijzig={setOmschrijving} fout={fouten.omschrijving}
              hulp="Wat deed je, wat verwachtte je en wat gebeurde er? Vermeld geen gegevens van je kind." />
            <Tekstveld id="meld-email" label="Je e-mailadres" type="email" autoComplete="email" waarde={email} onWijzig={setEmail}
              fout={fouten.email} hulp="Enkel als we je mogen contacteren over deze melding." />

            {screenshot && (
              <div className="veld vinkje">
                <label>
                  <input type="checkbox" checked={metScreenshot} onChange={(e) => setMetScreenshot(e.target.checked)} />
                  <span>Schermafbeelding meesturen <span className="optioneel">(ingevulde gegevens zijn onherkenbaar gemaakt)</span></span>
                </label>
                {metScreenshot && <img className="meldvenster__screenshot" src={screenshot} alt="Voorbeeld van de schermafbeelding die meegestuurd wordt" />}
              </div>
            )}

            <details className="privacy">
              <summary>Welke technische gegevens sturen we mee?</summary>
              <p className="hulp">Om het probleem te kunnen onderzoeken: de pagina, de versie van het formulier, je browser en scherm, en
                de laatste stappen van het formulier (zonder wat je invulde). Meldingen worden na 90 dagen verwijderd.</p>
              <pre className="meldvenster__techniek">{JSON.stringify({ ...techniek, logboek: `${techniek.logboek.length} regels` }, null, 1)}</pre>
            </details>

            {/* Honeypot: onzichtbaar voor mensen */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only"
              value={website} onChange={(e) => setWebsite(e.target.value)} />
            <Turnstile onToken={setTurnstileToken} />

            <div className="knoppen">
              <button type="button" className="knop knop--secundair" onClick={onSluit}>Annuleren</button>
              <button type="submit" className="knop" disabled={bezig || (!!TURNSTILE_SITEKEY && !turnstileToken)}>
                {bezig ? 'Bezig met versturen…' : 'Melding versturen'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
