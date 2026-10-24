# Instructie: logboek en meldingen ("Probleem of idee?")

Dit document beschrijft hoe het inschrijvingsplatform fouten opspoort zonder persoonsgegevens te verzamelen, zodat je hetzelfde principe in andere toepassingen kunt gebruiken. Het is geschreven voor een webapp met een browser-frontend (React/TypeScript) en een API (Cloudflare Worker + D1 + R2), maar het principe werkt op elk platform.

Je kan dit bestand ook in een ander project zetten en aan Claude (of een andere ontwikkelaar) vragen: *"Bouw logging en meldingen volgens Instructie_Logboek_en_Meldingen.md."*

---

## 1. Het principe in het kort

1. **De browser houdt zelf een klein logboek bij**, enkel in het geheugen (de laatste 200 regels). Er wordt niets automatisch verstuurd.
2. **De gebruiker beslist zelf** om een probleem of idee te melden via een vaste knop. Pas dan gaat het logboek mee, samen met technische gegevens en, als de gebruiker dat wil, een schermafbeelding waarop ingevulde gegevens onleesbaar gemaakt zijn.
3. **Elke API-aanvraag krijgt een request-id.** De server schrijft per aanvraag één gestructureerde logregel met dat id, en de browser noteert hetzelfde id in zijn logboek. Zo kun je een melding koppelen aan de serverlogs.
4. **Nooit persoonsgegevens in logs.** Geen formulierinhoud, geen e-mailadressen, geen tokens. Wat toch vrije tekst is (de omschrijving van de melder, diens e-mailadres), wordt versleuteld bewaard.
5. **Meldingen verdwijnen vanzelf** na een vaste bewaartermijn (hier 90 dagen).
6. **Een rapportpagina in het beheer** toont de meldingen, groepeert fouten die vaak terugkomen en laat toe een melding als tekst te kopiëren voor wie het probleem oplost.

Waarom zo: je krijgt de context die je nodig hebt om een fout na te spelen (wat deed de gebruiker, welke aanroep faalde, welke versie, welke browser), zonder een volgsysteem te bouwen. Dat is eenvoudiger te verantwoorden in een privacyverklaring (GDPR): de gegevens worden enkel verwerkt op uitdrukkelijk initiatief van de gebruiker en zijn beperkt tot het doel.

---

## 2. Onderdelen

| Onderdeel | In dit project | Wat het doet |
|---|---|---|
| Logboek in de browser | `frontend/src/services/logboek.ts` | Ringbuffer van 200 regels, vangt `window.onerror`, `unhandledrejection`, `console.error` en `console.warn` op, anonimiseert elke regel. |
| API-wrapper | `frontend/src/services/api.ts` (`call`) | Logt elke aanroep: methode, pad, status, duur, request-id, foutcode. Nooit de body. |
| Stappen loggen | bv. `InschrijfPagina.tsx` | `log('info', 'stap: sessies')`: waar de gebruiker zit, niet wat die invult. |
| Meldknop | `frontend/src/components/MeldKnop.tsx` | Vaste knop, maakt een schermafbeelding, toont welke gegevens meegaan, verstuurt de melding. |
| Maskeren op de schermafbeelding | `frontend/src/styles.css` (`.screenshot-bezig`, `.pii`) | Tijdens het maken van de afbeelding worden velden en gegevens met de klasse `pii` onleesbaar. |
| Request-id en serverlog | `backend/src/index.ts` (`fetch`, `logPad`) | Eén JSON-logregel per aanvraag; `X-Request-Id` in elk antwoord. |
| Melding bewaren | `backend/src/db/meldingen.ts` | Valideert, kort in, anonimiseert opnieuw, versleutelt vrije tekst, bewaart de afbeelding apart. |
| Opruimen | `scheduled` in `backend/src/index.ts` | Dagelijkse taak verwijdert meldingen en afbeeldingen ouder dan 90 dagen. |
| Rapportpagina | `frontend/src/dashboard/Meldingen.tsx` | Lijst, filters, meest voorkomende fouten, detail met logboek, statusbeheer, kopiëren als tekst. |

