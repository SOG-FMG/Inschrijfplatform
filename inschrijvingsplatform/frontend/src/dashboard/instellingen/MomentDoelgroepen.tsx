import { useState } from 'react';
import { instellingenApi } from '../../services/beheerApi';
import { datum, foutTekst, Melding } from '../ui';
import type { Gemeen, Rij } from './velden';

/**
 * Subtabblad per doelgroep in het tabblad Momenten: welke momenten en tijdsblokken deze doelgroep op het
 * formulier ziet.
 *
 * Drie standen (zie backend/src/modules/evenementen/doelgroepmomenten.ts):
 *   alle   alle momenten van het evenement
 *   eigen  enkel wat je hier aanvinkt; vink je niets aan, dan geldt alsnog alles — een half ingestelde
 *          doelgroep mag het formulier niet leegmaken, en dat staat ook op het scherm
 *   volgt  neemt over van een andere doelgroep, maar één stap diep
 *
 * Bewaart apart van de bewaarbalk bovenaan: die hoort bij de tabellen met de momenten zelf.
 */

export function MomentDoelgroepen({
  doelgroep,
  doelgroepen,
  dagen,
  selectie,
  gemeen,
  onKlaar,
}: {
  doelgroep: Rij;
  doelgroepen: Rij[];
  dagen: Rij[];
  selectie: { dagdelen: string[]; tijdsblokken: string[] };
  gemeen: Gemeen;
  onKlaar: () => void;
}) {
  const [modus, setModus] = useState(String(doelgroep.momenten_modus ?? 'alle'));
  const [volgt, setVolgt] = useState(String(doelgroep.volgt_doelgroep_id ?? ''));
  const [dagdelen, setDagdelen] = useState(new Set(selectie.dagdelen));
  const [blokken, setBlokken] = useState(new Set(selectie.tijdsblokken));
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');

  const kiestLesjes = doelgroep.sessiekeuze === 1 || doelgroep.sessiekeuze === true;
  const anderen = doelgroepen.filter((g) => g.doelgroep_id !== doelgroep.doelgroep_id && g.momenten_modus !== 'volgt');

  const wip = (set: Set<string>, zet: (s: Set<string>) => void, id: string) => {
    const nieuw = new Set(set);
    if (!nieuw.delete(id)) nieuw.add(id);
    zet(nieuw);
  };

  const bewaar = async () => {
    setBezig(true);
    setFout('');
    setMelding('');
    try {
      await instellingenApi.wijzig('doelgroep', String(doelgroep.doelgroep_id), {
        momenten_modus: modus,
        volgt_doelgroep_id: modus === 'volgt' ? volgt : null,
      });
      if (modus === 'eigen') {
        await instellingenApi.doelgroepMomenten(String(doelgroep.doelgroep_id), [...dagdelen], [...blokken]);
      }
      setMelding('Bewaard.');
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  };

  return (
    <div className="d-kaart">
      <h2>Momenten voor {String(doelgroep.naam)}</h2>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {melding && <Melding soort="ok">{melding}</Melding>}

      <div className="d-veld">
        <label htmlFor="md-modus">Welke momenten ziet deze doelgroep?</label>
        <select id="md-modus" value={modus} disabled={!gemeen.kanSchrijven || bezig} onChange={(e) => setModus(e.target.value)}>
          <option value="alle">Alle momenten van het evenement</option>
          <option value="eigen">Een eigen keuze</option>
          <option value="volgt">Zelfde als een andere doelgroep</option>
        </select>
      </div>

      {modus === 'volgt' && (
        <div className="d-veld">
          <label htmlFor="md-volgt">Zelfde als</label>
          <select id="md-volgt" value={volgt} disabled={!gemeen.kanSchrijven || bezig} onChange={(e) => setVolgt(e.target.value)}>
            <option value="">— kies een doelgroep —</option>
            {anderen.map((g) => (
              <option key={String(g.doelgroep_id)} value={String(g.doelgroep_id)}>{String(g.naam)}</option>
            ))}
          </select>
          <span className="d-veld__hulp">
            Een doelgroep die zelf een andere volgt, staat niet in deze lijst: volgen gaat maar één stap diep.
          </span>
        </div>
      )}

      {modus === 'eigen' && (
        <>
          {dagdelen.size === 0 && blokken.size === 0 && (
            <Melding>
              Nog niets aangevinkt. Zolang je niets aanvinkt, ziet deze doelgroep <strong>alle</strong> momenten — zo valt
              het formulier niet leeg door een half ingestelde doelgroep.
            </Melding>
          )}
          {!kiestLesjes && (
            <Melding>
              Deze doelgroep kiest geen lesjes (<em>Kiest lesjes</em> staat uit), dus de tijdsblokken staan hier niet.
              Ze kiest enkel een moment.
            </Melding>
          )}
          {dagen.map((dag) => (
            <section key={String(dag.dag_id)} className="md-dag">
              <h3>
                {String(dag.naam)} <span className="d-klein">{datum(dag.datum)}</span>
              </h3>
              {(dag.dagdelen as Rij[]).length === 0 && <p className="d-klein">Geen momenten op deze dag.</p>}
              {(dag.dagdelen as Rij[]).map((dd) => (
                <div key={String(dd.dagdeel_id)} className="md-moment">
                  <label className="d-keuze">
                    <input
                      type="checkbox"
                      checked={dagdelen.has(String(dd.dagdeel_id))}
                      disabled={!gemeen.kanSchrijven || bezig}
                      onChange={() => wip(dagdelen, setDagdelen, String(dd.dagdeel_id))}
                    />
                    <strong>{String(dd.naam)}</strong> <span className="d-klein">{String(dd.start_uur)}–{String(dd.eind_uur)}</span>
                  </label>
                  {kiestLesjes && (
                    <div className="md-blokken">
                      {(dd.tijdsblokken as Rij[]).map((t) => (
                        <label key={String(t.tijdsblok_id)} className="d-keuze">
                          <input
                            type="checkbox"
                            checked={blokken.has(String(t.tijdsblok_id))}
                            disabled={!gemeen.kanSchrijven || bezig}
                            onChange={() => wip(blokken, setBlokken, String(t.tijdsblok_id))}
                          />
                          {String(t.naam)} <span className="d-klein">{String(t.start_uur)}–{String(t.eind_uur)}</span>
                          {t.zichtbaar === 0 && <span className="d-klein"> · verborgen</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      {gemeen.kanSchrijven && (
        <div className="d-knoppen d-knoppen--links">
          <button type="button" className="d-knop" disabled={bezig} onClick={bewaar}>{bezig ? 'Bezig…' : 'Bewaren'}</button>
        </div>
      )}
    </div>
  );
}
