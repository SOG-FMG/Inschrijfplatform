# Plan: een modulair platform voor organisaties en evenementen

Status: voorstel, versie 1 (24 oktober 2026). Dit document beschrijft waar het platform naartoe gaat, hoe de kern en de modules in elkaar zitten, en in welke volgorde we bouwen. Het is bedoeld voor wie aan het platform ontwikkelt, ook voor een andere ontwikkelaar die er later een module voor schrijft.

---

## 1. Visie

Vandaag is dit een inschrijvingsplatform voor de infodagen van de Freinetmiddenschool Gent. Het doel is een **platform voor organisaties die evenementen maken**: scholen, cultuurcentra, bedrijven en congresorganisatoren. Het is opgebouwd zoals Odoo of Wix: een stevige **kern** waarop **modules** aan- en uitgezet worden.

Voorbeelden van wat het moet kunnen:

- een infodag met proeflesjes (zoals nu)
- een congres met sessies en sprekers
- één theatervoorstelling met ticketverkoop en twee rangen (vooraan en achteraan)
- een website rond het evenement of de organisatie: agenda, ticketverkoop, programma
- vrijwilligers met hun overeenkomst en shiften
- zalen en hun bezetting
- op termijn: contactbeheer (CRM) en bedrijfsbeheer (ERP)

### Realistisch blijven

Odoo is twintig jaar werk van honderden ontwikkelaars. Wij bouwen **de fundamenten zo dat het kan groeien**, en bouwen een module pas als een echte organisatie ze nodig heeft. Volgorde: kern, dan wat FMG en Cultureel Centrum Meulestede eerst nodig hebben, de rest volgt.

Voor boekhouding en facturatie bouwen we **geen eigen boekhoudpakket**. We koppelen aan een bestaand pakket (export of API).

---

## 2. Installaties (plan B)

- **Eén code, één GitHub-repo.**
- **Per organisatie een eigen installatie** in het Cloudflare-account van Valentijn: eigen frontend-Worker, API-Worker, D1-database, R2-bucket, geheimen en (liefst) eigen domein. De gegevens van organisaties zijn dus volledig gescheiden.
- Per installatie leggen we vast: naam van de organisatie, aanmeldmethode, toegelaten e-maildomeinen, talen, welke modules aan staan. Instellingen die de beveiliging raken (aanmelddomeinen, modules) staan in de configuratie van de installatie (`wrangler.toml`) en niet in het dashboard. Zo kan een overgenomen beheerdersaccount ze niet wijzigen.
- **GDPR**: Valentijn is verwerker voor elke organisatie (verwerkersovereenkomst per organisatie), Cloudflare is subverwerker (DPA in de map `GDPR`).
- **Overschakelen naar plan A** (een organisatie neemt de code over) blijft mogelijk: alles wat per organisatie verschilt, staat in configuratie en niet in code.

### Updates

- Eén script deployt alle installaties na elkaar: eerst **test**, dan de echte installaties.
- Databasemigraties zijn **altijd achterwaarts compatibel**: eerst toevoegen, pas in een latere versie weghalen.
- Alle migraties draaien op alle installaties, ook van modules die er uit staan. De tabellen zijn dan leeg. Dat houdt alle databases gelijk en maakt aanzetten later eenvoudig.

---

## 3. Kern en modules

### 3.1 De kern

De kern bevat wat elke installatie nodig heeft, en niets dat specifiek is voor één soort evenement:

