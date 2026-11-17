# Migratie- & Ontwikkelgids: Van Supabase naar 100% Cloudflare Native Stack (EU Compliant)

Dit document beschrijft het volledige stappenplan en de architectuur om het inschrijvingsplatform om te bouwen van Supabase naar een **volledig Cloudflare-native stack** (Cloudflare Workers, D1 SQLite Database, R2 Object Storage, Workers KV en Cloudflare Pages).

---

## 1. Strategische Architectuurverandering

| Component | Oude Architectuur (Supabase) | Nieuwe Cloudflare Native Stack | EU & GDPR Compliance |
| :--- | :--- | :--- | :--- |
| **Database** | Supabase PostgreSQL | **Cloudflare D1** (Serverless SQLite) | Afgedwongen Data Residency (`weur` / Europe) |
| **Bestandsopslag** | Supabase Storage | **Cloudflare R2** | Geen egress kosten, opgeslagen in EU buckets |
| **Caching / Sessions** | Redis / Supabase Auth | **Workers KV** | Encrypted key-value storage binnen EU |
| **Security / RLS** | Postgres Row-Level Security (RLS) | **Worker Middleware Access Control** | Token-gebaseerde rij-niveau controle in Worker |
| **Encryptie** | Postgres TDE / Vault | **AES-256 Application Layer Encryption** | Gevoelige persoonsgegevens versleuteld in D1 |

---

## 2. VS Code Workspace & Monorepo Structuur

Maintineer dezelfde monorepo-structuur in VS Code, maar vervang de `supabase/` map door D1 migraties:

```text
activiteitenplatform/
├── .vscode/                     # VS Code instellingen
│   ├── settings.json
│   └── extensions.json
├── backend/                     # Cloudflare Worker API & Security Middleware
│   ├── src/
│   │   ├── index.ts             # Main router & CORS handling
│   │   ├── middleware/          # Security, Auth & RLS checks
│   │   ├── crypto/              # Encryptie/Decryptie helpers
│   │   └── db/                  # D1 query helpers & atomaire transacties
│   ├── migrations/              # Cloudflare D1 SQL migratiebestanden
│   │   └── 0001_initial_schema.sql
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml            # Cloudflare Worker & D1/R2/KV Bindings
├── frontend/                    # Cloudflare Pages (Formulier & Beheer)
│   ├── src/
│   ├── package.json
│   └── wrangler.toml
└── README.md
```

---

## 3. Cloudflare Infrastructure Setup (`wrangler.toml`)

In `backend/wrangler.toml` worden alle services gekoppeld met expliciete data-residency restricties.

```toml
name = "activiteitenplatform-api"
main = "src/index.ts"
compatibility_date = "2026-10-01"

# 1. Cloudflare D1 Database Binding (EU Location)
[[d1_databases]]
binding = "DB"
database_name = "inschrijvingen-db-eu"
database_id = "JOUW-D1-DATABASE-ID"
migrations_dir = "migrations"

# 2. Cloudflare R2 Bucket (EU Bestanden & Exports)
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "inschrijvingen-files-eu"

# 3. Workers KV (Tokens & Encrypted Sessions)
[[kv_namespaces]]
binding = "CACHE_KV"
id = "JOUW-KV-NAMESPACE-ID"

# 4. Secrets (Gevoelige encryptiesleutels)
# Wachtwoorden en keys instellen via: npx wrangler secret put ENCRYPTION_KEY
```

---

## 4. Database Schema in D1 (`migrations/0001_initial_schema.sql`)

D1 gebruikt **SQLite** syntaxis. Dit schema bevat alle entiteiten van het Excel-analysebestand:

