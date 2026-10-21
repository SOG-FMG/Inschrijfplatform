import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import type { Rol } from '../services/beheerApi';
import { ApiFout } from '../types';

/** Kleine bouwstenen voor het beheer: navigatie, velden, meldingen, vensters, opmaak. */

// ---------------------------------------------------------------------------
// Navigatie zonder herladen
// ---------------------------------------------------------------------------
export function navigeer(pad: string) {
  history.pushState(null, '', pad);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function usePad(): string {
  const [pad, setPad] = useState(location.pathname);
  useEffect(() => {
    const bij = () => setPad(location.pathname);
    addEventListener('popstate', bij);
    return () => removeEventListener('popstate', bij);
  }, []);
  return pad;
}

export function Link({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // nieuw tabblad blijft werken
        e.preventDefault();
        navigeer(href);
      }}
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Opmaak
// ---------------------------------------------------------------------------
export const ROLNAAM: Record<Rol, string> = {
  platformbeheerder: 'Platformbeheerder',
  schoolbeheerder: 'Schoolbeheerder',
  organisator: 'Organisator',
  onthaal: 'Onthaal',
};

export const STATUSNAAM: Record<string, string> = {
  concept: 'Concept',
  gepubliceerd: 'Gepubliceerd',
  gesloten: 'Gesloten',
  gearchiveerd: 'Gearchiveerd',
};

export function datum(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function datumTijd(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const foutTekst = (e: unknown, standaard = 'Er ging iets mis.') =>
  e instanceof ApiFout ? (e.velden && Object.values(e.velden).length ? Object.values(e.velden).join(' ') : e.message) : standaard;

// ---------------------------------------------------------------------------
// Velden en meldingen
// ---------------------------------------------------------------------------
interface InvoerProps {
  label: string;
  waarde: string;
  onWijzig: (v: string) => void;
  type?: string;
  hulp?: ReactNode;
  fout?: string;
  verplicht?: boolean;
  autoComplete?: string;
  autoFocus?: boolean;
  inputMode?: 'numeric' | 'email' | 'text';
  maxLength?: number;
  placeholder?: string;
}

export function Invoer({ label, waarde, onWijzig, type = 'text', hulp, fout, verplicht, ...rest }: InvoerProps) {
  const id = useId();
  return (
    <div className={`d-veld${fout ? ' d-veld--fout' : ''}`}>
      <label htmlFor={id}>
        {label}
        {verplicht && <span className="d-verplicht" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        type={type}
        value={waarde}
        required={verplicht}
        aria-invalid={fout ? true : undefined}
        aria-describedby={hulp || fout ? `${id}-uitleg` : undefined}
        onChange={(e) => onWijzig(e.target.value)}
        {...rest}
      />
      {(fout || hulp) && <span id={`${id}-uitleg`} className={fout ? 'd-veld__fout' : 'd-veld__hulp'}>{fout ?? hulp}</span>}
    </div>
  );
}

export function Melding({ soort = 'info', children }: { soort?: 'info' | 'fout' | 'ok' | 'let-op'; children: ReactNode }) {
  return (
    <div className={`d-melding d-melding--${soort}`} role={soort === 'fout' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/** Eenvoudige wachtwoordcontrole in de browser; de server controleert opnieuw. */
export function wachtwoordHint(w: string, herhaling?: string): string | undefined {
  if (!w) return undefined;
  if (w.length < 12) return `Nog ${12 - w.length} teken(s) te gaan (minstens 12).`;
  if (herhaling !== undefined && herhaling && herhaling !== w) return 'De twee wachtwoorden verschillen.';
  return undefined;
}

// ---------------------------------------------------------------------------
// Venster (modaal)
// ---------------------------------------------------------------------------
export function Venster({ titel, onSluit, children, breed }: { titel: string; onSluit: () => void; children: ReactNode; breed?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);
  return (
    <dialog ref={ref} className={`d-venster${breed ? ' d-venster--breed' : ''}`} onClose={onSluit} aria-label={titel}>
      <header className="d-venster__kop">
        <h2>{titel}</h2>
        <button type="button" className="d-icoonknop" aria-label="Sluiten" onClick={onSluit}>×</button>
      </header>
      <div className="d-venster__inhoud">{children}</div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// QR-code voor de authenticator-app
// ---------------------------------------------------------------------------
export function Qr({ tekst }: { tekst: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(tekst);
  qr.make();
  return <div className="d-qr" role="img" aria-label="QR-code voor je authenticator-app" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) }} />;
}

export function Koppelen({ geheim, otpauth }: { geheim: string; otpauth: string }) {
  return (
    <div className="d-koppelen">
      <Qr tekst={otpauth} />
      <div>
        <p>Scan de QR-code met een authenticator-app (Microsoft Authenticator, Google Authenticator, …).</p>
        <details>
          <summary>Scannen lukt niet?</summary>
          <p>Voer deze sleutel handmatig in (tijdgebonden, 6 cijfers):</p>
          <code className="d-sleutel">{geheim.match(/.{1,4}/g)?.join(' ')}</code>
        </details>
      </div>
    </div>
  );
}

/** Toont een eenmalige code groot, met kopieerknop. */
export function EenmaligeCode({ code, geldigTot, voor }: { code: string; geldigTot: string; voor: string }) {
  const [gekopieerd, setGekopieerd] = useState(false);
  return (
    <div className="d-code">
      <p>Uitnodigingscode voor <strong>{voor}</strong>, geldig tot {datumTijd(geldigTot)}:</p>
      <div className="d-code__waarde">
        <code>{code}</code>
        <button
          type="button"
          className="d-knop d-knop--klein"
          onClick={() => navigator.clipboard?.writeText(code).then(() => setGekopieerd(true))}
        >
          {gekopieerd ? 'Gekopieerd' : 'Kopiëren'}
        </button>
      </div>
      <Melding soort="let-op">
        Deze code wordt maar één keer getoond. Geef hem persoonlijk door (niet in dezelfde mail als het adres). De medewerker activeert via{' '}
        <strong>{location.origin}/dashboard/activeren</strong> en kiest daar een wachtwoord en de authenticator-app.
      </Melding>
    </div>
  );
}