| Onderdeel | Inhoud |
|---|---|
| Installatie | Naam, huisstijl, domein, talen, aanmeldmethode, actieve modules |
| Gebruikers en rechten | Medewerkers, aanmelden (uitnodiging + wachtwoord + authenticator of passkey, later SSO), rollen, rechten |
| Contacten | Personen en organisaties, één keer bewaard, gebruikt door alle modules (basis voor CRM) |
| Privacy | Versleuteling, bewaartermijnen, inzage, export en vergeetrecht over alle modules heen |
| Communicatie | Mails met sjablonen per taal, verzendlog |
| Bestanden | Opslag in R2 (logo's, afbeeldingen, documenten) |
| Talen en woorden | Vertalingen NL, EN, FR; eigen woorden per installatie |
| Dashboard-schil | Menu, navigatie, pagina's van modules |
| Website-schil | Publieke pagina's, navigatie, thema; modules leveren de blokken |
| Logboek en meldingen | Zie `Instructie_Logboek_en_Meldingen.md` |
| Auditlog | Wie deed wat, wanneer |
| Module-register | Laadt de modules, controleert afhankelijkheden, verdeelt routes, rechten en taken |

### 3.2 Modules

| Module | Hangt af van | Inhoud | Wanneer |
|---|---|---|---|
| `evenementen` | kern | Evenement, datums, status, inschrijfperiode, publieke pagina | Bestaat (wordt module) |
| `programma` | evenementen | Dagen, momenten, tijdsblokken, sessies, capaciteit, wachtlijst | Bestaat |
| `onderwijs` | programma | Scholen, leerlingen met ouder als contact, leerjaar, schoolbeheerder, klaslijsten | Bestaat |
| `rapporten` | evenementen | Overzichten, Excel, afdrukken | Bestaat |
| `etiketten` | programma | Naametiketten | Bestaat |
| `tickets` | evenementen | Voorstellingen, rangen met prijs en capaciteit, tarieven, bestelling met meerdere tickets | Meulestede |
| `betalen` | tickets | Online betalen (bv. Mollie, eigen account per organisatie), terugbetalen | Meulestede |
| `checkin` | evenementen | Ticket met QR-code, scannen aan de deur | Meulestede |
| `website` | kern | Pagina's, agenda, blokken van andere modules | Na tickets |
| `zalen` | kern | Zalen, opstellingen, capaciteit, kalender, conflicten, verhuur | Later |
| `vrijwilligers` | kern | Vrijwilligers, beschikbaarheid, shiften, overeenkomst en informatienota | Later |
| `crm` | kern | Interacties, segmenten, nieuwsbrief-toestemming | Later |
| `zaalplan` | tickets | Genummerde stoelen | Als er vraag is |

### 3.3 Het datamodel achter tickets en inschrijvingen

Vandaag schrijft één persoon zich in voor zichzelf (`deelnemers`). Bij tickets koopt één persoon er vier. De kern van evenementen wordt daarom:

```
contact (koper)  →  bestelling  →  tickets  →  (rang, tarief, voorstelling)
                                         →  (sessiekeuzes, via module programma)
```

Een inschrijving voor een infodag of congres is dan een bestelling van één gratis ticket, met de sessiekeuze erbovenop. Zo delen alle soorten evenementen dezelfde capaciteitscontrole, bevestigingsmail, annulatie en check-in. De overgang gebeurt stap voor stap, met een migratie die de bestaande inschrijvingen omzet.

---

## 4. Het modulecontract

Een module is een map met een vaste opbouw en een **manifest**. Een module praat enkel via de **kern-API** met de rest van het platform, nooit rechtstreeks met de interne code van de kern of van een andere module. Zo kan een andere ontwikkelaar een module bouwen zonder de kern te kennen, en kan de kern veranderen zonder modules te breken.

### 4.1 Opbouw van een module

```
modules/tickets/
  module.ts            manifest (zie hieronder)
  api/                 routes en logica (Worker)
  dashboard/           beheerpagina's (React)
  publiek/             publieke pagina's en websiteblokken (React)
  migraties/           SQL, enkel eigen tabellen (prefix tickets_)
  vertalingen/         nl.json, en.json, fr.json
  test/                tests tegen een lokale D1
  README.md            wat de module doet, voor wie, welke instellingen
```

### 4.2 Het manifest

```ts
export default defineModule({
  id: 'tickets',
  naam: { nl: 'Tickets', en: 'Tickets', fr: 'Billets' },
  versie: '1.0.0',
  vereistKern: '^1.0.0',
  afhankelijkVan: ['evenementen'],

  // Rechten die rollen kunnen krijgen; de kern controleert ze vóór elke route.
  rechten: {
    'tickets.verkopen': { omschrijving: 'Tickets verkopen aan de kassa', rollen: ['organisator', 'onthaal'] },
    'tickets.terugbetalen': { omschrijving: 'Een bestelling terugbetalen', rollen: ['organisator'] },
  },

  // Routes. Publiek onder /api, beheer onder /api/beheer (altijd aangemeld). Paden beginnen met de id van de module.
  // Parameters: ':naam' of ':naam:soort' met soort id, uuid, slug, token of woord.
  routes: [
    { methode: 'GET', pad: '/tickets/voorstellingen/:id', toegang: 'publiek', handler: voorstelling },
    { methode: 'POST', pad: '/tickets/bestellingen', toegang: 'publiek', handler: bestel },
    { methode: 'POST', pad: '/tickets/bestellingen/:id:uuid/terugbetalen', toegang: 'beheer', recht: 'tickets.terugbetalen', handler: terugbetalen },
  ],

  // Foutcodes (throw new DbFout('UITVERKOCHT')) met HTTP-status en melding.
  fouten: { UITVERKOCHT: [409, 'Deze rang is uitverkocht.'] },

  // Beheerpagina's en menu-items in het dashboard.
  dashboard: [{ pad: '/tickets', titel: 'tickets.menu', recht: 'tickets.bekijken', pagina: () => import('./dashboard/Overzicht') }],

  // Blokken voor de website-module en publieke pagina's.
  blokken: [{ id: 'ticketverkoop', titel: 'tickets.blok.verkoop', component: () => import('./publiek/Verkoop') }],

  // Instellingen per installatie of per evenement, met hetzelfde veldsysteem als nu (InstellingVeld).
  instellingen: [{ naam: 'max_per_bestelling', type: 'getal', standaard: 10 }],

  // Persoonsgegevens: de kern gebruikt dit voor inzage, export, vergeetrecht en bewaartermijnen.
  persoonsgegevens: { tabellen: ['tickets_bestellingen'], koppeling: 'contact_id', bewaartermijn: 'evenement' },

  // Gebeurtenissen waar de module op reageert of die ze uitstuurt.
  luistert: { 'betalen.betaald': bevestigBestelling },
  stuurt: ['tickets.besteld', 'tickets.geannuleerd'],

  // Dagelijkse taken (opruimen, herinneringen).
  taken: [{ naam: 'vervallen reservaties vrijgeven', uitvoeren: geefVrij }],
});
```

**Wat er al bestaat** (kern 1.0.0, `backend/src/kern/module.ts` en `register.ts`): `id`, `naam`, `versie`, `vereistKern`, `afhankelijkVan`, `rechten`, `routes`, `fouten`, `taken`, en per installatie aan/uit met `MODULES` in `wrangler.toml`. Het register weigert een manifest dat niet klopt (dubbele route, onbekend recht, ontbrekende afhankelijkheid, andere hoofdversie van de kern, tikfout in `MODULES`). De andere onderdelen (`dashboard`, `blokken`, `instellingen`, `persoonsgegevens`, `luistert`/`stuurt`, migraties en vertalingen per module) komen in de volgende stappen. Tot dan staat `naam` als gewone tekst.

### 4.3 Wat de kern aan een module geeft

Elke handler krijgt een context `ctx`. Daarin zit alles wat een module nodig heeft, en niets meer. Nu bestaan: `env` (met `env.DB`), `request`, `params`, `ip`, `waitUntil()`, `leesJson()`, en bij beheerroutes `gebruiker` en `heeftRecht()`. De rest volgt:

| `ctx.…` | Wat |
|---|---|
| `db` | De database (D1), met hulp voor transacties (batch) |
| `gebruiker`, `heeftRecht()` | Wie is aangemeld, wat mag die |
| `contacten` | Contacten opzoeken, aanmaken, koppelen |
| `versleutel()`, `ontsleutel()`, `blindeIndex()` | Persoonsgegevens beveiligen |
| `mail.stuur()` | Mail met sjabloon en taal, met verzendlog |
| `bestanden` | R2-opslag in de eigen map van de module |
| `t()` | Vertalingen, met de eigen woorden van de installatie |
| `audit()` | Regel in het auditlog |
| `gebeurtenis()` | Een gebeurtenis uitsturen naar andere modules |
| `log()` | Gestructureerde logregel met request-id |
| `instelling()` | Waarde van een instelling van de module |

### 4.4 Regels voor modules

1. **Eigen tabellen met prefix** (`tickets_…`). Een module mag tabellen van de kern lezen via de kern-API, en verwijzen naar kern-tabellen (contacten, evenementen). Nooit schrijven in tabellen van een andere module: daarvoor bestaan gebeurtenissen.
2. **Migraties per module**, met een datum in de naam (`20261101_1200_tickets_rangen.sql`). Een bouwstap zet alle migraties van kern en modules in één map, in volgorde.
3. **Persoonsgegevens versleuteld** en aangemeld in het manifest. Geen persoonsgegevens in logs (zie de instructie over het logboek).
4. **Alle teksten via vertalingen**, in de drie talen. Geen vaste Nederlandse tekst in de code.
5. **Rechten in het manifest**, nooit een eigen controle op rolnamen.
6. **Tests** tegen een lokale D1, zoals `backend/test/registratie.test.ts`.
7. **Het contract heeft een versie** (`vereistKern`). Een wijziging die modules breekt, betekent een nieuwe hoofdversie van de kern.

### 4.5 Modules van andere ontwikkelaars

- **Nu**: een module van een andere ontwikkelaar komt als map in de repo of als apart pakket. Valentijn bekijkt de code voor ze in een installatie komt. Op Cloudflare Workers wordt alle code bij het bouwen samengevoegd. Er is dus geen "app-winkel" waar je in een draaiende installatie onbekende code installeert, en dat is bewust: modules raken persoonsgegevens.
- **Later, als er veel externe modules komen**: een module draait als aparte Worker (Cloudflare Workers for Platforms) en krijgt enkel toegang via de kern-API, met beperkte rechten. Dat is pas zinvol als er modules komen die we niet zelf nakijken.

---

## 5. Talen en eigen woorden

- **Teksten van de toepassing**: per module een vertaalbestand per taal (`nl.json`, `en.json`, `fr.json`). Sleutels met de module ervoor: `tickets.knop.bestellen`.
- **Eigen woorden**: in de teksten staan woorden als `{sessie}`, `{deelnemer}`, `{moment}`. Per installatie (en eventueel per evenement) kies je de woorden in de drie talen, bv. FMG: sessie = "lesje", deelnemer = "leerling"; Meulestede: moment = "voorstelling", deelnemer = "bezoeker".
- **Inhoud** (titels, beschrijvingen, privacytekst): per taal ingevuld door de organisator, in een algemene tabel `vertalingen (tabel, id, veld, taal, tekst)` die elke module kan gebruiken. Ontbreekt een vertaling, dan valt het terug op de standaardtaal.
- Eerst de publieke kant in drie talen. Het dashboard blijft voorlopig Nederlands.

---

## 6. Aanmelden

Uitgewerkt in [Beleid_Accounts_en_Aanmelden.md](Beleid_Accounts_en_Aanmelden.md). Kort:

- **Twee niveaus**: operators van het platform (Valentijn + noodaccount, enkel passkey, geen inzage in persoonsgegevens zonder ondersteuningstoegang) en per organisatie de beheerders en medewerkers.
- **Drie soorten accounts per organisatie**: SSO op het domein van de organisatie (verplicht voor dat domein), werkadres zonder SSO (passkey of wachtwoord + authenticator, met een e-mailcontrole om de 6 maanden), privé-adres (idem, plus jaarlijkse goedkeuring door een beheerder met herinneringen).
- Enkel wie uitgenodigd is, komt binnen, ook met SSO.

---

## 7. Website (zoals Wix)

- De website-module beheert pagina's, navigatie en thema (kleuren, lettertype, logo uit de huisstijl).
- Een pagina bestaat uit **blokken**: tekst, afbeelding, agenda, ticketverkoop, programma, sprekers. Modules leveren hun eigen blokken (zie `blokken` in het manifest).
- Publieke pagina's worden **op de server opgebouwd** (in de Worker), zodat ze snel laden en goed gevonden worden door zoekmachines. Het formulier en de ticketverkoop blijven interactief.
- Eerst vaste sjablonen met blokken die je kiest en ordent, nog geen vrije opmaak met slepen zoals Wix. Dat kan later.

---

## 8. Fases

| Fase | Inhoud | Resultaat |
|---|---|---|
| **0. Fundament** | Zie hieronder | FMG werkt zoals nu, op een kern met modules |
| **1. Talen en woorden** | Vertaalsysteem, inhoud per taal, eigen woorden | Publieke kant in NL, EN, FR |
| **2. Aanmelden** | Operatorrol en noodaccount, levenscyclus van accounts, e-mailcontrole, jaarlijkse goedkeuring, SSO (zie het beleid, hoofdstuk 8) | Meulestede kan aanmelden met hun eigen accounts |
| **3. Contacten en bestellingen** | Contacten in de kern; deelnemers worden bestelling + ticket | Eén model voor inschrijven en tickets |
| **4. Tickets** | Voorstellingen, rangen, tarieven, reserveren, betalen aan de kassa | Theater kan verkopen |
| **5. Betalen en check-in** | Online betalen, terugbetalen, QR-ticket, scanner | Volledige ticketverkoop |
| **6. Website** | Pagina's, agenda, blokken | Website rond het evenement |
| **7. Verder** | Zalen, vrijwilligers, CRM, zaalplan, koppeling boekhouding | Volgens vraag |

### Fase 0 in stappen

| Stap | Wat | Status |
|---|---|---|
| 0.1 | Dit plan | Klaar (voorstel) |
| 0.2 | **Installatieprofiel**: naam van de organisatie en aanmelddomeinen in de configuratie in plaats van vast in de code; publieke aanroep `GET /api/installatie` voor de frontend | Klaar |
| 0.3 | **Module-register in de backend**: manifest, `ctx`, routes, rechten, foutcodes, taken, modules aan/uit (`MODULES`). De bestaande routes ingedeeld in `kern`, `evenementen`, `onderwijs`, `rapporten`, `etiketten`, `meldingen`. Nog niet: aanmelden en medewerkers als kernroutes via het register (stap 0.7), `programma` los van `evenementen` (fase 3), de databasecode in de modulemappen (0.5) | Klaar |
| 0.4 | **Module-register in de frontend**: dashboardmenu en pagina's per module, modules aan/uit per installatie (`frontend/src/dashboard/modules.tsx`, actieve modules via `GET /api/installatie`). Nog niet: het publieke formulier (bv. de schoolkiezer van `onderwijs`) houdt nog geen rekening met de modules | Klaar |
| 0.5 | **Repo herindelen**: `kern/`, `modules/`, gedeelde types; migraties per module samengevoegd bij het bouwen | |
| 0.6 | **Meerdere installaties**: omgevingen in `wrangler.toml`, een testinstallatie, één deployscript dat alle installaties bijwerkt en migreert | |
| 0.7 | **Rechten in plaats van rolnamen**: rollen worden sets van rechten uit de manifesten | |

---

## 9. Open vragen

1. Wat heeft Meulestede als eerste nodig, en tegen wanneer?
2. Online betalen meteen, of eerst reserveren en betalen aan de kassa? Welke betaalprovider?
3. Facturen voor bedrijven (congressen)? Via koppeling met welk boekhoudpakket?
4. Rangen met vrije plaatsing, of genummerde stoelen?
5. Welke accounts gebruikt Meulestede (Microsoft 365, Google), en welk domein voor het platform?
6. Krijgt het platform een eigen naam (los van "Inschrijvingsplatform" en van FMG)?
