-- Gegenereerd door tools/genereer_seed.py – niet manueel aanpassen.
-- Voorbeeldevenement op basis van de infodagen 2026 van de Freinetmiddenschool Gent.

insert or ignore into rollen (rol_id, code, naam, beschrijving) values
  ('e4352a1b-1be0-525c-867e-b07de9320e1f', 'platformbeheerder', 'Platformbeheerder', 'Volledige toegang tot alle scholen en evenementen'),
  ('1bbb3d62-2a74-55b8-8d6a-f2bd6e53243d', 'schoolbeheerder', 'Schoolbeheerder', 'Beheert alle evenementen van de eigen school'),
  ('f6bec0c7-6718-56ab-8155-22efdcdbc5e6', 'organisator', 'Organisator', 'Beheert de evenementen waaraan hij/zij gekoppeld is'),
  ('52eedc96-70e6-5b4d-b479-72d69a3676f0', 'onthaal', 'Onthaal', 'Raadpleegt deelnemerslijsten en registreert aanwezigheid');

insert into soorten_onderdelen (soort_id, naam, beschrijving) values
  ('10bdefdc-9301-5d5d-a921-be621e2eee16', 'Proeflesje', 'Korte les voor toekomstige leerlingen'),
  ('02f8d0c3-855f-526b-91d1-514d68713483', 'Infomoment', 'Toelichting voor ouders en leerlingen'),
  ('bd999d8a-753d-5f44-aa17-beba0d75af55', 'Rondleiding', 'Begeleide rondgang door de school'),
  ('e7b97246-ef45-536c-b1ec-410eeae80c1f', 'Sessie', 'Sessie op een congres of studiedag'),
  ('46400cf3-d443-5c91-8255-7ff167fc1fe5', 'Workshop', 'Interactieve workshop');

insert into scholen (school_id, naam, onderwijsnet, postcode, gemeente) values
  ('24d62daf-4413-5925-a6c7-e2279ee6707b', 'Freinetmiddenschool Gent', 'Officieel gesubsidieerd onderwijs', '9000', 'Gent');

insert into locaties (locatie_id, school_id, naam, lokaal) values
  ('0cb14755-71d3-503a-a03c-7ff615d74b10', '24d62daf-4413-5925-a6c7-e2279ee6707b', 'Zaal Ami', 'Zaal Ami'),
  ('482a9599-9248-5146-a326-3a99512f57d5', '24d62daf-4413-5925-a6c7-e2279ee6707b', 'Kunstklas', 'Kunstklas'),
  ('0468190b-fe06-58ba-b3d4-8c75a51b6379', '24d62daf-4413-5925-a6c7-e2279ee6707b', '2A2', '2A2'),
  ('d16e772f-c6bc-544f-9d1e-aa37c1a5ea4a', '24d62daf-4413-5925-a6c7-e2279ee6707b', '2A3', '2A3'),
  ('e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', '24d62daf-4413-5925-a6c7-e2279ee6707b', '2A4', '2A4'),
  ('05d27203-025f-57f4-8128-f32eda5084ff', '24d62daf-4413-5925-a6c7-e2279ee6707b', '1A2', '1A2'),
  ('16e3ffce-b429-5f5c-a0d6-5642d4c1ad41', '24d62daf-4413-5925-a6c7-e2279ee6707b', '1A3', '1A3'),
  ('30ecdeef-7657-5ed9-9ad5-d16579bea148', '24d62daf-4413-5925-a6c7-e2279ee6707b', '1A5', '1A5'),
  ('1fb858fd-55f0-5bf3-8a99-daae868bb792', '24d62daf-4413-5925-a6c7-e2279ee6707b', '1A6', '1A6'),
  ('4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', '24d62daf-4413-5925-a6c7-e2279ee6707b', 'Labo', 'Labo'),
  ('0df5a989-2d78-5877-9c2d-210b1ce23163', '24d62daf-4413-5925-a6c7-e2279ee6707b', 'Techniek TOP', 'Techniek TOP');

