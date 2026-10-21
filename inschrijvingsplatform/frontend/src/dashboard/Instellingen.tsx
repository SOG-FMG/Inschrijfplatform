import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { instellingenApi, kopieerApi, type InstellingSoort, type InstellingVeld } from '../services/beheerApi';
import { ApiFout } from '../types';
import { etiketUrl } from './Etiketten';
import { rapportUrl } from './Rapporten';
import { foutTekst, Link, Melding, STATUSNAAM, Venster } from './ui';

/**
 * Instellingen van één evenement (/dashboard/evenementen/<id>).
 * De formulieren worden opgebouwd uit het schema dat de API meestuurt (backend/src/db/instellingen.ts).
 */

type Opties = Record<'doelgroep' | 'soort' | 'locatie', { waarde: string; label: string }[]>;
type Schema = Record<InstellingSoort, InstellingVeld[]>;

const ID: Record<InstellingSoort, string> = {
  evenement: 'evenement_id',
  doelgroep: 'doelgroep_id',
  dag: 'dag_id',
  dagdeel: 'dagdeel_id',
  tijdsblok: 'tijdsblok_id',
  sessie: 'sessie_id',
};

const twee = (n: number) => String(n).padStart(2, '0');
/** ISO (UTC) → waarde voor <input type="datetime-local"> in de tijdzone van de browser. */
function naarLokaal(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}T${twee(d.getHours())}:${twee(d.getMinutes())}`;
}

/** Waarde uit de database → waarde in het formulier. */
function naarInvoer(v: InstellingVeld, waarde: unknown): unknown {
  if (v.type === 'jaNee') return waarde === 1 || waarde === true;
  if (v.type === 'datumtijd') return naarLokaal(waarde);
  if (v.type === 'lijst') return Array.isArray(waarde) ? waarde.join(', ') : '';
  return waarde ?? '';
}

/** Formulier → API. */
function naarApi(v: InstellingVeld, waarde: unknown): unknown {
  if (v.type === 'datumtijd') return waarde ? new Date(String(waarde)).toISOString() : null;
  if (v.type === 'jaNee') return !!waarde;
  return waarde === '' ? null : waarde;
}

function beginWaarden(velden: InstellingVeld[], rij: Record<string, unknown> | null) {
  return Object.fromEntries(velden.map((v) => [v.naam, naarInvoer(v, rij ? rij[v.naam] : v.standaard)]));
}

// ---------------------------------------------------------------------------
function Veld({ v, waarde, onWijzig, fout, opties, alleenLezen, id, evenementId, onHerlaad }: {
  v: InstellingVeld;
  waarde: unknown;
  onWijzig: (w: unknown) => void;
  fout?: string;
  opties: Opties;
  alleenLezen: boolean;
  id: string;
  evenementId?: string;
  onHerlaad: () => void;
}) {
  const gemeen = { id, disabled: alleenLezen, 'aria-invalid': fout ? true : undefined };
  let invoer: ReactNode;
  switch (v.type) {
    case 'logo':
      return <LogoVeld v={v} logo={waarde ? String(waarde) : null} evenementId={evenementId!} alleenLezen={alleenLezen} onHerlaad={onHerlaad} />;
    case 'kleur':
      invoer = (
        <span className="iv__kleur">
          <input {...gemeen} type="color" value={String(waarde || '#1d4f91')} onChange={(e) => onWijzig(e.target.value)} />
          <input type="text" disabled={alleenLezen} value={String(waarde)} placeholder="standaard" aria-label={`${v.label} (code)`} onChange={(e) => onWijzig(e.target.value)} />
          {!!waarde && !alleenLezen && (
            <button type="button" className="d-link" onClick={() => onWijzig('')}>standaard</button>
          )}
        </span>
      );
      break;
    case 'jaNee':
      invoer = <input {...gemeen} type="checkbox" checked={!!waarde} onChange={(e) => onWijzig(e.target.checked)} />;
      break;
    case 'lang':
      invoer = <textarea {...gemeen} rows={2} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)} />;
      break;
    case 'keuze':
    case 'ref': {
      const lijst = v.type === 'ref' ? opties[v.ref!] ?? [] : v.opties ?? [];
      invoer = (
        <select {...gemeen} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)}>
          {(v.type === 'ref' || !v.verplicht) && <option value="">— geen —</option>}
          {lijst.map((o) => (
            <option key={o.waarde} value={o.waarde}>{o.label}</option>
          ))}
        </select>
      );
      break;
    }
    default: {
      const type = { datum: 'date', uur: 'time', datumtijd: 'datetime-local', getal: 'number', email: 'email' }[v.type as string] ?? 'text';
      invoer = <input {...gemeen} type={type} min={v.min} max={v.max} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)} />;
    }
  }
  return (
    <div className={`iv iv--${v.type}${fout ? ' iv--fout' : ''}`}>
      <label htmlFor={id}>
        {v.label}
        {v.verplicht && <span className="verplicht" aria-hidden="true"> *</span>}
      </label>
      {invoer}
      {fout ? <span className="iv__fout">{fout}</span> : v.hulp && <span className="iv__hulp">{v.hulp}</span>}
    </div>
  );
}

/** Logo: rechtstreeks uploaden (los van de knop Opslaan). */
function LogoVeld({ v, logo, evenementId, alleenLezen, onHerlaad }: {
  v: InstellingVeld;
  logo: string | null;
  evenementId: string;
  alleenLezen: boolean;
  onHerlaad: () => void;
}) {
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const uitvoeren = async (werk: () => Promise<unknown>) => {
    setBezig(true);
    setFout(null);
    try {
      await werk();
      onHerlaad();
    } catch (e) {
      setFout(e instanceof ApiFout ? (e.velden?.logo ?? e.message) : 'Uploaden mislukt.');
    } finally {
      setBezig(false);
    }
  };
  return (
    <div className="iv iv--logo">
      <span className="iv__label">{v.label}</span>
      <div className="iv__logo">
        {logo ? <img src={logo} alt="Huidig logo" /> : <span className="iv__geenlogo">Geen logo</span>}
        {!alleenLezen && (
          <span className="iv__logoknoppen">
            <label className="d-knop d-knop--secundair d-knop--klein">
              {bezig ? 'Bezig…' : logo ? 'Ander logo kiezen' : 'Logo kiezen'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={bezig}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uitvoeren(() => instellingenApi.uploadLogo(evenementId, f));
                }}
              />
            </label>
            {logo && (
              <button type="button" className="d-link d-link--gevaar" disabled={bezig} onClick={() => confirm('Logo verwijderen?') && uitvoeren(() => instellingenApi.verwijderLogo(evenementId))}>
                Verwijderen
              </button>
            )}
          </span>
        )}
      </div>
      {fout ? <span className="iv__fout">{fout}</span> : v.hulp && <span className="iv__hulp">{v.hulp}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
interface RecordProps {
  soort: InstellingSoort;
  rij: Record<string, any> | null; // null = nieuw
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
  const bewaarbaar = velden.filter((v) => v.type !== 'logo'); // het logo heeft een eigen upload
  const gewijzigd = bewaarbaar.filter((v) => JSON.stringify(waarden[v.naam]) !== JSON.stringify(begin[v.naam]));

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
      const teVersturen = Object.fromEntries((id ? gewijzigd : bewaarbaar).map((v) => [v.naam, naarApi(v, waarden[v.naam])]));
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
              id={`${soort}-${id ?? 'nieuw'}-${v.naam}`}
              v={v}
              waarde={waarden[v.naam]}
              onWijzig={(w) => setWaarden((oud) => ({ ...oud, [v.naam]: w }))}
              fout={fouten[v.naam]}
              opties={opties}
              alleenLezen={!kanSchrijven}
              evenementId={rij?.evenement_id}
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
// Kopiëren naar andere momenten
// ---------------------------------------------------------------------------
type Kopie = { soort: 'sessies'; tijdsblok: any; dagdeel: any; dag: any } | { soort: 'dagdeel'; dagdeel: any; dag: any };

function Vinkjes({ items, gekozen, onWijzig }: { items: { id: string; label: ReactNode; uit?: boolean }[]; gekozen: string[]; onWijzig: (ids: string[]) => void }) {
  return (
    <div className="kopie__lijst">
      {items.map((i) => (
        <label key={i.id} className={`d-keuze${i.uit ? ' kopie__uit' : ''}`}>
          <input
            type="checkbox"
            disabled={i.uit}
            checked={gekozen.includes(i.id)}
            onChange={(e) => onWijzig(e.target.checked ? [...gekozen, i.id] : gekozen.filter((x) => x !== i.id))}
          />
          <span>{i.label}</span>
        </label>
      ))}
    </div>
  );
}

function KopieerVenster({ kopie, dagen, onSluit, onKlaar }: { kopie: Kopie; dagen: any[]; onSluit: () => void; onKlaar: () => void }) {
  const isSessies = kopie.soort === 'sessies';
  const [bron, setBron] = useState<string[]>(isSessies ? kopie.tijdsblok.sessies.map((s: any) => s.sessie_id) : [kopie.dagdeel.dagdeel_id]);
  const [naar, setNaar] = useState<string[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<ReactNode>(null);
  const [bezig, setBezig] = useState(false);

  // Doelen: alle keuzeblokken van het evenement (behalve dit), of alle andere dagen
  const doelen = isSessies
    ? dagen.flatMap((d: any) =>
        d.dagdelen.flatMap((dd: any) =>
          dd.tijdsblokken
            .filter((t: any) => t.type === 'keuze' && t.tijdsblok_id !== kopie.tijdsblok.tijdsblok_id)
            .map((t: any) => ({ id: t.tijdsblok_id, label: <>{d.naam} – {dd.naam} – <strong>{t.naam}</strong> <span className="d-klein">({t.start_uur}–{t.eind_uur}, {t.sessies.length} lesje(s))</span></> })),
        ),
      )
    : dagen.filter((d: any) => d.dag_id !== kopie.dag.dag_id).map((d: any) => ({ id: d.dag_id, label: <><strong>{d.naam}</strong> <span className="d-klein">({d.datum})</span></> }));

  const kopieer = async () => {
    setBezig(true);
    setFout(null);
    try {
      if (kopie.soort === 'sessies') {
        const r = await kopieerApi.sessies(bron, naar);
        setResultaat(
          <>
            {r.gekopieerd} lesje(s) gekopieerd.
            {r.overgeslagen.length > 0 && <> Overgeslagen (stond er al): {r.overgeslagen.map((o) => `${o.titel} (${o.tijdsblok})`).join(', ')}.</>}
          </>,
        );
      } else {
        await kopieerApi.dagdeel(kopie.dagdeel.dagdeel_id, naar);
        setResultaat(<>“{kopie.dagdeel.naam}” is gekopieerd naar {naar.length} dag(en), met alle tijdsblokken en lesjes.</>);
      }
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e, 'Kopiëren mislukt.'));
    } finally {
      setBezig(false);
    }
  };

  return (
    <Venster titel={isSessies ? `Lesjes kopiëren uit ${kopie.tijdsblok.naam}` : `${kopie.dagdeel.naam} kopiëren naar een andere dag`} onSluit={onSluit} breed>
      {resultaat ? (
        <>
          <Melding soort="ok">{resultaat}</Melding>
          <div className="d-knoppen"><button type="button" className="d-knop" onClick={onSluit}>Sluiten</button></div>
        </>
      ) : (
        <>
          {fout && <Melding soort="fout">{fout}</Melding>}
          {isSessies ? (
            <>
              <h3>Welke lesjes?</h3>
              <Vinkjes items={kopie.tijdsblok.sessies.map((s: any) => ({ id: s.sessie_id, label: s.titel }))} gekozen={bron} onWijzig={setBron} />
              <h3>Naar welke momenten?</h3>
              <p className="d-klein">Alle gegevens gaan mee (lokaal, leerkracht, maximum, doelgroep, …), de inschrijvingen niet. Een lesje met dezelfde code of titel dat er al staat, wordt overgeslagen.</p>
            </>
          ) : (
            <>
              <p>Maakt op de gekozen dag(en) een nieuw moment <strong>{kopie.dagdeel.naam}</strong> ({kopie.dagdeel.start_uur}–{kopie.dagdeel.eind_uur}) met dezelfde tijdsblokken en lesjes, zonder inschrijvingen.</p>
              <h3>Naar welke dag?</h3>
            </>
          )}
          {doelen.length ? <Vinkjes items={doelen} gekozen={naar} onWijzig={setNaar} /> : <Melding>Er is nog geen ander {isSessies ? 'keuzeblok' : 'dag'}. Voeg die eerst toe.</Melding>}
          <div className="d-knoppen">
            <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
            <button type="button" className="d-knop" disabled={bezig || !bron.length || !naar.length} onClick={kopieer}>{bezig ? 'Bezig…' : 'Kopiëren'}</button>
          </div>
        </>
      )}
    </Venster>
  );
}

// ---------------------------------------------------------------------------
export function Instellingen({ evenementId, naVerandering }: { evenementId: string; naVerandering: () => void }) {
  const [data, setData] = useState<any>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [kopie, setKopie] = useState<Kopie | null>(null);

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
        <Link href="/dashboard">Evenementen</Link> › <span>{ev.titel}</span>
      </nav>
      <header className="d-paginakop">
        <div>
          <h1>
            {ev.titel} <span className={`d-badge d-badge--${ev.status}`}>{STATUSNAAM[ev.status] ?? ev.status}</span>
          </h1>
          {!data.kanSchrijven && <p className="d-sub">Je kan deze instellingen enkel bekijken.</p>}
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
        {data.doelgroepen.map((d: any) => (
          <Record key={d.doelgroep_id} {...gemeen} soort="doelgroep" rij={d} titel={d.naam} info={d.beschrijving} />
        ))}
        <Nieuw {...gemeen} soort="doelgroep" ouderId={ev.evenement_id} label="Doelgroep toevoegen" />
      </section>

      <section className="inst-blok">
        <h2>Dagen, momenten en lesjes</h2>
        {data.dagen.map((dag: any) => (
          <Record key={dag.dag_id} {...gemeen} soort="dag" rij={dag} titel={dag.naam} info={`${dag.datum} · ${dag.start_uur}–${dag.eind_uur}${dag.status !== 'actief' ? ` · ${dag.status}` : ''}`}>
            {dag.dagdelen.map((dd: any) => (
              <Record key={dd.dagdeel_id} {...gemeen} soort="dagdeel" rij={dd} titel={dd.naam}
                acties={<button type="button" className="d-knop d-knop--secundair" onClick={() => setKopie({ soort: 'dagdeel', dagdeel: dd, dag })}>Kopiëren naar andere dag…</button>}
                info={`${dd.start_uur}–${dd.eind_uur} · ${telling(dd.ingeschreven, dd.capaciteit)}${dd.status !== 'actief' ? ` · ${dd.status}` : ''}`}>
                {dd.tijdsblokken.map((t: any) => (
                  <Record key={t.tijdsblok_id} {...gemeen} soort="tijdsblok" rij={t} titel={t.naam}
                    acties={t.sessies.length > 0 && <button type="button" className="d-knop d-knop--secundair" onClick={() => setKopie({ soort: 'sessies', tijdsblok: t, dagdeel: dd, dag })}>Lesjes kopiëren naar…</button>}
                    info={`${t.start_uur}–${t.eind_uur} · ${t.type === 'keuze' ? `keuze uit ${t.sessies.length} lesje(s)` : 'programma'}`}>
                    {t.sessies.map((s: any) => (
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
      {kopie && <KopieerVenster kopie={kopie} dagen={data.dagen} onSluit={() => setKopie(null)} onKlaar={herlaad} />}
    </div>
  );
}
