// Klein logboek in het geheugen van de browser (laatste 200 regels). Wordt enkel
// verstuurd als de gebruiker zelf een melding doet. Bevat nooit formulierinhoud:
// enkel stappen, API-aanroepen (pad, status, request-id) en fouten.

export interface Logregel {
  t: string;
  niveau: 'info' | 'waarschuwing' | 'fout';
  bericht: string;
}

const MAX = 200;
const regels: Logregel[] = [];

/** Beheerlink-tokens en e-mailadressen horen niet in een logboek. */
export const anonimiseer = (s: string) =>
  s.replace(/[A-Za-z0-9_-]{43}/g, '[token]').replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[e-mail]');

export function log(niveau: Logregel['niveau'], bericht: string) {
  regels.push({ t: new Date().toISOString(), niveau, bericht: anonimiseer(bericht).slice(0, 500) });
  if (regels.length > MAX) regels.splice(0, regels.length - MAX);
}

export const logboek = (): Logregel[] => regels.slice();

let geinstalleerd = false;

/** Vangt onverwachte fouten op (ook die van React) zodat ze in een melding meekomen. */
export function installeerLogboek() {
  if (geinstalleerd || typeof window === 'undefined') return;
  geinstalleerd = true;
  log('info', `start ${location.pathname}`);
  window.addEventListener('error', (e) => log('fout', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => log('fout', `unhandledrejection: ${String(e.reason?.stack ?? e.reason)}`));
  for (const [methode, niveau] of [['error', 'fout'], ['warn', 'waarschuwing']] as const) {
    const origineel = console[methode].bind(console);
    console[methode] = (...args: unknown[]) => {
      log(niveau, args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : safeJson(a))).join(' '));
      origineel(...args);
    };
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
