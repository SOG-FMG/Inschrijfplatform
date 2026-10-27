# Stappenplan: de eerste keer live

De livegang verloopt in twee fasen.

- **Fase 1 (stap 1–11): technisch online.** Het formulier en de API draaien op `*.workers.dev`. Je kan alles testen, maar ouders nog niet uitnodigen: het beheer (export) is nog dicht.
- **Fase 2 (stap 12–17): klaar voor ouders.** Aanmelden voor medewerkers, mails, rate limiting, back-up en de afspraken met de DPO. Een eigen domein is **niet nodig** (stap 12).

Commando's werken in de terminal van VS Code (PowerShell of Git Bash).

---

## Hoe de repository gekoppeld wordt

De Git-repository (`SOG-FMG/Inschrijfplatform`) begint één map hoger dan `inschrijvingsplatform/`:

```text
VSC_Inschrijfformulier/                 ← root van de repository
├── .gitignore                          ← houdt 'Bronnen instructie/' (persoonsgegevens!) buiten Git
├── README.md
├── Bronnen instructie/                 ← NOOIT committen
└── inschrijvingsplatform/
    ├── backend/    ──────────────►  Cloudflare Worker  "inschrijvingsplatform-api"
    │   └── wrangler.toml                (alle Worker-instellingen)
    ├── frontend/   ──────────────►  Cloudflare Worker  "event" (statische bestanden + doorsturen van /api/*)
    └── tools/                           (niet gekoppeld)
```

| Cloudflare-project | Koppelen aan map (root directory) | Instellingen staan in |
| --- | --- | --- |
| Worker `inschrijvingsplatform-api` | `inschrijvingsplatform/backend` | `backend/wrangler.toml` + secrets |
| Worker `event` | `inschrijvingsplatform/frontend` | `frontend/wrangler.jsonc` + build-variabelen in het dashboard |

De frontend-Worker stuurt `/api/*` via een *service binding* door naar `inschrijvingsplatform-api`. Zo staan formulier en API onder één hostnaam (nodig voor veilige sessiecookies en passkeys), zonder eigen domein. `public/_headers` wordt automatisch meegenomen; de SPA-fallback staat in `wrangler.jsonc`.

---

# Fase 1 – technisch online

## 1. Repository klaarzetten

1. Controleer dat er geen persoonsgegevens meegaan. De lijst mag geen `.xlsx`, `.docx`, `.dev.vars` of `Bronnen instructie` bevatten:

   ```bash
   git status --untracked-files=all
   ```

2. Commit en push:

   ```bash
   git add .
   git commit -m "Inschrijvingsplatform op Cloudflare (D1, R2, Workers, Pages)"
   git push
   ```

## 2. Cloudflare-account voorbereiden

- [ ] **Abonnement Workers Paid** (± 5 USD/maand), via *Workers & Pages → Plans*. Nodig voor 30 dagen Time Travel (back-up) en ruimere limieten.
- [ ] **Accountleden.** Via *Manage account → Members* enkel `@onderwijs.gent.be`-accounts, allemaal met tweestapsverificatie. Wie toegang heeft tot het account, kan aan de database.
- [ ] **Account ID** noteren. Het staat rechts op de overzichtspagina van *Workers & Pages*.

## 3. Lokaal aanmelden bij Cloudflare

```bash
cd inschrijvingsplatform/backend
npm install
npx wrangler login                  # opent de browser
npx wrangler whoami                 # controleer: juiste account?
```

## 4. Database en opslag aanmaken (EU)

```bash
npx wrangler d1 create inschrijvingen-db --jurisdiction eu
npx wrangler r2 bucket create inschrijvingen-bestanden --jurisdiction eu
```

Het eerste commando toont een `database_id`. Zet die in `backend/wrangler.toml`:

```toml
[[d1_databases]]
database_id = "<het id uit de uitvoer>"
```

## 5. Encryptiesleutel aanmaken en bewaren

1. Genereer een sleutel:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Bewaar hem eerst in de wachtwoordkluis van de dienst**, met minstens twee personen die er toegang toe hebben. Zonder deze sleutel zijn alle persoonsgegevens definitief onleesbaar.

3. Zet hem daarna als secret op de Worker (plakken wanneer erom gevraagd wordt):

   ```bash
   cd inschrijvingsplatform\backend
   npx wrangler secret put ENCRYPTION_KEY

   ```

   Bestaat de Worker nog niet, dan maakt Wrangler hem aan.

