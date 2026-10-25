# Plan: check-in, aanwezigheidsoverzicht en live lijst per lesje

Status: voorstel, versie 3 (25 oktober 2026). Versie 3 verwerkt de antwoorden op de vragen uit versie 1 en 2, onder meer dat sessiegevers apart geregistreerd worden. Het bouwt voort op de QR-code in de bevestigingsmail (`src/kern/checkin.ts`, `src/kern/qr.ts`). Bedoeld voor de eigenaar van het platform en wie meebeslist over de werking op de dag zelf (onthaal, organisatoren).

---

## 1. Wat we willen

Op de dag van het evenement:

1. Het onthaal scant de QR-code uit de mail van de bezoeker met een gewone smartphone. Het scherm kleurt **groen** (alles in orde), **geel** (let op, kijk even na) of **rood** (er klopt iets niet, naar de balie).
2. Het onthaal heeft een **live overzicht** van wie al aanwezig is. Daar kan men ook iemand handmatig aanwezig zetten en het lesje aanpassen, ook als dat lesje vol zit (overboeken).
3. Op elke afgedrukte klaslijst staat een **kleine QR-code**. Die opent de **live tabel van dat lesje** op de smartphone van de leerkracht of workshopgever: wie is op school aangemeld, wie nog niet. De leerkracht duidt aan wie er toch niet in het lesje zit, en wie er wel is maar niet langs de balie kwam. Wie niet op de lijst staat, voegt de leerkracht toe door de kleine QR-code op het etiket van de leerling te scannen.
4. Het onthaal ziet in het overzicht hoe iemand is aangemeld: *met QR*, *aan de balie* of *in de klas*.
5. **Onthaalmedewerkers** zijn gewone medewerkers en melden zich aan zoals nu. **Sessiegevers** (leerkrachten, workshopgevers) staan in een **aparte lijst**, niet bij de medewerkers. Zij melden zich aan met hun adres van onderwijs.gent.be en een eenmalige code in de mailbox, en zien enkel hun eigen sessie(s): vooraf, om te zien wie er komt, en op de dag zelf als live tabel met de scanner.
6. De bevestigingsmail gebruikt standaard de banner van het inschrijfformulier.

## 2. Klopt de redenering?

Grotendeels wel. Wat anders is dan verwacht, of wat versie 2 verandert:

| # | Jouw redenering | Wat ik vond | Voorstel |
|---|---|---|---|
| 1 | "In beide gevallen (ouder of school wijzigt) werd een nieuwe mail verstuurd." | **Nog niet zo.** De wijzigingsmail na een wijziging door de ouder bevat geen QR-code. Wijzigt de school iets, dan gaat er helemaal geen mail uit. | Beide mails krijgen een QR-code met het nieuwe versienummer, plus een nieuwe mail "aangepast door de school" (fase 1). |
| 2 | "Detecteer van welke **datum** de QR-code is." | Een datum is niet betrouwbaar (twee wijzigingen kort na elkaar, een wijziging die ongedaan gemaakt wordt). | Een **versienummer** in de QR-code dat bij elke wijziging stijgt, plus de wijzigingsdatum voor de melding "gewijzigd op 14 januari". |
| 3 | "Rechten per rol instelbaar. Hebben we zo'n instelpagina?" | **Nee.** De rechten per rol staan vast in de code (de manifesten van de modules). Een opmerking in de code kondigt instelbare rollen aan, maar die zijn er niet. | Een kleine instelpagina bouwen (fase 2). Zie 6.3. |
| 4 | "Sessiegevers melden zich aan met een code per mail." | Aanmelden met een mailcode **bestaat nog niet**. Het beleid voor accounts laat een mailcode enkel toe als extra controle, niet als enige methode. | Mogelijk voor deze beperkte groep, met voorwaarden. Het beleid krijgt hiervoor een uitzondering (6.3 en 7). Onthaalmedewerkers blijven aanmelden zoals nu. |
| 5 | "We registreren de sessiegevers op voorhand, apart van de medewerkers." | Dat past: zo ziet niet elke medewerker van het onderwijs de namen van leerlingen. Bij elk lesje staat nu enkel een vrij veld voor lesgever en e-mail (dat de klaslijstmail gebruikt), geen echte lijst. | Een eigen lijst **Sessiegevers** in het dashboard, gekoppeld aan hun sessies. Een sessiegever ziet enkel de eigen sessies. |
| 6 | "Rood bij een verkeerde dag." | Klopt, maar er zijn meer gevallen. | De volledige tabel staat in 5. |
| 7 | De leerkracht scant de tabel. | Mijn eerste voorstel (versie 1) was een geheime link per lesje. Met aanmelden voor sessiegevers is dat **niet meer nodig** en het is veiliger: een verloren klaslijst geeft geen toegang. | De QR op de klaslijst verwijst naar `/les/<id>` en vraagt aanmelden. Wie geen toegang heeft, ziet niets. |

