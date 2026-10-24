import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SchoolKiezer } from '../components/SchoolKiezer';
import { Turnstile, TURNSTILE_SITEKEY } from '../components/Turnstile';
import { Keuzerondjes, Tekstveld } from '../components/Velden';
import { api } from '../services/api';
import { zetHuisstijl } from '../services/huisstijl';
import { log } from '../services/logboek';
import { ApiFout, type VoorinschrijfFormulier } from '../types';

/**
 * Publiek voorinschrijvingsformulier (/voorinschrijven/<slug>), in plaats van Microsoft Forms. Zelfde kop en
 * huisstijl als het inschrijfformulier (van het evenement dat in het beheer gekozen is). Na het versturen kan de
 * ouder meteen een broer of zus toevoegen; de ouderlijke gegevens blijven dan ingevuld.
 */

interface Gegevens {
  ouderVoornaam: string;
  ouderNaam: string;
  email: string;
  telefoon: string;
  kindVoornaam: string;
  kindNaam: string;
  schoolTekst: string;
  schoolId?: string;
  klas: string;
  opmerkingen: string;
  privacy: boolean;
  website: string;
}

const LEEG: Gegevens = {
  ouderVoornaam: '', ouderNaam: '', email: '', telefoon: '', kindVoornaam: '', kindNaam: '',
  schoolTekst: '', klas: '', opmerkingen: '', privacy: false, website: '',
};
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEFOON = /^[+0-9 ()./-]{8,20}$/;

