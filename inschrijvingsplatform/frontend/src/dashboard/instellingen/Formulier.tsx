import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { instellingenApi, type InstellingSoort, type InstellingVeld } from '../../services/beheerApi';
import { ApiFout } from '../../types';
import { bewaarbaar, beginWaarden, type Gemeen, ID, naarApi, type Rij, Veld } from './velden';

/**
 * Het volledige formulier van één onderdeel: alle velden uit het schema, in groepen.
 * Wat je maar één keer instelt staat in een groep die dicht begint, zodat je bovenaan enkel
 * ziet wat je echt aanpast. Velden die in geen enkele groep staan komen onder "Overige":
 * een nieuw veld in de backend verdwijnt zo nooit uit het scherm.
 */

export interface Groep {
  titel: string;
  velden: string[];
  /** Begint ingeklapt (instellingen die je zelden aanraakt). */
  dicht?: boolean;
}

interface FormulierProps {
  soort: InstellingSoort;
  /** null = een nieuw onderdeel onder ouderId. */
  rij: Rij | null;
  ouderId?: string;
  gemeen: Gemeen;
  groepen?: Groep[];
  /** Na opslaan, toevoegen of verwijderen. */
  onKlaar: () => void;
  onAnnuleer?: () => void;
  /** Extra uitleg bovenaan het formulier. */
  info?: ReactNode;
}

export function Formulier({ soort, rij, ouderId, gemeen, groepen, onKlaar, onAnnuleer, info }: FormulierProps) {
  const velden = gemeen.schema[soort];
  const begin = beginWaarden(velden, rij);
  const [waarden, setWaarden] = useState<Record<string, unknown>>(begin);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<{ soort: 'ok' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const id = rij?.[ID[soort]] as string | undefined;
  const gewijzigd = bewaarbaar(velden).filter((v) => JSON.stringify(waarden[v.naam]) !== JSON.stringify(begin[v.naam]));

  // Na herladen van de gegevens het formulier gelijkzetten (enkel als er niets lokaal gewijzigd is).
  const sleutel = JSON.stringify(begin);
  useEffect(() => {
    setWaarden(beginWaarden(velden, rij));
  }, [sleutel]);

  const indeling = useMemo(() => {
    if (!groepen) return [{ titel: '', dicht: false, velden }];
    const inGroep = new Set(groepen.flatMap((g) => g.velden));
    const rest = velden.filter((v) => !inGroep.has(v.naam));
    return [
      ...groepen.map((g) => ({
        titel: g.titel,
        dicht: !!g.dicht,
        velden: g.velden.map((n) => velden.find((v) => v.naam === n)).filter((v): v is InstellingVeld => !!v),
      })),
      ...(rest.length ? [{ titel: 'Overige', dicht: true, velden: rest }] : []),
    ].filter((g) => g.velden.length);
  }, [velden, groepen]);

  const opslaan = async () => {
    setBezig(true);
    setFouten({});
    setMelding(null);
    try {
      const teVersturen = Object.fromEntries((id ? gewijzigd : bewaarbaar(velden)).map((v) => [v.naam, naarApi(v, waarden[v.naam])]));
      if (id) await instellingenApi.wijzig(soort, id, teVersturen);
      else await instellingenApi.maak(soort, ouderId ?? null, teVersturen);
      setMelding({ soort: 'ok', tekst: 'Opgeslagen.' });
      onKlaar();
    } catch (e) {
      if (e instanceof ApiFout && e.velden) setFouten(e.velden);
      setMelding({ soort: 'fout', tekst: e instanceof ApiFout ? (e.velden?.algemeen ?? e.message) : 'Opslaan mislukt.' });
    } finally {
      setBezig(false);
    }
  };

  const verwijderen = async () => {
    if (!id || !confirm('Zeker verwijderen? Dit verwijdert ook alles eronder.')) return;
    try {
      await instellingenApi.verwijder(soort, id);
      onKlaar();
      onAnnuleer?.();
    } catch (e) {
      setMelding({ soort: 'fout', tekst: e instanceof ApiFout ? e.message : 'Verwijderen mislukt.' });
    }
  };

  const invoer = (v: InstellingVeld) => (
    <Veld
      key={v.naam}
      id={`${soort}-${id ?? 'nieuw'}-${v.naam}`}
      v={v}
      waarde={waarden[v.naam]}
      onWijzig={(w) => setWaarden((oud) => ({ ...oud, [v.naam]: w }))}
      fout={fouten[v.naam]}
      opties={gemeen.opties}
      alleenLezen={!gemeen.kanSchrijven}
      evenementId={rij?.evenement_id ?? (soort === 'evenement' ? id : undefined)}
      onHerlaad={onKlaar}
    />
  );

  return (
    <form
      className="it-form"
      onSubmit={(e) => {
        e.preventDefault();
        opslaan();
      }}
    >
      {info && <div className="it-form__info">{info}</div>}
      {indeling.map((g) =>
        !g.titel ? (
          <div key="alles" className="rec__velden">{g.velden.map(invoer)}</div>
        ) : g.dicht ? (
          <details key={g.titel} className="it-groep it-groep--dicht">
            <summary>{g.titel}</summary>
            <div className="rec__velden">{g.velden.map(invoer)}</div>
          </details>
        ) : (
          <fieldset key={g.titel} className="it-groep">
            <legend>{g.titel}</legend>
            <div className="rec__velden">{g.velden.map(invoer)}</div>
          </fieldset>
        ),
      )}
      {gemeen.kanSchrijven && (
        <div className="rec__knoppen">
          <button type="submit" className="d-knop" disabled={bezig || (!!id && gewijzigd.length === 0)}>
            {id ? 'Opslaan' : 'Toevoegen'}
          </button>
          {id && gewijzigd.length > 0 && (
            <button type="button" className="d-knop d-knop--secundair" onClick={() => setWaarden(begin)}>Wijzigingen ongedaan maken</button>
          )}
          {onAnnuleer && <button type="button" className="d-knop d-knop--secundair" onClick={onAnnuleer}>{id ? 'Sluiten' : 'Annuleren'}</button>}
          {id && soort !== 'evenement' && <button type="button" className="d-knop d-knop--gevaar rec__weg" onClick={verwijderen}>Verwijderen</button>}
          {melding && <span className={`rec__melding rec__melding--${melding.soort}`} role="status">{melding.tekst}</span>}
        </div>
      )}
    </form>
  );
}
