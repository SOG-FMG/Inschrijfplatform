import { aanmeldBeheerRoute, authRoute } from './auth/routes';
import { DbFout } from './kern/fouten';
import { MeldingFout } from './modules/meldingen/db';
import { cors, json, leesJson, nietGevonden } from './kern/http';
import { installatie } from './kern/installatie';
import type { BeheerCtx, PubliekCtx } from './kern/module';
import { maakRegister, type Register } from './kern/register';
import { huidigeGebruiker } from './kern/toegang';
import { ALLE_MODULES } from './modules';
import type { Env } from './types';
import { ValidatieFout } from './validatie';

/**
 * De kern: neemt elke aanvraag aan, stuurt ze naar de juiste module (src/kern/register.ts), vertaalt
 * fouten naar een melding voor de gebruiker en schrijft één logregel per aanvraag.
 *   /api/auth/*     aanmelden (kern)
 *   /api/beheer/*   eerst aanmelden, dan account en medewerkers (kern), dan de beheerroutes van de modules
 *   /api/*          publieke routes van de modules, en /api/installatie
 */

// Eén register per waarde van MODULES (in de praktijk één per installatie), bewaard zolang de Worker draait.
let register: { sleutel: string; r: Register } | null = null;
function huidigRegister(env: Env): Register {
  const sleutel = env.MODULES ?? '';
  if (register?.sleutel !== sleutel) register = { sleutel, r: maakRegister(ALLE_MODULES, env.MODULES) };
  return register.r;
}

function publiekCtx(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): PubliekCtx {
  return {
    env,
    request,
    params,
    ip: request.headers.get('CF-Connecting-IP'),
    waitUntil: (p) => ctx.waitUntil(p),
    leesJson: (max) => leesJson(request, max) as Promise<any>,
  };
}

const naarResponse = (a: unknown) => (a instanceof Response ? a : json(a));

async function beheerRoute(request: Request, env: Env, ctx: ExecutionContext, reg: Register, pad: string): Promise<Response> {
  const aangemeld = await huidigeGebruiker(request, env);
  const gebruiker = { ...aangemeld, rechten: reg.rechtenVan(aangemeld) };

  // Account, passkeys en medewerkers (kern). Daarna moet een account zonder wachtwoord er eerst één instellen.
  const kern = await aanmeldBeheerRoute(request, env, gebruiker, pad);
  if (kern) return kern;

  const t = reg.zoek('beheer', request.method, pad);
  if (!t || t.route.toegang !== 'beheer') return nietGevonden();
  if (t.route.recht && !gebruiker.rechten.includes(t.route.recht)) throw new DbFout('GEEN_TOEGANG');
  const beheer: BeheerCtx = {
    ...publiekCtx(request, env, ctx, t.params),
    gebruiker,
    heeftRecht: (recht) => gebruiker.rechten.includes(recht),
  };
  return naarResponse(await t.route.handler(beheer));
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const reg = huidigRegister(env);

  if (pathname.startsWith('/api/auth/')) return authRoute(request, env, pathname.slice('/api/auth'.length));
  if (pathname.startsWith('/api/beheer/')) return beheerRoute(request, env, ctx, reg, pathname.slice('/api/beheer'.length));

  // Profiel van de installatie, voor teksten en modules in de frontend (ook vóór het aanmelden).
  if (request.method === 'GET' && pathname === '/api/installatie') {
    return json({ ...installatie(env), modules: reg.actief.map((m) => m.id) }, 200, { 'Cache-Control': 'public, max-age=300' });
  }

  if (pathname.startsWith('/api/')) {
    const t = reg.zoek('publiek', request.method, pathname.slice('/api'.length));
    if (t && t.route.toegang === 'publiek') return naarResponse(await t.route.handler(publiekCtx(request, env, ctx, t.params)));
  }
  return nietGevonden();
}

/** Pad zonder geheime tokens of id's, zodat logregels groeperen en niets gevoeligs bevatten. */
const logPad = (pad: string) =>
  pad.replace(/[A-Za-z0-9_-]{43}/g, ':token').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');

/** Foutcodes van alle modules; ook als het register zelf niet laadt, blijft de foutafhandeling werken. */
function foutcodes(env: Env): Record<string, [number, string]> {
  try {
    return huidigRegister(env).fouten;
  } catch {
    return {};
  }
}

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
      const bekend = e instanceof DbFout ? foutcodes(env)[e.code] : undefined;
      if (e instanceof DbFout && bekend) {
        const [status, melding] = bekend;
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

  /**
   * Dagelijks (wrangler.toml [triggers]): de taken van alle actieve modules, na elkaar (de kern als laatste).
   * Eén mislukte taak houdt de andere niet tegen.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const taken = huidigRegister(env).taken;
    const naElkaar = async () => {
      const uitkomsten: PromiseSettledResult<number | void>[] = [];
      for (const { taak } of taken) uitkomsten.push(...(await Promise.allSettled([taak.uitvoeren(env, { modules: ALLE_MODULES })])));
      return uitkomsten;
    };
    ctx.waitUntil(
      naElkaar().then((uitkomsten) =>
        console.log(
          JSON.stringify({
            taak: 'dagelijks',
            resultaten: uitkomsten.map((u, i) => ({
              module: taken[i].module.id,
              taak: taken[i].taak.naam,
              ...(u.status === 'fulfilled' ? { aantal: u.value ?? null } : { fout: String(u.reason).slice(0, 200) }),
            })),
          }),
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
