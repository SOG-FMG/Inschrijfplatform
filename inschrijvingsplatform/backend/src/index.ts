import { authRoute, aanmeldBeheerRoute } from './auth/routes';
import { ruimAanmeldingOp } from './auth/sessie';
import { sha256 } from './crypto/versleuteling';
import { anonimiseerEvenement, anonimiseerVerlopenEvenementen, audit, deelnemerslijst, kenSessieToe, verplaatsDagdeel } from './db/beheer';
import { publiekEvenement, scholen } from './db/evenement';
import { DbFout } from './db/fouten';
import { bewaarMelding, lijstMeldingen, MeldingFout, ruimMeldingenOp, zetStatusMelding } from './db/meldingen';
import { annuleerViaToken, registratieViaToken, registreer } from './db/registratie';
import { bevestigingsmail, meldingsmail, verstuur } from './mail';
import { huidigeGebruiker, isToegelatenEmail } from './middleware/toegang';
import type { Env } from './types';
import { isUuid, ValidatieFout, valideerRegistratie } from './validatie';

/** Gebruikersvriendelijke meldingen voor de foutcodes uit de databaselaag. */
const MELDINGEN: Record<string, [number, string]> = {
  EVENEMENT_NIET_GEVONDEN: [404, 'Dit evenement bestaat niet of is niet meer beschikbaar.'],
  INSCHRIJVING_GESLOTEN: [409, 'De inschrijvingen zijn afgesloten.'],
  ONGELDIGE_GEGEVENS: [400, 'Controleer de ingevulde gegevens.'],
  PRIVACY_NIET_AANVAARD: [400, 'Je moet de privacyverklaring aanvaarden.'],
  ONGELDIGE_DOELGROEP: [400, 'Maak een geldige keuze.'],
  GEEN_SESSIEKEUZE_VOOR_DOELGROEP: [400, 'Voor deze keuze kan je geen onderdelen kiezen.'],
  ONGELDIG_AANTAL_DAGDELEN: [400, 'Kies een geldig moment.'],
  ONGELDIG_DAGDEEL: [400, 'Dit moment is niet meer beschikbaar.'],
  DUBBELE_INSCHRIJVING: [409, 'Deze deelnemer is al ingeschreven met dit e-mailadres. Bekijk je bevestigingsmail.'],
  ONGELDIGE_SESSIEKEUZE: [400, 'Een gekozen onderdeel is niet meer beschikbaar. Vernieuw de pagina.'],
  MEERDERE_SESSIES_IN_TIJDSBLOK: [400, 'Kies maximaal één onderdeel per tijdsblok.'],
  ZELFDE_ONDERDEEL_DUBBEL: [400, 'Je koos twee keer hetzelfde onderdeel. Kies iets anders.'],
  VERPLICHT_TIJDSBLOK_ONTBREEKT: [400, 'Maak een keuze voor elk verplicht tijdsblok.'],
  DAGDEEL_VOLZET: [409, 'Dit moment is intussen volzet. Kies een ander moment.'],
  SESSIE_VOLZET: [409, 'Een gekozen onderdeel is intussen volzet. Kies een ander onderdeel.'],
  REGISTRATIE_NIET_GEVONDEN: [404, 'Deze inschrijving werd niet gevonden of is al geannuleerd.'],
  NIET_MEER_ANNULEERBAAR: [409, 'Deze inschrijving kan niet meer geannuleerd worden.'],
  NIET_AANGEMELD: [401, 'Meld je aan om verder te gaan.'],
  AANMELDEN_MISLUKT: [401, 'Aanmelden mislukt. Controleer je gegevens en probeer opnieuw.'],
  ONGELDIGE_UITNODIGING: [400, 'Deze uitnodiging is ongeldig of verlopen.'],
  TE_VEEL_POGINGEN: [429, 'Te veel pogingen. Probeer het over 15 minuten opnieuw.'],
  GEBRUIKER_BESTAAT: [409, 'Er bestaat al een gebruiker met dit e-mailadres.'],
  GEEN_TOEGANG: [403, 'Je hebt geen toegang tot deze gegevens.'],
  INSCHRIJVING_NIET_GEVONDEN: [404, 'Deze deelnemer is niet ingeschreven voor dat moment.'],
  EERST_DAGDEEL_VERPLAATSEN: [409, 'Verplaats de deelnemer eerst naar het dagdeel van deze sessie.'],
};

