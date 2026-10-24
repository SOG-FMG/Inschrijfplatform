-- Aangepaste mailteksten (module mailsjablonen). Zonder rij geldt de standaardtekst uit het manifest van de module.
create table mailsjablonen (
  sleutel       text primary key,
  onderwerp     text not null,
  tekst         text not null,
  gewijzigd_op  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gewijzigd_door text references gebruikers(gebruiker_id) on delete set null
);
