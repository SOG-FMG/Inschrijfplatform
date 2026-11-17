# Handleiding & Architectuur: Generiek Inschrijvingsplatform

Dit document bevat het volledige stappenplan, het database-schema (gebaseerd op `Voorstel_Datamodel_Activiteitenplatform.xlsx`) en de logica om een GDPR-proof inschrijvingssysteem te bouwen met **Cloudflare Workers & Pages** en **Supabase**.

---

## 1. VS Code Project- & Folderinrichting

Om zowel de frontend, de backend API als de database-migraties overzichtelijk te beheren, hanteren we een monorepo-structuur.

### Mappenstructuur
Maak een hoofdmap aan (bijv. `inschrijvingsplatform`) en richt deze als volgt in:

```text
inschrijvingsplatform/
├── .vscode/                     # VS Code workspace instellingen
│   ├── settings.json
│   └── extensions.json
├── backend/                     # Cloudflare Workers (API & Capaciteitslogica)
│   ├── src/
│   │   ├── index.ts             # API router & middleware
│   │   ├── routes/              # Endpoints (evenementen, inschrijvingen)
│   │   └── utils/               # Supabase client & validaties
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.toml            # Cloudflare Workers configuratie
├── frontend/                    # Cloudflare Pages (Publiek formulier + Admin)
│   ├── public/                  # Statische bestanden (logo's, afbeeldingen)
│   ├── src/
│   │   ├── components/          # UI componenten (SessieKiezer, Formulier)
│   │   ├── pages/               # Inschrijfpagina & Beheerders-dashboard
│   │   └── services/            # API communicatie
│   ├── package.json
│   └── vite.config.ts
├── supabase/                    # Supabase database & SQL migraties
│   ├── migrations/
│   │   └── 20261020000000_schema.sql
│   ├── seed.sql                 # Testdata (scholen, locaties, rollen)
│   └── config.toml
├── docs/                        # Documentatie & analyses
└── README.md
```

### Aanbevolen VS Code Extensies
* **Supabase** (SQL auto-complete & snippet ondersteuning)
* **Tailwind CSS IntelliSense** (voor snelle UI-styling)
* **REST Client** of **Thunder Client** (om API-endpoints lokaal te testen)
* **ESLint** & **Prettier** (voor uniforme codekwaliteit)

---

## 2. Fase 1: Database Architecture & Setup (Supabase)

Het datamodel ondersteunt dynamische terminologie (bijv. *Proeflesje*, *Sessie*, *Workshop*, *Congres*, *Opendeur*) en garandeert dat keuzes verdwijnen zodra de capaciteit bereikt is.

### SQL Database Schema

Kopieer het onderstaande SQL-script naar je Supabase migratiebestand (`supabase/migrations/20261020000000_schema.sql`):