export function VoorinschrijfPagina({ slug }: { slug: string }) {
  const [formulier, setFormulier] = useState<VoorinschrijfFormulier | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [g, setG] = useState<Gegevens>(LEEG);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [klaar, setKlaar] = useState<{ kind: string; bijgewerkt: boolean } | null>(null);
  const kopRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api.haalVoorinschrijfFormulier(slug)
      .then((f) => {
        setFormulier(f);
        zetHuisstijl(f.kleurPrimair, f.kleurAccent);
        document.title = f.titel;
      })
      .catch((e) => setLaadFout(e instanceof ApiFout ? e.message : 'Het formulier kon niet geladen worden.'));
  }, [slug]);

  const wijzig = <K extends keyof Gegevens>(k: K, v: Gegevens[K]) => {
    setG((oud) => ({ ...oud, [k]: v }));
    setFouten((oud) => (oud[k] ? Object.fromEntries(Object.entries(oud).filter(([x]) => x !== k)) : oud));
  };

  if (laadFout) return <main className="pagina"><div className="melding melding--fout" role="alert">{laadFout}</div></main>;
  if (!formulier) return <main className="pagina" aria-busy="true"><p className="laden">Formulier wordt geladen…</p></main>;

  const kop = (
    <header className="kop">
      {formulier.logo && <img src={formulier.logo} alt="" className="kop__logo" style={{ height: formulier.logoHoogte ?? 135 }} />}
      {formulier.organisator && <p className="kop__organisator">{formulier.organisator}</p>}
      <h1 ref={kopRef} tabIndex={-1}>{formulier.titel}</h1>
    </header>
  );

  if (!formulier.open) {
    return (
      <main className="pagina">
        {kop}
        <div className="melding" role="status">
          Dit formulier is gesloten.
          {formulier.contactEmail && <> Vragen? Mail naar <a href={`mailto:${formulier.contactEmail}`}>{formulier.contactEmail}</a>.</>}
        </div>
      </main>
    );
  }

  if (klaar) {
    return (
      <main className="pagina">
        {kop}
        <section className="kaartblok">
          <h2>Bedankt!</h2>
          <div className="melding melding--succes" role="status">
            {klaar.bijgewerkt
              ? <>De voorinschrijving van <strong className="pii">{klaar.kind}</strong> is bijgewerkt.</>
              : <>De voorinschrijving van <strong className="pii">{klaar.kind}</strong> is goed ontvangen.</>}
          </div>
          <p>Je krijgt een bevestiging op <strong className="pii">{g.email}</strong>. Zodra de inschrijvingen openen, ontvang je een mail met een persoonlijke link; het formulier is dan al ingevuld.</p>
          <div className="knoppen">
            <button type="button" className="knop knop--secundair" onClick={() => {
              // Zelfde ouder, ander kind: de gegevens van de ouder blijven staan.
              setG((oud) => ({ ...LEEG, ouderVoornaam: oud.ouderVoornaam, ouderNaam: oud.ouderNaam, email: oud.email, telefoon: oud.telefoon }));
              setKlaar(null);
              setTurnstileToken(undefined);
              requestAnimationFrame(() => kopRef.current?.focus());
            }}>
              Nog een kind voorinschrijven
            </button>
          </div>
        </section>
      </main>
    );
  }

  function valideer(): Record<string, string> {
    const fo: Record<string, string> = {};
    if (!g.ouderVoornaam.trim()) fo.ouderVoornaam = 'Vul je voornaam in.';
    if (!EMAIL.test(g.email.trim())) fo.email = 'Vul een geldig e-mailadres in.';
    if (g.telefoon.trim() && !TELEFOON.test(g.telefoon.trim())) fo.telefoon = 'Vul een geldig telefoonnummer in, bv. 0470 12 34 56.';
    if (!g.kindVoornaam.trim()) fo.kindVoornaam = 'Vul de voornaam van je kind in.';
    if (!g.kindNaam.trim()) fo.kindNaam = 'Vul de naam van je kind in.';
    if (!g.schoolTekst.trim()) fo.school = 'Kies de huidige school.';
    if (formulier!.leerjaarOpties.length && !g.klas) fo.klas = 'Kies de huidige klas.';
    if (!g.privacy) fo.privacyAkkoord = 'Je moet de privacyverklaring aanvaarden.';
    return fo;
  }

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    const fo = valideer();
    setFouten(fo);
    if (Object.keys(fo).length) {
      setMelding('Controleer de gemarkeerde velden.');
      return;
    }
    setBezig(true);
    setMelding(null);
    try {
      const r = await api.voorinschrijven(slug, {
        ouderVoornaam: g.ouderVoornaam.trim(), ouderNaam: g.ouderNaam.trim() || undefined, email: g.email.trim(), telefoon: g.telefoon.trim() || undefined,
        kindVoornaam: g.kindVoornaam.trim(), kindNaam: g.kindNaam.trim(), schoolId: g.schoolId, schoolAndere: g.schoolId ? undefined : g.schoolTekst.trim(),
        klas: g.klas || undefined, opmerkingen: g.opmerkingen.trim() || undefined, privacyAkkoord: g.privacy, turnstileToken, website: g.website,
      });
      log('info', 'voorinschrijving verstuurd');
      setKlaar({ kind: `${g.kindVoornaam.trim()} ${g.kindNaam.trim()}`, bijgewerkt: r.bijgewerkt });
      requestAnimationFrame(() => kopRef.current?.focus());
    } catch (fout) {
      if (fout instanceof ApiFout && fout.velden) setFouten(fout.velden);
      setMelding(fout instanceof Error ? fout.message : 'Versturen mislukt. Probeer het opnieuw.');
    } finally {
      setBezig(false);
    }
  }

  return (
    <main className="pagina">
      {kop}
      {formulier.intro && <p className="intro">{formulier.intro}</p>}
      {formulier.schooljaar && <p className="info"><strong>{formulier.schooljaar}</strong></p>}
      <form className="kaartblok" onSubmit={verstuur} noValidate>
        {melding && <div className="melding melding--fout" role="alert">{melding}</div>}

        <h3 className="groepstitel">Ouder of voogd</h3>
        <div className="rij">
          <Tekstveld id="vi-ouder-voornaam" label="Voornaam" verplicht autoComplete="given-name" waarde={g.ouderVoornaam} onWijzig={(v) => wijzig('ouderVoornaam', v)} fout={fouten.ouderVoornaam} />
          <Tekstveld id="vi-ouder-naam" label="Naam" autoComplete="family-name" waarde={g.ouderNaam} onWijzig={(v) => wijzig('ouderNaam', v)} />
        </div>
        <Tekstveld id="vi-email" label="E-mailadres" type="email" verplicht autoComplete="email" waarde={g.email} onWijzig={(v) => wijzig('email', v)} fout={fouten.email}
          hulp="Hierop ontvang je de bevestiging en later de uitnodiging om in te schrijven." />
        <Tekstveld id="vi-telefoon" label="Telefoonnummer" type="tel" autoComplete="tel" waarde={g.telefoon} onWijzig={(v) => wijzig('telefoon', v)} fout={fouten.telefoon} />

        <h3 className="groepstitel">Kind</h3>
        <div className="rij">
          <Tekstveld id="vi-kind-voornaam" label="Voornaam" verplicht waarde={g.kindVoornaam} onWijzig={(v) => wijzig('kindVoornaam', v)} fout={fouten.kindVoornaam} invoerProps={{ className: 'pii' }} />
          <Tekstveld id="vi-kind-naam" label="Naam" verplicht waarde={g.kindNaam} onWijzig={(v) => wijzig('kindNaam', v)} fout={fouten.kindNaam} invoerProps={{ className: 'pii' }} />
        </div>
        <SchoolKiezer tekst={g.schoolTekst} fout={fouten.school}
          onWijzig={(tekst, schoolId) => { setG((oud) => ({ ...oud, schoolTekst: tekst, schoolId })); setFouten((o) => ({ ...o, school: '' })); }} />
        {formulier.leerjaarOpties.length > 0 && (
          <Keuzerondjes legende="Huidige klas" naam="vi-klas" verplicht waarde={g.klas} onWijzig={(v) => wijzig('klas', v)} fout={fouten.klas}
            opties={formulier.leerjaarOpties.map((o) => ({ waarde: o, label: o }))} />
        )}
        <Tekstveld id="vi-opmerkingen" label="Vragen of opmerkingen" meerregelig waarde={g.opmerkingen} onWijzig={(v) => wijzig('opmerkingen', v)}
          hulp="Vermeld geen medische details." />

        <div className={`veld vinkje${fouten.privacyAkkoord ? ' veld--fout' : ''}`}>
          <details className="privacy">
            <summary>Hoe gaan we om met je gegevens?</summary>
            <p>{formulier.privacyTekst ?? 'We gebruiken je gegevens enkel om je op de hoogte te houden van de inschrijvingen: je krijgt een bevestiging, een uitnodiging om in te schrijven zodra de inschrijvingen openen, en eventueel een herinnering. We delen je gegevens met niemand.'}</p>
          </details>
          <label>
            <input type="checkbox" checked={g.privacy} onChange={(e) => wijzig('privacy', e.target.checked)} aria-invalid={fouten.privacyAkkoord ? true : undefined} />
            <span>Ik heb gelezen hoe mijn gegevens verwerkt worden en ga hiermee akkoord. <span className="verplicht" aria-hidden="true">*</span></span>
          </label>
          {fouten.privacyAkkoord && <p className="foutmelding">{fouten.privacyAkkoord}</p>}
        </div>

        {/* Honeypot: onzichtbaar voor mensen */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sr-only" value={g.website} onChange={(e) => wijzig('website', e.target.value)} />
        <Turnstile onToken={setTurnstileToken} />

        <div className="knoppen">
          <button type="submit" className="knop" disabled={bezig || (!!TURNSTILE_SITEKEY && !turnstileToken)}>
            {bezig ? 'Bezig met versturen…' : 'Voorinschrijving versturen'}
          </button>
        </div>
      </form>
      {formulier.contactEmail && (
        <p className="voet">Vragen? Mail naar <a href={`mailto:${formulier.contactEmail}`}>{formulier.contactEmail}</a>.</p>
      )}
    </main>
  );
}
