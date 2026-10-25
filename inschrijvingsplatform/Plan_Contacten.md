# Plan: contactenlijst

Status: fase 1 gebouwd (26 oktober 2026). Dit document beschrijft de contactenlijst in het dashboard: waarom, hoe ze in elkaar zit, wat er gebouwd is en wat volgt. Het is bedoeld voor wie aan het platform ontwikkelt en voor wie met de DPO afspreekt wat aan mag.

---

## 1. Wat we willen

Eén lijst met iedereen die in het platform voorkomt:

- medewerkers
- lesgevers (sessiegevers)
- ouders en inschrijvers, met hun kinderen

Per persoon zie je **waar** die voorkomt, met een link naar elk onderdeel. Bijvoorbeeld:

- Medewerker: organisator van Infodagen 2025-2026
- Lesgever: Infodagen 2025-2026 · Domein Kunst
- Ouder van Lotte: inschrijving Infodagen 2025-2026, voorinschrijving 2026-2027

Lesgevers blijven per evenement te beheren (Dashboard → evenement → Sessiegevers).

## 2. Uitgangspunten

| | Keuze | Waarom |
|---|---|---|
| Wie is één persoon? | **Eén e-mailadres = één persoon.** Samengevoegd op de blinde index van het adres (dezelfde als bij contacten en inschrijvingen). | Een leerkracht die medewerker, lesgever en ouder is, staat er één keer. |
| Waar komt "komt voor in" vandaan? | **Uit de gegevens zelf**, niet uit een aparte tabel. Elke module meldt in haar manifest waar personen voorkomen (`contactBronnen`). | Altijd actueel. Een nieuwe module (tickets, vrijwilligers, zalen) voegt zich vanzelf toe. Na het anonimiseren verdwijnen vermeldingen vanzelf. |
| Ouders en inschrijvers | **Standaard uit, ook voor de platformbeheerder.** Aan te zetten per rol in Medewerkers → Rollen en rechten (recht `kern.contacten.extern`). | De lijst brengt gegevens van ouders en kinderen over evenementen en schooljaren heen samen. Dat vraagt een afspraak met de DPO. |
| Bereik | Wie niet alle evenementen mag lezen, ziet enkel vermeldingen van de **eigen evenementen** (plus vermeldingen zonder evenement, zoals "Medewerker"). | Zelfde regels als overal (controleerToegang). |
| Logboek | Elke keer de lijst geopend wordt: een regel in `audit_log` (`contacten`, `LIJST`, met het aantal). | Controle achteraf. |

## 3. Opbouw

```
Dashboard → Contacten  (frontend/src/dashboard/Contacten.tsx)
        │  GET /api/beheer/contacten   recht kern.contacten.bekijken
        ▼
kern/contactenlijst.ts
        │  verzamelt de vermeldingen van alle actieve modules (Module.contactBronnen)
        │  - bronnen met extern: enkel met kern.contacten.extern
        │  - vermeldingen van evenementen die de medewerker niet mag lezen: weg
        │  ontsleutelt de contacten en personen (kinderen), voegt samen per e-mailadres
        ▼
bronnen
  kern               medewerkersbron.ts                 Medewerker (rol, gekoppelde evenementen)
  evenementen        contactbronnen.ts                  Lesgever, Inschrijving, Uitnodiging
  voorinschrijvingen contactbronnen.ts                  Voorinschrijving
```

Een bron (`ContactBron` in `kern/module.ts`) geeft vermeldingen terug met:

- een e-mailadres (intern) of een contact van de kern (extern)
- eventueel de persoon (het kind)
- soort, omschrijving, evenement, link en datum

### Rechten (Rollen en rechten)

| Recht | Standaard | Instelbaar voor |
|---|---|---|
| `kern.contacten.bekijken`: de lijst met medewerkers en lesgevers | platformbeheerder (altijd), schoolbeheerder | schoolbeheerder, organisator, onthaal, lesgever |
| `kern.contacten.extern`: ook ouders en inschrijvers | **niemand** | alle rollen, **ook de platformbeheerder** |

Nieuw in het modulecontract: `Recht.ookPlatformbeheerder`. Een platformbeheerder heeft altijd alle rechten, behalve een instelbaar recht met deze vlag: dat volgt het raster zoals voor elke rol. Het raster toont daarom nu ook de kolommen Platformbeheerder (vaste vakjes = "altijd") en Schoolbeheerder.

## 4. Fasen

| Fase | Inhoud | Status |
|---|---|---|
| **1** | Lijst met twee tabbladen (Medewerkers en lesgevers / Ouders en inschrijvers), zoeken, filter op soort en evenement, detail met "komt voor in" en links, export naar Excel. Ouders standaard uit. | **Gebouwd** |
| **1b** | **Contacten plakken**: adressen uit Outlook, losse adressen of Excel-rijen; de voornaam is het deel van de naam dat vooraan in het adres staat. Toevoegen als contact in een groep (tabel `contact_groepen`, migratie 0020; uit een groep halen in de details) of als lesgever (zonder evenement). Recht `kern.contacten.toevoegen` (standaard schoolbeheerder). | **Gebouwd** |
| **2** | Dubbels samenvoegen (bv. werk- en privéadres van dezelfde persoon; personen met `mogelijk_dubbel_van`). Gegevens van een contact aanpassen. Lesgevers ook los van een evenement toevoegen en wijzigen in de lijst. | Te doen |
| **3** | Inzage en vergeten: alle gegevens van één persoon exporteren of wissen over alle modules heen (GDPR). Elke module levert daarvoor een export- en wisfunctie naast haar bron. | Te doen |
| later | CRM: groepen, interacties, toestemming voor een nieuwsbrief (zie Plan_Modulair_Platform.md, module `crm`). | Later |

## 5. Aandachtspunten

- **DPO.** Zet `kern.contacten.extern` pas aan na afspraak: doel, wie het mag zien, vermelding in de privacytekst.
- **Grootte.** Namen zijn versleuteld; de lijst wordt bij elke opvraging ontsleuteld in de Worker. Dat werkt vlot tot enkele duizenden contacten. Daarboven: paginering en een zoekindex (blinde index op woorden van de naam).
- **Onleesbare waarden.** Een waarde die niet te ontsleutelen is (bv. na een fout met de sleutel), blokkeert de lijst niet: ze verschijnt als "(onleesbaar)".
- **Naam van een ouder.** Formulieren vragen vaak enkel de voornaam van de ouder; in de lijst staat dan die voornaam, met de kinderen ernaast.
