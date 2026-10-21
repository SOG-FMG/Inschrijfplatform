import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { isDemo } from '../services/api';
import { beheerApi, type Profiel } from '../services/beheerApi';
import { Account } from './Account';
import { Aanmelden, Activeren, WachtwoordInstellen } from './Aanmelden';
import './dashboard.css';
import { Etiketten } from './Etiketten';
import { Evenementen } from './Evenementen';
import { Instellingen } from './Instellingen';
import { Medewerkers } from './Medewerkers';
import { Privacy } from './Privacy';
import { Rapporten } from './Rapporten';
import { Link, Melding, ROLNAAM, usePad } from './ui';

/**
 * Beheer op /dashboard (desktop-eerst, werkt ook op een smartphone).
 *   /dashboard                     evenementen
 *   /dashboard/evenementen/<id>    instellingen van een evenement
 *   /dashboard/evenementen/<id>/rapporten   overzichten en klaslijsten (afdrukken, Excel, mailen)
 *   /dashboard/evenementen/<id>/etiketten   naametiketten met de lesjes (opmaak instelbaar)
 *   /dashboard/medewerkers         medewerkers (platformbeheer)
 *   /dashboard/account             eigen wachtwoord, authenticator en passkeys
 *   /dashboard/privacy             privacy per evenement
 *   /dashboard/activeren           eerste keer aanmelden met een uitnodigingscode
 * Oude adressen onder /medewerkers worden omgezet.
 */

if (location.pathname.startsWith('/medewerkers')) {
  history.replaceState(null, '', location.pathname.replace(/^\/medewerkers/, '/dashboard') + location.search);
}

export function Dashboard() {
  const pad = usePad().replace(/\/$/, '') || '/dashboard';
  const [profiel, setProfiel] = useState<Profiel | null | 'laden'>('laden');

  const laad = useCallback(() => {
    beheerApi
      .profiel()
      .then(setProfiel)
      .catch(() => setProfiel(null));
  }, []);
  useEffect(() => {
    if (!isDemo) laad();
  }, [laad]);

  const afmelden = async () => {
    await beheerApi.afmelden().catch(() => undefined);
    history.replaceState(null, '', '/dashboard');
    setProfiel(null);
  };

  if (isDemo) {
    return (
      <main className="d-aanmelden">
        <Melding soort="let-op">Het beheer is niet beschikbaar in de demomodus (VITE_API_URL ontbreekt).</Melding>
      </main>
    );
  }
  if (profiel === 'laden') return <main className="d-aanmelden" aria-busy="true"><p>Even geduld…</p></main>;
  if (!profiel) return pad === '/dashboard/activeren' ? <Activeren naKlaar={laad} /> : <Aanmelden naKlaar={laad} />;
  if (!profiel.heeftWachtwoord) return <WachtwoordInstellen naKlaar={laad} afmelden={afmelden} />;

  const isBeheer = profiel.rol === 'platformbeheerder';
  let inhoud: ReactNode;
  let ev: RegExpMatchArray | null;
  if (pad === '/dashboard' || pad === '/dashboard/activeren') inhoud = <Evenementen profiel={profiel} naVerandering={laad} />;
  else if ((ev = pad.match(/^\/dashboard\/evenementen\/([A-Za-z0-9-]{1,64})$/))) inhoud = <Instellingen evenementId={ev[1]} naVerandering={laad} />;
  else if ((ev = pad.match(/^\/dashboard\/evenementen\/([A-Za-z0-9-]{1,64})\/rapporten$/))) inhoud = <Rapporten key={ev[1]} evenementId={ev[1]} profiel={profiel} />;
  else if ((ev = pad.match(/^\/dashboard\/evenementen\/([A-Za-z0-9-]{1,64})\/etiketten$/))) inhoud = <Etiketten key={ev[1]} evenementId={ev[1]} />;
  else if (pad === '/dashboard/medewerkers') inhoud = isBeheer ? <Medewerkers profiel={profiel} /> : <Melding soort="fout">Enkel voor platformbeheerders.</Melding>;
  else if (pad === '/dashboard/account') inhoud = <Account profiel={profiel} naVerandering={laad} />;
  else if (pad === '/dashboard/privacy') inhoud = <Privacy profiel={profiel} />;
  else inhoud = <Melding soort="fout">Deze pagina bestaat niet.</Melding>;

  const actief = (prefix: string, exact = false) => (exact ? pad === prefix : pad.startsWith(prefix)) ? 'actief' : undefined;
  const evenementenActief = pad === '/dashboard' || pad.startsWith('/dashboard/evenementen') ? 'actief' : undefined;

  return (
    <div className="dash">
      <aside className="dash__zijbalk">
        <Link href="/dashboard" className="dash__merk">
          Inschrijvingsplatform <span>Beheer</span>
        </Link>
        <nav aria-label="Beheer">
          <Link href="/dashboard" className={evenementenActief}>Evenementen</Link>
          {isBeheer && <Link href="/dashboard/medewerkers" className={actief('/dashboard/medewerkers')}>Medewerkers</Link>}
          <Link href="/dashboard/privacy" className={actief('/dashboard/privacy')}>Privacy</Link>
          <Link href="/dashboard/account" className={actief('/dashboard/account')}>Mijn account</Link>
        </nav>
        <div className="dash__gebruiker">
          <strong>{profiel.voornaam} {profiel.naam}</strong>
          <span>{ROLNAAM[profiel.rol]}</span>
          {!profiel.passkeys.length && !profiel.heeftAuthenticator && <Link href="/dashboard/account" className="dash__waarschuwing">Beveiliging instellen</Link>}
          <button type="button" className="d-link" onClick={afmelden}>Afmelden</button>
        </div>
      </aside>
      <main className="dash__inhoud">{inhoud}</main>
    </div>
  );
}