## 3. Wat er al is

- **Check-intoken per inschrijving** (los van de beheerlink), QR-code in de bevestigingsmail, `GET /api/checkin/<token>/qr.png` en een uitlegpagina `/checkin/<token>`. Nog niet live; nog niet gecommit.
- Velden `aanwezig` en `checkin_datum` op `inschrijvingen` (nog nergens gebruikt).
- `rapport()` (`src/modules/rapporten/db.ts`) levert al per lesje: lokaal, lesgever, capaciteit, aantal bevestigd en de deelnemerslijst.
- `kenSessieToe` en `verplaatsDagdeel` (`beheer.ts`) wijzigen het lesje of het dagdeel van een deelnemer, met een `forceer`-optie om de capaciteit te negeren. Er is nog geen scherm voor, enkel de API.
- Banners voor alle mails (Dashboard → Mailteksten) en het logo per evenement bestaan allebei, maar zijn niet gekoppeld.
- Bij elk lesje staan vrije velden voor lesgever en e-mail lesgever (gebruikt voor de klaslijstmail), en bij het evenement de tekst en velden van het rapport.
- Het etikettenscherm (module etiketten) heeft instelbare velden, maar nog geen QR-code.

## 4. Fases

Elke fase kan los uitgerold en getest worden.

| Fase | Inhoud | Waarom hier |
|---|---|---|
| **0** | Banner van het formulier als standaard voor alle mails | Klein, onafhankelijk. |
| **1** | Versienummer, QR in de wijzigingsmail, mail bij wijziging door de school, **mail met QR aan bestaande inschrijvingen** | Moet af zijn vóór de QR-mails live gaan. |
| **2** | Rechten per rol instelbaar, lijst Sessiegevers, aanmelden met mailcode, overzicht "Mijn sessies" | Zonder dit kan de scanner niet veilig open. |
| **3** | Scanresultaat met kleuren en aanwezig registreren | Het hart van de dag zelf. |
| **4** | Aanwezigheidsoverzicht voor het onthaal, handmatig aanwezig, lesje aanpassen, overboeken | Bouwt op 2 en 3. |
| **5** | Live tabel per lesje voor leerkrachten, QR op alle rapporten, QR op de etiketten, scanner in de pagina | Bouwt op 2, 3 en 4. |
| *later* | Mail bij doorschuiven van de wachtlijst | Zie 8. |

---

## 5. De kleuren

Op het moment van scannen berekent de server één resultaat. De regels worden van boven naar onder toegepast; de eerste die klopt, wint.

| Kleur | Situatie | Het scherm toont | Actie voor het onthaal |
|---|---|---|---|
| **Rood** | Onbekende, geannuleerde of geanonimiseerde inschrijving | "Geen geldige inschrijving" | Naar de balie |
| **Rood** | De inschrijving is voor **een andere dag** | "Ingeschreven voor zaterdag 23 januari" | Naar de balie; daar zoeken welke lesjes nog kunnen |
| **Geel** | De QR-code komt uit een **oudere mail** (versie lager dan nu) | "Deze mail is oud. De inschrijving werd gewijzigd op …" met de **huidige** lesjes | Controleer de huidige lesjes, bevestig dan |
| **Geel** | Dezelfde dag, maar **ander dagdeel** | "Ingeschreven voor de namiddag" | Onthaal beslist |
| **Geel** | Minstens één lesje staat op de **wachtlijst** | "Lesje X staat op de wachtlijst" | Een ander lesje kiezen of overboeken |
| **Blauw** | **Al eerder aangemeld** | "Al aangemeld om 09:12 via QR" | Niets |
| **Groen** | Alles in orde | Naam, lesjes, "Aangemeld" | Geen; de aanwezigheid is al geregistreerd |

