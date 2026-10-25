import { json } from '../../kern/http';
import { defineModule } from '../../kern/module';
import { controleerKinderen, importeerInschrijvingen, importeerSessiegevers, maakVorigEvenement } from './importeren';
import { mailVraag, voegSamen } from './dubbels';
import { overzicht } from './overzicht';

/**
 * Historiek: gegevens van vorige schooljaren importeren (inschrijvingen met hun lesjes, sessiegevers) en per
 * evenement een overzicht met filters en rapporten: wie schreef vooraf in, wie kwam, wanneer, met welk lesje,
 * van welke school en welk leerjaar, met per kind de historiek en de broers en zussen.
 * Voorinschrijvingen importeren gebeurt via de module voorinschrijvingen (met een evenement erbij).
 */
export default defineModule({
  id: 'historiek',
  naam: 'Historiek en import',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['evenementen', 'onderwijs'],

  rechten: {
    'historiek.bekijken': {
      omschrijving: 'Overzicht per evenement met historiek per kind (vorige jaren, voorinschrijvingen, broers en zussen)',
      rollen: ['schoolbeheerder', 'organisator'], instelbaar: true,
    },
    'historiek.importeren': { omschrijving: 'Inschrijvingen en sessiegevers van vorige jaren importeren', rollen: [], instelbaar: true },
  },

  routes: [
    {
      methode: 'POST',
      pad: '/historiek/evenementen',
      toegang: 'beheer',
      recht: 'historiek.importeren',
      handler: async (ctx) => json(await maakVorigEvenement(ctx.env, ctx.gebruiker, await ctx.leesJson(4096), ctx.ip), 201),
    },
    {
      methode: 'POST',
      pad: '/historiek/kinderen',
      toegang: 'beheer',
      recht: 'historiek.importeren',
      handler: async (ctx) => controleerKinderen(ctx.env, await ctx.leesJson(8 * 1024 * 1024)),
    },
    {
      methode: 'POST',
      pad: '/historiek/evenementen/:id:uuid/inschrijvingen',
      toegang: 'beheer',
      recht: 'historiek.importeren',
      handler: async (ctx) => json(await importeerInschrijvingen(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(8 * 1024 * 1024), ctx.ip), 201),
    },
    {
      methode: 'POST',
      pad: '/historiek/evenementen/:id:uuid/sessiegevers',
      toegang: 'beheer',
      recht: 'historiek.importeren',
      handler: async (ctx) => json(await importeerSessiegevers(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(512 * 1024), ctx.ip), 201),
    },
    {
      methode: 'GET',
      pad: '/historiek/evenementen/:id:uuid/overzicht',
      toegang: 'beheer',
      recht: 'historiek.bekijken',
      handler: ({ env, gebruiker, params, ip }) => overzicht(env, gebruiker, params.id, ip),
    },
    {
      methode: 'POST',
      pad: '/historiek/evenementen/:id:uuid/dubbels/samenvoegen',
      toegang: 'beheer',
      recht: 'historiek.bekijken',
      handler: async (ctx) => voegSamen(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(4096), ctx.ip),
    },
    {
      methode: 'POST',
      pad: '/historiek/evenementen/:id:uuid/dubbels/mail',
      toegang: 'beheer',
      recht: 'historiek.bekijken',
      handler: async (ctx) => mailVraag(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(32 * 1024), ctx.ip),
    },
  ],

  fouten: {
    BEWAARTERMIJN_VERSTREKEN: [409, 'De bewaartermijn van dit evenement is voorbij: de gegevens zouden vannacht geanonimiseerd worden. Verleng eerst de bewaartermijn bij Instellingen.'],
  },
});
