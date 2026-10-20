import { useId, type ReactNode } from 'react';

interface TekstveldProps {
  label: string;
  waarde: string;
  onWijzig: (v: string) => void;
  fout?: string;
  verplicht?: boolean;
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
  hulp?: ReactNode;
  id?: string;
  meerregelig?: boolean;
  lijst?: string;
}

export function Tekstveld({ label, waarde, onWijzig, fout, verplicht, type = 'text', autoComplete, hulp, id, meerregelig, lijst }: TekstveldProps) {
  const auto = useId();
  const veldId = id ?? auto;
  const hulpId = `${veldId}-hulp`;
  const foutId = `${veldId}-fout`;
  const beschrijving = [hulp ? hulpId : null, fout ? foutId : null].filter(Boolean).join(' ') || undefined;
  const gemeen = {
    id: veldId,
    value: waarde,
    required: verplicht,
    'aria-invalid': fout ? true : undefined,
    'aria-describedby': beschrijving,
    autoComplete,
  };
  return (
    <div className={`veld${fout ? ' veld--fout' : ''}`}>
      <label htmlFor={veldId}>
        {label}
        {verplicht ? <span className="verplicht" aria-hidden="true"> *</span> : <span className="optioneel"> (optioneel)</span>}
      </label>
      {hulp && <p className="hulp" id={hulpId}>{hulp}</p>}
      {meerregelig ? (
        <textarea {...gemeen} rows={3} maxLength={1000} onChange={(e) => onWijzig(e.target.value)} />
      ) : (
        <input {...gemeen} type={type} list={lijst} maxLength={type === 'email' ? 254 : 200} onChange={(e) => onWijzig(e.target.value)} />
      )}
      {fout && <p className="foutmelding" id={foutId}>{fout}</p>}
    </div>
  );
}

interface KeuzeOptie {
  waarde: string;
  label: string;
  beschrijving?: string | null;
}

interface KeuzerondjesProps {
  legende: string;
  naam: string;
  opties: KeuzeOptie[];
  waarde: string;
  onWijzig: (v: string) => void;
  fout?: string;
  verplicht?: boolean;
  id?: string;
}

export function Keuzerondjes({ legende, naam, opties, waarde, onWijzig, fout, verplicht, id }: KeuzerondjesProps) {
  const foutId = `${naam}-fout`;
  return (
    <fieldset className={`veld${fout ? ' veld--fout' : ''}`} id={id} aria-describedby={fout ? foutId : undefined}>
      <legend>
        {legende}
        {verplicht && <span className="verplicht" aria-hidden="true"> *</span>}
      </legend>
      <div className="rondjes">
        {opties.map((o) => (
          <label key={o.waarde} className={`rondje${waarde === o.waarde ? ' rondje--actief' : ''}`}>
            <input type="radio" name={naam} value={o.waarde} checked={waarde === o.waarde} onChange={() => onWijzig(o.waarde)} />
            <span>
              <span className="rondje__label">{o.label}</span>
              {o.beschrijving && <span className="rondje__uitleg">{o.beschrijving}</span>}
            </span>
          </label>
        ))}
      </div>
      {fout && <p className="foutmelding" id={foutId}>{fout}</p>}
    </fieldset>
  );
}
