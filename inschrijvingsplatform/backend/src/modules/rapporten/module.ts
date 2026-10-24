import { audit } from '../../db/beheer';
import { bewaarTeksten, klaslijstenPerLeerkracht, rapport } from '../../db/rapporten';
import { defineModule } from '../../kern/module';
import { klaslijstmail, verstuur } from '../../mail';
import type { Gebruiker } from '../../middleware/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';

/** Mailt elke leerkracht de klaslijst(en) van zijn of haar lesjes. Enkel naar adressen van het eigen domein. */
async function mailKlaslijsten(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  const sessieIds = Array.isArray(body?.sessieIds) ? body.sessieIds.filter((i: unknown) => typeof i === 'string').slice(0, 500) : [];
  if (!sessieIds.length) throw new ValidatieFout({ sessieIds: 'Kies minstens één lesje.' });
  const { evenement, perAdres, zonderAdres, afzender } = await klaslijstenPerLeerkracht(env, g, evenementId, sessieIds, ip);
  const mislukt: string[] = [];
  let verzonden = 0;
  for (const [aan, lijsten] of perAdres) {
    const mail = klaslijstmail({
      aan,
      evenement,
      afzender,
      lijsten: lijsten.map((l) => ({ titel: l.sessie.titel, moment: l.moment, uur: l.uur, lokaal: l.sessie.lokaal, capaciteit: l.sessie.capaciteit, deelnemers: l.sessie.deelnemers })),
    });
    try {
      await verstuur(env, mail);
      verzonden++;
    } catch (e) {
      console.error('klaslijstmail', String(e).slice(0, 200));
      mislukt.push(...lijsten.map((l) => l.sessie.titel));
    }
  }
  // Geen adressen of namen in het auditlog: enkel aantallen.
  await audit(env, g, 'evenementen', evenementId, 'MAIL_KLASLIJSTEN', { lesjes: sessieIds.length, mails: verzonden, mislukt: mislukt.length }, ip).run();
  return { verzonden, zonderAdres, mislukt };
}

/** Rapporten: overzicht per dagdeel, per moment en klaslijsten per lesje (afdrukken, Excel, mailen). */
export default defineModule({
  id: 'rapporten',
  naam: 'Rapporten',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['evenementen'],

  routes: [
    {
      methode: 'GET',
      pad: '/evenementen/:id/rapport',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, ip }) => rapport(env, gebruiker, params.id, ip),
    },
    {
      methode: 'PATCH',
      pad: '/evenementen/:id/rapport/teksten',
      toegang: 'beheer',
      handler: async (ctx) => bewaarTeksten(ctx.env, ctx.gebruiker, ctx.params.id, (await ctx.leesJson(64 * 1024))?.teksten, ctx.ip),
    },
    {
      methode: 'POST',
      pad: '/evenementen/:id/rapport/mail',
      toegang: 'beheer',
      handler: async (ctx) => mailKlaslijsten(ctx.env, ctx.gebruiker, ctx.params.id, await ctx.leesJson(64 * 1024), ctx.ip),
    },
  ],
});