```sql
-- Extensies voor UUID generatie
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ROLLEN & GEBRUIKERS (Beheeromgeving)
CREATE TABLE Rollen (
    RolID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(50) NOT NULL,
    Beschrijving TEXT
);

CREATE TABLE Gebruikers (
    GebruikerID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(100) NOT NULL,
    Voornaam VARCHAR(100) NOT NULL,
    Email VARCHAR(255) UNIQUE NOT NULL,
    RolID UUID REFERENCES Rollen(RolID),
    Actief BOOLEAN DEFAULT TRUE,
    CreatedDate TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. STAMDATA: LOCATIES & SCHOLEN
CREATE TABLE Locaties (
    LocatieID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(100) NOT NULL,
    Gebouw VARCHAR(100),
    Verdieping VARCHAR(50),
    Lokaal VARCHAR(50),
    Capaciteit INT NOT NULL DEFAULT 0,
    Projectie BOOLEAN DEFAULT FALSE,
    Opmerkingen TEXT
);

CREATE TABLE Scholen (
    SchoolID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(255) NOT NULL,
    Gemeente VARCHAR(100),
    Onderwijsnet VARCHAR(100),
    Actief BOOLEAN DEFAULT TRUE
);

-- 3. EVENEMENTEN & TERMINOLOGIE
CREATE TABLE Evenementen (
    EvenementID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Titel VARCHAR(255) NOT NULL,
    Omschrijving TEXT,
    TypeEvenement VARCHAR(50) NOT NULL, -- 'Congres', 'Infodag', 'Opendeur', etc.
    Organisator VARCHAR(150),
    LocatieID UUID REFERENCES Locaties(LocatieID),
    StartDatum DATE NOT NULL,
    EindDatum DATE NOT NULL,
    Status VARCHAR(50) DEFAULT 'Concept',
    Publiceren BOOLEAN DEFAULT FALSE,
    Voorinschrijving BOOLEAN DEFAULT FALSE,
    Logo TEXT,
    Afbeelding TEXT,
    Opmerkingen TEXT,
    CreatedBy UUID REFERENCES Gebruikers(GebruikerID),
    CreatedDate TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ModifiedBy UUID REFERENCES Gebruikers(GebruikerID),
    ModifiedDate TIMESTAMP WITH TIME ZONE
);

CREATE TABLE EvenementDagen (
    DagID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    EvenementID UUID REFERENCES Evenementen(EvenementID) ON DELETE CASCADE,
    Naam VARCHAR(100) NOT NULL, -- Bijv. "Zaterdag 24 januari"
    Datum DATE NOT NULL,
    StartUur TIME NOT NULL,
    EindUur TIME NOT NULL,
    Volgorde INT DEFAULT 1,
    Status VARCHAR(50) DEFAULT 'Actief'
);

CREATE TABLE Tijdsblokken (
    TijdsblokID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    DagID UUID REFERENCES EvenementDagen(DagID) ON DELETE CASCADE,
    Naam VARCHAR(100) NOT NULL, -- Bijv. "Voormiddag Blok 1"
    StartUur TIME NOT NULL,
    EindUur TIME NOT NULL,
    Volgorde INT DEFAULT 1
);

CREATE TABLE SoortenOnderdelen (
    SoortID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(100) NOT NULL, -- Bijv. 'Proeflesje', 'Sessie', 'Rondleiding'
    Beschrijving TEXT
);

CREATE TABLE Sessies (
    SessieID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    DagID UUID REFERENCES EvenementDagen(DagID) ON DELETE CASCADE,
    TijdsblokID UUID REFERENCES Tijdsblokken(TijdsblokID) ON DELETE CASCADE,
    SoortID UUID REFERENCES SoortenOnderdelen(SoortID),
    Titel VARCHAR(255) NOT NULL,
    Beschrijving TEXT,
    LocatieID UUID REFERENCES Locaties(LocatieID),
    Capaciteit INT NOT NULL,
    WachtlijstToegelaten BOOLEAN DEFAULT FALSE,
    Status VARCHAR(50) DEFAULT 'Open',
    Zichtbaar BOOLEAN DEFAULT TRUE,
    Kleur VARCHAR(20),
    Opmerkingen TEXT,
    CreatedBy UUID REFERENCES Gebruikers(GebruikerID),
    CreatedDate TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ModifiedBy UUID REFERENCES Gebruikers(GebruikerID),
    ModifiedDate TIMESTAMP WITH TIME ZONE
);

-- 4. LESGEVERS & SPREKERS
CREATE TABLE Lesgevers (
    LesgeverID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(100) NOT NULL,
    Voornaam VARCHAR(100) NOT NULL,
    Email VARCHAR(255),
    Telefoon VARCHAR(50),
    Organisatie VARCHAR(150),
    Bio TEXT,
    Actief BOOLEAN DEFAULT TRUE
);

CREATE TABLE SessieLesgevers (
    ID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    SessieID UUID REFERENCES Sessies(SessieID) ON DELETE CASCADE,
    LesgeverID UUID REFERENCES Lesgevers(LesgeverID) ON DELETE CASCADE,
    Rol VARCHAR(100) DEFAULT 'Hoofddocent'
);

-- 5. DEELNEMERS & INSCHRIJVINGEN
CREATE TABLE Deelnemers (
    DeelnemerID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Naam VARCHAR(100) NOT NULL,
    Voornaam VARCHAR(100) NOT NULL,
    Email VARCHAR(255) NOT NULL,
    Telefoon VARCHAR(50),
    SchoolID UUID REFERENCES Scholen(SchoolID),
    Gemeente VARCHAR(100),
    Leerjaar VARCHAR(50),
    Functie VARCHAR(100),
    Opmerkingen TEXT,
    CreatedDate TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE Inschrijvingen (
    InschrijvingID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    DeelnemerID UUID REFERENCES Deelnemers(DeelnemerID) ON DELETE CASCADE,
    EvenementID UUID REFERENCES Evenementen(EvenementID),
    DagID UUID REFERENCES EvenementDagen(DagID),
    TijdsblokID UUID REFERENCES Tijdsblokken(TijdsblokID),
    SessieID UUID REFERENCES Sessies(SessieID),
    Status VARCHAR(50) DEFAULT 'Bevestigd', -- 'Bevestigd', 'Geannuleerd', 'Wachtlijst'
    InschrijfDatum TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    Aanwezig BOOLEAN DEFAULT FALSE,
    CheckinDatum TIMESTAMP WITH TIME ZONE
);

CREATE TABLE Wachtlijst (
    WachtlijstID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    SessieID UUID REFERENCES Sessies(SessieID) ON DELETE CASCADE,
    DeelnemerID UUID REFERENCES Deelnemers(DeelnemerID) ON DELETE CASCADE,
    Datum TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    Prioriteit INT DEFAULT 1,
    Status VARCHAR(50) DEFAULT 'Wachtend'
);

-- 6. AUDITLOG & OPMERKINGEN (GDPR & Beheer)
CREATE TABLE AuditLog (
    LogID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Datum TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    GebruikerID UUID REFERENCES Gebruikers(GebruikerID),
    Entiteit VARCHAR(100) NOT NULL,
    RecordID UUID NOT NULL,
    Actie VARCHAR(50) NOT NULL,
    OudeWaarde TEXT,
    NieuweWaarde TEXT,
    IPAdres VARCHAR(45)
);

CREATE TABLE Opmerkingen (
    OpmerkingID UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    Entiteit VARCHAR(100) NOT NULL,
    RecordID UUID NOT NULL,
    Type VARCHAR(50),
    Tekst TEXT NOT NULL,
    CreatedBy UUID REFERENCES Gebruikers(GebruikerID),
    CreatedDate TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 3. Fase 2: Backend Logica (Cloudflare Workers)

De Cloudflare Worker fungeert als de beveiligde tussenlaag. Hij handelt capaciteitscontroles af en voorkomt overboekingen (*race conditions*).

### Atoomtransactie voor Inschrijving (Database Functie)
Voeg deze SQL-functie toe aan Supabase om te garanderen dat een sessie **nooit overboekt kan raken**:

```sql
CREATE OR REPLACE FUNCTION verwerk_inschrijving(
    p_deelnemer_id UUID,
    p_evenement_id UUID,
    p_dag_id UUID,
    p_tijdsblok_id UUID,
    p_sessie_id UUID
) RETURNS JSON AS $$
DECLARE
    v_capaciteit INT;
    v_huidige_inschrijvingen INT;
    v_wachtlijst_toegelaten BOOLEAN;
    v_status VARCHAR(50);
