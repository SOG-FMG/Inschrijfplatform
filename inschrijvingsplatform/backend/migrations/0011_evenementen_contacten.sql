-- Gekopieerd uit src/modules/evenementen/migraties/contacten.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Inschrijvingen koppelen aan de contacten en personen van de kern (zie migrations/0009_kern_contacten.sql).
alter table deelnemers add column contact_id text references contacten(contact_id) on delete set null;
alter table deelnemers add column persoon_id text references personen(persoon_id) on delete set null;
create index deelnemers_persoon_idx on deelnemers (persoon_id) where persoon_id is not null;

-- Uitnodigingen: een persoonlijke link naar een vooraf ingevuld formulier, per persoon (kind) of per contact
-- (persoon_id leeg: "een ander kind inschrijven"). De token staat versleuteld (om dezelfde link opnieuw te sturen
-- in een herinnering) en als hash (om op te zoeken). voorinvullen_enc: JSON met o.a. school en leerjaar.
create table uitnodigingen (
  uitnodiging_id      text primary key,
  evenement_id        text not null references evenementen(evenement_id) on delete cascade,
  contact_id          text not null references contacten(contact_id) on delete cascade,
  persoon_id          text references personen(persoon_id) on delete cascade,
  token_hash          text not null unique,
  token_enc           text not null,
  voorinvullen_enc    text,
  bron                text,                -- bv. 'voorinschrijvingen:<import_id>'
  verloopt_op         text not null,
  status              text not null default 'aangemaakt' check (status in ('aangemaakt', 'verstuurd', 'gebruikt', 'afgemeld')),
  aantal_verstuurd    integer not null default 0,
  laatst_verstuurd_op text,
  deelnemer_id        text references deelnemers(deelnemer_id) on delete set null,
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create unique index uitnodigingen_uniek on uitnodigingen (evenement_id, contact_id, coalesce(persoon_id, ''));
create index uitnodigingen_evenement_idx on uitnodigingen (evenement_id, status);