---

## 3. Stap voor stap overnemen

### 3.1 Logboek in de browser

```ts
// services/logboek.ts
export interface Logregel { t: string; niveau: 'info' | 'waarschuwing' | 'fout'; bericht: string }

const MAX = 200;
const regels: Logregel[] = [];

/** Tokens (hier: 43 tekens base64url) en e-mailadressen horen niet in een logboek. */
export const anonimiseer = (s: string) =>
  s.replace(/[A-Za-z0-9_-]{43}/g, '[token]').replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[e-mail]');

export function log(niveau: Logregel['niveau'], bericht: string) {
  regels.push({ t: new Date().toISOString(), niveau, bericht: anonimiseer(bericht).slice(0, 500) });
  if (regels.length > MAX) regels.splice(0, regels.length - MAX);
}

export const logboek = () => regels.slice();

let geinstalleerd = false;
export function installeerLogboek() {
  if (geinstalleerd || typeof window === 'undefined') return;
  geinstalleerd = true;
  log('info', `start ${location.pathname}`);
  window.addEventListener('error', (e) => log('fout', `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => log('fout', `unhandledrejection: ${String(e.reason?.stack ?? e.reason)}`));
  for (const [methode, niveau] of [['error', 'fout'], ['warn', 'waarschuwing']] as const) {
    const origineel = console[methode].bind(console);
    console[methode] = (...args: unknown[]) => {
      log(niveau, args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      origineel(...args);
    };
  }
}
```

Roep `installeerLogboek()` één keer op bij het starten van de app (`main.tsx`), vóór de eerste render.

**Pas de regex in `anonimiseer` aan** aan de geheimen van jouw toepassing (andere tokenlengte, rijksregisternummers, telefoonnummers, ...).

### 3.2 Wat log je wel en niet?

| Wel | Niet |
|---|---|
| `stap: gegevens`, `venster geopend`, `filter gewijzigd` | Wat de gebruiker invult of kiest als dat iets over een persoon zegt |
| `POST /api/registraties → 500 in 1210 ms [8c1f…] SERVERFOUT` | De request- of response-body |
| Foutmeldingen en stacktraces | Namen, e-mailadressen, adressen, geboortedata |
| Versie, schermgrootte, taal, online/offline | Cookies, sessietokens, links met een geheim token |

Vuistregel: een logregel beschrijft **wat er gebeurde**, nooit **over wie**.

### 3.3 API-aanroepen loggen met request-id

In de frontend, in de ene functie waarlangs alle aanroepen gaan:

```ts
const start = performance.now();
const res = await fetch(url, init);
const regel = `${methode} ${pad} → ${res.status} in ${Math.round(performance.now() - start)} ms [${res.headers.get('X-Request-Id') ?? '-'}]`;
if (!res.ok) log(res.status >= 500 ? 'fout' : 'waarschuwing', `${regel} ${data?.fout ?? ''}`);
else log('info', regel);
```

Bij een netwerkfout (fetch gooit): `log('fout', `${methode} ${pad} → netwerkfout ${String(e)}`)`.

Let op: `pad` mag geen geheime tokens bevatten; anders vangt `anonimiseer` dat op, maar beter is ze niet in de URL te zetten.

### 3.4 Serverkant: één gestructureerde logregel per aanvraag

```ts
// Cloudflare Worker: het Ray ID is al uniek per aanvraag en staat ook in het Cloudflare-dashboard.
const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
const start = Date.now();
let res: Response, fout: string | undefined;
try {
  res = await route(request, env, ctx);
} catch (e) {
  fout = 'SERVERFOUT';
  // Nooit de request-body loggen; enkel de foutmelding en de stack.
  console.error(JSON.stringify({ requestId, fout: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }));
  res = json({ fout: 'SERVERFOUT', melding: 'Er ging iets mis.', requestId }, 500);
}
console.log(JSON.stringify({ requestId, methode: request.method, pad: logPad(new URL(request.url).pathname), status: res.status, ms: Date.now() - start, fout }));
// In elk antwoord meegeven (en bij CORS ook in Access-Control-Expose-Headers zetten):
headers.set('X-Request-Id', requestId);
```

`logPad` vervangt tokens en uuid's in het pad door `:token` en `:id`, zodat logregels groeperen en niets gevoeligs bevatten.

Zet in `wrangler.toml` de logs aan om ze in het dashboard te kunnen doorzoeken:

```toml
[observability]
enabled = true
```

Een request-id uit een melding zoek je op in **Cloudflare → Workers & Pages → (je Worker) → Observability**.

Op een ander platform: gebruik een middleware die een id aanmaakt (of overneemt van de load balancer), het in een header teruggeeft en het in elke logregel zet.

### 3.5 De meldknop

Wat de knop doet, in volgorde:

1. **Schermafbeelding maken vóór het venster opent** (anders staat het venster erop). Zet eerst een klasse op `<html>` die gevoelige inhoud onleesbaar maakt, maak de afbeelding met `html-to-image` (lazy importeren, het is groot), haal de klasse weer weg. Mislukt het: verder zonder afbeelding.
2. **Venster tonen** met: soort (probleem/wens), omschrijving (verplicht), e-mailadres (optioneel, enkel om terug te contacteren), vinkje "schermafbeelding meesturen" met voorbeeld, en een uitklapper **"Welke technische gegevens sturen we mee?"** die exact toont wat er verstuurd wordt.
3. **Versturen** met: pagina (geanonimiseerd), app-versie, user agent, context (scherm, venster, pixelratio, taal, tijdzone, tijdstip, online, aanraakscherm), het logboek en eventueel de afbeelding (data-URL).
4. **Referentie tonen** (eerste 8 tekens van het id), zodat de gebruiker ernaar kan verwijzen.

Maskeren tijdens de schermafbeelding:

```css
.screenshot-bezig input:not([type='radio']):not([type='checkbox']),
.screenshot-bezig textarea,
.screenshot-bezig select,
.screenshot-bezig .pii {
  color: transparent !important; text-shadow: none !important; background-color: var(--rand) !important;
}
```

Geef elk element dat persoonsgegevens **toont** (samenvattingen, namen in lijsten) de klasse `pii`.

App-versie: laat de build die invullen, bv. in `vite.config.ts`:

```ts
define: { __APP_VERSIE__: JSON.stringify(`${version} (${commit}, ${datum})`) }
```

Bescherming tegen misbruik van het meldformulier: bot-controle (Turnstile), een verborgen honeypot-veld en een limiet op het aantal meldingen per IP.

### 3.6 Melding bewaren

Tabel (SQL):

```sql
create table meldingen (
  melding_id       text primary key,
  type             text not null check (type in ('probleem', 'wens')),
  omschrijving_enc text not null,        -- versleuteld: vrije tekst kan persoonsgegevens bevatten
  email_enc        text,                 -- versleuteld, optioneel
  pagina           text,                 -- URL zonder tokens
  app_versie       text,
  browser          text,
  context          text check (context is null or json_valid(context)),
  logboek          text check (logboek is null or json_valid(logboek)),
  screenshot       integer not null default 0 check (screenshot in (0, 1)),
  status           text not null default 'nieuw' check (status in ('nieuw', 'in_behandeling', 'afgehandeld')),
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index meldingen_datum_idx on meldingen (created_at);
```

Regels voor de server (vertrouw de browser nooit):

- Neem **enkel gekende velden** over uit `context`, elk met een maximale lengte.
- Kort het logboek in (max. 200 regels, 500 tekens per regel) en **anonimiseer opnieuw**.
- Controleer dat de afbeelding echt een PNG-data-URL is en niet groter dan 3 MB; bewaar ze apart (R2: `meldingen/<id>.png`), niet in de database.
- Versleutel omschrijving en e-mailadres (AES-GCM met een sleutel als secret, nooit in de code).
- Stuur eventueel een korte mail naar de beheerder ("nieuwe melding ABCD1234"), **zonder** de inhoud.

### 3.7 Opruimen

Een dagelijkse geplande taak (Cron Trigger) verwijdert meldingen ouder dan de bewaartermijn, en eerst hun afbeeldingen. Vermeld die termijn in het meldvenster en in de privacyverklaring.

### 3.8 Rapportpagina in het beheer

Alleen voor de hoogste beheerrol (de API controleert dat; de frontend verbergt enkel de link). Elke keer dat de lijst opgevraagd wordt, komt er een regel in het auditlog.

API:

| Aanroep | Doel |
|---|---|
| `GET /api/beheer/meldingen` | Laatste 200 meldingen, ontsleuteld, met `referentie` en een link naar de afbeelding |
| `GET /api/beheer/meldingen/<id>/screenshot` | De afbeelding (`Cache-Control: private, no-store`) |
| `PATCH /api/beheer/meldingen/<id>` `{ status }` | Status wijzigen: `nieuw`, `in_behandeling`, `afgehandeld` |

Wat de pagina toont (`/dashboard/meldingen`):

- **Tellers**: nieuw, in behandeling, afgehandeld, aantal met fouten in het logboek.
- **Filters**: zoeken (ook in het logboek), status (standaard "openstaand"), soort.
- **Meest voorkomende fouten**: de foutregels van alle zichtbare meldingen, gegroepeerd nadat getallen, id's en request-id's weggelaten zijn. Per groep: aantal meldingen, de referenties (aanklikbaar), de versies en wanneer het laatst. Zo zie je meteen wat eerst aangepakt moet worden en of een fout na een nieuwe versie nog voorkomt.
- **Tabel** met datum, referentie, soort, omschrijving, pagina, versie, aantal fouten, status.
- **Detailvenster**: statusknoppen, omschrijving, contactadres, alle technische gegevens, de request-id's (om in de serverlogs op te zoeken), de schermafbeelding en het logboek met fouten in het rood, met een filter "enkel waarschuwingen en fouten".
- **Kopiëren als tekst**: de hele melding (zonder het e-mailadres van de melder) als platte tekst, om in een issue te plakken of aan een ontwikkelaar of Claude te geven.

---

## 4. Werkwijze bij een melding

1. Open de melding in **Beheer → Meldingen** en zet ze op *In behandeling*.
2. Lees de omschrijving en de laatste stappen in het logboek. Zet het filter "enkel waarschuwingen en fouten" aan.
3. Zoek de request-id's op in de serverlogs voor de stacktrace aan de serverkant.
4. Kijk in "meest voorkomende fouten" of het een terugkerend probleem is.
5. Kopieer de melding als tekst naar het issue of de ontwikkelaar.
6. Na de oplossing: zet ze op *Afgehandeld*. Liet de melder een e-mailadres achter, laat dan even weten dat het opgelost is.

---

## 5. Controlelijst voor een nieuw project

- [ ] `logboek.ts` overgenomen, `installeerLogboek()` bij het starten, `anonimiseer` aangepast aan de eigen geheimen.
- [ ] Alle API-aanroepen lopen via één functie die logt met methode, pad, status, duur en request-id.
- [ ] Belangrijke stappen gelogd met `log('info', 'stap: …')`, zonder inhoud.
- [ ] Server: request-id per aanvraag, `X-Request-Id` in elk antwoord (en in `Access-Control-Expose-Headers`), één JSON-logregel per aanvraag, nooit de body.
- [ ] Meldknop op elke pagina, met schermafbeelding, maskeren (`.screenshot-bezig`, `.pii`) en uitleg welke gegevens meegaan.
- [ ] Bescherming tegen misbruik: bot-controle, honeypot, limiet per IP.
- [ ] Server valideert, kort in, anonimiseert opnieuw, versleutelt vrije tekst, bewaart afbeeldingen apart.
- [ ] Bewaartermijn met dagelijkse opruimtaak; termijn vermeld in het venster en de privacyverklaring.
- [ ] Rapportpagina enkel voor de hoogste rol, met auditlog bij het opvragen.
- [ ] Test: een melding met logboek en technische gegevens wordt verstuurd en de verplichte velden worden gecontroleerd (zie `frontend/src/flow.test.tsx`).
