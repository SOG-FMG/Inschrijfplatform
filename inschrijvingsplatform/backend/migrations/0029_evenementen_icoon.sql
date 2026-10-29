-- Pictogram (favicon) per evenement: eigen icoontje in het browsertabblad op het inschrijfformulier.
-- Zelfde opzet als logo (losse uploadroute, bestand in R2 onder icoons/<evenement_id>).
alter table evenementen add column icoon text;
