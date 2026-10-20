import { useEffect, useRef, useState } from 'react';
import { Overzicht } from '../components/Overzicht';
import { api } from '../services/api';
import { ApiFout, type RegistratieOverzicht } from '../types';

/** Zelfbeheer via de persoonlijke link uit de bevestigingsmail. */
export function BeheerPagina({ token }: { token: string }) {
  const [r, setR] = useState<RegistratieOverzicht | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bevestigen, setBevestigen] = useState(false);
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
        <Overzicht momenten={r.momenten} keuzes={r.keuzes} />

        {r.status === 'actief' && r.annuleerbaar && (
          <div className="annuleren">
            {!bevestigen ? (
              <button type="button" className="knop knop--gevaar" onClick={() => setBevestigen(true)}>Inschrijving annuleren</button>
            ) : (
              <div className="melding melding--waarschuwing" role="alertdialog" aria-labelledby="annuleer-vraag">
                <p id="annuleer-vraag"><strong>Zeker dat je wil annuleren?</strong> Je plaats in de gekozen onderdelen komt vrij voor iemand anders.</p>
                <div className="knoppen">
                  <button type="button" className="knop knop--secundair" onClick={() => setBevestigen(false)} disabled={bezig}>Nee, behouden</button>
                  <button type="button" className="knop knop--gevaar" onClick={annuleer} disabled={bezig}>
                    {bezig ? 'Bezig…' : 'Ja, annuleren'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {r.status === 'geannuleerd' && (
          <p className="info">
            Toch komen? <a href={`/${r.slug}`}>Schrijf je opnieuw in</a>.
          </p>
        )}
        {r.contactEmail && (
          <p className="info">
            Iets wijzigen, zoals een ander moment of lesje? Mail naar <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a> met je referentie.
          </p>
        )}
      </section>
    </main>
  );
}
