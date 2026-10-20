# Stappenplan: de eerste keer live

De livegang verloopt in twee fasen.

- **Fase 1 (stap 1–11): technisch online.** Het formulier draait op `*.pages.dev` en de API op `*.workers.dev`. Je kan alles testen, maar ouders nog niet uitnodigen: er gaan nog geen mails uit en het beheer (export) is nog dicht.
- **Fase 2 (stap 12–17): klaar voor ouders.** Eigen domein, aanmelden voor medewerkers, mail, rate limiting, back-up en de afspraken met de DPO.

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
    ├── frontend/   ──────────────►  Cloudflare Pages   "inschrijvingsplatform"
    └── tools/                           (niet gekoppeld)
```

| Cloudflare-project | Koppelen aan map (root directory) | Instellingen staan in |
| --- | --- | --- |
| Worker `inschrijvingsplatform-api` | `inschrijvingsplatform/backend` | `backend/wrangler.toml` + secrets |
| Pages `inschrijvingsplatform` | `inschrijvingsplatform/frontend` | dashboard (omgevingsvariabelen) |

Pages heeft geen `wrangler.toml` nodig. `public/_redirects` en `public/_headers` worden automatisch meegenomen.

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

## 9. Frontend koppelen aan Cloudflare Pages

Ga naar *Workers & Pages → Create → Pages → Connect to Git* en vul in:

| Instelling | Waarde |
| --- | --- |
| Project name | `inschrijvingsplatform` (bepaalt de URL `inschrijvingsplatform.pages.dev`) |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | `inschrijvingsplatform/frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Build watch paths (include) | `inschrijvingsplatform/frontend/*` |

Stel bij *Environment variables* (Production) deze variabelen in:

| Variabele | Waarde |
| --- | --- |
| `VITE_API_URL` | de Worker-URL uit stap 7, zonder `/` op het einde |
| `VITE_STANDAARD_EVENEMENT` | `fmg-infodagen-2027` (of de slug van je evenement) |
| `VITE_TURNSTILE_SITEKEY` | leeg laten, invullen in stap 10 |
| `NODE_VERSION` | `22` |

`VITE_*`-waarden worden bij het bouwen ingebakken. Na een wijziging moet je opnieuw deployen (*Deployments → Retry deployment*).

Was de naam `inschrijvingsplatform` al bezet, noteer dan de echte `*.pages.dev`-URL voor stap 11.

## 10. Botcontrole (Turnstile)

1. Maak een widget aan via *Turnstile → Add widget*:
   - Hostname: `inschrijvingsplatform.pages.dev`, later ook het eigen domein
   - Mode: *Managed*
2. Zet de **sitekey** in Pages als `VITE_TURNSTILE_SITEKEY` en deploy de frontend opnieuw.
3. Zet het **secret** op de Worker:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

## 11. Worker laten weten waar de frontend staat

1. Pas in `backend/wrangler.toml` deze waarden aan naar de echte Pages-URL:

   ```toml
   ALLOWED_ORIGINS = "https://inschrijvingsplatform.pages.dev"
   PUBLIC_APP_URL  = "https://inschrijvingsplatform.pages.dev"
   ```

2. Commit en push. De Worker deployt vanzelf (stap 8).

### Test fase 1

- [ ] Het formulier opent op `https://inschrijvingsplatform.pages.dev` **zonder** de gele demo-melding.
- [ ] Een volledige testinschrijving lukt en je krijgt een referentie.
- [ ] De beheerlink op de bevestigingspagina werkt, en annuleren ook.
- [ ] Een volzet lesje kan je niet kiezen. Zet de capaciteit desnoods tijdelijk op 1 met `wrangler d1 execute`.
- [ ] *Probleem of idee?* → melding versturen → je krijgt een referentie.
- [ ] Onder *Workers & Pages → inschrijvingsplatform-api → Observability* zie je één logregel per aanvraag, zonder namen of e-mailadressen.
- [ ] In D1 (*Storage & databases → D1 → inschrijvingen-db → Console*) geeft `select naam_enc from deelnemers limit 1` een waarde die begint met `v1.` en geen leesbare naam.

---

# Fase 2 – klaar voor ouders

## 12. Eigen domein

Nodig om twee redenen:

- Cloudflare Access kan enkel `/api/beheer/*` afschermen op een eigen domein.
- WAF-regels (rate limiting) werken niet op `workers.dev` of `pages.dev`.

Het domein moet als zone in dit Cloudflare-account staan. Bekijk met **District09** of dat een subdomein van een bestaand Gents domein wordt (delegatie) of een apart domein.

