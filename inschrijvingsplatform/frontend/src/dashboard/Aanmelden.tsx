import { useState, type ReactNode } from 'react';
import { beheerApi, type Koppeling } from '../services/beheerApi';
import { domeinTekst, useInstallatie, voorbeeldAdres } from '../services/installatie';
import { meldAanMetPasskey, passkeysBeschikbaar } from '../services/passkey';
import { foutTekst, Invoer, Koppelen, Link, Melding, navigeer, wachtwoordHint } from './ui';

/** Aanmelden, account activeren en (voor oude accounts) een wachtwoord instellen. */

function Kaart({ titel, children }: { titel: string; children: ReactNode }) {
  const { organisatie } = useInstallatie();
  return (
    <main className="d-aanmelden">
      <div className="d-aanmelden__kaart">
        <p className="d-merk">Inschrijvingsplatform <span>Beheer{organisatie && ` · ${organisatie}`}</span></p>
        <h1>{titel}</h1>
        {children}
      </div>
    </main>
  );
}

const zesCijfers = (c: string) => c.replace(/\s/g, '').length === 6;

export function Aanmelden({ naKlaar }: { naKlaar: () => void }) {
  const installatie = useInstallatie();
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [code, setCode] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const uitvoeren = async (werk: () => Promise<unknown>) => {
    setBezig(true);
    setFout(null);
    try {
      await werk();
      naKlaar();
    } catch (e) {
      setFout(foutTekst(e));
      setCode('');
    } finally {
      setBezig(false);
    }
  };

  return (
    <Kaart titel="Aanmelden">
      {fout && <Melding soort="fout">{fout}</Melding>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          uitvoeren(() => beheerApi.aanmelden(email.trim(), wachtwoord, code.replace(/\s/g, '')));
        }}
      >
        <Invoer label="E-mailadres" type="email" waarde={email} onWijzig={setEmail} autoComplete="username" verplicht autoFocus placeholder={voorbeeldAdres(installatie)} />
        <Invoer label="Wachtwoord" type="password" waarde={wachtwoord} onWijzig={setWachtwoord} autoComplete="current-password" hulp="Nog nooit een wachtwoord gekozen? Laat leeg: je kiest er meteen één na het aanmelden." />
        <Invoer label="Code uit je authenticator-app" waarde={code} onWijzig={setCode} autoComplete="one-time-code" inputMode="numeric" maxLength={7} verplicht hulp="6 cijfers" />
        <button type="submit" className="d-knop d-knop--breed" disabled={bezig || !email || !zesCijfers(code)}>
          {bezig ? 'Bezig…' : 'Aanmelden'}
        </button>
      </form>

      {passkeysBeschikbaar() && (
        <>
          <div className="d-scheiding"><span>of</span></div>
          <button type="button" className="d-knop d-knop--secundair d-knop--breed" disabled={bezig} onClick={() => uitvoeren(meldAanMetPasskey)}>
            Aanmelden met passkey
          </button>
          <p className="d-hulp">Met de pincode, vingerafdruk of gezichtsherkenning van dit toestel. Een passkey stel je in onder <em>Mijn account</em>.</p>
        </>
      )}
      <p className="d-voet">
        Eerste keer of nieuwe code gekregen? <Link href="/dashboard/activeren">Account activeren</Link>
      </p>
    </Kaart>
  );
}