function cors(request: Request, env: Env): Record<string, string> {
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

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

function nieuwToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function controleerTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
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

const botcontroleMislukt = () => json({ fout: 'BOTCONTROLE', melding: 'De beveiligingscontrole is mislukt. Probeer opnieuw.' }, 403);

async function leesJson(request: Request, maxBytes: number): Promise<unknown> {
  const lengte = Number(request.headers.get('Content-Length') ?? 0);
  if (lengte > maxBytes) throw new ValidatieFout({ aanvraag: 'De aanvraag is te groot.' });
  const tekst = await request.text();
  if (tekst.length > maxBytes) throw new ValidatieFout({ aanvraag: 'De aanvraag is te groot.' });
  return JSON.parse(tekst);
}

/** Beperkt het aantal aanvragen per IP-adres (Workers Rate Limiting). Zonder binding (lokaal, tests) gebeurt er niets. */
async function teSnel(limiet: RateLimit | undefined, request: Request): Promise<boolean> {
  if (!limiet) return false;
  const { success } = await limiet.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'onbekend' });
  return !success;
}

const teVeelAanvragen = () => json({ fout: 'TE_VEEL_AANVRAGEN', melding: 'Te veel aanvragen na elkaar. Wacht even en probeer opnieuw.' }, 429);

