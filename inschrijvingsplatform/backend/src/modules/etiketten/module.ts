import { bewaarEtiketInstellingen, etiketten, zetVerdieping } from '../../db/etiketten';
import { defineModule } from '../../kern/module';

/** Etiketten: naametiketten met de gekozen lesjes; opmaak per evenement, verdieping per lokaal. */
export default defineModule({
  id: 'etiketten',
  naam: 'Etiketten',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['evenementen'],

  routes: [
    {
      methode: 'GET',
      pad: '/evenementen/:id/etiketten',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, ip }) => etiketten(env, gebruiker, params.id, ip),
    },
    {
      methode: 'PATCH',
      pad: '/evenementen/:id/etiketten/instellingen',
      toegang: 'beheer',
      handler: async (ctx) => bewaarEtiketInstellingen(ctx.env, ctx.gebruiker, ctx.params.id, (await ctx.leesJson(16 * 1024))?.instellingen, ctx.ip),
    },
    {
      methode: 'PATCH',
      pad: '/evenementen/:id/etiketten/lokalen/:lokaal',
      toegang: 'beheer',
      handler: async (ctx) => zetVerdieping(ctx.env, ctx.gebruiker, ctx.params.id, ctx.params.lokaal, (await ctx.leesJson(1024))?.verdieping, ctx.ip),
    },
  ],
});
