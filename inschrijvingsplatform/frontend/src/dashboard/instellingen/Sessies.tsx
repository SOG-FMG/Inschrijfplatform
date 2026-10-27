import { useState } from 'react';
import { datum, Melding } from '../ui';
import { KopieerSessies, type SessieKopie } from './Kopieren';
import { type Groep } from './Formulier';
import { Tabel, type Kolom } from './Tabel';
import type { Gemeen, Rij, Wijzigingen } from './velden';

/**
 * Tabblad Sessies: het werk dat je het vaakst doet. Je klikt een dag open en krijgt per moment
 * een tabel per tijdsblok, met naam, lokaal, leerkracht, ingeschreven en maximum naast elkaar.
 * Naam, lokaal, leerkracht en maximum pas je rechtstreeks in de tabel aan.
 */

const GROEPEN: Groep[] = [
  { titel: 'De sessie', velden: ['titel', 'code', 'locatie_id', 'lesgever_contact_id', 'lesgever', 'lesgever_email', 'capaciteit', 'volgorde'] },
  { titel: 'Voor wie', velden: ['doelgroep_id', 'soort_id', 'uniek_per_deelnemer'] },
  { titel: 'Inschrijven', velden: ['status', 'zichtbaar', 'wachtlijst_toegelaten', 'volzet_weergave'] },
  { titel: 'Op het formulier', velden: ['beschrijving', 'kleur'], dicht: true },
  { titel: 'Intern', velden: ['opmerkingen'], dicht: true },
];

const totaal = (rijen: Rij[], neem: (r: Rij) => number) => rijen.reduce((n, r) => n + neem(r), 0);

/** De kolommen die je vaak aanpast; de kopieerknop staat in de kolom Acties, naast "Meer…". */
const KOLOMMEN: Kolom[] = [
  { veld: 'titel', kop: 'Naam', breedte: '30%' },
  { veld: 'locatie_id', kop: 'Lokaal', breedte: '18%' },
  { veld: 'lesgever_contact_id', kop: 'Leerkracht', breedte: '20%' },
  { kop: 'Ingeschreven', getal: true, breedte: '9em', cel: (s) => <Ingeschreven rij={s} /> },
  { veld: 'capaciteit', kop: 'Maximum', breedte: '7em' },
];

/** "18 / 20" of "18" als er geen maximum is, met de wachtlijst eronder. */
function Ingeschreven({ rij }: { rij: Rij }) {
  const { bevestigd, wachtlijst } = rij.ingeschreven as { bevestigd: number; wachtlijst: number };
  const vol = rij.capaciteit != null && bevestigd >= rij.capaciteit;
  return (
    <>
      <span className={vol ? 'd-nee' : undefined}>{bevestigd}{rij.capaciteit != null && ` / ${rij.capaciteit}`}</span>
      {wachtlijst > 0 && <div className="d-klein">{wachtlijst} wachtlijst</div>}
    </>
  );
}

export function Sessies({ dagen, gemeen, wijz }: { dagen: Rij[]; gemeen: Gemeen; wijz: Wijzigingen }) {
  const [kopie, setKopie] = useState<SessieKopie | null>(null);
  // De eerste dag staat open; de rest klap je zelf open.
  const [open, setOpen] = useState<string[]>(() => dagen.slice(0, 1).map((d) => d.dag_id));

  if (!dagen.length) {
    return <Melding>Er zijn nog geen dagen. Voeg eerst een dag toe bij <strong>Dagen</strong> en een moment bij <strong>Momenten</strong>.</Melding>;
  }

  return (
    <>
      {dagen.map((dag) => {
        const ingeschreven = totaal(dag.dagdelen, (dd) => dd.ingeschreven.bevestigd);
        const sessies = totaal(dag.dagdelen, (dd) => totaal(dd.tijdsblokken, (t) => t.sessies.length));
        return (
          <details
            key={dag.dag_id}
            className="it-dag"
            open={open.includes(dag.dag_id)}
            onToggle={(e) => {
              const aan = (e.currentTarget as HTMLDetailsElement).open;
              setOpen((oud) => (aan ? [...new Set([...oud, dag.dag_id])] : oud.filter((x) => x !== dag.dag_id)));
            }}
          >
            <summary>
              <span className="it-dag__naam">{dag.naam}</span>
              <span className="d-klein">
                {datum(dag.datum)} · {dag.dagdelen.length} moment(en) · {sessies} sessie(s) · {ingeschreven} ingeschreven
                {dag.status !== 'actief' && ` · ${dag.status}`}
              </span>
            </summary>
            {dag.dagdelen.length === 0 && <Melding>Nog geen momenten op deze dag. Voeg er een toe bij <strong>Momenten</strong>.</Melding>}
            {dag.dagdelen.map((dagdeel: Rij) => (
              <section key={dagdeel.dagdeel_id} className="it-dagdeel">
                <h3>
                  {dagdeel.naam}
                  <span className="d-klein">
                    {dagdeel.start_uur}–{dagdeel.eind_uur} · {dagdeel.ingeschreven.bevestigd}
                    {dagdeel.capaciteit != null && ` / ${dagdeel.capaciteit}`} ingeschreven
                    {dagdeel.status !== 'actief' && ` · ${dagdeel.status}`}
                  </span>
                </h3>
                {dagdeel.tijdsblokken.length === 0 && <p className="d-klein">Nog geen tijdsblokken in dit moment. Voeg ze toe bij <strong>Momenten</strong>.</p>}
                {dagdeel.tijdsblokken.map((tijdsblok: Rij) => (
                  <Tabel
                    key={tijdsblok.tijdsblok_id}
                    soort="sessie"
                    rijen={tijdsblok.sessies}
                    kolommen={KOLOMMEN}
                    gemeen={gemeen}
                    wijz={wijz}
                    groepen={GROEPEN}
                    volgorde
                    ouderId={tijdsblok.tijdsblok_id}
                    context={`${dagdeel.naam} ${tijdsblok.naam}`}
                    leeg={<>Nog geen sessies in {tijdsblok.naam}.</>}
                    titel={
                      <>
                        {tijdsblok.naam}{' '}
                        <span className="d-klein">
                          {tijdsblok.start_uur}–{tijdsblok.eind_uur} · {tijdsblok.type === 'keuze' ? 'keuze' : 'programma voor iedereen'}
                        </span>
                      </>
                    }
                    acties={
                      gemeen.kanSchrijven &&
                      tijdsblok.sessies.length > 1 && (
                        <button
                          type="button"
                          className="d-knop d-knop--secundair d-knop--klein"
                          onClick={() => setKopie({ sessies: tijdsblok.sessies, tijdsblok, dagdeel, dag })}
                        >
                          Alle sessies kopiëren…
                        </button>
                      )
                    }
                    rijActies={(s) => (
                      <button type="button" className="d-link" title="Deze sessie naar een ander moment kopiëren" onClick={() => setKopie({ sessies: [s], tijdsblok, dagdeel, dag })}>
                        ⧉ Kopiëren
                      </button>
                    )}
                  />
                ))}
              </section>
            ))}
          </details>
        );
      })}
      {kopie && <KopieerSessies kopie={kopie} dagen={dagen} onSluit={() => setKopie(null)} onKlaar={gemeen.onKlaar} />}
    </>
  );
}
