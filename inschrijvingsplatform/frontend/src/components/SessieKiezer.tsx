import type { Dagdeel, Sessie, Tijdsblok } from '../types';
import { plaatsenTekst } from './MomentKiezer';

/** Sessies die een deelnemer met deze doelgroep mag zien. */
export const sessiesVoor = (tb: Tijdsblok, doelgroepId: string) =>
  tb.sessies.filter((s) => !s.doelgroepId || s.doelgroepId === doelgroepId);

/** De meest voorkomende soort in een tijdsblok, bv. 'Proeflesje' → "Kies een proeflesje". */
export function soortLabel(tb: Tijdsblok): string {
  const tellingen = new Map<string, number>();
  for (const s of tb.sessies) if (s.soort && s.uniek) tellingen.set(s.soort, (tellingen.get(s.soort) ?? 0) + 1);
  const [soort] = [...tellingen.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['onderdeel'];
  return soort.toLowerCase();
}

interface Props {
  dagNaam: string;
  dagdeel: Dagdeel;
  doelgroepId: string;
  sessiekeuze: boolean;
  keuzes: Record<string, string>;
  onKies: (tijdsblokId: string, sessieId: string) => void;
  fouten: Record<string, string>;
  volzetGemeld?: string;
}

export function SessieKiezer({ dagNaam, dagdeel, doelgroepId, sessiekeuze, keuzes, onKies, fouten, volzetGemeld }: Props) {
  // Codes die al in een ander tijdsblok gekozen zijn (zelfde lesje niet twee keer)
  const gekozenCodes = new Map<string, string>();
  for (const tb of dagdeel.tijdsblokken) {
    const s = tb.sessies.find((x) => x.id === keuzes[tb.id]);
    if (s?.uniek && s.code) gekozenCodes.set(s.code, tb.id);
  }

  return (
    <section className="programma" aria-labelledby={`programma-${dagdeel.id}`}>
      <h3 id={`programma-${dagdeel.id}`} className="programma__titel">
        {dagNaam} – {dagdeel.naam} <span className="programma__uur">{dagdeel.startUur} – {dagdeel.eindUur}</span>
      </h3>
      <ol className="tijdlijn">
        {dagdeel.tijdsblokken.map((tb) => {
          if (tb.type === 'programma' || !sessiekeuze) {
            return (
              <li key={tb.id} className="tijdlijn__item tijdlijn__item--vast">
                <span className="tijdlijn__uur">{tb.startUur}</span>
                <div>
                  <p className="tijdlijn__naam">{tb.naam}</p>
                  {tb.omschrijving && <p className="tijdlijn__uitleg">{tb.omschrijving}</p>}
                </div>
              </li>
            );
          }
          const sessies = sessiesVoor(tb, doelgroepId);
          const soort = soortLabel(tb);
          const fout = fouten[tb.id];
          const naam = `keuze-${tb.id}`;
          return (
            <li key={tb.id} className="tijdlijn__item">
              <span className="tijdlijn__uur">{tb.startUur}</span>
              <fieldset className={`veld keuzeblok${fout ? ' veld--fout' : ''}`} id={`veld-${tb.id}`} aria-describedby={fout ? `${naam}-fout` : undefined}>
                <legend>
                  {tb.naam} <span className="keuzeblok__uur">({tb.startUur} – {tb.eindUur})</span>
                  <span className="keuzeblok__vraag">Kies een {soort}</span>
                </legend>
                {tb.omschrijving && <p className="hulp">{tb.omschrijving}</p>}
                <div className="sessies">
                  {sessies.map((s) => (
                    <SessieOptie
                      key={s.id}
                      sessie={s}
                      naam={naam}
                      gekozen={keuzes[tb.id] === s.id}
                      alGekozenIn={s.uniek && s.code && gekozenCodes.get(s.code) !== tb.id ? gekozenCodes.get(s.code) : undefined}
                      blokNaam={(id) => dagdeel.tijdsblokken.find((t) => t.id === id)?.naam ?? ''}
                      onKies={() => onKies(tb.id, s.id)}
                      volzetGemeld={volzetGemeld === s.id}
                    />
                  ))}
                  {!tb.verplicht && (
                    <label className={`sessie sessie--geen${keuzes[tb.id] === '' ? ' sessie--actief' : ''}`}>
                      <input type="radio" name={naam} checked={keuzes[tb.id] === ''} onChange={() => onKies(tb.id, '')} />
                      <span className="sessie__inhoud">
                        <span className="sessie__titel">Geen {soort}</span>
                        <span className="sessie__uitleg">Ik kom liever gewoon eens kijken</span>
                      </span>
                    </label>
                  )}
                </div>
                {fout && <p className="foutmelding" id={`${naam}-fout`}>{fout}</p>}
              </fieldset>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface OptieProps {
  sessie: Sessie;
  naam: string;
  gekozen: boolean;
  alGekozenIn?: string;
  blokNaam: (id: string) => string;
  onKies: () => void;
  volzetGemeld: boolean;
}

function SessieOptie({ sessie: s, naam, gekozen, alGekozenIn, blokNaam, onKies, volzetGemeld }: OptieProps) {
  const vol = s.volzet && !s.wachtlijst;
  const uitgeschakeld = vol || !!alGekozenIn;
  const plaatsen = plaatsenTekst(s.vrij, s.capaciteit);
  return (
    <label
      className={`sessie${gekozen ? ' sessie--actief' : ''}${uitgeschakeld ? ' sessie--uit' : ''}${volzetGemeld ? ' sessie--gemeld' : ''}`}
      style={s.kleur ? { borderInlineStartColor: s.kleur } : undefined}
    >
      <input type="radio" name={naam} checked={gekozen} disabled={uitgeschakeld} onChange={onKies} />
      <span className="sessie__inhoud">
        <span className="sessie__titel">{s.titel}</span>
        {s.beschrijving && <span className="sessie__uitleg">{s.beschrijving}</span>}
        <span className="sessie__meta">
          {s.locatie && <span>Lokaal {s.locatie}</span>}
          {s.volzet && s.wachtlijst && <span className="badge badge--bijna">Volzet – wachtlijst mogelijk</span>}
          {vol && <span className="badge badge--vol">Volzet</span>}
          {!s.volzet && plaatsen && <span className="badge badge--bijna">{plaatsen}</span>}
          {alGekozenIn && !vol && <span className="badge">Al gekozen bij {blokNaam(alGekozenIn)}</span>}
        </span>
      </span>
    </label>
  );
}
