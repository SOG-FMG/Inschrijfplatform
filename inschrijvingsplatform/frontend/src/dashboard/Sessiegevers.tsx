import { useCallback, useEffect, useState } from 'react';
import { aanwezigheidApi, type SessiegeverBeheer } from '../services/aanwezigheidApi';
import type { Profiel } from '../services/beheerApi';
import { ApiFout } from '../types';
import { datumTijd, foutTekst, Invoer, Link, Melding, Venster } from './ui';

/**
 * Sessiegevers van een evenement (/dashboard/evenementen/<id>/sessiegevers). Intern heten ze sessiegevers; op het scherm
 * staat de term van de installatie (lesgever, spreker, artiest). Apart van de medewerkers: ze melden zich aan met een
 * code per mail en zien enkel hun eigen sessies (vooraf de inschrijvingen, op de dag zelf de live tabel).
 */

const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
type Bewerk = { id?: string; voornaam: string; naam: string; email: string };

export function Sessiegevers({ evenementId, profiel }: { evenementId: string; profiel: Profiel }) {
  const [data, setData] = useState<SessiegeverBeheer | null>(null);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bewerk, setBewerk] = useState<Bewerk | null>(null);
  const magBeheren = profiel.rechten.includes('evenementen.sessiegevers.beheren');

  const laad = useCallback(() => {
    aanwezigheidApi.sessiegevers(evenementId).then(setData).catch((e) => setFout(foutTekst(e)));
  }, [evenementId]);
  useEffect(laad, [laad]);

  const doe = async (f: () => Promise<string | void>) => {
    setFout('');
    setMelding('');
    try {
      const m = await f();
      if (m) setMelding(m);
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    }
  };

  if (!data) return fout ? <Melding soort="fout">{fout}</Melding> : <p>Even geduld…</p>;
  const { termen } = data;
  const T = hoofdletter(termen.sessiegever);
  const naam = new Map(data.sessiegevers.map((x) => [x.id, `${x.voornaam} ${x.naam}`.trim()]));
  const teOvernemen = data.sessies.filter((s) => s.lesgeverEmail && !s.sessiegevers.length).length;
  const gekoppeld = data.sessiegevers.filter((x) => x.sessies.length);

  return (
    <>
      <p className="d-kruimel"><Link href="/dashboard">Evenementen</Link> › {data.evenement}</p>
      <header className="d-paginakop">
        <div>
          <h1>{hoofdletter(termen.sessiegevers)}</h1>
          <p className="d-sub">
            Wie een sessie geeft. Een {termen.sessiegever} is geen medewerker: aanmelden gaat met het e-mailadres en een code per mail,
            en je ziet enkel je eigen sessies.
          </p>
        </div>
        {magBeheren && <button type="button" className="d-knop" onClick={() => setBewerk({ voornaam: '', naam: '', email: '' })}>+ Nieuwe {termen.sessiegever}</button>}
      </header>

      {fout && <Melding soort="fout">{fout}</Melding>}
      {melding && <Melding soort="ok">{melding}</Melding>}

      <div className="d-werkbalk">
        {magBeheren && teOvernemen > 0 && (
          <button type="button" className="d-knop d-knop--secundair" onClick={() => doe(async () => {
            const r = await aanwezigheidApi.neemOver(evenementId);
            return `${r.nieuw} nieuwe ${termen.sessiegevers}, ${r.gekoppeld} koppeling(en)${r.overgeslagen ? `; ${r.overgeslagen} adres(sen) buiten de toegelaten domeinen overgeslagen` : ''}.`;
          })}>
            Overnemen uit de lesjes ({teOvernemen})
          </button>
        )}
        {gekoppeld.length > 0 && (
          <button type="button" className="d-knop d-knop--secundair" onClick={() => {
            if (!confirm(`Een uitnodiging mailen aan ${gekoppeld.length} ${gekoppeld.length === 1 ? termen.sessiegever : termen.sessiegevers}?`)) return;
            doe(async () => {
              const r = await aanwezigheidApi.nodigUit(evenementId);
              return `${r.verstuurd} uitnodiging(en) verstuurd${r.mislukt ? `, ${r.mislukt} mislukt` : ''}.`;
            });
          }}>
            Allen uitnodigen
          </button>
        )}
      </div>

      <h2>Sessies</h2>
      <div className="d-tabelvak">
        <table className="d-tabel">
          <thead>
            <tr><th>Wanneer</th><th>Sessie</th><th>{hoofdletter(termen.sessiegevers)}</th></tr>
          </thead>
          <tbody>
            {data.sessies.map((s) => (
              <tr key={s.id}>
                <td>{s.dag}<div className="d-klein">{s.tijdsblok} · {s.startUur}</div></td>
                <td>{s.titel}{s.lesgeverTekst && !s.sessiegevers.length && <div className="d-klein">Bij het lesje ingevuld: {s.lesgeverTekst}{s.lesgeverEmail && ` (${s.lesgeverEmail})`}</div>}</td>
                <td>
                  {s.sessiegevers.map((id) => (
                    <span key={id} className="sg-chip">
                      {naam.get(id)}
                      <button type="button" aria-label={`${naam.get(id)} loskoppelen`} onClick={() => doe(() => aanwezigheidApi.koppel(s.id, s.sessiegevers.filter((x) => x !== id)).then(() => undefined))}>×</button>
                    </span>
                  ))}
                  <select className="sg-kies" value="" aria-label={`${T} toevoegen aan ${s.titel}`}
                    onChange={(e) => e.target.value && doe(() => aanwezigheidApi.koppel(s.id, [...s.sessiegevers, e.target.value]).then(() => undefined))}>
                    <option value="">+ {termen.sessiegever}</option>
                    {data.sessiegevers.filter((x) => !s.sessiegevers.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.voornaam} {x.naam}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.sessies.length === 0 && <p className="d-klein" style={{ padding: '8px 10px' }}>Dit evenement heeft nog geen sessies.</p>}
      </div>

      <h2 style={{ marginTop: '1em' }}>Alle {termen.sessiegevers}</h2>
      <div className="d-tabelvak">
        <table className="d-tabel">
          <thead>
            <tr><th>Naam</th><th>E-mailadres</th><th className="getal">Sessies hier</th><th>Uitgenodigd</th><th>Acties</th></tr>
          </thead>
          <tbody>
            {data.sessiegevers.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.voornaam} {x.naam}</strong></td>
                <td>{x.email}</td>
                <td className="getal">{x.sessies.length || '—'}</td>
                <td>{x.uitgenodigdOp ? datumTijd(x.uitgenodigdOp) : <span className="d-klein">nog niet</span>}</td>
                <td className="d-acties">
                  {x.sessies.length > 0 && (
                    <button type="button" className="d-link" onClick={() => doe(async () => {
                      const r = await aanwezigheidApi.nodigUit(evenementId, [x.id]);
                      return r.verstuurd ? `Uitnodiging verstuurd naar ${x.email}.` : 'De uitnodiging kon niet verstuurd worden.';
                    })}>Uitnodigen</button>
                  )}
                  {magBeheren && <button type="button" className="d-link" onClick={() => setBewerk({ id: x.id, voornaam: x.voornaam, naam: x.naam, email: x.email })}>Wijzigen</button>}
                  {magBeheren && (
                    <button type="button" className="d-link d-link--gevaar" onClick={() => {
                      if (confirm(`${x.voornaam} ${x.naam} verwijderen? De koppelingen met alle sessies (ook van andere evenementen) en de aanmelding vervallen meteen.`)) {
                        doe(() => aanwezigheidApi.verwijderSessiegever(x.id).then(() => undefined));
                      }
                    }}>Verwijderen</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.sessiegevers.length === 0 && <p className="d-klein" style={{ padding: '8px 10px' }}>Nog geen {termen.sessiegevers}.</p>}
      </div>

      <div className="d-raster" style={{ marginTop: 14 }}>
        <Velden data={data} evenementId={evenementId} onKlaar={laad} />
        <section className="d-kaart">
          <h2>Zo meldt een {termen.sessiegever} zich aan</h2>
          <ol className="d-lijst">
            <li>Registreer de {termen.sessiegever} hierboven en koppel aan de sessie(s). Enkel adressen van de toegelaten domeinen.</li>
            <li>Stuur een uitnodiging, of geef het adres <strong>{location.origin}/sessiegever</strong>.</li>
            <li>Aanmelden met het e-mailadres en een code van 6 cijfers per mail. De aanmelding blijft geldig tot 5 dagen na de laatste eigen sessie.</li>
            <li>Op de dag zelf: de QR-code op de klaslijst opent de live tabel van die sessie.</li>
          </ol>
        </section>
      </div>

      {bewerk && (
        <BewerkVenster
          start={bewerk}
          term={termen.sessiegever}
          onSluit={() => setBewerk(null)}
          onKlaar={() => {
            setBewerk(null);
            laad();
          }}
        />
      )}
    </>
  );
}

/** Welke gegevens een sessiegever ziet: standaard wat op het rapport staat, extra velden aan te zetten. */
function Velden({ data, evenementId, onKlaar }: { data: SessiegeverBeheer; evenementId: string; onKlaar: () => void }) {
  const [fout, setFout] = useState('');
  const zet = async (id: string, aan: boolean) => {
    if (aan && !confirm('Dit zijn persoonsgegevens. Zet het veld enkel aan als de sessiegever het echt nodig heeft, en vermeld het in de privacytekst van het formulier.')) return;
    try {
      await aanwezigheidApi.zetVelden(evenementId, aan ? [...data.velden, id] : data.velden.filter((v) => v !== id));
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e));
    }
  };
  return (
    <section className="d-kaart">
      <h2>Wat ziet een {data.termen.sessiegever}?</h2>
      <p>Standaard hetzelfde als op de klaslijst: voornaam, naam, school, leerjaar en of iemand op de wachtlijst staat.</p>
      <fieldset className="d-groep">
        <legend>Extra (standaard uit)</legend>
        {data.extraVelden.map((v) => (
          <label key={v.id} className="d-keuze">
            <input type="checkbox" checked={data.velden.includes(v.id)} onChange={(e) => zet(v.id, e.target.checked)} />
            {v.label}
          </label>
        ))}
      </fieldset>
      {fout && <Melding soort="fout">{fout}</Melding>}
    </section>
  );
}

function BewerkVenster({ start, term, onSluit, onKlaar }: { start: Bewerk; term: string; onSluit: () => void; onKlaar: () => void }) {
  const [w, setW] = useState(start);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const bewaar = async () => {
    setBezig(true);
    setFouten({});
    try {
      const waarden = { voornaam: w.voornaam, naam: w.naam, email: w.email };
      if (w.id) await aanwezigheidApi.wijzigSessiegever(w.id, waarden);
      else await aanwezigheidApi.maakSessiegever(waarden);
      onKlaar();
    } catch (e) {
      setFouten(e instanceof ApiFout && e.velden ? e.velden : { algemeen: foutTekst(e) });
      setBezig(false);
    }
  };
  return (
    <Venster titel={w.id ? `${hoofdletter(term)} wijzigen` : `Nieuwe ${term}`} onSluit={onSluit}>
      <form onSubmit={(e) => { e.preventDefault(); bewaar(); }}>
        <div className="d-rij">
          <Invoer label="Voornaam" waarde={w.voornaam} onWijzig={(v) => setW({ ...w, voornaam: v })} verplicht fout={fouten.voornaam} />
          <Invoer label="Naam" waarde={w.naam} onWijzig={(v) => setW({ ...w, naam: v })} />
        </div>
        <Invoer label="E-mailadres" type="email" waarde={w.email} onWijzig={(v) => setW({ ...w, email: v })} verplicht fout={fouten.email}
          hulp={w.id ? 'Een ander adres: lopende aanmeldingen vervallen.' : 'Hiermee meldt de ' + term + ' zich aan.'} />
        {fouten.algemeen && <Melding soort="fout">{fouten.algemeen}</Melding>}
        <div className="d-knoppen">
          <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
          <button type="submit" className="d-knop" disabled={bezig}>Bewaren</button>
        </div>
      </form>
    </Venster>
  );
}
