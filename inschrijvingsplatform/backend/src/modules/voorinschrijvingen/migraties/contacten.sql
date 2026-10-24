-- Voorinschrijvingen koppelen aan de contacten en personen van de kern. Nieuwe imports bewaren naam, e-mail en
-- telefoon enkel nog bij het contact en de persoon; de oude kolommen worden leeg gemaakt door de taak die
-- bestaande rijen koppelt (modules/voorinschrijvingen/db.ts). email_hash blijft voor de controles.
alter table voorinschrijvingen add column contact_id text references contacten(contact_id) on delete set null;
alter table voorinschrijvingen add column persoon_id text references personen(persoon_id) on delete set null;
create index voorinschrijvingen_persoon_idx on voorinschrijvingen (persoon_id) where persoon_id is not null;
