-- Gekopieerd uit src/modules/voorinschrijvingen/migraties/tabellen.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Voorinschrijvingen uit een extern bestand (bv. Microsoft Forms), voor statistieken en controles.
-- Persoonsgegevens versleuteld (*_enc) zoals bij deelnemers; email_hash = zelfde blinde index als deelnemers.email_hash,
-- zodat te zien is wie zich ook voor een infodag inschreef. Anonimiseren wist alles wat naar een persoon wijst;
-- schooljaar, klas, school en datum blijven voor de statistieken.
create table voorinschrijvingen_importen (
  import_id         text primary key,
  naam              text not null,
  bestandsnaam      text,
  aantal            integer not null default 0,
  geanonimiseerd_op text,
  created_by        text references gebruikers(gebruiker_id),
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table voorinschrijvingen (
  id              text primary key,
  import_id       text not null references voorinschrijvingen_importen(import_id) on delete cascade,
  ingediend_op    text,                 -- ISO-datum en -tijd
  schooljaar      text,                 -- bv. 'Schooljaar 2026 - 2027' (zoals in het bestand)
  klas            text,
  school_id       text references scholen(school_id),
  school_andere   text,                 -- schoolnaam als die niet in de officiële lijst staat
  kind_naam_enc   text,
  email_enc       text,
  telefoon_enc    text,
  opmerkingen_enc text,
  email_hash      text
);
create index voorinschrijvingen_import_idx on voorinschrijvingen (import_id);
create index voorinschrijvingen_email_idx on voorinschrijvingen (email_hash) where email_hash is not null;