Gebruik nooit de testsleutel uit `.dev.vars.example`.

## 6. Database vullen

1. **Datums van de editie aanpassen** in `tools/genereer_seed.py`: `DAGEN`, de inschrijvingsdeadline (`2027-03-04T23:59…`) en de keuzedeadlines. Daarna de seed opnieuw genereren (zie README, *Seed opnieuw genereren*).

2. Schema en gegevens laden:

   ```bash
   npx wrangler d1 migrations apply DB --remote
   npx wrangler d1 execute DB --remote --file seed/seed.sql           # rollen, soorten, voorbeeldevenement
   npx wrangler d1 execute DB --remote --file seed/seed_scholen.sql   # officiële scholenlijst
   ```

Het voorbeeldevenement staat meteen op *gepubliceerd*. Dat is handig om te testen. Testinschrijvingen wis je in stap 17.

## 7. Worker voor het eerst deployen

```bash
npx wrangler deploy
```

De uitvoer toont de URL, bv. `https://inschrijvingsplatform-api.<account>.workers.dev`. Test die in de browser:

- `…/api/evenementen/fmg-infodagen-2027` → JSON met het evenement
- `…/api/scholen` → lijst met scholen
- `…/api/beheer/meldingen` → `401` (correct: beheer is nog dicht)

## 8. Worker koppelen aan GitHub (automatisch deployen)

Ga naar *Workers & Pages → inschrijvingsplatform-api → Settings → Builds → Connect* en vul in:

| Instelling | Waarde |
| --- | --- |
| Repository | `SOG-FMG/Inschrijfplatform` |
| Production branch | `main` |
| Root directory | `inschrijvingsplatform/backend` |
| Build command | `npm ci` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths (include) | `inschrijvingsplatform/backend/*` |

Vanaf nu deployt elke push naar `main` die de backend wijzigt automatisch.

**Databasemigraties gebeuren bewust niet automatisch.** Voer ze manueel uit met `npx wrangler d1 migrations apply DB --remote`, en noteer vooraf het tijdstip voor Time Travel (zie `Todo_SetupBackupSystem.md`).

## 9. Frontend koppelen aan Cloudflare (Worker met statische bestanden)

Ga naar *Workers & Pages → Create → Import a repository* en vul in:

