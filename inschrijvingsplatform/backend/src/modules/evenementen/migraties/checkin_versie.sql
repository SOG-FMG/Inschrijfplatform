-- Versie van een inschrijving voor de check-in (src/kern/checkin.ts). De QR-code in elke mail bevat het versienummer
-- van dat moment; toont iemand een oudere mail, dan ziet het onthaal dat (geel). Triggers houden het nummer bij,
-- zodat geen enkel pad vergeten wordt: wijzigen door de ouder, aanpassen door de school, annuleren en het
-- doorschuiven van de wachtlijst. Aanwezigheid registreren (aanwezig, checkin_datum) verandert het nummer niet.
alter table deelnemers add column checkin_versie integer not null default 1;
alter table deelnemers add column gewijzigd_op text;
-- Wie de laatste wijziging deed: 'ouder', 'school' of 'wachtlijst' (doorgeschoven). Leeg = nooit gewijzigd.
alter table deelnemers add column gewijzigd_door text;
-- Wanneer de laatste mail met QR-code vertrok. Leeg = nog nooit (inschrijvingen van vóór de QR-code).
alter table deelnemers add column checkin_gemaild_op text;

create trigger inschrijvingen_versie_insert after insert on inschrijvingen
begin
  update deelnemers set checkin_versie = checkin_versie + 1, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where deelnemer_id = new.deelnemer_id;
end;

create trigger inschrijvingen_versie_update after update of status, dagdeel_id, sessie_id on inschrijvingen
when old.status is not new.status or old.dagdeel_id is not new.dagdeel_id or old.sessie_id is not new.sessie_id
begin
  update deelnemers set checkin_versie = checkin_versie + 1, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    gewijzigd_door = case when old.status = 'wachtlijst' and new.status = 'bevestigd' then 'wachtlijst' else gewijzigd_door end
  where deelnemer_id = new.deelnemer_id;
end;
