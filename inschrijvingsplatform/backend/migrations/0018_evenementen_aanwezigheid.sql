-- Gekopieerd uit src/modules/evenementen/migraties/aanwezigheid.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Aanwezigheid op de dag zelf en sessiegevers (Plan_Checkin_en_Aanwezigheid.md, fases 2 tot 5).

-- Sessiegevers: wie een sessie geeft (lesgever, spreker, artiest: de term per installatie staat in TERM_SESSIEGEVER).
-- De tabellen bestonden al als lesgevers en sessie_lesgevers (0001), maar werden niet gebruikt; ze krijgen de
-- algemene naam. Een sessiegever is geen medewerker: aanmelden met een code per mail, enkel voor de eigen sessies.
alter table lesgevers rename to sessiegevers;
alter table sessiegevers rename column lesgever_id to sessiegever_id;
alter table sessie_lesgevers rename to sessie_sessiegevers;
alter table sessie_sessiegevers rename column lesgever_id to sessiegever_id;
create unique index sessiegevers_email_uniek on sessiegevers (email) where email is not null;
create index sessie_sessiegevers_sessiegever_idx on sessie_sessiegevers (sessiegever_id);
alter table sessiegevers add column uitgenodigd_op text;
alter table sessiegevers add column created_at text;

-- Aanmeldsessies van sessiegevers (enkel de hash van het cookietoken), geldig tot 5 dagen na de laatste sessie.
create table sessiegever_sessies (
  sessie_hash    text primary key,
  sessiegever_id text not null references sessiegevers(sessiegever_id) on delete cascade,
  aangemaakt_op  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verloopt_op    text not null,
  ip_adres       text
);
create index sessiegever_sessies_sessiegever_idx on sessiegever_sessies (sessiegever_id);

-- Eén aanmeldcode tegelijk per sessiegever: 6 cijfers, 10 minuten, één keer, maximaal 5 pogingen.
create table sessiegever_codes (
  sessiegever_id text primary key references sessiegevers(sessiegever_id) on delete cascade,
  code_hash      text not null,
  verloopt_op    text not null,
  pogingen       integer not null default 0,
  aangemaakt_op  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Welke extra velden een sessiegever ziet (JSON-lijst, bv. ["email", "telefoon"]). Leeg = enkel wat op het rapport staat.
alter table evenementen add column sessiegever_velden text check (sessiegever_velden is null or json_valid(sessiegever_velden));

-- Aanwezigheid. Op de rij van het dagdeel: aangemeld op school (aanwezig, checkin_datum bestonden al) en hoe.
-- Op de rij van een lesje: wat de sessiegever in de klas aanduidde.
alter table inschrijvingen add column aanmeld_via text check (aanmeld_via is null or aanmeld_via in ('qr', 'balie', 'klas'));
alter table inschrijvingen add column aangemeld_door text;
alter table inschrijvingen add column klas_status text check (klas_status is null or klas_status in ('aanwezig', 'afwezig'));
alter table inschrijvingen add column klas_door text;
alter table inschrijvingen add column klas_op text;
