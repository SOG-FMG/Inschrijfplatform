import { sha256 } from '../../crypto/versleuteling';
import { anonimiseerEvenement, anonimiseerVerlopenEvenementen, deelnemerslijst, kenSessieToe, verplaatsDagdeel } from './beheer';
import { publiekEvenement } from './evenement';
import { bewaarLogo, instellingen, isSoort, kopieerDagdeel, kopieerSessies, maak, verwijder, verwijderLogo, wijzig } from './instellingen';
import { annulatieGegevens, annuleerViaToken, registratieViaToken, registreer, wijzigKeuzesViaToken } from './registratie';
import { botcontroleMislukt, controleerTurnstile, csv, json, nietGevonden, nieuwToken, teSnel, teVeelAanvragen } from '../../kern/http';
import { defineModule, type PubliekCtx } from '../../kern/module';
import { annulatiemail, bevestigingsmail, type Mail, verstuur, wijzigingsmail } from '../../mail';
import type { Env } from '../../types';
import { isUuid, ValidatieFout, valideerRegistratie } from '../../validatie';

/**
 * Evenementen: het publieke evenement, inschrijven (met momenten en sessies), het zelfbeheer via de
 * persoonlijke link, en de instellingen in het dashboard. Programma (dagen, momenten, sessies) en
 * inschrijvingen zitten hier nog samen; ze worden gesplitst in fase 3 (bestelling + tickets).
 */

