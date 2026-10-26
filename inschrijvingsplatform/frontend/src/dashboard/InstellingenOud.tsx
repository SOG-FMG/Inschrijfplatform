import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { instellingenApi, type InstellingSoort } from '../services/beheerApi';
import { ApiFout } from '../types';
import { etiketUrl } from './Etiketten';
import { KopieerDagdeel, KopieerSessies, type SessieKopie } from './instellingen/Kopieren';
import { beginWaarden, bewaarbaar, ID, naarApi, type Opties, type Rij, type Schema, Veld } from './instellingen/velden';
import { rapportUrl } from './Rapporten';
import { Link, STATUSNAAM } from './ui';

/**
 * IntOud: de vorige instellingenpagina (/dashboard/evenementen/<id>/instelOud), met alles onder
 * elkaar in uitklapbare blokken. Blijft bestaan als vangnet; het gewone werk gebeurt op de pagina
 * met tabbladen (Instellingen.tsx). Beide gebruiken hetzelfde schema en dezelfde API.
 */

interface RecordProps {
  soort: InstellingSoort;
  rij: Rij | null; // null = nieuw
  ouderId?: string;
  schema: Schema;
  opties: Opties;
  kanSchrijven: boolean;
  titel: ReactNode;
  info?: ReactNode;
  open?: boolean;
  onKlaar: () => void;
  onAnnuleer?: () => void;
  /** Extra knoppen naast Opslaan (bv. kopiëren). */
  acties?: ReactNode;
  children?: ReactNode;
}

function Record({ soort, rij, ouderId, schema, opties, kanSchrijven, titel, info, open, onKlaar, onAnnuleer, acties, children }: RecordProps) {
  const velden = schema[soort];
  const begin = beginWaarden(velden, rij);
  const [waarden, setWaarden] = useState<Record<string, unknown>>(begin);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const id = rij?.[ID[soort]] as string | undefined;
  const gewijzigd = bewaarbaar(velden).filter((v) => JSON.stringify(waarden[v.naam]) !== JSON.stringify(begin[v.naam]));

  // Na herladen van de gegevens het formulier gelijkzetten (enkel als er niets lokaal gewijzigd is).
  const sleutel = JSON.stringify(begin);
  useEffect(() => {
    setWaarden(beginWaarden(velden, rij));
  }, [sleutel]);

  const opslaan = async () => {
    setBezig(true);
    setFouten({});
    setMelding(null);
    try {
      const teVersturen = Object.fromEntries((id ? gewijzigd : bewaarbaar(velden)).map((v) => [v.naam, naarApi(v, waarden[v.naam])]));
      if (id) await instellingenApi.wijzig(soort, id, teVersturen);
      else await instellingenApi.maak(soort, ouderId ?? null, teVersturen);
      setMelding({ soort: 'ok', tekst: 'Opgeslagen.' });
      onKlaar();
    } catch (e) {
      if (e instanceof ApiFout && e.velden) setFouten(e.velden);
      setMelding({ soort: 'fout', tekst: e instanceof ApiFout ? (e.velden?.algemeen ?? e.message) : 'Opslaan mislukt.' });
    } finally {
      setBezig(false);
    }
  };

  const verwijderen = async () => {
    if (!id || !confirm('Zeker verwijderen? Dit verwijdert ook alles eronder.')) return;
    try {
      await instellingenApi.verwijder(soort, id);
      onKlaar();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: e instanceof ApiFout ? e.message : 'Verwijderen mislukt.' });
    }
  };

  return (
    <details className={`rec rec--${soort}${id ? '' : ' rec--nieuw'}`} open={open}>
      <summary>
        <span className="rec__titel">{titel}</span>
        {info && <span className="rec__info">{info}</span>}
        {gewijzigd.length > 0 && id && <span className="rec__badge">niet opgeslagen</span>}
      </summary>
      <form
        className="rec__form"
        onSubmit={(e) => {
          e.preventDefault();
          opslaan();
        }}
      >
        <div className="rec__velden">
          {velden.map((v) => (
            <Veld
              key={v.naam}
              id={`oud-${soort}-${id ?? 'nieuw'}-${v.naam}`}
              v={v}
              waarde={waarden[v.naam]}
              onWijzig={(w) => setWaarden((oud) => ({ ...oud, [v.naam]: w }))}
              fout={fouten[v.naam]}
              opties={opties}
              alleenLezen={!kanSchrijven}
              evenementId={rij?.evenement_id ?? (soort === 'evenement' ? id : undefined)}
              onHerlaad={onKlaar}
            />
          ))}
        </div>
        {kanSchrijven && (
          <div className="rec__knoppen">
            <button type="submit" className="d-knop" disabled={bezig || (!!id && gewijzigd.length === 0)}>
              {id ? 'Opslaan' : 'Toevoegen'}
            </button>
            {id && gewijzigd.length > 0 && (
              <button type="button" className="d-knop d-knop--secundair" onClick={() => setWaarden(begin)}>Wijzigingen ongedaan maken</button>
            )}
            {!id && onAnnuleer && <button type="button" className="d-knop d-knop--secundair" onClick={onAnnuleer}>Annuleren</button>}
            {id && acties}
            {id && soort !== 'evenement' && <button type="button" className="d-knop d-knop--gevaar rec__weg" onClick={verwijderen}>Verwijderen</button>}
            {melding && <span className={`rec__melding rec__melding--${melding.soort}`} role="status">{melding.tekst}</span>}
          </div>
        )}
      </form>
      {children && <div className="rec__kinderen">{children}</div>}
    </details>
  );
}