**Groen registreert meteen** bij het scannen, met een knop "Ongedaan maken". Bij geel en rood wordt niets geregistreerd tot het onthaal op "Toch aanmelden" drukt.

Naast de kleur staat altijd een woord en een symbool (✓, !, ✕), voor wie kleuren moeilijk onderscheidt of het scherm in zonlicht moet lezen.

---

## 6. Technisch plan

### 6.1 Fase 0: banner van het formulier voor alle mails

Nu: één globale banner voor alle mails (Dashboard → Mailteksten). Het formulier heeft een eigen logo per evenement.

Voorstel:
- Heeft de mail een evenement, dan geldt in deze volgorde: (1) de globale banner uit Mailteksten, als die is ingesteld; (2) anders het logo van het evenement; (3) anders geen.
- Het logo heeft geen vaste breedte. Het wordt gecentreerd getoond op de huisstijlkleur van het evenement, op maximaal 600 px breed en met de ingestelde logohoogte.
- Mails zonder evenement (testmail, melding aan het team) krijgen enkel de globale banner.
- Aanpassing: `Mail` krijgt een optioneel `evenementId`; `verstuur()` haalt logo en kleuren op en geeft ze aan `verpakMail()`.

### 6.2 Fase 1: versienummer en mails

**Database** (migratie in de module evenementen):
- `deelnemers.checkin_versie integer not null default 1`
- `deelnemers.gewijzigd_op text`, `deelnemers.gewijzigd_door text` (`'ouder'`, `'school'`)
- Een **trigger** op `inschrijvingen` (insert, en update van `status`, `dagdeel_id`, `sessie_id`, `tijdsblok_id`) verhoogt `checkin_versie` en zet `gewijzigd_op`. Zo wordt geen enkel pad vergeten: wijzigen door de ouder, verplaatsen door de school, annuleren, doorschuiven van de wachtlijst. Aanwezig registreren raakt het versienummer niet.

**QR-code:** `https://…/checkin/<token>?v=<versie>`. Het versienummer is geen persoonsgegeven.

**Mails:**
- Bevestiging en wijziging door de ouder: QR-sectie met het huidige versienummer.
- **Nieuw: "wijziging door de school"** als sjabloon in `SJABLONEN` (aanpasbaar in Mailteksten), met het nieuwe overzicht en de QR. Bij het aanpassen door het onthaal een vinkje "Verwittig de ouder per mail" (standaard aan).
- Annulatie: geen QR.

**Bestaande inschrijvingen:** wie zich ingeschreven heeft vóór dit live gaat, heeft geen QR-code in de mail en geen check-intoken. Daarvoor komt een knop in het dashboard: **"QR-code mailen aan bestaande inschrijvingen"**. Die maakt de tokens aan en stuurt één mail per inschrijving met de QR (nieuw sjabloon, aanpasbaar). Het is ook een goed herinneringsmoment een week voor het evenement. Wie toch zonder QR komt, zoekt het onthaal op naam (fase 4).

### 6.3 Fase 2: rechten per rol, sessiegevers en aanmelden met een mailcode

**Rechten instelbaar per rol.** Nu staan de rechten per rol in de code. Nieuw:
- Een tabel `rol_rechten` (rol, recht, toegestaan) die de standaard uit de manifesten overschrijft.
- Een pagina **Dashboard → Medewerkers → Rollen en rechten** (enkel platformbeheerder): een raster met de rechten als rijen en de rollen als kolommen. *Sessiegever* staat erbij als kolom, ook al is het geen medewerker.
- Het raster toont **enkel rechten die in het manifest als instelbaar zijn gemarkeerd.** We beginnen met de nieuwe rechten hieronder; bestaande rechten worden pas instelbaar als daar een reden voor is.
- Het recht zegt *wat* een rol mag, de koppeling aan een evenement (of, voor sessiegevers, aan een sessie) zegt *waar*.

