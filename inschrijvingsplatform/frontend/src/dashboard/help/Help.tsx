import { useEffect, useRef } from 'react';
import { Link } from '../ui';
import { HANDLEIDINGEN, HelpEvenement } from './handleidingen';

/**
 * Handleiding (/dashboard/help/<handleiding>/<stap>): links de handleidingen en de stappen om te doorlopen, rechts
 * de uitleg met vorige en volgende. "Help bij deze pagina" (zijbalk) opent hier de stap over die pagina, in een
 * nieuw tabblad; ?evenement= bewaart het evenement, zodat de links naar dat evenement gaan.
 */
export function Help({ handleidingId, stapId }: { handleidingId?: string; stapId?: string }) {
  const evenement = new URLSearchParams(location.search).get('evenement');
  const zoek = evenement ? `?evenement=${encodeURIComponent(evenement)}` : '';
  const h = HANDLEIDINGEN.find((x) => x.id === handleidingId);
  const index = h ? Math.max(0, h.stappen.findIndex((s) => s.id === stapId)) : -1;
  const stap = h?.stappen[index];
  const uitleg = useRef<HTMLElement>(null);
  const url = (hid: string, sid?: string) => `/dashboard/help/${hid}${sid ? `/${sid}` : ''}${zoek}`;

  // Bij een andere stap: de uitleg bovenaan tonen en de focus erop (schermlezers lezen de nieuwe stap voor).
  useEffect(() => {
    uitleg.current?.focus({ preventScroll: true });
  }, [handleidingId, stapId]);

  return (
    <HelpEvenement.Provider value={evenement}>
      <header className="d-paginakop">
        <div>
          <h1>Handleiding</h1>
          <p className="d-sub">Kies links een onderwerp en doorloop de stappen. Links in de uitleg openen de pagina in een nieuw tabblad.</p>
        </div>
      </header>
      <div className="help">
        <nav className="help__stappen" aria-label="Handleidingen">
          {HANDLEIDINGEN.map((x) => (
            <div key={x.id} className={`help__groep${x.id === h?.id ? ' actief' : ''}`}>
              <Link href={url(x.id, x.stappen[0].id)} className="help__titel">{x.titel}</Link>
              <span className="d-klein">{x.voorWie}</span>
              {x.id === h?.id && (
                <ol>
                  {x.stappen.map((s, i) => (
                    <li key={s.id} className={i === index ? 'actief' : i < index ? 'gedaan' : undefined}>
                      <Link href={url(x.id, s.id)}>{s.titel}</Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </nav>

        <article className="help__uitleg d-kaart" ref={uitleg} tabIndex={-1} aria-live="polite">
          {!h || !stap ? (
            <>
              <h2>Waarmee kunnen we helpen?</h2>
              <div className="help__kaarten">
                {HANDLEIDINGEN.map((x) => (
                  <Link key={x.id} href={url(x.id, x.stappen[0].id)} className="help__kaart">
                    <strong>{x.titel}</strong>
                    <span className="d-klein">{x.voorWie} · {x.stappen.length} stappen</span>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="d-klein">{h.titel} · stap {index + 1} van {h.stappen.length}</p>
              <h2>{stap.titel}</h2>
              <div className="help__tekst">{stap.inhoud}</div>
              <div className="help__volgende">
                {index > 0 ? <Link href={url(h.id, h.stappen[index - 1].id)} className="d-knop d-knop--secundair">← {h.stappen[index - 1].titel}</Link> : <span />}
                {index < h.stappen.length - 1
                  ? <Link href={url(h.id, h.stappen[index + 1].id)} className="d-knop">{h.stappen[index + 1].titel} →</Link>
                  : <Link href={url('')} className="d-knop d-knop--secundair">Klaar: andere onderwerpen</Link>}
              </div>
            </>
          )}
        </article>
      </div>
    </HelpEvenement.Provider>
  );
}
