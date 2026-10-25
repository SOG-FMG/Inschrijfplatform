import { useEffect, useMemo, useState } from 'react';
import { historiekApi, type EvenementKort, type ImportVerslag, type InschrijvingImportRij, type Profiel, type SessiegeverVerslag } from '../services/beheerApi';
import { decodeer, herkenDatumvorm, leesCsv, schoon, type Datumvorm } from './import/importlogica';
import {
  bouwProgramma, heeftKopregel, INS_VELDEN, leesAanwezig, leesDoelgroep, leesTijdsblok, leesTijdstempel, schooljaarVan, stelInsKoppelingVoor,
  type InsKoppeling, type InsVeld,
} from './import/inschrijvingen';
import { KinderenNakijken, maakSchoolKeuzes, ScholenKoppelen, schoolVan, useScholen, type PersoonNakijk, type SchoolKeuze } from './import/Koppelen';
import { datum, foutTekst, Invoer, Link, Melding, Venster } from './ui';
import { NieuweImport } from './Voorinschrijvingen';

/**
 * Importeren in een evenement (meestal een vorig schooljaar): inschrijvingen met hun lesjes (het programma volgt
 * uit het bestand), voorinschrijvingen, en sessiegevers. Bestanden worden enkel in de browser gelezen.
 */

type Tab = 'inschrijvingen' | 'voorinschrijvingen' | 'sessiegevers';

export function Importeren({ profiel, naVerandering }: { profiel: Profiel; naVerandering: () => void }) {
  const mag = (r: string) => profiel.rechten.includes(r);
  const [evenementId, setEvenementId] = useState(() => new URLSearchParams(location.search).get('evenement') ?? '');
  const [tab, setTab] = useState<Tab>(mag('historiek.importeren') ? 'inschrijvingen' : 'voorinschrijvingen');
  const [nieuw, setNieuw] = useState(false);
  const [voorKlaar, setVoorKlaar] = useState(false);
  const evenement = profiel.evenementen.find((e) => e.id === evenementId);
  const tabs: [Tab, string, boolean][] = [
    ['inschrijvingen', 'Inschrijvingen (met lesjes)', mag('historiek.importeren')],
    ['voorinschrijvingen', 'Voorinschrijvingen', mag('voorinschrijvingen.beheren')],
    ['sessiegevers', 'Sessiegevers', mag('historiek.importeren')],
  ];

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Importeren</h1>
          <p className="d-sub">Zet de gegevens van een schooljaar in een evenement: inschrijvingen met hun lesjes, voorinschrijvingen en sessiegevers.</p>
        </div>
      </header>

      <section className="d-kaart">
        <h2>1. Evenement</h2>
        <div className="d-werkbalk">
          <select aria-label="Evenement" value={evenementId} onChange={(e) => setEvenementId(e.target.value)}>
            <option value="">Kies een evenement…</option>
            {profiel.evenementen.map((e) => <option key={e.id} value={e.id}>{e.titel} ({schooljaarVan(e.start)})</option>)}
          </select>
          {mag('evenementen.aanmaken') && mag('historiek.importeren') && (
            <button type="button" className="d-knop d-knop--secundair" onClick={() => setNieuw(true)}>+ Evenement voor een vorig schooljaar</button>
          )}
        </div>
        {evenement && (
          <p className="d-klein">
            Schooljaar {schooljaarVan(evenement.start)} · {evenement.start === evenement.eind ? datum(evenement.start) : `${datum(evenement.start)} – ${datum(evenement.eind)}`} ·{' '}
            {evenement.deelnemers} inschrijving(en) · gegevens bewaard tot {datum(bewaarTot(evenement))} ·{' '}
            <Link href={`/dashboard/evenementen/${evenement.id}/overzicht`}>Overzicht</Link> · <Link href={`/dashboard/evenementen/${evenement.id}`}>Instellingen</Link>
          </p>
        )}
      </section>

      {evenement && (
        <>
          <div className="h-tabs" role="tablist">
            {tabs.filter(([, , zichtbaar]) => zichtbaar).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'actief' : undefined} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'inschrijvingen' && <ImportInschrijvingen key={evenement.id} evenement={evenement} naKlaar={naVerandering} />}
          {tab === 'voorinschrijvingen' && (voorKlaar ? (
            <Melding soort="ok">
              De voorinschrijvingen zijn geïmporteerd. Je ziet ze in het <Link href={`/dashboard/evenementen/${evenement.id}/overzicht`}>overzicht</Link> en
              onder <Link href="/dashboard/voorinschrijvingen">Voorinschrijvingen</Link>.{' '}
              <button type="button" className="d-link" onClick={() => setVoorKlaar(false)}>Nog een bestand importeren</button>
            </Melding>
          ) : (
            <NieuweImport key={evenement.id} evenementen={profiel.evenementen} evenementId={evenement.id} onAnnuleer={() => setTab('inschrijvingen')}
              onKlaar={() => setVoorKlaar(true)} />
          ))}
          {tab === 'sessiegevers' && <ImportSessiegevers key={evenement.id} evenementId={evenement.id} />}
        </>
      )}

      {nieuw && (
        <NieuwVorigEvenement
          onSluit={() => setNieuw(false)}
          naKlaar={(id) => {
            setNieuw(false);
            naVerandering();
            setEvenementId(id);
          }}
        />
      )}
    </>
  );
}

