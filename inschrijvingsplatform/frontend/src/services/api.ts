import {
  ApiFout,
  type Evenement,
  type Melding,
  type RegistratieAanvraag,
  type RegistratieAntwoord,
  type RegistratieOverzicht,
  type School,
} from '../types';
import { demoApi } from './demoApi';
import { log } from './logboek';

export interface Api {
  haalEvenement(slug: string): Promise<Evenement>;
  haalScholen(): Promise<School[]>;
  registreer(slug: string, aanvraag: RegistratieAanvraag): Promise<RegistratieAntwoord>;
  haalRegistratie(token: string): Promise<RegistratieOverzicht>;
  annuleer(token: string): Promise<RegistratieOverzicht>;
  meld(melding: Melding): Promise<{ referentie: string }>;
}

const RUW = import.meta.env.VITE_API_URL as string | undefined;

/** Zonder VITE_API_URL draait het formulier volledig in de browser met voorbeelddata. */
export const isDemo = !RUW;

/** '/' (productie: de frontend-Worker stuurt /api/* door) geeft een leeg voorvoegsel; anders de volledige URL van de API. */
export const BASIS = (RUW ?? '').replace(/\/$/, '');

async function call<T>(pad: string, init?: RequestInit): Promise<T> {
  const methode = init?.method ?? 'GET';
  const start = performance.now();
  let res: Response;
  try {
    res = await fetch(`${BASIS}${pad}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    log('fout', `${methode} ${pad} → netwerkfout ${String(e)}`);
    throw new ApiFout('NETWERK', 'Geen verbinding. Controleer je internet en probeer opnieuw.');
  }
  const data = await res.json().catch(() => null);
  // Het request-id koppelt deze regel aan de Worker-logs in Cloudflare.
  const regel = `${methode} ${pad} → ${res.status} in ${Math.round(performance.now() - start)} ms [${res.headers.get('X-Request-Id') ?? '-'}]`;
  if (!res.ok) {
    log(res.status >= 500 ? 'fout' : 'waarschuwing', `${regel} ${data?.fout ?? ''}`);
    throw new ApiFout(data?.fout ?? 'SERVERFOUT', data?.melding ?? 'Er ging iets mis. Probeer het later opnieuw.', data?.velden, data?.id);
  }
  log('info', regel);
  return data as T;
}

const echteApi: Api = {
  haalEvenement: (slug) => call(`/api/evenementen/${encodeURIComponent(slug)}`),
  haalScholen: () => call('/api/scholen'),
  registreer: (slug, aanvraag) =>
    call(`/api/evenementen/${encodeURIComponent(slug)}/registraties`, { method: 'POST', body: JSON.stringify(aanvraag) }),
  haalRegistratie: (token) => call(`/api/registraties/${encodeURIComponent(token)}`),
  annuleer: (token) => call(`/api/registraties/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  meld: (melding) => call('/api/meldingen', { method: 'POST', body: JSON.stringify(melding) }),
};

export const api: Api = isDemo ? demoApi : echteApi;