BEGIN
    -- Vergrendel de sessie-rij voor deze transactie
    SELECT Capaciteit, WachtlijstToegelaten 
    INTO v_capaciteit, v_wachtlijst_toegelaten
    FROM Sessies 
    WHERE SessieID = p_sessie_id FOR UPDATE;

    -- Tel het aantal actieve inschrijvingen
    SELECT COUNT(*) INTO v_huidige_inschrijvingen
    FROM Inschrijvingen
    WHERE SessieID = p_sessie_id AND Status = 'Bevestigd';

    -- Capaciteitscontrole
    IF v_huidige_inschrijvingen < v_capaciteit THEN
        v_status := 'Bevestigd';
        INSERT INTO Inschrijvingen (DeelnemerID, EvenementID, DagID, TijdsblokID, SessieID, Status)
        VALUES (p_deelnemer_id, p_evenement_id, p_dag_id, p_tijdsblok_id, p_sessie_id, v_status);
        
        RETURN json_build_object('success', true, 'status', v_status, 'message', 'Inschrijving geslaagd.');
    ELSIF v_wachtlijst_toegelaten THEN
        v_status := 'Wachtlijst';
        INSERT INTO Wachtlijst (SessieID, DeelnemerID)
        VALUES (p_sessie_id, p_deelnemer_id);
        
        RETURN json_build_object('success', true, 'status', v_status, 'message', 'Sessie is vol. U bent op de wachtlijst geplaatst.');
    ELSE
        RAISE EXCEPTION 'Sessie is volgeboekt.';
    END IF;
