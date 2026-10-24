-- De rollen horen bij de kern en moeten in elke installatie bestaan (nodig om de eerste beheerder te activeren),
-- ook zonder voorbeelddata. Dezelfde vaste id's als in seed/seed.sql; bestaat een rol al, dan gebeurt er niets.
insert or ignore into rollen (rol_id, code, naam, beschrijving) values
  ('e4352a1b-1be0-525c-867e-b07de9320e1f', 'platformbeheerder', 'Platformbeheerder', 'Volledige toegang tot alle scholen en evenementen'),
  ('1bbb3d62-2a74-55b8-8d6a-f2bd6e53243d', 'schoolbeheerder', 'Schoolbeheerder', 'Beheert alle evenementen van de eigen school'),
  ('f6bec0c7-6718-56ab-8155-22efdcdbc5e6', 'organisator', 'Organisator', 'Beheert de evenementen waaraan hij/zij gekoppeld is'),
  ('52eedc96-70e6-5b4d-b479-72d69a3676f0', 'onthaal', 'Onthaal', 'Raadpleegt deelnemerslijsten en registreert aanwezigheid');