| Instelling | Waarde |
| --- | --- |
| Project/Worker name | `event` (moet gelijk zijn aan `name` in `frontend/wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | `inschrijvingsplatform/frontend` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths (include) | `inschrijvingsplatform/frontend/*` |

Stel bij *Build → Variables and secrets* deze **build-variabelen** in:

| Variabele | Waarde |
| --- | --- |
| `VITE_API_URL` | `/` (de frontend stuurt `/api/*` zelf door naar de API-Worker) |
| `VITE_STANDAARD_EVENEMENT` | `fmg-infodagen-2027` (of de slug van je evenement) |
| `VITE_TURNSTILE_SITEKEY` | leeg laten, invullen in stap 10 |
| `NODE_VERSION` | `22` |

`VITE_*`-waarden worden bij het bouwen ingebakken. Na een wijziging moet je opnieuw bouwen (*Deployments → Retry*). De API-Worker (stap 7) moet bestaan vóór de eerste deploy van de frontend.

De frontend staat op `https://event.<account>.workers.dev`. Noteer die URL voor stap 10 en 11.

## 10. Botcontrole (Turnstile)

1. Maak een widget aan via *Turnstile → Add widget*:
   - Hostname: `event.<account>.workers.dev` (de **frontend**, niet de API)
   - Mode: *Managed*
2. Zet de **sitekey** (publiek) als build-variabele `VITE_TURNSTILE_SITEKEY` van de frontend en bouw opnieuw.
3. Zet het **secret** (geheim, nooit in een bestand of in Git) op de API-Worker:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

## 11. Worker laten weten waar de frontend staat

1. Pas in `backend/wrangler.toml` deze waarden aan naar de echte URL van de frontend (stap 9):

   ```toml
   ALLOWED_ORIGINS = "https://event.<account>.workers.dev"
   PUBLIC_APP_URL  = "https://event.<account>.workers.dev"
   ```

   `PUBLIC_APP_URL` bepaalt ook de `rpId` en de toegelaten origin van passkeys. Wijzigt de hostnaam later, dan moeten medewerkers hun passkeys opnieuw registreren.

2. Commit en push. De Worker deployt vanzelf (stap 8).

### Test fase 1

- [ ] Het formulier opent op `https://event.<account>.workers.dev` **zonder** de gele demo-melding.
- [ ] Een volledige testinschrijving lukt en je krijgt een referentie.
- [ ] De beheerlink op de bevestigingspagina werkt, en annuleren ook.
- [ ] Een volzet lesje kan je niet kiezen. Zet de capaciteit desnoods tijdelijk op 1 met `wrangler d1 execute`.
- [ ] *Probleem of idee?* → melding versturen → je krijgt een referentie.
- [ ] Onder *Workers & Pages → inschrijvingsplatform-api → Observability* zie je één logregel per aanvraag, zonder namen of e-mailadressen.
- [ ] In D1 (*Storage & databases → D1 → inschrijvingen-db → Console*) geeft `select naam_enc from deelnemers limit 1` een waarde die begint met `v1.` en geen leesbare naam.

---

# Fase 2 – klaar voor ouders

## 12. Eigen domein (niet nodig)

Een eigen domein is niet vereist. Het aanmelden van medewerkers (stap 13) en de rate limiting (stap 15) werken volledig op `workers.dev`. Krijg je later toch een domein, dan koppel je het aan de frontend-Worker (*Settings → Domains & Routes*) en pas je `ALLOWED_ORIGINS`, `PUBLIC_APP_URL` en de Turnstile-hostname aan. Passkeys moeten dan opnieuw geregistreerd worden (de authenticator-app blijft werken).

## 13. Beheer afschermen: enkel @onderwijs.gent.be

Medewerkers melden aan met hun `@onderwijs.gent.be`-adres, een **wachtwoord** en een authenticator-app (6-cijferige code), of met een **passkey** (pincode, vingerafdruk of gezichtsherkenning van de laptop, bv. Windows Hello). Er is geen mail nodig. Enkel adressen in de tabel `gebruikers` komen binnen, en de hoofdadmin staat in de configuratie.

1. **Hoofdadmin vastleggen.** Zet in `backend/wrangler.toml`:

   ```toml
   HOOFDADMIN_EMAIL = "voornaam.naam@onderwijs.gent.be"
   ```

2. **Eenmalige setupcode** (16 tekens uit `A–Z` en `2–7`) als secret zetten. Bewaar hem in de wachtwoordkluis:

   ```bash
   cd inschrijvingsplatform\backend
   node -e "const a='ZGRZE84H65YJU8I74V6E95ZR8H48VS8Z';console.log([...require('crypto').randomBytes(16)].map(b=>a[b%32]).join(''))"
   npx wrangler secret put HOOFDADMIN_SETUP_CODE
   ```

3. Commit en push (stap 8 deployt), en voer de nieuwe migratie uit:

   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```

4. **Hoofdadmin activeert zich.** Ga naar `https://event.<account>.workers.dev/dashboard/activeren`, vul het adres en de setupcode in, kies een wachtwoord (minstens 12 tekens), scan de QR-code met een authenticator-app en geef de code in. Je bent nu aangemeld. Voortaan meld je aan op `/dashboard` met e-mail + wachtwoord + code, of met een passkey.
5. **Passkey toevoegen** (aanbevolen): klik op *Passkey toevoegen op dit toestel*. Daarna kan je aanmelden met de pincode of vingerafdruk van dit toestel. Houd liefst twee methodes (passkey en app), zodat je niet buitengesloten raakt.
6. **Andere medewerkers toevoegen** onder *Medewerkers*: naam, adres, rol en (voor organisator en onthaal) de evenementen. Je krijgt een **uitnodigingscode** die je persoonlijk doorgeeft. De medewerker activeert zich zoals in punt 4. De code is 7 dagen geldig en werkt één keer.
7. **Verloren toestel?** Kies bij de medewerker *2FA opnieuw instellen*: wachtwoord, authenticator, passkeys en sessies worden gewist en je krijgt een nieuwe eenmalige code. Is het de hoofdadmin zelf, wis dan zijn gegevens en gebruik de setupcode opnieuw:

   ```bash
   npx wrangler d1 execute DB --remote --command "delete from gebruiker_totp where gebruiker_id = (select gebruiker_id from gebruikers where email = '<hoofdadmin>'); delete from passkeys where gebruiker_id = (select gebruiker_id from gebruikers where email = '<hoofdadmin>');"
   ```

Beveiliging in het kort: sessiecookie `HttpOnly` + `Secure` + `SameSite=Strict` (8 uur, 2 uur inactiviteit), elke code kan maar één keer gebruikt worden, na 5 foute pogingen per adres of 20 per IP-adres volgt 15 minuten blokkade, passkeys vereisen altijd gebruikersverificatie, en alle aanmeldingen komen in het auditlogboek.

## 14. Bevestigingsmails via Power Automate (Teams Workflows)

Zonder deze stap krijgen ouders **geen** mail met hun persoonlijke link (bekijken en annuleren).

De Worker stelt de volledige mail samen en stuurt die naar een webhook van een flow. De flow verstuurt de mail met Outlook vanuit `freinetmiddenschool.automatisatie@onderwijs.gent.be` (of een gedeelde mailbox). Geen SMTP, geen eigen domein, geen premiumlicentie. De mails komen echt van jullie mailbox, dus ze belanden niet in spam.

```text
Formulier → Worker ──JSON──► flow (Teams Workflows) ──► Outlook "Een e-mail verzenden (V2)" ──► ouder
```

### 14a. De flow maken

Werk met het account `freinetmiddenschool.automatisatie@onderwijs.gent.be`. De flow hoort bij de maker: wordt dat account uitgeschakeld, dan stopt de flow.

1. Teams → **Workflows** → *Maken* → sjabloon **"Send webhook alerts to a channel"** (of *"Post to a channel when a webhook request is received"*).
2. Open de workflow om te **bewerken** (in Teams via *Beheren*, of op make.powerautomate.com).
3. **Trigger** *When a Teams webhook request is received*: zet **Who can trigger the flow** op **Anyone**. De Worker is geen Teams-gebruiker.
4. **Verwijder** de stappen die naar een kanaal posten. De inhoud bevat namen en e-mailadressen en hoort niet in een kanaal.
5. Voeg **Data Operation → Parse JSON** toe:
   - *Content*: **Body** van de trigger.
   - *Schema*:

     ```json
     {
       "type": "object",
       "properties": {
         "sleutel":    { "type": "string" },
         "type":       { "type": "string" },
         "referentie": { "type": "string" },
         "aan":        { "type": "string" },
         "onderwerp":  { "type": "string" },
         "html":       { "type": "string" }
       },
       "required": ["sleutel", "aan", "onderwerp", "html"]
     }
     ```

6. Voeg een **Condition** toe: `sleutel` *is equal to* `<de sleutel uit 14b>`.
   - **If yes**: **Office 365 Outlook → Een e-mail verzenden (V2)**
     - *Aan*: `aan`
     - *Onderwerp*: `onderwerp`
     - *Hoofdtekst*: klik op **</>** (codeweergave) en voeg `html` in, zodat de opmaak en de link behouden blijven.
     - Optioneel onder *Geavanceerde parameters*: *Van (Verzenden als)* = een gedeelde mailbox waarop het account "Verzenden als"-rechten heeft. Of gebruik de actie *Een e-mail verzenden vanuit een gedeeld postvak (V2)*.
   - **If no**: niets. Zo kan niemand zonder de sleutel via jullie mailbox mails sturen.
7. **Privacy van de uitvoeringsgeschiedenis**: zet bij de trigger en bij *Parse JSON* onder **Instellingen** → **Secure inputs** en **Secure outputs** aan. Dan staan adressen en links niet leesbaar in de geschiedenis van de flow.
8. **Opslaan** en het **webhook-adres** kopiëren (bij de trigger). Behandel dat adres als een wachtwoord.

### 14b. De Worker koppelen

1. Maak een sleutel (PowerShell). Bewaar ze in de kluis en vul dezelfde waarde in bij de Condition van de flow:

   ```powershell
   $b=[byte[]]::new(24); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[$_ % 58] })
   ```

2. **Test eerst de flow alleen**, zonder het platform. Je krijgt een testmail op je eigen adres:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\inschrijvingsplatform\tools\test-mail-flow.ps1
   ```

3. Zet de twee secrets op de API-Worker:

   ```powershell
   cd inschrijvingsplatform/backend
   npx wrangler secret put MAIL_WEBHOOK_URL
   npx wrangler secret put MAIL_WEBHOOK_SLEUTEL
   ```

4. Zet in `backend/wrangler.toml` `MAIL_PROVIDER = "webhook"`. Commit en push.
5. **Test in het dashboard**: *Medewerkers* → **Testmail naar mezelf sturen**. Doe daarna een echte testinschrijving: komt de bevestiging aan en werkt de link? Annuleer ze via de link: je krijgt een annulatiemail.

### Wat de ouder krijgt

| Wanneer | Mail |
| --- | --- |
| Na het inschrijven | Bevestiging met momenten, gekozen lesjes, referentie en de **persoonlijke link** om te bekijken of te annuleren |
| Na annuleren via de link | Bevestiging van de annulatie, met een link om opnieuw in te schrijven |

De persoonlijke link is een willekeurige code van 256 bit. In de database staat enkel de hash. De link geeft alleen toegang tot die ene inschrijving en vervalt bij de anonimisering.

### Als het misgaat

- Lukt een mail niet, dan probeert de Worker het één keer opnieuw. Daarna wordt het als *mislukt* gelogd, zonder de inhoud. In het dashboard zie je per evenement het aantal **mislukte mails**. De inschrijving zelf lukt altijd, en de ouder ziet de link ook op het scherm.
- Kijk dan in Power Automate → de flow → **Uitvoeringsgeschiedenis** welke stap faalde.
- Grenzen van een gewone Microsoft 365-licentie: enkele duizenden acties per dag. Dat is ruim voldoende voor een infodag (± 3 acties per mail).

> **Andere mogelijkheden** (niet nodig als de flow werkt): Microsoft Graph met een Entra-app (`MAIL_PROVIDER = "graph"`, `GRAPH_*` en het secret `GRAPH_CLIENT_SECRET`), of zonder mails werken via de Excel-export en afdruk samenvoegen in Word.

## 15. Rate limiting

Staat al in `backend/wrangler.toml` (`[[ratelimits]]`) en werkt per IP-adres, zonder eigen domein:

- registreren: 10 per minuut (`RL_REGISTRATIE`)
- meldingen: 5 per minuut (`RL_MELDING`)

Pas `limit` aan als een school met één gedeeld IP-adres (bv. een klas die tegelijk inschrijft) hierdoor geblokkeerd wordt. `period` kan enkel 10 of 60 seconden zijn.

## 16. Back-up

Werk `Todo_SetupBackupSystem.md` af: minstens laag 1 (Workers Paid, Time Travel) en laag 2 (dagelijkse export), en voer één hersteltest uit.

## 17. Laatste controle en openen

- [ ] De open beslissingen uit de README zijn afgerond met District09 en de DPO: DPA, DPIA, privacytekst, bewaartermijn.
- [ ] De gevalideerde privacytekst staat in de database:

  ```bash
  npx wrangler d1 execute DB --remote --command "update evenementen set privacy_tekst = '<tekst>' where slug = 'fmg-infodagen-2027'"
  ```

- [ ] Datums, capaciteiten, lokalen en het contactadres kloppen.
- [ ] **Testgegevens gewist:**

  ```bash
  npx wrangler d1 execute DB --remote --command "delete from audit_log where entiteit = 'deelnemers'; delete from deelnemers; delete from meldingen;"
  ```

  Inschrijvingen en mailberichten verdwijnen mee via de cascade.
- [ ] Je weet hoe je een export maakt: aangemeld op `/dashboard` bij *Evenementen* → *Deelnemerslijst downloaden* (CSV met puntkomma, opent in Excel).
- [ ] De link naar het formulier wordt verspreid.

---

## Overzicht: waar staat welke instelling?

| Instelling | Waar | Stap |
| --- | --- | --- |
| `database_id` | `backend/wrangler.toml` | 4 |
| `ENCRYPTION_KEY` | Worker-secret + wachtwoordkluis | 5 |
| `VITE_API_URL` (= `/`), `VITE_STANDAARD_EVENEMENT`, `NODE_VERSION` | Frontend-Worker → Settings → Build → Variables | 9 |
| `VITE_TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` | Frontend-build-variabele / Worker-secret | 10 |
| `ALLOWED_ORIGINS`, `PUBLIC_APP_URL` | `backend/wrangler.toml` | 11 |
| `HOOFDADMIN_EMAIL` / `HOOFDADMIN_SETUP_CODE` | `backend/wrangler.toml` / Worker-secret | 13 |
| `[[ratelimits]]` | `backend/wrangler.toml` | 15 |
| `MAIL_PROVIDER` (= `webhook`), `MELDINGEN_MAIL` | `backend/wrangler.toml` | 14 |
| `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_SLEUTEL` | Worker-secrets | 14 |

Secrets staan **nooit** in `wrangler.toml` of in Git. Met `npx wrangler secret list` zie je welke er zijn (zonder de waarden).
