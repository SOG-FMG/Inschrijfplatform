import { useCallback, useEffect, useMemo, useState } from 'react';
import { schoolLabel } from '../components/SchoolKiezer';
import { api } from '../services/api';
import { beheerApi, type EvenementKort, type ImportRij, type ImportStatistiek, type PersoonControle, type Profiel, type UitnodigingOverzicht } from '../services/beheerApi';
import type { School } from '../types';
import {
  decodeer, herkenDatumvorm, koppelSchool, leesCsv, leesDatum, splitsNaam, stelKoppelingVoor, VELDEN,
  type Datumvorm, type Koppeling, type Suggestie, type Zekerheid,
} from './import/importlogica';
import { datumTijd, foutTekst, Invoer, Melding } from './ui';

/**
 * Voorinschrijvingen uit een extern bestand (bv. een export van Microsoft Forms) importeren, met statistieken
 * en controles per import. Het bestand wordt in de browser gelezen; enkel de gekoppelde velden gaan naar de API.
 */
export function Voorinschrijvingen({ profiel }: { profiel: Profiel }) {
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
        <Import key={imp.id} imp={imp} evenementen={profiel.evenementen}
          onAnonimiseer={() => confirm(`"${imp.naam}" anonimiseren?\n\nNamen, e-mailadressen, telefoonnummers en opmerkingen worden gewist. De statistieken blijven. Dit kan niet ongedaan gemaakt worden.`) && actie(() => beheerApi.anonimiseerImport(imp.id))}
          onVerwijder={() => confirm(`"${imp.naam}" volledig verwijderen, ook de statistieken?`) && actie(() => beheerApi.verwijderImport(imp.id))} />
      ))}
    </>
  );
}