**Nieuwe rechten en de standaard:**

| Recht | Wat | Platformbeheerder | Organisator | Onthaal | Sessiegever |
|---|---|---|---|---|---|
| `evenementen.inchecken` | Aanwezigheid registreren en ongedaan maken | ✓ | ✓ | ✓ | ✓ (enkel eigen sessies) |
| `evenementen.sessie_inzien` | De deelnemers van een sessie bekijken | ✓ | ✓ | ✓ | ✓ (enkel eigen sessies) |
| `evenementen.lesje_wijzigen` | Het lesje van een deelnemer aanpassen (binnen de vrije plaatsen) | ✓ | ✓ | ✓ | ✗ |
| `evenementen.overboeken` | Een lesje kiezen dat vol zit | ✓ | ✓ | **✓** | ✗ |
| `evenementen.overzicht_aanwezigen` | Het volledige aanwezigheidsoverzicht van het evenement zien | ✓ | ✓ | ✓ | ✗ |

**Onthaalmedewerkers** zijn gewone medewerkers (rol *onthaal*, gekoppeld aan het evenement) en melden zich aan zoals nu: passkey, of wachtwoord met authenticator-app. De sessie duurt 8 uur met een inactiviteitsgrens van 2 uur; scannen houdt ze actief. Een passkey op de smartphone is op de dag zelf de snelste manier.

**Sessiegevers: een aparte lijst, niet bij de medewerkers.**
- Nieuw scherm **Dashboard → Sessiegevers**, naast Medewerkers. Per sessiegever: naam, e-mailadres en de sessies waaraan die gekoppeld is. Een sessiegever kan meerdere sessies geven (ook in andere evenementen) en een sessie kan meerdere sessiegevers hebben.
- Beheerd door organisatoren, voor de evenementen waaraan ze zelf gekoppeld zijn.
- Een sessiegever is **geen gebruiker** van het dashboard. Het is een eigen soort aanmelding, los van `gebruikers`, zodat een sessiegever nooit per ongeluk meer rechten krijgt.
- **Bestaande gegevens:** de vrije velden "lesgever" en "e-mail lesgever" bij het lesje blijven bestaan (de klaslijstmail gebruikt ze). Een migratie maakt er sessiegevers van op basis van het e-mailadres, zodat je niet alles opnieuw moet invoeren.
- Technisch: tabellen `sessiegevers` (naam, e-mail) en `sessie_sessiegevers` (koppeling). Toegang volgt uit de koppeling: een sessiegever kan precies de sessies openen waaraan die gekoppeld is.
- **Uitnodigen:** de organisator drukt op *Uitnodigen* (per sessiegever of voor allen). De mail (nieuw sjabloon, aanpasbaar in Mailteksten) legt uit wat er kan en bevat de link naar `/sessiegever`.

**Wat een sessiegever kan:**
- **Vooraf** (zodra uitgenodigd): de pagina **Mijn sessies**: per sessie titel, tijd, lokaal, het aantal plaatsen ("6 van 8") en de ingeschreven deelnemers, met de velden die de organisator openzette (zie hierna). Zo weet de sessiegever wie er komt.
- **Op de dag zelf:** dezelfde pagina wordt de **live tabel** met scanner (6.6).
- Niets anders: geen andere sessies, geen dashboard, geen export.

