import { ontsleutel, versleutel } from '../crypto/versleuteling';
import type { Env } from '../types';

export const BEWAARTERMIJN_MELDINGEN_DAGEN = 90;
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;

export class MeldingFout extends Error {
  constructor(public velden: Record<string, string>) {
    super('VALIDATIE');
  }
}

/** Haalt geheime tokens (beheerlink) en e-mailadressen uit vrije technische tekst. */
export function anonimiseerTekst(s: string): string {
  return s
    .replace(/[A-Za-z0-9_-]{43}/g, '[token]')
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[e-mail]');
}

const tekst = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function bewaarMelding(env: Env, body: any): Promise<{ meldingId: string; referentie: string }> {
  const fouten: Record<string, string> = {};
  const type = body?.type === 'wens' ? 'wens' : body?.type === 'probleem' ? 'probleem' : null;
  if (!type) fouten.type = 'Kies een type.';
  const omschrijving = tekst(body?.omschrijving, 4000);
  if (omschrijving.length < 3) fouten.omschrijving = 'Beschrijf kort wat er gebeurde of wat je wil.';
  const email = tekst(body?.email, 254).toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fouten.email = 'Geen geldig e-mailadres.';

  let png: Uint8Array | null = null;
  if (typeof body?.screenshot === 'string' && body.screenshot) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.screenshot);
    if (!m) fouten.screenshot = 'Ongeldige schermafbeelding.';
    else {
      png = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
      if (png.length > MAX_SCREENSHOT_BYTES) fouten.screenshot = 'De schermafbeelding is te groot.';
    }
  }
  if (Object.keys(fouten).length) throw new MeldingFout(fouten);

  // Technische context: enkel gekende, korte velden; nooit formulierinhoud.
  const ctx = body?.context ?? {};
  const context = {
    scherm: tekst(ctx.scherm, 50),
    venster: tekst(ctx.venster, 50),
    pixelratio: typeof ctx.pixelratio === 'number' ? ctx.pixelratio : null,
    taal: tekst(ctx.taal, 20),
    tijdzone: tekst(ctx.tijdzone, 50),
    tijdstip: tekst(ctx.tijdstip, 40),
    online: ctx.online === true,
    aanraakscherm: ctx.aanraakscherm === true,
    demo: ctx.demo === true,
  };
  const logboek = Array.isArray(body?.logboek)
    ? body.logboek.slice(-200).map((r: any) => ({
        t: tekst(r?.t, 40),
        niveau: tekst(r?.niveau, 10),
        bericht: anonimiseerTekst(tekst(r?.bericht, 500)),
      }))
    : [];

  const meldingId = crypto.randomUUID();
  if (png) {
    await env.STORAGE.put(`meldingen/${meldingId}.png`, png, { httpMetadata: { contentType: 'image/png' } });
  }
  await env.DB.prepare(
    `insert into meldingen (melding_id, type, omschrijving_enc, email_enc, pagina, app_versie, browser, context, logboek, screenshot)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      meldingId,
      type,
      await versleutel(env, omschrijving),
      await versleutel(env, email || null),
      anonimiseerTekst(tekst(body?.pagina, 500)),
      tekst(body?.appVersie, 80),
      tekst(body?.browser, 400),
      JSON.stringify(context),
      JSON.stringify(logboek),
      png ? 1 : 0,
    )
    .run();
  return { meldingId, referentie: meldingId.slice(0, 8).toUpperCase() };
}

export async function lijstMeldingen(env: Env) {
  const { results } = await env.DB.prepare(`select * from meldingen order by created_at desc limit 200`).all<any>();
  return Promise.all(
    results.map(async ({ omschrijving_enc, email_enc, context, logboek, screenshot, ...m }) => ({
      ...m,
      referentie: m.melding_id.slice(0, 8).toUpperCase(),
      omschrijving: await ontsleutel(env, omschrijving_enc),
      email: await ontsleutel(env, email_enc),
      context: context ? JSON.parse(context) : null,
      logboek: logboek ? JSON.parse(logboek) : [],
      screenshot: screenshot === 1 ? `/api/beheer/meldingen/${m.melding_id}/screenshot` : null,
    })),
  );
}

export async function zetStatusMelding(env: Env, meldingId: string, status: string) {
  if (!['nieuw', 'in_behandeling', 'afgehandeld'].includes(status)) return false;
  const r = await env.DB.prepare(`update meldingen set status = ? where melding_id = ?`).bind(status, meldingId).run();
  return r.meta.changes === 1;
}

/** Verwijdert meldingen (en hun schermafbeelding) ouder dan de bewaartermijn. */
export async function ruimMeldingenOp(env: Env): Promise<number> {
  const grens = new Date(Date.now() - BEWAARTERMIJN_MELDINGEN_DAGEN * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(`select melding_id, screenshot from meldingen where created_at < ?`)
    .bind(grens)
    .all<{ melding_id: string; screenshot: number }>();
  const pngs = results.filter((m) => m.screenshot === 1).map((m) => `meldingen/${m.melding_id}.png`);
  for (let i = 0; i < pngs.length; i += 1000) await env.STORAGE.delete(pngs.slice(i, i + 1000));
  await env.DB.prepare(`delete from meldingen where created_at < ?`).bind(grens).run();
  return results.length;
}
