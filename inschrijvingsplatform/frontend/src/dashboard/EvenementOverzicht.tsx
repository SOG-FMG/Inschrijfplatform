import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { historiekApi, type EvenementOverzichtData, type OverzichtInschrijving, type Profiel } from '../services/beheerApi';
import { download, maakXlsx } from './excel';
import { datum, datumTijd, foutTekst, Link, Melding, Venster } from './ui';

/**
 * Overzicht van één evenement (Dashboard → evenement → Overzicht): wie schreef vooraf in, wie schreef in, wanneer,
 * met welke lesjes, van welke school en welk leerjaar. Filters, een keuze van rapport, export naar Excel, en per
 * naam (muis erover of focus) de historiek over de schooljaren heen met broers en zussen. Daarnaast de dubbels:
 * voorstel om samen te voegen (de laatste inschrijving telt) en, als de keuzes verschillen, een mail met de vraag.
 */

type Rapport = 'inschrijvingen' | 'voorinschrijvingen' | 'scholen' | 'leerjaren' | 'lesjes' | 'tijdlijn' | 'dubbels';
const RAPPORTEN: [Rapport, string][] = [
  ['inschrijvingen', 'Inschrijvingen (wie, wanneer, welk lesje)'],
  ['voorinschrijvingen', 'Voorinschrijvingen (en of ze kwamen)'],
  ['scholen', 'Per lagere school'],
  ['leerjaren', 'Per leerjaar'],
  ['lesjes', 'Per lesje'],
  ['tijdlijn', 'Per week (wanneer schreven ze in)'],
  ['dubbels', 'Dubbels nakijken'],
];

interface Filters { zoek: string; school: string; leerjaar: string; moment: string; lesje: string; doelgroep: string; vooraf: '' | 'ja' | 'nee'; status: 'actief' | 'geannuleerd' | 'alle' }
const GEEN_FILTER: Filters = { zoek: '', school: '', leerjaar: '', moment: '', lesje: '', doelgroep: '', vooraf: '', status: 'actief' };

/** Een tabel: kolomkoppen, rijen, en per rij (optioneel) de persoon voor de historiek bij de naam in kolom 0. */
interface Tabel { kop: string[]; rijen: (string | number)[][]; personen?: (string | null)[]; getal?: number[] }

const volledig = (i: { voornaam: string | null; naam: string | null }) => [i.voornaam, i.naam].filter(Boolean).join(' ') || '(zonder naam)';
const momentLabel = (m: OverzichtInschrijving['momenten'][number]) => `${m.dag} ${m.dagdeel.toLowerCase()}`;
const uniek = (l: (string | null | undefined)[]) => [...new Set(l.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'nl'));

