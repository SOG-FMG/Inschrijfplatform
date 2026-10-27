import { useState, type ReactNode } from 'react';
import { instellingenApi, type InstellingSoort, type InstellingVeld } from '../../services/beheerApi';
import { ApiFout } from '../../types';
import { foutTekst } from '../ui';

/**
 * Bouwstenen voor de instellingen van een evenement: één plaats waar een veld uit het schema
 * (backend/src/modules/evenementen/instellingen.ts) een invoerveld wordt, en waar de omzetting
 * tussen database, formulier en API staat. De formulieren én de tabellen gebruiken dit.
 */

export type Rij = Record<string, any>;
export type Opties = Record<'doelgroep' | 'soort' | 'locatie' | 'contact', { waarde: string; label: string }[]>;
export type Schema = Record<InstellingSoort, InstellingVeld[]>;

/** Naam van de id-kolom per soort. */
export const ID: Record<InstellingSoort, string> = {
  evenement: 'evenement_id',
  doelgroep: 'doelgroep_id',
  dag: 'dag_id',
  dagdeel: 'dagdeel_id',
  tijdsblok: 'tijdsblok_id',
  sessie: 'sessie_id',
};

/** Kolom die een record benoemt (voor titels en aria-labels). */
export const TITELKOLOM: Record<InstellingSoort, string> = {
  evenement: 'titel',
  doelgroep: 'naam',
  dag: 'naam',
  dagdeel: 'naam',
  tijdsblok: 'naam',
  sessie: 'titel',
};

/** Hoe het scherm een soort noemt (enkelvoud, kleine letter). */
export const SOORTNAAM: Record<InstellingSoort, string> = {
  evenement: 'evenement',
  doelgroep: 'doelgroep',
  dag: 'dag',
  dagdeel: 'moment',
  tijdsblok: 'tijdsblok',
  sessie: 'sessie',
};

/** Titel van het venster waarin je er een toevoegt (het/de verschilt per woord). */
export const NIEUWNAAM: Record<InstellingSoort, string> = {
  evenement: 'Nieuw evenement',
  doelgroep: 'Nieuwe doelgroep',
  dag: 'Nieuwe dag',
  dagdeel: 'Nieuw moment',
  tijdsblok: 'Nieuw tijdsblok',
  sessie: 'Nieuwe sessie',
};

export const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Wat alle soorten gemeen hebben: het schema, de keuzelijsten en wat je mag. */
export interface Gemeen {
  schema: Schema;
  opties: Opties;
  kanSchrijven: boolean;
  /** De gegevens opnieuw laden na een wijziging. */
  onKlaar: () => void;
}

export const veldVan = (schema: Schema, soort: InstellingSoort, naam: string) => schema[soort].find((v) => v.naam === naam);

/** Velden die via Opslaan meegaan: het logo heeft zijn eigen upload. */
export const bewaarbaar = (velden: InstellingVeld[]) => velden.filter((v) => v.type !== 'logo');

