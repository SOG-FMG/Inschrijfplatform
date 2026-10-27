import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { instellingenApi } from '../services/beheerApi';
import { ApiFout } from '../types';
import { etiketUrl } from './Etiketten';
import { Formulier, type Groep } from './instellingen/Formulier';
import { KopieerDagdeel } from './instellingen/Kopieren';
import { LokaalOpCode } from './instellingen/LokaalOpCode';
import { Sessies } from './instellingen/Sessies';
import { Tabel, type Kolom } from './instellingen/Tabel';
import { type Gemeen, type Opties, type Rij, type Schema, useWijzigingen } from './instellingen/velden';
import { rapportUrl } from './Rapporten';
import { datum, Link, Melding, STATUSNAAM } from './ui';

/**
 * Instellingen van één evenement (/dashboard/evenementen/<id>), in tabbladen.
 *
 * Sessies staat achteraan maar gaat als eerste open: dat is het werk dat terugkomt (namen, lokalen,
 * leerkrachten, maxima). De tabbladen ervoor stel je meestal één keer in. De formulieren en tabellen
 * worden opgebouwd uit het schema dat de API meestuurt (backend/src/modules/evenementen/instellingen.ts).
 *
 * De oude pagina met alles onder elkaar blijft bestaan op .../instelOud (InstellingenOud.tsx).
 */