insert into evenementen (evenement_id, slug, titel, omschrijving, type_evenement, organisator, school_id,
  start_datum, eind_datum, status, inschrijving_tot, deelnemer_type, leerjaar_opties, max_dagdelen,
  contact_email, privacy_tekst, bewaartermijn_dagen) values
  ('13a78c0d-b051-5f88-907f-af60b218cdc3', 'fmg-infodagen-2027', 'Infodagen 2027', 'Kom kennismaken met onze school! Kies een datum en een dagdeel en schrijf je in voor één of twee proeflesjes. Kom je liever gewoon eens kijken? Kies dan ‘geen proeflesje’.', 'Infodag', 'Freinetmiddenschool Gent', '24d62daf-4413-5925-a6c7-e2279ee6707b',
   '2027-01-23', '2027-03-06', 'gepubliceerd', '2027-03-04T22:59:00.000Z', 'leerling', '["4de leerjaar", "5de leerjaar", "6de leerjaar", "Andere"]', 1,
   'infodag@freinetmiddenschool.example', '[CONCEPT – te valideren door de DPO] De Freinetmiddenschool Gent (Stedelijk Onderwijs Gent) verwerkt deze gegevens enkel om je inschrijving voor de infodag te organiseren: groepen samenstellen, je een bevestiging en praktische info mailen en je contacteren bij wijzigingen. Enkel de organiserende medewerkers hebben toegang. Uiterlijk 30 dagen na de laatste infodag worden namen en contactgegevens verwijderd; enkel anonieme statistieken (herkomstschool, gemeente, leerjaar) blijven bewaard. Je kan je inschrijving zelf inkijken en annuleren via de link in je bevestigingsmail, en je hebt recht op inzage, verbetering en verwijdering.', 30);

insert into doelgroepen (doelgroep_id, evenement_id, naam, beschrijving, sessiekeuze, volgorde) values
  ('aebd48e9-2a44-5670-9df5-c6d02da806fc', '13a78c0d-b051-5f88-907f-af60b218cdc3', 'A-stroom', 'Leerlingen met getuigschrift lager onderwijs', 1, 1),
  ('668d3134-9316-51cd-b7b9-3b7c0c345047', '13a78c0d-b051-5f88-907f-af60b218cdc3', 'B-stroom', 'Hoofdzakelijk leerlingen zonder getuigschrift lager onderwijs', 1, 2);

insert into evenement_dagen (dag_id, evenement_id, naam, datum, start_uur, eind_uur, volgorde, sessiekeuze_tot) values
  ('589216b5-abe2-5643-9f5f-35058b45d8cf', '13a78c0d-b051-5f88-907f-af60b218cdc3', 'Zaterdag 23 januari', '2027-01-23', '10:00', '15:10', 1, '2027-01-21T22:59:00.000Z');
insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde, capaciteit) values
  ('d4b57878-556e-542c-bd58-bb3b6e103609', '589216b5-abe2-5643-9f5f-35058b45d8cf', 'Voormiddag', '10:00', '12:10', 1, null);
insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht) values
  ('3a92d155-06ad-5426-a008-e6e03e41eeed', 'd4b57878-556e-542c-bd58-bb3b6e103609', 'Onthaal', 'Verwelkoming in de inkomhal', '10:00', '10:10', 1, 'programma', 0),
  ('eb7efedc-3f09-52f8-b020-b8147d0e5639', 'd4b57878-556e-542c-bd58-bb3b6e103609', 'Keuzelesje 1', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '10:10', '10:50', 2, 'keuze', 0),
  ('9c5285f0-c3fd-5139-9c95-7a389bc8c1ee', 'd4b57878-556e-542c-bd58-bb3b6e103609', 'Rondleiding', 'Samen met je ouder(s) door de school', '10:50', '11:30', 3, 'programma', 0),
  ('e931ea16-9f9f-5927-9af4-4dc7bb92c21f', 'd4b57878-556e-542c-bd58-bb3b6e103609', 'Keuzelesje 2', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '11:30', '12:10', 4, 'keuze', 0);
