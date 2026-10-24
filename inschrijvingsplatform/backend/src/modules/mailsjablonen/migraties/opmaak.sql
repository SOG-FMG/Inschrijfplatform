-- Opmaak van alle mails (module mailsjablonen): banner bovenaan en onderaan (R2: mailbeelden/<naam>) en een eigen
-- voettekst. De regel wie de mail stuurt en waarom, staat er altijd onder (kern/sjablonen.ts) en is niet aan te passen.
create table mailopmaak (
  id             integer primary key check (id = 1),
  kop_banner     text,
  voet_banner    text,
  voettekst      text,
  gewijzigd_op   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  gewijzigd_door text references gebruikers(gebruiker_id) on delete set null
);
