import type { Keuze, Moment } from '../types';

const STATUS: Record<string, string> = { wachtlijst: 'wachtlijst', geannuleerd: 'geannuleerd' };

/** Gedeeld overzicht van momenten en keuzes (controle, bevestiging, zelfbeheer). */
export function Overzicht({ momenten, keuzes }: { momenten: Moment[]; keuzes: Keuze[] }) {
  return (
    <div className="overzicht">
      <ul className="overzicht__lijst">
        {momenten.map((m) => (
          <li key={`${m.dag}-${m.dagdeel}`}>
            <strong>{m.dag} – {m.dagdeel}</strong>
            <span className="overzicht__uur"> {m.startUur} – {m.eindUur}</span>
            {m.status && STATUS[m.status] && <span className="badge"> {STATUS[m.status]}</span>}
          </li>
        ))}
      </ul>
      {keuzes.length > 0 && (
        <ul className="overzicht__lijst overzicht__lijst--keuzes">
          {keuzes.map((k) => (
            <li key={`${k.tijdsblok}-${k.startUur}`}>
              <span className="overzicht__uur">{k.startUur}</span> {k.tijdsblok}: <strong>{k.titel}</strong>
              {k.locatie && <span className="overzicht__lokaal"> · lokaal {k.locatie}</span>}
              {STATUS[k.status] && <span className={`badge${k.status === 'wachtlijst' ? ' badge--bijna' : ''}`}> {STATUS[k.status]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