export function EvenementOverzicht({ evenementId, profiel }: { evenementId: string; profiel: Profiel }) {
  const [data, setData] = useState<EvenementOverzichtData | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [rapport, setRapport] = useState<Rapport>('inschrijvingen');
  const [f, setF] = useState<Filters>(GEEN_FILTER);
  const ev = profiel.evenementen.find((e) => e.id === evenementId);

  const laad = useCallback(() => {
    historiekApi.overzicht(evenementId).then(setData).catch((e) => setFout(foutTekst(e)));
  }, [evenementId]);
  useEffect(laad, [laad]);

  const naamVoor = useCallback((v: { persoonId: string | null; naam: string | null }) => (v.persoonId && data?.personen[v.persoonId]?.naam) || v.naam || '(zonder naam)', [data]);

  const opties = useMemo(() => {
    if (!data) return null;
    const ins = data.inschrijvingen;
    return {
      scholen: uniek([...ins.map((i) => i.school), ...data.voorinschrijvingen.map((v) => v.school)]),
      leerjaren: uniek([...ins.map((i) => i.leerjaar), ...data.voorinschrijvingen.map((v) => v.klas)]),
      momenten: [...new Map(ins.flatMap((i) => i.momenten).sort((a, b) => a.datum.localeCompare(b.datum)).map((m) => [m.id, momentLabel(m)]))],
      lesjes: uniek(ins.flatMap((i) => i.lesjes.map((l) => l.titel))),
      doelgroepen: uniek(ins.map((i) => i.doelgroep)),
    };
  }, [data]);

  const ins = useMemo(() => {
    if (!data) return [];
    const z = f.zoek.trim().toLowerCase();
    return data.inschrijvingen.filter((i) =>
      (f.status === 'alle' || i.status === f.status) &&
      (!z || volledig(i).toLowerCase().includes(z)) &&
      (!f.school || i.school === f.school) &&
      (!f.leerjaar || i.leerjaar === f.leerjaar) &&
      (!f.moment || i.momenten.some((m) => m.id === f.moment)) &&
      (!f.lesje || i.lesjes.some((l) => l.titel === f.lesje)) &&
      (!f.doelgroep || i.doelgroep === f.doelgroep) &&
      (!f.vooraf || i.voorinschrijving === (f.vooraf === 'ja')),
    ).sort((a, b) => a.ingeschrevenOp.localeCompare(b.ingeschrevenOp));
  }, [data, f]);

  const voor = useMemo(() => {
    if (!data) return [];
    const z = f.zoek.trim().toLowerCase();
    return data.voorinschrijvingen.filter((v) =>
      (!z || naamVoor(v).toLowerCase().includes(z)) &&
      (!f.school || v.school === f.school) &&
      (!f.leerjaar || v.klas === f.leerjaar) &&
      (!f.vooraf || v.ingeschreven === (f.vooraf === 'ja')),
    ).sort((a, b) => (a.ingediendOp ?? '').localeCompare(b.ingediendOp ?? ''));
  }, [data, f, naamVoor]);

  const tabel = useMemo<Tabel | null>(() => (data ? maakTabel(rapport, ins, voor, naamVoor) : null), [rapport, ins, voor, data, naamVoor]);

  if (fout) return <Melding soort="fout">{fout}</Melding>;
  if (!data || !opties) return <p>Laden…</p>;

  const actief = data.inschrijvingen.filter((i) => i.status === 'actief');
  const kwamen = data.voorinschrijvingen.filter((v) => v.ingeschreven).length;
  const aanwezig = actief.filter((i) => i.momenten.some((m) => m.aanwezig)).length;
  const eerder = actief.filter((i) => i.persoonId && heeftEerder(data, i.persoonId, evenementId)).length;
  const zet = (w: Partial<Filters>) => setF({ ...f, ...w });

  return (
    <>
      <p className="d-kruimel"><Link href="/dashboard">Evenementen</Link> › {data.evenement.titel}</p>
      <header className="d-paginakop">
        <div>
          <h1>Overzicht {data.evenement.titel}</h1>
          <p className="d-sub">Schooljaar {data.evenement.schooljaar}. Ga met de muis over een naam (of tab ernaar) voor de historiek en broers of zussen.</p>
        </div>
        <div className="d-knoppen d-knoppen--links">
          {profiel.rechten.includes('historiek.importeren') && <Link href={`/dashboard/importeren?evenement=${evenementId}`} className="d-knop d-knop--secundair">Importeren</Link>}
          {ev && <Link href={`/dashboard/evenementen/${evenementId}`} className="d-knop d-knop--secundair">Instellingen</Link>}
        </div>
      </header>

      <div className="m-tellers">
        <Teller waarde={actief.length} label="Ingeschreven" />
        <Teller waarde={data.voorinschrijvingen.length} label="Voorinschrijvingen" />
        <Teller waarde={kwamen} label="Vooraf ingeschreven én ingeschreven voor de infodag" />
        <Teller waarde={data.voorinschrijvingen.length - kwamen} label="Voorinschrijving, niet ingeschreven" />
        <Teller waarde={actief.filter((i) => !i.voorinschrijving).length} label="Ingeschreven zonder voorinschrijving" />
        {aanwezig > 0 && <Teller waarde={aanwezig} label="Aanwezig" />}
        <Teller waarde={eerder} label="Kind of broer/zus al eerder bij ons" />
      </div>

      <div className="d-werkbalk">
        <label className="d-klein" htmlFor="ov-rapport">Rapport</label>
        <select id="ov-rapport" value={rapport} onChange={(e) => setRapport(e.target.value as Rapport)}>
          {RAPPORTEN.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        {tabel && (
          <button type="button" className="d-knop d-knop--secundair" onClick={() => exporteer(data.evenement.titel, rapport, tabel)}>Excel</button>
        )}
      </div>

      {rapport !== 'dubbels' && (
        <div className="d-werkbalk">
          <input type="search" placeholder="Zoeken op naam…" aria-label="Zoeken op naam" value={f.zoek} onChange={(e) => zet({ zoek: e.target.value })} />
          <Kies label="School" waarde={f.school} opties={opties.scholen} onKies={(school) => zet({ school })} />
          <Kies label="Leerjaar" waarde={f.leerjaar} opties={opties.leerjaren} onKies={(leerjaar) => zet({ leerjaar })} />
          <Kies label="Moment" waarde={f.moment} opties={opties.momenten} onKies={(moment) => zet({ moment })} />
          <Kies label="Lesje" waarde={f.lesje} opties={opties.lesjes} onKies={(lesje) => zet({ lesje })} />
          {opties.doelgroepen.length > 1 && <Kies label="Stroom" waarde={f.doelgroep} opties={opties.doelgroepen} onKies={(doelgroep) => zet({ doelgroep })} />}
          <select aria-label="Voorinschrijving" value={f.vooraf} onChange={(e) => zet({ vooraf: e.target.value as Filters['vooraf'] })}>
            <option value="">Voorinschrijving: alle</option>
            <option value="ja">Met voorinschrijving / kwam inschrijven</option>
            <option value="nee">Zonder voorinschrijving / kwam niet</option>
          </select>
          <select aria-label="Status" value={f.status} onChange={(e) => zet({ status: e.target.value as Filters['status'] })}>
            <option value="actief">Actieve inschrijvingen</option>
            <option value="geannuleerd">Geannuleerd of vervangen</option>
            <option value="alle">Alle</option>
          </select>
          {JSON.stringify(f) !== JSON.stringify(GEEN_FILTER) && <button type="button" className="d-link" onClick={() => setF(GEEN_FILTER)}>Filters wissen</button>}
        </div>
      )}

      {rapport === 'dubbels' ? (
        <Dubbels data={data} naVerandering={laad} />
      ) : tabel && (
        <>
          <p className="d-klein">{tabel.rijen.length} rij(en).</p>
          <TabelWeergave tabel={tabel} data={data} evenementId={evenementId} balk={rapport === 'tijdlijn' ? 2 : rapport === 'scholen' || rapport === 'leerjaren' ? 2 : rapport === 'lesjes' ? 3 : undefined} />
        </>
      )}
    </>
  );
}

function Teller({ waarde, label }: { waarde: number; label: string }) {
  return <div className="d-kaart m-teller"><strong>{waarde}</strong><span>{label}</span></div>;
}

function Kies({ label, waarde, opties, onKies }: { label: string; waarde: string; opties: (string | [string, string])[]; onKies: (w: string) => void }) {
  return (
    <select aria-label={label} value={waarde} onChange={(e) => onKies(e.target.value)}>
      <option value="">{label}: alle</option>
      {opties.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

function heeftEerder(data: EvenementOverzichtData, persoonId: string, evenementId: string) {
  const eigen = (data.historiek[persoonId] ?? []).some((h) => h.evenementId !== evenementId && h.soort === 'inschrijving');
  const contact = data.personen[persoonId]?.contactId;
  const broers = (contact ? data.gezinnen[contact] ?? [] : []).filter((p) => p !== persoonId);
  return eigen || broers.some((p) => (data.historiek[p] ?? []).some((h) => h.evenementId !== evenementId));
}

// ---------------------------------------------------------------------------
// Rapporten als tabel (ook voor Excel)
// ---------------------------------------------------------------------------

function maakTabel(rapport: Rapport, ins: OverzichtInschrijving[], voor: EvenementOverzichtData['voorinschrijvingen'], naamVoor: (v: { persoonId: string | null; naam: string | null }) => string): Tabel | null {
  const tel = <T,>(lijst: T[], sleutel: (x: T) => string[]) => {
    const m = new Map<string, number>();
    for (const x of lijst) for (const k of sleutel(x)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  switch (rapport) {
    case 'inschrijvingen':
      return {
        kop: ['Naam', 'Ingeschreven op', 'School', 'Leerjaar', 'Stroom', 'Moment', 'Lesjes', 'Voorinschrijving', 'Aanwezig', 'Status'],
        personen: ins.map((i) => i.persoonId),
        rijen: ins.map((i) => [
          volledig(i), datumTijd(i.ingeschrevenOp), i.school || '—', i.leerjaar ?? '—', i.doelgroep ?? '—',
          i.momenten.map(momentLabel).join(', ') || '—',
          i.lesjes.map((l) => `${l.titel}${l.wachtlijst ? ' (wachtlijst)' : ''}`).join(', ') || '—',
          i.voorinschrijving ? 'ja' : 'nee', i.momenten.some((m) => m.aanwezig) ? 'ja' : '', i.status === 'actief' ? '' : 'geannuleerd',
        ]),
      };
    case 'voorinschrijvingen':
      return {
        kop: ['Naam', 'Voorinschrijving op', 'School', 'Klas', 'Info voor', 'Ingeschreven voor de infodag'],
        personen: voor.map((v) => v.persoonId),
        rijen: voor.map((v) => [naamVoor(v), datumTijd(v.ingediendOp), v.school || '—', v.klas ?? '—', v.schooljaar ?? '—', v.ingeschreven ? 'ja' : 'nee']),
      };
    case 'scholen':
    case 'leerjaren': {
      const sleutelI = (i: OverzichtInschrijving) => [(rapport === 'scholen' ? i.school : i.leerjaar) || '(niet ingevuld)'];
      const sleutelV = (v: EvenementOverzichtData['voorinschrijvingen'][number]) => [(rapport === 'scholen' ? v.school : v.klas) || '(niet ingevuld)'];
      const [a, b, c, d] = [tel(ins, sleutelI), tel(voor, sleutelV), tel(ins.filter((i) => i.voorinschrijving), sleutelI), tel(ins.filter((i) => i.momenten.some((m) => m.aanwezig)), sleutelI)];
      const sleutels = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => (a.get(y) ?? 0) - (a.get(x) ?? 0) || (b.get(y) ?? 0) - (b.get(x) ?? 0) || x.localeCompare(y, 'nl'));
      return {
        kop: [rapport === 'scholen' ? 'School' : 'Leerjaar', 'Voorinschrijvingen', 'Ingeschreven', 'waarvan met voorinschrijving', 'Aanwezig'],
        getal: [1, 2, 3, 4],
        rijen: sleutels.map((k) => [k, b.get(k) ?? 0, a.get(k) ?? 0, c.get(k) ?? 0, d.get(k) ?? 0]),
      };
    }
    case 'lesjes': {
      const m = new Map<string, { moment: string; datum: string; start: string; tijdsblok: string; titel: string; n: number; wachtlijst: number }>();
      for (const i of ins) {
        for (const l of i.lesjes) {
          const mo = i.momenten[0];
          const k = `${mo?.id}|${l.tijdsblok}|${l.titel}`;
          const x = m.get(k) ?? { moment: mo ? momentLabel(mo) : '—', datum: mo?.datum ?? '', start: l.start, tijdsblok: l.tijdsblok, titel: l.titel, n: 0, wachtlijst: 0 };
          if (l.wachtlijst) x.wachtlijst++;
          else x.n++;
          m.set(k, x);
        }
      }
      const lijst = [...m.values()].sort((a, b) => a.datum.localeCompare(b.datum) || a.moment.localeCompare(b.moment) || a.start.localeCompare(b.start) || b.n - a.n);
      return { kop: ['Moment', 'Tijdsblok', 'Lesje', 'Ingeschreven', 'Wachtlijst'], getal: [3, 4], rijen: lijst.map((x) => [x.moment, x.tijdsblok, x.titel, x.n, x.wachtlijst]) };
    }
    case 'tijdlijn': {
      const week = (iso: string | null) => {
        if (!iso) return '(onbekend)';
        const d = new Date(iso);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return d.toISOString().slice(0, 10);
      };
      const [a, b] = [tel(ins, (i) => [week(i.ingeschrevenOp)]), tel(voor, (v) => [week(v.ingediendOp)])];
      const weken = [...new Set([...a.keys(), ...b.keys()])].sort();
      let totaal = 0;
      return {
        kop: ['Week van', 'Voorinschrijvingen', 'Inschrijvingen', 'Inschrijvingen (totaal)'],
        getal: [1, 2, 3],
        rijen: weken.map((w) => [w === '(onbekend)' ? w : datum(w), b.get(w) ?? 0, a.get(w) ?? 0, (totaal += a.get(w) ?? 0)]),
      };
    }
    default:
      return null;
  }
}

function exporteer(titel: string, rapport: Rapport, t: Tabel) {
  const naam = RAPPORTEN.find(([id]) => id === rapport)?.[1] ?? rapport;
  download(
    maakXlsx([{ naam: naam.slice(0, 31), rijen: [t.kop.map((v) => ({ v, vet: true })), ...t.rijen], breedtes: t.kop.map((k, i) => (i === 0 ? 30 : Math.max(12, k.length + 2))) }]),
    `${titel} - ${naam}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'),
  );
}

function TabelWeergave({ tabel, data, evenementId, balk }: { tabel: Tabel; data: EvenementOverzichtData; evenementId: string; balk?: number }) {
  const max = balk !== undefined ? Math.max(1, ...tabel.rijen.map((r) => Number(r[balk]) || 0)) : 1;
  return (
    <div className="d-tabelvak">
      <table className="d-tabel d-tabel--compact">
        <thead><tr>{tabel.kop.map((k, i) => <th key={k} className={tabel.getal?.includes(i) ? 'getal' : undefined}>{k}</th>)}</tr></thead>
        <tbody>
          {tabel.rijen.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={tabel.getal?.includes(ci) ? 'getal' : undefined}>
                  {ci === 0 && tabel.personen ? <NaamMetHistoriek naam={String(c)} persoonId={tabel.personen[ri]} data={data} evenementId={evenementId} /> : c}
                  {ci === balk && <span className="h-balk" style={{ width: `${(Number(c) / max) * 100}%` }} aria-hidden="true" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historiek bij een naam
// ---------------------------------------------------------------------------

function NaamMetHistoriek({ naam, persoonId, data, evenementId }: { naam: string; persoonId: string | null; data: EvenementOverzichtData; evenementId: string }) {
  const [open, setOpen] = useState(false);
  if (!persoonId) return <span className="pii">{naam}</span>;
  return (
    <span className="h-naam pii" tabIndex={0} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {naam}
      {open && <span className="h-pop" role="tooltip"><Historiek persoonId={persoonId} data={data} evenementId={evenementId} /></span>}
    </span>
  );
}

function Historiek({ persoonId, data, evenementId }: { persoonId: string; data: EvenementOverzichtData; evenementId: string }) {
  const p = data.personen[persoonId];
  const broers = (p ? data.gezinnen[p.contactId] ?? [] : []).filter((x) => x !== persoonId);
  const items = (id: string) => data.historiek[id] ?? [];
  const regel = (h: EvenementOverzichtData['historiek'][string][number]): ReactNode => (
    <>
      <strong>{h.schooljaar ?? '?'}</strong> · {h.soort === 'inschrijving' ? 'Inschrijving' : 'Voorinschrijving'}
      {h.evenementId === evenementId && ' (dit evenement)'} · {datum(h.datum)}
      {h.leerjaar && ` · ${h.leerjaar}`}{h.school && ` · ${h.school}`}
      {h.detail && <span className="d-klein"> · {h.detail}</span>}
      {h.aanwezig && <span className="d-ok"> aanwezig</span>}
      {h.geannuleerd && <span className="d-nee"> geannuleerd</span>}
    </>
  );
  return (
    <>
      <strong className="h-pop__titel">{p?.naam}</strong>
      {items(persoonId).length ? <ul>{items(persoonId).map((h, i) => <li key={i}>{regel(h)}</li>)}</ul> : <p className="d-klein">Geen andere gegevens.</p>}
      {broers.length > 0 && (
        <>
          <strong>Broer of zus</strong>
          <ul>
            {broers.map((b) => (
              <li key={b}>
                {data.personen[b]?.naam}
                {items(b).length ? <ul>{items(b).map((h, i) => <li key={i}>{regel(h)}</li>)}</ul> : <span className="d-klein"> (nog niets)</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dubbels
// ---------------------------------------------------------------------------

const normaliseer = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');

function afstand(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let vorige = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, vorige + (a[i - 1] === b[j - 1] ? 0 : 1));
      vorige = tmp;
    }
  }
  return d[b.length];
}

export interface Groep { leden: OverzichtInschrijving[]; soort: 'open' | 'vraag' | 'ok'; verschillen: string[]; waarom: string[] }

const keuzes = (i: OverzichtInschrijving) => ({
  stroom: i.doelgroep ?? '',
  moment: i.momenten.map(momentLabel).join(', '),
  lesjes: i.lesjes.map((l) => l.titel).sort().join(', '),
});

/**
 * Groepen van inschrijvingen die waarschijnlijk hetzelfde kind zijn: zelfde persoon, zelfde naam met een ander
 * e-mailadres (en dan ook dezelfde school of hetzelfde leerjaar: anders zijn het vaak twee kinderen), of een bijna
 * gelijke naam bij hetzelfde e-mailadres. Geanonimiseerde inschrijvingen tellen niet mee.
 *   open  = meer dan één actieve inschrijving: samenvoegen
 *   vraag = er is er nog één actief, maar de keuzes verschilden (stroom, moment, lesjes): vragen wat klopt
 *   ok    = opgelost (bv. een identieke, vervangen inzending)
 */
export function zoekDubbels(lijst: OverzichtInschrijving[]): Groep[] {
  const ins = lijst.filter((i) => i.naam !== '(geanonimiseerd)');
  const ouder = ins.map((_, i) => i);
  const wortel = (i: number): number => (ouder[i] === i ? i : (ouder[i] = wortel(ouder[i])));
  const redenen = new Map<number, Set<string>>();
  const verbind = (a: number, b: number, reden: string) => {
    for (const i of [a, b]) redenen.set(i, (redenen.get(i) ?? new Set()).add(reden));
    ouder[wortel(a)] = wortel(b);
  };
  const eerste = new Map<string, number>();
  const namen = ins.map((i) => normaliseer(volledig(i)));
  ins.forEach((x, i) => {
    if (!x.persoonId) return;
    const k = `p:${x.persoonId}`;
    if (eerste.has(k)) verbind(i, eerste.get(k)!, 'zelfde kind');
    else eerste.set(k, i);
  });
  const perNaam = new Map<string, number[]>();
  ins.forEach((_, i) => namen[i] && perNaam.set(namen[i], [...(perNaam.get(namen[i]) ?? []), i]));
  for (const ids of perNaam.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const [x, y] = [ins[ids[a]], ins[ids[b]]];
        const zelfdeAdres = !!x.email && x.email.toLowerCase() === y.email?.toLowerCase();
        if (zelfdeAdres || (x.school && x.school === y.school) || (x.leerjaar && x.leerjaar === y.leerjaar)) {
          verbind(ids[a], ids[b], zelfdeAdres ? 'zelfde naam' : 'zelfde naam, ander e-mailadres');
        }
      }
    }
  }
  // Bijna dezelfde naam bij hetzelfde e-mailadres (tikfout, naam en voornaam omgewisseld met een fout …)
  const perEmail = new Map<string, number[]>();
  ins.forEach((x, i) => x.email && perEmail.set(x.email.toLowerCase(), [...(perEmail.get(x.email.toLowerCase()) ?? []), i]));
  for (const ids of perEmail.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = afstand(namen[ids[a]], namen[ids[b]]);
        if (d > 0 && d <= 2) verbind(ids[a], ids[b], 'bijna dezelfde naam, zelfde e-mailadres');
      }
    }
  }
  const groepen = new Map<number, number[]>();
  ins.forEach((_, i) => groepen.set(wortel(i), [...(groepen.get(wortel(i)) ?? []), i]));
  return [...groepen.values()]
    .filter((g) => g.length > 1)
    .map((ids) => {
      const g = ids.map((i) => ins[i]);
      const waarom = [...new Set(ids.flatMap((i) => [...(redenen.get(i) ?? [])]))];
      const leden = [...g].sort((a, b) => b.ingeschrevenOp.localeCompare(a.ingeschrevenOp));
      const k = leden.map(keuzes);
      const verschillen = (['stroom', 'moment', 'lesjes'] as const).filter((veld) => new Set(k.map((x) => x[veld])).size > 1);
      const actief = leden.filter((l) => l.status === 'actief').length;
      return { leden, verschillen, waarom, soort: actief > 1 ? 'open' : verschillen.length ? 'vraag' : 'ok' } as Groep;
    })
    .sort((a, b) => ['open', 'vraag', 'ok'].indexOf(a.soort) - ['open', 'vraag', 'ok'].indexOf(b.soort) || volledig(a.leden[0]).localeCompare(volledig(b.leden[0]), 'nl'));
}

function Dubbels({ data, naVerandering }: { data: EvenementOverzichtData; naVerandering: () => void }) {
  const groepen = useMemo(() => zoekDubbels(data.inschrijvingen), [data]);
  const [ookOk, setOokOk] = useState(false);
  const [mail, setMail] = useState<Groep | null>(null);
  const [gemaild, setGemaild] = useState<Set<string>>(new Set());
  const zichtbaar = groepen.filter((g) => ookOk || g.soort !== 'ok');
  const aantal = (s: Groep['soort']) => groepen.filter((g) => g.soort === s).length;
  return (
    <>
      <Melding>
        <strong>{aantal('open')}</strong> kind(eren) met meer dan één actieve inschrijving (samenvoegen), <strong>{aantal('vraag')}</strong> met verschillende keuzes
        (stroom, moment of lesjes: navragen), {aantal('ok')} opgelost. Voorstel: de laatste inschrijving blijft. Een andere kiezen kan.
      </Melding>
      <label className="d-klein"><input type="checkbox" checked={ookOk} onChange={(e) => setOokOk(e.target.checked)} /> Ook opgeloste tonen</label>
      {!zichtbaar.length && <Melding soort="ok">Geen dubbels om na te kijken.</Melding>}
      {zichtbaar.map((g) => (
        <DubbelGroep key={g.leden.map((l) => l.id).join()} groep={g} evenementId={data.evenement.id} gemaild={gemaild.has(g.leden[0].id)}
          onMail={() => setMail(g)} naVerandering={naVerandering} />
      ))}
      {mail && (
        <MailVraag groep={mail} evenement={data.evenement.titel} evenementId={data.evenement.id} onSluit={() => setMail(null)}
          naVerstuurd={() => {
            setGemaild(new Set([...gemaild, mail.leden[0].id]));
            setMail(null);
          }} />
      )}
    </>
  );
}

function DubbelGroep({ groep, evenementId, gemaild, onMail, naVerandering }: { groep: Groep; evenementId: string; gemaild: boolean; onMail: () => void; naVerandering: () => void }) {
  const [behoud, setBehoud] = useState(groep.leden[0].id);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const weg = groep.leden.filter((l) => l.id !== behoud && l.status === 'actief').map((l) => l.id);
  const blijftActief = groep.leden.find((l) => l.id === behoud)?.status === 'actief';
  const samenvoegen = async () => {
    setBezig(true);
    setFout(null);
    try {
      await historiekApi.voegSamen(evenementId, behoud, weg.length ? weg : groep.leden.filter((l) => l.id !== behoud).map((l) => l.id));
      naVerandering();
    } catch (e) {
      setFout(foutTekst(e));
      setBezig(false);
    }
  };
  const badge = { open: ['gesloten', 'Samenvoegen'], vraag: ['concept', 'Keuzes verschillen'], ok: ['gepubliceerd', 'Opgelost'] }[groep.soort];
  return (
    <section className="d-kaart h-groep">
      <div className="d-paginakop">
        <h3>{volledig(groep.leden[0])} <span className={`d-badge d-badge--${badge[0]}`}>{badge[1]}</span>{gemaild && <span className="d-badge"> gemaild</span>}</h3>
        <span className="d-klein">Gevonden op: {groep.waarom.join(', ')}{groep.verschillen.length > 0 && ` · verschil in: ${groep.verschillen.join(', ')}`}</span>
      </div>
      {fout && <Melding soort="fout">{fout}</Melding>}
      <div className="d-tabelvak">
        <table className="d-tabel d-tabel--compact">
          <thead><tr><th>Bewaren</th><th>Naam</th><th>E-mailadres</th><th>Ingeschreven op</th><th>Stroom</th><th>Moment</th><th>Lesjes</th><th>Status</th></tr></thead>
          <tbody>
            {groep.leden.map((l) => {
              const k = keuzes(l);
              return (
                <tr key={l.id} className={l.status === 'actief' ? undefined : 'd-gedimd'}>
                  <td><input type="radio" name={`behoud-${groep.leden[0].id}`} aria-label={`${volledig(l)} bewaren`} checked={behoud === l.id} onChange={() => setBehoud(l.id)} /></td>
                  <td className="pii">{volledig(l)}</td>
                  <td className="pii">{l.email ?? '—'}</td>
                  <td>{datumTijd(l.ingeschrevenOp)}</td>
                  <td className={groep.verschillen.includes('stroom') ? 'h-verschil' : undefined}>{k.stroom || '—'}</td>
                  <td className={groep.verschillen.includes('moment') ? 'h-verschil' : undefined}>{k.moment || '—'}</td>
                  <td className={groep.verschillen.includes('lesjes') ? 'h-verschil' : undefined}>{k.lesjes || '—'}</td>
                  <td>{l.status === 'actief' ? 'actief' : 'geannuleerd / vervangen'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="d-knoppen d-knoppen--links">
        {blijftActief && !weg.length ? (
          <span className="d-klein">De gekozen inschrijving is de enige actieve. Kies een andere om die terug te zetten.</span>
        ) : (
          <button type="button" className="d-knop" disabled={bezig} onClick={samenvoegen}>
            {blijftActief ? `Samenvoegen: gekozen bewaren, ${weg.length} annuleren` : 'Gekozen inschrijving terugzetten, de andere annuleren'}
          </button>
        )}
        <button type="button" className="d-knop d-knop--secundair" onClick={onMail} disabled={!groep.leden.some((l) => l.email)}>Mail met vraag…</button>
      </div>
    </section>
  );
}

/** Voorgestelde tekst; de medewerker past ze aan voor het versturen. */
export function vraagTekst(groep: Groep, evenement: string) {
  const [laatste] = groep.leden;
  const ouder = groep.leden.map((l) => l.ouder).find(Boolean);
  const kind = laatste.voornaam || volledig(laatste);
  const beschrijf = (l: OverzichtInschrijving) => {
    const k = keuzes(l);
    return [k.stroom, k.moment, k.lesjes ? `lesjes: ${k.lesjes}` : 'geen lesje'].filter(Boolean).join(', ');
  };
  const onderwerp = `Vraag over de inschrijving van ${kind} voor ${evenement}`;
  const tekst = `Dag${ouder ? ` ${ouder}` : ''},

Voor ${evenement} kregen we meer dan één inschrijving voor ${volledig(laatste)}:

${groep.leden.map((l) => `- ingeschreven op ${datumTijd(l.ingeschrevenOp)}: ${beschrijf(l)}`).join('\n')}

We houden de laatste inschrijving aan: **${beschrijf(laatste)}**.

Klopt dat? Of wil je liever een andere keuze${groep.verschillen.length ? ` (${groep.verschillen.join(', ')})` : ''}? Laat het ons weten door op deze mail te antwoorden.

Met vriendelijke groeten`;
  return { onderwerp, tekst };
}

function MailVraag({ groep, evenement, evenementId, onSluit, naVerstuurd }: { groep: Groep; evenement: string; evenementId: string; onSluit: () => void; naVerstuurd: () => void }) {
  const voorstel = useMemo(() => vraagTekst(groep, evenement), [groep, evenement]);
  const [onderwerp, setOnderwerp] = useState(voorstel.onderwerp);
  const [tekst, setTekst] = useState(voorstel.tekst);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const aan = [...new Set(groep.leden.map((l) => l.email?.toLowerCase()).filter((x): x is string => !!x))];
  const mailto = `mailto:${aan.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(onderwerp)}&body=${encodeURIComponent(tekst.replace(/\*\*/g, ''))}`;
  return (
    <Venster titel="Mail met een vraag" onSluit={onSluit} breed>
      {fout && <Melding soort="fout">{fout}</Melding>}
      <p className="d-klein">Aan: <strong className="pii">{aan.join(', ')}</strong> (één mail per adres, met de opmaak en voettekst van het platform)</p>
      <div className="d-veld">
        <label htmlFor="vraag-onderwerp">Onderwerp</label>
        <input id="vraag-onderwerp" value={onderwerp} onChange={(e) => setOnderwerp(e.target.value)} />
      </div>
      <div className="d-veld">
        <label htmlFor="vraag-tekst">Tekst</label>
        <textarea id="vraag-tekst" className="d-bericht" rows={14} value={tekst} onChange={(e) => setTekst(e.target.value)} />
        <span className="d-veld__hulp">Een lege regel = nieuwe alinea. **zo** wordt vet.</span>
      </div>
      <details className="d-info">
        <summary>Voorbeeld</summary>
        <div className="h-voorbeeld">
          {tekst.split(/\n\s*\n/).map((a, i) => (
            <p key={i}>{a.split('\n').flatMap((r, j) => [j ? <br key={`b${j}`} /> : null, ...r.split(/\*\*(.+?)\*\*/g).map((d, x) => (x % 2 ? <strong key={`${j}-${x}`}>{d}</strong> : d))])}</p>
          ))}
        </div>
      </details>
      <div className="d-knoppen">
        <button type="button" className="d-knop d-knop--secundair" onClick={() => { setOnderwerp(voorstel.onderwerp); setTekst(voorstel.tekst); }}>Voorstel terugzetten</button>
        <a className="d-knop d-knop--secundair" href={mailto}>Openen in mijn mail</a>
        <button type="button" className="d-knop" disabled={bezig || !onderwerp.trim() || !tekst.trim()}
          onClick={async () => {
            if (!confirm(`Deze mail versturen naar ${aan.join(', ')}?`)) return;
            setBezig(true);
            setFout(null);
            try {
              const r = await historiekApi.mailVraag(evenementId, groep.leden.map((l) => l.id), onderwerp.trim(), tekst.trim());
              if (r.mislukt) throw new Error();
              naVerstuurd();
            } catch (e) {
              setFout(foutTekst(e, 'Versturen mislukt. Controleer de mailinstellingen (testmail onder Medewerkers).'));
              setBezig(false);
            }
          }}>
          {bezig ? 'Bezig…' : 'Versturen'}
        </button>
      </div>
    </Venster>
  );
}
