-- Gekopieerd uit src/modules/evenementen/migraties/checkin.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Check-in met een QR-code (src/kern/checkin.ts). Een aparte, willekeurige token per inschrijving, los van de
-- beheertoken: de QR-code dient enkel om de aanwezigheid te registreren, niet om te wijzigen of te annuleren.
-- Geen persoonsgegevens. Bestaande inschrijvingen houden null (geen QR-code). SQLite kan geen unique-kolom
-- toevoegen met alter table, vandaar de aparte unieke index.
alter table deelnemers add column checkin_token text;
create unique index deelnemers_checkin_token_uniek on deelnemers (checkin_token) where checkin_token is not null;
