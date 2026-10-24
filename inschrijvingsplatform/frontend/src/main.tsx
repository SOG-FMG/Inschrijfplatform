import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeldKnop } from './components/MeldKnop';
import { BeheerPagina } from './pages/BeheerPagina';
import { CheckinPagina } from './pages/CheckinPagina';
import { InschrijfPagina } from './pages/InschrijfPagina';
import { VoorinschrijfPagina } from './pages/VoorinschrijfPagina';
import { Dashboard } from './dashboard/Dashboard';
import { installeerLogboek } from './services/logboek';
import './styles.css';

const STANDAARD = (import.meta.env.VITE_STANDAARD_EVENEMENT as string | undefined) || 'fmg-infodagen-2027';

installeerLogboek();

/** Minimale routering: /beheer/<token> (ouders), /checkin/<token> (QR-code), /dashboard (beheer; /medewerkers = oud adres), /voorinschrijven/<slug> of /<evenement-slug>. */
function App() {
  const delen = location.pathname.split('/').filter(Boolean);
  if (delen[0] === 'beheer' && delen[1]) return <BeheerPagina token={delen[1]} />;
  if (delen[0] === 'checkin' && delen[1]) return <CheckinPagina />;
  if (delen[0] === 'dashboard' || delen[0] === 'medewerkers') return <Dashboard />;
  if (delen[0] === 'voorinschrijven' && delen[1]) return <VoorinschrijfPagina slug={delen[1]} />;
  return <InschrijfPagina slug={delen[0] || STANDAARD} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MeldKnop />
  </StrictMode>,
);
