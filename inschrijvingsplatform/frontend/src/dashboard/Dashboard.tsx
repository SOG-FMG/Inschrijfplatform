import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { isDemo } from '../services/api';
import { beheerApi, type Profiel } from '../services/beheerApi';
import { isModuleActief, useInstallatie } from '../services/installatie';
import { Aanmelden, Activeren, WachtwoordInstellen } from './Aanmelden';
import './dashboard.css';
import { helpUrl } from './help/handleidingen';
import { DASHBOARD_MODULES } from './modules';
import { Link, Melding, ROLNAAM, usePad } from './ui';

/**
 * Beheer op /dashboard (desktop-eerst, werkt ook op een smartphone).
 *   /dashboard                     evenementen
 *   /dashboard/evenementen/<id>    instellingen van een evenement
 *   /dashboard/evenementen/<id>/rapporten   overzichten en klaslijsten (afdrukken, Excel, mailen)
 *   /dashboard/evenementen/<id>/etiketten   naametiketten met de lesjes (opmaak instelbaar)
 *   /dashboard/medewerkers         medewerkers (platformbeheer)
 *   /dashboard/meldingen           meldingen "Probleem of idee?" met logboek en schermafbeelding (platformbeheer)
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
  const installatie = useInstallatie();
  const { organisatie } = installatie;

  const laad = useCallback(() => {
    beheerApi
      .profiel()
      .then((p) => {
        // ?na=/checkin/… : na het aanmelden terug naar de pagina die erom vroeg (enkel een pad op deze site).
        const na = new URLSearchParams(location.search).get('na');
        if (na && /^\/(?!\/)/.test(na)) return location.replace(na);
        setProfiel(p);
      })
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

  const mag = (recht?: string) => !recht || profiel.rechten.includes(recht);
  // Menu en pagina's van de actieve modules (zie modules.tsx).
  const modules = DASHBOARD_MODULES.filter((m) => isModuleActief(installatie, m.id));
  const menu = modules.flatMap((m) => m.menu ?? []).filter((i) => mag(i.recht)).sort((a, b) => a.volgorde - b.volgorde);
  let inhoud: ReactNode = <Melding soort="fout">Deze pagina bestaat niet.</Melding>;
  for (const pagina of modules.flatMap((m) => m.paginas)) {
    const m = pad.match(pagina.patroon);
    if (!m) continue;
    inhoud = !mag(pagina.recht)
      ? <Melding soort="fout">Je hebt geen toegang tot deze pagina.</Melding>
      : pagina.toon(m, { profiel, naVerandering: laad });
    break;
  }

  return (
    <div className="dash">
      <aside className="dash__zijbalk">
        <Link href="/dashboard" className="dash__merk">
          Inschrijvingsplatform <span>Beheer{organisatie && ` · ${organisatie}`}</span>
        </Link>
        <nav aria-label="Beheer">
          {menu.map((i) => (
            <Link key={i.href} href={i.href} className={i.actief(pad) ? 'actief' : undefined}>{i.label}</Link>
          ))}
        </nav>
        {/* Opent de handleiding bij de stap over deze pagina, in een nieuw tabblad (de pagina zelf blijft open). */}
        <a className="dash__help" href={pad.startsWith('/dashboard/help') ? '/dashboard/help' : helpUrl(pad, location.search)}
          target={pad.startsWith('/dashboard/help') ? undefined : '_blank'} rel="noopener">
          {pad.startsWith('/dashboard/help') ? 'Alle handleidingen' : '? Help bij deze pagina'}
        </a>
        <div className="dash__gebruiker">
          <strong>{profiel.voornaam} {profiel.naam}</strong>
          <span>{ROLNAAM[profiel.rol]}</span>
          {!profiel.passkeys.length && !profiel.heeftAuthenticator && <Link href="/dashboard/account" className="dash__waarschuwing">Beveiliging instellen</Link>}
          <button type="button" className="d-link" onClick={afmelden}>Afmelden</button>
        </div>
      </aside>
      <main className="dash__inhoud">{inhoud}</main>
      {/* Versie en commit van deze build: handig als iemand een probleem meldt ("welke versie zie je?"). */}
      <p className="dash__versie" title="Versie van het platform, de commit waaruit het gebouwd is, en de builddatum">
        v{__APP_VERSIE__}
      </p>
    </div>
  );
}