insert into sessies (sessie_id, tijdsblok_id, soort_id, doelgroep_id, code, titel, beschrijving, locatie_id, capaciteit, uniek_per_deelnemer, volgorde) values
  ('2f3bba0e-d871-57c5-88ff-602e6ae19c57', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('f41b925d-2acc-506f-a13a-3d09add4b6db', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'latijn', 'Domein Latijn', null, 'd16e772f-c6bc-544f-9d1e-aa37c1a5ea4a', 15, 1, 2),
  ('9857dd6e-50bb-5738-ae53-442467625730', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 14, 1, 3),
  ('c855b832-d30d-598f-85b8-e59cd262f14b', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 14, 1, 4),
  ('769734aa-4c4a-5fbe-ab78-2e5d76299e13', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'nederlands', 'Nederlands – Escape Room', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 8, 1, 5),
  ('5556e78d-aadd-5057-a9f3-21e4b127cb6c', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '1fb858fd-55f0-5bf3-8a99-daae868bb792', 14, 1, 6),
  ('884d59bd-471b-5834-9ec0-86b2a5d338b5', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('5d8d8d34-9002-57bf-af86-2e4db9a8721c', 'eb7efedc-3f09-52f8-b020-b8147d0e5639', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99),
  ('c5445f7d-e689-5dd8-b432-fe63d6495e49', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('9d87fc2a-4e60-5e89-8c67-1f0799df3f23', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'latijn', 'Domein Latijn', null, 'd16e772f-c6bc-544f-9d1e-aa37c1a5ea4a', 15, 1, 2),
  ('e5a48234-7075-5515-a13a-f56db6b6452a', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 16, 1, 3),
  ('37e570db-cfa4-5bfb-a68b-285945d353fe', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'engels', 'Lesje Engels', null, '30ecdeef-7657-5ed9-9ad5-d16579bea148', 14, 1, 4),
  ('fd3f7294-681c-57b6-8a74-07e0f1460f63', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 14, 1, 5),
  ('92c63bb4-1c44-59a5-a90d-968606d3dde3', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'nederlands', 'Nederlands – Escape Room', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 14, 1, 6),
  ('d301bf01-a738-5c9d-b4a8-b3b88de0d001', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '1fb858fd-55f0-5bf3-8a99-daae868bb792', 14, 1, 7),
  ('40905aac-b9ec-54ac-86e9-407845a26649', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('0ca014a0-e947-5576-9928-2b860836fefe', 'e931ea16-9f9f-5927-9af4-4dc7bb92c21f', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99);

insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde, capaciteit) values
  ('d5c70999-91ff-571a-9667-ec1c99d8a2f6', '589216b5-abe2-5643-9f5f-35058b45d8cf', 'Namiddag', '13:00', '15:10', 2, null);
insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht) values
  ('c5014131-1293-5171-9b5d-10636ea0d7cf', 'd5c70999-91ff-571a-9667-ec1c99d8a2f6', 'Onthaal', 'Verwelkoming in de inkomhal', '13:00', '13:10', 1, 'programma', 0),
  ('affc6ed8-109e-5927-b9bc-cbc1eb4a9005', 'd5c70999-91ff-571a-9667-ec1c99d8a2f6', 'Keuzelesje 1', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '13:10', '13:50', 2, 'keuze', 0),
  ('e0f89c0e-eb18-51de-876b-9a10be0110c5', 'd5c70999-91ff-571a-9667-ec1c99d8a2f6', 'Rondleiding', 'Samen met je ouder(s) door de school', '13:50', '14:30', 3, 'programma', 0),
  ('dd93389d-4131-546d-a6b6-25e84043e4cf', 'd5c70999-91ff-571a-9667-ec1c99d8a2f6', 'Keuzelesje 2', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '14:30', '15:10', 4, 'keuze', 0);
insert into sessies (sessie_id, tijdsblok_id, soort_id, doelgroep_id, code, titel, beschrijving, locatie_id, capaciteit, uniek_per_deelnemer, volgorde) values
  ('f3605e92-9755-52a5-9bcf-007dacf791c0', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('83572e0a-4609-5b00-baf8-888c8c94e05b', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'latijn', 'Domein Latijn', null, 'd16e772f-c6bc-544f-9d1e-aa37c1a5ea4a', 15, 1, 2),
  ('22d3262e-4117-50e8-9bd4-56455b5044e1', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 18, 1, 3),
  ('30c9acf4-20d1-527f-a8fc-8f59d331fedc', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'engels', 'Lesje Engels', null, '30ecdeef-7657-5ed9-9ad5-d16579bea148', 14, 1, 4),
  ('cafe246e-c714-5b45-a601-0b0686321f34', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 14, 1, 5),
  ('02dedf85-438b-5393-af49-dcd0e13f8a5b', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'nederlands', 'Nederlands – Escape Room', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 14, 1, 6),
  ('03b88116-ae35-56c1-9902-cb47a58bb3cd', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('1b00f471-f570-567f-9e6c-ea6d500e9ec0', 'affc6ed8-109e-5927-b9bc-cbc1eb4a9005', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99),
  ('c3a4210d-bc53-5f9d-a899-c3fdcacf3340', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('5bbdcf13-eedf-5674-9098-756b0c2ac90e', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 18, 1, 2),
  ('a1bdfb19-459a-5bb3-ad89-f0798338ba6d', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'engels', 'Lesje Engels', null, '30ecdeef-7657-5ed9-9ad5-d16579bea148', 14, 1, 3),
  ('bbf4019e-67e9-52b8-b3c6-ef543fa5b8b2', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'frans', 'Lesje Frans', null, '16e3ffce-b429-5f5c-a0d6-5642d4c1ad41', 14, 1, 4),
  ('e0864dfb-08bd-5874-95c6-323f1af069db', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 14, 1, 5),
  ('191ca383-b2f7-5249-99a0-4117e1426544', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '1fb858fd-55f0-5bf3-8a99-daae868bb792', 14, 1, 6),
  ('3379e2b1-467b-5505-acd5-81bba0d4bcbe', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('d5d83e5e-95ae-5d09-8747-6983e7bd7c28', 'dd93389d-4131-546d-a6b6-25e84043e4cf', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99);

insert into evenement_dagen (dag_id, evenement_id, naam, datum, start_uur, eind_uur, volgorde, sessiekeuze_tot) values
  ('152bd1e9-4cbc-5f47-8629-386d9f381282', '13a78c0d-b051-5f88-907f-af60b218cdc3', 'Zaterdag 6 maart', '2027-03-06', '10:00', '15:10', 2, '2027-03-04T22:59:00.000Z');
insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde, capaciteit) values
  ('027a46a9-68aa-57fe-b781-c15f9e91d001', '152bd1e9-4cbc-5f47-8629-386d9f381282', 'Voormiddag', '10:00', '12:10', 1, null);
insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht) values
  ('e59743f7-84ea-5b59-b49a-71828a4f4669', '027a46a9-68aa-57fe-b781-c15f9e91d001', 'Onthaal', 'Verwelkoming in de inkomhal', '10:00', '10:10', 1, 'programma', 0),
  ('019bb28d-7f39-52f3-8d11-562afb684609', '027a46a9-68aa-57fe-b781-c15f9e91d001', 'Keuzelesje 1', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '10:10', '10:50', 2, 'keuze', 0),
  ('e8dddf08-b38c-586e-8a38-806408c6fd4f', '027a46a9-68aa-57fe-b781-c15f9e91d001', 'Rondleiding', 'Samen met je ouder(s) door de school', '10:50', '11:30', 3, 'programma', 0),
  ('2f7cde38-94e5-57ca-8c2a-b746a680d910', '027a46a9-68aa-57fe-b781-c15f9e91d001', 'Keuzelesje 2', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '11:30', '12:10', 4, 'keuze', 0);
insert into sessies (sessie_id, tijdsblok_id, soort_id, doelgroep_id, code, titel, beschrijving, locatie_id, capaciteit, uniek_per_deelnemer, volgorde) values
  ('7e118bf1-0072-5dbf-b898-a423805c2dca', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('5091adbc-d824-5105-bab3-e90be3365fb2', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'maatschappij', 'Domein Maatschappij', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 12, 1, 2),
  ('5401e312-6bd8-5e83-b8c9-a6ec663a24c6', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 14, 1, 3),
  ('d7e36209-5746-51b5-96a0-e5526c0e5410', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 12, 1, 4),
  ('dc8e4a49-139b-5d03-8a5f-807ad16a0ce8', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '05d27203-025f-57f4-8128-f32eda5084ff', 12, 1, 5),
  ('846e8f17-beb3-5026-80d0-dded21491f21', '019bb28d-7f39-52f3-8d11-562afb684609', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('b31b4fd3-8410-55e6-9988-80b58915f21e', '019bb28d-7f39-52f3-8d11-562afb684609', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99),
  ('81cf9b2f-a88f-53a7-8dd1-6413ede51471', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('cda694a8-3b00-5c17-aac7-cae6b77bd255', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'maatschappij', 'Domein Maatschappij', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 12, 1, 2),
  ('fee05fb4-12ef-5933-ac32-97ba826ae75d', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 14, 1, 3),
  ('d27b5b9c-252b-5db0-898d-5ea6afe87474', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 12, 1, 4),
  ('4e908a7e-e49f-5201-a2ce-bcbb0afa9864', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '05d27203-025f-57f4-8128-f32eda5084ff', 12, 1, 5),
  ('7ab437a2-6b35-5cb0-8261-0b8092d8de61', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('ef1898c3-306e-54e9-8df3-b0e04a075559', '2f7cde38-94e5-57ca-8c2a-b746a680d910', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99);

insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde, capaciteit) values
  ('97ecfe71-7293-5a4a-9768-3bdbaf7f51de', '152bd1e9-4cbc-5f47-8629-386d9f381282', 'Namiddag', '13:00', '15:10', 2, null);
insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, omschrijving, start_uur, eind_uur, volgorde, type, verplicht) values
  ('f207ebac-0d16-5e6c-83d2-abb7120794ec', '97ecfe71-7293-5a4a-9768-3bdbaf7f51de', 'Onthaal', 'Verwelkoming in de inkomhal', '13:00', '13:10', 1, 'programma', 0),
  ('b9428440-0595-543c-92a0-5cf26295f4ae', '97ecfe71-7293-5a4a-9768-3bdbaf7f51de', 'Keuzelesje 1', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '13:10', '13:50', 2, 'keuze', 0),
  ('c5bda625-ab5d-5101-9660-031fd2da8149', '97ecfe71-7293-5a4a-9768-3bdbaf7f51de', 'Rondleiding', 'Samen met je ouder(s) door de school', '13:50', '14:30', 3, 'programma', 0),
  ('fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '97ecfe71-7293-5a4a-9768-3bdbaf7f51de', 'Keuzelesje 2', 'Leerlingen volgen een proeflesje – ouders krijgen info over onze schoolwerking en zorg', '14:30', '15:10', 4, 'keuze', 0);
insert into sessies (sessie_id, tijdsblok_id, soort_id, doelgroep_id, code, titel, beschrijving, locatie_id, capaciteit, uniek_per_deelnemer, volgorde) values
  ('730f65a2-9dc4-586b-8d41-5072e8fe4a50', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('ec3f27e9-f702-5bc4-8c8f-2eb774fdb711', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'latijn', 'Domein Latijn', null, 'd16e772f-c6bc-544f-9d1e-aa37c1a5ea4a', 10, 1, 2),
  ('0969956f-3d9f-5dbb-b5e1-9c42ad53f0d8', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'maatschappij', 'Domein Maatschappij', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 12, 1, 3),
  ('eaa61157-f5eb-5f3a-a25e-e1765799b29c', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 14, 1, 4),
  ('2a385efa-d460-54c4-b88d-7f172299b73d', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 12, 1, 5),
  ('b40f0570-e1b8-57d0-912f-17214c33bba2', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '05d27203-025f-57f4-8128-f32eda5084ff', 12, 1, 6),
  ('1d9338fb-a6b2-5bac-950f-462fcc09c16a', 'b9428440-0595-543c-92a0-5cf26295f4ae', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('d7241775-f88a-5a69-b545-e00101b0db67', 'b9428440-0595-543c-92a0-5cf26295f4ae', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99),
  ('b783436e-f269-5dab-a7a1-9218fe5c26c5', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'kunst', 'Domein Kunst', null, '482a9599-9248-5146-a326-3a99512f57d5', 14, 1, 1),
  ('c66fe91a-d2e8-5b22-9f57-58f8f4267917', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'maatschappij', 'Domein Maatschappij', null, '0468190b-fe06-58ba-b3d4-8c75a51b6379', 12, 1, 2),
  ('f21a4ec9-7463-5aad-a767-45551c383e6e', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wetenschappen', 'Domein Wetenschappen', null, '4d289a1d-6dd8-56be-be5c-2dbec3a59ac4', 14, 1, 3),
  ('0ce20cde-57e7-5b04-bbae-3981abb96215', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'geschiedenis', 'Lesje Geschiedenis', null, 'e11d9dc6-345c-5bf1-ac01-88ae7c4e37d0', 12, 1, 4),
  ('28e1d1b1-6f30-5c57-a11b-9e8585d3d375', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', 'aebd48e9-2a44-5670-9df5-c6d02da806fc', 'wiskunde', 'Lesje Wiskunde', null, '05d27203-025f-57f4-8128-f32eda5084ff', 12, 1, 5),
  ('5111473c-5e67-5575-8491-f28429ab891d', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '10bdefdc-9301-5d5d-a921-be621e2eee16', '668d3134-9316-51cd-b7b9-3b7c0c345047', 'bstroom', 'Proeflesje B-stroom', 'Praktijkgericht proeflesje in de technieklokalen', '0df5a989-2d78-5877-9c2d-210b1ce23163', 12, 0, 50),
  ('d198aa0b-9edc-52fa-9d52-62322e5a30f2', 'fa679fd5-bd56-5b25-9bf2-bd652ad6909b', '02f8d0c3-855f-526b-91d1-514d68713483', null, 'infomoment', 'Infomoment samen met je ouder(s)', 'Geen proeflesje: je blijft bij je ouder(s) tijdens de infosessie', '0cb14755-71d3-503a-a03c-7ff615d74b10', null, 0, 99);
