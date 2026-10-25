import { leesVersie } from '../../kern/checkin';
import { DbFout } from '../../kern/fouten';
import { json, teSnel, teVeelAanvragen } from '../../kern/http';
import type { PubliekCtx, Route } from '../../kern/module';
import { ValidatieFout } from '../../validatie';
import {
  type Actor, deelnemerVanToken, lesOpties, overzicht, scanInSessie, scanResultaat, sessieTabel, vereisMedewerker,
  vereisMedewerkerVoorSessie, wijzigLesje, zetAanwezig, zetAfwezig, zetKlas,
} from './aanwezigheid';
import { evenementVanDeelnemer } from './beheer';
import { verwittigNaWijzigingDoorSchool } from './checkin';
import {
  controleerSessieVanSessiegever, koppelSessiegevers, maakSessiegever, meldAanMetCode, meldAfSessiegever, mijnSessies, neemOverUitSessies,
  nodigUit, sessiegeversVanEvenement, type Sessiegever, vereisSessiegever, verwijderSessiegever, vraagCode, wijzigSessiegever, zetVelden,
} from './sessiegevers';

/**
 * Routes voor de dag zelf (Plan_Checkin_en_Aanwezigheid.md):
 *   /api/beheer/...      medewerkers (onthaal, organisator): scannen, overzicht, lesje wijzigen, tabel per sessie, sessiegevers
 *   /api/sessiegever/... sessiegevers (aanmelden met een code per mail): de eigen sessies en hun tabel
 */

const sessiegeverActor = (s: Sessiegever): Actor => ({ soort: 'sessiegever', id: s.sessiegeverId, rechten: s.rechten });

async function sessiegeverVoorSessie(ctx: PubliekCtx, sessieId: string, recht: string) {
  const s = await vereisSessiegever(ctx.request, ctx.env, ctx.modules);
  await controleerSessieVanSessiegever(ctx.env, s, sessieId, recht);
  return sessiegeverActor(s);
}