const TABS = [
  { id: 'algemeen', label: 'Algemeen' },
  { id: 'doelgroepen', label: 'Doelgroepen' },
  { id: 'dagen', label: 'Dagen' },
  { id: 'momenten', label: 'Momenten' },
  { id: 'lokalen', label: 'Lokalen' },
  { id: 'sessies', label: 'Sessies' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Het evenement heeft veel velden; wat je zelden aanraakt begint ingeklapt. */
const EVENEMENT_GROEPEN: Groep[] = [
  { titel: 'Het evenement', velden: ['titel', 'slug', 'status', 'type_evenement', 'organisator', 'start_datum', 'eind_datum', 'omschrijving'] },
  { titel: 'Inschrijven', velden: ['inschrijving_vanaf', 'inschrijving_tot', 'deelnemer_type', 'max_dagdelen', 'leerjaar_opties', 'voorinschrijving'] },
  { titel: 'Contact, privacy en bewaren', velden: ['contact_email', 'privacy_tekst', 'bewaartermijn_dagen'], dicht: true },
  { titel: 'Huisstijl op het formulier', velden: ['logo', 'logo_hoogte', 'kleur_primair', 'kleur_accent'], dicht: true },
  { titel: 'Interne opmerkingen', velden: ['opmerkingen'], dicht: true },
];

/** "18 / 20", met de wachtlijst eronder. */
function telling(rij: Rij): ReactNode {
  const { bevestigd, wachtlijst } = rij.ingeschreven as { bevestigd: number; wachtlijst: number };
  return (
    <>
      {bevestigd}
      {rij.capaciteit != null && ` / ${rij.capaciteit}`}
      {wachtlijst > 0 && <div className="d-klein">{wachtlijst} wachtlijst</div>}
    </>
  );
}

const DOELGROEP_KOLOMMEN: Kolom[] = [
  { veld: 'naam', breedte: '25%' },
  { veld: 'beschrijving', breedte: '45%' },
  { veld: 'sessiekeuze', breedte: '8em' },
  { veld: 'volgorde', breedte: '6em' },
];

const DAG_KOLOMMEN: Kolom[] = [
  { veld: 'naam', breedte: '28%' },
  { veld: 'datum', breedte: '10em' },
  { veld: 'start_uur', breedte: '7em' },
  { veld: 'eind_uur', breedte: '7em' },
  { veld: 'sessiekeuze_tot', breedte: '13em' },
  { veld: 'status', breedte: '9em' },
  { veld: 'volgorde', breedte: '6em' },
];

const DAGDEEL_KOLOMMEN: Kolom[] = [
  { veld: 'naam', breedte: '28%' },
  { veld: 'start_uur', breedte: '7em' },
  { veld: 'eind_uur', breedte: '7em' },
  { veld: 'capaciteit', kop: 'Maximum', breedte: '7em' },
  { kop: 'Ingeschreven', getal: true, breedte: '9em', cel: telling },
  { veld: 'status', breedte: '9em' },
  { veld: 'volgorde', breedte: '6em' },
];

const LOKAAL_KOLOMMEN: Kolom[] = [
  { veld: 'naam', breedte: '20%' },
  { veld: 'site', breedte: '12%' },
  { veld: 'blok', breedte: '10%' },
  { veld: 'verdieping', breedte: '10%' },
  { veld: 'lokaal', kop: 'Nummer', breedte: '9em' },
  { veld: 'capaciteit', kop: 'Plaatsen', breedte: '7em' },
  { veld: 'faciliteiten', breedte: '22%' },
];

const TIJDSBLOK_KOLOMMEN: Kolom[] = [
  { veld: 'naam', breedte: '26%' },
  { veld: 'type', kop: 'Soort', breedte: '14em' },
  { veld: 'start_uur', breedte: '7em' },
  { veld: 'eind_uur', breedte: '7em' },
  { veld: 'verplicht', breedte: '8em' },
  { veld: 'zichtbaar', breedte: '8em' },
  { veld: 'volgorde', breedte: '6em' },
];

const beginTab = (): Tab => {
  const h = location.hash.replace('#', '');
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'sessies';
};

// ---------------------------------------------------------------------------
export function Instellingen({ evenementId, naVerandering }: { evenementId: string; naVerandering: () => void }) {
  const [data, setData] = useState<any>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(beginTab);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: ReactNode } | null>(null);
  const [kopie, setKopie] = useState<{ dagdeel: Rij; dag: Rij } | null>(null);
  const [opCode, setOpCode] = useState<Rij | null>(null);

  const laad = useCallback(() => {
    instellingenApi
      .lees(evenementId)
      .then((d) => {
        setData(d);
        document.title = `Instellingen – ${d.evenement.titel}`;
      })
      .catch((e) => setFout(e instanceof ApiFout ? e.message : 'Laden mislukt.'));
  }, [evenementId]);
  useEffect(laad, [laad]);

  // Na elke wijziging ook het overzicht (titels, status in de tabel) verversen.
  const herlaad = useCallback(() => {
    laad();
    naVerandering();
  }, [laad, naVerandering]);

  const wijz = useWijzigingen(data?.schema as Schema, herlaad);

  // Niet weggaan met wijzigingen die nog in de tabellen staan.
  useEffect(() => {
    if (!wijz.aantal) return;
    const bij = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', bij);
    return () => removeEventListener('beforeunload', bij);
  }, [wijz.aantal]);

  if (fout) {
    return (
      <div className="instellingen">
        <p><Link href="/dashboard">← Evenementen</Link></p>
        <div className="d-melding d-melding--fout" role="alert">{fout}</div>
      </div>
    );
  }
  if (!data) return <div className="instellingen" aria-busy="true"><p>Laden…</p></div>;

  const ev = data.evenement as Rij;
  const gemeen: Gemeen = { schema: data.schema as Schema, opties: data.opties as Opties, kanSchrijven: data.kanSchrijven, onKlaar: herlaad };

  const kiesTab = (t: Tab) => {
    setTab(t);
    setMelding(null);
    history.replaceState(null, '', `${location.pathname}#${t}`);
  };

  const bewaarAlles = async () => {
    const f = await wijz.bewaar();
    setMelding(f ? { soort: 'fout', tekst: f } : { soort: 'ok', tekst: 'Wijzigingen bewaard.' });
  };

  return (
    <div className="instellingen">
      <nav className="d-kruimel" aria-label="Kruimelpad">
        <Link href="/dashboard">Evenementen</Link> › <span>{ev.titel}</span>
      </nav>
      <header className="d-paginakop">
        <div>
          <h1>
            {ev.titel} <span className={`d-badge d-badge--${ev.status}`}>{STATUSNAAM[ev.status] ?? ev.status}</span>
          </h1>
          <p className="d-sub">
            {datum(ev.start_datum)}
            {ev.eind_datum !== ev.start_datum && ` – ${datum(ev.eind_datum)}`} · /{ev.slug}
            {!data.kanSchrijven && ' · je kan deze instellingen enkel bekijken'}
          </p>
        </div>
        <span className="d-knoppen d-knoppen--links">
          <Link href={rapportUrl(evenementId)} className="d-knop">Rapporten</Link>
          <Link href={etiketUrl(evenementId)} className="d-knop d-knop--secundair">Etiketten</Link>
          <a className="d-knop d-knop--secundair" href={`/${ev.slug}`} target="_blank" rel="noreferrer">Formulier bekijken ↗</a>
        </span>
      </header>

      <div className="d-tabs d-tabs--fiche" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'actief' : undefined} onClick={() => kiesTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {wijz.aantal > 0 && (
        <div className="r-bewaarbalk" role="region" aria-label="Niet bewaarde wijzigingen">
          <span>{wijz.aantal} wijziging(en) nog niet bewaard.</span>
          <button type="button" className="d-knop" disabled={wijz.bezig} onClick={bewaarAlles}>{wijz.bezig ? 'Bezig…' : 'Bewaren'}</button>
          <button type="button" className="d-knop d-knop--secundair" disabled={wijz.bezig} onClick={wijz.vergeet}>Ongedaan maken</button>
        </div>
      )}
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}

      {tab === 'sessies' && (
        <>
          {data.kanSchrijven && (
            <p className="d-klein">
              Klik een dag open. Naam, lokaal, leerkracht en maximum pas je rechtstreeks in de tabel aan en bewaar je bovenaan;
              al de rest van een sessie staat achter <strong>Meer…</strong>.
            </p>
          )}
          <Sessies dagen={data.dagen} gemeen={gemeen} wijz={wijz} />
        </>
      )}

      {tab === 'algemeen' && (
        <div className="d-kaart">
          <Formulier soort="evenement" rij={ev} gemeen={gemeen} groepen={EVENEMENT_GROEPEN} onKlaar={herlaad} />
        </div>
      )}

      {tab === 'doelgroepen' && (
        <div className="d-kaart">
          <p className="d-klein">Doelgroepen bepalen welke sessies iemand ziet. Zonder doelgroepen ziet iedereen dezelfde sessies.</p>
          <Tabel
            soort="doelgroep"
            rijen={data.doelgroepen}
            kolommen={DOELGROEP_KOLOMMEN}
            gemeen={gemeen}
            wijz={wijz}
            ouderId={ev.evenement_id}
            leeg="Geen doelgroepen: iedereen ziet dezelfde sessies."
          />
        </div>
      )}

      {tab === 'dagen' && (
        <div className="d-kaart">
          <p className="d-klein">De dagen van het evenement. De momenten (voormiddag, namiddag …) stel je in op het tabblad Momenten.</p>
          <Tabel soort="dag" rijen={data.dagen} kolommen={DAG_KOLOMMEN} gemeen={gemeen} wijz={wijz} ouderId={ev.evenement_id} />
        </div>
      )}

      {tab === 'momenten' && (
        <>
          {data.dagen.length === 0 ? (
            <Melding>Er zijn nog geen dagen. Voeg er eerst een toe op het tabblad <strong>Dagen</strong>.</Melding>
          ) : (
            data.dagen.map((dag: Rij) => (
              <section key={dag.dag_id} className="d-kaart">
                <h2>
                  {dag.naam} <span className="d-klein">{datum(dag.datum)} · {dag.start_uur}–{dag.eind_uur}</span>
                </h2>
                <Tabel
                  soort="dagdeel"
                  rijen={dag.dagdelen}
                  kolommen={DAGDEEL_KOLOMMEN}
                  gemeen={gemeen}
                  wijz={wijz}
                  ouderId={dag.dag_id}
                  context={dag.naam}
                  rijActies={(dd) => (
                    <button type="button" className="d-link" onClick={() => setKopie({ dagdeel: dd, dag })}>Naar andere dag…</button>
                  )}
                />
                {dag.dagdelen.map((dd: Rij) => (
                  <Tabel
                    key={dd.dagdeel_id}
                    soort="tijdsblok"
                    rijen={dd.tijdsblokken}
                    kolommen={TIJDSBLOK_KOLOMMEN}
                    gemeen={gemeen}
                    wijz={wijz}
                    ouderId={dd.dagdeel_id}
                    context={`${dag.naam} ${dd.naam}`}
                    titel={<>Tijdsblokken in {dd.naam}</>}
                    leeg={<>Nog geen tijdsblokken in {dd.naam}.</>}
                  />
                ))}
              </section>
            ))
          )}
        </>
      )}

      {tab === 'lokalen' && (
        <div className="d-kaart">
          <p className="d-klein">
            Lokalen gelden voor de <strong>hele school</strong>, niet enkel voor dit evenement: je stelt ze hier in en kiest
            ze daarna per sessie op het tabblad <strong>Sessies</strong>. Een lokaal wijzigen of weghalen raakt dus ook andere evenementen.
          </p>
          <Tabel
            soort="locatie"
            rijen={data.locaties}
            kolommen={LOKAAL_KOLOMMEN}
            gemeen={gemeen}
            wijz={wijz}
            // Enkel om de knop "+ Lokaal toevoegen" te tonen: een lokaal hangt niet aan dit evenement, en de API negeert dit.
            ouderId={ev.evenement_id}
            leeg="Nog geen lokalen. Voeg ze hier toe, dan kan je ze bij een sessie kiezen."
            rijActies={(l) => (
              <button type="button" className="d-link" onClick={() => setOpCode(l)}>Aan sessiecode…</button>
            )}
          />
        </div>
      )}

      {opCode && (
        <LokaalOpCode
          locatie={opCode}
          evenementId={evenementId}
          dagen={data.dagen}
          lokaalNaam={(id) => (id ? gemeen.opties.locatie.find((o) => o.waarde === id)?.label ?? '(onbekend)' : '—')}
          onSluit={() => setOpCode(null)}
          onKlaar={herlaad}
        />
      )}

      {kopie && <KopieerDagdeel dagdeel={kopie.dagdeel} dag={kopie.dag} dagen={data.dagen} onSluit={() => setKopie(null)} onKlaar={herlaad} />}

      <p className="it-oud d-klein">
        <Link href={`/dashboard/evenementen/${evenementId}/instelOud`}>Oude instellingenpagina (IntOud)</Link> — alles onder elkaar, zoals voordien.
      </p>
    </div>
  );
}
