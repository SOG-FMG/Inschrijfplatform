-- Rechten per rol aanpassen (Medewerkers → Rollen en rechten). Enkel voor rechten die een module als instelbaar
-- markeert (Recht.instelbaar); zonder rij geldt de standaard uit het manifest. De platformbeheerder heeft altijd alles.
-- rol: code uit rollen, of 'sessiegever' (geen medewerker, zie src/modules/evenementen/sessiegevers.ts).
create table rol_rechten (
  rol            text not null,
  recht          text not null,
  toegestaan     integer not null check (toegestaan in (0, 1)),
  gewijzigd_op   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gewijzigd_door text references gebruikers(gebruiker_id) on delete set null,
  primary key (rol, recht)
);
