-- Hoogte van het logo bovenaan het formulier, in pixels (leeg = standaard 135). De breedte volgt automatisch.
alter table evenementen add column logo_hoogte integer check (logo_hoogte is null or logo_hoogte between 20 and 400);
