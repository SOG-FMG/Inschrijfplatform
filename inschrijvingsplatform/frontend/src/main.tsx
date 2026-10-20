import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MeldKnop } from './components/MeldKnop';
import { BeheerPagina } from './pages/BeheerPagina';
import { InschrijfPagina } from './pages/InschrijfPagina';
import { installeerLogboek } from './services/logboek';
import './styles.css';

const STANDAARD = (import.meta.env.VITE_STANDAARD_EVENEMENT as string | undefined) || 'fmg-infodagen-2027';

installeerLogboek();

/** Minimale routering: /beheer/<token> of /<evenement-slug>. */
function App() {
  const delen = location.pathname.split('/').filter(Boolean);
  if (delen[0] === 'beheer' && delen[1]) return <BeheerPagina token={delen[1]} />;
  return <InschrijfPagina slug={delen[0] || STANDAARD} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <MeldKnop />
  </StrictMode>,
);
