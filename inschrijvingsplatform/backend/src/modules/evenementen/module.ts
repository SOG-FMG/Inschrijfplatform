import { sha256 } from '../../crypto/versleuteling';
import { anonimiseerEvenement, anonimiseerVerlopenEvenementen, deelnemerslijst, kenSessieToe, koppelBestaandeDeelnemers, schrijfUit, verplaatsDagdeel, zetKomtNiet } from './beheer';
import { meldAf, voorinvulling } from './uitnodigingen';
import { publiekEvenement } from './evenement';
import { bewaarLogo, instellingen, isSoort, kopieerDagdeel, kopieerSessies, maak, verwijder, verwijderLogo, wijzig, zetDoelgroepMomenten, zetLokaalOpCode } from './instellingen';
import { annulatieGegevens, annuleerViaToken, bevestigingOpnieuw, DubbeleInschrijving, mailGegevens, registratieViaToken, registreer, wijzigKeuzesViaToken } from './registratie';
import { checkinUrl, leesVersie } from '../../kern/checkin';
import { basisUrl, qrMailsTeVersturen, stuurEnLog, verstuurQrMails, verwittigNaWijzigingDoorSchool } from './checkin';
import { verstuurHerinneringen } from './herinneringen';
import { AANWEZIGHEID_ROUTES } from './routes-aanwezigheid';
import { INSCHRIJVINGEN_BRON, SESSIEGEVERS_BRON, UITNODIGINGEN_BRON } from './contactbronnen';
import { qrPng } from '../../kern/qr';
import { botcontroleMislukt, controleerTurnstile, csv, json, nietGevonden, nieuwToken, teSnel, teVeelAanvragen } from '../../kern/http';
import { defineModule, type PubliekCtx } from '../../kern/module';
import { type Mail, verstuur } from '../../mail';
import { annulatiemail, bevestigingsmail, overzichtsmail, SJABLONEN, wijzigingsmail } from './mails';
import type { Env } from '../../types';
import { isUuid, ValidatieFout, valideerRegistratie } from '../../validatie';

/**
 * Evenementen: het publieke evenement, inschrijven (met momenten en sessies), het zelfbeheer via de
 * persoonlijke link, en de instellingen in het dashboard. Programma (dagen, momenten, sessies) en
 * inschrijvingen zitten hier nog samen; ze worden gesplitst in fase 3 (bestelling + tickets).
 */

const ids = (x: unknown) => (Array.isArray(x) && x.length >= 1 && x.length <= 200 && x.every((i) => typeof i === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(i)) ? (x as string[]) : null);