END;
$$ LANGUAGE plpgsql;
```

### Worker Handler (`backend/src/index.ts`)

```typescript
import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // 1. Ophalen van beschikbare sessies (Filtert vol zover gewenst)
    if (url.pathname === '/api/sessies' && request.method === 'GET') {
      const dagId = url.searchParams.get('dagId');

      const { data, error } = await supabase
        .from('Sessies')
        .select(`
          SessieID, Titel, Beschrijving, Capaciteit, Zichtbaar, Kleur,
          SoortenOnderdelen ( Naam ),
          Inschrijvingen ( count )
        `)
        .eq('DagID', dagId)
        .eq('Zichtbaar', true);

      if (error) return new Response(JSON.stringify(error), { status: 500 });

      // Verwerk capaciteit & markeer volzet
      const resultaat = data.map((sessie: any) => {
        const aantalInschrijvingen = sessie.Inschrijvingen[0]?.count || 0;
        const isVol = aantalInschrijvingen >= sessie.Capaciteit;
        return {
          ...sessie,
          aantalInschrijvingen,
          isVol,
          // Als de sessie vol is, kan deze optioneel worden verborgen of disabled
        };
      });

      return new Response(JSON.stringify(resultaat), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Verwerken van Inschrijving
    if (url.pathname === '/api/inschrijven' && request.method === 'POST') {
      const body = await request.json();
      
      const { data, error } = await supabase.rpc('verwerk_inschrijving', {
        p_deelnemer_id: body.deelnemerId,
        p_evenement_id: body.evenementId,
        p_dag_id: body.dagId,
        p_tijdsblok_id: body.tijdsblokId,
        p_sessie_id: body.sessieId
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400 });
      }

      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

---

## 4. Fase 3: Frontend (Cloudflare Pages UI Logica)

In de frontend bouwen we een dynamische wizard. Afhankelijk van de configuratie in de database verandert het label van de keuzes (bijv. "Kies een proeflesje" vs "Kies een sessie").

### Logica voor het verbergen/disablen van keuzes bij volzet
```javascript
// Voorbeeld React/Vue logica voor het renderen van sessies
function renderSessieOptie(sessie) {
  if (sessie.isVol && !sessie.WachtlijstToegelaten) {
    // Keuze volledig elimineren of disabled weergeven
    return null; // Of: <button disabled>Volgeboekt</button>
  }

  return (
    <div key={sessie.SessieID} className="sessie-kaart">
      <h4>{sessie.Titel}</h4>
      <p>{sessie.SoortenOnderdelen.Naam}</p>
      {sessie.isVol && sessie.WachtlijstToegelaten ? (
        <span className="badge-wachtlijst">Wachtlijst beschikbaar</span>
      ) : (
        <button onClick={() => selecteerSessie(sessie.SessieID)}>
          Kies deze optie
        </button>
      )}
    </div>
  );
}
```

---

## 5. Deployment & Cloudflare Setup

1. **Backend Deployen:**
   ```bash
   cd backend
   npx wrangler deploy
   ```
2. **Environment Variables instellen in Cloudflare:**
   Voeg in het Cloudflare Workers dashboard onder **Settings > Variables** de `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` toe.

3. **Frontend Deployen (Pages):**
   * Koppel je Git-repository aan Cloudflare Pages.
   * Build command: `npm run build`
   * Output directory: `dist` of `build` (afhankelijk van je framework).