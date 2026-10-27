-- Gekopieerd uit src/modules/evenementen/migraties/tijdsblok_zichtbaar.sql door tools/migraties.mjs. Wijzig de bron, niet deze kopie.
-- Een tijdsblok kunnen verbergen, zoals een sessie dat al kon (sessies.zichtbaar).
-- Verborgen = weg uit het inschrijfformulier, met zijn lesjes, en niet te kiezen via de API. In de
-- instellingen blijft het staan, zodat je het weer kan aanzetten.
alter table tijdsblokken add column zichtbaar integer not null default 1 check (zichtbaar in (0, 1));