function Import({ imp, evenementen, onAnonimiseer, onVerwijder }: {
  imp: ImportStatistiek; evenementen: EvenementKort[]; onAnonimiseer: () => void; onVerwijder: () => void;
}) {
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
        <Teller waarde={c.adressen} label="Gezinnen (verschillende e-mailadressen)" />
        <Teller waarde={c.kinderen} label="Kinderen" />
        <Teller waarde={c.kinderenIngeschreven} label="Kinderen ingeschreven voor een infodag" />
        <Teller waarde={c.dubbeleAdressen} label="Adressen met meer dan één inschrijving" />
        <Teller waarde={c.ookIngeschreven} label="Adressen ook ingeschreven voor een infodag" />
        <Teller waarde={c.ookInAndereImport} label="Adressen ook in een andere import" />
        <Teller waarde={c.zonderEmail} label="Zonder geldig e-mailadres" />
      </div>
      {imp.geanonimiseerdOp && <p className="d-klein">Na het anonimiseren zijn de controles op e-mailadres niet meer mogelijk (ze tonen 0).</p>}

      {!imp.geanonimiseerdOp && <Uitnodigen importId={imp.id} evenementen={evenementen} />}

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

/**
 * Kinderen uit deze import uitnodigen voor een evenement: één mail per gezin, met een link per kind naar het vooraf
 * ingevulde formulier. Versturen gebeurt in delen (zie MAILS_PER_KEER in de backend) tot alles weg is.
 */
function Uitnodigen({ importId, evenementen }: { importId: string; evenementen: EvenementKort[] }) {
  const open = evenementen.filter((e) => e.status === 'gepubliceerd');
  const [evenementId, setEvenementId] = useState(open[0]?.id ?? '');
  const [overzicht, setOverzicht] = useState<UitnodigingOverzicht | null>(null);
  const [bezig, setBezig] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);

  const laad = useCallback(() => {
    if (!evenementId) return;
    beheerApi.uitnodigingOverzicht(importId, evenementId).then(setOverzicht).catch((e) => setMelding({ soort: 'fout', tekst: foutTekst(e) }));
  }, [importId, evenementId]);
  useEffect(laad, [laad]);

  async function verstuur(soort: 'uitnodiging' | 'herinnering') {
    const ev = open.find((e) => e.id === evenementId);
    const vraag = soort === 'uitnodiging'
      ? `Uitnodigingen versturen voor "${ev?.titel}" naar ${overzicht?.contacten ?? '?'} gezin(nen)?`
      : `Een herinnering versturen voor "${ev?.titel}" aan wie nog niet reageerde?`;
    if (!confirm(vraag)) return;
    setMelding(null);
    let totaal = 0;
    try {
      for (;;) {
        setBezig(`${totaal} verstuurd…`);
        const r = await beheerApi.verstuurUitnodigingen(importId, evenementId, soort);
        totaal += r.verstuurd;
        if (r.mislukt) {
          setMelding({ soort: 'fout', tekst: `${totaal} verstuurd, ${r.mislukt} mislukt. Controleer de mailinstellingen (testmail onder Medewerkers) en probeer opnieuw.` });
          break;
        }
        if (!r.resterend || !r.verstuurd) {
          setMelding({ soort: 'ok', tekst: totaal ? `${totaal} mail(s) verstuurd.` : 'Er was niemand meer om te mailen.' });
          break;
        }
      }
    } catch (e) {
      setMelding({ soort: 'fout', tekst: foutTekst(e) });
    } finally {
      setBezig(null);
      laad();
    }
  }

  if (!open.length) return <p className="d-klein">Uitnodigen kan zodra er een gepubliceerd evenement is.</p>;
  return (
    <div className="d-kaart">
      <h3>Uitnodigen om in te schrijven</h3>
      <p className="d-klein">Eén mail per gezin, met per kind een link naar het formulier waarin de gegevens al ingevuld zijn, een link om een ander kind in te schrijven, en een link "komt niet". Kinderen die al ingeschreven zijn, krijgen niets.</p>
      <div className="d-werkbalk">
        <select aria-label="Evenement" value={evenementId} onChange={(e) => setEvenementId(e.target.value)}>
          {open.map((e) => <option key={e.id} value={e.id}>{e.titel}</option>)}
        </select>
        <button type="button" className="d-knop" disabled={!!bezig || !overzicht?.nogNietIngeschreven} onClick={() => verstuur('uitnodiging')}>Uitnodiging versturen</button>
        <button type="button" className="d-knop d-knop--secundair" disabled={!!bezig || !overzicht?.verstuurd} onClick={() => verstuur('herinnering')}>Herinnering versturen</button>
        {bezig && <span className="d-klein" role="status">{bezig}</span>}
      </div>
      {melding && <Melding soort={melding.soort}>{melding.tekst}</Melding>}
      {overzicht && (
        <p className="d-klein">
          Nog niet ingeschreven: <strong>{overzicht.nogNietIngeschreven}</strong> kind(eren) in {overzicht.contacten} gezin(nen) ·
          uitgenodigd, nog geen reactie: <strong>{overzicht.verstuurd}</strong> · ingeschreven via de link: <strong>{overzicht.gebruikt}</strong> ·
          komt niet: <strong>{overzicht.afgemeld}</strong>
        </p>
      )}
    </div>
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
  const [naamVolgorde, setNaamVolgorde] = useState<'naam-voornaam' | 'voornaam-naam'>('naam-voornaam');
  const [personen, setPersonen] = useState<(PersoonControle & { keuze: string })[] | null>(null);
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
  const openPersonen = personen?.filter((p) => p.status === 'twijfel' && !p.keuze).length ?? 0;

  // Naam en voornaam van het kind: uit twee kolommen, of gesplitst uit één kolom.
  const kind = (r: string[]) => {
    if (koppeling?.kindVoornaam != null) return { kindVoornaam: waarde(r, 'kindVoornaam').trim() || null, kindNaam: waarde(r, 'kindNaam').trim() || null };
    const { voornaam, naam } = splitsNaam(waarde(r, 'kindNaam'), naamVolgorde);
    return { kindVoornaam: voornaam, kindNaam: naam };
  };

  // Gewijzigde kolommen of naamvolgorde: de kinderen opnieuw nakijken.
  useEffect(() => setPersonen(null), [bestand, koppeling, naamVolgorde]);

  async function kijkKinderenNa() {
    if (!bestand) return;
    setFout(null);
    try {
      const r = await beheerApi.controleerPersonen(bestand.rijen.map((x) => ({ email: waarde(x, 'email').trim() || null, ...kind(x) })));
      setPersonen(r.map((p) => ({ ...p, keuze: '' })));
    } catch (e) {
      setFout(foutTekst(e));
    }
  }

  const zichtbaar = enkelNakijken ? keuzes.filter((k) => k.zekerheid !== 'zeker') : keuzes;
  const ongeldigeDatums = useMemo(
    () => (bestand && koppeling?.ingediendOp != null && datumvorm ? bestand.rijen.filter((r) => waarde(r, 'ingediendOp') && !leesDatum(waarde(r, 'ingediendOp'), datumvorm)).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bestand, koppeling, datumvorm],
  );
  const klaar = !!bestand && !!naam.trim() && openTwijfels === 0 && (koppeling?.ingediendOp == null || !!datumvorm) && !!personen && openPersonen === 0;

  async function importeer() {
    if (!bestand || !koppeling) return;
    setBezig(true);
    setFout(null);
    const perTekst = new Map(keuzes.map((k) => [k.tekst, k.keuze]));
    const rijen: ImportRij[] = bestand.rijen.map((r, i) => {
      const school = waarde(r, 'school').trim();
      const keuze = school ? perTekst.get(school) : undefined;
      const leeg = (v: string) => v.trim() || null;
      return {
        ingediendOp: datumvorm ? leesDatum(waarde(r, 'ingediendOp'), datumvorm) : null,
        schooljaar: leeg(waarde(r, 'schooljaar')),
        klas: leeg(waarde(r, 'klas')),
        schoolId: keuze && keuze !== ANDERE ? keuze : null,
        schoolAndere: keuze === ANDERE ? school : null,
        ...kind(r),
        email: leeg(waarde(r, 'email')),
        telefoon: leeg(waarde(r, 'telefoon')),
        opmerkingen: leeg(waarde(r, 'opmerkingen')),
        ...(personen?.[i]?.status === 'twijfel' ? { persoonKeuze: personen[i].keuze } : {}),
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

          {koppeling.kindNaam != null && koppeling.kindVoornaam == null && (
            <div className="d-veld">
              <label htmlFor="import-naamvolgorde">Naam van het kind staat als</label>
              <select id="import-naamvolgorde" value={naamVolgorde} onChange={(e) => setNaamVolgorde(e.target.value as typeof naamVolgorde)}>
                <option value="naam-voornaam">naam voornaam (bv. "Van den Broeck Lotte")</option>
                <option value="voornaam-naam">voornaam naam (bv. "Lotte Van den Broeck")</option>
              </select>
              {bestand.rijen[0] && (
                <span className="d-veld__hulp pii">Eerste rij: voornaam "{kind(bestand.rijen[0]).kindVoornaam ?? '—'}", naam "{kind(bestand.rijen[0]).kindNaam ?? '—'}"</span>
              )}
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

      {bestand && koppeling && (
        <>
          <h3>4. Kinderen en gezinnen</h3>
          <p className="d-klein">
            Eén gezin per e-mailadres. Een kind dat al bekend is (zelfde naam bij hetzelfde adres), wordt herkend; een broer of zus wordt een
            nieuw kind bij hetzelfde gezin. Bij een naam die bijna hetzelfde is, kies jij.
          </p>
          {!personen ? (
            <button type="button" className="d-knop d-knop--secundair" onClick={kijkKinderenNa}>Kinderen nakijken</button>
          ) : (
            <>
              <p className="d-klein">
                {personen.filter((p) => p.contact === 'nieuw').length} rij(en) met een nieuw gezin, {personen.filter((p) => p.contact === 'bestaand').length} met
                een bekend gezin{personen.some((p) => p.contact === 'geen') && `, ${personen.filter((p) => p.contact === 'geen').length} zonder geldig e-mailadres (niet te koppelen)`} ·{' '}
                {personen.filter((p) => p.status === 'zelfde').length} kind(eren) herkend, {personen.filter((p) => p.status === 'nieuw').length} nieuw,{' '}
                {personen.filter((p) => p.status === 'twijfel').length} twijfel.{' '}
                {openPersonen > 0 && <strong className="d-nee">Nog {openPersonen} te kiezen.</strong>}
              </p>
              {personen.some((p) => p.status === 'twijfel') && (
                <div className="d-tabelvak">
                  <table className="d-tabel d-tabel--compact">
                    <thead><tr><th className="getal">Rij</th><th>Kind in het bestand</th><th>Lijkt op</th></tr></thead>
                    <tbody>
                      {personen.map((p, i) => p.status !== 'twijfel' ? null : (
                        <tr key={i}>
                          <td className="getal">{i + 1}</td>
                          <td className="pii">{[kind(bestand.rijen[i]).kindVoornaam, kind(bestand.rijen[i]).kindNaam].filter(Boolean).join(' ')}</td>
                          <td>
                            <select aria-label={`Rij ${i + 1}`} value={p.keuze}
                              onChange={(e) => setPersonen(personen.map((x, j) => (j === i ? { ...x, keuze: e.target.value } : x)))}>
                              <option value="">Kies…</option>
                              {p.kandidaten.map((k) => (
                                <option key={k.id} value={k.id}>
                                  Zelfde kind als {k.naam}{k.id.startsWith('rij:') ? ` (rij ${Number(k.id.slice(4)) + 1} van dit bestand)` : ''}
                                </option>
                              ))}
                              <option value="nieuw">Een ander kind</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
