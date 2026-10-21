import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  etiketApi,
  type EtiketDeelnemer,
  type EtiketInstellingen,
  type EtiketLokaal,
  type EtiketRegel,
  type Etiketten as EtikettenData,
} from '../services/beheerApi';
import { foutTekst, Link, Melding } from './ui';

/**
 * Etiketten van een evenement (/dashboard/evenementen/<id>/etiketten): één etiket per deelnemer.
 * Blad, marges, aantal per blad en de regels (tekst met {velden}, pt, vet) zijn instelbaar en worden
 * per evenement bewaard. De afmeting van een etiket volgt uit het blad, de marges en het aantal.
 * Regels "per lesje" worden herhaald voor elk gekozen lesje; een "passende" regel blijft op één lijn
 * en wordt zo groot mogelijk (tot de opgegeven pt).
 */

export const etiketUrl = (evenementId: string) => `/dashboard/evenementen/${evenementId}/etiketten`;

export const STANDAARD: EtiketInstellingen = {
  blad: { breedte: 210, hoogte: 297 },
  kolommen: 3,
  rijen: 8,
  marge: { boven: 0, onder: 0, links: 0, rechts: 0 },
  tussen: { horizontaal: 0, verticaal: 0 },
  binnen: 3,
  regels: [
    { tekst: '{voornaam} {achternaam}', pt: 20, vet: false, passend: true, perLesje: false },
    { tekst: '{nr}) {verdieping}', pt: 10, vet: false, passend: false, perLesje: true },
    { tekst: '{lesje}', pt: 10, vet: true, passend: false, perLesje: true },
  ],
};

const VELDEN: [string, string][] = [
  ['voornaam', 'voornaam'],
  ['achternaam', 'achternaam'],
  ['school', 'huidige school'],
  ['leerjaar', 'leerjaar'],
  ['doelgroep', 'doelgroep'],
  ['evenement', 'titel van het evenement'],
];
const LESJE_VELDEN: [string, string][] = [
  ['nr', 'volgnummer (1, 2, …)'],
  ['lesje', 'titel van het lesje'],
  ['lokaal', 'lokaal'],
  ['verdieping', 'verdieping van het lokaal'],
  ['gebouw', 'gebouw'],
  ['moment', 'bv. Keuzelesje 1'],
  ['uur', 'bv. 10:00 – 10:30'],
];

/** {veld} vervangen; onbekende velden blijven staan zodat een tikfout opvalt. */
const vul = (tekst: string, w: Record<string, string>) => tekst.replace(/\{(\w+)\}/g, (m, k: string) => (k in w ? w[k] : m));

interface Regel {
  tekst: string;
  r: EtiketRegel;
}