const bewaarTot = (e: EvenementKort) => {
  const d = new Date(`${e.eind}T12:00:00`);
  d.setDate(d.getDate() + e.bewaartermijn);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Evenement voor een vorig schooljaar
// ---------------------------------------------------------------------------

function NieuwVorigEvenement({ onSluit, naKlaar }: { onSluit: () => void; naKlaar: (id: string) => void }) {
  const huidig = Number(schooljaarVan(new Date().toISOString().slice(0, 10)).slice(0, 4));
  const jaren = [1, 2, 3, 4].map((n) => `${huidig - n}-${huidig - n + 1}`);
  const [w, setW] = useState({ schooljaar: jaren[0], titel: `Infodagen ${jaren[0]}`, slug: `infodagen-${jaren[0]}`, bewaarTot: `${huidig + 1}-08-31` });
  const [fout, setFout] = useState<string | null>(null);
  return (
    <Venster titel="Evenement voor een vorig schooljaar" onSluit={onSluit}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setFout(null);
          try {
            naKlaar((await historiekApi.maakVorigEvenement(w)).id);
          } catch (err) {
            setFout(foutTekst(err, 'Aanmaken mislukt.'));
          }
        }}
      >
        {fout && <Melding soort="fout">{fout}</Melding>}
        <div className="d-veld">
          <label htmlFor="vorig-jaar">Schooljaar</label>
          <select id="vorig-jaar" value={w.schooljaar} onChange={(e) => setW({ ...w, schooljaar: e.target.value, titel: `Infodagen ${e.target.value}`, slug: `infodagen-${e.target.value}` })}>
            {jaren.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <Invoer label="Titel" waarde={w.titel} verplicht onWijzig={(v) => setW({ ...w, titel: v })} />
        <Invoer label="Adres (slug)" waarde={w.slug} verplicht onWijzig={(v) => setW({ ...w, slug: v })} hulp="Uniek; het evenement is gearchiveerd en niet zichtbaar voor ouders." />
        <Invoer label="Gegevens bewaren tot" type="date" waarde={w.bewaarTot} verplicht onWijzig={(v) => setW({ ...w, bewaarTot: v })}
          hulp="Daarna worden namen en contactgegevens automatisch gewist; de aantallen blijven. Stem deze termijn af met de DPO." />
        <Melding>De datums van het evenement volgen na de import uit de dagen in het bestand.</Melding>
        <div className="d-knoppen">
          <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
          <button type="submit" className="d-knop">Aanmaken</button>
        </div>
      </form>
    </Venster>
  );
}

// ---------------------------------------------------------------------------
// Inschrijvingen (met lesjes)
// ---------------------------------------------------------------------------

/** Kolomnamen van het vorige bestand (geen persoonsgegevens), voor een bestand zonder kopregel. */
const KOP_SLEUTEL = 'import.inschrijvingen.kolommen';
const leesKop = (): string[] | null => {
  try {
    const k = JSON.parse(localStorage.getItem(KOP_SLEUTEL) ?? 'null');
    return Array.isArray(k) && k.every((x) => typeof x === 'string') ? k : null;
  } catch {
    return null;
  }
};
const bewaarKop = (k: string[]) => {
  try {
    localStorage.setItem(KOP_SLEUTEL, JSON.stringify(k));
  } catch {
    /* privévenster: niet erg */
  }
};

