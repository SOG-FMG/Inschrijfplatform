-- Gekopieerd uit src/modules/evenementen/migraties/lokalen.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Lokalen te beheren maken in Instellingen > Lokalen: waar een lokaal staat en wat er hangt.
-- Site, blok en adres staan per lokaal en niet in een eigen tabel gebouwen. Voor een school met een handvol
-- lokalen is dat eenvoudiger te beheren; normaliseren naar gebouwen kan later zonder de rest te raken.
alter table locaties add column site text;
alter table locaties add column blok text;
alter table locaties add column adres text;

-- Faciliteiten als JSON-lijst, bv. ["projector","micro"]. De oude ja/nee-kolom projectie blijft staan
-- (kolommen droppen is in D1/SQLite onnodig lastig) maar wordt niet meer gebruikt.
alter table locaties add column faciliteiten text;
update locaties set faciliteiten = '["projector"]' where projectie = 1 and faciliteiten is null;
