-- "Komt niet": de school weet dat deze deelnemer niet komt opdagen. Hij blijft ingeschreven en houdt zijn
-- plaats (hij kan nog altijd verschijnen), maar krijgt geen herinnering meer.
--
-- Let op het verschil met wat er al bestaat:
--   inschrijvingen.status = 'geannuleerd'  uitgeschreven: plaats vrij, wachtlijst schuift door
--   aanwezigheid 'afwezig'                 check-in ongedaan maken op de dag zelf
--   komt_niet                              dit, enkel voor de herinneringen
alter table deelnemers add column komt_niet integer not null default 0 check (komt_niet in (0, 1));
