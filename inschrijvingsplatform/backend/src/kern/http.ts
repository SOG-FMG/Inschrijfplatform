import type { Env } from '../types';
import { ValidatieFout } from '../validatie';

/** Gedeelde hulpjes voor routes van de kern en van modules. */

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

export const nietGevonden = () => json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);

export function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const toegelaten = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  return toegelaten.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Expose-Headers': 'X-Request-Id',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : {};
}

export async function leesJson(request: Request, maxBytes: number): Promise<unknown> {
  const lengte = Number(request.headers.get('Content-Length') ?? 0);
  if (lengte > maxBytes) throw new ValidatieFout({ aanvraag: 'De aanvraag is te groot.' });
  const tekst = await request.text();
  if (tekst.length > maxBytes) throw new ValidatieFout({ aanvraag: 'De aanvraag is te groot.' });
  return JSON.parse(tekst);
}

export function nieuwToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function controleerTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true; // lokaal zonder Turnstile
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = await res.json<{ success: boolean }>();
  return data.success;
}

export const botcontroleMislukt = () => json({ fout: 'BOTCONTROLE', melding: 'De beveiligingscontrole is mislukt. Probeer opnieuw.' }, 403);

/** Beperkt het aantal aanvragen per IP-adres (Workers Rate Limiting). Zonder binding (lokaal, tests) gebeurt er niets. */
export async function teSnel(limiet: RateLimit | undefined, request: Request): Promise<boolean> {
  if (!limiet) return false;
  const { success } = await limiet.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'onbekend' });
  return !success;
}

export const teVeelAanvragen = () => json({ fout: 'TE_VEEL_AANVRAGEN', melding: 'Te veel aanvragen na elkaar. Wacht even en probeer opnieuw.' }, 429);

export function csv(rijen: Record<string, unknown>[], kolommen: string[], bestandsnaam: string): Response {
  // Puntkomma + BOM: opent correct in Excel met Belgische landinstellingen. Formule-injectie neutraliseren.
  const cel = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const inhoud = '﻿' + [kolommen.join(';'), ...rijen.map((r) => kolommen.map((k) => cel(r[k])).join(';'))].join('\r\n');
  return new Response(inhoud, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${bestandsnaam}"`,
      'Cache-Control': 'no-store',
    },
  });
}
