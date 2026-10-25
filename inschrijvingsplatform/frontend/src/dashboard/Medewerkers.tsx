import { useCallback, useEffect, useMemo, useState } from 'react';
import { beheerApi, type BeheerGebruiker, type Profiel, type Rol, type Uitnodiging } from '../services/beheerApi';
import { domeinTekst, isToegelatenEmail, useInstallatie, voorbeeldAdres } from '../services/installatie';
import { datumTijd, EenmaligeCode, foutTekst, Invoer, Link, Melding, ROLNAAM, Venster } from './ui';

/** Medewerkers beheren (enkel platformbeheerders; de API controleert dat ook). */

const ROLLEN: { rol: Rol; uitleg: string }[] = [
  { rol: 'organisator', uitleg: 'Stelt de gekozen evenementen in en downloadt deelnemers.' },
  { rol: 'onthaal', uitleg: 'Scant aan het onthaal, zet aanwezig en past lesjes aan bij de gekozen evenementen; wijzigt geen instellingen (zie Rollen en rechten).' },
  { rol: 'platformbeheerder', uitleg: 'Alle evenementen en medewerkers.' },
];

function status(g: BeheerGebruiker): { tekst: string; soort: string } {
  if (!g.actief) return { tekst: 'Gedeactiveerd', soort: 'gearchiveerd' };
  if (g.heeftAuthenticator || g.aantalPasskeys) return { tekst: 'Actief', soort: 'gepubliceerd' };
  if (g.uitnodigingOpen) return { tekst: 'Wacht op activatie', soort: 'concept' };
  return { tekst: 'Uitnodiging verlopen', soort: 'gesloten' };
}