export default defineModule({
  id: 'evenementen',
  naam: 'Evenementen en inschrijvingen',
  versie: '1.0.0',
  vereistKern: '^1.0.0',

  rechten: {
    'evenementen.aanmaken': { omschrijving: 'Een nieuw evenement aanmaken', rollen: [] },
    'evenementen.sessiegevers.beheren': { omschrijving: 'Sessiegevers toevoegen, wijzigen en verwijderen', rollen: ['schoolbeheerder', 'organisator'] },
    // Lokalen horen bij de school, niet bij één evenement: één recht in plaats van de koppeling met een evenement.
    'evenementen.locaties.beheren': {
      omschrijving: 'Lokalen beheren (site, blok, verdieping, plaatsen, faciliteiten) — geldt voor de hele school',
      rollen: ['schoolbeheerder', 'organisator'], instelbaar: true,
    },
    // Voor de dag zelf; aan te passen in Medewerkers → Rollen en rechten. Het bereik (welk evenement, welke sessie) blijft apart.
    'evenementen.inchecken': {
      omschrijving: 'Aanwezigheid registreren en ongedaan maken (scannen, balie, in de klas)',
      rollen: ['schoolbeheerder', 'organisator', 'onthaal', 'sessiegever'], instelbaar: true,
    },
    'evenementen.sessie_inzien': {
      omschrijving: 'De deelnemers van een sessie bekijken (sessiegever: enkel de eigen sessies)',
      rollen: ['schoolbeheerder', 'organisator', 'onthaal', 'sessiegever'], instelbaar: true,
    },
    'evenementen.lesje_wijzigen': {
      omschrijving: 'Het lesje van een deelnemer aanpassen, binnen de vrije plaatsen',
      rollen: ['schoolbeheerder', 'organisator', 'onthaal'], instelbaar: true,
    },
    'evenementen.overboeken': { omschrijving: 'Een lesje kiezen dat vol zit (overboeken)', rollen: ['schoolbeheerder', 'organisator', 'onthaal'], instelbaar: true },
    'evenementen.overzicht_aanwezigen': {
      omschrijving: 'Het aanwezigheidsoverzicht van het hele evenement zien',
      rollen: ['schoolbeheerder', 'organisator', 'onthaal'], instelbaar: true,
    },
  },

  routes: [
    ...AANWEZIGHEID_ROUTES,
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
        const checkinToken = nieuwToken();
        let resultaat;
        try {
          resultaat = await registreer(env, params.slug, invoer, await sha256(token), checkinToken);
        } catch (e) {
          if (!(e instanceof DubbeleInschrijving)) throw e;
          // Niets bewaard: we sturen de bevestiging van de bestaande inschrijving opnieuw, naar het adres dat
          // daar al bij hoort. Het antwoord vertelt het formulier wat het in de popup moet zeggen.
          const opnieuw = await bevestigingOpnieuw(env, e.deelnemerId);
          if (opnieuw) {
            const beheerUrl = `${basisUrl(env)}/beheer/${opnieuw.token}`;
            const checkin = { basisUrl: basisUrl(env), ...opnieuw.gegevens.checkin };
            stuurEnLog(env, ctx, e.deelnemerId, bevestigingsmail(opnieuw.gegevens, opnieuw.gegevens.email, opnieuw.gegevens.voornaam, beheerUrl, checkin));
          }
          return json(
            {
              fout: 'DUBBELE_INSCHRIJVING',
              melding: 'Je inschrijving werd niet geregistreerd: je schreef je kind al in.',
              omgewisseld: e.omgewisseld,
              mailVerstuurd: !!opnieuw,
            },
            409,
          );
        }

        const beheerUrl = `${basisUrl(env)}/beheer/${token}`;
        // Een nieuwe inschrijving heeft versie 1 (registreer() zet dat zo).
        const checkin = { basisUrl: basisUrl(env), token: checkinToken, versie: 1 };
        stuurEnLog(env, ctx, resultaat.deelnemerId, bevestigingsmail(resultaat, invoer.deelnemer.email, invoer.deelnemer.voornaam, beheerUrl, checkin));

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
    // QR-code uit de bevestigingsmail (kern/checkin.ts). Enkel voor een bestaande check-intoken: geen open QR-generator.
    // Geen rate limit: mailproxy's (Gmail, Outlook) halen afbeeldingen op vanaf gedeelde IP-adressen.
    {
      methode: 'GET',
      pad: '/checkin/:token:token/qr.png',
      toegang: 'publiek',
      async handler({ env, request, params }) {
        const dn = await env.DB.prepare(`select 1 as ok from deelnemers where checkin_token = ? and geanonimiseerd_op is null`).bind(params.token).first();
        if (!dn) return nietGevonden();
        const versie = leesVersie(new URL(request.url).searchParams.get('v')) ?? 1;
        return new Response(await qrPng(checkinUrl({ basisUrl: basisUrl(env), token: params.token, versie })), {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600', 'Content-Security-Policy': "default-src 'none'" },
        });
      },
    },
    // Uitnodiging (link uit een mail): vooraf ingevuld formulier, of "dit kind komt niet"
    {
      methode: 'GET',
      pad: '/uitnodigingen/:token:token',
      toegang: 'publiek',
      async handler({ env, request, params }) {
        if (await teSnel(env.RL_REGISTRATIE, request)) return teVeelAanvragen();
        return voorinvulling(env, params.token);
      },
    },
    {
      methode: 'POST',
      pad: '/uitnodigingen/:token:token/afmelden',
      toegang: 'publiek',
      async handler({ env, request, params }) {
        if (await teSnel(env.RL_REGISTRATIE, request)) return teVeelAanvragen();
        return meldAf(env, params.token);
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
        const id = gewijzigd ? (await annulatieGegevens(env, hash))?.deelnemerId : null;
        const gegevens = id ? await mailGegevens(env, id) : null;
        if (gegevens && overzicht) {
          const beheerUrl = `${basisUrl(env)}/beheer/${params.token}`;
          const checkin = { basisUrl: basisUrl(env), ...gegevens.checkin };
          stuurEnLog(env, ctx, gegevens.deelnemerId, wijzigingsmail({ ...gegevens, aan: gegevens.email, keuzes: overzicht.keuzes, beheerUrl, checkin }), true);
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
      // De momenten en tijdsblokken van één doelgroep ineens zetten (tabblad Momenten, subtabblad per doelgroep).
      methode: 'PATCH',
      pad: '/instellingen/doelgroep/:id/momenten',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(64 * 1024);
        const lijst = (x: unknown) => (Array.isArray(x) ? (ids(x) ?? []) : []);
        return zetDoelgroepMomenten(ctx.env, ctx.gebruiker, ctx.params.id, lijst(body?.dagdelen), lijst(body?.tijdsblokken), ctx.ip);
      },
    },
    {
      // Vóór /instellingen/:soort, anders zou "lokaal-op-code" als soort gelezen worden.
      methode: 'POST',
      pad: '/instellingen/lokaal-op-code',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(8 * 1024);
        const tekst = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        const evenementId = tekst(body?.evenementId);
        if (!evenementId) throw new ValidatieFout({ algemeen: 'Onbekend evenement.' });
        return zetLokaalOpCode(ctx.env, ctx.gebruiker, evenementId, String(body?.code ?? ''), tekst(body?.locatieId), ctx.ip);
      },
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
        const r = await verplaatsDagdeel(ctx.env, ctx.gebruiker, ctx.params.id, body.van, body.naar, body?.forceer === true);
        if (body?.verwittig !== false) await verwittigNaWijzigingDoorSchool(ctx.env, ctx, ctx.params.id);
        return r;
      },
    },
    {
      // Uitschrijven = annuleren: plaats vrij, wachtlijst schuift door, cijfers en logboek blijven.
      methode: 'POST',
      pad: '/deelnemers/:id:uuid/uitschrijven',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, ip }) => schrijfUit(env, gebruiker, params.id, ip),
    },
    {
      // "Komt niet": blijft ingeschreven, maar krijgt geen herinnering meer.
      methode: 'POST',
      pad: '/deelnemers/:id:uuid/komt-niet',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(1024);
        if (typeof body?.komtNiet !== 'boolean') throw new ValidatieFout({ komtNiet: 'Ongeldige keuze.' });
        return zetKomtNiet(ctx.env, ctx.gebruiker, ctx.params.id, body.komtNiet, ctx.ip);
      },
    },
    {
      methode: 'POST',
      pad: '/deelnemers/:id:uuid/sessie',
      toegang: 'beheer',
      async handler(ctx) {
        const body = await ctx.leesJson(4096);
        if (!isUuid(body?.sessieId)) throw new ValidatieFout({ sessieId: 'Geef een sessie op.' });
        const r = await kenSessieToe(ctx.env, ctx.gebruiker, ctx.params.id, body.sessieId, body?.forceer === true);
        if (body?.verwittig !== false) await verwittigNaWijzigingDoorSchool(ctx.env, ctx, ctx.params.id);
        return r;
      },
    },
    // QR-code mailen aan inschrijvingen van vóór de QR-code (per klik QR_MAILS_PER_KEER)
    {
      methode: 'GET',
      pad: '/evenementen/:id:uuid/qrcode-mails',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params }) => qrMailsTeVersturen(env, gebruiker, params.id),
    },
    {
      methode: 'POST',
      pad: '/evenementen/:id:uuid/qrcode-mails',
      toegang: 'beheer',
      handler: ({ env, gebruiker, params, ip }) => verstuurQrMails(env, gebruiker, params.id, basisUrl(env), ip),
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
    UITNODIGING_ONGELDIG: [404, 'Deze link is ongeldig of verlopen. Je kan je wel gewoon inschrijven via het formulier.'],
    UITNODIGING_GEBRUIKT: [409, 'Met deze link is al ingeschreven. Bekijk of wijzig de inschrijving via de link in je bevestigingsmail.'],
  },

  taken: [
    // De taak logt het aantal verstuurde mails; de rest van het verslag is voor de tests.
    { naam: 'herinneringen versturen', uitvoeren: async (env) => (await verstuurHerinneringen(env)).verstuurd },
    { naam: 'verlopen evenementen anonimiseren', uitvoeren: (env) => anonimiseerVerlopenEvenementen(env) },
    { naam: 'bestaande inschrijvingen aan contacten koppelen', uitvoeren: (env) => koppelBestaandeDeelnemers(env) },
  ],

  persoonsverwijzingen: [{ tabel: 'deelnemers', persoon: 'persoon_id', contact: 'contact_id' }],

  contactBronnen: [SESSIEGEVERS_BRON, INSCHRIJVINGEN_BRON, UITNODIGINGEN_BRON],

  mailsjablonen: SJABLONEN,
});
