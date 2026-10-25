-- Gekopieerd uit src/modules/voorinschrijvingen/migraties/evenement.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Een import (of een eigen formulier) hoort bij een evenement, meestal de infodagen van hetzelfde schooljaar.
-- Zo toont het overzicht van een evenement wie vooraf inschreef en wie daarna kwam. Leeg = nog niet gekoppeld.
alter table voorinschrijvingen_importen add column evenement_id text references evenementen(evenement_id) on delete set null;
create index voorinschrijvingen_importen_evenement_idx on voorinschrijvingen_importen (evenement_id) where evenement_id is not null;
