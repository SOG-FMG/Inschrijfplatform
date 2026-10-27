-- Gekopieerd uit src/modules/mailsjablonen/migraties/logo_huisstijl.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Vinkje bij "Opmaak van alle mails": bovenaan de mail het logo van het evenement gebruiken
-- (Instellingen > Algemeen > Huisstijl) in plaats van de banner bovenaan. Standaard aan, zodat een mail
-- de huisstijl van haar eigen evenement volgt; heeft het evenement geen logo, dan valt de banner weer in.
alter table mailopmaak add column logo_uit_huisstijl integer not null default 1
  check (logo_uit_huisstijl in (0, 1));
