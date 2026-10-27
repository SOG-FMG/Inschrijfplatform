-- Gekopieerd uit src/modules/evenementen/migraties/lesgever_contact.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- De leerkracht van een lesje als verwijzing naar een contact, in plaats van enkel vrije tekst.
-- De tekstkolommen sessies.lesgever en lesgever_email (0004) blijven bestaan en worden bij een keuze mee
-- bijgewerkt, zodat de rapporten, klaslijsten en mails die ze lezen ongewijzigd blijven werken. Ze dienen
-- ook als terugval voor iemand die niet bij de contacten staat.
alter table sessies add column lesgever_contact_id text references contacten(contact_id) on delete set null;
create index sessies_lesgever_contact_idx on sessies (lesgever_contact_id);