```sql
-- 1. ROLLEN & GEBRUIKERS
CREATE TABLE IF NOT EXISTS Rollen (
    RolID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL,
    Beschrijving TEXT
);

CREATE TABLE IF NOT EXISTS Gebruikers (
    GebruikerID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL,
    Voornaam TEXT NOT NULL,
    Email TEXT UNIQUE NOT NULL,
    RolID TEXT REFERENCES Rollen(RolID),
    Actief INTEGER DEFAULT 1,
    CreatedDate TEXT DEFAULT (datetime('now'))
);

-- 2. STAMDATA: LOCATIES & SCHOLEN
CREATE TABLE IF NOT EXISTS Locaties (
    LocatieID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL,
    Gebouw TEXT,
    Verdieping TEXT,
    Lokaal TEXT,
    Capaciteit INTEGER DEFAULT 0,
    Projectie INTEGER DEFAULT 0,
    Opmerkingen TEXT
);

CREATE TABLE IF NOT EXISTS Scholen (
    SchoolID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL,
    Gemeente TEXT,
    Onderwijsnet TEXT,
    Actief INTEGER DEFAULT 1
);

-- 3. EVENEMENTEN & TERMINOLOGIE
CREATE TABLE IF NOT EXISTS Evenementen (
    EvenementID TEXT PRIMARY KEY,
    Titel TEXT NOT NULL,
    Omschrijving TEXT,
    TypeEvenement TEXT NOT NULL, -- 'Congres', 'Infodag', 'Opendeur'
    Organisator TEXT,
    LocatieID TEXT REFERENCES Locaties(LocatieID),
    StartDatum TEXT NOT NULL,
    EindDatum TEXT NOT NULL,
    Status TEXT DEFAULT 'Concept',
    Publiceren INTEGER DEFAULT 0,
    Voorinschrijving INTEGER DEFAULT 0,
    Logo TEXT,
    Afbeelding TEXT,
    Opmerkingen TEXT,
    CreatedBy TEXT REFERENCES Gebruikers(GebruikerID),
    CreatedDate TEXT DEFAULT (datetime('now')),
    ModifiedBy TEXT REFERENCES Gebruikers(GebruikerID),
    ModifiedDate TEXT
);

CREATE TABLE IF NOT EXISTS EvenementDagen (
    DagID TEXT PRIMARY KEY,
    EvenementID TEXT REFERENCES Evenementen(EvenementID) ON DELETE CASCADE,
    Naam TEXT NOT NULL,
    Datum TEXT NOT NULL,
    StartUur TEXT NOT NULL,
    EindUur TEXT NOT NULL,
    Volgorde INTEGER DEFAULT 1,
    Status TEXT DEFAULT 'Actief'
);

CREATE TABLE IF NOT EXISTS Tijdsblokken (
    TijdsblokID TEXT PRIMARY KEY,
    DagID TEXT REFERENCES EvenementDagen(DagID) ON DELETE CASCADE,
    Naam TEXT NOT NULL,
    StartUur TEXT NOT NULL,
    EindUur TEXT NOT NULL,
    Volgorde INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS SoortenOnderdelen (
    SoortID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL, -- 'Proeflesje', 'Sessie', 'Rondleiding'
    Beschrijving TEXT
);

CREATE TABLE IF NOT EXISTS Sessies (
    SessieID TEXT PRIMARY KEY,
    DagID TEXT REFERENCES EvenementDagen(DagID) ON DELETE CASCADE,
    TijdsblokID TEXT REFERENCES Tijdsblokken(TijdsblokID) ON DELETE CASCADE,
    SoortID TEXT REFERENCES SoortenOnderdelen(SoortID),
    Titel TEXT NOT NULL,
    Beschrijving TEXT,
    LocatieID TEXT REFERENCES Locaties(LocatieID),
    Capaciteit INTEGER NOT NULL,
    WachtlijstToegelaten INTEGER DEFAULT 0,
    Status TEXT DEFAULT 'Open',
    Zichtbaar INTEGER DEFAULT 1,
    Kleur TEXT,
    Opmerkingen TEXT,
    CreatedBy TEXT REFERENCES Gebruikers(GebruikerID),
    CreatedDate TEXT DEFAULT (datetime('now')),
    ModifiedBy TEXT REFERENCES Gebruikers(GebruikerID),
    ModifiedDate TEXT
);

-- 4. LESGEVERS
CREATE TABLE IF NOT EXISTS Lesgevers (
    LesgeverID TEXT PRIMARY KEY,
    Naam TEXT NOT NULL,
    Voornaam TEXT NOT NULL,
    Email TEXT,
    Telefoon TEXT,
    Organisatie TEXT,
    Bio TEXT,
    Actief INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS SessieLesgevers (
    ID TEXT PRIMARY KEY,
    SessieID TEXT REFERENCES Sessies(SessieID) ON DELETE CASCADE,
    LesgeverID TEXT REFERENCES Lesgevers(LesgeverID) ON DELETE CASCADE,
    Rol TEXT DEFAULT 'Hoofddocent'
);

-- 5. DEELNEMERS & INSCHRIJVINGEN (Persoonsgegevens encrypted opgeslagen)
CREATE TABLE IF NOT EXISTS Deelnemers (
    DeelnemerID TEXT PRIMARY KEY,
    NaamEncrypted TEXT NOT NULL,        -- AES-GCM Encrypted
    VoornaamEncrypted TEXT NOT NULL,    -- AES-GCM Encrypted
    EmailEncrypted TEXT NOT NULL,       -- AES-GCM Encrypted
    EmailHash TEXT NOT NULL,             -- HMAC-SHA256 om op e-mail te kunnen zoeken
    TelefoonEncrypted TEXT,
    SchoolID TEXT REFERENCES Scholen(SchoolID),
    Gemeente TEXT,
    Leerjaar TEXT,
    Functie TEXT,
    Opmerkingen TEXT,
    CreatedDate TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Inschrijvingen (
    InschrijvingID TEXT PRIMARY KEY,
    DeelnemerID TEXT REFERENCES Deelnemers(DeelnemerID) ON DELETE CASCADE,
    EvenementID TEXT REFERENCES Evenementen(EvenementID),
    DagID TEXT REFERENCES EvenementDagen(DagID),
    TijdsblokID TEXT REFERENCES Tijdsblokken(TijdsblokID),
    SessieID TEXT REFERENCES Sessies(SessieID),
    Status TEXT DEFAULT 'Bevestigd',
    InschrijfDatum TEXT DEFAULT (datetime('now')),
    Aanwezig INTEGER DEFAULT 0,
    CheckinDatum TEXT
);

CREATE TABLE IF NOT EXISTS Wachtlijst (
    WachtlijstID TEXT PRIMARY KEY,
    SessieID TEXT REFERENCES Sessies(SessieID) ON DELETE CASCADE,
    DeelnemerID TEXT REFERENCES Deelnemers(DeelnemerID) ON DELETE CASCADE,
    Datum TEXT DEFAULT (datetime('now')),
    Prioriteit INTEGER DEFAULT 1,
    Status TEXT DEFAULT 'Wachtend'
);

-- 6. AUDIT LOGS
CREATE TABLE IF NOT EXISTS AuditLog (
    LogID TEXT PRIMARY KEY,
    Datum TEXT DEFAULT (datetime('now')),
    GebruikerID TEXT REFERENCES Gebruikers(GebruikerID),
    Entiteit TEXT NOT NULL,
    RecordID TEXT NOT NULL,
    Actie TEXT NOT NULL,
    OudeWaarde TEXT,
    NieuweWaarde TEXT,
    IPAdres TEXT
);
```

