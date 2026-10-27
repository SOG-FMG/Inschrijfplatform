import { useCallback, useEffect, useMemo, useState } from 'react';
import { contactenApi, type Contact, type ContactVermelding, type Profiel } from '../services/beheerApi';
import { download, maakXlsx } from './excel';
import { leesGeplakt, type GeplakContact, type Volgorde } from './import/plakken';
import { datum, foutTekst, Invoer, Link, Melding, Venster } from './ui';

/**
 * Contacten (/dashboard/contacten): iedereen die in het platform voorkomt, één keer per e-mailadres, met waar die
 * persoon voorkomt (medewerker, lesgever, inschrijving, voorinschrijving …). Ouders en inschrijvers enkel met het recht
 * kern.contacten.extern (Rollen en rechten; ook voor de platformbeheerder standaard uit).
 */

type Tab = 'intern' | 'extern';

export function Contacten({ profiel }: { profiel: Profiel }) {
  const [data, setData] = useState<{ extern: boolean; contacten: Contact[] } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('intern');
  const [zoek, setZoek] = useState('');
  const [soort, setSoort] = useState('');
  const [evenement, setEvenement] = useState('');
  const [open, setOpen] = useState<Contact | null>(null);
  const [plakken, setPlakken] = useState(false);
  const [verslag, setVerslag] = useState<string | null>(null);
  const mag = (r: string) => profiel.rechten.includes(r);

  const laad = useCallback(() => {
    contactenApi.lijst().then(setData).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  // Intern = medewerkers en lesgevers (wie ook ouder is, staat in beide tabbladen).
  const inTab = (c: Contact) => (tab === 'extern' ? c.extern : c.soorten.some((s) => !EXTERNE_SOORTEN.has(s)));
  const alleVermeldingen = (c: Contact) => [...c.vermeldingen, ...c.personen.flatMap((p) => p.vermeldingen)];

  const lijst = useMemo(() => {
    if (!data) return [];
    const z = zoek.trim().toLowerCase();
    return data.contacten.filter((c) =>
      inTab(c) &&
      (!z || c.naam.toLowerCase().includes(z) || c.email?.includes(z) || c.personen.some((p) => p.naam.toLowerCase().includes(z))) &&
      (!soort || c.soorten.includes(soort)) &&
      (!evenement || alleVermeldingen(c).some((v) => v.evenementId === evenement)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, zoek, soort, evenement]);

  if (fout) return <Melding soort="fout">{fout}</Melding>;
  if (!data) return <p>Laden…</p>;

  const soorten = [...new Set(data.contacten.filter(inTab).flatMap((c) => c.soorten))].sort((a, b) => a.localeCompare(b, 'nl'));
  const exporteer = () =>
    download(
      maakXlsx([{
        naam: tab === 'extern' ? 'Ouders en inschrijvers' : 'Medewerkers en lesgevers',
        rijen: [
          ['Naam', 'E-mailadres', ...(tab === 'extern' ? ['Telefoon', 'Kinderen'] : []), 'Komt voor als', 'Komt voor in'].map((v) => ({ v, vet: true })),
          ...lijst.map((c) => [
            c.naam, c.email ?? '', ...(tab === 'extern' ? [c.telefoon ?? '', c.personen.map((p) => p.naam).join(', ')] : []),
            c.soorten.join(', '), alleVermeldingen(c).map((v) => `${v.soort}: ${v.omschrijving}`).join('\n'),
          ]),
        ],
        breedtes: [28, 32, ...(tab === 'extern' ? [16, 28] : []), 24, 80],
      }]),
      `Contacten - ${tab === 'extern' ? 'ouders en inschrijvers' : 'medewerkers en lesgevers'}.xlsx`,
    );

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Contacten</h1>
          <p className="d-sub">Iedereen die in het platform voorkomt, één keer per e-mailadres, met waar die persoon voorkomt.</p>
        </div>
        <div className="d-knoppen d-knoppen--links">
          {(mag('kern.contacten.toevoegen') || mag('evenementen.sessiegevers.beheren')) && (
            <button type="button" className="d-knop" onClick={() => setPlakken(true)}>+ Contacten plakken</button>
          )}
          <button type="button" className="d-knop d-knop--secundair" onClick={exporteer} disabled={!lijst.length}>Excel</button>
        </div>
      </header>
      {verslag && <Melding soort="ok">{verslag}</Melding>}

      <div className="h-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'intern'} className={tab === 'intern' ? 'actief' : undefined} onClick={() => { setTab('intern'); setSoort(''); }}>
          Medewerkers en lesgevers
        </button>
        <button type="button" role="tab" aria-selected={tab === 'extern'} className={tab === 'extern' ? 'actief' : undefined} onClick={() => { setTab('extern'); setSoort(''); }}>
          Ouders en inschrijvers
        </button>
      </div>

      {tab === 'extern' && !data.extern ? (
        <Melding>
          Ouders en inschrijvers staan uit. Ze verschijnen hier zodra hun rol het recht <em>In de contactenlijst ook ouders en inschrijvers zien</em> krijgt
          {profiel.rechten.includes('kern.gebruikers.beheren') ? <> bij <Link href="/dashboard/medewerkers/rechten">Rollen en rechten</Link></> : ' (vraag het aan een platformbeheerder)'}.
          Zet het enkel aan na afspraak met de DPO: het brengt de gegevens van ouders en kinderen over evenementen en schooljaren heen samen.
        </Melding>
      ) : (
        <>
          <div className="d-werkbalk">
            <input type="search" placeholder={tab === 'extern' ? 'Zoeken op naam, kind of e-mailadres…' : 'Zoeken op naam of e-mailadres…'} aria-label="Zoeken"
              value={zoek} onChange={(e) => setZoek(e.target.value)} />
            <select aria-label="Soort" value={soort} onChange={(e) => setSoort(e.target.value)}>
              <option value="">Alle soorten</option>
              {soorten.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Evenement" value={evenement} onChange={(e) => setEvenement(e.target.value)}>
              <option value="">Alle evenementen</option>
              {profiel.evenementen.map((e) => <option key={e.id} value={e.id}>{e.titel}</option>)}
            </select>
          </div>
          <p className="d-klein">{lijst.length} contact(en).</p>
          <div className="d-tabelvak">
            <table className="d-tabel d-tabel--compact">
              <thead>
                <tr>
                  <th>Naam</th><th>E-mailadres</th>{tab === 'extern' && <><th>Telefoon</th><th>Kinderen</th></>}
                  <th>Komt voor als</th><th className="getal">Vermeldingen</th><th />
                </tr>
              </thead>
              <tbody>
                {lijst.map((c) => (
                  <tr key={c.id}>
                    <td className="pii"><button type="button" className="d-link" onClick={() => setOpen(c)}>{c.naam}</button></td>
                    <td className="pii">{c.email ?? '—'}</td>
                    {tab === 'extern' && <><td className="pii">{c.telefoon ?? '—'}</td><td className="pii">{c.personen.map((p) => p.naam).join(', ') || '—'}</td></>}
                    <td>{c.soorten.map((s) => <span key={s} className={`d-badge c-soort${EXTERNE_SOORTEN.has(s) ? ' c-soort--extern' : ''}`}>{s}</span>)}</td>
                    <td className="getal">{alleVermeldingen(c).length}</td>
                    <td><button type="button" className="d-link" onClick={() => setOpen(c)}>Bekijken</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <ContactVenster contact={open} onSluit={() => setOpen(null)}
          uitGroep={mag('kern.contacten.toevoegen') ? async (groep) => {
            await contactenApi.uitGroep(open.id, groep);
            setOpen(null);
            setVerslag(`${open.naam} is uit de groep "${groep}" gehaald.`);
            laad();
          } : undefined} />
      )}
      {plakken && (
        <ContactenPlakken bestaand={data.contacten} magContact={mag('kern.contacten.toevoegen')} magLesgever={mag('evenementen.sessiegevers.beheren')}
          onSluit={() => setPlakken(false)}
          naKlaar={(tekst) => {
            setPlakken(false);
            setVerslag(tekst);
            laad();
          }} />
      )}
    </>
  );
}

/** Soorten die van buiten de organisatie komen (bronnen met extern). */
const EXTERNE_SOORTEN = new Set(['Inschrijving', 'Voorinschrijving', 'Uitnodiging']);

function ContactVenster({ contact: c, onSluit, uitGroep }: { contact: Contact; onSluit: () => void; uitGroep?: (groep: string) => void }) {
  return (
    <Venster titel={c.naam} onSluit={onSluit} breed>
      <dl className="d-gegevens">
        <dt>E-mailadres</dt><dd className="pii">{c.email ?? '—'}</dd>
        {c.telefoon && <><dt>Telefoon</dt><dd className="pii">{c.telefoon}</dd></>}
        <dt>Komt voor als</dt><dd>{c.soorten.join(', ')}</dd>
      </dl>
      {c.vermeldingen.length > 0 && <Vermeldingen titel="Komt voor in" lijst={c.vermeldingen} uitGroep={uitGroep} />}
      {c.personen.map((p) => <Vermeldingen key={p.naam} titel={`Kind: ${p.naam}`} lijst={p.vermeldingen} />)}
    </Venster>
  );
}

function Vermeldingen({ titel, lijst, uitGroep }: { titel: string; lijst: ContactVermelding[]; uitGroep?: (groep: string) => void }) {
  const perSoort = new Map<string, ContactVermelding[]>();
  for (const v of [...lijst].sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))) perSoort.set(v.soort, [...(perSoort.get(v.soort) ?? []), v]);
  return (
    <section className="c-vermeldingen">
      <h3>{titel}</h3>
      {[...perSoort].map(([soort, items]) => (
        <div key={soort}>
          <strong>{soort}</strong>
          <ul className="d-lijst">
            {items.map((v, i) => (
              <li key={i}>
                {v.link ? <a href={v.link} target="_blank" rel="noopener">{v.omschrijving} ↗</a> : v.omschrijving}
                {v.datum && <span className="d-klein"> · {datum(v.datum)}</span>}
                {v.soort === 'Contact' && uitGroep && (
                  <> · <button type="button" className="d-link" onClick={() => confirm(`Uit de groep "${v.omschrijving}" halen?`) && uitGroep(v.omschrijving)}>uit deze groep halen</button></>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Contacten plakken
// ---------------------------------------------------------------------------

const HERKEND: Record<GeplakContact['herkend'], string> = {
  adres: 'voornaam uit het adres',
  komma: '"Achternaam, Voornaam"',
  volgorde: 'volgens de gekozen volgorde: kijk na',
  'uit-adres': 'geen naam: uit het adres, kijk na',
};

function ContactenPlakken({ bestaand, magContact, magLesgever, onSluit, naKlaar }: {
  bestaand: Contact[]; magContact: boolean; magLesgever: boolean; onSluit: () => void; naKlaar: (verslag: string) => void;
}) {
  const [tekst, setTekst] = useState('');
  const [volgorde, setVolgorde] = useState<Volgorde>('naam-voornaam');
  const [als, setAls] = useState<'contact' | 'lesgever'>(magContact ? 'contact' : 'lesgever');
  const [groep, setGroep] = useState('');
  const [rijen, setRijen] = useState<GeplakContact[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const perAdres = useMemo(() => new Map(bestaand.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c])), [bestaand]);

  // Opnieuw lezen bij elke wijziging van de tekst of de volgorde (aangepaste namen gaan dan verloren).
  useEffect(() => setRijen(leesGeplakt(tekst, volgorde)), [tekst, volgorde]);

  const wijzig = (i: number, w: Partial<GeplakContact>) => setRijen(rijen.map((r, j) => (j === i ? { ...r, ...w } : r)));

  async function voegToe() {
    setBezig(true);
    setFout(null);
    const lijst = rijen.map(({ voornaam, naam, email }) => ({ voornaam: voornaam.trim(), naam: naam.trim(), email }));
    try {
      if (als === 'lesgever') {
        const r = await contactenApi.lesgeversToevoegen(lijst);
        naKlaar(`${r.nieuw} lesgever(s) toegevoegd${r.bestaand ? `, ${r.bestaand} bestonden al` : ''}${r.buitenDomein ? `, ${r.buitenDomein} overgeslagen (adres buiten de organisatie)` : ''}${r.ongeldig ? `, ${r.ongeldig} zonder voornaam of geldig adres` : ''}. Kies ze daarna per lesje bij Instellingen → Sessies.`);
      } else {
        const r = await contactenApi.toevoegen(groep.trim(), lijst);
        naKlaar(`${r.nieuw + r.bestaand} contact(en) in de groep "${r.groep}"${r.bestaand ? ` (${r.bestaand} stonden al in de contactenlijst)` : ''}${r.ongeldig ? `, ${r.ongeldig} ongeldig` : ''}.${r.buitenOrganisatie ? ` ${r.buitenOrganisatie} adres(sen) van buiten de organisatie staan bij Ouders en inschrijvers.` : ''}`);
      }
    } catch (e) {
      setFout(foutTekst(e));
      setBezig(false);
    }
  }

  return (
    <Venster titel="Contacten plakken" onSluit={onSluit} breed>
      {fout && <Melding soort="fout">{fout}</Melding>}
      <div className="d-veld">
        <label htmlFor="plak-tekst">Plak hier de adressen</label>
        <textarea id="plak-tekst" className="d-bericht" rows={5} value={tekst} onChange={(e) => setTekst(e.target.value)}
          placeholder={'"De Schepper Stijn" <stijn.deschepper@onderwijs.gent.be>; "Peeters An" <an.peeters@onderwijs.gent.be>'} />
        <span className="d-veld__hulp">Uit Outlook (Aan-veld of adresboek), losse adressen, of rijen uit Excel. De voornaam is het deel van de naam dat vooraan in het e-mailadres staat.</span>
      </div>
      <div className="d-rij">
        <div className="d-veld">
          <label htmlFor="plak-volgorde">Als het adres de voornaam niet verraadt</label>
          <select id="plak-volgorde" value={volgorde} onChange={(e) => setVolgorde(e.target.value as Volgorde)}>
            <option value="naam-voornaam">Achternaam Voornaam (zoals in Outlook)</option>
            <option value="voornaam-naam">Voornaam Achternaam</option>
          </select>
        </div>
        {magContact && magLesgever && (
          <div className="d-veld">
            <label htmlFor="plak-als">Toevoegen als</label>
            <select id="plak-als" value={als} onChange={(e) => setAls(e.target.value as typeof als)}>
              <option value="contact">Contact (in een groep)</option>
              <option value="lesgever">Lesgever (om aan lesjes te koppelen)</option>
            </select>
          </div>
        )}
        {als === 'contact' && <Invoer label="Groep" waarde={groep} onWijzig={setGroep} placeholder="bv. Leerkrachten FMG" hulp="Leeg = Met de hand toegevoegd" />}
      </div>

      {rijen.length > 0 && (
        <div className="d-tabelvak">
          <table className="d-tabel d-tabel--compact">
            <thead><tr><th>Voornaam</th><th>Achternaam</th><th>E-mailadres</th><th>Bestaat al als</th><th /></tr></thead>
            <tbody>
              {rijen.map((r, i) => {
                const b = perAdres.get(r.email);
                return (
                  <tr key={r.email}>
                    <td><input aria-label={`Voornaam ${r.email}`} value={r.voornaam} onChange={(e) => wijzig(i, { voornaam: e.target.value })} /></td>
                    <td><input aria-label={`Achternaam ${r.email}`} value={r.naam} onChange={(e) => wijzig(i, { naam: e.target.value })} /></td>
                    <td className="pii">{r.email}<div className="d-klein">{HERKEND[r.herkend]}</div></td>
                    <td>{b ? b.soorten.join(', ') : <span className="d-klein">nieuw</span>}</td>
                    <td><button type="button" className="d-icoonknop" aria-label={`${r.email} weglaten`} onClick={() => setRijen(rijen.filter((_, j) => j !== i))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tekst.trim() && !rijen.length && <Melding soort="let-op">Geen e-mailadressen gevonden.</Melding>}
      {als === 'lesgever' && <p className="d-klein">Enkel adressen van de eigen organisatie kunnen lesgever worden; andere worden overgeslagen.</p>}

      <div className="d-knoppen">
        <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
        <button type="button" className="d-knop" disabled={bezig || !rijen.length} onClick={voegToe}>
          {bezig ? 'Bezig…' : `${rijen.length} ${als === 'lesgever' ? 'lesgever(s)' : 'contact(en)'} toevoegen`}
        </button>
      </div>
    </Venster>
  );
}
