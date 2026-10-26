import { useState, type ReactNode } from 'react';
import type { InstellingSoort } from '../../services/beheerApi';
import { Venster } from '../ui';
import { Formulier, type Groep } from './Formulier';
import { type Gemeen, hoofdletter, ID, NIEUWNAAM, type Rij, SOORTNAAM, TITELKOLOM, veldVan, VeldInvoer, type Wijzigingen } from './velden';

/**
 * Eén soort onderdelen in een tabel. De kolommen die je vaak aanpast (naam, lokaal, leerkracht,
 * maximum) pas je rechtstreeks in de cel aan; bovenaan de pagina staat dan één knop Bewaren.
 * Al de rest van het schema staat achter "Meer…", samen met Verwijderen.
 */

/** Een kolom is een veld uit het schema, of eigen inhoud (bv. het aantal ingeschrevenen). */
export type Kolom =
  | { veld: string; kop?: string; breedte?: string }
  | { kop: ReactNode; cel: (rij: Rij) => ReactNode; getal?: boolean; breedte?: string };

const isVeldKolom = (k: Kolom): k is { veld: string; kop?: string; breedte?: string } => 'veld' in k;

interface TabelProps {
  soort: InstellingSoort;
  rijen: Rij[];
  kolommen: Kolom[];
  gemeen: Gemeen;
  wijz: Wijzigingen;
  /** Kop boven de tabel, met eventueel knoppen ernaast. */
  titel?: ReactNode;
  acties?: ReactNode;
  /** Knoppen per rij, vóór "Meer…". */
  rijActies?: (rij: Rij) => ReactNode;
  /** Waaronder een nieuw onderdeel komt; zonder dit is er geen knop om toe te voegen. */
  ouderId?: string;
  /** Groepen voor het volledige formulier achter "Meer…". */
  groepen?: Groep[];
  /** Tekst als er nog niets is. */
  leeg?: ReactNode;
  /**
   * Waar deze tabel staat, bv. "Voormiddag Keuzelesje 1". Komt in de naam van elk veld, zodat een
   * schermlezer twee sessies met dezelfde titel in verschillende blokken toch kan onderscheiden.
   */
  context?: string;
}

export function Tabel({ soort, rijen, kolommen, gemeen, wijz, titel, acties, rijActies, ouderId, groepen, leeg, context }: TabelProps) {
  // Enkel het id bijhouden: na opslaan komen de gegevens opnieuw binnen en volgt het venster mee.
  const [bewerkId, setBewerkId] = useState<string | null>(null);
  const [nieuw, setNieuw] = useState(false);
  const bewerk = rijen.find((r) => String(r[ID[soort]]) === bewerkId) ?? null;
  const naam = (rij: Rij) => String(rij[TITELKOLOM[soort]] ?? '');
  const kolommenTotaal = kolommen.length + (gemeen.kanSchrijven ? 1 : 0);

  return (
    <div className="it-tabel">
      {(titel || acties) && (
        <div className="it-tabel__kop">
          {titel && <h4>{titel}</h4>}
          {acties && <span className="it-tabel__acties">{acties}</span>}
        </div>
      )}
      <div className="d-tabelvak">
        <table className="d-tabel d-tabel--compact">
          <thead>
            <tr>
              {kolommen.map((k, i) => {
                const v = isVeldKolom(k) ? veldVan(gemeen.schema, soort, k.veld) : null;
                return (
                  <th key={i} style={k.breedte ? { width: k.breedte } : undefined} className={!isVeldKolom(k) && k.getal ? 'getal' : undefined}>
                    {k.kop ?? v?.label ?? ''}
                  </th>
                );
              })}
              {gemeen.kanSchrijven && <th className="it-kol-acties">Acties</th>}
            </tr>
          </thead>
          <tbody>
            {rijen.length === 0 && (
              <tr>
                <td colSpan={kolommenTotaal} className="d-klein">{leeg ?? `Nog geen ${SOORTNAAM[soort]}.`}</td>
              </tr>
            )}
            {rijen.map((rij) => (
              <tr key={String(rij[ID[soort]])}>
                {kolommen.map((k, i) => {
                  if (!isVeldKolom(k)) {
                    return <td key={i} className={k.getal ? 'getal' : undefined}>{k.cel(rij)}</td>;
                  }
                  const v = veldVan(gemeen.schema, soort, k.veld);
                  if (!v) return <td key={i} />;
                  const fout = wijz.fout(soort, rij, v.naam);
                  return (
                    <td key={i} className={`it-cel it-cel--${v.type}${wijz.anders(soort, rij, v.naam) ? ' it-cel--anders' : ''}${fout ? ' it-cel--fout' : ''}`}>
                      <VeldInvoer
                        v={v}
                        waarde={wijz.waarde(soort, rij, v)}
                        onWijzig={(w) => wijz.zet(soort, rij, v, w)}
                        opties={gemeen.opties}
                        alleenLezen={!gemeen.kanSchrijven}
                        label={`${k.kop ?? v.label} van ${naam(rij)}${context ? ` — ${context}` : ''}`}
                        fout={!!fout}
                      />
                      {fout && <span className="iv__fout">{fout}</span>}
                    </td>
                  );
                })}
                {gemeen.kanSchrijven && (
                  <td className="d-acties">
                    {rijActies?.(rij)}
                    <button type="button" className="d-link" onClick={() => setBewerkId(String(rij[ID[soort]]))}>Meer…</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gemeen.kanSchrijven && ouderId && (
        <button type="button" className="d-link nieuw-knop" onClick={() => setNieuw(true)}>+ {hoofdletter(SOORTNAAM[soort])} toevoegen</button>
      )}

      {bewerk && (
        <Venster titel={`${naam(bewerk)} — alle instellingen`} onSluit={() => setBewerkId(null)} breed>
          <Formulier soort={soort} rij={bewerk} gemeen={gemeen} groepen={groepen} onKlaar={gemeen.onKlaar} onAnnuleer={() => setBewerkId(null)} />
        </Venster>
      )}
      {nieuw && ouderId && (
        <Venster titel={NIEUWNAAM[soort]} onSluit={() => setNieuw(false)} breed>
          <Formulier
            soort={soort}
            rij={null}
            ouderId={ouderId}
            gemeen={gemeen}
            groepen={groepen}
            onAnnuleer={() => setNieuw(false)}
            onKlaar={() => {
              setNieuw(false);
              gemeen.onKlaar();
            }}
          />
        </Venster>
      )}
    </div>
  );
}