---

## 5. Beveiliging: Encryptie & Row-Level Security (RLS) in Cloudflare

Omdat SQLite/D1 geen ingebouwde Row-Level Security kent zoals PostgreSQL, implementeren we RLS en Encryptie in de **Cloudflare Worker Middleware Layer**.

### A. Encryptie Helper (`backend/src/crypto/encryption.ts`)

Gebruikt de Web Crypto API (standaard aanwezig in Cloudflare Workers) voor **AES-GCM 256-bit encryptie**:

```typescript
export async function encryptData(text: string, secretKeyHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretKeyHex),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(text)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptData(cipherTextBase64: string, secretKeyHex: string): Promise<string> {
  const combined = Uint8Array.from(atob(cipherTextBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretKeyHex),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
```

### B. Row-Level Security Middleware (`backend/src/middleware/rls.ts`)

Deze middleware vervangt Supabase RLS door dynamische SQL-filtering op basis van de ingelogde gebruiker of inschrijftoken:

```typescript
export interface AuthUser {
  userId: string;
  role: 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT';
  allowedEventIds?: string[];
}

export function applyRLSFilter(query: string, user: AuthUser): { sql: string; params: any[] } {
  // Admins hebben toegang tot alle rijen
  if (user.role === 'ADMIN') {
    return { sql: query, params: [] };
  }

  // Organisatoren zien enkel inschrijvingen van hun toegewezen evenementen
  if (user.role === 'ORGANIZER') {
    const placeholder = user.allowedEventIds?.map(() => '?').join(',') || "''";
    const filteredQuery = `${query} AND EvenementID IN (${placeholder})`;
    return { sql: filteredQuery, params: user.allowedEventIds || [] };
  }

  throw new Error("Onbevoegde toegang - RLS restrictie.");
}
```

---

## 6. Worker API Handler met Transactie & Volzet-Logica (`backend/src/index.ts`)

