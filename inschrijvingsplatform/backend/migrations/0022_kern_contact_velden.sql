-- Functie en bedrijfsnaam bij een contact (kern). Nodig om twee lesgevers met dezelfde naam uit elkaar te
-- houden in de keuzelijst bij een lesje (Instellingen > Sessies).
-- Niet versleuteld, anders dan de naam en het adres: een functie of een bedrijfsnaam identificeert op zichzelf
-- niemand, en zo kan er op gefilterd en gesorteerd worden zonder alles eerst te ontsleutelen.
alter table contacten add column functie text;
alter table contacten add column bedrijfsnaam text;
