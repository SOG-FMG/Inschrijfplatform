import type { ReactNode } from 'react';
import type { Profiel } from '../services/beheerApi';
import { Account } from './Account';
import { Etiketten } from './Etiketten';
import { Evenementen } from './Evenementen';
import { Instellingen } from './Instellingen';
import { Medewerkers } from './Medewerkers';
import { Meldingen } from './Meldingen';
import { Privacy } from './Privacy';
import { Rapporten } from './Rapporten';

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
      { href: '/dashboard/medewerkers', label: 'Medewerkers', volgorde: 20, recht: 'kern.gebruikers.beheren', actief: (p) => p.startsWith('/dashboard/medewerkers') },
      { href: '/dashboard/account', label: 'Mijn account', volgorde: 90, actief: (p) => p.startsWith('/dashboard/account') },
    ],
    paginas: [
      { patroon: /^\/dashboard\/medewerkers$/, recht: 'kern.gebruikers.beheren', toon: (_m, c) => <Medewerkers profiel={c.profiel} /> },
      { patroon: /^\/dashboard\/account$/, toon: (_m, c) => <Account profiel={c.profiel} naVerandering={c.naVerandering} /> },
    ],
  },
  {
    id: 'evenementen',
    menu: [
      { href: '/dashboard', label: 'Evenementen', volgorde: 10, actief: (p) => p === '/dashboard' || p.startsWith('/dashboard/evenementen') },
      { href: '/dashboard/privacy', label: 'Privacy', volgorde: 80, actief: (p) => p.startsWith('/dashboard/privacy') },
    ],
    paginas: [
      { patroon: /^\/dashboard(\/activeren)?$/, toon: (_m, c) => <Evenementen profiel={c.profiel} naVerandering={c.naVerandering} /> },
      { patroon: new RegExp(`^/dashboard/evenementen/${EV}$`), toon: (m, c) => <Instellingen evenementId={m[1]} naVerandering={c.naVerandering} /> },
      { patroon: /^\/dashboard\/privacy$/, toon: (_m, c) => <Privacy profiel={c.profiel} /> },
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
];