/** Verstuurt een mail op de achtergrond en bewaart het resultaat (zonder inhoud) in mail_berichten. */
function stuurEnLog(env: Env, ctx: PubliekCtx, deelnemerId: string, mail: Mail) {
  const log = (status: string, fout?: string) =>
    env.DB.prepare(`insert into mail_berichten (bericht_id, deelnemer_id, type, status, fout) values (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), deelnemerId, mail.type ?? 'bericht', status, fout ?? null)
      .run();
  ctx.waitUntil(
    verstuur(env, mail)
      .then((status) => log(status))
      .catch((e) => log('mislukt', String(e).slice(0, 500))),
  );
}

const basisUrl = (env: Env) => env.PUBLIC_APP_URL.replace(/\/$/, '');
const ids = (x: unknown) => (Array.isArray(x) && x.length >= 1 && x.length <= 200 && x.every((i) => typeof i === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(i)) ? (x as string[]) : null);

export default defineModule({
  id: 'evenementen',
  naam: 'Evenementen en inschrijvingen',
  versie: '1.0.0',
  vereistKern: '^1.0.0',

  routes: [
    // ---- publiek ----
    {
      methode: 'GET',
      pad: '/evenementen/:slug:slug',
      toegang: 'publiek',
      async handler({ env, params }) {
        const ev = await publiekEvenement(env, params.slug);
        return ev ?? json({ fout: 'EVENEMENT_NIET_GEVONDEN', melding: 'Dit evenement bestaat niet of is niet meer beschikbaar.' }, 404);
      },
    },
    {
      methode: 'POST',
      pad: '/evenementen/:slug:slug/registraties',
      toegang: 'publiek',
      async handler(ctx) {
        const { env, request, params } = ctx;
        if (await teSnel(env.RL_REGISTRATIE, request)) return teVeelAanvragen();
        const invoer = valideerRegistratie(await ctx.leesJson(64 * 1024));
        // Honeypot ingevuld → doen alsof het lukte, maar niets bewaren
        if (invoer.website) return json({ referentie: 'OK' }, 201);
        if (!(await controleerTurnstile(env, invoer.turnstileToken, ctx.ip))) return botcontroleMislukt();

        const token = nieuwToken();
        const resultaat = await registreer(env, params.slug, invoer, await sha256(token));

        const beheerUrl = `${basisUrl(env)}/beheer/${token}`;
        stuurEnLog(env, ctx, resultaat.deelnemerId, bevestigingsmail(resultaat, invoer.deelnemer.email, invoer.deelnemer.voornaam, beheerUrl));

        const { deelnemerId: _intern, ...publiek } = resultaat;
        return json({ ...publiek, beheerUrl }, 201);
      },
    },
    {
      methode: 'GET',
      pad: '/logo/:id',
      toegang: 'publiek',
      async handler({ env, params }) {
        const obj = await env.STORAGE.get(`logos/${params.id}`);
        if (!obj) return nietGevonden();
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': 'public, max-age=300',
            'Content-Security-Policy': "default-src 'none'",
          },
        });
      },
    },
    // Zelfbeheer via de persoonlijke link (/beheer/<token> in de frontend)
    {
      methode: 'GET',
      pad: '/registraties/:token:token',
      toegang: 'publiek',
      async handler({ env, params }) {
        const r = await registratieViaToken(env, await sha256(params.token));
        return r ?? json({ fout: 'REGISTRATIE_NIET_GEVONDEN', melding: 'Deze inschrijving werd niet gevonden of is al geannuleerd.' }, 404);
      },
    },
    {
      methode: 'PATCH',
      pad: '/registraties/:token:token',
      toegang: 'publiek',
      async handler(ctx) {
        const { env, request, params } = ctx;
        if (await teSnel(env.RL_REGISTRATIE, request)) return teVeelAanvragen();
        const hash = await sha256(params.token);
        const sessies = (await ctx.leesJson(8 * 1024))?.sessies;
        if (!Array.isArray(sessies) || sessies.length > 30 || !sessies.every((i) => typeof i === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(i))) {
          throw new ValidatieFout({ sessies: 'Ongeldige keuze.' });
        }
        const { gewijzigd } = await wijzigKeuzesViaToken(env, hash, sessies);
        const overzicht = await registratieViaToken(env, hash);
        const gegevens = gewijzigd ? await annulatieGegevens(env, hash) : null;
        if (gegevens?.email && overzicht) {
          const beheerUrl = `${basisUrl(env)}/beheer/${params.token}`;
          stuurEnLog(env, ctx, gegevens.deelnemerId, wijzigingsmail({ ...gegevens, aan: gegevens.email, keuzes: overzicht.keuzes, beheerUrl }));
        }
        return json(overzicht);
      },
    },
    {
      methode: 'DELETE',
      pad: '/registraties/:token:token',
      toegang: 'publiek',
      async handler(ctx) {
        const { env, params } = ctx;
        const hash = await sha256(params.token);
        const gegevens = await annulatieGegevens(env, hash);
        const resultaat = await annuleerViaToken(env, hash);
        if (gegevens?.email) {
          stuurEnLog(env, ctx, gegevens.deelnemerId, annulatiemail({ ...gegevens, aan: gegevens.email, formulierUrl: `${basisUrl(env)}/${gegevens.slug}` }));
        }
        return json(resultaat);
      },
    },

    // ---- beheer: instellingen (zie db/instellingen.ts) ----
    {
      methode: 'GET',
      pad: '/evenementen/:id/instellingen',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params }) => instellingen(env, gebruiker, params.id),
    },
    {
      methode: 'POST',
      pad: '/evenementen/:id/logo',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, request, ip }) => bewaarLogo(env, gebruiker, params.id, request, ip),
    },
    {
      methode: 'DELETE',
      pad: '/evenementen/:id/logo',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, ip }) => verwijderLogo(env, gebruiker, params.id, ip),
    },
    {
      methode: 'POST',
      pad: '/instellingen/:soort:woord',
      toegang: 'beheer',
      async handler(ctx) {
        const { env, gebruiker, params, ip } = ctx;
        if (!isSoort(params.soort)) return nietGevonden();
        const body = await ctx.leesJson(64 * 1024);
        const ouderId = typeof body?.ouderId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(body.ouderId) ? body.ouderId : null;
        return json(await maak(env, gebruiker, params.soort, ouderId, body?.waarden ?? {}, ip), 201);
      },
    },
    {
      methode: 'PATCH',
      pad: '/instellingen/:soort:woord/:id',
      toegang: 'beheer',
      async handler(ctx) {
        const { env, gebruiker, params, ip } = ctx;
        if (!isSoort(params.soort)) return nietGevonden();
        return wijzig(env, gebruiker, params.soort, params.id, (await ctx.leesJson(64 * 1024))?.waarden ?? {}, ip);
      },
    },
    {
      methode: 'DELETE',
      pad: '/instellingen/:soort:woord/:id',
      toegang: 'beheer',
      async handler({ env, gebruiker, params, ip }) {
        if (!isSoort(params.soort)) return nietGevonden();
        return verwijder(env, gebruiker, params.soort, params.id, ip);
      },
    },
    {
      // Lesjes of een heel moment kopiëren naar andere momenten
      methode: 'POST',
      pad: '/kopieer',
      toegang: 'beheer',
      async handler(ctx) {
        const { env, gebruiker, ip } = ctx;
        const body = await ctx.leesJson(64 * 1024);
        const [bron, naar] = [ids(body?.ids), ids(body?.naar)];
        if (!bron || !naar) throw new ValidatieFout({ kopieer: 'Kies wat je wil kopiëren en waarheen.' });
        if (body.soort === 'sessies') return kopieerSessies(env, gebruiker, bron, naar, ip);
        if (body.soort === 'dagdeel' && bron.length === 1) return kopieerDagdeel(env, gebruiker, bron[0], naar, ip);
        throw new ValidatieFout({ kopieer: 'Onbekende soort.' });
      },
    },

    // ---- beheer: deelnemers ----
    {
      methode: 'GET',
      pad: '/evenementen/:id:uuid/deelnemers.csv',
      toegang: 'beheer',
      async handler({ env, gebruiker, params, ip }) {
        const rijen = await deelnemerslijst(env, gebruiker, params.id, ip);
        const kolommen = ['referentie', 'ingeschreven_op', 'doelgroep', 'voornaam', 'naam', 'email', 'contact_voornaam', 'contact_naam',
          'telefoon', 'school', 'gemeente', 'leerjaar', 'functie', 'momenten', 'keuzes', 'opmerkingen'];
        return csv(rijen, kolommen, `deelnemers-${params.id.slice(0, 8)}.csv`);
      },
    },
    {
      methode: 'POST',
      pad: '/evenementen/:id:uuid/anonimiseer',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params }) => anonimiseerEvenement(env, gebruiker, params.id),
    },
    {
      methode: 'POST',
      pad: '/deelnemers/:id:uuid/dagdeel',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(4096);
        if (!isUuid(body?.van) || !isUuid(body?.naar)) throw new ValidatieFout({ dagdeel: 'Geef van en naar op.' });
        return verplaatsDagdeel(ctx.env, ctx.gebruiker, ctx.params.id, body.van, body.naar, body?.forceer === true);
      },
    },
    {
      methode: 'POST',
      pad: '/deelnemers/:id:uuid/sessie',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(4096);
        if (!isUuid(body?.sessieId)) throw new ValidatieFout({ sessieId: 'Geef een sessie op.' });
        return kenSessieToe(ctx.env, ctx.gebruiker, ctx.params.id, body.sessieId, body?.forceer === true);
      },
    },
  ],

  fouten: {
    EVENEMENT_NIET_GEVONDEN: [404, 'Dit evenement bestaat niet of is niet meer beschikbaar.'],
    INSCHRIJVING_GESLOTEN: [409, 'De inschrijvingen zijn afgesloten.'],
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
    NIET_MEER_WIJZIGBAAR: [409, 'Je keuzes kunnen niet meer gewijzigd worden. Neem contact op met de organisatie.'],
    IN_GEBRUIK: [409, 'Dit onderdeel heeft al inschrijvingen (ook geannuleerde). Zet de status op gesloten of geannuleerd in plaats van te verwijderen.'],
    INSCHRIJVING_NIET_GEVONDEN: [404, 'Deze deelnemer is niet ingeschreven voor dat moment.'],
    EERST_DAGDEEL_VERPLAATSEN: [409, 'Verplaats de deelnemer eerst naar het dagdeel van deze sessie.'],
  },

  taken: [{ naam: 'verlopen evenementen anonimiseren', uitvoeren: anonimiseerVerlopenEvenementen }],
});
