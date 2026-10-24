import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';
import { json, nietGevonden } from '../../kern/http';
import { installatie } from '../../kern/installatie';
import { defineModule, type Module } from '../../kern/module';
import { aangepastSjabloon, controleerSjabloon, leesOpmaak, maakHtml, maakOnderwerp, verpakMail, voorbeeldVelden, type SjabloonDefinitie } from '../../kern/sjablonen';
import { bewaarBanner, bewaarVoettekst, isPlaats, opmaak, verwijderBanner } from './opmaak';
import { verstuur } from '../../mail';
import { ValidatieFout } from '../../validatie';

/**
 * Mailteksten nalezen en aanpassen. Elke module meldt haar mails in haar manifest (mailsjablonen), met de velden
 * die erin kunnen en een standaardtekst. Een aangepaste tekst staat in de tabel mailsjablonen; verwijderen zet de
 * standaardtekst terug. Zie kern/sjablonen.ts voor de opmaak ({{veld}}, **vet**, {{#veld}}…{{/veld}}).
 */

function zoek(modules: Module[], sleutel: string): { def: SjabloonDefinitie; module: Module } {
  for (const module of modules) {
    const def = module.mailsjablonen?.find((s) => s.sleutel === sleutel);
    if (def) return { def, module };
  }
  throw new DbFout('SJABLOON_NIET_GEVONDEN');
}

/** Onderwerp en tekst uit de aanvraag, gecontroleerd op lengte en op velden die niet bestaan. */
function leesSjabloon(body: any, def: SjabloonDefinitie) {
  const onderwerp = typeof body?.onderwerp === 'string' ? body.onderwerp.trim() : '';
  const tekst = typeof body?.tekst === 'string' ? body.tekst.replace(/\r\n/g, '\n').trim() : '';
  const fouten: Record<string, string> = {};
  if (!onderwerp || onderwerp.length > 200) fouten.onderwerp = 'Geef een onderwerp (maximaal 200 tekens).';
  if (!tekst || tekst.length > 10000) fouten.tekst = 'Geef een tekst (maximaal 10 000 tekens).';
  const fo = controleerSjabloon(onderwerp, def);
  const ft = controleerSjabloon(tekst, def);
  if (fo.length) fouten.onderwerp = fo.join(' ');
  if (ft.length) fouten.tekst = ft.join(' ');
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);
  return { onderwerp, tekst };
}