/** De regels van één etiket, met de groepen "per lesje" herhaald. */
function regelsVan(d: EtiketDeelnemer, lesjes: EtiketDeelnemer['lesjes'], regels: EtiketRegel[], lokalen: Map<string, EtiketLokaal>, evenement: string): Regel[] {
  const basis: Record<string, string> = {
    voornaam: d.voornaam, achternaam: d.naam, naam: d.naam, school: d.school, leerjaar: d.leerjaar, doelgroep: d.doelgroep, evenement,
  };
  const uit: Regel[] = [];
  for (let i = 0; i < regels.length; ) {
    if (!regels[i].perLesje) {
      uit.push({ tekst: vul(regels[i].tekst, basis), r: regels[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < regels.length && regels[j].perLesje) j++;
    const groep = regels.slice(i, j);
    lesjes.forEach((l, n) => {
      const lok = l.locatieId ? lokalen.get(l.locatieId) : undefined;
      const w = {
        ...basis, nr: String(n + 1), lesje: l.titel, lokaal: lok ? lok.lokaal || lok.naam : '', verdieping: lok?.verdieping ?? '',
        gebouw: lok?.gebouw ?? '', moment: l.moment ?? '', uur: l.startUur ? `${l.startUur} – ${l.eindUur}` : '',
      };
      for (const r of groep) uit.push({ tekst: vul(r.tekst, w), r });
    });
    i = j;
  }
  return uit;
}

const nl = new Intl.Collator('nl', { sensitivity: 'base' });
const mm = (n: number) => `${Math.round(n * 100) / 100}mm`;
const getal = (n: number) => n.toLocaleString('nl-BE', { maximumFractionDigits: 1 });

export function Etiketten({ evenementId }: { evenementId: string }) {
  const [data, setData] = useState<EtikettenData | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [inst, setInst] = useState<EtiketInstellingen>(STANDAARD);
  const [bewaard, setBewaard] = useState<EtiketInstellingen>(STANDAARD);
  const [lokalen, setLokalen] = useState<EtiketLokaal[]>([]);
  const [dagdeelId, setDagdeelId] = useState('alle');
  const [sorteer, setSorteer] = useState<'naam' | 'school'>('naam');
  const [start, setStart] = useState(1);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout' | 'let-op'; tekst: ReactNode } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [teVol, setTeVol] = useState(0);
  const voorbeeld = useRef<HTMLDivElement>(null);

  useEffect(() => {
    etiketApi
      .lees(evenementId)
      .then((d) => {
        setData(d);
        setInst(d.instellingen ?? STANDAARD);
        setBewaard(d.instellingen ?? STANDAARD);
        setLokalen(d.lokalen);
        document.title = `Etiketten – ${d.evenement.titel}`;
      })
      .catch((e) => setFout(foutTekst(e, 'Laden mislukt.')));
  }, [evenementId]);

  const gewijzigd = JSON.stringify(inst) !== JSON.stringify(bewaard);
  useEffect(() => {
    if (!gewijzigd) return;
    const waarschuw = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', waarschuw);
    return () => removeEventListener('beforeunload', waarschuw);
  }, [gewijzigd]);

  // Afmeting van één etiket
  const breedte = (inst.blad.breedte - inst.marge.links - inst.marge.rechts - (inst.kolommen - 1) * inst.tussen.horizontaal) / inst.kolommen;
  const hoogte = (inst.blad.hoogte - inst.marge.boven - inst.marge.onder - (inst.rijen - 1) * inst.tussen.verticaal) / inst.rijen;
  const pastNiet = !(breedte >= 10 && hoogte >= 5);
  const perBlad = inst.kolommen * inst.rijen;

  const etiketten = useMemo(() => {
    if (!data) return [];
    const lok = new Map(lokalen.map((l) => [l.id, l]));
    return data.deelnemers
      .filter((d) => dagdeelId === 'alle' || d.dagdelen.includes(dagdeelId))
      .sort((a, b) => (sorteer === 'school' ? nl.compare(a.school, b.school) : 0) || nl.compare(a.naam, b.naam) || nl.compare(a.voornaam, b.voornaam))
      .map((d) => regelsVan(d, d.lesjes.filter((l) => dagdeelId === 'alle' || l.dagdeelId === dagdeelId), inst.regels, lok, data.evenement.titel));
  }, [data, lokalen, dagdeelId, sorteer, inst.regels]);

  // Lege plaatsen vooraan (voor een blad dat al deels gebruikt is), dan per blad verdelen
  const vakjes: (Regel[] | null)[] = [...Array(Math.min(Math.max(start, 1), perBlad) - 1).fill(null), ...etiketten];
  const bladen = pastNiet ? [] : Array.from({ length: Math.ceil(vakjes.length / perBlad) }, (_, i) => vakjes.slice(i * perBlad, (i + 1) * perBlad));

  // Passende regels verkleinen tot ze op één lijn passen; tellen hoeveel etiketten overlopen
  useLayoutEffect(() => {
    const doos = voorbeeld.current;
    if (!doos) return;
    doos.querySelectorAll<HTMLElement>('.e-regel--passend').forEach((el) => {
      const max = Number(el.dataset.pt);
      el.style.fontSize = `${max}pt`;
      if (el.scrollWidth <= el.clientWidth) return;
      let pt = Math.floor(((max * el.clientWidth) / el.scrollWidth) * 2) / 2;
      el.style.fontSize = `${pt}pt`;
      while (el.scrollWidth > el.clientWidth && pt > 4) el.style.fontSize = `${(pt -= 0.5)}pt`;
    });
    setTeVol([...doos.querySelectorAll<HTMLElement>('.e-etiket')].filter((el) => el.scrollHeight > el.clientHeight + 1).length);
  });

  if (fout) {
    return (
      <>
        <p><Link href="/dashboard">← Evenementen</Link></p>
        <Melding soort="fout">{fout}</Melding>
      </>
    );
  }
  if (!data) return <p aria-busy="true">Laden…</p>;

  const zet = (w: Partial<EtiketInstellingen>) => setInst((oud) => ({ ...oud, ...w }));
  const zetRegel = (i: number, w: Partial<EtiketRegel>) => zet({ regels: inst.regels.map((r, n) => (n === i ? { ...r, ...w } : r)) });
  const verschuif = (i: number, naar: number) => {
    const regels = [...inst.regels];
    [regels[i], regels[naar]] = [regels[naar], regels[i]];
    zet({ regels });
  };

  const bewaar = async (nieuw: EtiketInstellingen | null) => {
    setBezig(true);
    setMelding(null);
    try {
      const r = await etiketApi.bewaar(evenementId, nieuw);
      setInst(r.instellingen ?? STANDAARD);
      setBewaard(r.instellingen ?? STANDAARD);
      setMelding({ soort: 'ok', tekst: nieuw ? 'Opmaak bewaard.' : 'Standaardopmaak hersteld.' });
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e, 'Bewaren mislukt.') });
    } finally {
      setBezig(false);
    }
  };

  const zetVerdieping = async (l: EtiketLokaal, waarde: string) => {
    if ((l.verdieping ?? '') === waarde.trim()) return;
    try {
      const r = await etiketApi.zetVerdieping(evenementId, l.id, waarde);
      setLokalen((oud) => oud.map((x) => (x.id === l.id ? { ...x, verdieping: r.verdieping } : x)));
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e, 'Bewaren mislukt.') });
    }
  };

  const nummer = (waarde: number, onWijzig: (n: number) => void, label: string, stap = 0.5) => (
    <label className="e-getal">
      <span>{label}</span>
      <input type="number" min={0} step={stap} value={waarde} disabled={!data.kanSchrijven} onChange={(e) => onWijzig(Number(e.target.value) || 0)} />
    </label>
  );

  const zonderVerdieping = inst.regels.some((r) => r.tekst.includes('{verdieping}')) ? lokalen.filter((l) => !l.verdieping).length : 0;

  return (
    <div className="etiketten">
      <style>{`@page { size: ${mm(inst.blad.breedte)} ${mm(inst.blad.hoogte)}; margin: 0; }`}</style>
      <div className="r-scherm">
        <nav className="d-kruimel" aria-label="Kruimelpad">
          <Link href="/dashboard">Evenementen</Link> › <Link href={`/dashboard/evenementen/${evenementId}`}>{data.evenement.titel}</Link> › <span>Etiketten</span>
        </nav>
        <header className="d-paginakop">
          <h1>Etiketten</h1>
        </header>

        <div className="e-instellingen">
          <section className="inst-blok">
            <h2>Blad</h2>
            <div className="e-rij">
              {nummer(inst.blad.breedte, (n) => zet({ blad: { ...inst.blad, breedte: n } }), 'Breedte (mm)')}
              {nummer(inst.blad.hoogte, (n) => zet({ blad: { ...inst.blad, hoogte: n } }), 'Hoogte (mm)')}
              {nummer(inst.kolommen, (n) => zet({ kolommen: Math.max(1, Math.round(n)) }), 'Kolommen', 1)}
              {nummer(inst.rijen, (n) => zet({ rijen: Math.max(1, Math.round(n)) }), 'Rijen', 1)}
            </div>
            <h3>Marges van het blad (mm)</h3>
            <div className="e-rij">
              {nummer(inst.marge.boven, (n) => zet({ marge: { ...inst.marge, boven: n } }), 'Boven')}
              {nummer(inst.marge.onder, (n) => zet({ marge: { ...inst.marge, onder: n } }), 'Onder')}
              {nummer(inst.marge.links, (n) => zet({ marge: { ...inst.marge, links: n } }), 'Links')}
              {nummer(inst.marge.rechts, (n) => zet({ marge: { ...inst.marge, rechts: n } }), 'Rechts')}
            </div>
            <h3>Ruimte (mm)</h3>
            <div className="e-rij">
              {nummer(inst.tussen.horizontaal, (n) => zet({ tussen: { ...inst.tussen, horizontaal: n } }), 'Tussen kolommen')}
              {nummer(inst.tussen.verticaal, (n) => zet({ tussen: { ...inst.tussen, verticaal: n } }), 'Tussen rijen')}
              {nummer(inst.binnen, (n) => zet({ binnen: n }), 'Binnen het etiket')}
            </div>
            <p className={pastNiet ? 'd-veld__fout' : 'd-hulp'}>
              {pastNiet
                ? 'De etiketten passen niet op het blad: verklein de marges of het aantal.'
                : <>Etiket: <strong>{getal(breedte)} × {getal(hoogte)} mm</strong>, {perBlad} per blad (automatisch berekend). A4 = 210 × 297 mm.</>}
            </p>
          </section>

          <section className="inst-blok">
            <h2>Inhoud</h2>
            <table className="d-tabel e-regels">
              <thead>
                <tr>
                  <th>Tekst</th>
                  <th>pt</th>
                  <th title="Vet">Vet</th>
                  <th title="Op één lijn, zo groot mogelijk tot de opgegeven pt">Eén lijn</th>
                  <th title="Herhalen voor elk lesje">Per lesje</th>
                  <th><span className="sr-only">Volgorde</span></th>
                </tr>
              </thead>
              <tbody>
                {inst.regels.map((r, i) => (
                  <tr key={i}>
                    <td><input className="e-tekst" value={r.tekst} maxLength={200} disabled={!data.kanSchrijven} aria-label={`Tekst regel ${i + 1}`} onChange={(e) => zetRegel(i, { tekst: e.target.value })} /></td>
                    <td><input className="e-pt" type="number" min={4} max={72} step={0.5} value={r.pt} disabled={!data.kanSchrijven} aria-label={`Lettergrootte regel ${i + 1} (pt)`} onChange={(e) => zetRegel(i, { pt: Number(e.target.value) || 0 })} /></td>
                    <td><input type="checkbox" checked={r.vet} disabled={!data.kanSchrijven} aria-label={`Regel ${i + 1} vet`} onChange={(e) => zetRegel(i, { vet: e.target.checked })} /></td>
                    <td><input type="checkbox" checked={r.passend} disabled={!data.kanSchrijven} aria-label={`Regel ${i + 1} op één lijn`} onChange={(e) => zetRegel(i, { passend: e.target.checked })} /></td>
                    <td><input type="checkbox" checked={r.perLesje} disabled={!data.kanSchrijven} aria-label={`Regel ${i + 1} per lesje`} onChange={(e) => zetRegel(i, { perLesje: e.target.checked })} /></td>
                    <td className="e-volgorde">
                      {data.kanSchrijven && (
                        <>
                          <button type="button" className="d-icoonknop" disabled={i === 0} aria-label={`Regel ${i + 1} omhoog`} onClick={() => verschuif(i, i - 1)}>↑</button>
                          <button type="button" className="d-icoonknop" disabled={i === inst.regels.length - 1} aria-label={`Regel ${i + 1} omlaag`} onClick={() => verschuif(i, i + 1)}>↓</button>
                          <button type="button" className="d-icoonknop" aria-label={`Regel ${i + 1} verwijderen`} onClick={() => zet({ regels: inst.regels.filter((_, n) => n !== i) })}>×</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.kanSchrijven && inst.regels.length < 20 && (
              <button type="button" className="d-link" onClick={() => zet({ regels: [...inst.regels, { tekst: '', pt: 10, vet: false, passend: false, perLesje: false }] })}>
                + Regel toevoegen
              </button>
            )}
            <p className="d-hulp">
              Velden: {VELDEN.map(([k, uitleg]) => <code key={k} title={uitleg}>{`{${k}}`}</code>)}
              <br />
              Per lesje: {LESJE_VELDEN.map(([k, uitleg]) => <code key={k} title={uitleg}>{`{${k}}`}</code>)}
              <br />
              Opeenvolgende regels met “Per lesje” worden samen herhaald voor elk lesje, in de volgorde van de dag.
            </p>
          </section>

          {lokalen.length > 0 && (
            <section className="inst-blok">
              <h2>Verdieping per lokaal</h2>
              <table className="d-tabel e-lokalen">
                <tbody>
                  {lokalen.map((l) => (
                    <tr key={l.id}>
                      <td>{l.lokaal && l.lokaal !== l.naam ? `${l.naam} – ${l.lokaal}` : l.naam}</td>
                      <td>
                        <input
                          key={l.verdieping ?? ''}
                          defaultValue={l.verdieping ?? ''}
                          maxLength={50}
                          placeholder="bv. verdieping 1"
                          disabled={!data.kanSchrijven}
                          aria-label={`Verdieping van ${l.naam}`}
                          onBlur={(e) => zetVerdieping(l, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="d-hulp">Wordt meteen bewaard en geldt voor elk evenement dat dit lokaal gebruikt.</p>
            </section>
          )}
        </div>

        {data.kanSchrijven && (
          <div className="d-werkbalk">
            <button type="button" className="d-knop" onClick={() => bewaar(inst)} disabled={bezig || !gewijzigd || pastNiet}>{bezig ? 'Bezig…' : 'Opmaak bewaren'}</button>
            <button type="button" className="d-knop d-knop--secundair" onClick={() => setInst(bewaard)} disabled={bezig || !gewijzigd}>Ongedaan maken</button>
            <button type="button" className="d-knop d-knop--secundair" onClick={() => confirm('Terug naar de standaardopmaak (3 × 8 op A4)?') && bewaar(null)} disabled={bezig}>Standaard herstellen</button>
          </div>
        )}
        {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}

        <h2>Afdrukken</h2>
        <div className="d-werkbalk e-werkbalk">
          <select value={dagdeelId} aria-label="Dagdeel" onChange={(e) => setDagdeelId(e.target.value)}>
            <option value="alle">Alle dagdelen</option>
            {data.dagdelen.map((dd) => (
              <option key={dd.id} value={dd.id}>{dd.naam}</option>
            ))}
          </select>
          <select value={sorteer} aria-label="Sorteren" onChange={(e) => setSorteer(e.target.value as 'naam' | 'school')}>
            <option value="naam">Op achternaam</option>
            <option value="school">Op school, dan achternaam</option>
          </select>
          <label className="e-getal e-getal--inline">
            <span>Beginnen bij etiket</span>
            <input type="number" min={1} max={perBlad} value={start} onChange={(e) => setStart(Math.round(Number(e.target.value)) || 1)} />
          </label>
          <button type="button" className="d-knop" onClick={() => print()} disabled={!etiketten.length || pastNiet}>Afdrukken</button>
        </div>
        <p className="d-hulp">
          {etiketten.length} etiket(ten) op {bladen.length} blad(en). Druk af op ware grootte (100 %, niet “aanpassen aan pagina”) en zonder kop- en voetteksten.
        </p>
        {teVol > 0 && <Melding soort="let-op">{teVol} etiket(ten) zijn te vol: de onderste regels vallen weg. Verklein de letters of de witruimte.</Melding>}
        {zonderVerdieping > 0 && <Melding soort="let-op">{zonderVerdieping} lokaal/lokalen hebben nog geen verdieping.</Melding>}
        {!etiketten.length && <Melding>Geen deelnemers voor deze keuze.</Melding>}
      </div>

      <div className="e-voorbeeld" ref={voorbeeld}>
        {bladen.map((blad, b) => (
          <div key={b} className="e-blad" style={{ width: mm(inst.blad.breedte), height: mm(inst.blad.hoogte) }}>
            {blad.map((regels, i) =>
              regels && (
                <div
                  key={i}
                  className="e-etiket"
                  style={{
                    left: mm(inst.marge.links + (i % inst.kolommen) * (breedte + inst.tussen.horizontaal)),
                    top: mm(inst.marge.boven + Math.floor(i / inst.kolommen) * (hoogte + inst.tussen.verticaal)),
                    width: mm(breedte),
                    height: mm(hoogte),
                    padding: mm(inst.binnen),
                  }}
                >
                  {regels.map((x, n) => (
                    <div
                      key={n}
                      className={x.r.passend ? 'e-regel e-regel--passend' : 'e-regel'}
                      data-pt={x.r.pt}
                      style={{ fontSize: `${x.r.pt}pt`, fontWeight: x.r.vet ? 700 : 400 }}
                    >
                      {x.tekst || ' '}
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