/** Knop "+ … toevoegen" die een leeg formulier opent. */
function Nieuw(props: Omit<RecordProps, 'rij' | 'titel' | 'onKlaar'> & { label: string; onKlaar: () => void }) {
  const [open, setOpen] = useState(false);
  if (!props.kanSchrijven) return null;
  if (!open) {
    return <button type="button" className="d-link nieuw-knop" onClick={() => setOpen(true)}>+ {props.label}</button>;
  }
  return (
    <Record
      {...props}
      rij={null}
      open
      titel={`Nieuw: ${props.label.toLowerCase()}`}
      onAnnuleer={() => setOpen(false)}
      onKlaar={() => {
        setOpen(false);
        props.onKlaar();
      }}
    />
  );
}

const telling = (t: { bevestigd: number; wachtlijst: number }, capaciteit: number | null) =>
  `${t.bevestigd}${capaciteit != null ? ` / ${capaciteit}` : ''} ingeschreven${t.wachtlijst ? `, ${t.wachtlijst} wachtlijst` : ''}`;

// ---------------------------------------------------------------------------
export function InstellingenOud({ evenementId, naVerandering }: { evenementId: string; naVerandering: () => void }) {
  const [data, setData] = useState<any>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [sessieKopie, setSessieKopie] = useState<SessieKopie | null>(null);
  const [dagdeelKopie, setDagdeelKopie] = useState<{ dagdeel: Rij; dag: Rij } | null>(null);

  const laad = useCallback(() => {
    instellingenApi
      .lees(evenementId)
      .then((d) => {
        setData(d);
        document.title = `IntOud – ${d.evenement.titel}`;
      })
      .catch((e) => setFout(e instanceof ApiFout ? e.message : 'Laden mislukt.'));
  }, [evenementId]);
  useEffect(laad, [laad]);

  if (fout) {
    return (
      <div className="instellingen">
        <p><Link href="/dashboard">← Evenementen</Link></p>
        <div className="d-melding d-melding--fout" role="alert">{fout}</div>
      </div>
    );
  }
  if (!data) return <div className="instellingen" aria-busy="true"><p>Laden…</p></div>;

  // Na elke wijziging ook het overzicht (titels, status in de tabel) verversen.
  const herlaad = () => {
    laad();
    naVerandering();
  };
  const gemeen = { schema: data.schema as Schema, opties: data.opties as Opties, kanSchrijven: data.kanSchrijven as boolean, onKlaar: herlaad };
  const ev = data.evenement;

  return (
    <div className="instellingen">
      <nav className="d-kruimel" aria-label="Kruimelpad">
        <Link href="/dashboard">Evenementen</Link> › <Link href={`/dashboard/evenementen/${evenementId}`}>{ev.titel}</Link> › <span>IntOud</span>
      </nav>
      <header className="d-paginakop">
        <div>
          <h1>
            {ev.titel} <span className={`d-badge d-badge--${ev.status}`}>{STATUSNAAM[ev.status] ?? ev.status}</span>
          </h1>
          <p className="d-sub">
            IntOud: de vorige instellingenpagina, met alles onder elkaar.{' '}
            <Link href={`/dashboard/evenementen/${evenementId}`}>Naar de nieuwe pagina met tabbladen</Link>.
            {!data.kanSchrijven && ' Je kan deze instellingen enkel bekijken.'}
          </p>
        </div>
        <span className="d-knoppen d-knoppen--links">
          <Link href={rapportUrl(ev.evenement_id)} className="d-knop">Rapporten</Link>
          <Link href={etiketUrl(ev.evenement_id)} className="d-knop d-knop--secundair">Etiketten</Link>
          <a className="d-knop d-knop--secundair" href={`/${ev.slug}`} target="_blank" rel="noreferrer">Formulier bekijken ↗</a>
        </span>
      </header>

      <section className="inst-blok">
        <h2>Algemeen</h2>
        <Record {...gemeen} soort="evenement" rij={ev} open titel="Gegevens van het evenement" info={`${ev.start_datum} – ${ev.eind_datum}`} />
      </section>

      <section className="inst-blok">
        <h2>Doelgroepen</h2>
        {data.doelgroepen.length === 0 && <p className="d-klein">Geen doelgroepen: iedereen ziet dezelfde lesjes.</p>}
        {data.doelgroepen.map((d: Rij) => (
          <Record key={d.doelgroep_id} {...gemeen} soort="doelgroep" rij={d} titel={d.naam} info={d.beschrijving} />
        ))}
        <Nieuw {...gemeen} soort="doelgroep" ouderId={ev.evenement_id} label="Doelgroep toevoegen" />
      </section>

      <section className="inst-blok">
        <h2>Dagen, momenten en lesjes</h2>
        {data.dagen.map((dag: Rij) => (
          <Record key={dag.dag_id} {...gemeen} soort="dag" rij={dag} titel={dag.naam} info={`${dag.datum} · ${dag.start_uur}–${dag.eind_uur}${dag.status !== 'actief' ? ` · ${dag.status}` : ''}`}>
            {dag.dagdelen.map((dd: Rij) => (
              <Record key={dd.dagdeel_id} {...gemeen} soort="dagdeel" rij={dd} titel={dd.naam}
                acties={<button type="button" className="d-knop d-knop--secundair" onClick={() => setDagdeelKopie({ dagdeel: dd, dag })}>Kopiëren naar andere dag…</button>}
                info={`${dd.start_uur}–${dd.eind_uur} · ${telling(dd.ingeschreven, dd.capaciteit)}${dd.status !== 'actief' ? ` · ${dd.status}` : ''}`}>
                {dd.tijdsblokken.map((t: Rij) => (
                  <Record key={t.tijdsblok_id} {...gemeen} soort="tijdsblok" rij={t} titel={t.naam}
                    acties={t.sessies.length > 0 && <button type="button" className="d-knop d-knop--secundair" onClick={() => setSessieKopie({ sessies: t.sessies, tijdsblok: t, dagdeel: dd, dag })}>Lesjes kopiëren naar…</button>}
                    info={`${t.start_uur}–${t.eind_uur} · ${t.type === 'keuze' ? `keuze uit ${t.sessies.length} lesje(s)` : 'programma'}`}>
                    {t.sessies.map((s: Rij) => (
                      <Record key={s.sessie_id} {...gemeen} soort="sessie" rij={s} titel={s.titel}
                        info={`${telling(s.ingeschreven, s.capaciteit)}${s.status !== 'open' ? ` · ${s.status}` : ''}${s.zichtbaar ? '' : ' · verborgen'}`} />
                    ))}
                    <Nieuw {...gemeen} soort="sessie" ouderId={t.tijdsblok_id} label="Lesje toevoegen" />
                  </Record>
                ))}
                <Nieuw {...gemeen} soort="tijdsblok" ouderId={dd.dagdeel_id} label="Tijdsblok toevoegen" />
              </Record>
            ))}
            <Nieuw {...gemeen} soort="dagdeel" ouderId={dag.dag_id} label="Moment (dagdeel) toevoegen" />
          </Record>
        ))}
        <Nieuw {...gemeen} soort="dag" ouderId={ev.evenement_id} label="Dag toevoegen" />
      </section>

      {sessieKopie && <KopieerSessies kopie={sessieKopie} dagen={data.dagen} onSluit={() => setSessieKopie(null)} onKlaar={herlaad} />}
      {dagdeelKopie && <KopieerDagdeel dagdeel={dagdeelKopie.dagdeel} dag={dagdeelKopie.dag} dagen={data.dagen} onSluit={() => setDagdeelKopie(null)} onKlaar={herlaad} />}
    </div>
  );
}
