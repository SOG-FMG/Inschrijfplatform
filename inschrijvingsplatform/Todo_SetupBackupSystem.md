# TODO: back-upsysteem opzetten

**Status:** gepland, nog niet uitgevoerd.

## Waarom

Tijdens de inschrijvingsperiode komen inschrijvingen binnen die je niet opnieuw kan maken. Gaan ze verloren, dan moet elke ouder opnieuw inschrijven. Oorzaken kunnen zijn:

- een foute migratie
- een vergissing in SQL
- een verwijderde database
- een verloren Cloudflare-account

## Beslissing: geen Supabase als back-up

| Argument | Toelichting |
| --- | --- |
| Extra verwerker | Een tweede extern bedrijf met dezelfde persoonsgegevens. Dat vraagt een extra verwerkersovereenkomst (DPA) en een uitbreiding van de DPIA. |
| Past technisch niet | PostgreSQL versus D1/SQLite. Elke schemawijziging moet dan twee keer, en synchroon blijven. |
| Geen meerwaarde | De persoonsgegevens zijn versleuteld. Zonder `ENCRYPTION_KEY` is een kopie in Supabase evengoed onleesbaar. |
| Kosten en beheer | Extra sleutels, extra account, extra kosten. |

Een SQL-export is draagbaar naar PostgreSQL, SQLite of Azure. Dat volstaat ook als exit-strategie.

## Plan: drie lagen

### 1. D1 Time Travel (ingebouwd)

- [ ] Account op **Workers Paid** zetten. Time Travel bewaart dan 30 dagen, op Free maar 7.
- [ ] Vóór elke migratie het huidige tijdstip noteren:

  ```bash
  npx wrangler d1 time-travel info DB
  ```

- [ ] Terugzetten werkt zo (vervangt de volledige database):

  ```bash
  npx wrangler d1 time-travel restore DB --timestamp=<ISO-tijdstip>
  ```

Dit beschermt tegen een foute migratie, een foute `update` of `delete`, of een bug.

Het beschermt **niet** tegen het verwijderen van de database of het verlies van het account. Daarvoor dient laag 2.

### 2. Dagelijkse export naar een aparte R2-bucket

**Bucket aanmaken**

- [ ] Aparte bucket in de EU aanmaken:

  ```bash
  npx wrangler r2 bucket create inschrijvingen-backup --jurisdiction eu
  ```

- [ ] **Bucket lock** instellen: bestanden 35 dagen onverwijderbaar, zodat ook een beheerder ze niet per ongeluk (of opzettelijk) kan wissen.
- [ ] **Lifecycle-regel** instellen: bestanden ouder dan 35 dagen automatisch verwijderen.

> **Waarom 35 dagen?** Persoonsgegevens worden 30 dagen na het evenement geanonimiseerd. Ze mogen in back-ups niet veel langer blijven bestaan. Neem de bewaartermijn van back-ups op in de privacytekst.

**Toegang voor de Worker**

- [ ] Een Cloudflare API-token aanmaken, beperkt tot *D1 Edit* voor dit account. Bewaren als secret:

  ```bash
  npx wrangler secret put CF_API_TOKEN
  ```

- [ ] `CF_ACCOUNT_ID` en de binding `BACKUP` (bucket `inschrijvingen-backup`, `jurisdiction = "eu"`) toevoegen aan `wrangler.toml`.

**Export in de Worker**

- [ ] In de bestaande dagelijkse cron (`scheduled` in `src/index.ts`):
  - een export starten via de D1-export-API (`POST /accounts/{id}/d1/database/{db}/export`)
  - wachten tot die klaar is en het SQL-bestand downloaden
  - het bewaren als `d1/<YYYY-MM-DD>.sql.gz` in `BACKUP`
- [ ] Het resultaat loggen (grootte, duur) en bij een fout een mail sturen naar `MELDINGEN_MAIL`.
- [ ] Rekening houden met de export zelf. De database is tijdens de export kort niet beschikbaar; daarom draait die 's nachts. Schermafbeeldingen van meldingen gaan **niet** mee: dat zijn tijdelijke debuggegevens.
- [ ] Test toevoegen in `backend/test/` (export-API gemockt, controle dat het bestand in R2 staat).

### 3. Hersteltest

- [ ] Script `backend/scripts/hersteltest.mjs`. Het:
  - haalt de laatste export uit R2
  - laadt die in een lokale D1 (`wrangler d1 execute DB --local --file …`)
  - telt de evenementen, deelnemers en inschrijvingen
  - ontsleutelt één deelnemer met `ENCRYPTION_KEY` als controle
- [ ] Uitvoeren **vóór elk inschrijvingsseizoen** en na grote schemawijzigingen. Datum en resultaat noteren onderaan dit document.

## Sleutelbeheer (voorwaarde voor elke back-up)

- [ ] `ENCRYPTION_KEY` bewaren in de wachtwoordkluis van de dienst, **apart van de back-ups**.
  - Zonder die sleutel is elke back-up waardeloos.
  - Met de sleutel én een back-up zijn de gegevens leesbaar: nooit samen bewaren.
- [ ] Minstens twee personen hebben toegang tot de kluis.

## Optioneel, af te stemmen met District09

- [ ] Een extra kopie buiten Cloudflare (bv. in de eigen Microsoft-tenant), tegen verlies van het Cloudflare-account. Aanvaardbaar omdat de gegevens versleuteld zijn, maar het is extra werk. Voor één infodag per jaar nog niet nodig.

## Logboek hersteltests

| Datum | Uitgevoerd door | Export van | Resultaat |
| --- | --- | --- | --- |
| | | | |
