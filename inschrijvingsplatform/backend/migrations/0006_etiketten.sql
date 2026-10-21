-- Etiketten per evenement (JSON: blad, marges, aantal per blad en de regels met {velden}). Leeg = standaard 3 × 8 op A4.
-- De verdieping van een lokaal (locaties.verdieping) bestond al en is nu aanpasbaar vanuit de etikettenpagina.
alter table evenementen add column etiket_instellingen text check (etiket_instellingen is null or json_valid(etiket_instellingen));
