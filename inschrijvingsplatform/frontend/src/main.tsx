import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeldKnop } from './components/MeldKnop';
import { BeheerPagina } from './pages/BeheerPagina';
import { InschrijfPagina } from './pages/InschrijfPagina';
import { Medewerkers } from './pages/Medewerkers';
import { installeerLogboek } from './services/logboek';
import './styles.css';

const STANDAARD = (import.meta.env.VITE_STANDAARD_EVENEMENT as string | undefined) || 'fmg-infodagen-2027';

installeerLogboek();

/** Minimale routering: /beheer/<token> (ouders), /medewerkers (aanmelden en beheer) of /<evenement-slug>. */
function App() {
  const delen = location.pathname.split('/').filter(Boolean);
  if (delen[0] === 'beheer' && delen[1]) return <BeheerPagina token={delen[1]} />;
  if (delen[0] === 'medewerkers') return <Medewerkers />;
  return <InschrijfPagina slug={delen[0] || STANDAARD} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MeldKnop />
  </StrictMode>,
);