export default defineModule({
  id: 'mailsjablonen',
  naam: 'Mailteksten',
  versie: '1.0.0',
  vereistKern: '^1.0.0',

  rechten: {
    'mailsjablonen.beheren': { omschrijving: 'Mailteksten nalezen, aanpassen en testen', rollen: [] },
  },

  routes: [
    // ---- opmaak van alle mails (vóór /mailsjablonen/:sleutel, anders zou "opmaak" als sleutel gelezen worden) ----
    {
      methode: 'GET',
      pad: '/mailsjablonen/opmaak',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      handler: async ({ env }) => opmaak(env),
    },
    {
      methode: 'PATCH',
      pad: '/mailsjablonen/opmaak',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      handler: async (ctx) => bewaarVoettekst(ctx.env, ctx.gebruiker, await ctx.leesJson(8 * 1024), ctx.ip),
    },
    {
      methode: 'POST',
      pad: '/mailsjablonen/opmaak/:plaats:woord',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      handler: async ({ env, gebruiker, params, request, ip }) => (isPlaats(params.plaats) ? bewaarBanner(env, gebruiker, params.plaats, request, ip) : nietGevonden()),
    },
    {
      methode: 'DELETE',
      pad: '/mailsjablonen/opmaak/:plaats:woord',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      handler: async ({ env, gebruiker, params, ip }) => (isPlaats(params.plaats) ? verwijderBanner(env, gebruiker, params.plaats, ip) : nietGevonden()),
    },
    {
      // Publiek: mailprogramma's halen de banners op via een gewone link.
      methode: 'GET',
      pad: '/mailbeelden/:naam',
      toegang: 'publiek',
      async handler({ env, params }) {
        const obj = await env.STORAGE.get(`mailbeelden/${params.naam}`);
        if (!obj) return nietGevonden();
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Security-Policy': "default-src 'none'",
          },
        });
      },
    },

    // ---- de mailteksten ----
    {
      methode: 'GET',
      pad: '/mailsjablonen',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      async handler({ env, modules }) {
        const { results } = await env.DB.prepare(
          `select m.sleutel, m.onderwerp, m.tekst, m.gewijzigd_op as gewijzigdOp, trim(g.voornaam || ' ' || g.naam) as gewijzigdDoor
           from mailsjablonen m left join gebruikers g on g.gebruiker_id = m.gewijzigd_door`,
        ).all<{ sleutel: string; onderwerp: string; tekst: string; gewijzigdOp: string; gewijzigdDoor: string | null }>();
        const aangepast = new Map(results.map((r) => [r.sleutel, r]));
        return modules.flatMap((m) =>
          (m.mailsjablonen ?? []).map((s) => ({
            sleutel: s.sleutel,
            naam: s.naam,
            omschrijving: s.omschrijving,
            module: m.naam,
            velden: s.velden.map(({ naam, omschrijving }) => ({ naam, omschrijving })),
            standaard: s.standaard,
            aangepast: aangepast.get(s.sleutel) ?? null,
          })),
        );
      },
    },
    {
      methode: 'PATCH',
      pad: '/mailsjablonen/:sleutel:woord',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      async handler(ctx) {
        const { def } = zoek(ctx.modules, ctx.params.sleutel);
        const { onderwerp, tekst } = leesSjabloon(await ctx.leesJson(32 * 1024), def);
        await ctx.env.DB.batch([
          ctx.env.DB.prepare(
            `insert into mailsjablonen (sleutel, onderwerp, tekst, gewijzigd_door) values (?1, ?2, ?3, ?4)
             on conflict (sleutel) do update set onderwerp = ?2, tekst = ?3, gewijzigd_door = ?4, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          ).bind(def.sleutel, onderwerp, tekst, ctx.gebruiker.gebruikerId),
          audit(ctx.env, ctx.gebruiker, 'mailsjablonen', def.sleutel, 'WIJZIG', undefined, ctx.ip),
        ]);
        return { ok: true };
      },
    },
    {
      // Standaardtekst terugzetten.
      methode: 'DELETE',
      pad: '/mailsjablonen/:sleutel:woord',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      async handler({ env, gebruiker, params, ip, modules }) {
        const { def } = zoek(modules, params.sleutel);
        await env.DB.batch([
          env.DB.prepare(`delete from mailsjablonen where sleutel = ?`).bind(def.sleutel),
          audit(env, gebruiker, 'mailsjablonen', def.sleutel, 'STANDAARD', undefined, ip),
        ]);
        return { ok: true };
      },
    },
    {
      // Voorbeeld met verzonnen waarden, zonder te bewaren. Zonder tekst: de huidige (aangepaste of standaard) tekst.
      methode: 'POST',
      pad: '/mailsjablonen/:sleutel:woord/voorbeeld',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      async handler(ctx) {
        const { def } = zoek(ctx.modules, ctx.params.sleutel);
        const body = await ctx.leesJson(32 * 1024);
        const huidig = (await aangepastSjabloon(ctx.env, def.sleutel)) ?? def.standaard;
        const onderwerp = typeof body?.onderwerp === 'string' ? body.onderwerp : huidig.onderwerp;
        const tekst = typeof body?.tekst === 'string' ? body.tekst : huidig.tekst;
        const velden = voorbeeldVelden(def);
        const html = verpakMail(maakHtml(tekst, velden), {
          opmaak: await leesOpmaak(ctx.env), organisatie: installatie(ctx.env).organisatie, basisUrl: ctx.env.PUBLIC_APP_URL, reden: maakOnderwerp(def.reden, velden),
        });
        return {
          onderwerp: maakOnderwerp(onderwerp, velden),
          html,
          fouten: { onderwerp: controleerSjabloon(onderwerp, def), tekst: controleerSjabloon(tekst, def) },
        };
      },
    },
    {
      // Testmail naar jezelf met verzonnen waarden (de tekst uit de editor, ook als die nog niet bewaard is).
      methode: 'POST',
      pad: '/mailsjablonen/:sleutel:woord/test',
      toegang: 'beheer',
      recht: 'mailsjablonen.beheren',
      async handler(ctx) {
        const { def } = zoek(ctx.modules, ctx.params.sleutel);
        const { onderwerp, tekst } = leesSjabloon(await ctx.leesJson(32 * 1024), def);
        const velden = voorbeeldVelden(def);
        try {
          await verstuur(ctx.env, {
            aan: ctx.gebruiker.email, type: 'test', reden: maakOnderwerp(def.reden, velden),
            onderwerp: `[Test] ${maakOnderwerp(onderwerp, velden)}`, html: maakHtml(tekst, velden),
          });
          return json({ ok: true, aan: ctx.gebruiker.email });
        } catch (e) {
          return json({ ok: false, fout: String(e instanceof Error ? e.message : e).slice(0, 200) });
        }
      },
    },
  ],

  fouten: {
    SJABLOON_NIET_GEVONDEN: [404, 'Deze mailtekst bestaat niet (of de module ervan staat uit).'],
  },
});
