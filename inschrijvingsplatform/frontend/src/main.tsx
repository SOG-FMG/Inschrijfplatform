import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeldKnop } from './components/MeldKnop';
import { BeheerPagina } from './pages/BeheerPagina';
import { CheckinPagina } from './pages/CheckinPagina';
import { LesPagina, SessiegeverPagina } from './pages/SessiegeverPagina';
import { InschrijfPagina } from './pages/InschrijfPagina';
import { VoorinschrijfPagina } from './pages/VoorinschrijfPagina';
import { Dashboard } from './dashboard/Dashboard';
import { installeerLogboek } from './services/logboek';
import './styles.css';

const STANDAARD = (import.meta.env.VITE_STANDAARD_EVENEMENT as string | undefined) || 'fmg-infodagen-2027';

installeerLogboek();

/**
 * Minimale routering: /beheer/<token> (ouders), /checkin/<token> (QR-code: uitleg, of het scanscherm voor het onthaal),
 * /sessiegever en /les/<sessie> (sessiegevers en de QR-code op de klaslijst), /dashboard (beheer; /medewerkers = oud adres), /voorinschrijven/<slug> of /<evenement-slug>. */
function App() {
  const delen = location.pathname.split('/').filter(Boolean);
  if (delen[0] === 'beheer' && delen[1]) return <BeheerPagina token={delen[1]} />;
  if (delen[0] === 'checkin' && delen[1]) return <CheckinPagina token={delen[1]} />;
  if (delen[0] === 'sessiegever') return <SessiegeverPagina />;
  if (delen[0] === 'les' && delen[1]) return <LesPagina sessieId={delen[1]} />;
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