const twee = (n: number) => String(n).padStart(2, '0');
/** ISO (UTC) → waarde voor <input type="datetime-local"> in de tijdzone van de browser. */
function naarLokaal(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}T${twee(d.getHours())}:${twee(d.getMinutes())}`;
}

/** Waarde uit de database → waarde in het formulier. */
export function naarInvoer(v: InstellingVeld, waarde: unknown): unknown {
  if (v.type === 'jaNee') return waarde === 1 || waarde === true;
  if (v.type === 'datumtijd') return naarLokaal(waarde);
  if (v.type === 'lijst') return Array.isArray(waarde) ? waarde.join(', ') : '';
  return waarde ?? '';
}

/** Formulier → API. */
export function naarApi(v: InstellingVeld, waarde: unknown): unknown {
  if (v.type === 'datumtijd') return waarde ? new Date(String(waarde)).toISOString() : null;
  if (v.type === 'jaNee') return !!waarde;
  return waarde === '' ? null : waarde;
}

export function beginWaarden(velden: InstellingVeld[], rij: Rij | null) {
  return Object.fromEntries(velden.map((v) => [v.naam, naarInvoer(v, rij ? rij[v.naam] : v.standaard)]));
}

// ---------------------------------------------------------------------------
// Eén invoerveld
// ---------------------------------------------------------------------------
interface InvoerProps {
  v: InstellingVeld;
  waarde: unknown;
  onWijzig: (w: unknown) => void;
  opties: Opties;
  alleenLezen: boolean;
  /** Voor een veld met een eigen <label>. */
  id?: string;
  /** Voor een veld zonder label, bv. in een tabelcel. */
  label?: string;
  fout?: boolean;
}

/** Enkel de invoer zelf, zonder label of uitleg. Niet voor het logo: dat is LogoVeld. */
export function VeldInvoer({ v, waarde, onWijzig, opties, alleenLezen, id, label, fout }: InvoerProps): ReactNode {
  const gemeen = { id, disabled: alleenLezen, 'aria-label': label, 'aria-invalid': fout ? true : undefined };
  switch (v.type) {
    case 'kleur':
      return (
        <span className="iv__kleur">
          <input {...gemeen} type="color" value={String(waarde || '#1d4f91')} onChange={(e) => onWijzig(e.target.value)} />
          <input type="text" disabled={alleenLezen} value={String(waarde)} placeholder="standaard" aria-label={`${v.label} (code)`} onChange={(e) => onWijzig(e.target.value)} />
          {!!waarde && !alleenLezen && (
            <button type="button" className="d-link" onClick={() => onWijzig('')}>standaard</button>
          )}
        </span>
      );
    case 'jaNee':
      return <input {...gemeen} type="checkbox" checked={!!waarde} onChange={(e) => onWijzig(e.target.checked)} />;
    case 'lang':
      return <textarea {...gemeen} rows={2} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)} />;
    case 'keuze':
    case 'ref': {
      const lijst = v.type === 'ref' ? opties[v.ref!] ?? [] : v.opties ?? [];
      return (
        <select {...gemeen} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)}>
          {(v.type === 'ref' || !v.verplicht) && <option value="">— geen —</option>}
          {lijst.map((o) => (
            <option key={o.waarde} value={o.waarde}>{o.label}</option>
          ))}
        </select>
      );
    }
    default: {
      const type = { datum: 'date', uur: 'time', datumtijd: 'datetime-local', getal: 'number', email: 'email' }[v.type as string] ?? 'text';
      return <input {...gemeen} type={type} min={v.min} max={v.max} value={String(waarde)} onChange={(e) => onWijzig(e.target.value)} />;
    }
  }
}

/** Invoerveld met label en uitleg, voor een formulier. */
export function Veld({ v, fout, id, evenementId, onHerlaad, ...rest }: Omit<InvoerProps, 'fout'> & {
  fout?: string;
  id: string;
  evenementId?: string;
  onHerlaad: () => void;
}) {
  if (v.type === 'logo') {
    return <LogoVeld v={v} logo={rest.waarde ? String(rest.waarde) : null} evenementId={evenementId!} alleenLezen={rest.alleenLezen} onHerlaad={onHerlaad} />;
  }
  return (
    <div className={`iv iv--${v.type}${fout ? ' iv--fout' : ''}`}>
      <label htmlFor={id}>
        {v.label}
        {v.verplicht && <span className="verplicht" aria-hidden="true"> *</span>}
      </label>
      <VeldInvoer {...rest} v={v} id={id} fout={!!fout} />
      {fout ? <span className="iv__fout">{fout}</span> : v.hulp && <span className="iv__hulp">{v.hulp}</span>}
    </div>
  );
}

/** Logo: rechtstreeks uploaden (los van de knop Opslaan). */
export function LogoVeld({ v, logo, evenementId, alleenLezen, onHerlaad }: {
  v: InstellingVeld;
  logo: string | null;
  evenementId: string;
  alleenLezen: boolean;
  onHerlaad: () => void;
}) {
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const uitvoeren = async (werk: () => Promise<unknown>) => {
    setBezig(true);
    setFout(null);
    try {
      await werk();
      onHerlaad();
    } catch (e) {
      setFout(e instanceof ApiFout ? (e.velden?.logo ?? e.message) : 'Uploaden mislukt.');
    } finally {
      setBezig(false);
    }
  };
  return (
    <div className="iv iv--logo">
      <span className="iv__label">{v.label}</span>
      <div className="iv__logo">
        {logo ? <img src={logo} alt="Huidig logo" /> : <span className="iv__geenlogo">Geen logo</span>}
        {!alleenLezen && (
          <span className="iv__logoknoppen">
            <label className="d-knop d-knop--secundair d-knop--klein">
              {bezig ? 'Bezig…' : logo ? 'Ander logo kiezen' : 'Logo kiezen'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                disabled={bezig}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) uitvoeren(() => instellingenApi.uploadLogo(evenementId, f));
                }}
              />
            </label>
            {logo && (
              <button type="button" className="d-link d-link--gevaar" disabled={bezig} onClick={() => confirm('Logo verwijderen?') && uitvoeren(() => instellingenApi.verwijderLogo(evenementId))}>
                Verwijderen
              </button>
            )}
          </span>
        )}
      </div>
      {fout ? <span className="iv__fout">{fout}</span> : v.hulp && <span className="iv__hulp">{v.hulp}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Niet-bewaarde wijzigingen van alle tabellen samen
// ---------------------------------------------------------------------------
/**
 * In de tabellen pas je velden rechtstreeks in de cellen aan. De wijzigingen blijven hier staan
 * tot je bovenaan op Bewaren klikt; zo kan je eerst alle lokalen of maxima aanpassen en dan in
 * één keer opslaan. Zet je een veld terug op de bewaarde waarde, dan valt de wijziging weg.
 */
export interface Wijzigingen {
  waarde: (soort: InstellingSoort, rij: Rij, v: InstellingVeld) => unknown;
  zet: (soort: InstellingSoort, rij: Rij, v: InstellingVeld, w: unknown) => void;
  anders: (soort: InstellingSoort, rij: Rij, naam: string) => boolean;
  fout: (soort: InstellingSoort, rij: Rij, naam: string) => string | undefined;
  aantal: number;
  bezig: boolean;
  /** Alles bewaren; geeft de foutmelding terug, of null als het gelukt is. */
  bewaar: () => Promise<string | null>;
  vergeet: () => void;
}

export function useWijzigingen(schema: Schema, onKlaar: () => void): Wijzigingen {
  const [wijz, setWijz] = useState<Record<string, Record<string, unknown>>>({});
  const [fouten, setFouten] = useState<Record<string, Record<string, string>>>({});
  const [bezig, setBezig] = useState(false);
  const sleutel = (soort: InstellingSoort, rij: Rij) => `${soort}:${rij[ID[soort]]}`;

  const bewaar = async (): Promise<string | null> => {
    setBezig(true);
    setFouten({});
    try {
      for (const [s, velden] of Object.entries(wijz)) {
        const soort = s.slice(0, s.indexOf(':')) as InstellingSoort;
        const id = s.slice(s.indexOf(':') + 1);
        try {
          await instellingenApi.wijzig(
            soort,
            id,
            Object.fromEntries(Object.entries(velden).map(([naam, w]) => [naam, naarApi(veldVan(schema, soort, naam)!, w)])),
          );
        } catch (e) {
          if (e instanceof ApiFout && e.velden) setFouten((oud) => ({ ...oud, [s]: e.velden! }));
          throw e;
        }
        setWijz(({ [s]: _weg, ...rest }) => rest);
      }
      onKlaar();
      return null;
    } catch (e) {
      return foutTekst(e, 'Bewaren mislukt.');
    } finally {
      setBezig(false);
    }
  };

  return {
    waarde: (soort, rij, v) => {
      const velden = wijz[sleutel(soort, rij)];
      return velden && v.naam in velden ? velden[v.naam] : naarInvoer(v, rij[v.naam]);
    },
    zet: (soort, rij, v, w) => {
      const s = sleutel(soort, rij);
      setWijz(({ [s]: oud, ...rest }) => {
        const velden = { ...oud, [v.naam]: w };
        if (JSON.stringify(w) === JSON.stringify(naarInvoer(v, rij[v.naam]))) delete velden[v.naam];
        return Object.keys(velden).length ? { ...rest, [s]: velden } : rest;
      });
    },
    anders: (soort, rij, naam) => naam in (wijz[sleutel(soort, rij)] ?? {}),
    fout: (soort, rij, naam) => fouten[sleutel(soort, rij)]?.[naam],
    aantal: Object.values(wijz).reduce((n, velden) => n + Object.keys(velden).length, 0),
    bezig,
    bewaar,
    vergeet: () => {
      setWijz({});
      setFouten({});
    },
  };
}
