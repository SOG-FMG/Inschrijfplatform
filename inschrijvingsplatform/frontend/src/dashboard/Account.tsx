import { useState } from 'react';
import { beheerApi, type Koppeling, type Profiel } from '../services/beheerApi';
import { passkeysBeschikbaar, registreerPasskey } from '../services/passkey';
import { datum, datumTijd, foutTekst, Invoer, Koppelen, Melding, ROLNAAM, wachtwoordHint } from './ui';

/** Eigen account: gegevens, wachtwoord, authenticator-app en passkeys. */
export function Account({ profiel, naVerandering }: { profiel: Profiel; naVerandering: () => void }) {
  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Mijn account</h1>
          <p className="d-sub">Aanmelden gebeurt met e-mail + wachtwoord + code uit de authenticator-app, of met een passkey.</p>
        </div>
      </header>
      <div className="d-raster">
        <section className="d-kaart">
          <h2>Gegevens</h2>
          <dl className="d-gegevens">
            <dt>Naam</dt>
            <dd>{profiel.voornaam} {profiel.naam}</dd>
            <dt>E-mail (login)</dt>
            <dd>{profiel.email}</dd>
            <dt>Rol</dt>
            <dd>{ROLNAAM[profiel.rol]}</dd>
          </dl>
          <p className="d-klein">Naam of rol wijzigen? Vraag het aan een platformbeheerder.</p>
        </section>
        <Wachtwoord />
        <Authenticator actief={profiel.heeftAuthenticator} naKlaar={naVerandering} />
        <Passkeys profiel={profiel} naKlaar={naVerandering} />
      </div>
    </>
  );
}

function Wachtwoord() {
  const [huidig, setHuidig] = useState('');
  const [nieuw, setNieuw] = useState('');
  const [herhaling, setHerhaling] = useState('');
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const hint = wachtwoordHint(nieuw, herhaling);
  return (
    <section className="d-kaart">
      <h2>Wachtwoord</h2>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setMelding(null);
          try {
            await beheerApi.wijzigWachtwoord(huidig, nieuw);
            setHuidig('');
            setNieuw('');
            setHerhaling('');
            setMelding({ soort: 'ok', tekst: 'Je wachtwoord is gewijzigd.' });
          } catch (err) {
            setMelding({ soort: 'fout', tekst: foutTekst(err) });
          }
        }}
      >
        <Invoer label="Huidig wachtwoord" type="password" waarde={huidig} onWijzig={setHuidig} autoComplete="current-password" verplicht />
        <Invoer label="Nieuw wachtwoord" type="password" waarde={nieuw} onWijzig={setNieuw} autoComplete="new-password" verplicht hulp="Minstens 12 tekens." />
        <Invoer label="Herhaal nieuw wachtwoord" type="password" waarde={herhaling} onWijzig={setHerhaling} autoComplete="new-password" verplicht fout={herhaling ? hint : undefined} />
        <div className="d-knoppen">
          <button type="submit" className="d-knop" disabled={!huidig || !!hint || !nieuw || herhaling !== nieuw}>Wachtwoord wijzigen</button>
        </div>
      </form>
    </section>
  );
}

function Authenticator({ actief, naKlaar }: { actief: boolean; naKlaar: () => void }) {
  const [koppeling, setKoppeling] = useState<Koppeling | null>(null);
  const [code, setCode] = useState('');
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  return (
    <section className="d-kaart">
      <h2>Authenticator-app (2FA)</h2>
      <p>
        Status: <span className={actief ? 'd-ok' : 'd-nee'}>{actief ? 'gekoppeld' : 'niet gekoppeld'}</span>
      </p>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}
      {!koppeling ? (
        <>
          <p className="d-klein">Nieuwe telefoon? Koppel de app opnieuw. Je huidige app blijft werken tot je de nieuwe bevestigt.</p>
          <button
            type="button"
            className="d-knop d-knop--secundair"
            onClick={async () => {
              setMelding(null);
              try {
                setKoppeling(await beheerApi.authenticatorStart());
              } catch (err) {
                setMelding({ soort: 'fout', tekst: foutTekst(err) });
              }
            }}
          >
            {actief ? 'Opnieuw koppelen' : 'Koppelen'}
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await beheerApi.authenticatorBevestig(code.replace(/\s/g, ''));
              setKoppeling(null);
              setCode('');
              setMelding({ soort: 'ok', tekst: 'De nieuwe app is gekoppeld. De oude code werkt niet meer.' });
              naKlaar();
            } catch (err) {
              setMelding({ soort: 'fout', tekst: foutTekst(err) });
            }
          }}
        >
          <Koppelen {...koppeling} />
          <Invoer label="Code die de nieuwe app toont" waarde={code} onWijzig={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={7} verplicht />
          <div className="d-knoppen">
            <button type="button" className="d-knop d-knop--secundair" onClick={() => setKoppeling(null)}>Annuleren</button>
            <button type="submit" className="d-knop" disabled={code.replace(/\s/g, '').length !== 6}>Bevestigen</button>
          </div>
        </form>
      )}
    </section>
  );
}

function Passkeys({ profiel, naKlaar }: { profiel: Profiel; naKlaar: () => void }) {
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [naam, setNaam] = useState('');
  return (
    <section className="d-kaart">
      <h2>Passkeys</h2>
      <p className="d-klein">
        Aanmelden met de pincode, vingerafdruk of gezichtsherkenning van je laptop (bv. Windows Hello), zonder wachtwoord en code. De sleutel verlaat je toestel nooit.
      </p>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}
      {profiel.passkeys.length > 0 && (
        <table className="d-tabel d-tabel--compact">
          <thead>
            <tr><th>Naam</th><th>Toegevoegd</th><th>Laatst gebruikt</th><th /></tr>
          </thead>
          <tbody>
            {profiel.passkeys.map((p) => (
              <tr key={p.id}>
                <td>{p.naam}</td>
                <td>{datum(p.aangemaakt)}</td>
                <td>{datumTijd(p.laatstGebruikt)}</td>
                <td>
                  <button
                    type="button"
                    className="d-link d-link--gevaar"
                    onClick={async () => {
                      if (!confirm(`Passkey "${p.naam}" verwijderen?`)) return;
                      await beheerApi.passkeyVerwijder(p.id).catch((e) => setMelding({ soort: 'fout', tekst: foutTekst(e) }));
                      naKlaar();
                    }}
                  >
                    Verwijderen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {passkeysBeschikbaar() ? (
        <form
          className="d-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            setMelding(null);
            try {
              await registreerPasskey(naam.trim() || 'Passkey');
              setNaam('');
              setMelding({ soort: 'ok', tekst: 'Passkey toegevoegd.' });
              naKlaar();
            } catch (err) {
              setMelding({ soort: 'fout', tekst: foutTekst(err) });
            }
          }}
        >
          <Invoer label="Naam van dit toestel" waarde={naam} onWijzig={setNaam} placeholder="bv. Laptop school" maxLength={40} />
          <button type="submit" className="d-knop d-knop--secundair">Passkey toevoegen</button>
        </form>
      ) : (
        <Melding>Deze browser ondersteunt geen passkeys.</Melding>
      )}
    </section>
  );
}