**Welke info ziet een sessiegever? Instelbaar per evenement.**
- **Standaard dezelfde info als op het rapport:** voornaam, naam, school, leerjaar en status (bevestigd of wachtlijst).
- De organisator kan per evenement **extra velden** aanzetten, bv. het e-mailadres van de deelnemer of de contactpersoon, het telefoonnummer, opmerkingen. Die staan standaard **uit**.
- Technisch: een instelling `evenementen.sessiegever_velden` (lijst van velden). De server ontsleutelt enkel de aangezette velden voor de sessiegever. Wat niet openstaat, komt dus ook nooit op de telefoon terecht.
- Bij het aanzetten van een extra veld toont het scherm een waarschuwing over de privacy, en de privacytekst van het formulier moet vermelden dat sessiegevers deze gegevens krijgen (nakijken bij fase 2).

**Aanmelden met een mailcode** (enkel voor sessiegevers):
1. De sessiegever opent `/sessiegever` en vult het e-mailadres in.
2. De server antwoordt altijd hetzelfde ("Is dit adres geregistreerd, dan krijg je een code"), zodat niemand kan nagaan wie in de lijst staat.
3. Is het adres geregistreerd, van onderwijs.gent.be, en gekoppeld aan een sessie van een evenement dat nog niet verlopen is, dan komt er een mail met een code van 6 cijfers: **10 minuten geldig, één keer bruikbaar, maximaal 5 pogingen**, met een beperking per adres en per IP-adres. Opgeslagen als hash.
4. Na de juiste code begint een sessie.

**Hoe lang blijft de aanmelding geldig:** vanaf de uitnodiging tot **5 dagen na de laatste dag van de laatste sessie waaraan de sessiegever gekoppeld is**, zonder inactiviteitsgrens. Zo hoeft men op de dag zelf niet opnieuw aan te melden, en kan men vooraf al kijken.

**Afwijking van het beleid.** Het beleid voor accounts (`Beleid_Accounts_en_Aanmelden.md`) laat een mailcode niet toe als enige methode, omdat wie de mailbox overneemt dan het account overneemt. Hier aanvaarden we dat omdat het om geregistreerde, beperkte toegang gaat die vanzelf verloopt en waarbij alles in het auditlog komt. Dat leggen we in het beleid vast als uitzondering, met die voorwaarden.

**Intrekken:** een organisator kan een sessiegever verwijderen of loskoppelen van een sessie (de toegang is dan meteen weg) en alle sessies van een evenement in één keer afsluiten.

### 6.4 Fase 3: scanresultaat en aanwezig registreren

De camera-app opent `https://…/checkin/<token>?v=3` in de browser. De pagina haalt het resultaat op met de sessie van de medewerker (onthaal of organisator).
- **Aangemeld met een recht voor dit evenement:** het kleurenscherm uit 5.
- **Niet aangemeld** (een ouder die de eigen code scant, of een verlopen sessie): de uitlegpagina, zonder gegevens, met een knop "Aanmelden als medewerker" die na het aanmelden terugkeert naar de scan.

**API (onder `/api/beheer/`):**
- `GET /checkin/<token>?v=` geeft het resultaat: kleur, reden, naam, dag, lesjes met status, en of er al aangemeld is.
- `POST /checkin/<token>` registreert. Eén SQL-update `… where aanwezig = 0`: scannen twee mensen tegelijk, dan lukt er maar één en de ander ziet blauw.
- `DELETE /checkin/<token>` maakt ongedaan.

**Wat wordt opgeslagen** (nieuwe kolommen op `inschrijvingen`):
- `aanmeld_via text` met `'qr'`, `'balie'` of `'klas'`
- `aangemeld_door text` (gebruiker of e-mailadres van de sessiegever)

De dagdeelrijen van de dag van vandaag krijgen `aanwezig = 1`. Alles komt in het auditlog (geen namen, enkel het id van de deelnemer).

### 6.5 Fase 4: aanwezigheidsoverzicht voor het onthaal

Nieuwe pagina in het dashboard: `/dashboard/evenementen/<id>/aanwezigheid`.

