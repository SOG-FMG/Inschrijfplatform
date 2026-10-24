import { json } from '../../kern/http';
import { defineModule } from '../../kern/module';
import { anonimiseer, controleerPersonen, importeer, importen, koppelBestaandeRijen, statistieken, uitnodigingOverzicht, verstuurUitnodigingen, verwijder } from './db';

/**
 * Voorinschrijvingen uit een extern bestand (bv. een export van Microsoft Forms) importeren, voor statistieken
 * en controles: per school, klas en maand, dubbels, en wie zich ook voor een infodag inschreef. De frontend
 * koppelt kolommen en scholen; hier wordt gevalideerd, versleuteld en bewaard. Na de controles: anonimiseren.
 */
export default defineModule({
  id: 'voorinschrijvingen',
  naam: 'Voorinschrijvingen',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['onderwijs'],

  rechten: {
    'voorinschrijvingen.beheren': { omschrijving: 'Voorinschrijvingen importeren, bekijken, anonimiseren en verwijderen', rollen: [] },
  },

  routes: [
    {
      methode: 'GET',
      pad: '/voorinschrijvingen/importen',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: async ({ env }) => importen(env),
    },
    {
      methode: 'POST',
      pad: '/voorinschrijvingen/importen',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: async (ctx) => json(await importeer(ctx.env, ctx.gebruiker, await ctx.leesJson(8 * 1024 * 1024), ctx.ip), 201),
    },
    {
      // Nakijkstap vóór het importeren: welke kinderen bestaan al, welke zijn twijfels.
      methode: 'POST',
      pad: '/voorinschrijvingen/personen',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: async (ctx) => controleerPersonen(ctx.env, await ctx.leesJson(8 * 1024 * 1024)),
    },
    {
      methode: 'GET',
      pad: '/voorinschrijvingen/importen/:id:uuid/uitnodigingen/:evenement',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: ({ env, gebruiker, params }) => uitnodigingOverzicht(env, gebruiker, params.id, params.evenement),
    },
    {
      methode: 'POST',
      pad: '/voorinschrijvingen/importen/:id:uuid/uitnodigingen/:evenement',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: async (ctx) => verstuurUitnodigingen(ctx.env, ctx.gebruiker, ctx.params.id, ctx.params.evenement, await ctx.leesJson(1024), ctx.ip),
    },
    {
      methode: 'POST',
      pad: '/voorinschrijvingen/importen/:id:uuid/anonimiseer',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: ({ env, gebruiker, params, ip }) => anonimiseer(env, gebruiker, params.id, ip),
    },
    {
      methode: 'DELETE',
      pad: '/voorinschrijvingen/importen/:id:uuid',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: ({ env, gebruiker, params, ip }) => verwijder(env, gebruiker, params.id, ip),
    },
    {
      methode: 'GET',
      pad: '/voorinschrijvingen/statistieken',
      toegang: 'beheer',
      recht: 'voorinschrijvingen.beheren',
      handler: async ({ env }) => statistieken(env),
    },
  ],

  fouten: {
    IMPORT_NIET_GEVONDEN: [404, 'Deze import bestaat niet (meer).'],
  },

  taken: [{ naam: 'bestaande voorinschrijvingen aan contacten koppelen', uitvoeren: (env) => koppelBestaandeRijen(env) }],

  persoonsverwijzingen: [{ tabel: 'voorinschrijvingen', persoon: 'persoon_id', contact: 'contact_id' }],
});
