-- Contacten die met de hand toegevoegd werden (Dashboard → Contacten → Contacten plakken), met een groep (label).
-- Zolang een contact in een groep zit, ruimt de dagelijkse taak het niet op (persoonsverwijzing van de kern).
-- intern: adres van de eigen organisatie (AANMELD_DOMEINEN) bij het toevoegen; anders hoort het bij "Ouders en
-- inschrijvers" en is het enkel zichtbaar met het recht kern.contacten.extern.
create table contact_groepen (
  contact_id      text not null references contacten(contact_id) on delete cascade,
  groep           text not null,
  intern          integer not null default 0 check (intern in (0, 1)),
  toegevoegd_op   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  toegevoegd_door text references gebruikers(gebruiker_id) on delete set null,
  primary key (contact_id, groep)
);