interface Bestand { naam: string; kolommen: string[]; rijen: string[][]; kop: 'bestand' | 'vorige' | 'geen' }

function ImportInschrijvingen({ evenement, naKlaar }: { evenement: EvenementKort; naKlaar: () => void }) {
  const schooljaar = schooljaarVan(evenement.start);
  const [bestand, setBestand] = useState<Bestand | null>(null);
  const [koppeling, setKoppeling] = useState<InsKoppeling | null>(null);
  const [datumvorm, setDatumvorm] = useState<Datumvorm | ''>('');
  const [keuzes, setKeuzes] = useState<SchoolKeuze[]>([]);
  const [personen, setPersonen] = useState<PersoonNakijk[] | null>(null);
  const [verslag, setVerslag] = useState<ImportVerslag | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const scholen = useScholen((e) => setFout(foutTekst(e)));

  const cel = (r: string[], veld: InsVeld) => (koppeling?.velden[veld] != null ? schoon(r[koppeling.velden[veld]!] ?? '') : '');

  async function kies(f: File) {
    setFout(null);
    setVerslag(null);
    const gelezen = leesCsv(decodeer(await f.arrayBuffer()));
    let { kolommen, rijen } = gelezen;
    let kop: Bestand['kop'] = 'bestand';
    if (!heeftKopregel(kolommen)) {
      if (kolommen.some((c) => c.trim())) rijen = [kolommen, ...rijen];
      const breedte = Math.max(kolommen.length, ...rijen.map((r) => r.length));
      const vorige = leesKop();
      kop = vorige?.length === breedte ? 'vorige' : 'geen';
      kolommen = kop === 'vorige' ? vorige! : Array.from({ length: breedte }, (_, i) => `Kolom ${i + 1}`);
    }
    if (!rijen.length) return setFout('Dit bestand bevat geen rijen.');
    if (kop === 'bestand') bewaarKop(kolommen);
    const k = stelInsKoppelingVoor(kolommen, rijen);
    setBestand({ naam: f.name, kolommen, rijen, kop });
    setKoppeling(k);
    setDatumvorm(k.velden.ingediendOp != null ? herkenDatumvorm(rijen.map((r) => r[k.velden.ingediendOp!] ?? '')) ?? '' : '');
  }

  const programma = useMemo(() => (bestand && koppeling ? bouwProgramma(bestand.rijen, koppeling, schooljaar) : null), [bestand, koppeling, schooljaar]);

  useEffect(() => {
    if (!bestand || !scholen.length) return;
    setKeuzes(maakSchoolKeuzes(bestand.rijen.map((r) => cel(r, 'school')), scholen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestand, scholen, koppeling?.velden.school]);
  useEffect(() => setPersonen(null), [bestand, koppeling]);

  const kindVan = (r: string[]) => ({ kindVoornaam: cel(r, 'kindVoornaam') || null, kindNaam: cel(r, 'kindNaam') || null });

  async function kijkKinderenNa() {
    if (!bestand || !programma) return;
    setFout(null);
    try {
      const r = await historiekApi.controleerKinderen(bestand.rijen.map((x, i) => ({ email: cel(x, 'email') || null, ...kindVan(x), dagdeel: programma.rijen[i].dagdeel })));
      setPersonen(r.map((p) => ({ ...p, keuze: '' })));
    } catch (e) {
      setFout(foutTekst(e));
    }
  }

  const zonderMoment = programma?.rijen.filter((r) => !r.dagdeel).length ?? 0;
  const onbekend = programma?.rijen.reduce((n, r) => n + r.onbekend, 0) ?? 0;
  const openScholen = keuzes.filter((k) => !k.keuze).length;
  const openPersonen = personen?.filter((p) => p.status === 'twijfel' && !p.keuze).length ?? 0;
  const klaar = !!programma?.dagen.length && (koppeling?.velden.ingediendOp == null || !!datumvorm) && openScholen === 0 && !!personen && openPersonen === 0;

  async function importeer() {
    if (!bestand || !programma) return;
    setBezig(true);
    setFout(null);
    const rijen: InschrijvingImportRij[] = bestand.rijen.map((r, i) => ({
      ingediendOp: datumvorm ? leesTijdstempel(cel(r, 'ingediendOp'), datumvorm) : null,
      email: cel(r, 'email') || null,
      ouderVoornaam: cel(r, 'ouderVoornaam') || null,
      ouderNaam: cel(r, 'ouderNaam') || null,
      telefoon: cel(r, 'telefoon') || null,
      ...kindVan(r),
      ...schoolVan(keuzes, cel(r, 'school')),
      leerjaar: cel(r, 'leerjaar') || null,
      doelgroep: leesDoelgroep(cel(r, 'doelgroep')),
      dagdeel: programma.rijen[i].dagdeel,
      sessies: programma.rijen[i].sessies,
      aanwezig: leesAanwezig(cel(r, 'aanwezig')),
      opmerkingen: cel(r, 'opmerkingen') || null,
      ...(personen?.[i]?.status === 'twijfel' ? { persoonKeuze: personen[i].keuze } : {}),
    }));
    try {
      setVerslag(await historiekApi.importeerInschrijvingen(evenement.id, { programma: programma.dagen, rijen }));
      setBestand(null);
      setKoppeling(null);
      naKlaar();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  const gebruikt = new Set([...(koppeling ? Object.values(koppeling.velden).filter((x): x is number => x != null) : [])]);

  return (
    <section className="d-kaart">
      <h2>2. Inschrijvingen importeren</h2>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {verslag && <VerslagInschrijvingen verslag={verslag} evenementId={evenement.id} />}
      <Melding soort="let-op">Het bestand bevat persoonsgegevens van kinderen en ouders. Het wordt enkel in je browser gelezen; namen en contactgegevens worden versleuteld bewaard. Verwijder het bestand van je computer na de import.</Melding>
      <p className="d-klein">
        Een export (CSV) van het inschrijfformulier, bv. uit Google Formulieren (Bestand → Downloaden → CSV). Dagen, momenten, tijdsblokken en lesjes worden
        aangemaakt uit wat in het bestand staat. Opnieuw importeren mag: wie er al staat, wordt overgeslagen; een nieuwere inzending vervangt de vorige.
      </p>
      <div className="d-veld">
        <label htmlFor="ins-bestand">CSV-bestand</label>
        <input id="ins-bestand" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && kies(e.target.files[0])} />
      </div>

      {bestand && koppeling && programma && (
        <>
          {bestand.kop === 'vorige' && <Melding>Dit bestand heeft geen kopregel. De kolomnamen van het vorige bestand ({bestand.kolommen.length} kolommen) worden gebruikt; kijk de koppeling na.</Melding>}
          {bestand.kop === 'geen' && <Melding soort="let-op">Dit bestand heeft geen kopregel en het aantal kolommen verschilt van het vorige bestand. Koppel de kolommen hieronder zelf en geef elk lesje-kolom een tijdsblok.</Melding>}

          <h3>Kolommen <span className="d-klein">({bestand.rijen.length} rijen)</span></h3>
          <div className="d-tabelvak">
            <table className="d-tabel d-tabel--compact">
              <thead><tr><th>Veld</th><th>Kolom in het bestand</th><th>Voorbeeld (eerste rij)</th></tr></thead>
              <tbody>
                {INS_VELDEN.map(({ veld, label }) => (
                  <tr key={veld}>
                    <td>{label}</td>
                    <td>
                      <select aria-label={`Kolom voor ${label}`} value={koppeling.velden[veld] ?? ''}
                        onChange={(e) => setKoppeling({ ...koppeling, velden: { ...koppeling.velden, [veld]: e.target.value === '' ? null : Number(e.target.value) } })}>
                        <option value="">(niet gebruiken)</option>
                        {bestand.kolommen.map((k, i) => <option key={i} value={i}>{k || `kolom ${i + 1}`}</option>)}
                      </select>
                    </td>
                    <td className="d-klein pii">{cel(bestand.rijen[0], veld) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {koppeling.velden.ingediendOp != null && (
            <div className="d-veld">
              <label htmlFor="ins-datumvorm">Datums in het bestand</label>
              <select id="ins-datumvorm" value={datumvorm} onChange={(e) => setDatumvorm(e.target.value as Datumvorm)}>
                <option value="">Kies…</option>
                <option value="DMJ">dag/maand/jaar (8/12/2025 = 8 december 2025)</option>
                <option value="MDJ">maand/dag/jaar (8/12/2025 = 12 augustus 2025)</option>
              </select>
            </div>
          )}

          <h3>Moment en lesjes</h3>
          <p className="d-klein">Per rij telt de laatst ingevulde momentkolom. Het tijdsblok van een lesje volgt uit de kolom (bv. "Keuzelesje 1") en het moment van die rij.</p>
          <div className="d-tabelvak">
            <table className="d-tabel d-tabel--compact">
              <thead><tr><th>Kolom</th><th>Moment</th><th>Lesje</th><th>Tijdsblok</th><th>Start</th><th>Voorbeeld</th></tr></thead>
              <tbody>
                {bestand.kolommen.map((k, i) => {
                  if (gebruikt.has(i)) return null;
                  const lesje = koppeling.lesjes.find((l) => l.kolom === i);
                  const voorbeeld = bestand.rijen.map((r) => schoon(r[i] ?? '')).find(Boolean) ?? '';
                  const zetLesje = (aan: boolean) => setKoppeling({
                    ...koppeling,
                    momenten: koppeling.momenten.filter((m) => m !== i),
                    lesjes: aan ? [...koppeling.lesjes, { kolom: i, ...leesTijdsblok(k) }].sort((a, b) => a.kolom - b.kolom) : koppeling.lesjes.filter((l) => l.kolom !== i),
                  });
                  const wijzigLesje = (w: Partial<typeof lesje>) => setKoppeling({ ...koppeling, lesjes: koppeling.lesjes.map((l) => (l.kolom === i ? { ...l, ...w } : l)) });
                  return (
                    <tr key={i}>
                      <td>{k || `Kolom ${i + 1}`}</td>
                      <td><input type="checkbox" aria-label={`${k}: moment`} checked={koppeling.momenten.includes(i)}
                        onChange={(e) => setKoppeling({ ...koppeling, lesjes: koppeling.lesjes.filter((l) => l.kolom !== i),
                          momenten: e.target.checked ? [...koppeling.momenten, i].sort((a, b) => a - b) : koppeling.momenten.filter((m) => m !== i) })} /></td>
                      <td><input type="checkbox" aria-label={`${k}: lesje`} checked={!!lesje} onChange={(e) => zetLesje(e.target.checked)} /></td>
                      <td>{lesje && <input aria-label={`${k}: tijdsblok`} value={lesje.tijdsblok} onChange={(e) => wijzigLesje({ tijdsblok: e.target.value })} />}</td>
                      <td>{lesje && <input type="time" aria-label={`${k}: start`} value={lesje.start ?? ''} onChange={(e) => wijzigLesje({ start: e.target.value || null })} />}</td>
                      <td className="d-klein pii">{voorbeeld.slice(0, 60) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3>Programma uit het bestand <span className="d-klein">(schooljaar {schooljaar})</span></h3>
          {programma.onleesbaar.length > 0 && (
            <Melding soort="let-op">Geen datum gevonden in: {programma.onleesbaar.map(([t, n]) => `"${t}" (${n})`).join(', ')}. Die rijen worden niet geïmporteerd.</Melding>
          )}
          {zonderMoment > 0 && <p className="d-klein">{zonderMoment} rij(en) zonder (leesbaar) moment worden overgeslagen.</p>}
          {onbekend > 0 && <p className="d-klein">{onbekend} keuze(s) waren onbekend in het bestand (#ERROR!): die rijen krijgen daar geen lesje.</p>}
          {programma.dagen.length === 0 ? <Melding soort="fout">Er is nog geen moment herkend. Duid de kolom(men) met het moment aan.</Melding> : (
            <ul className="h-programma">
              {programma.dagen.map((d) => (
                <li key={d.sleutel}><strong>{d.naam}</strong> <span className="d-klein">{datum(d.datum)}</span>
                  <ul>
                    {d.dagdelen.map((dd) => (
                      <li key={dd.sleutel}>{dd.naam} {dd.start}–{dd.eind} <span className="d-klein">· {programma.aantal[dd.sleutel] ?? 0} inschrijving(en)</span>
                        <ul>
                          {dd.tijdsblokken.map((t) => (
                            <li key={t.sleutel}>{t.naam} <span className="d-klein">vanaf {t.start}:</span>{' '}
                              {t.sessies.map((s) => `${s.titel} (${programma.aantal[s.sleutel] ?? 0})`).join(', ')}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {koppeling.velden.school != null && (
            <>
              <h3>Scholen koppelen aan de officiële lijst</h3>
              <ScholenKoppelen keuzes={keuzes} scholen={scholen} onWijzig={setKeuzes} />
            </>
          )}

          <h3>Kinderen en gezinnen</h3>
          <p className="d-klein">
            Eén gezin per e-mailadres. Een kind dat al bekend is (ook uit een ander schooljaar of een voorinschrijving), wordt herkend; een broer of zus wordt
            een nieuw kind bij hetzelfde gezin. Bij een naam die bijna hetzelfde is, kies jij.
          </p>
          {!personen ? (
            <button type="button" className="d-knop d-knop--secundair" onClick={kijkKinderenNa} disabled={!programma.dagen.length}>Kinderen nakijken</button>
          ) : (
            <KinderenNakijken personen={personen} onWijzig={setPersonen} naam={(i) => [cel(bestand.rijen[i], 'kindVoornaam'), cel(bestand.rijen[i], 'kindNaam')].filter(Boolean).join(' ')} />
          )}

          <div className="d-knoppen">
            <button type="button" className="d-knop" disabled={!klaar || bezig} onClick={importeer}>
              {bezig ? 'Bezig…' : `${bestand.rijen.length - zonderMoment} inschrijvingen importeren in ${evenement.titel}`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function VerslagInschrijvingen({ verslag: v, evenementId }: { verslag: ImportVerslag; evenementId: string }) {
  return (
    <Melding soort="ok">
      <strong>Geïmporteerd: {v.geimporteerd} inschrijving(en)</strong>{v.vervangen > 0 && `, ${v.vervangen} vervangen door een nieuwere inzending`}, {v.lesjes} lesje(s) ·{' '}
      {v.nieuweKinderen} nieuw(e) kind(eren).
      {v.dubbelInBestand > 0 && ` ${v.dubbelInBestand} oudere inzending(en) van hetzelfde kind overgeslagen.`}
      {v.alIngeschreven > 0 && ` ${v.alIngeschreven} stonden er al.`}
      {v.zonderMoment > 0 && ` ${v.zonderMoment} zonder moment overgeslagen.`}
      {v.zonderNaam > 0 && ` ${v.zonderNaam} zonder naam overgeslagen.`}
      {' '}Nieuw in het programma: {v.programma.dagen} dag(en), {v.programma.dagdelen} moment(en), {v.programma.tijdsblokken} tijdsblok(ken), {v.programma.sessies} lesje(s).{' '}
      <Link href={`/dashboard/evenementen/${evenementId}/overzicht`}>Naar het overzicht en de dubbels</Link>
    </Melding>
  );
}

// ---------------------------------------------------------------------------
// Sessiegevers
// ---------------------------------------------------------------------------

const SG_VELDEN = [
  { veld: 'voornaam', label: 'Voornaam', woorden: ['voornaam'] },
  { veld: 'naam', label: 'Naam (of volledige naam)', woorden: ['familienaam', 'achternaam', 'naam'] },
  { veld: 'email', label: 'E-mailadres', woorden: ['mail'] },
  { veld: 'lesjes', label: 'Lesje(s) (gescheiden door ;)', woorden: ['lesje', 'sessie', 'les', 'workshop'] },
] as const;
type SgVeld = (typeof SG_VELDEN)[number]['veld'];

function ImportSessiegevers({ evenementId }: { evenementId: string }) {
  const [bestand, setBestand] = useState<{ kolommen: string[]; rijen: string[][] } | null>(null);
  const [k, setK] = useState<Record<SgVeld, number | null> | null>(null);
  const [verslag, setVerslag] = useState<SessiegeverVerslag | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function kies(f: File) {
    setFout(null);
    setVerslag(null);
    const { kolommen, rijen } = leesCsv(decodeer(await f.arrayBuffer()));
    if (!rijen.length) return setFout('Dit bestand bevat geen rijen.');
    const kl = kolommen.map((c) => c.toLowerCase());
    const genomen = new Set<number>();
    const uit = {} as Record<SgVeld, number | null>;
    for (const { veld, woorden } of SG_VELDEN) {
      const i = woorden.map((w) => kl.findIndex((c, j) => !genomen.has(j) && c.includes(w))).find((j) => j >= 0);
      uit[veld] = i ?? null;
      if (i !== undefined) genomen.add(i);
    }
    setBestand({ kolommen, rijen });
    setK(uit);
  }

  const rijen = useMemo(() => {
    if (!bestand || !k) return [];
    const cel = (r: string[], v: SgVeld) => (k[v] != null ? schoon(r[k[v]!] ?? '') : '');
    return bestand.rijen.map((r) => {
      let voornaam = cel(r, 'voornaam');
      let naam = cel(r, 'naam');
      if (!voornaam && naam.includes(' ')) [voornaam, naam] = [naam.split(' ')[0], naam.split(' ').slice(1).join(' ')];
      return { voornaam, naam, email: cel(r, 'email').toLowerCase(), lesjes: cel(r, 'lesjes') || null };
    });
  }, [bestand, k]);

  async function importeer() {
    setBezig(true);
    setFout(null);
    try {
      setVerslag(await historiekApi.importeerSessiegevers(evenementId, rijen));
      setBestand(null);
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="d-kaart">
      <h2>2. Sessiegevers importeren</h2>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {verslag && (
        <Melding soort="ok">
          {verslag.nieuw} nieuwe sessiegever(s), {verslag.bestaand} bestonden al, {verslag.gekoppeld} koppeling(en) met een lesje.
          {verslag.buitenDomein > 0 && ` ${verslag.buitenDomein} overgeslagen: adres buiten de toegelaten domeinen.`}
          {verslag.ongeldig > 0 && ` ${verslag.ongeldig} overgeslagen: geen voornaam of geen geldig adres.`}
          {verslag.lesjesNietGevonden.length > 0 && ` Niet gevonden in dit evenement: ${verslag.lesjesNietGevonden.join(', ')}.`}{' '}
          <Link href={`/dashboard/evenementen/${evenementId}/sessiegevers`}>Naar de sessiegevers</Link>
        </Melding>
      )}
      <p className="d-klein">
        Een lijst (CSV) met voornaam, naam, e-mailadres en eventueel de titel van hun lesje(s). Wie al bestaat (zelfde e-mailadres), wordt niet dubbel aangemaakt.
        Lesjes worden gekoppeld op titel, in alle tijdsblokken van dit evenement; importeer dus eerst de inschrijvingen.
      </p>
      <div className="d-veld">
        <label htmlFor="sg-bestand">CSV-bestand</label>
        <input id="sg-bestand" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && kies(e.target.files[0])} />
      </div>
      {bestand && k && (
        <>
          <div className="d-rij">
            {SG_VELDEN.map(({ veld, label }) => (
              <div className="d-veld" key={veld}>
                <label htmlFor={`sg-${veld}`}>{label}</label>
                <select id={`sg-${veld}`} value={k[veld] ?? ''} onChange={(e) => setK({ ...k, [veld]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">(niet gebruiken)</option>
                  {bestand.kolommen.map((c, i) => <option key={i} value={i}>{c || `kolom ${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="d-tabelvak">
            <table className="d-tabel d-tabel--compact">
              <thead><tr><th>Voornaam</th><th>Naam</th><th>E-mailadres</th><th>Lesje(s)</th></tr></thead>
              <tbody>{rijen.slice(0, 15).map((r, i) => <tr key={i}><td>{r.voornaam}</td><td>{r.naam}</td><td>{r.email}</td><td>{r.lesjes ?? '—'}</td></tr>)}</tbody>
            </table>
          </div>
          {rijen.length > 15 && <p className="d-klein">… en nog {rijen.length - 15}.</p>}
          <div className="d-knoppen">
            <button type="button" className="d-knop" disabled={bezig || !rijen.length} onClick={importeer}>{bezig ? 'Bezig…' : `${rijen.length} sessiegever(s) importeren`}</button>
          </div>
        </>
      )}
    </section>
  );
}
