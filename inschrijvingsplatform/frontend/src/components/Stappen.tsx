interface Props {
  stappen: string[];
  huidig: number;
  onGaNaar: (i: number) => void;
}

/** Voortgangsbalk. Voltooide stappen zijn aanklikbaar om terug te keren. */
export function Stappen({ stappen, huidig, onGaNaar }: Props) {
  return (
    <nav aria-label="Voortgang" className="stappen">
      <ol>
        {stappen.map((s, i) => {
          const status = i < huidig ? 'klaar' : i === huidig ? 'actief' : 'later';
          return (
            <li key={s} className={`stap stap--${status}`} aria-current={i === huidig ? 'step' : undefined}>
              {i < huidig ? (
                <button type="button" onClick={() => onGaNaar(i)}>
                  <span className="stap__nr" aria-hidden="true">✓</span>
                  <span className="stap__naam">{s}</span>
                  <span className="sr-only"> (voltooid, wijzigen)</span>
                </button>
              ) : (
                <span>
                  <span className="stap__nr" aria-hidden="true">{i + 1}</span>
                  <span className="stap__naam">{s}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="stappen__mobiel" aria-hidden="true">
        Stap {huidig + 1} van {stappen.length}: <strong>{stappen[huidig]}</strong>
      </p>
    </nav>
  );
}
