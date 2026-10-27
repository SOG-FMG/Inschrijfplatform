-- Gekopieerd uit src/modules/evenementen/migraties/herinnering.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Herinneringsmail per evenementdag: wanneer ze mag vertrekken, en wie ze al kreeg.
-- Leeg = geen herinnering voor die dag. De dagelijkse taak (crons in wrangler.toml) stuurt ze.
alter table evenement_dagen add column herinnering_op text;

-- Eén rij per deelnemer en dag, zodat een tweede cron-run niemand twee keer mailt. De rij wordt aangemaakt
-- vóór het versturen: breekt de Worker af, dan is een gemiste herinnering minder erg dan een dubbele.
create table herinneringen (
  deelnemer_id text not null references deelnemers(deelnemer_id) on delete cascade,
  dag_id       text not null references evenement_dagen(dag_id) on delete cascade,
  verstuurd_op text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (deelnemer_id, dag_id)
);
