import { useCallback, useEffect, useState } from 'react';
import { beheerApi, type EvenementKort, type VoorinschrijfFormulierBeheer } from '../services/beheerApi';
import { foutTekst, Invoer, Melding, Venster } from './ui';

/**
 * Eigen voorinschrijvingsformulieren (publiek op /voorinschrijven/<slug>). Elk formulier verzamelt in een import
 * hieronder, met dezelfde statistieken, controles en uitnodigingen als een bestand uit Forms.
 */
export function VoorinschrijfFormulieren({ evenementen, naVerandering }: { evenementen: EvenementKort[]; naVerandering: () => void }) {
  const [lijst, setLijst] = useState<VoorinschrijfFormulierBeheer[] | null>(null);
  const [bewerk, setBewerk] = useState<VoorinschrijfFormulierBeheer | 'nieuw' | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(() => {
    beheerApi.voorinschrijfFormulieren().then(setLijst).catch((e) => setFout(foutTekst(e)));
  }, []);
  useEffect(laad, [laad]);

  const zetOpen = async (f: VoorinschrijfFormulierBeheer, open: boolean) => {
    setFout(null);
    try {
      await beheerApi.wijzigVoorinschrijfFormulier(f.id, { open });
      laad();
    } catch (e) {
      setFout(foutTekst(e));
    }
  };

  return (
    <section className="d-kaart">
      <div className="d-paginakop">
        <div>
          <h2>Formulieren</h2>
          <p className="d-klein">Een eigen voorinschrijvingsformulier in plaats van Microsoft Forms: inzendingen komen meteen als gezin en kind binnen, zonder import.</p>
        </div>
        <button type="button" className="d-knop" onClick={() => setBewerk('nieuw')}>+ Nieuw formulier</button>
      </div>
      {fout && <Melding soort="fout">{fout}</Melding>}
      {lijst && !lijst.length && <p className="d-klein">Nog geen formulieren.</p>}
      {lijst && lijst.length > 0 && (
        <div className="d-tabelvak">
          <table className="d-tabel d-tabel--compact">
            <thead><tr><th>Titel</th><th>Adres</th><th className="getal">Inzendingen</th><th>Open</th><th>Acties</th></tr></thead>
            <tbody>
              {lijst.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.titel}</strong>{f.schooljaar && <div className="d-klein">{f.schooljaar}</div>}</td>
                  <td className="d-klein"><a href={`/voorinschrijven/${f.slug}`} target="_blank" rel="noreferrer">/voorinschrijven/{f.slug} ↗</a></td>
                  <td className="getal">{f.aantal}</td>
                  <td>
                    <label className="d-schakelaar">
                      <input type="checkbox" role="switch" checked={f.open} onChange={(e) => zetOpen(f, e.target.checked)} aria-label={`${f.titel} open`} />
                      <span aria-hidden="true" />
                      {f.open ? 'Open' : 'Dicht'}
                    </label>
                  </td>
                  <td className="d-acties"><button type="button" className="d-link" onClick={() => setBewerk(f)}>Bewerken</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bewerk && (
        <Bewerken formulier={bewerk === 'nieuw' ? null : bewerk} evenementen={evenementen} onSluit={() => setBewerk(null)}
          naKlaar={() => { setBewerk(null); laad(); naVerandering(); }} />
      )}
    </section>
  );
}

function Bewerken({ formulier, evenementen, onSluit, naKlaar }: {
  formulier: VoorinschrijfFormulierBeheer | null; evenementen: EvenementKort[]; onSluit: () => void; naKlaar: () => void;
}) {
  const jaar = new Date().getFullYear() + (new Date().getMonth() >= 7 ? 1 : 0);
  const [w, setW] = useState({
    titel: formulier?.titel ?? `Voorinschrijving schooljaar ${jaar}-${jaar + 1}`,
    slug: formulier?.slug ?? `voorinschrijving-${jaar}`,
    schooljaar: formulier?.schooljaar ?? `Schooljaar ${jaar} - ${jaar + 1}`,
    intro: formulier?.intro ?? '',
    leerjaarOpties: (formulier?.leerjaarOpties ?? ['5de leerjaar', '6de leerjaar', 'Andere']).join('\n'),
    evenementId: formulier?.evenementId ?? evenementen[0]?.id ?? '',
    contactEmail: formulier?.contactEmail ?? '',
    privacyTekst: formulier?.privacyTekst ?? '',
  });
  const [velden, setVelden] = useState<Record<string, string>>({});
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function bewaar(e: React.FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    setVelden({});
    const data = {
      ...w,
      leerjaarOpties: w.leerjaarOpties.split('\n').map((x) => x.trim()).filter(Boolean),
      evenementId: w.evenementId || null,
      intro: w.intro || null, contactEmail: w.contactEmail || null, privacyTekst: w.privacyTekst || null,
    };
    try {
      if (formulier) await beheerApi.wijzigVoorinschrijfFormulier(formulier.id, data);
      else await beheerApi.maakVoorinschrijfFormulier(data);
      naKlaar();
    } catch (err: any) {
      if (err?.velden) setVelden(err.velden);
      setFout(foutTekst(err));
      setBezig(false);
    }
  }

  const tekstvak = (naam: 'intro' | 'leerjaarOpties' | 'privacyTekst', label: string, hulp: string, rijen = 3) => (
    <div className={`d-veld${velden[naam] ? ' d-veld--fout' : ''}`}>
      <label htmlFor={`vf-${naam}`}>{label}</label>
      <textarea id={`vf-${naam}`} rows={rijen} value={w[naam]} onChange={(e) => setW({ ...w, [naam]: e.target.value })} />
      <span className={velden[naam] ? 'd-veld__fout' : 'd-veld__hulp'}>{velden[naam] ?? hulp}</span>
    </div>
  );

  return (
    <Venster titel={formulier ? `${formulier.titel} bewerken` : 'Nieuw voorinschrijvingsformulier'} onSluit={onSluit} breed>
      <form onSubmit={bewaar}>
        {fout && <Melding soort="fout">{fout}</Melding>}
        <Invoer label="Titel" waarde={w.titel} onWijzig={(v) => setW({ ...w, titel: v })} verplicht fout={velden.titel} />
        <Invoer label="Adres" waarde={w.slug} onWijzig={(v) => setW({ ...w, slug: v })} verplicht fout={velden.slug}
          hulp={`Het formulier staat op ${location.origin}/voorinschrijven/${w.slug || '…'}`} />
        <Invoer label="Schooljaar" waarde={w.schooljaar} onWijzig={(v) => setW({ ...w, schooljaar: v })} hulp="Staat bovenaan het formulier en in de statistieken." />
        <div className="d-veld">
          <label htmlFor="vf-evenement">Banner en kleuren van</label>
          <select id="vf-evenement" value={w.evenementId} onChange={(e) => setW({ ...w, evenementId: e.target.value })}>
            <option value="">Geen (standaard opmaak)</option>
            {evenementen.map((e) => <option key={e.id} value={e.id}>{e.titel}</option>)}
          </select>
          <span className="d-veld__hulp">Het formulier krijgt hetzelfde logo, dezelfde organisator en dezelfde kleuren als het inschrijfformulier van dit evenement.</span>
        </div>
        {tekstvak('intro', 'Inleiding', 'Korte tekst bovenaan het formulier (optioneel).')}
        {tekstvak('leerjaarOpties', 'Keuzes voor de huidige klas', 'Eén per regel. Leeg = geen vraag naar de klas.', 4)}
        <Invoer label="Contactadres" type="email" waarde={w.contactEmail} onWijzig={(v) => setW({ ...w, contactEmail: v })} fout={velden.contactEmail}
          hulp="Voor vragen; staat onder het formulier en in de bevestigingsmail." />
        {tekstvak('privacyTekst', 'Privacytekst', 'Leeg = standaardtekst: bevestiging, uitnodiging om in te schrijven en eventueel een herinnering; niet gedeeld. Laat de tekst nakijken door de DPO.', 5)}
        <div className="d-knoppen">
          <button type="button" className="d-knop d-knop--secundair" onClick={onSluit}>Annuleren</button>
          <button type="submit" className="d-knop" disabled={bezig}>{bezig ? 'Bezig…' : formulier ? 'Bewaren' : 'Formulier maken'}</button>
        </div>
      </form>
    </Venster>
  );
}
