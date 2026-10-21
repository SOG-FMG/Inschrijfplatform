import { useEffect, useRef, useState } from 'react';
import { Overzicht } from '../components/Overzicht';
import { SessieKiezer } from '../components/SessieKiezer';
import { api } from '../services/api';
import { ApiFout, type KeuzeWijziging, type RegistratieOverzicht } from '../types';

/** Zelfbeheer via de persoonlijke link uit de bevestigingsmail: bekijken, lesjes wijzigen of annuleren. */
export function BeheerPagina({ token }: { token: string }) {
  const [r, setR] = useState<RegistratieOverzicht | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bevestigen, setBevestigen] = useState(false);
  const [wijzigen, setWijzigen] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const kopRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = 'Je inschrijving';
    api.haalRegistratie(token).then(setR).catch((e) => setFout(e instanceof ApiFout ? e.message : 'Er ging iets mis.'));
  }, [token]);

  const annuleer = async () => {
    setBezig(true);
    try {
      setR(await api.annuleer(token));
      setBevestigen(false);
      setMelding(null);
      kopRef.current?.focus();
    } catch (e) {
      setFout(e instanceof ApiFout ? e.message : 'Annuleren is mislukt.');
    } finally {
      setBezig(false);
    }
  };

  if (fout) {
    return (
      <main className="pagina">
        <div className="melding melding--fout" role="alert">{fout}</div>
      </main>
    );
  }
  if (!r) {
    return (
      <main className="pagina" aria-busy="true">
        <p className="laden">Inschrijving wordt geladen…</p>
      </main>
    );
  }

  return (
    <main className="pagina">
      <header className="kop">
        <h1>{r.evenement}</h1>
      </header>
      <section className="kaartblok">
        <h2 ref={kopRef} tabIndex={-1}>
          {r.status === 'geannuleerd' ? 'Deze inschrijving is geannuleerd' : <>Inschrijving van <span className="pii">{r.voornaam ?? ''} {r.naam ?? ''}</span></>}
        </h2>
        <p>Referentie: <strong>{r.referentie}</strong></p>
        {melding && <div className="melding melding--succes" role="status">{melding}</div>}

        {wijzigen && r.wijzigen ? (
          <KeuzesWijzigen
            token={token}
            w={r.wijzigen}
            onKlaar={(nieuw, tekst) => {
              setR(nieuw);
              setWijzigen(false);
              setMelding(tekst);
              kopRef.current?.focus();
            }}
            onVernieuw={setR}
            onAnnuleer={() => setWijzigen(false)}
          />
        ) : (
          <>
            <Overzicht momenten={r.momenten} keuzes={r.keuzes} />
            {r.status === 'actief' && (r.wijzigen || r.annuleerbaar) && !bevestigen && (
              <div className="knoppen knoppen--links">
                {r.wijzigen && (
                  <button type="button" className="knop" onClick={() => { setWijzigen(true); setMelding(null); }}>
                    Ander lesje kiezen
                  </button>
                )}
                {r.annuleerbaar && (
                  <button type="button" className="knop knop--gevaar" onClick={() => setBevestigen(true)}>Inschrijving annuleren</button>
                )}
              </div>
            )}
          </>
        )}

        {r.status === 'actief' && r.annuleerbaar && bevestigen && (
          <div className="annuleren">
            <div className="melding melding--waarschuwing" role="alertdialog" aria-labelledby="annuleer-vraag">
              <p id="annuleer-vraag"><strong>Zeker dat je wil annuleren?</strong> Je plaats in de gekozen onderdelen komt vrij voor iemand anders.</p>
              <div className="knoppen">
                <button type="button" className="knop knop--secundair" onClick={() => setBevestigen(false)} disabled={bezig}>Nee, behouden</button>
                <button type="button" className="knop knop--gevaar" onClick={annuleer} disabled={bezig}>
                  {bezig ? 'Bezig…' : 'Ja, annuleren'}
                </button>
              </div>
            </div>
          </div>
        )}
        {r.status === 'geannuleerd' && (
          <p className="info">
            Toch komen? <a href={`/${r.slug}`}>Schrijf je opnieuw in</a>.
          </p>
        )}
        {r.contactEmail && (
          <p className="info">
            {r.status === 'actief' ? 'Een ander moment nodig of nog vragen?' : 'Vragen?'} Mail naar <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a> met je referentie.
          </p>
        )}
      </section>
    </main>
  );
}

/** Zelfde keuzescherm als op het formulier, met de huidige keuzes al aangeduid. */
function KeuzesWijzigen({ token, w, onKlaar, onVernieuw, onAnnuleer }: {
  token: string;
  w: KeuzeWijziging;
  onKlaar: (r: RegistratieOverzicht, melding: string) => void;
  onVernieuw: (r: RegistratieOverzicht) => void;
  onAnnuleer: () => void;
}) {
  const [keuzes, setKeuzes] = useState<Record<string, string>>(w.keuzes);
  const [fout, setFout] = useState<string | null>(null);
  const [volzet, setVolzet] = useState<string | undefined>();
  const [bezig, setBezig] = useState(false);
  const gewijzigd = Object.keys(keuzes).some((k) => keuzes[k] !== w.keuzes[k]);

  const bewaar = async () => {
    setBezig(true);
    setFout(null);
    try {
      const nieuw = await api.wijzigKeuzes(token, Object.values(keuzes).filter(Boolean));
      onKlaar(nieuw, 'Je keuze is gewijzigd. Je krijgt een mail met het nieuwe overzicht.');
    } catch (e) {
      setFout(e instanceof ApiFout ? e.message : 'Wijzigen is mislukt.');
      if (e instanceof ApiFout && e.code === 'SESSIE_VOLZET') {
        setVolzet(e.id);
        // Vrije plaatsen opnieuw ophalen, zodat het volzette lesje meteen uitgeschakeld is
        api.haalRegistratie(token).then(onVernieuw).catch(() => undefined);
      }
    } finally {
      setBezig(false);
    }
  };

  return (
    <form
      className="wijzigen"
      onSubmit={(e) => {
        e.preventDefault();
        bewaar();
      }}
    >
      <p>Kies een ander lesje en klik op <strong>Wijziging bewaren</strong>. Je huidige plaats blijft behouden tot je bewaart.</p>
      {w.dagen.map(({ dagNaam, dagdeel }) => (
        <SessieKiezer
          key={dagdeel.id}
          dagNaam={dagNaam}
          dagdeel={dagdeel}
          doelgroepId={w.doelgroepId}
          sessiekeuze
          keuzes={keuzes}
          onKies={(tb, s) => setKeuzes((oud) => ({ ...oud, [tb]: s }))}
          fouten={{}}
          volzetGemeld={volzet}
        />
      ))}
      {fout && <div className="melding melding--fout" role="alert">{fout}</div>}
      <div className="knoppen">
        <button type="button" className="knop knop--secundair" onClick={onAnnuleer} disabled={bezig}>Annuleren</button>
        <button type="submit" className="knop" disabled={bezig || !gewijzigd}>{bezig ? 'Bezig…' : 'Wijziging bewaren'}</button>
      </div>
    </form>
  );
}
