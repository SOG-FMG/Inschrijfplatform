import { useMemo, useState } from 'react';
import { beheerApi, instellingenApi, type Profiel } from '../services/beheerApi';
import { etiketUrl } from './Etiketten';
import { rapportUrl } from './Rapporten';
import { datum, datumTijd, foutTekst, Invoer, Link, Melding, navigeer, STATUSNAAM, Venster } from './ui';

/** Startpagina: alle evenementen waar je toegang toe hebt, in een tabel. */
export function Evenementen({ profiel, naVerandering }: { profiel: Profiel; naVerandering: () => void }) {
  const [zoek, setZoek] = useState('');
  const [status, setStatus] = useState('actief');
  const [nieuw, setNieuw] = useState(false);

  const lijst = useMemo(() => {
    const z = zoek.trim().toLowerCase();
    return profiel.evenementen.filter(
      (e) =>
        (status === 'alle' || (status === 'actief' ? e.status !== 'gearchiveerd' : e.status === status)) &&
        (!z || e.titel.toLowerCase().includes(z) || e.slug.includes(z)),
    );
  }, [profiel.evenementen, zoek, status]);

  return (
    <>
      <header className="d-paginakop">
        <div>
          <h1>Evenementen</h1>
          <p className="d-sub">{profiel.evenementen.length} evenement(en) waar je toegang toe hebt.</p>
        </div>
        {profiel.rol === 'platformbeheerder' && (
          <button type="button" className="d-knop" onClick={() => setNieuw(true)}>+ Nieuw evenement</button>
        )}
      </header>

      <div className="d-werkbalk">
        <input type="search" placeholder="Zoeken op titel…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoeken" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="actief">Niet gearchiveerd</option>
          <option value="alle">Alle</option>
          {Object.entries(STATUSNAAM).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {lijst.length === 0 ? (
        <Melding>Geen evenementen gevonden.{profiel.evenementen.length === 0 && ' Vraag een platformbeheerder om je aan een evenement te koppelen.'}</Melding>
      ) : (
        <div className="d-tabelvak">
          <table className="d-tabel">
            <thead>
              <tr>
                <th>Evenement</th>
                <th>Status</th>
                <th>Datum</th>
                <th>Inschrijven tot</th>
                <th className="getal">Ingeschreven</th>
                <th className="getal">Wachtlijst</th>
                <th>Mislukte mails</th>
                <th>Acties</th>
              </tr>
            </thead>
            <tbody>
              {lijst.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link href={`/dashboard/evenementen/${e.id}`} className="d-titel">{e.titel}</Link>
                    <div className="d-klein">/{e.slug}</div>
                  </td>
                  <td><span className={`d-badge d-badge--${e.status}`}>{STATUSNAAM[e.status] ?? e.status}</span></td>
                  <td>{e.start === e.eind ? datum(e.start) : `${datum(e.start)} – ${datum(e.eind)}`}</td>
                  <td>{datumTijd(e.inschrijvingTot)}</td>
                  <td className="getal">{e.deelnemers}</td>
                  <td className="getal">{e.wachtlijst || '—'}</td>
                  <td>
                    {e.mailMislukt > 0 ? (
                      <span className="d-nee" title="Zie het stappenplan: controleer de flow in Power Automate">{e.mailMislukt} mislukt</span>
                    ) : (
                      <span className="d-klein">—</span>
                    )}
                  </td>
                  <td className="d-acties">
                    <Link href={`/dashboard/evenementen/${e.id}`}>Instellingen</Link>
                    <Link href={rapportUrl(e.id)}>Rapporten</Link>
                    <Link href={etiketUrl(e.id)}>Etiketten</Link>
                    <a href={beheerApi.csvUrl(e.id)} download>Deelnemers (Excel)</a>
                    <a href={`/${e.slug}`} target="_blank" rel="noreferrer">Formulier ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nieuw && <NieuwEvenement onSluit={() => setNieuw(false)} naKlaar={naVerandering} />}
    </>
  );
}

const maakSlug = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function NieuwEvenement({ onSluit, naKlaar }: { onSluit: () => void; naKlaar: () => void }) {
  const [w, setW] = useState({ titel: '', slug: '', start_datum: '', eind_datum: '' });
  const [slugAangepast, setSlugAangepast] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  return (
    <Venster titel="Nieuw evenement" onSluit={onSluit}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setFout(null);
          try {
            const { id } = await instellingenApi.maak('evenement', null, { ...w, eind_datum: w.eind_datum || w.start_datum });
            naKlaar();
            navigeer(`/dashboard/evenementen/${id}`);
          } catch (err) {
            setFout(foutTekst(err, 'Aanmaken mislukt.'));
          }
        }}
      >
        {fout && <Melding soort="fout">{fout}</Melding>}
        <Invoer label="Titel" waarde={w.titel} verplicht autoFocus onWijzig={(v) => setW({ ...w, titel: v, slug: slugAangepast ? w.slug : maakSlug(v) })} />
        <Invoer
          label="Adres (slug)"
          waarde={w.slug}
          verplicht
          hulp={`Het formulier komt op ${location.origin}/${w.slug || '…'}`}
          onWijzig={(v) => {
            setSlugAangepast(true);
            setW({ ...w, slug: v });
          }}
        />
        <div className="d-rij">
          <Invoer label="Eerste dag" type="date" waarde={w.start_datum} verplicht onWijzig={(v) => setW({ ...w, start_datum: v })} />
          <Invoer label="Laatste dag" type="date" waarde={w.eind_datum} onWijzig={(v) => setW({ ...w, eind_datum: v })} hulp="Leeg = zelfde dag" />
        </div>
        <Melding>Het evenement start als <strong>concept</strong>: niet zichtbaar voor ouders tot je het op <em>gepubliceerd</em> zet.</Melding>
        <div className="d-knoppen">
          <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
          <button type="submit" className="d-knop" disabled={!w.titel || !w.slug || !w.start_datum}>Aanmaken en instellen</button>
        </div>
      </form>
    </Venster>
  );
}
