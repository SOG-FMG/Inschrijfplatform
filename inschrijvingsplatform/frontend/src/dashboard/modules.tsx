import type { ReactNode } from 'react';
import type { Profiel } from '../services/beheerApi';
import { Account } from './Account';
import { Contacten } from './Contacten';
import { Etiketten } from './Etiketten';
import { Help } from './help/Help';
import { EvenementOverzicht } from './EvenementOverzicht';
import { Evenementen } from './Evenementen';
import { Importeren } from './Importeren';
import { Instellingen } from './Instellingen';
import { Mailteksten } from './Mailteksten';
import { Medewerkers } from './Medewerkers';
import { Meldingen } from './Meldingen';
import { Privacy } from './Privacy';
import { Aanwezigheid } from './Aanwezigheid';
import { RollenRechten } from './RollenRechten';
import { Sessiegevers } from './Sessiegevers';
import { Rapporten } from './Rapporten';
import { Voorinschrijvingen } from './Voorinschrijvingen';

/**
 * Het dashboard per module (zelfde ids als backend/src/modules). Dashboard.tsx toont enkel het menu en de
 * pagina's van de modules die in deze installatie actief zijn (GET /api/installatie). De API controleert
 * de toegang zelf; dit bepaalt enkel wat de gebruiker te zien krijgt.
 * Een nieuwe module: voeg hier een DashboardModule toe met haar menu-items en pagina's.
 */

export interface PaginaContext {
  profiel: Profiel;
  /** Profiel opnieuw laden (bv. na een wijziging aan evenementen of het eigen account). */
  naVerandering: () => void;
}

export interface DashboardPagina {
  /** Pad zonder slash op het einde; groepen in de regex komen als `m` mee naar `toon`. */
  patroon: RegExp;
  /** Recht dat nodig is (zie de manifesten in backend/src/modules); zonder = elke aangemelde medewerker. */
  recht?: string;
  toon: (m: RegExpMatchArray, c: PaginaContext) => ReactNode;
}

export interface MenuItem {
  href: string;
  label: string;
  /** Plaats in het menu (laag = bovenaan). */
  volgorde: number;
  recht?: string;
  /** Is dit menu-item actief voor dit pad? */
  actief: (pad: string) => boolean;
}

export interface DashboardModule {
  id: string;
  menu?: MenuItem[];
  paginas: DashboardPagina[];
}

const EV = '([A-Za-z0-9-]{1,64})';

