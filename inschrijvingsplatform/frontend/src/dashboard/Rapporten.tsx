import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  instellingenApi,
  rapportApi,
  type Profiel,
  type Rapport,
  type RapportDagdeel,
  type RapportDeelnemer,
  type RapportSessie,
  type RapportTijdsblok,
} from '../services/beheerApi';
import { etiketUrl } from './Etiketten';
import { download, maakXlsx, type Blad, type Cel } from './excel';
import { foutTekst, Link, Melding, Qr } from './ui';

/**
 * Rapporten van een evenement (/dashboard/evenementen/<id>/rapporten?r=dagdeel|moment|lesje).
 *   dagdeel  overzicht per dagdeel: lesje, lokaal, leerkracht, maximum, ingeschreven, beschikbaar
 *   moment   inschrijvingen per keuzeblok: elk lesje een kolom, daaronder het aantal en de namen
 *   lesje    klaslijst per lesje: voornaam, achternaam, huidige school en leerjaar
 * Titels en kolomkoppen zijn aanklikbaar om te wijzigen (per evenement bewaard), net als de gegevens
 * van een lesje in het overzicht per dagdeel. Elk rapport kan afgedrukt, naar Excel geëxporteerd of
 * als klaslijst naar de leerkrachten gemaild worden.
 */

type Soort = 'dagdeel' | 'moment' | 'lesje';
const SOORTEN: { soort: Soort; label: string }[] = [
  { soort: 'dagdeel', label: 'Overzicht per dagdeel' },
  { soort: 'moment', label: 'Inschrijvingen per moment' },
  { soort: 'lesje', label: 'Klaslijst per lesje' },
];

type SessieWijziging = Partial<{ titel: string; lesgever: string; capaciteit: string; locatie_id: string }>;

// ---------------------------------------------------------------------------
// Bewerkbare teksten
// ---------------------------------------------------------------------------
interface Bewerken {
  kan: boolean;
  tekst: (sleutel: string, standaard: string) => string;
  zetTekst: (sleutel: string, waarde: string, standaard: string) => void;
}
const BewerkContext = createContext<Bewerken>({ kan: false, tekst: (_, s) => s, zetTekst: () => undefined });

/** Klik om te wijzigen. Ongecontroleerd (contentEditable); de waarde wordt overgenomen bij het verlaten. */
function Bewerkbaar({ waarde, onWijzig, kan, label }: { waarde: string; onWijzig: (w: string) => void; kan: boolean; label: string }) {
  if (!kan) return <>{waarde}</>;
  return (
    <span
      key={waarde}
      className="r-bewerk"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={`${label} (klik om te wijzigen)`}
      title="Klik om te wijzigen"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const nieuw = (e.currentTarget.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (nieuw !== waarde) onWijzig(nieuw);
      }}
    >
      {waarde}
    </span>
  );
}

/** Label van een rapport (titel, kolomkop) dat per evenement aangepast kan worden. */
function T({ k, s }: { k: string; s: string }) {
  const b = useContext(BewerkContext);
  return <Bewerkbaar waarde={b.tekst(k, s)} kan={b.kan} label={s} onWijzig={(w) => b.zetTekst(k, w, s)} />;
}

// ---------------------------------------------------------------------------
const volleNaam = (d: RapportDeelnemer) => `${d.voornaam} ${d.naam}`.trim();
const vrij = (s: RapportSessie) => (s.capaciteit == null ? null : Math.max(s.capaciteit - s.bevestigd, 0));
const nu = () => new Date().toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Pagina {
  sleutel: string;
  dag: Rapport['dagen'][number];
  dagdeel: RapportDagdeel;
  tijdsblok?: RapportTijdsblok;
  sessie?: RapportSessie;
}