export function Medewerkers({ profiel }: { profiel: Profiel }) {
  const [lijst, setLijst] = useState<BeheerGebruiker[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bewerk, setBewerk] = useState<BeheerGebruiker | 'nieuw' | null>(null);
  const [code, setCode] = useState<(Uitnodiging & { voor: string; voornaam: string }) | null>(null);
  const [zoek, setZoek] = useState('');
  const domein = domeinTekst(useInstallatie());

  const laad = useCallback(() => {
    beheerApi.gebruikers().then(setLijst).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  const titels = useMemo(() => new Map(profiel.evenementen.map((e) => [e.id, e.titel])), [profiel.evenementen]);
  const zichtbaar = (lijst ?? []).filter((g) => {
    const z = zoek.trim().toLowerCase();
    return !z || `${g.voornaam} ${g.naam} ${g.email}`.toLowerCase().includes(z);
  });

  const uitvoeren = async (werk: () => Promise<void>) => {
    setFout(null);
    try {
      await werk();
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    }
  };

  const reset = (g: BeheerGebruiker) => {
    if (!confirm(`2FA van ${g.voornaam} ${g.naam} opnieuw instellen?\n\nWachtwoord, authenticator, passkeys en sessies worden gewist. Je krijgt een nieuwe eenmalige code.`)) return;
    uitvoeren(async () => setCode({ ...(await beheerApi.resetGebruiker(g.id)), voor: g.email, voornaam: g.voornaam }));
  };
  const actief = (g: BeheerGebruiker) => {
    if (g.actief && !confirm(`${g.voornaam} ${g.naam} deactiveren? Aanmelden is dan niet meer mogelijk.`)) return;
    uitvoeren(async () => void (await beheerApi.bewerkGebruiker(g.id, { actief: !g.actief })));
  };

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Medewerkers</h1>
          <p className="d-sub">{domein ? `Enkel ${domein}-adressen. ` : ''}Nieuwe medewerkers krijgen een eenmalige code om hun account te activeren.</p>
        </div>
        <div className="d-knoppen" style={{ marginTop: 0 }}>
          <Link href="/dashboard/medewerkers/rechten" className="d-knop d-knop--secundair">Rollen en rechten</Link>
          <button type="button" className="d-knop" onClick={() => setBewerk('nieuw')}>+ Medewerker toevoegen</button>
        </div>
      </header>
      {fout && <Melding soort="fout">{fout}</Melding>}

      <details className="d-info">
        <summary>Hoe lang zijn codes en sessies geldig?</summary>
        <ul className="d-lijst">
          <li>
            <strong>Uitnodigingscode</strong> (bij een nieuwe medewerker of na <em>2FA opnieuw instellen</em>): <strong>7 dagen</strong> geldig en maar{' '}
            <strong>één keer</strong> te gebruiken. Is ze verlopen, kies dan opnieuw <em>2FA opnieuw instellen</em> voor een nieuwe code.
          </li>
          <li>
            <strong>Code uit de authenticator-app</strong>: wisselt elke <strong>30 seconden</strong> (met een kleine marge voor een klokverschil) en werkt maar één keer.
          </li>
          <li>
            <strong>Sessie na het aanmelden</strong>: maximaal <strong>8 uur</strong>, en na <strong>2 uur zonder activiteit</strong> moet je opnieuw aanmelden.
          </li>
          <li>
            <strong>Foute pogingen</strong>: na 5 foute pogingen voor één e-mailadres (of 20 vanaf één IP-adres) volgt <strong>15 minuten</strong> blokkade.
          </li>
          <li>
            <strong>Wachtwoord</strong>: minstens 12 tekens, geen vervaldatum. Een medewerker wijzigt het zelf onder <em>Mijn account</em>.
          </li>
        </ul>
      </details>

      <div className="d-werkbalk">
        <input type="search" placeholder="Zoeken op naam of e-mail…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoeken" />
      </div>

      {!lijst ? (
        <p>Laden…</p>
      ) : (
        <div className="d-tabelvak">
          <table className="d-tabel">
            <thead>
              <tr>
                <th>Naam</th>
                <th>E-mail (login)</th>
                <th>Rol</th>
                <th>Evenementen</th>
                <th>Beveiliging</th>
                <th>Laatst aangemeld</th>
                <th>Status</th>
                <th>Acties</th>
              </tr>
            </thead>
            <tbody>
              {zichtbaar.map((g) => {
                const st = status(g);
                const ik = g.email === profiel.email;
                return (
                  <tr key={g.id} className={g.actief ? undefined : 'd-gedimd'}>
                    <td><strong>{g.voornaam} {g.naam}</strong>{ik && <span className="d-klein"> (jij)</span>}</td>
                    <td>{g.email}</td>
                    <td>{ROLNAAM[g.rol] ?? g.rol}</td>
                    <td className="d-klein">
                      {g.rol === 'platformbeheerder' ? 'Alle' : g.evenementIds.map((id) => titels.get(id) ?? '?').join(', ') || '—'}
                    </td>
                    <td className="d-klein">
                      <span className={g.heeftWachtwoord ? 'd-ok' : 'd-nee'}>Wachtwoord</span>{' · '}
                      <span className={g.heeftAuthenticator ? 'd-ok' : 'd-nee'}>Authenticator</span>
                      {g.aantalPasskeys > 0 && <> · {g.aantalPasskeys} passkey{g.aantalPasskeys > 1 ? 's' : ''}</>}
                    </td>
                    <td>{datumTijd(g.laatsteAanmelding)}</td>
                    <td><span className={`d-badge d-badge--${st.soort}`}>{st.tekst}</span></td>
                    <td className="d-acties">
                      <button type="button" className="d-link" onClick={() => setBewerk(g)}>Bewerken</button>
                      {!ik && <button type="button" className="d-link" onClick={() => reset(g)}>2FA opnieuw instellen</button>}
                      {!ik && <button type="button" className="d-link" onClick={() => actief(g)}>{g.actief ? 'Deactiveren' : 'Heractiveren'}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MailTest />

      {bewerk && (
        <Bewerken
          gebruiker={bewerk === 'nieuw' ? null : bewerk}
          profiel={profiel}
          onSluit={() => setBewerk(null)}
          naKlaar={(uitnodiging, email, voornaam) => {
            setBewerk(null);
            if (uitnodiging) setCode({ ...uitnodiging, voor: email, voornaam });
            laad();
          }}
        />
      )}
      {code && (
        <Venster titel="Eenmalige code" onSluit={() => setCode(null)} breed>
          <EenmaligeCode
            code={code.uitnodigingscode}
            geldigTot={code.geldigTot}
            voornaam={code.voornaam}
            email={code.voor}
            afzender={`${profiel.voornaam} ${profiel.naam}`}
          />
          <div className="d-knoppen">
            <button type="button" className="d-knop" onClick={() => setCode(null)}>Klaar</button>
          </div>
        </Venster>
      )}
    </>
  );
}

function Bewerken({ gebruiker, profiel, onSluit, naKlaar }: {
  gebruiker: BeheerGebruiker | null;
  profiel: Profiel;
  onSluit: () => void;
  naKlaar: (uitnodiging: Uitnodiging | null, email: string, voornaam: string) => void;
}) {
  const [w, setW] = useState({
    voornaam: gebruiker?.voornaam ?? '',
    naam: gebruiker?.naam ?? '',
    email: gebruiker?.email ?? '',
    rol: gebruiker?.rol ?? ('organisator' as Rol),
    evenementIds: gebruiker?.evenementIds ?? [],
  });
  const [fout, setFout] = useState<string | null>(null);
  const ik = gebruiker?.email === profiel.email;
  const installatie = useInstallatie();
  const emailFout = w.email && !isToegelatenEmail(installatie, w.email) ? `Enkel adressen ${domeinTekst(installatie)}.` : undefined;

  return (
    <Venster titel={gebruiker ? `${gebruiker.voornaam} ${gebruiker.naam} bewerken` : 'Medewerker toevoegen'} onSluit={onSluit} breed>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setFout(null);
          try {
            if (gebruiker) {
              await beheerApi.bewerkGebruiker(gebruiker.id, {
                voornaam: w.voornaam,
                naam: w.naam,
                ...(ik ? {} : { rol: w.rol }),
                evenementIds: w.evenementIds,
              });
              naKlaar(null, w.email, w.voornaam);
            } else {
              const r = await beheerApi.maakGebruiker({ ...w, email: w.email.trim().toLowerCase() });
              naKlaar(r, w.email.trim().toLowerCase(), w.voornaam);
            }
          } catch (err) {
            setFout(foutTekst(err, 'Opslaan mislukt.'));
          }
        }}
      >
        {fout && <Melding soort="fout">{fout}</Melding>}
        <div className="d-rij">
          <Invoer label="Voornaam" waarde={w.voornaam} onWijzig={(v) => setW({ ...w, voornaam: v })} verplicht autoFocus />
          <Invoer label="Naam" waarde={w.naam} onWijzig={(v) => setW({ ...w, naam: v })} verplicht />
        </div>
        {gebruiker ? (
          <p className="d-klein">Login: <strong>{gebruiker.email}</strong> (het adres wijzig je niet; maak zo nodig een nieuwe medewerker aan).</p>
        ) : (
          <Invoer label="E-mailadres (login)" type="email" waarde={w.email} onWijzig={(v) => setW({ ...w, email: v })} verplicht fout={emailFout} placeholder={voorbeeldAdres(installatie)} />
        )}

        <fieldset className="d-groep" disabled={ik}>
          <legend>Rol{ik && ' (je eigen rol kan je niet wijzigen)'}</legend>
          {ROLLEN.map((r) => (
            <label key={r.rol} className="d-keuze">
              <input type="radio" name="rol" checked={w.rol === r.rol} onChange={() => setW({ ...w, rol: r.rol })} />
              <span><strong>{ROLNAAM[r.rol]}</strong> <span className="d-klein">– {r.uitleg}</span></span>
            </label>
          ))}
        </fieldset>

        {w.rol !== 'platformbeheerder' && (
          <fieldset className="d-groep">
            <legend>Toegang tot evenementen</legend>
            {profiel.evenementen.length === 0 && <p className="d-klein">Nog geen evenementen.</p>}
            <div className="d-kolommen">
              {profiel.evenementen.map((ev) => (
                <label key={ev.id} className="d-keuze">
                  <input
                    type="checkbox"
                    checked={w.evenementIds.includes(ev.id)}
                    onChange={(e) =>
                      setW({ ...w, evenementIds: e.target.checked ? [...w.evenementIds, ev.id] : w.evenementIds.filter((x) => x !== ev.id) })
                    }
                  />
                  <span>{ev.titel}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="d-knoppen">
          <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
          <button type="submit" className="d-knop" disabled={!w.voornaam || !w.naam || (!gebruiker && (!w.email || !!emailFout))}>
            {gebruiker ? 'Opslaan' : 'Toevoegen en code maken'}
          </button>
        </div>
      </form>
    </Venster>
  );
}

/** Controleert de e-mailverzending (Worker → flow → mailbox) met een testmail naar jezelf. */
function MailTest() {
  const [uitslag, setUitslag] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  return (
    <section className="d-kaart">
      <h2>E-mailverzending testen</h2>
      <p className="d-klein">Stuurt een testmail naar je eigen adres via dezelfde weg als de bevestigingsmails voor ouders.</p>
      {uitslag && <Melding soort={uitslag.ok ? 'ok' : 'fout'}>{uitslag.tekst}</Melding>}
      <button
        type="button"
        className="d-knop d-knop--secundair"
        disabled={bezig}
        onClick={async () => {
          setBezig(true);
          setUitslag(null);
          try {
            const r = await beheerApi.testMail();
            if (!r.ok) setUitslag({ ok: false, tekst: `Versturen mislukt (${r.provider}): ${r.fout}` });
            else if (r.status === 'overgeslagen') setUitslag({ ok: false, tekst: 'Er is niets verstuurd: MAIL_PROVIDER staat op "log". Zet hem op "webhook" (stap 14 van het stappenplan).' });
            else setUitslag({ ok: true, tekst: 'Verstuurd naar de flow. Kijk in je mailbox (het kan een minuut duren).' });
          } catch (e) {
            setUitslag({ ok: false, tekst: foutTekst(e) });
          } finally {
            setBezig(false);
          }
        }}
      >
        {bezig ? 'Bezig…' : 'Testmail naar mezelf sturen'}
      </button>
    </section>
  );
}
