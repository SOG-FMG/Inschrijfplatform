-- =====================================================================
-- Generiek activiteiten- en inschrijvingsplatform – D1-schema (SQLite)
-- Gebaseerd op Voorstel_Datamodel_Activiteitenplatform.xlsx, aangevuld met
-- dagdelen, doelgroepen, wachtlijst als status en GDPR-velden. Eigen aan D1:
--   * id's zijn UUID-tekst, tijdstippen ISO 8601 in UTC ('…Z'),
--     datums 'YYYY-MM-DD', uren 'HH:MM', booleans 0/1, lijsten JSON.
--   * Persoonsgegevens staan versleuteld (AES-256-GCM, kolommen *_enc).
--     Regel: alles wat bij anonimisering verdwijnt, staat versleuteld.
--   * Geen RLS in SQLite: toegang wordt gecontroleerd in de Worker
--     (src/middleware/toegang.ts). De database is enkel via de Worker bereikbaar.
--   * Capaciteit wordt atomisch afgedwongen in de schrijfbatch zelf
--     (status 'volzet' → trigger breekt de hele batch af).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ROLLEN, SCHOLEN, GEBRUIKERS, LOCATIES
-- ---------------------------------------------------------------------
create table rollen (
  rol_id       text primary key,
  code         text not null unique,          -- 'platformbeheerder', 'schoolbeheerder', 'organisator', 'onthaal'
  naam         text not null,
  beschrijving text
);

create table scholen (
  school_id         text primary key,
  instellingsnummer integer unique,           -- officieel schoolnummer (lijst Vlaanderen)
  naam              text not null,
  onderwijsnet      text,
  postcode          text,
  gemeente          text,
  actief            integer not null default 1 check (actief in (0, 1))
);