```typescript
import { encryptData, decryptData } from './crypto/encryption';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  CACHE_KV: KVNamespace;
  ENCRYPTION_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. GET /api/sessies - Haalt zichtbare sessies op + checkt volzet status
    if (url.pathname === '/api/sessies' && request.method === 'GET') {
      const dagId = url.searchParams.get('dagId');

      const query = `
        SELECT s.*, 
               COUNT(i.InschrijvingID) as AantalInschrijvingen,
               (COUNT(i.InschrijvingID) >= s.Capaciteit) as IsVolzet
        FROM Sessies s
        LEFT JOIN Inschrijvingen i ON s.SessieID = i.SessieID AND i.Status = 'Bevestigd'
        WHERE s.DagID = ? AND s.Zichtbaar = 1
        GROUP BY s.SessieID
      `;

      const { results } = await env.DB.prepare(query).bind(dagId).all();

      // Elimineer opties die volzet zijn (of markeer ze)
      return Response.json(results);
    }

    // 2. POST /api/inschrijven - Veilige verwerking in Cloudflare D1
    if (url.pathname === '/api/inschrijven' && request.method === 'POST') {
      const body = await request.json();
      const { deelnemer, evenementId, dagId, tijdsblokId, sessieId } = body;

      // Capaciteitscontrole uitvoeren
      const sessieCheck = await env.DB.prepare(`
        SELECT s.Capaciteit, s.WachtlijstToegelaten, COUNT(i.InschrijvingID) as HuidigeAantal
        FROM Sessies s
        LEFT JOIN Inschrijvingen i ON s.SessieID = i.SessieID AND i.Status = 'Bevestigd'
        WHERE s.SessieID = ?
        GROUP BY s.SessieID
      `).bind(sessieId).first();

      if (!sessieCheck) {
        return Response.json({ error: "Sessie niet gevonden." }, { status: 404 });
      }

      const isVol = (sessieCheck.HuidigeAantal as number) >= (sessieCheck.Capaciteit as number);

      if (isVol && !sessieCheck.WachtlijstToegelaten) {
        return Response.json({ error: "Deze sessie is helaas volgeboekt." }, { status: 400 });
      }

      // Encryptie van gevoelige persoonsgegevens
      const encryptedNaam = await encryptData(deelnemer.naam, env.ENCRYPTION_KEY);
      const encryptedVoornaam = await encryptData(deelnemer.voornaam, env.ENCRYPTION_KEY);
      const encryptedEmail = await encryptData(deelnemer.email, env.ENCRYPTION_KEY);

      const deelnemerId = crypto.randomUUID();
      const inschrijvingId = crypto.randomUUID();
      const status = isVol ? 'Wachtlijst' : 'Bevestigd';

      // Atomaire verwerking via D1 Batch Execution
      if (status === 'Bevestigd') {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO Deelnemers (DeelnemerID, NaamEncrypted, VoornaamEncrypted, EmailEncrypted, EmailHash, SchoolID, Gemeente)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(deelnemerId, encryptedNaam, encryptedVoornaam, encryptedEmail, 'HASH_PLACEHOLDER', deelnemer.schoolId, deelnemer.gemeente),
          
          env.DB.prepare(`
            INSERT INTO Inschrijvingen (InschrijvingID, DeelnemerID, EvenementID, DagID, TijdsblokID, SessieID, Status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(inschrijvingId, deelnemerId, evenementId, dagId, tijdsblokId, sessieId, status)
        ]);
      } else {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO Deelnemers (DeelnemerID, NaamEncrypted, VoornaamEncrypted, EmailEncrypted, EmailHash, SchoolID, Gemeente)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(deelnemerId, encryptedNaam, encryptedVoornaam, encryptedEmail, 'HASH_PLACEHOLDER', deelnemer.schoolId, deelnemer.gemeente),
          
          env.DB.prepare(`
            INSERT INTO Wachtlijst (WachtlijstID, SessieID, DeelnemerID)
            VALUES (?, ?, ?)
          `).bind(crypto.randomUUID(), sessieId, deelnemerId)
        ]);
      }

      return Response.json({ success: true, status, message: isVol ? "U bent op de wachtlijst geplaatst." : "Inschrijving geslaagd." });
    }

    return new Response("Not Found", { status: 404 });
  }
};
```

---

## 7. Uitvoering in VS Code Terminal

1. **Maak de D1 Database aan in West-Europe:**
   ```bash
   npx wrangler d1 create inschrijvingen-db-eu --location=weur
   ```
2. **Voer de SQL-migraties lokaal uit:**
   ```bash
   npx wrangler d1 migrations apply inschrijvingen-db-eu --local
   ```
3. **Stel de AES Encryptiesleutel in:**
   ```bash
   npx wrangler secret put ENCRYPTION_KEY
   ```
4. **Deploy de Worker Backend naar Cloudflare:**
   ```bash
   npx wrangler d1 migrations apply inschrijvingen-db-eu --remote
   npx wrangler deploy
   ```