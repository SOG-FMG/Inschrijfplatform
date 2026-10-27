-- Momenten en tijdsblokken per doelgroep: de A-stroom kan andere momenten krijgen dan de B-stroom.
--
-- momenten_modus op de doelgroep bepaalt hoe het gelezen wordt:
--   'alle'  (standaard) alle momenten van het evenement gelden; de koppeltabellen worden niet gelezen
--   'eigen' enkel wat in de koppeltabellen staat; is dat leeg, dan geldt alles (een half ingestelde
--           doelgroep mag het formulier niet leegmaken)
--   'volgt' neemt over van volgt_doelgroep_id, en maar één stap diep: een doelgroep die zelf volgt, kan
--           niet gevolgd worden. Zo kan er geen kring ontstaan waarin het formulier vastloopt.
alter table doelgroepen add column momenten_modus text not null default 'alle'
  check (momenten_modus in ('alle', 'eigen', 'volgt'));
alter table doelgroepen add column volgt_doelgroep_id text references doelgroepen(doelgroep_id) on delete set null;

create table dagdeel_doelgroepen (
  dagdeel_id   text not null references dagdelen(dagdeel_id) on delete cascade,
  doelgroep_id text not null references doelgroepen(doelgroep_id) on delete cascade,
  primary key (dagdeel_id, doelgroep_id)
);
create index dagdeel_doelgroepen_doelgroep_idx on dagdeel_doelgroepen (doelgroep_id);

create table tijdsblok_doelgroepen (
  tijdsblok_id text not null references tijdsblokken(tijdsblok_id) on delete cascade,
  doelgroep_id text not null references doelgroepen(doelgroep_id) on delete cascade,
  primary key (tijdsblok_id, doelgroep_id)
);
create index tijdsblok_doelgroepen_doelgroep_idx on tijdsblok_doelgroepen (doelgroep_id);
