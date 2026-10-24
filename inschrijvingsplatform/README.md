# Inschrijvingsplatform
Kleine aanpaasin

Generiek activiteiten- en inschrijvingsplatform voor Stedelijk Onderwijs Gent. De eerste toepassing zijn de infodagen van de Freinetmiddenschool Gent.

Alles draait op Cloudflare, met data in de EU:

- **backend/** – Cloudflare Worker: publieke API, validatie, botcontrole, bevestigingsmail, beheer, meldingen
  - `src/kern/` – de kern: installatieprofiel, modulecontract (`module.ts`), module-register (`register.ts`), gedeelde HTTP-hulpjes
  - `src/modules/` – de modules (`evenementen`, `onderwijs`, `rapporten`, `etiketten`, `meldingen`); welke actief zijn, staat in `MODULES` in `wrangler.toml`. Zie [Plan_Modulair_Platform.md](Plan_Modulair_Platform.md)
  - `migrations/` – D1-schema (SQLite)
  - `seed/` – voorbeeldevenement en scholenlijst (gegenereerd)
  - `test/` – integratietests tegen een lokale D1
- **frontend/** – inschrijfformulier, zelfbeheerpagina en meldknop (React + Vite, Cloudflare Worker met statische bestanden)
- **tools/genereer_seed.py** – maakt seed- en demodata aan

| Onderdeel | Cloudflare | EU |
| --- | --- | --- |
| Database | D1 | jurisdictie `eu` (afgedwongen, niet enkel een location hint) |
| Schermafbeeldingen bij meldingen | R2 | jurisdictie `eu` |
| Aanmelden medewerkers | E-mail + wachtwoord + authenticator-app (TOTP), of een passkey; hoofdadmin in `wrangler.toml` | enkel `AANMELD_DOMEINEN` (hier `@onderwijs.gent.be`) |
| Persoonsgegevens | AES-256-GCM in de Worker (`*_enc`-kolommen) | sleutel als Worker-secret |
| Logs | Workers Observability | zonder persoonsgegevens |
| Anonimiseren en opruimen | Cron Trigger (dagelijks 03:15 UTC) | |

## Adressen

Vervang `<account>` door de accountnaam in de Worker-URL (bv. `freinetmiddenschool-automatisatie`). Alles staat onder één hostnaam: `https://fmg-inschrijfplatform.<account>.workers.dev`.

| Wat | Adres | Voor wie |
| --- | --- | --- |
| Inschrijfformulier | `/` of `/fmg-infodagen-2027` (de slug van het evenement) | ouders en leerlingen |
| Zelfbeheer van een inschrijving (bekijken, ander lesje kiezen, annuleren) | `/beheer/<persoonlijk-token>` (staat in de bevestiging op het scherm) | de ouder |
| **Beheer (dashboard)** | `/dashboard` | medewerkers |
| Instellingen van een evenement | `/dashboard/evenementen/<id>` (via *Instellingen* op `/dashboard`) | organisatoren en beheerders |
| Rapporten (overzichten, klaslijsten) | `/dashboard/evenementen/<id>/rapporten` (via *Rapporten*) | organisatoren, beheerders, onthaal (lezen) |
| Meldingen ("Probleem of idee?") met logboek en schermafbeelding | `/dashboard/meldingen` (via *Meldingen*) | platformbeheerders |
| **Account activeren** (eerste keer) | `/dashboard/activeren` | nieuwe medewerkers, met hun uitnodigingscode |
| API | `https://inschrijvingsplatform-api.<account>.workers.dev` (de frontend stuurt `/api/*` zelf door) | enkel technisch, niet delen |

## Wie kan gebruikers aanmaken?

Enkel een **platformbeheerder**, onder *Medewerkers* in het dashboard (`/dashboard/medewerkers`). Andere rollen (organisator, onthaal, schoolbeheerder) zien dat deel niet, en de API weigert het ook (403).

- De eerste platformbeheerder is de **hoofdadmin**: het adres in `HOOFDADMIN_EMAIL` (`backend/wrangler.toml`). Die activeert zich één keer met het secret `HOOFDADMIN_SETUP_CODE`.
- Een nieuwe gebruiker moet een adres van `AANMELD_DOMEINEN` hebben (hier `@onderwijs.gent.be`) en krijgt een eenmalige **uitnodigingscode** (7 dagen geldig) die je persoonlijk doorgeeft.
- Een platformbeheerder kan een medewerker **bewerken** (naam, rol, evenementen), de **2FA opnieuw instellen** (wist wachtwoord, authenticator en passkeys; geeft een nieuwe eenmalige code) of **deactiveren**, maar niet zichzelf. De hoofdadmin blijft altijd platformbeheerder.
- Aanmelden: e-mail + **wachtwoord** (minstens 12 tekens) + code uit de authenticator-app. Een passkey (pincode/vingerafdruk) vervangt die drie, want die is op zich al tweestaps. Eigen wachtwoord, authenticator en passkeys beheer je onder *Mijn account*.
- Elke aanmelding en elke wijziging van gebruikers komt in `audit_log`.

## Is alles versleuteld?

Niet alles, en dat is bewust: wat persoonlijk is, wel. Cloudflare versleutelt D1 en R2 bovendien op schijf, en al het verkeer loopt via HTTPS.

| Gegeven | Hoe bewaard |
| --- | --- |
| Naam, voornaam, e-mail, telefoon, ouder/voogd, vrije school, functie en opmerkingen van deelnemers | **Versleuteld** (AES-256-GCM, kolommen `*_enc`) met `ENCRYPTION_KEY`. Weg na anonimisering. |
| Tekst en e-mail van meldingen | **Versleuteld** (`*_enc`) |
| Authenticator-geheim van medewerkers | **Versleuteld** (zelfde sleutel) |
| Persoonlijke beheerlink van een ouder, sessiecookies, uitnodigingscodes | Enkel de **hash** (SHA-256) staat in de database, nooit de waarde zelf |
| Dubbele inschrijving herkennen | Een **blinde index** (HMAC) in plaats van het adres |
| Passkeys | Enkel de **publieke sleutel** (die is niet geheim). De privésleutel verlaat het toestel nooit. |
| `HOOFDADMIN_SETUP_CODE`, `TURNSTILE_SECRET`, `ENCRYPTION_KEY` | Cloudflare-**secrets**, niet uitleesbaar en niet in Git |
| Evenementen, lesjes, scholenlijst, capaciteiten | **Niet versleuteld** (geen persoonsgegevens) |
| IP-adres in `audit_log` en aanmeldregistratie | **Niet versleuteld** (nodig voor controle en misbruikdetectie). Wordt tijdelijk of beperkt bewaard. |

Kwijt je `ENCRYPTION_KEY`, dan zijn alle versleutelde gegevens definitief onleesbaar. Bewaar hem in de wachtwoordkluis (zie stap 5 van het stappenplan).

## Snel proberen (demomodus, zonder backend)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Zonder `VITE_API_URL` draait het formulier volledig in de browser met de infodagstructuur van 2026, verschoven naar de voorbeelddatums van 2027. Er wordt niets verstuurd. Een paar lesjes zijn al (bijna) volzet, zodat je dat gedrag meteen ziet. In de demo kan je via de bevestigingspagina ook de beheerlink openen.

## Hoe het formulier werkt

1. **Gegevens.** Ouder (e-mail, voornaam, optioneel telefoon), leerling, huidige school (zoeken in de officiële lijst of vrij invullen), leerjaar en A-/B-stroom.
2. **Moment.** Dag en dagdeel. Volzette momenten zijn uitgeschakeld.
3. **Keuzes.** Het programma als tijdlijn (onthaal → keuzelesje 1 → rondleiding → keuzelesje 2). Per keuzeblok kies je een lesje, het infomoment of "geen proeflesje".
   - Volzette lesjes zijn niet meer te kiezen.
   - Een lesje dat je al koos in het andere blok wordt uitgeschakeld.
   - Je ziet enkel het aanbod van je eigen stroom.
4. **Controleren.** Samenvatting, opmerkingen, privacyverklaring en verzenden.
5. **Bevestiging.** Je krijgt een referentie en een mail met een persoonlijke link om de inschrijving te bekijken, een ander lesje te kiezen of te annuleren. Bij annulatie of wijziging schuift de wachtlijst automatisch door.

**Ander lesje kiezen via de persoonlijke link.** Zelfde keuzescherm en regels als op het formulier (capaciteit, doelgroep, niet twee keer hetzelfde lesje, verplichte blokken). Enkel blokken die veranderen worden aangepast, in één atomische batch; daarna volgt een mail met het nieuwe overzicht. Kan zolang de inschrijfperiode loopt, *Lesjes kiezen tot* van die dag niet voorbij is en de dag nog niet begonnen is. Een ander moment (dagdeel) kiezen kan niet zelf: daarvoor mailt de ouder naar het *E-mailadres voor vragen* van het evenement (instelling bij *Algemeen*).

De labels passen zich aan het evenement aan: "Kies een *proeflesje*" voor een infodag, "Kies een *sessie*" of "*workshop*" voor een congres. Bij `deelnemer_type = 'volwassene'` (personeel, congres) verdwijnen de oudervelden en wordt naar de functie gevraagd.

## Probleem of idee melden

Op elke pagina staat rechtsonder de knop **Probleem of idee?**. Die opent een venster waarin de gebruiker kiest tussen *Er loopt iets mis* en *Ik heb een wens of idee*, en kort beschrijft wat er gebeurde. Automatisch gaan mee:

- **Schermafbeelding** van de pagina. Ingevulde velden en getoonde namen of e-mailadressen worden onherkenbaar gemaakt. De gebruiker ziet een voorbeeld en kan de afbeelding uitvinken.
- **Pagina** (zonder het geheime token van een beheerlink), **versie** (`package.json` + commit + builddatum), browser, scherm, taal en tijdzone.
- **Logboek**: de laatste 200 regels uit de browser. Dat zijn stappen in het formulier, API-aanroepen met status en request-id, en fouten. Wat iemand invult staat er nooit in.

De gebruiker kan onder *Welke technische gegevens sturen we mee?* precies zien wat er verstuurd wordt.

Meldingen worden versleuteld bewaard in D1, schermafbeeldingen in R2. Na 90 dagen worden ze automatisch verwijderd. Lezen kan enkel een **platformbeheerder**, in het dashboard onder *Meldingen* (`/dashboard/meldingen`: meest voorkomende fouten, logboek, status, kopiëren als tekst) of rechtstreeks via de API. Hoe je hetzelfde principe in een ander project gebruikt: zie [Instructie_Logboek_en_Meldingen.md](Instructie_Logboek_en_Meldingen.md).

- `GET /api/beheer/meldingen`
- `GET /api/beheer/meldingen/<id>/screenshot`
- `PATCH /api/beheer/meldingen/<id>` met `{"status": "afgehandeld"}`

Met `MELDINGEN_MAIL` krijgt een mailbox een seintje bij elke nieuwe melding (zonder de inhoud).

**Een melding koppelen aan de serverlogs.** Elke API-regel in het logboek bevat een request-id (de Cloudflare Ray ID). Zoek dat id op in *Workers & Pages → inschrijvingsplatform-api → Observability*. De Worker schrijft per aanvraag één logregel: methode, pad zonder tokens of id's, status, duur en foutcode. Onverwachte fouten komen er met stack trace bij, nooit met de inhoud van de aanvraag.

## Lokaal met backend

Vereisten: Node 20+.

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars      # bevat een lokale testsleutel
npm run db:lokaal                   # D1-migraties + seed in .wrangler/
npm run dev                         # http://localhost:8787

cd ../frontend
echo "VITE_API_URL=http://localhost:8787" > .env.local
npm run dev
```

Endpoints testen kan met [backend/api.http](backend/api.http) (REST Client).

Om lokaal de beheerroutes te testen zonder aanmelden, zet je `DEV_BEHEER_EMAIL` in `.dev.vars` en voeg je die gebruiker toe:

```bash
npx wrangler d1 execute DB --local --command "insert into gebruikers (naam, voornaam, email, rol_id) select 'Naam', 'Voornaam', 'voornaam.naam@onderwijs.gent.be', rol_id from rollen where code = 'platformbeheerder'"
```

`DEV_BEHEER_EMAIL` werkt enkel op `localhost`.

### Tests

```bash
cd backend
npm test        # migraties + seed in een lokale D1, 52 tests via de volledige Worker
npm run typecheck

cd ../frontend
npm test        # klikt het formulier en het meldvenster door in demomodus (jsdom)
```

De backendtests dekken onder meer:

- inschrijven
- dubbels
- capaciteit en atomiciteit
- **10 gelijktijdige inschrijvingen op 3 plaatsen** (er komen er exact 3 binnen)
- wachtlijst en doorschuiven
- lesje wijzigen via de persoonlijke link
- rapporten, rapportteksten, klaslijsten mailen en kopiëren
- versleuteling in de database
- domeinbeperking en rechten
- CSV-export
- anonimisering
- meldingen en opruimen

### Seed opnieuw genereren

```bash
python -m venv .venv && .venv/Scripts/pip install openpyxl==3.1.5
.venv/Scripts/python -I tools/genereer_seed.py "../Bronnen instructie/Infodagen 2026 (Dag1).xlsx"
```

Enkel het tabblad *Scholen* wordt gelezen. De structuur van de infodag (lesjes, lokalen, capaciteiten) staat in het script zelf. Persoonsgegevens worden niet overgenomen.

## Productie

**Meerdere installaties.** Elke organisatie heeft een eigen installatie (`[env.<naam>]` in `backend/wrangler.toml` en `frontend/wrangler.jsonc`); FMG is de standaard ("productie"). Beheer ze met `installaties.ps1` in de hoofdmap:

- `.\installaties.ps1 nieuw test`, het `database_id` invullen in `wrangler.toml`, `.\installaties.ps1 deploy test`, `.\installaties.ps1 geheimen test`
- `.\installaties.ps1 deploy alle`: migraties en deploy van alle installaties, test eerst, productie als laatste (met bevestiging)

Een push naar `main` deployt productie automatisch (Workers Builds), maar voert geen migraties uit.

**Migraties van modules.** Een module zet haar SQL in `backend/src/modules/<id>/migraties/`. `npm run migraties` kopieert nieuwe bestanden in volgorde naar `migrations/`; `npm test` stopt als je dat vergat.

De eerste livegang staat stap voor stap in [Stappenplan_Livegang.md](Stappenplan_Livegang.md): welke map aan welke Worker gekoppeld wordt, en welke instelling waar staat. De back-up staat in [Todo_SetupBackupSystem.md](Todo_SetupBackupSystem.md).

**Installatieprofiel en domeinbeperking.** Elke installatie (organisatie) heeft in `backend/wrangler.toml` onder `[vars]`:

- `ORGANISATIE_NAAM`: getoond in het dashboard en op het aanmeldscherm
- `AANMELD_DOMEINEN`: de e-maildomeinen van medewerkers, komma-gescheiden (bv. `onderwijs.gent.be` of `meulestede.be, gent.be`). `*` = elk adres, enkel op uitnodiging. **Leeg of ontbrekend = niemand kan aanmelden.**

Voor deze installatie is dat `onderwijs.gent.be`. Enkel die adressen krijgen toegang tot beheer en gegevens, en enkel die krijgen klaslijsten. De Worker controleert dat bij elke aanvraag (`src/kern/installatie.ts`), ook bij het activeren, aanmelden, toevoegen van medewerkers en mailen. De frontend haalt het profiel op via `GET /api/installatie` om de teksten aan te passen. De database van FMG heeft daarnaast nog een CHECK-constraint op `gebruikers.email` voor `@onderwijs.gent.be`; nieuwe installaties hebben die niet (zie de opmerking in `0001_schema.sql`). Zie [Plan_Modulair_Platform.md](Plan_Modulair_Platform.md) voor de opbouw met meerdere installaties en modules.

### Open beslissingen vóór de livegang

Deze punten zijn niet technisch op te lossen. Stem ze af met **District09 en de DPO**:

1. **Hosting buiten de tenant.** Cloudflare is een externe verwerker. Nodig zijn de verwerkersovereenkomst (Cloudflare DPA) en een DPIA, omdat het om minderjarigen gaat.
2. **Privacytekst.** De seed bevat een *concepttekst* die de DPO moet valideren.
3. **Bewaartermijn.** Standaard 30 dagen na de laatste dag. Te bevestigen, ook voor de back-ups.
4. **Mailafzender.** Een app-registratie in Entra ID met `Mail.Send`, beperkt tot één gedeelde mailbox.
5. **Datums van de volgende editie.** In de seed staan 23 januari en 6 maart 2027 als voorbeeld.

## Beheer (voorlopig zonder dashboard)

Alle beheerroutes vragen een aanmelding (authenticator of passkey) en controleren de rechten per evenement:

- `platformbeheerder`: alles
- `schoolbeheerder`: evenementen van de eigen school
- `organisator`: gekoppeld via `evenement_beheerders`
- `onthaal`: enkel lezen

Elke actie komt in `audit_log`.

- **Rechten.** Gebruikers voeg je toe in `/dashboard` (zie *Wie kan gebruikers aanmaken?*). Het koppelen aan evenementen kan daar bij het aanmaken; achteraf kan het nog met een rij in `evenement_beheerders` via `wrangler d1 execute DB --remote --command "…"`.
- **Evenement instellen.** Op `/dashboard` → *Instellingen* bij een evenement (`/dashboard/evenementen/<id>`): algemene gegevens, inschrijfperiode, doelgroepen, dagen, momenten (dagdelen), tijdsblokken en lesjes met lokaal en capaciteit. Wijzigen kan voor platformbeheerders, organisatoren van dat evenement en schoolbeheerders van de school; onthaal kan enkel kijken. Een nieuw evenement maakt een platformbeheerder aan (start als concept). Een onderdeel met inschrijvingen kan je niet verwijderen: zet het op gesloten of geannuleerd.
- **Export.** `GET /api/beheer/evenementen/<id>/deelnemers.csv` levert een ontsleutelde CSV in Excel-formaat. De export zelf wordt gelogd.
- **Rapporten** (`/dashboard/evenementen/<id>/rapporten`), elk af te drukken (één rapport per blad, met onderaan versie, wie afdrukte en wanneer), te exporteren naar Excel (.xlsx, één tabblad per dagdeel/moment/lesje) en als klaslijst te mailen naar de leerkrachten:
  1. *Overzicht per dagdeel*: per keuzeblok de lesjes met lokaal, leerkracht, maximum, ingeschreven, wachtlijst en beschikbaar. Titel, lokaal, leerkracht en maximum zijn hier rechtstreeks aan te passen.
  2. *Inschrijvingen per moment*: elk lesje een kolom, daaronder het aantal en de namen (plus wie geen lesje koos).
  3. *Klaslijst per lesje*: voornaam, achternaam, huidige school en leerjaar, genummerd tot het maximum; wachtlijst apart.

  Titels en kolomkoppen zijn aanklikbaar om te wijzigen; met *Bewaren* worden ze per evenement onthouden (leeg maken = standaardtekst). Het openen van een rapport wordt gelogd (`RAPPORT`).
- **Leerkracht per lesje.** Velden *Leerkracht* en *E-mail leerkracht* bij het lesje. Klaslijsten gaan enkel naar adressen van `AANMELD_DOMEINEN` (ze bevatten namen van leerlingen); elke leerkracht krijgt één mail met al zijn lesjes. In het auditlog staan enkel aantallen.
- **Kopiëren naar andere momenten.** Bij een tijdsblok: *Lesjes kopiëren naar…* (andere keuzeblokken, ook op een andere dag; een lesje met dezelfde code of titel wordt overgeslagen). Bij een moment: *Kopiëren naar andere dag…* (het dagdeel met alle tijdsblokken en lesjes). Inschrijvingen gaan nooit mee.
- **Verplaatsen.**
  - Naar een ander dagdeel: `POST /api/beheer/deelnemers/<id>/dagdeel` met `{"van": "<dagdeel>", "naar": "<dagdeel>"}`.
  - Daarna een sessie toekennen: `POST /api/beheer/deelnemers/<id>/sessie` met `{"sessieId": "<sessie>"}`.
  - Voeg `"forceer": true` toe om de capaciteit te negeren.
- **Anonimiseren.** Dat gebeurt automatisch na `bewaartermijn_dagen`, of manueel met `POST /api/beheer/evenementen/<id>/anonimiseer`.

Persoonsgegevens staan versleuteld in D1. Rechtstreeks met SQL in de database kijken toont dus geen namen of e-mailadressen; daarvoor zijn de beheerroutes er.

## Nog te bouwen

- Beheerdashboard: deelnemerslijst op het scherm, verplaatsen.
- Herinneringsmail en mail bij doorschuiven van de wachtlijst.
- QR-check-in op de dag zelf (fase 2). De velden `aanwezig` en `checkin_datum` bestaan al.
- Officiële lijst van Belgische gemeenten (NIS-codes).
- Sleutelrotatie voor `ENCRYPTION_KEY`. Het formaat (`v1.`) is erop voorzien, de rotatie zelf nog niet.