export function Rapporten({ evenementId, profiel }: { evenementId: string; profiel: Profiel }) {
  const zoek = new URLSearchParams(location.search);
  const [soort, setSoort] = useState<Soort>((['dagdeel', 'moment', 'lesje'] as Soort[]).find((s) => s === zoek.get('r')) ?? 'dagdeel');
  const [data, setData] = useState<Rapport | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [dagdeelId, setDagdeelId] = useState(zoek.get('dagdeel') ?? 'alle');
  const [tijdsblokId, setTijdsblokId] = useState('alle');
  const [sessieId, setSessieId] = useState('alle');
  const [teksten, setTeksten] = useState<Record<string, string>>({});
  const [sessieWijz, setSessieWijz] = useState<Record<string, SessieWijziging>>({});
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout' | 'let-op'; tekst: ReactNode } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [afdruk, setAfdruk] = useState(nu);

  const laad = useCallback(() => {
    rapportApi
      .lees(evenementId)
      .then((d) => {
        setData(d);
        document.title = `Rapporten – ${d.evenement.titel}`;
      })
      .catch((e) => setFout(foutTekst(e, 'Laden mislukt.')));
  }, [evenementId]);
  useEffect(laad, [laad]);

  // Tijdstip van afdrukken in de voettekst
  useEffect(() => {
    const voor = () => flushSync(() => setAfdruk(nu()));
    addEventListener('beforeprint', voor);
    return () => removeEventListener('beforeprint', voor);
  }, []);

  const kiesSoort = (s: Soort) => {
    setSoort(s);
    history.replaceState(null, '', `${location.pathname}?r=${s}`);
  };

  const aantalWijzigingen = Object.keys(teksten).length + Object.keys(sessieWijz).length;
  // Niet zomaar weg met niet-bewaarde wijzigingen
  useEffect(() => {
    if (!aantalWijzigingen) return;
    const waarschuw = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', waarschuw);
    return () => removeEventListener('beforeunload', waarschuw);
  }, [aantalWijzigingen]);

  const bewerken = useMemo<Bewerken>(
    () => ({
      kan: !!data?.kanSchrijven,
      tekst: (k, s) => teksten[k] ?? data?.teksten[k] ?? s,
      zetTekst: (k, w, s) => setTeksten((oud) => ({ ...oud, [k]: w === s ? '' : w })), // standaardtekst = niets bewaren
    }),
    [data, teksten],
  );

  // Lesje met de nog niet bewaarde wijzigingen erin (voor het scherm)
  const metWijz = useCallback(
    (s: RapportSessie): RapportSessie => {
      const w = sessieWijz[s.id];
      if (!w) return s;
      return {
        ...s,
        titel: w.titel ?? s.titel,
        lesgever: w.lesgever ?? s.lesgever,
        capaciteit: w.capaciteit !== undefined ? (w.capaciteit === '' ? null : Number(w.capaciteit)) : s.capaciteit,
        locatieId: w.locatie_id !== undefined ? w.locatie_id || null : s.locatieId,
        lokaal: w.locatie_id !== undefined ? data?.locaties.find((l) => l.waarde === w.locatie_id)?.label ?? null : s.lokaal,
      };
    },
    [sessieWijz, data],
  );

  if (fout) {
    return (
      <>
        <p><Link href="/dashboard">← Evenementen</Link></p>
        <Melding soort="fout">{fout}</Melding>
      </>
    );
  }
  if (!data) return <p aria-busy="true">Laden…</p>;

  const alleDagdelen = data.dagen.flatMap((dag) => dag.dagdelen.map((dagdeel) => ({ dag, dagdeel })));
  const gekozenDagdelen = alleDagdelen.filter((x) => dagdeelId === 'alle' || x.dagdeel.id === dagdeelId);
  const blokkenKeuze = gekozenDagdelen.flatMap((x) => x.dagdeel.tijdsblokken.map((t) => ({ ...x, t })));
  const sessiesKeuze = blokkenKeuze.filter((x) => tijdsblokId === 'alle' || x.t.id === tijdsblokId).flatMap((x) => x.t.sessies.map((s) => ({ ...x, s })));

  const paginas: Pagina[] =
    soort === 'dagdeel'
      ? gekozenDagdelen.map(({ dag, dagdeel }) => ({ sleutel: dagdeel.id, dag, dagdeel }))
      : soort === 'moment'
        ? blokkenKeuze.filter((x) => tijdsblokId === 'alle' || x.t.id === tijdsblokId).map(({ dag, dagdeel, t }) => ({ sleutel: t.id, dag, dagdeel, tijdsblok: t }))
        : sessiesKeuze
            .filter((x) => sessieId === 'alle' || x.s.id === sessieId)
            .map(({ dag, dagdeel, t, s }) => ({ sleutel: s.id, dag, dagdeel, tijdsblok: t, sessie: s }));

  const sessiesOpPaginas = paginas.flatMap((p) => (p.sessie ? [p.sessie] : p.tijdsblok ? p.tijdsblok.sessies : p.dagdeel.tijdsblokken.flatMap((t) => t.sessies)));
  const afdrukker = `${profiel.voornaam} ${profiel.naam}`.trim() || profiel.email;
  const voettekst = `Versie ${__APP_VERSIE__} · Afgedrukt door ${afdrukker} op ${afdruk}`;
  const t = bewerken.tekst;

  const bewaar = async () => {
    setBezig(true);
    setMelding(null);
    try {
      for (const [id, w] of Object.entries(sessieWijz)) {
        await instellingenApi.wijzig('sessie', id, {
          ...w,
          ...(w.capaciteit !== undefined ? { capaciteit: w.capaciteit === '' ? null : w.capaciteit } : {}),
          ...(w.locatie_id !== undefined ? { locatie_id: w.locatie_id || null } : {}),
        });
        setSessieWijz(({ [id]: _, ...rest }) => rest);
      }
      if (Object.keys(teksten).length) await rapportApi.bewaarTeksten(evenementId, teksten);
      setTeksten({});
      setMelding({ soort: 'ok', tekst: 'Wijzigingen bewaard.' });
      laad();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e, 'Bewaren mislukt.') });
    } finally {
      setBezig(false);
    }
  };

  const mail = async () => {
    const lesjes = sessiesOpPaginas;
    const metAdres = lesjes.filter((s) => s.lesgeverEmail);
    const adressen = new Set(metAdres.map((s) => s.lesgeverEmail));
    if (!metAdres.length) {
      setMelding({ soort: 'let-op', tekst: 'Geen van deze lesjes heeft een e-mailadres van een leerkracht. Vul het in bij de instellingen van het lesje.' });
      return;
    }
    const zonder = lesjes.length - metAdres.length;
    if (!confirm(`Klaslijst van ${metAdres.length} lesje(s) mailen naar ${adressen.size} leerkracht(en)?${zonder ? `\n${zonder} lesje(s) zonder e-mailadres worden overgeslagen.` : ''}`)) return;
    setBezig(true);
    setMelding(null);
    try {
      const r = await rapportApi.mail(evenementId, lesjes.map((s) => s.id));
      setMelding({
        soort: r.mislukt.length ? 'fout' : 'ok',
        tekst: (
          <>
            {r.verzonden} mail(s) verstuurd.
            {r.zonderAdres.length > 0 && <> Zonder e-mailadres: {r.zonderAdres.join(', ')}.</>}
            {r.mislukt.length > 0 && <> Mislukt: {r.mislukt.join(', ')}.</>}
          </>
        ),
      });
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e, 'Mailen mislukt.') });
    } finally {
      setBezig(false);
    }
  };

  const exporteer = () => {
    const voet: Cel[][] = [[], [voettekst]];
    const kop = (cellen: string[]) => cellen.map((v) => ({ v, vet: true }));
    let bladen: Blad[];
    if (soort === 'dagdeel') {
      bladen = paginas.map(({ dag, dagdeel }) => ({
        naam: `${dag.naam} ${dagdeel.naam}`,
        breedtes: [34, 16, 20, 11, 13, 11, 13],
        rijen: [
          [{ v: t(`dd:${dagdeel.id}.r1`, `${dag.naam} – ${dagdeel.naam}`), vet: true }],
          [`${t('r1.totaal', 'Totaal ingeschreven')}: ${dagdeel.ingeschreven}`],
          ...dagdeel.tijdsblokken.flatMap((tb) => [
            [],
            [{ v: t(`tb:${tb.id}.r1`, `${tb.naam} (${tb.startUur} – ${tb.eindUur})`), vet: true }],
            kop([t('r1.lesje', 'Lesje'), t('r1.lokaal', 'Lokaal'), t('r1.leerkracht', 'Leerkracht'), t('r1.max', 'Maximum'),
              t('r1.ingeschreven', 'Ingeschreven'), t('r1.wachtlijst', 'Wachtlijst'), t('r1.beschikbaar', 'Beschikbaar')]),
            ...tb.sessies.map(metWijz).map((s): Cel[] => [s.titel, s.lokaal, s.lesgever, s.capaciteit, s.bevestigd, s.wachtlijst || null, vrij(s)]),
          ]),
          ...voet,
        ],
      }));
    } else if (soort === 'moment') {
      bladen = paginas.map(({ dag, dagdeel, tijdsblok: tb }) => {
        const kolommen = momentKolommen(tb!, metWijz, t);
        const max = Math.max(0, ...kolommen.map((k) => k.namen.length));
        return {
          naam: `${dag.datum.slice(8, 10)}-${dag.datum.slice(5, 7)} ${dagdeel.naam} ${tb!.naam}`,
          breedtes: kolommen.map(() => 24),
          rijen: [
            [{ v: t(`tb:${tb!.id}.r2`, `${dagdeel.naam} ${tb!.naam} – start ${tb!.startUur}`), vet: true }],
            [],
            kop(kolommen.map((k) => k.titel)),
            kolommen.map((k) => k.aantal),
            ...Array.from({ length: max }, (_, i) => kolommen.map((k) => k.namen[i] ?? null)),
            ...voet,
          ],
        };
      });
    } else {
      bladen = paginas.map(({ dagdeel, tijdsblok: tb, sessie }) => {
        const s = metWijz(sessie!);
        return {
          naam: s.titel,
          breedtes: [5, 18, 22, 40, 14, 12],
          rijen: [
            [{ v: t(`tb:${tb!.id}.r3`, `${dagdeel.naam.toUpperCase()} ${tb!.naam}: ${tb!.startUur} – ${tb!.eindUur}`), vet: true }],
            [{ v: s.titel, vet: true }],
            [[s.lokaal && `${t('r3.lokaal', 'Lokaal')}: ${s.lokaal}`, s.lesgever && `${t('r3.leerkracht', 'Leerkracht')}: ${s.lesgever}`].filter(Boolean).join(' · ')],
            [],
            kop(['#', t('r3.voornaam', 'Voornaam'), t('r3.naam', 'Achternaam'), t('r3.school', 'School'), t('r3.leerjaar', 'Leerjaar'), '']),
            ...s.deelnemers.map((d, i): Cel[] => [i + 1, d.voornaam, d.naam, d.school, d.leerjaar, d.status === 'wachtlijst' ? 'wachtlijst' : null]),
            ...voet,
          ],
        };
      });
    }
    if (!bladen.length) return;
    const naam = SOORTEN.find((x) => x.soort === soort)!.label;
    download(maakXlsx(bladen), `${data.evenement.slug} – ${naam}.xlsx`);
  };

  return (
    <BewerkContext.Provider value={bewerken}>
      <div className={`rapporten rapporten--${soort}`}>
        {soort === 'moment' && <style>{'@page { size: A4 landscape; }'}</style>}
        <div className="r-scherm">
          <nav className="d-kruimel" aria-label="Kruimelpad">
            <Link href="/dashboard">Evenementen</Link> › <Link href={`/dashboard/evenementen/${evenementId}`}>{data.evenement.titel}</Link> › <span>Rapporten</span>
          </nav>
          <header className="d-paginakop">
            <h1>Rapporten</h1>
            <Link href={etiketUrl(evenementId)} className="d-knop d-knop--secundair">Etiketten</Link>
          </header>
          <div className="r-tabs" role="tablist">
            {SOORTEN.map((x) => (
              <button key={x.soort} type="button" role="tab" aria-selected={soort === x.soort} className={soort === x.soort ? 'actief' : undefined} onClick={() => kiesSoort(x.soort)}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="d-werkbalk r-werkbalk">
            <select value={dagdeelId} aria-label="Dagdeel" onChange={(e) => { setDagdeelId(e.target.value); setTijdsblokId('alle'); setSessieId('alle'); }}>
              <option value="alle">Alle dagdelen</option>
              {alleDagdelen.map(({ dag, dagdeel }) => (
                <option key={dagdeel.id} value={dagdeel.id}>{dag.naam} – {dagdeel.naam}</option>
              ))}
            </select>
            {soort !== 'dagdeel' && (
              <select value={tijdsblokId} aria-label="Moment" onChange={(e) => { setTijdsblokId(e.target.value); setSessieId('alle'); }}>
                <option value="alle">Alle momenten</option>
                {blokkenKeuze.map(({ dag, dagdeel, t: tb }) => (
                  <option key={tb.id} value={tb.id}>{dagdeelId === 'alle' ? `${dag.naam} – ${dagdeel.naam} – ` : ''}{tb.naam}</option>
                ))}
              </select>
            )}
            {soort === 'lesje' && (
              <select value={sessieId} aria-label="Lesje" onChange={(e) => setSessieId(e.target.value)}>
                <option value="alle">Alle lesjes</option>
                {sessiesKeuze.map(({ t: tb, s }) => (
                  <option key={s.id} value={s.id}>{tijdsblokId === 'alle' ? `${tb.naam} – ` : ''}{s.titel}</option>
                ))}
              </select>
            )}
            <span className="r-werkbalk__knoppen">
              <button type="button" className="d-knop" onClick={() => print()} disabled={!paginas.length}>Afdrukken</button>
              <button type="button" className="d-knop d-knop--secundair" onClick={exporteer} disabled={!paginas.length}>Exporteren naar Excel</button>
              {data.kanSchrijven && (
                <button type="button" className="d-knop d-knop--secundair" onClick={mail} disabled={bezig || !sessiesOpPaginas.length}>Mailen naar leerkrachten</button>
              )}
            </span>
          </div>
          {data.kanSchrijven && (
            <p className="d-klein">Klik op een titel, kolomkop of (in het overzicht per dagdeel) een gegeven van een lesje om het te wijzigen.</p>
          )}
          {aantalWijzigingen > 0 && (
            <div className="r-bewaarbalk" role="region" aria-label="Niet bewaarde wijzigingen">
              <span>{aantalWijzigingen} wijziging(en) nog niet bewaard.</span>
              <button type="button" className="d-knop" onClick={bewaar} disabled={bezig}>{bezig ? 'Bezig…' : 'Bewaren'}</button>
              <button type="button" className="d-knop d-knop--secundair" disabled={bezig} onClick={() => { setTeksten({}); setSessieWijz({}); }}>Ongedaan maken</button>
            </div>
          )}
          {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}
          {!paginas.length && <Melding>Niets om te tonen voor deze keuze.</Melding>}
        </div>

        {paginas.map((p) => (
          <section key={p.sleutel} className="r-pagina">
            {soort === 'dagdeel' && (
              <OverzichtDagdeel
                p={p}
                evenementId={evenementId}
                metWijz={metWijz}
                locaties={data.locaties}
                wijzigSessie={(id, w) => setSessieWijz((oud) => ({ ...oud, [id]: { ...oud[id], ...w } }))}
              />
            )}
            {soort === 'moment' && <PerMoment p={p} metWijz={metWijz} evenementId={evenementId} />}
            {soort === 'lesje' && <Klaslijst p={p} metWijz={metWijz} />}
            <footer className="r-voet">{voettekst}</footer>
          </section>
        ))}
      </div>
    </BewerkContext.Provider>
  );
}

/**
 * Kleine QR-code op elk rapport: de klaslijst opent de live tabel van dat lesje (/les/<id>, voor de sessiegever),
 * de overzichten openen de aanwezigheid van het hele evenement (onthaal).
 */
function OverzichtQr({ evenementId }: { evenementId: string }) {
  return <Qr tekst={`${location.origin}/dashboard/evenementen/${evenementId}/aanwezigheid`} label="QR-code: live aanwezigheid" className="r-qr r-qr--kop" />;
}

// ---------------------------------------------------------------------------
// 1. Overzicht per dagdeel
// ---------------------------------------------------------------------------
function OverzichtDagdeel({ p, metWijz, locaties, wijzigSessie, evenementId }: {
  p: Pagina;
  evenementId: string;
  metWijz: (s: RapportSessie) => RapportSessie;
  locaties: Rapport['locaties'];
  wijzigSessie: (id: string, w: SessieWijziging) => void;
}) {
  const { kan } = useContext(BewerkContext);
  const { dag, dagdeel } = p;
  return (
    <>
      <header className="r-kop">
        <h2><T k={`dd:${dagdeel.id}.r1`} s={`${dag.naam} – ${dagdeel.naam}`} /></h2>
        <span className="r-kop__totaal"><T k="r1.totaal" s="Totaal ingeschreven" />: {dagdeel.ingeschreven}{dagdeel.capaciteit != null && ` / ${dagdeel.capaciteit}`}</span>
        <OverzichtQr evenementId={evenementId} />
      </header>
      {dagdeel.tijdsblokken.length === 0 && <p>Geen keuzemomenten in dit dagdeel.</p>}
      {dagdeel.tijdsblokken.map((tb) => (
        <div key={tb.id} className="r-blok">
          <h3><T k={`tb:${tb.id}.r1`} s={`${tb.naam} (${tb.startUur} – ${tb.eindUur})`} /></h3>
          <table className="r-tabel">
            <thead>
              <tr>
                <th><T k="r1.lesje" s="Lesje" /></th>
                <th><T k="r1.lokaal" s="Lokaal" /></th>
                <th><T k="r1.leerkracht" s="Leerkracht" /></th>
                <th className="getal"><T k="r1.max" s="Maximum" /></th>
                <th className="getal"><T k="r1.ingeschreven" s="Ingeschreven" /></th>
                <th className="getal"><T k="r1.wachtlijst" s="Wachtlijst" /></th>
                <th className="getal"><T k="r1.beschikbaar" s="Beschikbaar" /></th>
              </tr>
            </thead>
            <tbody>
              {tb.sessies.map(metWijz).map((s) => {
                const v = vrij(s);
                const uit = s.status !== 'open' || !s.zichtbaar;
                return (
                  <tr key={s.id} className={uit ? 'r-uit' : undefined} title={uit ? (s.status !== 'open' ? s.status : 'verborgen') : undefined}>
                    <td><Bewerkbaar kan={kan} label="Titel" waarde={s.titel} onWijzig={(w) => w && wijzigSessie(s.id, { titel: w })} /></td>
                    <td>
                      {kan ? (
                        <>
                          <select className="r-select r-scherm" value={s.locatieId ?? ''} aria-label={`Lokaal van ${s.titel}`} onChange={(e) => wijzigSessie(s.id, { locatie_id: e.target.value })}>
                            <option value="">—</option>
                            {locaties.map((l) => (
                              <option key={l.waarde} value={l.waarde}>{l.label}</option>
                            ))}
                          </select>
                          <span className="r-print">{s.lokaal}</span>
                        </>
                      ) : (
                        s.lokaal
                      )}
                    </td>
                    <td><Bewerkbaar kan={kan} label="Leerkracht" waarde={s.lesgever ?? ''} onWijzig={(w) => wijzigSessie(s.id, { lesgever: w })} /></td>
                    <td className="getal">
                      <Bewerkbaar
                        kan={kan}
                        label="Maximum"
                        waarde={s.capaciteit == null ? '' : String(s.capaciteit)}
                        onWijzig={(w) => (w === '' || /^\d+$/.test(w)) && wijzigSessie(s.id, { capaciteit: w })}
                      />
                    </td>
                    <td className="getal">{s.bevestigd}</td>
                    <td className="getal">{s.wachtlijst || ''}</td>
                    <td className={`getal${v === 0 ? ' r-vol' : ''}`}>{v ?? '∞'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Inschrijvingen per moment
// ---------------------------------------------------------------------------
function momentKolommen(tb: RapportTijdsblok, metWijz: (s: RapportSessie) => RapportSessie, t: Bewerken['tekst']) {
  const kolommen = tb.sessies.map(metWijz).map((s) => ({
    id: s.id,
    titel: s.titel,
    aantal: s.bevestigd,
    namen: s.deelnemers.map((d) => (d.status === 'wachtlijst' ? `${volleNaam(d)} (wachtlijst)` : volleNaam(d))),
  }));
  if (tb.zonderKeuze.length) {
    kolommen.push({ id: 'zonder', titel: t('r2.zonder', 'Geen lesje gekozen'), aantal: tb.zonderKeuze.length, namen: tb.zonderKeuze.map(volleNaam) });
  }
  return kolommen;
}

function PerMoment({ p, metWijz, evenementId }: { p: Pagina; metWijz: (s: RapportSessie) => RapportSessie; evenementId: string }) {
  const b = useContext(BewerkContext);
  const tb = p.tijdsblok!;
  const kolommen = momentKolommen(tb, metWijz, b.tekst);
  const max = Math.max(0, ...kolommen.map((k) => k.namen.length));
  return (
    <>
      <header className="r-kop">
        <h2><T k={`tb:${tb.id}.r2`} s={`${p.dagdeel.naam} ${tb.naam} – start ${tb.startUur}`} /></h2>
        <span className="r-kop__totaal">{p.dag.naam}</span>
        <OverzichtQr evenementId={evenementId} />
      </header>
      <table className="r-tabel r-tabel--kolommen">
        <thead>
          <tr>
            {kolommen.map((k) => (
              <th key={k.id}>{k.id === 'zonder' ? <T k="r2.zonder" s="Geen lesje gekozen" /> : k.titel}</th>
            ))}
          </tr>
          <tr className="r-aantal">
            {kolommen.map((k) => (
              <td key={k.id} className="getal">{k.aantal}</td>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: max }, (_, i) => (
            <tr key={i}>
              {kolommen.map((k) => (
                <td key={k.id}>{k.namen[i] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Klaslijst per lesje
// ---------------------------------------------------------------------------
function Klaslijst({ p, metWijz }: { p: Pagina; metWijz: (s: RapportSessie) => RapportSessie }) {
  const { tekst } = useContext(BewerkContext);
  const tb = p.tijdsblok!;
  const s = metWijz(p.sessie!);
  const bevestigd = s.deelnemers.filter((d) => d.status === 'bevestigd');
  const wachtlijst = s.deelnemers.filter((d) => d.status === 'wachtlijst');
  // Lege genummerde regels tot het maximum: plaats voor wie er op de dag zelf bij komt
  const regels = Math.max(bevestigd.length, s.capaciteit ?? 0);
  return (
    <>
      <header className="r-balk">
        <Qr tekst={`${location.origin}/les/${s.id}`} label={`QR-code: live aanwezigheid van ${s.titel}`} className="r-qr" />
        <h2><T k={`tb:${tb.id}.r3`} s={`${p.dagdeel.naam.toUpperCase()} ${tb.naam}: ${tb.startUur} – ${tb.eindUur}`} /></h2>
        <p className="r-balk__lesje">{s.titel}</p>
        <p className="r-balk__info">
          {[p.dag.naam, s.lokaal && `${tekst('r3.lokaal', 'Lokaal')}: ${s.lokaal}`, s.lesgever && `${tekst('r3.leerkracht', 'Leerkracht')}: ${s.lesgever}`].filter(Boolean).join(' · ')}
          {' · '}{bevestigd.length}{s.capaciteit != null && ` / ${s.capaciteit}`} ingeschreven
        </p>
      </header>
      <table className="r-tabel r-tabel--klaslijst">
        <thead>
          <tr>
            <th className="getal">#</th>
            <th><T k="r3.voornaam" s="Voornaam" /></th>
            <th><T k="r3.naam" s="Achternaam" /></th>
            <th><T k="r3.school" s="School" /></th>
            <th><T k="r3.leerjaar" s="Leerjaar" /></th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: regels }, (_, i) => {
            const d = bevestigd[i];
            return (
              <tr key={i}>
                <td className="getal">{i + 1}</td>
                <td>{d?.voornaam}</td>
                <td>{d?.naam}</td>
                <td>{d?.school}</td>
                <td>{d?.leerjaar}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {wachtlijst.length > 0 && (
        <>
          <h3><T k="r3.wachtlijst" s="Wachtlijst" /></h3>
          <ol className="r-wachtlijst">
            {wachtlijst.map((d, i) => (
              <li key={i}>{volleNaam(d)} – {d.school} ({d.leerjaar})</li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

export const rapportUrl = (evenementId: string, soort: Soort = 'dagdeel') => `/dashboard/evenementen/${evenementId}/rapporten?r=${soort}`;