- Kop met cijfers: **aanwezig 84 van 132**, per dagdeel.
- Keuze van dag en dagdeel (standaard: vandaag, het huidige dagdeel).
- Lijst met zoekveld op naam: naam, school en leerjaar, lesjes, status **Aanwezig** (groen) of **Nog niet** (rood), en bij aanwezig hoe: *Aangemeld met QR*, *aan de balie* of *in de klas*, met het uur.
- Knop **Aanwezig zetten** (balie) en **Ongedaan maken**. Dit werkt ook voor bezoekers zonder QR-code.
- Knop **Lesje aanpassen**: een venster per tijdsblok met de lesjes:
  - het gekozen lesje is aangeduid
  - **groen** als er nog plaats is, **rood** als het vol is
  - telkens "**6 van 8 plaatsen bezet**", lokaal, lesgever, uur en omschrijving
  - een vol lesje is kiezbaar voor wie het recht `evenementen.overboeken` heeft (het onthaal standaard wel), met een bevestiging "Dit lesje zit vol (8 van 8). Toch overboeken?". Het aantal wordt dan in het rood getoond (bv. **9 van 8**) en het staat in het auditlog.
  - kiezen roept `kenSessieToe` aan, dat een bestaande keuze in hetzelfde tijdsblok vervangt en de wachtlijst laat doorschuiven
- Het overzicht **ververst zichzelf** elke 15 seconden (geen websockets nodig; de belasting is verwaarloosbaar).
- Een kleine QR-code op de pagina opent dezelfde pagina op de smartphone.

### 6.6 Fase 5: live tabel per lesje, rapporten en etiketten

**QR op elke afgedrukte tabel.** Op de klaslijst van elk lesje staat een kleine QR-code naar `https://…/les/<id>`. Die verwijst enkel naar het lesje, geen geheime token. Wie scant, meldt zich aan als sessiegever (de eerste keer met een code per mail, daarna blijft de aanmelding bestaan) of als medewerker. Wie geen toegang tot dat lesje heeft, ziet niets.
- Op de overzichten per dagdeel en per moment staat een QR naar het aanwezigheidsoverzicht van het onthaal.
- De QR-codes worden in de frontend getekend met `qrcode-generator` (staat er al in) en komen in de afdruk en de Excel-export.

**Wat de leerkracht ziet:** de naam van het lesje, tijd en lokaal, en alle ingeschreven deelnemers (voornaam en naam, zoals nu al op de afgedrukte lijst). Per deelnemer één van deze toestanden:

| Toestand | Kleur | Betekenis |
|---|---|---|
| **Nog niet aangemeld** | rood | Niet langs het onthaal (of de klas) geweest |
| **Op school** | groen | Aangemeld aan het onthaal, de leerkracht heeft nog niets aangeduid |
| **In het lesje** | groen met vinkje | De leerkracht heeft bevestigd dat die erbij zit |
| **Niet in het lesje** | oranje | Op school aangemeld, maar de leerkracht duidde aan dat die niet in het lesje zit |

Teller: "9 in het lesje, 2 op school maar niet hier, 1 nog niet aangemeld".

**Wat de leerkracht kan doen** (recht `evenementen.inchecken`, niets anders):
1. Een deelnemer die op de lijst staat maar niet langs de balie kwam, aanduiden als **in het lesje**. Die wordt dan ook op school aangemeld, met `aanmeld_via = 'klas'`. Het onthaal ziet "Aangemeld in de klas".
2. Een deelnemer die op school is maar niet in het lesje zit, aanduiden als **niet in het lesje**.
3. Iemand **toevoegen met de QR-code op het etiket**. Daarvoor opent de leerkracht in de pagina de camera ("Etiket scannen"). Het resultaat:
   - **Staat op de lijst:** de deelnemer wordt meteen als *in het lesje* aangeduid.
   - **Staat niet op de lijst:** het scherm toont de naam en voor welk lesje die ingeschreven is. De leerkracht kan niets wijzigen aan de inschrijving (dat is het recht `evenementen.lesje_wijzigen`, standaard enkel onthaal en organisator) en meldt dat bij het onthaal. Is dat recht voor sessiegevers aangezet in de rollenpagina, dan verschijnt de knop "Toch in dit lesje zetten", die het lesje van de deelnemer wijzigt.

