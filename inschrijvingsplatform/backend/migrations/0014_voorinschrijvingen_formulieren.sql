-- Gekopieerd uit src/modules/voorinschrijvingen/migraties/formulieren.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Eigen voorinschrijvingsformulier (in plaats van Microsoft Forms). Elk formulier verzamelt in één "import"
-- (voorinschrijvingen_importen), zodat statistieken, controles, uitnodigen en anonimiseren hetzelfde werken.
-- De huisstijl (logo, kleuren, organisator) komt van een gekozen evenement.
create table voorinschrijvingen_formulieren (
  formulier_id    text primary key,
  import_id       text not null unique references voorinschrijvingen_importen(import_id) on delete cascade,
  slug            text not null unique
                  check (length(slug) between 1 and 80 and slug not glob '*[^a-z0-9-]*'
                         and slug not like '-%' and slug not like '%-' and slug not like '%--%'),
  titel           text not null,
  intro           text,
  schooljaar      text,
  leerjaar_opties text not null default '[]' check (json_valid(leerjaar_opties)),
  evenement_id    text references evenementen(evenement_id) on delete set null,
  privacy_tekst   text,
  contact_email   text,
  open            integer not null default 1 check (open in (0, 1)),
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
