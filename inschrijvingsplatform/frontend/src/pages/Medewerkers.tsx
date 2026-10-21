import { useCallback, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Tekstveld } from '../components/Velden';
import { Instellingen } from './Instellingen';
import '../medewerkers.css';
import { isDemo } from '../services/api';
import { beheerApi, instellingenApi, type BeheerGebruiker, type Profiel, type Uitnodiging } from '../services/beheerApi';
import { meldAanMetPasskey, passkeysBeschikbaar, registreerPasskey } from '../services/passkey';
import { ApiFout } from '../types';

const bericht = (e: unknown) => (e instanceof ApiFout ? e.message : 'Er ging iets mis.');
const ROLNAAM: Record<string, string> = {
  platformbeheerder: 'Platformbeheerder',
  schoolbeheerder: 'Schoolbeheerder',
  organisator: 'Organisator',
  onthaal: 'Onthaal',
};

/** Aanmelden en beheer voor medewerkers (/medewerkers). */
export function Medewerkers() {
  const activeren = location.pathname.replace(/\/$/, '').endsWith('/activeren');
  const [profiel, setProfiel] = useState<Profiel | null | 'laden'>('laden');

  const laad = useCallback(() => {
    beheerApi
      .profiel()
      .then(setProfiel)
      .catch(() => setProfiel(null));
  }, []);

  useEffect(() => {
    document.title = 'Medewerkers';
    if (!isDemo) laad();
  }, [laad]);

  if (isDemo) {
    return (
      <main className="pagina">
        <div className="melding melding--waarschuwing">Het beheer is niet beschikbaar in de demomodus (VITE_API_URL ontbreekt).</div>
      </main>
    );
  }
  if (profiel === 'laden') {
    return (
      <main className="pagina" aria-busy="true">
        <p className="laden">Even geduld…</p>
      </main>
    );
  }
  if (profiel) {
    const ev = location.pathname.match(/^\/medewerkers\/evenementen\/([A-Za-z0-9-]{1,64})\/?$/);
    if (ev) return <Instellingen evenementId={ev[1]} />;
    return <Beheer profiel={profiel} naVerandering={laad} />;
  }
  return activeren ? <Activeren naKlaar={laad} /> : <Aanmelden naKlaar={laad} />;
}