-- Medewerkers melden aan via Cloudflare Access (Entra ID); koppeling op e-mailadres.
create table gebruikers (
  gebruiker_id text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  naam         text not null,
  voornaam     text not null,
  email        text not null unique collate nocase
               check (lower(email) like '%_@onderwijs.gent.be' and email not like '%@%@%'),  -- enkel eigen domein
  rol_id       text not null references rollen(rol_id),
  school_id    text references scholen(school_id),   -- voor rol 'schoolbeheerder'
  actief       integer not null default 1 check (actief in (0, 1)),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table locaties (
  locatie_id  text primary key,
  school_id   text references scholen(school_id),
  naam        text not null,
  gebouw      text,
  verdieping  text,
  lokaal      text,
  capaciteit  integer check (capaciteit is null or capaciteit >= 0),
  projectie   integer not null default 0 check (projectie in (0, 1)),
  opmerkingen text
);

-- ---------------------------------------------------------------------
-- 2. EVENEMENTEN, DAGEN, DAGDELEN, TIJDSBLOKKEN, SESSIES
--    Evenement → Dag → Dagdeel ("moment") → Tijdsblok → Sessie
-- ---------------------------------------------------------------------
create table evenementen (
  evenement_id        text primary key,
  slug                text not null unique
                      check (length(slug) between 1 and 80 and slug not glob '*[^a-z0-9-]*'
                             and slug not like '-%' and slug not like '%-' and slug not like '%--%'),
  titel               text not null,
  omschrijving        text,
  type_evenement      text not null,          -- 'Infodag', 'Congres', 'Opendeur', 'Studiedag', ...
  organisator         text,
  school_id           text references scholen(school_id),   -- organiserende school (rechtenbeheer)
  locatie_id          text references locaties(locatie_id),
  start_datum         text not null,
  eind_datum          text not null,
  status              text not null default 'concept'
                      check (status in ('concept', 'gepubliceerd', 'gesloten', 'gearchiveerd')),
  voorinschrijving    integer not null default 0 check (voorinschrijving in (0, 1)),
  inschrijving_vanaf  text,
  inschrijving_tot    text,
  deelnemer_type      text not null default 'leerling' check (deelnemer_type in ('leerling', 'volwassene')),
  leerjaar_opties     text not null default '[]' check (json_valid(leerjaar_opties)),
  max_dagdelen        integer not null default 1 check (max_dagdelen >= 1),
  contact_email       text,
  privacy_tekst       text,
  bewaartermijn_dagen integer not null default 30 check (bewaartermijn_dagen >= 0),
  logo                text,
  afbeelding          text,
  opmerkingen         text,
  created_by          text references gebruikers(gebruiker_id),
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_by         text references gebruikers(gebruiker_id),
  modified_at         text,
  check (eind_datum >= start_datum),
  check (inschrijving_tot is null or inschrijving_vanaf is null or inschrijving_tot > inschrijving_vanaf)
);

create table evenement_beheerders (
  evenement_id text not null references evenementen(evenement_id) on delete cascade,
  gebruiker_id text not null references gebruikers(gebruiker_id) on delete cascade,
  rol          text not null default 'organisator' check (rol in ('organisator', 'onthaal')),
  primary key (evenement_id, gebruiker_id)
);

-- Doelgroepen per evenement, bv. 'A-stroom' / 'B-stroom', of 'Leerkracht' / 'Directie'.
create table doelgroepen (
  doelgroep_id text primary key,
  evenement_id text not null references evenementen(evenement_id) on delete cascade,
  naam         text not null,
  beschrijving text,
  sessiekeuze  integer not null default 1 check (sessiekeuze in (0, 1)),   -- 0 = enkel een moment kiezen
  volgorde     integer not null default 1
);
create index doelgroepen_evenement_idx on doelgroepen (evenement_id);

create table evenement_dagen (
  dag_id          text primary key,
  evenement_id    text not null references evenementen(evenement_id) on delete cascade,
  naam            text not null,                -- bv. 'Zaterdag 23 januari'
  datum           text not null,
  start_uur       text not null,
  eind_uur        text not null,
  volgorde        integer not null default 1,
  status          text not null default 'actief' check (status in ('actief', 'geannuleerd')),
  sessiekeuze_tot text,                         -- daarna enkel nog een moment kiezen
  check (eind_uur > start_uur)
);
create index evenement_dagen_evenement_idx on evenement_dagen (evenement_id);

create table dagdelen (
  dagdeel_id text primary key,
  dag_id     text not null references evenement_dagen(dag_id) on delete cascade,
  naam       text not null,                     -- bv. 'Voormiddag'
  start_uur  text not null,
  eind_uur   text not null,
  capaciteit integer check (capaciteit is null or capaciteit >= 0),   -- null = onbeperkt
  volgorde   integer not null default 1,
  status     text not null default 'actief' check (status in ('actief', 'geannuleerd')),
  check (eind_uur > start_uur)
);
create index dagdelen_dag_idx on dagdelen (dag_id);

create table tijdsblokken (
  tijdsblok_id text primary key,
  dagdeel_id   text not null references dagdelen(dagdeel_id) on delete cascade,
  naam         text not null,                   -- bv. 'Keuzelesje 1', 'Rondleiding'
  omschrijving text,
  start_uur    text not null,
  eind_uur     text not null,
  volgorde     integer not null default 1,
  type         text not null default 'keuze' check (type in ('keuze', 'programma')),
  verplicht    integer not null default 0 check (verplicht in (0, 1)),
  check (eind_uur > start_uur)
);
create index tijdsblokken_dagdeel_idx on tijdsblokken (dagdeel_id);

create table soorten_onderdelen (
  soort_id     text primary key,
  naam         text not null unique,            -- 'Proeflesje', 'Sessie', 'Workshop', 'Infomoment', ...
  beschrijving text
);

create table sessies (
  sessie_id             text primary key,
  tijdsblok_id          text not null references tijdsblokken(tijdsblok_id) on delete cascade,
  soort_id              text references soorten_onderdelen(soort_id),
  doelgroep_id          text references doelgroepen(doelgroep_id) on delete set null,  -- null = iedereen
  code                  text,                   -- zelfde code in andere tijdsblokken = zelfde onderdeel
  titel                 text not null,
  beschrijving          text,
  locatie_id            text references locaties(locatie_id),
  capaciteit            integer check (capaciteit is null or capaciteit >= 0),         -- null = onbeperkt
  wachtlijst_toegelaten integer not null default 0 check (wachtlijst_toegelaten in (0, 1)),
  volzet_weergave       text not null default 'tonen' check (volzet_weergave in ('tonen', 'verbergen')),
  uniek_per_deelnemer   integer not null default 1 check (uniek_per_deelnemer in (0, 1)),
  status                text not null default 'open' check (status in ('open', 'gesloten', 'geannuleerd')),
  zichtbaar             integer not null default 1 check (zichtbaar in (0, 1)),
  kleur                 text,
  volgorde              integer not null default 1,
  opmerkingen           text,
  created_by            text references gebruikers(gebruiker_id),
  created_at            text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  modified_by           text references gebruikers(gebruiker_id),
  modified_at           text
);
create index sessies_tijdsblok_idx on sessies (tijdsblok_id);

-- ---------------------------------------------------------------------
-- 3. LESGEVERS & SPREKERS
-- ---------------------------------------------------------------------
create table lesgevers (
  lesgever_id text primary key,
  naam        text not null,
  voornaam    text not null,
  email       text,
  telefoon    text,
  organisatie text,
  bio         text,
  actief      integer not null default 1 check (actief in (0, 1))
);

create table sessie_lesgevers (
  id          text primary key,
  sessie_id   text not null references sessies(sessie_id) on delete cascade,
  lesgever_id text not null references lesgevers(lesgever_id) on delete cascade,
  rol         text not null default 'Hoofddocent',
  unique (sessie_id, lesgever_id)
);

-- ---------------------------------------------------------------------
-- 4. DEELNEMERS & INSCHRIJVINGEN
--    *_enc = AES-256-GCM ('v1.' + base64(iv ‖ ciphertext)), null na anonimisering.
--    email_hash / dubbel_hash = HMAC-SHA256 (blinde index om te zoeken
--    en dubbels te weigeren zonder het e-mailadres te ontsleutelen).
-- ---------------------------------------------------------------------
create table deelnemers (
  deelnemer_id         text primary key,
  evenement_id         text not null references evenementen(evenement_id) on delete cascade,
  doelgroep_id         text references doelgroepen(doelgroep_id),
  naam_enc             text,
  voornaam_enc         text,
  email_enc            text,                  -- contactadres (ouder of deelnemer zelf)
  contact_voornaam_enc text,                  -- ouder/voogd bij deelnemer_type 'leerling'
  contact_naam_enc     text,
  telefoon_enc         text,
  school_andere_enc    text,                  -- vrije invoer als school niet in de lijst staat
  functie_enc          text,
  opmerkingen_enc      text,
  email_hash           text,                  -- inzageverzoeken: alle inschrijvingen van één adres
  dubbel_hash          text,                  -- evenement + e-mail + naam + voornaam
  school_id            text references scholen(school_id),
  gemeente             text,
  leerjaar             text,
  privacy_akkoord_op   text not null,
  beheer_token_hash    text unique,           -- sha256 van de link in de bevestigingsmail
  status               text not null default 'actief' check (status in ('actief', 'geannuleerd')),
  created_at           text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  geanonimiseerd_op    text
);
create index deelnemers_evenement_idx on deelnemers (evenement_id);
create index deelnemers_email_idx on deelnemers (email_hash) where email_hash is not null;
-- Vervangt de advisory lock: twee gelijktijdige verzendingen kunnen niet allebei slagen.
create unique index deelnemers_dubbel_uniek on deelnemers (dubbel_hash) where status = 'actief' and dubbel_hash is not null;

-- Eén rij per gekozen dagdeel (sessie_id null) en één rij per gekozen sessie.
-- Wachtlijst = status 'wachtlijst' (geen aparte tabel: één bron van waarheid).
create table inschrijvingen (
  inschrijving_id text primary key,
  deelnemer_id    text not null references deelnemers(deelnemer_id) on delete cascade,
  evenement_id    text not null references evenementen(evenement_id) on delete cascade,
  dag_id          text not null references evenement_dagen(dag_id),
  dagdeel_id      text not null references dagdelen(dagdeel_id),
  tijdsblok_id    text references tijdsblokken(tijdsblok_id),
  sessie_id       text references sessies(sessie_id),
  status          text not null default 'bevestigd' check (status in ('bevestigd', 'wachtlijst', 'geannuleerd')),
  inschrijf_datum text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  aanwezig        integer not null default 0 check (aanwezig in (0, 1)),
  checkin_datum   text,
  check ((tijdsblok_id is null) = (sessie_id is null))
);
create unique index inschrijvingen_dagdeel_uniek
  on inschrijvingen (deelnemer_id, dagdeel_id) where sessie_id is null and status <> 'geannuleerd';
create unique index inschrijvingen_tijdsblok_uniek
  on inschrijvingen (deelnemer_id, tijdsblok_id) where sessie_id is not null and status <> 'geannuleerd';
create index inschrijvingen_deelnemer_idx on inschrijvingen (deelnemer_id);
create index inschrijvingen_sessie_idx on inschrijvingen (sessie_id, status);
create index inschrijvingen_dagdeel_idx on inschrijvingen (dagdeel_id, status) where sessie_id is null;

-- De Worker schrijft status 'volzet' wanneer de capaciteitscontrole (in dezelfde
-- SQL-instructie) faalt. Deze triggers breken dan de volledige batch af, zodat er
-- geen halve inschrijving achterblijft en er nooit overboekt wordt.
create trigger inschrijvingen_volzet_insert before insert on inschrijvingen
when new.status = 'volzet'
begin
  select raise(abort, 'SESSIE_VOLZET') where new.sessie_id is not null;
  select raise(abort, 'DAGDEEL_VOLZET');
end;

create trigger inschrijvingen_volzet_update before update on inschrijvingen
when new.status = 'volzet'
begin
  select raise(abort, 'SESSIE_VOLZET') where new.sessie_id is not null;
  select raise(abort, 'DAGDEEL_VOLZET');
end;

-- ---------------------------------------------------------------------
-- 5. COMMUNICATIE, AUDITLOG & OPMERKINGEN
-- ---------------------------------------------------------------------
create table mail_berichten (
  bericht_id   text primary key,
  deelnemer_id text not null references deelnemers(deelnemer_id) on delete cascade,
  type         text not null,                  -- 'bevestiging', 'annulatie', 'herinnering', 'wachtlijst'
  status       text not null,                  -- 'verzonden', 'mislukt', 'overgeslagen'
  fout         text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Gevuld door de Worker bij elke beheeractie (wie, wat, wanneer). Bevat geen persoonsgegevens.
create table audit_log (
  log_id        text primary key,
  datum         text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gebruiker_id  text references gebruikers(gebruiker_id),
  entiteit      text not null,
  record_id     text not null,
  actie         text not null,
  oude_waarde   text check (oude_waarde is null or json_valid(oude_waarde)),
  nieuwe_waarde text check (nieuwe_waarde is null or json_valid(nieuwe_waarde)),
  ip_adres      text
);
create index audit_log_record_idx on audit_log (entiteit, record_id);

create table opmerkingen (
  opmerking_id text primary key,
  entiteit     text not null,
  record_id    text not null,
  type         text,
  tekst        text not null,
  created_by   text references gebruikers(gebruiker_id),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Meldingen via de knop "Probleem of idee melden" in het formulier.
-- Technische context voor debugging; vrije tekst en e-mail versleuteld (kan persoonsgegevens bevatten).
-- Schermafbeelding in R2 (meldingen/<id>.png). Automatisch verwijderd na 90 dagen (Cron Trigger).
create table meldingen (
  melding_id       text primary key,
  type             text not null check (type in ('probleem', 'wens')),
  omschrijving_enc text not null,
  email_enc        text,                      -- optioneel, om terug te contacteren
  pagina           text,                      -- URL zonder geheime tokens
  app_versie       text,
  browser          text,                      -- user agent
  context          text check (context is null or json_valid(context)),   -- scherm, taal, tijdzone, ...
  logboek          text check (logboek is null or json_valid(logboek)),   -- laatste client-logregels
  screenshot       integer not null default 0 check (screenshot in (0, 1)),
  status           text not null default 'nieuw' check (status in ('nieuw', 'in_behandeling', 'afgehandeld')),
  created_at       text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index meldingen_datum_idx on meldingen (created_at);

-- ---------------------------------------------------------------------
-- 6. BEZETTING (views)
-- ---------------------------------------------------------------------
create view v_sessie_bezetting as
select s.sessie_id,
       s.capaciteit,
       count(i.inschrijving_id) filter (where i.status = 'bevestigd')  as bevestigd,
       count(i.inschrijving_id) filter (where i.status = 'wachtlijst') as wachtlijst
from sessies s
left join inschrijvingen i on i.sessie_id = s.sessie_id
group by s.sessie_id;

create view v_dagdeel_bezetting as
select dd.dagdeel_id,
       dd.capaciteit,
       count(i.inschrijving_id) filter (where i.status = 'bevestigd') as bevestigd
from dagdelen dd
left join inschrijvingen i on i.dagdeel_id = dd.dagdeel_id and i.sessie_id is null
group by dd.dagdeel_id;