**QR op de etiketten.** Een nieuw veld `{qr}` in de etiketopmaak, met de check-in-link van de deelnemer (dezelfde als in de mail, met het versienummer van het moment van afdrukken). Etiketten voor wie nog geen check-intoken heeft, krijgen geen QR (zie 6.2, bestaande inschrijvingen).

**Scanner in de pagina.** De camera-app van de telefoon is voor de balie prima, maar de leerkracht scant etiketten binnen de pagina. Daarvoor komt een scanner met een camera in de browser (een kleine bibliotheek voor QR-codes; keuze bij het bouwen, bv. `jsQR` of `qr-scanner`). Dezelfde scanner krijgt ook het onthaal, met een knop **Volgende scannen**; dat is handiger bij een rij dan de camera-app, die elke scan in een nieuw tabblad opent.

Het overzicht ververst zichzelf elke 15 seconden, en wijzigingen van de leerkracht zijn zo meteen zichtbaar voor het onthaal.

---

## 7. Privacy en veiligheid

- De QR-code in de mail bevat enkel een willekeurige token en een versienummer. De QR-code op de klaslijst bevat enkel het id van het lesje. De QR-code op het etiket bevat enkel de check-intoken van de deelnemer. Nergens persoonsgegevens.
- Een etiket hangt aan een kind. Wie de code fotografeert, kan alleen "aanwezig" laten registreren, en pas na aanmelden. Een misbruik doet weinig schade en blijft in het auditlog.
- Scanresultaten en de tabel van een lesje tonen naam en lesjes, enkel aan aangemelde medewerkers met een recht voor dat evenement en aan de sessiegevers van dat lesje.
- De aanmelding van een sessiegever is lang geldig (tot 5 dagen na de laatste sessie). Daarom: enkel geregistreerde adressen, enkel de eigen sessies, enkel de velden die de organisator openzette, in te trekken door een organisator, en alles in het auditlog. Verlies je een smartphone, dan verwijdert de organisator de sessiegever of de koppeling.
- De code per mail heeft dezelfde bescherming als elders: 6 cijfers, 10 minuten, 5 pogingen, één keer bruikbaar, beperking per adres en IP-adres, en een antwoord dat niet verraadt of een adres op de lijst staat.
- Het anonimiseren wist ook de check-intoken (al gedaan) en de koppelingen van sessiegevers aan sessies van dat evenement. De lijst met sessiegevers zelf (naam en e-mail) beheert de organisator in het scherm Sessiegevers. De aantallen aanwezigen blijven als statistiek.
- Geen persoonsgegevens in het auditlog: enkel ids en aantallen (zoals nu).
- Het scherm aan de balie toont voornaam en naam, geen e-mail of school.

## 8. Wat later kan

- **Mail bij het doorschuiven van de wachtlijst**, met een nieuwe QR. Tot dan wordt de scan van iemand die doorschoof geel, met de actuele situatie. Dat is correct, maar een mail zou het voorkomen.
- Printen van naamkaartjes bij het aanmelden (er bestaat al een module etiketten).
- Aanmelden van lesgevers zonder adres van onderwijs.gent.be: in deze versie niet ondersteund; het onthaal duidt hun deelnemers aan.

## 9. Vragen voor jou

1. **Sessiegevers zonder adres van onderwijs.gent.be** (bv. een gastspreker met een privéadres): toelaten of niet? Mijn voorstel: **niet**, zoals je zei. Zo'n sessiegever krijgt dan geen toegang en het onthaal duidt zijn deelnemers aan. Een privéadres toelaten kan per sessiegever met een vinkje, maar een privémailbox is minder goed beveiligd.
2. **Extra info voor de sessiegever** (6.3): akkoord dat extra velden, zoals het e-mailadres van de contactpersoon, standaard **uit** staan en dat de organisator ze per evenement aanzet? Over welke velden gaat het jou: enkel het e-mailadres, of ook het telefoonnummer en de opmerkingen?
3. **Leerkracht scant het etiket van iemand die niet op de lijst staat.** Mijn voorstel: de leerkracht ziet in welk lesje die staat, en meldt het bij het onthaal. Een knop "Toch in dit lesje zetten" kan je aanzetten in de rollenpagina. Is dat zo goed, of moet die knop standaard aan?
4. **Overboeken door het onthaal staat standaard aan**, zoals je vroeg. Moet ook de organisator standaard mogen overboeken? Ik heb het zo ingevuld.
5. **Aanmelden met een mailcode** wijkt af van het beleid (6.3). Akkoord met de voorwaarden (geregistreerd, enkel de eigen sessies, vervalt 5 dagen na de laatste sessie, auditlog)?
6. **Bestaande inschrijvingen** hebben geen QR in hun mail. Akkoord met de knop "QR-code mailen aan bestaande inschrijvingen" (6.2), bij voorkeur een week voor het evenement?
7. **Ander dagdeel op dezelfde dag:** geel (zoals voorgesteld) of rood?
8. **Groen:** meteen registreren (zoals voorgesteld) of eerst bevestigen?

