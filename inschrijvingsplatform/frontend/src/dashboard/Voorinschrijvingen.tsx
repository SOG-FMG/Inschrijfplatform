import { useCallback, useEffect, useMemo, useState } from 'react';
import { schoolLabel } from '../components/SchoolKiezer';
import { api } from '../services/api';
import { beheerApi, type ImportRij, type ImportStatistiek } from '../services/beheerApi';
import type { School } from '../types';
import {
  decodeer, herkenDatumvorm, koppelSchool, leesCsv, leesDatum, stelKoppelingVoor, VELDEN,
  type Datumvorm, type Koppeling, type Suggestie, type Zekerheid,
} from './import/importlogica';
import { datumTijd, foutTekst, Invoer, Melding } from './ui';

/**
 * Voorinschrijvingen uit een extern bestand (bv. een export van Microsoft Forms) importeren, met statistieken
 * en controles per import. Het bestand wordt in de browser gelezen; enkel de gekoppelde velden gaan naar de API.
 */
export function Voorinschrijvingen() {
  const [lijst, setLijst] = useState<ImportStatistiek[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [nieuw, setNieuw] = useState(false);

  const laad = useCallback(() => {
    beheerApi.voorinschrijvingenStatistieken().then(setLijst).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  const actie = async (werk: () => Promise<unknown>) => {
    setFout(null);
    try {
      await werk();
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    }
  };

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Voorinschrijvingen</h1>
          <p className="d-sub">Importeer een export (CSV) van bv. Microsoft Forms voor statistieken en controles. Anonimiseer een import zodra de controles gedaan zijn.</p>
        </div>
        {!nieuw && <button type="button" className="d-knop" onClick={() => setNieuw(true)}>+ Bestand importeren</button>}
      </header>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {nieuw && <NieuweImport onKlaar={() => { setNieuw(false); laad(); }} onAnnuleer={() => setNieuw(false)} />}
      {!lijst ? <p>Laden…</p> : !lijst.length && !nieuw ? <Melding>Nog geen imports.</Melding> : null}
      {lijst?.map((imp) => (
        <Import key={imp.id} imp={imp}
          onAnonimiseer={() => confirm(`"${imp.naam}" anonimiseren?\n\nNamen, e-mailadressen, telefoonnummers en opmerkingen worden gewist. De statistieken blijven. Dit kan niet ongedaan gemaakt worden.`) && actie(() => beheerApi.anonimiseerImport(imp.id))}
          onVerwijder={() => confirm(`"${imp.naam}" volledig verwijderen, ook de statistieken?`) && actie(() => beheerApi.verwijderImport(imp.id))} />
      ))}
    </>
  );
}

function Import({ imp, onAnonimiseer, onVerwijder }: { imp: ImportStatistiek; onAnonimiseer: () => void; onVerwijder: () => void }) {
  const [alleScholen, setAlleScholen] = useState(false);
  const c = imp.controle;
  const scholen = alleScholen ? imp.scholen : imp.scholen.slice(0, 10);
  return (
    <section className="d-kaart">
      <div className="d-paginakop">
        <div>
          <h2>{imp.naam}</h2>
          <p className="d-klein">{imp.aantal} rijen · geïmporteerd {datumTijd(imp.aangemaakt)}{imp.bestandsnaam && ` · ${imp.bestandsnaam}`}
            {imp.geanonimiseerdOp ? <> · <span className="d-badge d-badge--gearchiveerd">Geanonimiseerd {datumTijd(imp.geanonimiseerdOp)}</span></> : null}</p>
        </div>
        <div className="d-knoppen d-knoppen--links">
          {!imp.geanonimiseerdOp && <button type="button" className="d-knop d-knop--secundair" onClick={onAnonimiseer}>Anonimiseren</button>}
          <button type="button" className="d-knop d-knop--gevaar" onClick={onVerwijder}>Verwijderen</button>
        </div>
      </div>

      <div className="m-tellers">
        <Teller waarde={imp.aantal} label="Voorinschrijvingen" />
        <Teller waarde={c.adressen} label="Verschillende e-mailadressen" />
        <Teller waarde={c.dubbeleAdressen} label="Adressen met meer dan één inschrijving" />
        <Teller waarde={c.ookIngeschreven} label="Adressen ook ingeschreven voor een infodag" />
        <Teller waarde={c.ookInAndereImport} label="Adressen ook in een andere import" />
        <Teller waarde={c.zonderEmail} label="Zonder geldig e-mailadres" />
      </div>
      {imp.geanonimiseerdOp && <p className="d-klein">Na het anonimiseren zijn de controles op e-mailadres niet meer mogelijk (ze tonen 0).</p>}

      <div className="d-raster">
        <Tabel titel="Per school" kolom="School" rijen={scholen.map((s) => [s.soort === 'andere' ? `${s.school} (niet in de lijst)` : s.school, s.aantal])}>
          {imp.scholen.length > 10 && (
            <button type="button" className="d-link" onClick={() => setAlleScholen(!alleScholen)}>
              {alleScholen ? 'Enkel de 10 grootste' : `Alle ${imp.scholen.length} scholen tonen`}
            </button>
          )}
        </Tabel>
        <div>
          <Tabel titel="Per klas" kolom="Klas" rijen={imp.klassen.map((k) => [k.klas, k.aantal])} />
          <Tabel titel="Per schooljaar" kolom="Schooljaar" rijen={imp.schooljaren.map((k) => [k.schooljaar, k.aantal])} />
          <Tabel titel="Per maand" kolom="Maand" rijen={imp.maanden.map((m) => [m.maand, m.aantal])} />
        </div>
      </div>
    </section>
  );
}

function Teller({ waarde, label }: { waarde: number; label: string }) {
  return <div className="d-kaart m-teller"><strong>{waarde}</strong><span>{label}</span></div>;
}

function Tabel({ titel, kolom, rijen, children }: { titel: string; kolom: string; rijen: [string, number][]; children?: React.ReactNode }) {
  return (
    <div>
      <h3>{titel}</h3>
      <div className="d-tabelvak">
        <table className="d-tabel d-tabel--compact">
          <thead><tr><th>{kolom}</th><th className="getal">Aantal</th></tr></thead>
          <tbody>{rijen.map(([a, n]) => <tr key={a}><td>{a}</td><td className="getal">{n}</td></tr>)}</tbody>
        </table>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nieuwe import: bestand → kolommen → scholen → importeren
// ---------------------------------------------------------------------------

interface Bestand { naam: string; kolommen: string[]; rijen: string[][] }
interface SchoolKeuze { tekst: string; aantal: number; zekerheid: Zekerheid; suggesties: Suggestie[]; keuze: string }

const ANDERE = 'andere';

function NieuweImport({ onKlaar, onAnnuleer }: { onKlaar: () => void; onAnnuleer: () => void }) {
  const [naam, setNaam] = useState('');
  const [bestand, setBestand] = useState<Bestand | null>(null);
  const [koppeling, setKoppeling] = useState<Koppeling | null>(null);
  const [datumvorm, setDatumvorm] = useState<Datumvorm | ''>('');
  const [scholen, setScholen] = useState<School[]>([]);
  const [keuzes, setKeuzes] = useState<SchoolKeuze[]>([]);
  const [enkelNakijken, setEnkelNakijken] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    api.haalScholen().then((s) => setScholen([...s].sort((a, b) => schoolLabel(a).localeCompare(schoolLabel(b), 'nl')))).catch((e) => setFout(foutTekst(e)));
  }, []);

  const waarde = (r: string[], veld: keyof Koppeling) => (koppeling?.[veld] != null ? r[koppeling[veld]!] ?? '' : '');

  async function kies(f: File) {
    setFout(null);
    const { kolommen, rijen } = leesCsv(decodeer(await f.arrayBuffer()));
    if (!rijen.length) return setFout('Dit bestand bevat geen rijen.');
    const k = stelKoppelingVoor(kolommen, rijen);
    setBestand({ naam: f.name, kolommen, rijen });
    setKoppeling(k);
    setDatumvorm(k.ingediendOp != null ? herkenDatumvorm(rijen.map((r) => r[k.ingediendOp!] ?? '')) ?? '' : '');
    if (!naam) setNaam(f.name.replace(/\.[^.]+$/, ''));
  }

  // Unieke schoolnamen uit het bestand, gekoppeld aan de officiële lijst (opnieuw als de schoolkolom wijzigt).
  useEffect(() => {
    if (!bestand || !scholen.length) return;
    const tel = new Map<string, number>();
    for (const r of bestand.rijen) {
      const t = waarde(r, 'school').trim();
      if (t) tel.set(t, (tel.get(t) ?? 0) + 1);
    }
    setKeuzes([...tel].sort((a, b) => b[1] - a[1]).map(([tekst, aantal]) => {
      const { zekerheid, suggesties } = koppelSchool(tekst, scholen);
      return { tekst, aantal, zekerheid, suggesties, keuze: zekerheid === 'zeker' ? suggesties[0].school.id : zekerheid === 'geen' ? ANDERE : '' };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestand, scholen, koppeling?.school]);

  const openTwijfels = keuzes.filter((k) => !k.keuze).length;
  const zichtbaar = enkelNakijken ? keuzes.filter((k) => k.zekerheid !== 'zeker') : keuzes;
  const ongeldigeDatums = useMemo(
    () => (bestand && koppeling?.ingediendOp != null && datumvorm ? bestand.rijen.filter((r) => waarde(r, 'ingediendOp') && !leesDatum(waarde(r, 'ingediendOp'), datumvorm)).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bestand, koppeling, datumvorm],
  );
  const klaar = !!bestand && !!naam.trim() && openTwijfels === 0 && (koppeling?.ingediendOp == null || !!datumvorm);

  async function importeer() {
    if (!bestand || !koppeling) return;
    setBezig(true);
    setFout(null);
    const perTekst = new Map(keuzes.map((k) => [k.tekst, k.keuze]));
    const rijen: ImportRij[] = bestand.rijen.map((r) => {
      const school = waarde(r, 'school').trim();
      const keuze = school ? perTekst.get(school) : undefined;
      const leeg = (v: string) => v.trim() || null;
      return {
        ingediendOp: datumvorm ? leesDatum(waarde(r, 'ingediendOp'), datumvorm) : null,
        schooljaar: leeg(waarde(r, 'schooljaar')),
        klas: leeg(waarde(r, 'klas')),
        schoolId: keuze && keuze !== ANDERE ? keuze : null,
        schoolAndere: keuze === ANDERE ? school : null,
        kindNaam: leeg(waarde(r, 'kindNaam')),
        email: leeg(waarde(r, 'email')),
        telefoon: leeg(waarde(r, 'telefoon')),
        opmerkingen: leeg(waarde(r, 'opmerkingen')),
      };
    });
    try {
      await beheerApi.importeerVoorinschrijvingen({ naam: naam.trim(), bestandsnaam: bestand.naam, rijen });
      onKlaar();
    } catch (e) {
      setFout(foutTekst(e));
      setBezig(false);
    }
  }

  return (
    <section className="d-kaart">
      <h2>Bestand importeren</h2>
      {fout && <Melding soort="fout">{fout}</Melding>}
      <Melding soort="let-op">Het bestand bevat persoonsgegevens van kinderen en ouders. Het wordt enkel in je browser gelezen; namen, e-mailadressen, telefoonnummers en opmerkingen worden versleuteld bewaard. Verwijder het bestand van je computer na de import.</Melding>

      <h3>1. Bestand</h3>
      <div className="d-veld">
        <label htmlFor="import-bestand">CSV-bestand (puntkomma of komma)</label>
        <input id="import-bestand" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && kies(e.target.files[0])} />
      </div>
      <Invoer label="Naam van de import" waarde={naam} onWijzig={setNaam} verplicht placeholder="bv. Voorinschrijvingen 2025-2026" />

      {bestand && koppeling && (
        <>
          <h3>2. Kolommen <span className="d-klein">({bestand.rijen.length} rijen)</span></h3>
          <div className="d-tabelvak">
            <table className="d-tabel d-tabel--compact">
              <thead><tr><th>Veld</th><th>Kolom in het bestand</th><th>Voorbeeld (eerste rij)</th></tr></thead>
              <tbody>
                {VELDEN.map(({ veld, label }) => (
                  <tr key={veld}>
                    <td>{label}</td>
                    <td>
                      <select aria-label={`Kolom voor ${label}`} value={koppeling[veld] ?? ''}
                        onChange={(e) => setKoppeling({ ...koppeling, [veld]: e.target.value === '' ? null : Number(e.target.value) })}>
                        <option value="">(niet gebruiken)</option>
                        {bestand.kolommen.map((k, i) => <option key={i} value={i}>{k || `kolom ${i + 1}`}</option>)}
                      </select>
                    </td>
                    <td className="d-klein pii">{waarde(bestand.rijen[0], veld) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {koppeling.ingediendOp != null && (
            <div className="d-veld">
              <label htmlFor="import-datumvorm">Datums in het bestand</label>
              <select id="import-datumvorm" value={datumvorm} onChange={(e) => setDatumvorm(e.target.value as Datumvorm)}>
                <option value="">Kies…</option>
                <option value="DMJ">dag/maand/jaar (11/3/25 = 11 maart 2025)</option>
                <option value="MDJ">maand/dag/jaar (11/3/25 = 3 november 2025)</option>
              </select>
              {!datumvorm && <span className="d-veld__fout">Uit het bestand blijkt niet welke vorm het is. Kijk een datum na en kies.</span>}
              {ongeldigeDatums > 0 && <span className="d-veld__hulp">{ongeldigeDatums} datum(s) zijn onleesbaar en worden leeg gelaten.</span>}
            </div>
          )}

          {koppeling.school != null && (
            <>
              <h3>3. Scholen koppelen aan de officiële lijst</h3>
              <p className="d-klein">
                {keuzes.filter((k) => k.zekerheid === 'zeker').length} zeker gekoppeld, {keuzes.filter((k) => k.zekerheid === 'twijfel').length} twijfel,{' '}
                {keuzes.filter((k) => k.zekerheid === 'geen').length} niet gevonden (staan op "niet in de lijst").{' '}
                {openTwijfels > 0 && <strong className="d-nee">Nog {openTwijfels} te kiezen.</strong>}
              </p>
              <label className="d-klein">
                <input type="checkbox" checked={enkelNakijken} onChange={(e) => setEnkelNakijken(e.target.checked)} /> Enkel twijfels en niet gevonden
              </label>
              <div className="d-tabelvak">
                <table className="d-tabel d-tabel--compact">
                  <thead><tr><th>In het bestand</th><th className="getal">Rijen</th><th>Zekerheid</th><th>School in de lijst</th></tr></thead>
                  <tbody>
                    {zichtbaar.map((k) => (
                      <tr key={k.tekst}>
                        <td>{k.tekst}</td>
                        <td className="getal">{k.aantal}</td>
                        <td><span className={`d-badge d-badge--${k.zekerheid === 'zeker' ? 'gepubliceerd' : k.zekerheid === 'twijfel' ? 'concept' : 'gesloten'}`}>{k.zekerheid}</span></td>
                        <td>
                          <select aria-label={`School voor ${k.tekst}`} value={k.keuze}
                            onChange={(e) => setKeuzes(keuzes.map((x) => (x.tekst === k.tekst ? { ...x, keuze: e.target.value } : x)))}>
                            <option value="">Kies…</option>
                            {k.suggesties.length > 0 && (
                              <optgroup label="Voorstellen">
                                {k.suggesties.map((s) => <option key={s.school.id} value={s.school.id}>{schoolLabel(s.school)} ({Math.round(s.score * 100)}%)</option>)}
                              </optgroup>
                            )}
                            <option value={ANDERE}>Niet in de lijst (tekst bewaren)</option>
                            <optgroup label="Alle scholen">
                              {scholen.map((s) => <option key={s.id} value={s.id}>{schoolLabel(s)}</option>)}
                            </optgroup>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className="d-knoppen">
        <button type="button" className="d-knop d-knop--secundair" onClick={onAnnuleer}>Annuleren</button>
        <button type="button" className="d-knop" disabled={!klaar || bezig} onClick={importeer}>
          {bezig ? 'Bezig…' : bestand ? `${bestand.rijen.length} rijen importeren` : 'Importeren'}
        </button>
      </div>
    </section>
  );
}