async function registreerRoute(request: Request, env: Env, ctx: ExecutionContext, slug: string): Promise<Response> {
  if (await teSnel(env.RL_REGISTRATIE, request)) return teVeelAanvragen();
  const invoer = valideerRegistratie(await leesJson(request, 64 * 1024));
  // Honeypot ingevuld → doen alsof het lukte, maar niets bewaren
  if (invoer.website) return json({ referentie: 'OK' }, 201);
  if (!(await controleerTurnstile(env, invoer.turnstileToken, request.headers.get('CF-Connecting-IP')))) return botcontroleMislukt();

  const token = nieuwToken();
  const resultaat = await registreer(env, slug, invoer, await sha256(token));

  const beheerUrl = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/beheer/${token}`;
  const mail = bevestigingsmail(resultaat, invoer.deelnemer.email, invoer.deelnemer.voornaam, beheerUrl);
  const logMail = (status: string, fout?: string) =>
    env.DB.prepare(`insert into mail_berichten (bericht_id, deelnemer_id, type, status, fout) values (?, ?, 'bevestiging', ?, ?)`)
      .bind(crypto.randomUUID(), resultaat.deelnemerId, status, fout ?? null)
      .run();
  ctx.waitUntil(
    verstuur(env, mail)
      .then((status) => logMail(status))
      .catch((e) => logMail('mislukt', String(e).slice(0, 500))),
  );

  const { deelnemerId: _intern, ...publiek } = resultaat;
  return json({ ...publiek, beheerUrl }, 201);
}

async function meldingRoute(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (await teSnel(env.RL_MELDING, request)) return teVeelAanvragen();
  const body = (await leesJson(request, 5 * 1024 * 1024)) as any;
  if (typeof body?.website === 'string' && body.website) return json({ referentie: 'OK' }, 201);
  if (!(await controleerTurnstile(env, body?.turnstileToken, request.headers.get('CF-Connecting-IP')))) return botcontroleMislukt();
  const melding = await bewaarMelding(env, body);
  if (env.MELDINGEN_MAIL && isToegelatenEmail(env.MELDINGEN_MAIL)) {
    ctx.waitUntil(verstuur(env, meldingsmail(env.MELDINGEN_MAIL, melding.referentie, body.type)).catch((e) => console.error('meldingsmail', String(e))));
  }
  return json(melding, 201);
}

function csv(rijen: Record<string, unknown>[], kolommen: string[], bestandsnaam: string): Response {
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

async function beheerRoute(request: Request, env: Env, pad: string, m: string): Promise<Response> {
  const g = await huidigeGebruiker(request, env);
  const ip = request.headers.get('CF-Connecting-IP');
  let p: RegExpMatchArray | null;

  const aanmelden = await aanmeldBeheerRoute(request, env, g, pad);
  if (aanmelden) return aanmelden;

  if (m === 'GET' && (p = pad.match(/^\/evenementen\/([0-9a-f-]{36})\/deelnemers\.csv$/)) && isUuid(p[1])) {
    const rijen = await deelnemerslijst(env, g, p[1], ip);
    const kolommen = ['referentie', 'ingeschreven_op', 'doelgroep', 'voornaam', 'naam', 'email', 'contact_voornaam', 'contact_naam',
      'telefoon', 'school', 'gemeente', 'leerjaar', 'functie', 'momenten', 'keuzes', 'opmerkingen'];
    return csv(rijen, kolommen, `deelnemers-${p[1].slice(0, 8)}.csv`);
  }
  if (m === 'POST' && (p = pad.match(/^\/evenementen\/([0-9a-f-]{36})\/anonimiseer$/)) && isUuid(p[1])) {
    return json(await anonimiseerEvenement(env, g, p[1]));
  }
  if (m === 'POST' && (p = pad.match(/^\/deelnemers\/([0-9a-f-]{36})\/(dagdeel|sessie)$/)) && isUuid(p[1])) {
    const body = (await leesJson(request, 4096)) as any;
    const forceer = body?.forceer === true;
    if (p[2] === 'dagdeel') {
      if (!isUuid(body?.van) || !isUuid(body?.naar)) throw new ValidatieFout({ dagdeel: 'Geef van en naar op.' });
      return json(await verplaatsDagdeel(env, g, p[1], body.van, body.naar, forceer));
    }
    if (!isUuid(body?.sessieId)) throw new ValidatieFout({ sessieId: 'Geef een sessie op.' });
    return json(await kenSessieToe(env, g, p[1], body.sessieId, forceer));
  }

  // Meldingen bevatten technische gegevens van het hele platform: enkel platformbeheer.
  if (pad.startsWith('/meldingen')) {
    if (g.rol !== 'platformbeheerder') throw new DbFout('GEEN_TOEGANG');
    if (m === 'GET' && pad === '/meldingen') {
      await audit(env, g, 'meldingen', '*', 'LIJST', undefined, ip).run();
      return json(await lijstMeldingen(env));
    }
    if ((p = pad.match(/^\/meldingen\/([0-9a-f-]{36})(\/screenshot)?$/)) && isUuid(p[1])) {
      if (m === 'GET' && p[2]) {
        const obj = await env.STORAGE.get(`meldingen/${p[1]}.png`);
        if (!obj) return json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
        return new Response(obj.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
      }
      if (m === 'PATCH' && !p[2]) {
        const body = (await leesJson(request, 1024)) as any;
        return (await zetStatusMelding(env, p[1], String(body?.status)))
          ? json({ ok: true })
          : json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
      }
    }
  }
  return json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const m = request.method;
  let p: RegExpMatchArray | null;

  if (m === 'GET' && (p = pathname.match(/^\/api\/evenementen\/([a-z0-9-]{1,80})$/))) {
    const ev = await publiekEvenement(env, p[1]);
    return ev ? json(ev) : json({ fout: 'EVENEMENT_NIET_GEVONDEN', melding: MELDINGEN.EVENEMENT_NIET_GEVONDEN[1] }, 404);
  }
  if (m === 'POST' && (p = pathname.match(/^\/api\/evenementen\/([a-z0-9-]{1,80})\/registraties$/))) {
    return registreerRoute(request, env, ctx, p[1]);
  }
  if (m === 'GET' && pathname === '/api/scholen') {
    return json(await scholen(env), 200, { 'Cache-Control': 'public, max-age=3600' });
  }
  if ((p = pathname.match(/^\/api\/registraties\/([A-Za-z0-9_-]{43})$/))) {
    const hash = await sha256(p[1]);
    if (m === 'GET') {
      const r = await registratieViaToken(env, hash);
      return r ? json(r) : json({ fout: 'REGISTRATIE_NIET_GEVONDEN', melding: MELDINGEN.REGISTRATIE_NIET_GEVONDEN[1] }, 404);
    }
    if (m === 'DELETE') return json(await annuleerViaToken(env, hash));
  }
  if (m === 'POST' && pathname === '/api/meldingen') return meldingRoute(request, env, ctx);
  if (pathname.startsWith('/api/auth/')) return authRoute(request, env, pathname.slice('/api/auth'.length));
  if (pathname.startsWith('/api/beheer/')) return beheerRoute(request, env, pathname.slice('/api/beheer'.length), m);
  return json({ fout: 'NIET_GEVONDEN', melding: 'Niet gevonden.' }, 404);
}

/** Pad zonder geheime tokens of id's, zodat logregels groeperen en niets gevoeligs bevatten. */
const logPad = (pad: string) =>
  pad.replace(/[A-Za-z0-9_-]{43}/g, ':token').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const start = Date.now();
    // Zelfde id als in Cloudflare (Ray ID); de frontend logt het mee, zodat een melding te koppelen is aan de Worker-logs.
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    const corsHeaders = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    let res: Response;
    let fout: string | undefined;
    try {
      res = await route(request, env, ctx);
    } catch (e) {
      if (e instanceof DbFout && MELDINGEN[e.code]) {
        const [status, melding] = MELDINGEN[e.code];
        fout = e.code;
        // detail = id van het volzette dagdeel/sessie, zodat de frontend het kan markeren
        res = json({ fout: e.code, melding: e.hint ? `${melding} (${e.hint})` : melding, id: e.detail }, status);
      } else if (e instanceof ValidatieFout || e instanceof MeldingFout) {
        fout = 'VALIDATIE';
        res = json({ fout: 'VALIDATIE', melding: 'Controleer de gemarkeerde velden.', velden: e.velden }, 400);
      } else if (e instanceof SyntaxError) {
        fout = 'ONGELDIGE_AANVRAAG';
        res = json({ fout: 'ONGELDIGE_AANVRAAG', melding: 'Ongeldige aanvraag.' }, 400);
      } else {
        fout = 'SERVERFOUT';
        // Nooit de request-body loggen (persoonsgegevens); enkel de foutmelding en de stack.
        console.error(JSON.stringify({ requestId, fout: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }));
        res = json({ fout: 'SERVERFOUT', melding: 'Er ging iets mis. Probeer het later opnieuw.', requestId }, 500);
      }
    }
    // Eén gestructureerde logregel per aanvraag (Workers Observability), zonder persoonsgegevens.
    console.log(
      JSON.stringify({ requestId, methode: request.method, pad: logPad(new URL(request.url).pathname), status: res.status, ms: Date.now() - start, fout }),
    );

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Request-Id', requestId);
    return new Response(res.body, { status: res.status, headers });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      Promise.all([anonimiseerVerlopenEvenementen(env), ruimMeldingenOp(env), ruimAanmeldingOp(env)]).then(([deelnemers, meldingen]) =>
        console.log(JSON.stringify({ taak: 'opruimen', geanonimiseerd: deelnemers, meldingenVerwijderd: meldingen })),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