export const AANWEZIGHEID_ROUTES: Route[] = [
  // ---- scannen aan het onthaal ----
  {
    methode: 'GET',
    pad: '/checkin/:token:token',
    toegang: 'beheer',
    handler: ({ env, gebruiker, params, request }) => scanResultaat(env, gebruiker, params.token, leesVersie(new URL(request.url).searchParams.get('v'))),
  },
  {
    methode: 'POST',
    pad: '/checkin/:token:token',
    toegang: 'beheer',
    async handler({ env, gebruiker, params, ip }) {
      const id = await deelnemerVanToken(env, params.token);
      await vereisMedewerker(env, gebruiker, await evenementVanDeelnemer(env, id, true), 'evenementen.inchecken');
      return { aangemeld: (await zetAanwezig(env, { soort: 'medewerker', g: gebruiker }, id, 'qr', ip)) > 0 };
    },
  },
  {
    methode: 'DELETE',
    pad: '/checkin/:token:token',
    toegang: 'beheer',
    async handler({ env, gebruiker, params, ip }) {
      const id = await deelnemerVanToken(env, params.token);
      await vereisMedewerker(env, gebruiker, await evenementVanDeelnemer(env, id, true), 'evenementen.inchecken');
      return zetAfwezig(env, { soort: 'medewerker', g: gebruiker }, id, ip);
    },
  },

  // ---- overzicht voor het onthaal ----
  {
    methode: 'GET',
    pad: '/evenementen/:id:uuid/aanwezigheid',
    toegang: 'beheer',
    handler: ({ env, gebruiker, params, request }) => overzicht(env, gebruiker, params.id, new URL(request.url).searchParams.get('dag')),
  },
  {
    // Aan de balie: aanwezig zetten of ongedaan maken, ook zonder QR-code
    methode: 'POST',
    pad: '/aanwezigheid/deelnemers/:id:uuid',
    toegang: 'beheer',
    async handler(ctx) {
      const { env, gebruiker, params, ip } = ctx;
      await vereisMedewerker(env, gebruiker, await evenementVanDeelnemer(env, params.id, true), 'evenementen.inchecken');
      const body = await ctx.leesJson(1024);
      if (typeof body?.aanwezig !== 'boolean') throw new ValidatieFout({ aanwezig: 'Ongeldige keuze.' });
      const actor: Actor = { soort: 'medewerker', g: gebruiker };
      if (!body.aanwezig) return zetAfwezig(env, actor, params.id, ip);
      return { aangemeld: (await zetAanwezig(env, actor, params.id, 'balie', ip)) > 0 };
    },
  },
  {
    methode: 'GET',
    pad: '/aanwezigheid/deelnemers/:id:uuid/lesjes',
    toegang: 'beheer',
    handler: ({ env, gebruiker, params }) => lesOpties(env, { soort: 'medewerker', g: gebruiker }, params.id),
  },
  {
    methode: 'POST',
    pad: '/aanwezigheid/deelnemers/:id:uuid/lesje',
    toegang: 'beheer',
    async handler(ctx) {
      const body = await ctx.leesJson(1024);
      if (typeof body?.sessieId !== 'string') throw new ValidatieFout({ sessieId: 'Kies een lesje.' });
      const r = await wijzigLesje(ctx.env, { soort: 'medewerker', g: ctx.gebruiker }, ctx.params.id, body.sessieId, body?.forceer === true);
      if (body?.verwittig !== false) await verwittigNaWijzigingDoorSchool(ctx.env, ctx, ctx.params.id);
      return r;
    },
  },

  // ---- tabel van een sessie, voor medewerkers ----
  {
    methode: 'GET',
    pad: '/sessies/:id:uuid/tabel',
    toegang: 'beheer',
    async handler({ env, gebruiker, params }) {
      await vereisMedewerkerVoorSessie(env, gebruiker, params.id, 'evenementen.sessie_inzien');
      return { ...(await sessieTabel(env, params.id)), rechten: gebruiker.rechten.filter((r) => r.startsWith('evenementen.')) };
    },
  },
  {
    methode: 'POST',
    pad: '/sessies/:id:uuid/deelnemers/:deelnemer:uuid',
    toegang: 'beheer',
    async handler(ctx) {
      await vereisMedewerkerVoorSessie(ctx.env, ctx.gebruiker, ctx.params.id, 'evenementen.inchecken');
      return zetKlas(ctx.env, { soort: 'medewerker', g: ctx.gebruiker }, ctx.params.id, ctx.params.deelnemer, (await ctx.leesJson(1024))?.klas ?? null, ctx.ip);
    },
  },
  {
    methode: 'POST',
    pad: '/sessies/:id:uuid/scan',
    toegang: 'beheer',
    async handler(ctx) {
      await vereisMedewerkerVoorSessie(ctx.env, ctx.gebruiker, ctx.params.id, 'evenementen.inchecken');
      const body = await ctx.leesJson(1024);
      return scanInSessie(ctx.env, { soort: 'medewerker', g: ctx.gebruiker }, ctx.params.id, body?.token, body?.toevoegen === true, ctx.ip);
    },
  },

  // ---- sessiegevers beheren ----
  {
    methode: 'GET',
    pad: '/evenementen/:id:uuid/sessiegevers',
    toegang: 'beheer',
    handler: ({ env, gebruiker, params }) => sessiegeversVanEvenement(env, gebruiker, params.id),
  },
  {
    methode: 'POST',
    pad: '/sessiegevers',
    toegang: 'beheer',
    recht: 'evenementen.sessiegevers.beheren',
    handler: async (ctx) => maakSessiegever(ctx.env, ctx.gebruiker, await ctx.leesJson(2048), ctx.ip),
  },
  {
    methode: 'PATCH',
    pad: '/sessiegevers/:id:uuid',
    toegang: 'beheer',
    recht: 'evenementen.sessiegevers.beheren',
    handler: async (ctx) => wijzigSessiegever(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(2048), ctx.ip),
  },
  {
    methode: 'DELETE',
    pad: '/sessiegevers/:id:uuid',
    toegang: 'beheer',
    recht: 'evenementen.sessiegevers.beheren',
    handler: ({ env, gebruiker, params, ip }) => verwijderSessiegever(env, gebruiker, params.id, ip),
  },
  {
    methode: 'PATCH',
    pad: '/sessies/:id:uuid/sessiegevers',
    toegang: 'beheer',
    handler: async (ctx) => koppelSessiegevers(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(4096), ctx.ip),
  },
  {
    methode: 'POST',
    pad: '/evenementen/:id:uuid/sessiegevers/overnemen',
    toegang: 'beheer',
    recht: 'evenementen.sessiegevers.beheren',
    handler: ({ env, gebruiker, params, ip }) => neemOverUitSessies(env, gebruiker, params.id, ip),
  },
  {
    methode: 'POST',
    pad: '/evenementen/:id:uuid/sessiegevers/uitnodigen',
    toegang: 'beheer',
    handler: async (ctx) => nodigUit(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(8192), ctx.ip),
  },
  {
    methode: 'PATCH',
    pad: '/evenementen/:id:uuid/sessiegever-velden',
    toegang: 'beheer',
    handler: async (ctx) => zetVelden(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(1024), ctx.ip),
  },

  // ---- sessiegevers zelf (publiek, met eigen aanmelding) ----
  {
    methode: 'POST',
    pad: '/sessiegever/code',
    toegang: 'publiek',
    async handler(ctx) {
      if (await teSnel(ctx.env.RL_REGISTRATIE, ctx.request)) return teVeelAanvragen();
      return vraagCode(ctx.env, await ctx.leesJson(1024), ctx.waitUntil);
    },
  },
  {
    methode: 'POST',
    pad: '/sessiegever/aanmelden',
    toegang: 'publiek',
    async handler(ctx) {
      if (await teSnel(ctx.env.RL_REGISTRATIE, ctx.request)) return teVeelAanvragen();
      const { cookie, voornaam } = await meldAanMetCode(ctx.env, ctx.request, await ctx.leesJson(1024));
      return json({ ok: true, voornaam }, 200, { 'Set-Cookie': cookie });
    },
  },
  {
    methode: 'POST',
    pad: '/sessiegever/afmelden',
    toegang: 'publiek',
    handler: async ({ env, request }) => json({ ok: true }, 200, { 'Set-Cookie': await meldAfSessiegever(env, request) }),
  },
  {
    methode: 'GET',
    pad: '/sessiegever/ik',
    toegang: 'publiek',
    handler: async ({ env, request, modules }) => mijnSessies(env, await vereisSessiegever(request, env, modules)),
  },
  {
    methode: 'GET',
    pad: '/sessiegever/sessies/:id:uuid',
    toegang: 'publiek',
    async handler(ctx) {
      const actor = await sessiegeverVoorSessie(ctx, ctx.params.id, 'evenementen.sessie_inzien');
      if (actor.soort !== 'sessiegever') throw new DbFout('GEEN_TOEGANG');
      return { ...(await sessieTabel(ctx.env, ctx.params.id)), rechten: actor.rechten };
    },
  },
  {
    methode: 'POST',
    pad: '/sessiegever/sessies/:id:uuid/deelnemers/:deelnemer:uuid',
    toegang: 'publiek',
    async handler(ctx) {
      const actor = await sessiegeverVoorSessie(ctx, ctx.params.id, 'evenementen.inchecken');
      return zetKlas(ctx.env, actor, ctx.params.id, ctx.params.deelnemer, (await ctx.leesJson(1024))?.klas ?? null, ctx.ip);
    },
  },
  {
    methode: 'POST',
    pad: '/sessiegever/sessies/:id:uuid/scan',
    toegang: 'publiek',
    async handler(ctx) {
      const actor = await sessiegeverVoorSessie(ctx, ctx.params.id, 'evenementen.inchecken');
      const body = await ctx.leesJson(1024);
      return scanInSessie(ctx.env, actor, ctx.params.id, body?.token, body?.toevoegen === true, ctx.ip);
    },
  },
];
