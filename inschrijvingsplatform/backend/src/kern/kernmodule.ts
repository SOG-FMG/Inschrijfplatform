import { ruimAanmeldingOp } from '../auth/sessie';
import { ruimContactenOp } from './contacten';
import { contactenlijst } from './contactenlijst';
import { GROEPEN_BRONNEN, haalUitGroep, voegContactenToe } from './contactgroepen';
import { MEDEWERKERS_BRON } from './medewerkersbron';
import { audit } from './audit';
import { testmail, verstuur } from '../mail';
import { json } from './http';
import { rollenEnRechten, zetRecht } from './rollen';
import { defineModule } from './module';

/**
 * De kern als module: altijd actief. Aanmelden, account en medewerkers (src/auth/routes.ts) worden nog
 * rechtstreeks door index.ts behandeld; ze verhuizen naar hier met stap 0.7 (rechten) en fase 2 (aanmelden).
 */
export default defineModule({
  id: 'kern',
  naam: 'Kern',
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  altijdActief: true,

  rechten: {
    'kern.mail.testen': { omschrijving: 'Een testmail naar zichzelf sturen', rollen: [] },
    'kern.gebruikers.beheren': { omschrijving: 'Medewerkers toevoegen, wijzigen en hun 2FA herstellen', rollen: [] },
    'kern.contacten.bekijken': {
      omschrijving: 'De contactenlijst bekijken: medewerkers en lesgevers, en waar ze voorkomen', rollen: ['schoolbeheerder'], instelbaar: true,
    },
    'kern.contacten.toevoegen': {
      omschrijving: 'Contacten toevoegen door adressen te plakken, en uit een groep halen', rollen: ['schoolbeheerder'], instelbaar: true,
    },
    // Ook voor de platformbeheerder standaard uit: de organisatie zet het bewust aan (afspraak met de DPO).
    'kern.contacten.extern': {
      omschrijving: 'In de contactenlijst ook ouders en inschrijvers zien, met hun kinderen (enkel van de eigen evenementen)',
      rollen: [], instelbaar: true, ookPlatformbeheerder: true,
    },
  },

  routes: [
    {
      methode: 'GET',
      pad: '/contacten',
      toegang: 'beheer',
      recht: 'kern.contacten.bekijken',
      handler: ({ env, gebruiker, modules, ip }) => contactenlijst(env, gebruiker, modules, ip),
    },
    {
      methode: 'POST',
      pad: '/contacten/toevoegen',
      toegang: 'beheer',
      recht: 'kern.contacten.toevoegen',
      handler: async (ctx) => voegContactenToe(ctx.env, ctx.gebruiker, await ctx.leesJson(512 * 1024), ctx.ip),
    },
    {
      methode: 'POST',
      pad: '/contacten/uit-groep',
      toegang: 'beheer',
      recht: 'kern.contacten.toevoegen',
      handler: async (ctx) => haalUitGroep(ctx.env, ctx.gebruiker, await ctx.leesJson(1024), ctx.ip),
    },
    // Rechten per rol (Medewerkers → Rollen en rechten); enkel de rechten die een module instelbaar maakt.
    {
      methode: 'GET',
      pad: '/rollen-rechten',
      toegang: 'beheer',
      recht: 'kern.gebruikers.beheren',
      handler: ({ env, modules }) => rollenEnRechten(env, modules),
    },
    {
      methode: 'PATCH',
      pad: '/rollen-rechten',
      toegang: 'beheer',
      recht: 'kern.gebruikers.beheren',
      handler: async (ctx) => zetRecht(ctx.env, ctx.gebruiker, ctx.modules, await ctx.leesJson(1024), ctx.ip),
    },
    {
      // Testmail naar jezelf: controleert de hele keten (Worker → flow → mailbox) zonder een inschrijving te doen.
      methode: 'POST',
      pad: '/mail/test',
      toegang: 'beheer',
      recht: 'kern.mail.testen',
      async handler({ env, gebruiker, ip }) {
        try {
          const status = await verstuur(env, testmail(gebruiker.email));
          await audit(env, gebruiker, 'mail', '*', 'TESTMAIL', { status }, ip).run();
          return json({ ok: true, provider: env.MAIL_PROVIDER ?? 'log', status });
        } catch (e) {
          return json({ ok: false, provider: env.MAIL_PROVIDER ?? 'log', fout: String(e instanceof Error ? e.message : e).slice(0, 200) });
        }
      },
    },
  ],

  fouten: {
    ONGELDIGE_GEGEVENS: [400, 'Controleer de ingevulde gegevens.'],
    NIET_AANGEMELD: [401, 'Meld je aan om verder te gaan.'],
    AANMELDEN_MISLUKT: [401, 'Aanmelden mislukt. Controleer je gegevens en probeer opnieuw.'],
    ONGELDIGE_UITNODIGING: [400, 'Deze uitnodiging is ongeldig of verlopen.'],
    TE_VEEL_POGINGEN: [429, 'Te veel pogingen. Probeer het over 15 minuten opnieuw.'],
    GEBRUIKER_BESTAAT: [409, 'Er bestaat al een gebruiker met dit e-mailadres.'],
    HUIDIG_WACHTWOORD_FOUT: [400, 'Je huidige wachtwoord klopt niet.'],
    WACHTWOORD_INSTELLEN: [403, 'Stel eerst een wachtwoord in voor je account.'],
    GEEN_TOEGANG: [403, 'Je hebt geen toegang tot deze gegevens.'],
  },

  contactBronnen: [MEDEWERKERS_BRON, ...GROEPEN_BRONNEN],
  persoonsverwijzingen: [{ tabel: 'contact_groepen', contact: 'contact_id' }],

  // Volgorde: eerst de taken van de modules (bv. anonimiseren), daarna pas wat nergens meer gebruikt wordt opruimen.
  taken: [
    { naam: 'verlopen sessies en aanmeldpogingen opruimen', uitvoeren: (env) => ruimAanmeldingOp(env) },
    { naam: 'ongebruikte contacten en personen verwijderen', uitvoeren: (env, { modules }) => ruimContactenOp(env, modules) },
  ],
});