// ---------------------------------------------------------------------------
function Aanmelden({ naKlaar }: { naKlaar: () => void }) {
  const [email, setEmail] = useState('');
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
      setFout(bericht(e));
    } finally {
      setBezig(false);
    }
  };

  return (
    <main className="pagina">
      <header className="kop">
        <h1>Medewerkers</h1>
      </header>
      <section className="kaartblok">
        <h2>Aanmelden</h2>
        {fout && <div className="melding melding--fout" role="alert">{fout}</div>}

        {passkeysBeschikbaar() && (
          <>
            <button type="button" className="knop" disabled={bezig} onClick={() => uitvoeren(meldAanMetPasskey)}>
              Aanmelden met passkey
            </button>
            <p className="hulp">Met de pincode, vingerafdruk of gezichtsherkenning van dit toestel.</p>
            <hr />
          </>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            uitvoeren(() => beheerApi.aanmelden(email, code));
          }}
        >
          <Tekstveld label="E-mailadres" type="email" autoComplete="username" waarde={email} onWijzig={setEmail} verplicht />
          <Tekstveld label="Code uit je authenticator-app" waarde={code} onWijzig={setCode} verplicht autoComplete="one-time-code" hulp="6 cijfers" />
          <div className="knoppen">
            <button type="submit" className="knop knop--secundair" disabled={bezig || !email || code.replace(/\s/g, '').length !== 6}>
              Aanmelden met code
            </button>
          </div>
        </form>
        <p className="info info--klein">
          Eerste keer? <a href="/medewerkers/activeren">Activeer je account</a> met de uitnodigingscode van de beheerder.
        </p>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
function Qr({ tekst }: { tekst: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(tekst);
  qr.make();
  return <div className="qr" role="img" aria-label="QR-code voor je authenticator-app" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />;
}

function Activeren({ naKlaar }: { naKlaar: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [koppeling, setKoppeling] = useState<{ geheim: string; otpauth: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const uitvoeren = async (werk: () => Promise<void>) => {
    setBezig(true);
    setFout(null);
    try {
      await werk();
    } catch (e) {
      setFout(bericht(e));
    } finally {
      setBezig(false);
    }
  };

  return (
    <main className="pagina">
      <header className="kop">
        <h1>Account activeren</h1>
      </header>
      <section className="kaartblok">
        {fout && <div className="melding melding--fout" role="alert">{fout}</div>}
        {!koppeling ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              uitvoeren(async () => setKoppeling(await beheerApi.activeerStart(email, code)));
            }}
          >
            <p>Vul je @onderwijs.gent.be-adres in en de uitnodigingscode die je van de beheerder kreeg.</p>
            <Tekstveld label="E-mailadres" type="email" autoComplete="username" waarde={email} onWijzig={setEmail} verplicht />
            <Tekstveld label="Uitnodigingscode" waarde={code} onWijzig={setCode} verplicht hulp="Bv. ABCD-EFGH-JKLM-NPQR" />
            <div className="knoppen">
              <button type="submit" className="knop" disabled={bezig || !email || !code}>Volgende</button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              uitvoeren(async () => {
                await beheerApi.activeerBevestig(email, code, totp);
                history.replaceState(null, '', '/medewerkers');
                naKlaar();
              });
            }}
          >
            <p>
              <strong>1.</strong> Open een authenticator-app (Microsoft Authenticator, Google Authenticator, …) en scan de QR-code.
            </p>
            <Qr tekst={koppeling.otpauth} />
            <details>
              <summary>Scannen lukt niet?</summary>
              <p>Voer deze sleutel handmatig in (tijdgebonden, 6 cijfers):</p>
              <p><code>{koppeling.geheim}</code></p>
            </details>
            <p>
              <strong>2.</strong> Vul de code in die de app nu toont.
            </p>
            <Tekstveld label="Code uit de app" waarde={totp} onWijzig={setTotp} verplicht autoComplete="one-time-code" hulp="6 cijfers" />
            <div className="knoppen">
              <button type="submit" className="knop" disabled={bezig || totp.replace(/\s/g, '').length !== 6}>Activeren en aanmelden</button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
function Beheer({ profiel, naVerandering }: { profiel: Profiel; naVerandering: () => void }) {
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const afmelden = async () => {
    await beheerApi.afmelden().catch(() => undefined);
    naVerandering();
  };
  const voegPasskeyToe = async () => {
    setBezig(true);
    setFout(null);
    try {
      await registreerPasskey(navigator.platform ? `Passkey (${navigator.platform})` : 'Passkey');
      naVerandering();
    } catch (e) {
      setFout(bericht(e));
    } finally {
      setBezig(false);
    }
  };
  const verwijderPasskey = async (id: string) => {
    if (!confirm('Deze passkey verwijderen?')) return;
    await beheerApi.passkeyVerwijder(id).catch((e) => setFout(bericht(e)));
    naVerandering();
  };

  return (
    <main className="pagina">
      <header className="kop">
        <h1>Medewerkers</h1>
        <p className="intro">
          {profiel.voornaam} {profiel.naam} · {ROLNAAM[profiel.rol] ?? profiel.rol} ·{' '}
          <button type="button" className="link-knop" onClick={afmelden}>Afmelden</button>
        </p>
      </header>
      {fout && <div className="melding melding--fout" role="alert">{fout}</div>}

      <section className="kaartblok">
        <h2>Evenementen</h2>
        {profiel.evenementen.length === 0 ? (
          <p>Je hebt nog geen toegang tot een evenement. Vraag het aan de beheerder.</p>
        ) : (
          <ul className="lijst">
            {profiel.evenementen.map((e) => (
              <li key={e.id}>
                <strong>{e.titel}</strong> <span className="info--klein">({e.status}, {e.start})</span>
                <br />
                <a href={`/medewerkers/evenementen/${e.id}`}>Instellingen</a>
                {' · '}
                <a href={beheerApi.csvUrl(e.id)} download>Deelnemerslijst downloaden (Excel/CSV)</a>
              </li>
            ))}
          </ul>
        )}
        {profiel.rol === 'platformbeheerder' && <NieuwEvenement />}
      </section>

      <section className="kaartblok">
        <h2>Passkeys</h2>
        <p className="hulp">Meld je aan met de pincode of vingerafdruk van dit toestel, zonder code uit de app.</p>
        {profiel.passkeys.length > 0 && (
          <ul className="lijst">
            {profiel.passkeys.map((p) => (
              <li key={p.id}>
                {p.naam} <span className="info--klein">· toegevoegd {p.aangemaakt.slice(0, 10)}</span>{' '}
                <button type="button" className="link-knop" onClick={() => verwijderPasskey(p.id)}>Verwijderen</button>
              </li>
            ))}
          </ul>
        )}
        {passkeysBeschikbaar() ? (
          <button type="button" className="knop knop--secundair" disabled={bezig} onClick={voegPasskeyToe}>Passkey toevoegen op dit toestel</button>
        ) : (
          <p className="info">Deze browser ondersteunt geen passkeys.</p>
        )}
      </section>

      {profiel.rol === 'platformbeheerder' && <Gebruikers profiel={profiel} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
function Gebruikers({ profiel }: { profiel: Profiel }) {
  const [lijst, setLijst] = useState<BeheerGebruiker[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [uitnodiging, setUitnodiging] = useState<(Uitnodiging & { voor: string }) | null>(null);
  const [nieuw, setNieuw] = useState({ voornaam: '', naam: '', email: '', rol: 'organisator', evenementIds: [] as string[] });

  const laad = useCallback(() => {
    beheerApi.gebruikers().then(setLijst).catch((e) => setFout(bericht(e)));
  }, []);
  useEffect(laad, [laad]);

  const uitvoeren = async (werk: () => Promise<void>) => {
    setFout(null);
    try {
      await werk();
      laad();
    } catch (e) {
      setFout(bericht(e));
    }
  };

  return (
    <section className="kaartblok">
      <h2>Gebruikers</h2>
      {fout && <div className="melding melding--fout" role="alert">{fout}</div>}
      {uitnodiging && (
        <div className="melding melding--waarschuwing" role="status">
          <p>
            Uitnodigingscode voor <strong>{uitnodiging.voor}</strong> (geldig tot {uitnodiging.geldigTot.slice(0, 10)}):
          </p>
          <p><code className="code">{uitnodiging.uitnodigingscode}</code></p>
          <p>
            Geef deze code persoonlijk door (niet per mail samen met het adres). Ze wordt maar één keer getoond. De gebruiker activeert via{' '}
            <strong>/medewerkers/activeren</strong>.
          </p>
          <button type="button" className="knop knop--secundair" onClick={() => setUitnodiging(null)}>Sluiten</button>
        </div>
      )}

      <ul className="lijst">
        {lijst.map((g) => (
          <li key={g.id}>
            <strong>{g.voornaam} {g.naam}</strong> · {g.email} · {ROLNAAM[g.rol] ?? g.rol}
            {!g.actief && <> · <em>gedeactiveerd</em></>}
            <br />
            <span className="info--klein">
              {g.heeftAuthenticator ? 'Authenticator actief' : g.uitnodigingOpen ? 'Wacht op activatie' : 'Niet geactiveerd'}
              {g.aantalPasskeys > 0 && ` · ${g.aantalPasskeys} passkey(s)`}
            </span>
            {g.email !== profiel.email && (
              <>
                {' '}
                <button
                  type="button"
                  className="link-knop"
                  onClick={() =>
                    confirm(`Authenticator en passkeys van ${g.voornaam} verwijderen en een nieuwe uitnodigingscode maken?`) &&
                    uitvoeren(async () => setUitnodiging({ ...(await beheerApi.resetGebruiker(g.id)), voor: g.email }))
                  }
                >
                  Resetten
                </button>{' '}
                <button type="button" className="link-knop" onClick={() => uitvoeren(() => beheerApi.zetActief(g.id, !g.actief).then(() => undefined))}>
                  {g.actief ? 'Deactiveren' : 'Heractiveren'}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <h3>Gebruiker toevoegen</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          uitvoeren(async () => {
            const r = await beheerApi.maakGebruiker(nieuw);
            setUitnodiging({ ...r, voor: nieuw.email });
            setNieuw({ voornaam: '', naam: '', email: '', rol: 'organisator', evenementIds: [] });
          });
        }}
      >
        <Tekstveld label="Voornaam" waarde={nieuw.voornaam} onWijzig={(v) => setNieuw({ ...nieuw, voornaam: v })} verplicht />
        <Tekstveld label="Naam" waarde={nieuw.naam} onWijzig={(v) => setNieuw({ ...nieuw, naam: v })} verplicht />
        <Tekstveld label="E-mailadres (@onderwijs.gent.be)" type="email" waarde={nieuw.email} onWijzig={(v) => setNieuw({ ...nieuw, email: v })} verplicht />
        <div className="veld">
          <label htmlFor="nieuwe-rol">Rol</label>
          <select id="nieuwe-rol" value={nieuw.rol} onChange={(e) => setNieuw({ ...nieuw, rol: e.target.value })}>
            <option value="organisator">Organisator (beheert gekozen evenementen)</option>
            <option value="onthaal">Onthaal (gekozen evenementen)</option>
            <option value="platformbeheerder">Platformbeheerder (alles)</option>
          </select>
        </div>
        {nieuw.rol !== 'platformbeheerder' && profiel.evenementen.length > 0 && (
          <fieldset className="veld">
            <legend>Toegang tot evenementen</legend>
            {profiel.evenementen.map((ev) => (
              <label key={ev.id} className="vinkje">
                <input
                  type="checkbox"
                  checked={nieuw.evenementIds.includes(ev.id)}
                  onChange={(e) =>
                    setNieuw({ ...nieuw, evenementIds: e.target.checked ? [...nieuw.evenementIds, ev.id] : nieuw.evenementIds.filter((x) => x !== ev.id) })
                  }
                />{' '}
                {ev.titel}
              </label>
            ))}
          </fieldset>
        )}
        <div className="knoppen">
          <button type="submit" className="knop" disabled={!nieuw.voornaam || !nieuw.naam || !nieuw.email}>Toevoegen</button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
/** Een nieuw evenement starten; de rest stel je in op de instellingenpagina. */
function NieuwEvenement() {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState({ titel: '', slug: '', start_datum: '', eind_datum: '' });
  const [fout, setFout] = useState<string | null>(null);
  if (!open) return <button type="button" className="knop knop--secundair" onClick={() => setOpen(true)}>Nieuw evenement</button>;
  const maakSlug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setFout(null);
        try {
          const { id } = await instellingenApi.maak('evenement', null, { ...w, eind_datum: w.eind_datum || w.start_datum });
          location.href = `/medewerkers/evenementen/${id}`;
        } catch (err) {
          setFout(err instanceof ApiFout ? Object.values(err.velden ?? {}).join(' ') || err.message : 'Aanmaken mislukt.');
        }
      }}
    >
      <h3>Nieuw evenement</h3>
      {fout && <div className="melding melding--fout" role="alert">{fout}</div>}
      <Tekstveld label="Titel" waarde={w.titel} onWijzig={(v) => setW({ ...w, titel: v, slug: w.slug || maakSlug(v) })} verplicht />
      <Tekstveld label="Adres (slug)" waarde={w.slug} onWijzig={(v) => setW({ ...w, slug: v })} verplicht hulp="Kleine letters, cijfers en streepjes, bv. opendeur-2027" />
      <div className="veld">
        <label htmlFor="nieuw-start">Eerste dag</label>
        <input id="nieuw-start" type="date" required value={w.start_datum} onChange={(e) => setW({ ...w, start_datum: e.target.value })} />
      </div>
      <div className="veld">
        <label htmlFor="nieuw-eind">Laatste dag</label>
        <input id="nieuw-eind" type="date" value={w.eind_datum} onChange={(e) => setW({ ...w, eind_datum: e.target.value })} />
      </div>
      <p className="hulp">Het evenement start als <strong>concept</strong> en is pas zichtbaar als je het publiceert.</p>
      <div className="knoppen">
        <button type="button" className="knop knop--secundair" onClick={() => setOpen(false)}>Annuleren</button>
        <button type="submit" className="knop">Aanmaken</button>
      </div>
    </form>
  );
}