1. **Frontend:** *Pages → inschrijvingsplatform → Custom domains*, bv. `inschrijven.<domein>`.
2. **API:** zet in `wrangler.toml`:

   ```toml
   routes = [ { pattern = "api.inschrijven.<domein>", custom_domain = true } ]
   ```

3. Werk deze waarden bij naar de nieuwe domeinen:
   - `ALLOWED_ORIGINS` en `PUBLIC_APP_URL` in `wrangler.toml`
   - `VITE_API_URL` in Pages
   - de hostname in de Turnstile-widget

## 13. Beheer afschermen: enkel @onderwijs.gent.be

1. **Entra ID koppelen.** Ga naar *Zero Trust → Integrations → Identity providers → Add → Microsoft Entra ID*. Daarvoor is een app-registratie in Entra ID nodig, aan te vragen bij de tenantbeheerder of District09.
2. **Access-applicatie aanmaken.** Ga naar *Zero Trust → Access controls → Applications → Add → Self-hosted*:
   - Domain: `api.inschrijven.<domein>`, path `api/beheer`
   - Policy: *Allow*, include *Emails ending in* `@onderwijs.gent.be`
   - Login methods: enkel Entra ID
3. Vul in `wrangler.toml` `ACCESS_TEAM_DOMAIN` (*Zero Trust → Settings → Team domain*) en `ACCESS_AUD` (*Application Audience Tag* bij de applicatie) in. Push.
4. **Eerste beheerder** toevoegen:

   ```bash
   npx wrangler d1 execute DB --remote --command "insert into gebruikers (naam, voornaam, email, rol_id) select '<Naam>', '<Voornaam>', '<voornaam.naam>@onderwijs.gent.be', rol_id from rollen where code = 'platformbeheerder'"
   ```

5. **Test.** Open `https://api.inschrijven.<domein>/api/beheer/meldingen`. Je komt eerst bij de Microsoft-aanmelding en daarna zie je de JSON. Een niet-Gents account komt er niet door.

## 14. Bevestigingsmails via Microsoft 365

Zonder deze stap krijgen ouders **geen** mail met hun beheerlink.

1. Maak in Entra ID een app-registratie met de Graph-applicatierechten `Mail.Send` en admin consent.
2. Beperk die rechten met een *Application Access Policy* tot één gedeelde mailbox, bv. `infodag@<school>.be`.
3. Zet in `wrangler.toml` `MAIL_PROVIDER = "graph"`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID` en `GRAPH_SENDER`. Zet eventueel ook `MELDINGEN_MAIL`.
4. Zet het secret:

   ```bash
   npx wrangler secret put GRAPH_CLIENT_SECRET
   ```

5. Test met een eigen inschrijving: komt de mail aan en werkt de link?

## 15. Rate limiting

Maak via *Security → WAF → Rate limiting rules* (op de zone van het eigen domein) twee regels:

- `POST` op `/api/evenementen/*/registraties`: bv. 10 per minuut per IP
- `POST` op `/api/meldingen`: bv. 5 per minuut per IP

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
- [ ] Je weet hoe je een export maakt: `GET https://api.inschrijven.<domein>/api/beheer/evenementen/<evenement_id>/deelnemers.csv`.
- [ ] De link naar het formulier wordt verspreid.

---

## Overzicht: waar staat welke instelling?

| Instelling | Waar | Stap |
| --- | --- | --- |
| `database_id` | `backend/wrangler.toml` | 4 |
| `ENCRYPTION_KEY` | Worker-secret + wachtwoordkluis | 5 |
| `VITE_API_URL`, `VITE_STANDAARD_EVENEMENT`, `NODE_VERSION` | Pages → Settings → Environment variables | 9 |
| `VITE_TURNSTILE_SITEKEY` / `TURNSTILE_SECRET` | Pages / Worker-secret | 10 |
| `ALLOWED_ORIGINS`, `PUBLIC_APP_URL` | `backend/wrangler.toml` | 11, 12 |
| `routes` (eigen domein) | `backend/wrangler.toml` | 12 |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `backend/wrangler.toml` | 13 |
| `MAIL_PROVIDER`, `GRAPH_*`, `MELDINGEN_MAIL` | `backend/wrangler.toml` | 14 |
| `GRAPH_CLIENT_SECRET` | Worker-secret | 14 |

Secrets staan **nooit** in `wrangler.toml` of in Git. Met `npx wrangler secret list` zie je welke er zijn (zonder de waarden).
