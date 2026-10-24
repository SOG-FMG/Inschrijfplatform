-- Contacten (kern): één contact per e-mailadres (de ouder, de deelnemer zelf, een assistent ...).
-- Personen horen bij een contact: over wie het gaat (een kind, een collega, of het contact zelf). Een persoon wordt
-- binnen zijn contact herkend aan de naam (naam_sleutel: blinde index, volgorde van de woorden telt niet).
-- Bij twijfel komt er een nieuwe persoon met mogelijk_dubbel_van; een beheerder voegt samen of laat apart.
-- Modules verwijzen naar contact_id/persoon_id en melden dat in hun manifest (persoonsverwijzingen); een dagelijkse
-- taak verwijdert contacten en personen waar niets meer naar verwijst (bv. na het anonimiseren).
create table contacten (
  contact_id   text primary key,
  email_hash   text not null unique,
  email_enc    text,
  voornaam_enc text,
  naam_enc     text,
  telefoon_enc text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gewijzigd_op text
);

create table personen (
  persoon_id          text primary key,
  contact_id          text not null references contacten(contact_id) on delete cascade,
  voornaam_enc        text,
  naam_enc            text,
  naam_sleutel        text not null,
  mogelijk_dubbel_van text references personen(persoon_id) on delete set null,
  created_at          text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index personen_contact_idx on personen (contact_id);
