import { audit } from '../../db/beheer';
import { bewaarMelding, lijstMeldingen, ruimMeldingenOp, zetStatusMelding } from '../../db/meldingen';
import { isToegelatenEmail } from '../../kern/installatie';
import { botcontroleMislukt, controleerTurnstile, json, nietGevonden, teSnel, teVeelAanvragen } from '../../kern/http';
import { defineModule } from '../../kern/module';
import { meldingsmail, verstuur } from '../../mail';

/**
 * Meldingen via de knop "Probleem of idee?" met het logboek uit de browser
 * (zie Instructie_Logboek_en_Meldingen.md). Lezen enkel met het recht meldingen.beheren.
 */
export default defineModule({
  id: 'meldingen',
  naam: 'Meldingen',
  versie: '1.0.0',
  vereistKern: '^1.0.0',

  rechten: {
    // Meldingen bevatten technische gegevens van het hele platform: enkel platformbeheer.
    'meldingen.beheren': { omschrijving: 'Meldingen lezen en hun status wijzigen', rollen: [] },
  },

  routes: [
    {
      methode: 'POST',
      pad: '/meldingen',
      toegang: 'publiek',
      async handler(ctx) {
        const { env, request } = ctx;
        if (await teSnel(env.RL_MELDING, request)) return teVeelAanvragen();
        const body = await ctx.leesJson(5 * 1024 * 1024);
        if (typeof body?.website === 'string' && body.website) return json({ referentie: 'OK' }, 201);
        if (!(await controleerTurnstile(env, body?.turnstileToken, ctx.ip))) return botcontroleMislukt();
        const melding = await bewaarMelding(env, body);
        if (env.MELDINGEN_MAIL && isToegelatenEmail(env, env.MELDINGEN_MAIL)) {
          ctx.waitUntil(verstuur(env, meldingsmail(env.MELDINGEN_MAIL, melding.referentie, body.type)).catch((e) => console.error('meldingsmail', String(e))));
        }
        return json(melding, 201);
      },
    },
    {
      methode: 'GET',
      pad: '/meldingen',
      toegang: 'beheer',
      recht: 'meldingen.beheren',
      async handler({ env, gebruiker, ip }) {
        await audit(env, gebruiker, 'meldingen', '*', 'LIJST', undefined, ip).run();
        return lijstMeldingen(env);
      },
    },
    {
      methode: 'GET',
      pad: '/meldingen/:id:uuid/screenshot',
      toegang: 'beheer',
      recht: 'meldingen.beheren',
      async handler({ env, params }) {
        const obj = await env.STORAGE.get(`meldingen/${params.id}.png`);
        if (!obj) return nietGevonden();
        return new Response(obj.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
      },
    },
    {
      methode: 'PATCH',
      pad: '/meldingen/:id:uuid',
      toegang: 'beheer',
      recht: 'meldingen.beheren',
      async handler(ctx) {
        const body = await ctx.leesJson(1024);
        return (await zetStatusMelding(ctx.env, ctx.params.id, String(body?.status))) ? json({ ok: true }) : nietGevonden();
      },
    },
  ],

  taken: [{ naam: 'meldingen ouder dan 90 dagen verwijderen', uitvoeren: ruimMeldingenOp }],
});
