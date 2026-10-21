-- Leerkracht (sessiegever) per lesje: naam voor de rapporten, adres om de klaslijst door te mailen.
-- Het adres moet @onderwijs.gent.be zijn (gecontroleerd in de Worker): klaslijsten bevatten namen van leerlingen.
alter table sessies add column lesgever text;
alter table sessies add column lesgever_email text;

-- Aangepaste titels en kolomkoppen van de rapporten, per evenement (JSON: sleutel → tekst).
alter table evenementen add column rapport_teksten text check (rapport_teksten is null or json_valid(rapport_teksten));
