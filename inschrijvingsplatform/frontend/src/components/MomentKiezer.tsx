import type { Evenement } from '../types';

interface Props {
  evenement: Evenement;
  gekozen: string[];
  onWijzig: (dagdelen: string[]) => void;
  fout?: string;
  toonSessiekeuzeInfo: boolean;
  /** Gekozen doelgroep: een moment dat niet voor haar bedoeld is, wordt niet getoond. */
  doelgroepId: string;
}

/** Mag deze doelgroep dit moment of tijdsblok zien? `null` in doelgroepen betekent: iedereen mag. */
export const voorDoelgroep = (doelgroepen: string[] | null | undefined, doelgroepId: string) =>
  !doelgroepen || !doelgroepId || doelgroepen.includes(doelgroepId);

export function plaatsenTekst(vrij: number | null, capaciteit: number | null): string | null {
  if (capaciteit === null || vrij === null) return null;
  if (vrij === 0) return 'Volzet';
  if (vrij <= 5) return `Nog ${vrij} ${vrij === 1 ? 'plaats' : 'plaatsen'}`;
  return null;
}

/** Keuze van dag + dagdeel. Eén keuze (rondjes) of meerdere (vinkjes) volgens maxDagdelen. */
export function MomentKiezer({ evenement, gekozen, onWijzig, fout, toonSessiekeuzeInfo, doelgroepId }: Props) {
  const meerdere = evenement.maxDagdelen > 1;
  const dagdelenVan = (dag: Evenement['dagen'][number]) => dag.dagdelen.filter((dd) => voorDoelgroep(dd.doelgroepen, doelgroepId));

  const wissel = (id: string) => {
    if (!meerdere) return onWijzig([id]);
    if (gekozen.includes(id)) return onWijzig(gekozen.filter((x) => x !== id));
    if (gekozen.length < evenement.maxDagdelen) onWijzig([...gekozen, id]);
  };

  return (
    <fieldset className={`veld${fout ? ' veld--fout' : ''}`} id="veld-dagdelen" aria-describedby={fout ? 'dagdelen-fout' : undefined}>
      <legend>
        {meerdere ? `Kies je moment(en) – maximaal ${evenement.maxDagdelen}` : 'Kies de datum en het dagdeel dat jou past'}
        <span className="verplicht" aria-hidden="true"> *</span>
      </legend>
      {evenement.dagen.filter((dag) => dagdelenVan(dag).length > 0).map((dag) => (
        <div key={dag.id} className="dag">
          <h3 className="dag__naam">{dag.naam}</h3>
          {toonSessiekeuzeInfo && !dag.sessiekeuzeOpen && (
            <p className="info info--klein">Voor deze dag kan je geen onderdelen meer kiezen. Je kan wel nog inschrijven voor een moment.</p>
          )}
          <div className="kaarten">
            {dagdelenVan(dag).map((dd) => {
              const vol = dd.capaciteit !== null && dd.vrij === 0;
              const actief = gekozen.includes(dd.id);
              const plaatsen = plaatsenTekst(dd.vrij, dd.capaciteit);
              return (
                <label key={dd.id} className={`kaart${actief ? ' kaart--actief' : ''}${vol ? ' kaart--vol' : ''}`}>
                  <input
                    type={meerdere ? 'checkbox' : 'radio'}
                    name="dagdeel"
                    value={dd.id}
                    checked={actief}
                    disabled={vol}
                    onChange={() => wissel(dd.id)}
                  />
                  <span className="kaart__inhoud">
                    <span className="kaart__titel">{dd.naam}</span>
                    <span className="kaart__sub">
                      {dd.startUur} – {dd.eindUur}
                    </span>
                    {plaatsen && <span className={`badge${vol ? ' badge--vol' : ' badge--bijna'}`}>{plaatsen}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {fout && <p className="foutmelding" id="dagdelen-fout">{fout}</p>}
    </fieldset>
  );
}