## 10. Testplan

**Automatisch (backend):**
- Elke rij van de kleurentabel in 5.
- Het versienummer stijgt bij: inschrijven, wijziging door de ouder, toekennen en verplaatsen door de school, annuleren, doorschuiven van de wachtlijst. Het stijgt **niet** bij aanwezig registreren.
- Twee gelijktijdige scans: maar één registreert.
- Rechten: een sessiegever mag inchecken en inzien voor de eigen sessies, maar het lesje niet wijzigen, niet overboeken en geen andere sessie zien. Onthaal mag overboeken. De rollenpagina wijzigt het gedrag.
- Info voor de sessiegever: standaard enkel de velden van het rapport; een extra veld verschijnt pas nadat de organisator het aanzet, en niet-toegelaten velden komen nooit in het antwoord van de server.
- Mailcode: één keer bruikbaar, verloopt na 10 minuten, gelockt na 5 pogingen, onbekend adres geeft hetzelfde antwoord, de aanmelding verloopt 5 dagen na de laatste sessie, een verwijderde sessiegever of losgekoppelde sessie werkt meteen niet meer.
- De tabel van een lesje: enkel voor de sessiegevers van dat lesje en voor medewerkers van het evenement; de toestanden uit 6.6; een scan van een etiket buiten de lijst wijzigt niets zonder het recht.
- Banner: volgorde uit 6.1. Bestaande-inschrijvingen-mail: maakt tokens aan, stuurt één mail per inschrijving, een tweede keer geen dubbels.

**Visueel:** schermafbeeldingen op een smal scherm van de vijf kleuren, het overzicht, het keuzevenster met overboeken, de leerkrachtpagina en de rollenpagina.

**Op toestellen:** iPhone (Safari) en Android (Chrome) scannen een echte mail en een etiket; de sessie komt mee, de mailcode komt aan, de camera in de pagina werkt, de kleuren zijn leesbaar in zonlicht.

**Generale repetitie:** een testevenement met drie onthaalmedewerkers en twee leerkrachten, vóór de eerste echte infodag.

## 11. Risico's

| Risico | Maatregel |
|---|---|
| Een lange aanmelding op een verloren smartphone | Enkel de eigen sessies, in te trekken, vervalt vanzelf; sessiegever verwijderen |
| Een sessiegever staat niet in de lijst of heeft een ander adres | Het onthaal duidt de deelnemers aan; het scherm Sessiegevers toont per sessie of er iemand gekoppeld is |
| De code per mail komt niet aan (mailfilter, vertraging) | Het onthaal en de leerkrachten krijgen een dag vooraf een proefaanmelding; een organisator kan het adres opnieuw laten uitnodigen |
| Wifi of mobiel bereik in de school valt weg | Overzicht in tweede instantie ook afdrukken (rapport); offline scannen valt buiten dit plan |
| Een QR-code uit een mail van vóór fase 1 zonder versienummer | De QR-mails pas live zetten na fase 1; ontbreekt `v` toch, dan geel |
| Camera in de browser werkt niet op een oud toestel | De klaslijst blijft: namen aanduiden zonder te scannen |
| Kleur alleen is niet leesbaar voor kleurenblinden | Altijd een woord en een symbool naast de kleur |