export function Activeren({ naKlaar }: { naKlaar: () => void }) {
  const domein = domeinTekst(useInstallatie());
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [koppeling, setKoppeling] = useState<Koppeling | null>(null);
  const [wachtwoord, setWachtwoord] = useState('');
  const [herhaling, setHerhaling] = useState('');
  const [totp, setTotp] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const uitvoeren = async (werk: () => Promise<void>) => {
    setBezig(true);
    setFout(null);
    try {
      await werk();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  };
  const wwHint = wachtwoordHint(wachtwoord, herhaling);

  return (
    <Kaart titel="Account activeren">
      <ol className="d-stappen">
        <li className={koppeling ? 'klaar' : 'actief'}>Uitnodiging</li>
        <li className={koppeling ? 'actief' : ''}>Wachtwoord en authenticator</li>
      </ol>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {!koppeling ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uitvoeren(async () => setKoppeling(await beheerApi.activeerStart(email.trim(), code)));
          }}
        >
          <p>Vul je {domein ? `${domein}-adres` : 'e-mailadres'} in en de uitnodigingscode die je van de beheerder kreeg.</p>
          <Invoer label="E-mailadres" type="email" waarde={email} onWijzig={setEmail} autoComplete="username" verplicht autoFocus />
          <Invoer label="Uitnodigingscode" waarde={code} onWijzig={setCode} verplicht hulp="16 tekens, bv. ABCD-EFGH-JKLM-NPQR" autoComplete="off" />
          <button type="submit" className="d-knop d-knop--breed" disabled={bezig || !email || !code}>Volgende</button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uitvoeren(async () => {
              await beheerApi.activeerBevestig(email.trim(), code, totp.replace(/\s/g, ''), wachtwoord);
              navigeer('/dashboard');
              naKlaar();
            });
          }}
        >
          <h2>1. Kies een wachtwoord</h2>
          <Invoer label="Wachtwoord" type="password" waarde={wachtwoord} onWijzig={setWachtwoord} autoComplete="new-password" verplicht hulp="Minstens 12 tekens. Een zin van enkele woorden is sterk en makkelijk te onthouden." fout={wachtwoord.length >= 12 ? undefined : wwHint} />
          <Invoer label="Herhaal wachtwoord" type="password" waarde={herhaling} onWijzig={setHerhaling} autoComplete="new-password" verplicht fout={herhaling ? wwHint : undefined} />
          <h2>2. Koppel je authenticator-app</h2>
          <Koppelen {...koppeling} />
          <Invoer label="Code die de app nu toont" waarde={totp} onWijzig={setTotp} autoComplete="one-time-code" inputMode="numeric" maxLength={7} verplicht hulp="6 cijfers. Vul ze als laatste in: de code wisselt elke 30 seconden." />
          <button type="submit" className="d-knop d-knop--breed" disabled={bezig || !!wwHint || !wachtwoord || herhaling !== wachtwoord || !zesCijfers(totp)}>
            Activeren en aanmelden
          </button>
        </form>
      )}
      <p className="d-voet">
        <Link href="/dashboard">Terug naar aanmelden</Link>
      </p>
    </Kaart>
  );
}

/** Accounts van vóór de wachtwoordstap: eerst een wachtwoord kiezen. */
export function WachtwoordInstellen({ naKlaar, afmelden }: { naKlaar: () => void; afmelden: () => void }) {
  const [wachtwoord, setWachtwoord] = useState('');
  const [herhaling, setHerhaling] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const hint = wachtwoordHint(wachtwoord, herhaling);
  return (
    <Kaart titel="Kies een wachtwoord">
      <p>Aanmelden gebeurt voortaan met je e-mailadres, een <strong>wachtwoord</strong> én de code uit je authenticator-app. Kies nu een wachtwoord.</p>
      {fout && <Melding soort="fout">{fout}</Melding>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setFout(null);
          try {
            await beheerApi.wijzigWachtwoord('', wachtwoord);
            naKlaar();
          } catch (err) {
            setFout(foutTekst(err));
          }
        }}
      >
        <Invoer label="Nieuw wachtwoord" type="password" waarde={wachtwoord} onWijzig={setWachtwoord} autoComplete="new-password" verplicht autoFocus hulp="Minstens 12 tekens." />
        <Invoer label="Herhaal wachtwoord" type="password" waarde={herhaling} onWijzig={setHerhaling} autoComplete="new-password" verplicht fout={herhaling ? hint : undefined} />
        <button type="submit" className="d-knop d-knop--breed" disabled={!!hint || !wachtwoord || herhaling !== wachtwoord}>Opslaan</button>
      </form>
      <p className="d-voet">
        <button type="button" className="d-link" onClick={afmelden}>Afmelden</button>
      </p>
    </Kaart>
  );
}