export const DASHBOARD_MODULES: DashboardModule[] = [
  {
    id: 'kern',
    menu: [
      { href: '/dashboard/contacten', label: 'Contacten', volgorde: 18, recht: 'kern.contacten.bekijken', actief: (p) => p.startsWith('/dashboard/contacten') },
      { href: '/dashboard/medewerkers', label: 'Medewerkers', volgorde: 20, recht: 'kern.gebruikers.beheren', actief: (p) => p.startsWith('/dashboard/medewerkers') },
      { href: '/dashboard/account', label: 'Mijn account', volgorde: 90, actief: (p) => p.startsWith('/dashboard/account') },
    ],
    paginas: [
      { patroon: /^\/dashboard\/contacten$/, recht: 'kern.contacten.bekijken', toon: (_m, c) => <Contacten profiel={c.profiel} /> },
      { patroon: /^\/dashboard\/medewerkers$/, recht: 'kern.gebruikers.beheren', toon: (_m, c) => <Medewerkers profiel={c.profiel} /> },
      { patroon: /^\/dashboard\/medewerkers\/rechten$/, recht: 'kern.gebruikers.beheren', toon: () => <RollenRechten /> },
      { patroon: /^\/dashboard\/account$/, toon: (_m, c) => <Account profiel={c.profiel} naVerandering={c.naVerandering} /> },
      { patroon: /^\/dashboard\/help(?:\/([a-z]+))?(?:\/([a-z]+))?$/, toon: (m) => <Help handleidingId={m[1]} stapId={m[2]} /> },
    ],
  },
  {
    id: 'evenementen',
    menu: [
      { href: '/dashboard', label: 'Evenementen', volgorde: 10, actief: (p) => p === '/dashboard' || p.startsWith('/dashboard/evenementen') || p.startsWith('/dashboard/importeren') },
      { href: '/dashboard/privacy', label: 'Privacy', volgorde: 80, actief: (p) => p.startsWith('/dashboard/privacy') },
    ],
    paginas: [
      { patroon: /^\/dashboard(\/activeren)?$/, toon: (_m, c) => <Evenementen profiel={c.profiel} naVerandering={c.naVerandering} /> },
      { patroon: new RegExp(`^/dashboard/evenementen/${EV}$`), toon: (m, c) => <Instellingen evenementId={m[1]} naVerandering={c.naVerandering} /> },
      { patroon: /^\/dashboard\/privacy$/, toon: (_m, c) => <Privacy profiel={c.profiel} /> },
      { patroon: new RegExp(`^/dashboard/evenementen/${EV}/aanwezigheid$`), recht: 'evenementen.overzicht_aanwezigen', toon: (m, c) => <Aanwezigheid key={m[1]} evenementId={m[1]} profiel={c.profiel} /> },
      { patroon: new RegExp(`^/dashboard/evenementen/${EV}/sessiegevers$`), toon: (m, c) => <Sessiegevers key={m[1]} evenementId={m[1]} profiel={c.profiel} /> },
    ],
  },
  {
    id: 'rapporten',
    paginas: [{ patroon: new RegExp(`^/dashboard/evenementen/${EV}/rapporten$`), toon: (m, c) => <Rapporten key={m[1]} evenementId={m[1]} profiel={c.profiel} /> }],
  },
  {
    id: 'etiketten',
    paginas: [{ patroon: new RegExp(`^/dashboard/evenementen/${EV}/etiketten$`), toon: (m) => <Etiketten key={m[1]} evenementId={m[1]} /> }],
  },
  {
    id: 'meldingen',
    menu: [{ href: '/dashboard/meldingen', label: 'Meldingen', volgorde: 30, recht: 'meldingen.beheren', actief: (p) => p.startsWith('/dashboard/meldingen') }],
    paginas: [{ patroon: /^\/dashboard\/meldingen$/, recht: 'meldingen.beheren', toon: () => <Meldingen /> }],
  },
  {
    id: 'voorinschrijvingen',
    menu: [{ href: '/dashboard/voorinschrijvingen', label: 'Voorinschrijvingen', volgorde: 15, recht: 'voorinschrijvingen.beheren', actief: (p) => p.startsWith('/dashboard/voorinschrijvingen') }],
    paginas: [{ patroon: /^\/dashboard\/voorinschrijvingen$/, recht: 'voorinschrijvingen.beheren', toon: (_m, c) => <Voorinschrijvingen profiel={c.profiel} /> }],
  },
  {
    id: 'historiek',
    // Geen menu-item: de knop Importeren staat rechtsboven bij Evenementen.
    paginas: [
      { patroon: /^\/dashboard\/importeren$/, toon: (_m, c) => <Importeren profiel={c.profiel} naVerandering={c.naVerandering} /> },
      { patroon: new RegExp(`^/dashboard/evenementen/${EV}/overzicht$`), recht: 'historiek.bekijken', toon: (m, c) => <EvenementOverzicht key={m[1]} evenementId={m[1]} profiel={c.profiel} /> },
    ],
  },
  {
    id: 'mailsjablonen',
    menu: [{ href: '/dashboard/mailteksten', label: 'Mailteksten', volgorde: 40, recht: 'mailsjablonen.beheren', actief: (p) => p.startsWith('/dashboard/mailteksten') }],
    paginas: [{ patroon: /^\/dashboard\/mailteksten$/, recht: 'mailsjablonen.beheren', toon: () => <Mailteksten /> }],
  },
];
