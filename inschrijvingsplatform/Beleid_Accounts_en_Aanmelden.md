# Beleid: accounts en aanmelden

Status: voorstel, versie 1 (24 oktober 2026). Dit document beschrijft wie zich hoe aanmeldt, hoe lang een account geldig blijft, hoe accounts nagekeken en hersteld worden, en op welke standaarden dat steunt. Het hoort bij [Plan_Modulair_Platform.md](Plan_Modulair_Platform.md) en is bedoeld voor de ontwikkelaar, voor de beheerders van elke organisatie en voor de DPO.

---

## 1. Twee niveaus

| Niveau | Wie | Wat mag die | Waar |
|---|---|---|---|
| **Platform** (operator) | Valentijn, plus één noodaccount | Installaties opzetten en bijwerken, de eerste beheerders van een organisatie aanmaken, een organisatie helpen als al haar beheerders hun toegang kwijt zijn | In elke installatie, vastgelegd in de configuratie (niet in het dashboard) |
| **Organisatie** | Beheerders en medewerkers van één organisatie (FMG, Meulestede, …) | Evenementen, deelnemers, tickets en medewerkers van die organisatie, volgens hun rol | Enkel in de eigen installatie |
| *Publiek* | Ouders, bezoekers, kopers | Geen account: een persoonlijke link in de bevestigingsmail (zoals nu) | |

### 1.1 Het platformniveau

- **Twee operatoraccounts**: je dagelijkse account en een **noodaccount** (*break-glass*). Het noodaccount gebruik je enkel als je dagelijkse account niet meer werkt. Het heeft een eigen beveiligingssleutel (bv. een YubiKey) en herstelcodes, offline bewaard (kluis of verzegelde envelop). Elk gebruik stuurt automatisch een mail naar beide operatoradressen. Na gebruik vervang je de herstelcodes.
- **Een e-mailadres dat niet van je werkgever is**, op een eigen domein. Verlaat je ooit Onderwijs Gent, dan verlies je anders de toegang tot de installaties van andere organisaties.
- **Aanmelden enkel met een passkey of beveiligingssleutel.** Geen wachtwoord, geen code per mail: operatoraccounts zijn het grootste doelwit.
- **Kortere sessies** dan medewerkers: 1 uur zonder activiteit, 4 uur maximaal.
- **Geen toegang tot persoonsgegevens zonder reden.** Als operator ben je verwerker (GDPR): je kijkt enkel in de gegevens van een organisatie op haar vraag. Concreet:
  - accounts herstellen en instellingen nakijken kan zonder persoonsgegevens te zien
  - inzage in deelnemers en bestellingen vraagt **ondersteuningstoegang**: een beheerder van de organisatie zet die aan voor een beperkte tijd (bv. 24 uur)
  - in een noodgeval kan je die toegang zelf aanzetten, maar dan krijgen alle beheerders van de organisatie meteen een mail, en het staat in het auditlog
- **Continuïteit**: je bent de enige ontwikkelaar. Leg schriftelijk vast wat er gebeurt als jij wegvalt, bv. een vertrouwenspersoon met toegang tot het noodaccount en een korte handleiding, of een afspraak met de organisaties over het overnemen van de code (plan A).

### 1.2 Het organisatieniveau

- Elke organisatie heeft **minstens twee beheerders**. Het dashboard waarschuwt zolang er maar één is. Zo kan altijd iemand anders een account herstellen of goedkeuren.
- Bij elke organisatie staat een **contactpersoon** voor het platform, met naam en telefoonnummer, vastgelegd in de verwerkersovereenkomst. Die persoon bevestigt een herstel als alle beheerders hun toegang kwijt zijn (zie 5).

---

## 2. Drie soorten accounts per organisatie

Welke soorten een organisatie gebruikt, ligt vast in de configuratie van haar installatie.

| Soort | Voor wie | Aanmelden | Wie houdt het account actueel |
|---|---|---|---|
| **SSO** | Adressen op het domein van de organisatie met SSO, bv. `@meulestede.gent` | Via Microsoft 365 of Google van de organisatie (OpenID Connect) | De organisatie zelf: wie daar vertrekt, kan niet meer aanmelden |
| **Werkadres zonder SSO** | Adressen op een domein van de organisatie zonder SSO | Passkey, of wachtwoord + authenticator-app (zoals nu), met een **e-mailcontrole om de 6 maanden** | De e-mailcontrole: wie zijn werkmailbox kwijt is, komt niet meer binnen |
| **Privé-adres** | Vrijwilligers, freelancers, externe partners met een eigen mailbox | Passkey, of wachtwoord + authenticator-app, met de e-mailcontrole | **Jaarlijkse goedkeuring** door een beheerder |

Voor alle soorten geldt: **enkel wie uitgenodigd is, komt binnen.** Een geldig SSO-account of werkadres alleen geeft geen toegang. Een beheerder voegt de persoon toe en kiest een rol.

### 2.1 SSO

- Ingesteld per domein. Voor een SSO-domein is **SSO verplicht**: een adres `@meulestede.gent` kan dan niet aanmelden met een wachtwoord of code. Zo kan iemand die bij de organisatie vertrokken is ook niet via een omweg binnen.
- Voor SSO aangezet wordt, toont de organisatie dat het domein van haar is, met een **DNS-controle** (een TXT-record dat het platform opgeeft). Dat is de gewoonte bij Google Workspace, Microsoft 365, Slack en Atlassian.
- De tweede factor (MFA) regelt de organisatie in haar eigen Microsoft 365 of Google. Het platform kan eisen dat de aanmelding met MFA gebeurde, als de provider dat meegeeft.
- Later kan de organisatie accounts automatisch laten bijwerken met **SCIM** (een standaard om accounts aan te maken en uit te schakelen vanuit Microsoft 365 of Google). Dat is pas nodig bij veel medewerkers.

### 2.2 De e-mailcontrole (werkadres en privé-adres)

Je voorstel was een code naar het e-mailadres. Volgens NIST SP 800-63B mag een code per mail **niet de enige manier van aanmelden** zijn voor een toepassing met persoonsgegevens: wie de mailbox overneemt, neemt dan ook het account over. Ik stel daarom voor de code te gebruiken als **extra controle**, bovenop passkey of wachtwoord + authenticator-app:

- **Om de 6 maanden** (180 dagen na de vorige controle) vraagt het platform bij het aanmelden een code die naar het e-mailadres gemaild wordt. Werkt de mailbox niet meer, dan komt de persoon niet verder. Zo zie je of iemand zijn werkadres nog heeft.
- Ook **bij een nieuw toestel** of na een herstel van de tweede factor.
- De code is 6 cijfers, 10 minuten geldig, één keer bruikbaar, met maximaal 5 pogingen.

### 2.3 Jaarlijkse goedkeuring van privé-adressen

Een privé-adres zegt niets over de band met de organisatie. Daarom keurt een beheerder het account elk jaar opnieuw goed (*toegangsreview*, zie ISO 27001 A.5.18).

| Moment | Wat gebeurt er |
|---|---|
| 30 dagen voor de vervaldatum | **Herinnering 1** aan de beheerders: "Keur het account van X goed of zet het stop" (met één klik in het dashboard) |
| 14 dagen voor de vervaldatum | **Herinnering 2** aan de beheerders |
| 7 dagen voor de vervaldatum | Nog niet goedgekeurd: **de persoon zelf** krijgt een mail: "Je toegang vervalt op …; vraag een van deze beheerders om goedkeuring: …" |
| Vervaldatum | Het account wordt **geblokkeerd**, niet verwijderd. De persoon en de beheerders krijgen een mail. Een beheerder kan het met één klik heractiveren |
| 90 dagen na de blokkering | Het account wordt **verwijderd** (minimale gegevens, GDPR). Het auditlog blijft, zonder persoonsgegevens |

Regels daarbij:

- Niemand keurt **zijn eigen account** goed.
- Een privé-adres krijgt **geen beheerdersrol**. Beheerders hebben een werkadres of SSO.
- Reageren de beheerders niet, dan kan de persoon bij een andere beheerder terecht. Is er geen beheerder meer bereikbaar, dan contacteert een beheerder of de contactpersoon de operator (zie 5).
- De termijnen (1 jaar, 30/14/7 dagen, 90 dagen) zijn per installatie instelbaar, binnen grenzen.

---

## 3. Levenscyclus van een account

De gangbare indeling heet *joiner-mover-leaver* (nieuw, wijzigt van functie, vertrekt):

| Toestand | Betekenis | Naar |
|---|---|---|
| **Uitgenodigd** | Toegevoegd door een beheerder, uitnodigingscode 7 dagen geldig (zoals nu) | Actief, of verlopen uitnodiging |
| **Actief** | Kan aanmelden | Slapend, geblokkeerd, gedeactiveerd |
| **Slapend** | 12 maanden niet aangemeld | Bij de volgende aanmelding: e-mailcontrole en goedkeuring door een beheerder |
| **Geblokkeerd** | Goedkeuring verlopen, of e-mailcontrole mislukt | Actief (beheerder heractiveert), of verwijderd na 90 dagen |
| **Gedeactiveerd** | Door een beheerder stopgezet (vertrek) | Actief (heractiveren), of verwijderd na 90 dagen |
| **Verwijderd** | Persoonsgegevens weg, enkel het auditlog blijft | |

- **Inactiviteit**: CIS Controls v8 (5.3) raadt aan slapende accounts na 45 dagen uit te schakelen. Voor evenementen die maar één keer per jaar plaatsvinden (de infodagen van FMG) is dat te streng. Ik stel 12 maanden voor, instelbaar per installatie.
- **Rolwijziging** (*mover*): een rol wijzigen of toegang tot een evenement afnemen werkt meteen, en lopende sessies worden afgesloten.
- **Vertrek** (*leaver*): bij SSO regelt de organisatie het zelf. Zonder SSO vangt de e-mailcontrole het binnen 6 maanden op. Beter is dat de beheerder het account meteen deactiveert, en dat staat ook in de checklist voor beheerders.

---

## 4. Wachtwoorden, tweede factor en sessies

Volgens NIST SP 800-63B, wat het platform nu al grotendeels doet:

- Wachtwoord minstens 12 tekens, **geen verplichte wissel** om de zoveel maanden (dat leidt tot zwakkere wachtwoorden). Wel wisselen bij een vermoeden van misbruik.
- Altijd een **tweede factor**: authenticator-app of passkey. Passkeys hebben de voorkeur, omdat ze bestand zijn tegen phishing.
- Blokkade na herhaalde foute pogingen (nu: 5 per adres of 20 per IP, 15 minuten).
- Sessies: 8 uur maximaal, 2 uur zonder activiteit (medewerkers); 4 uur en 1 uur (operator).
- **Beveiligingsmails** aan de gebruiker bij: aanmelden op een nieuw toestel, tweede factor gewijzigd of hersteld, nieuwe passkey, rolwijziging, blokkering. Zo merkt iemand meteen als een ander zijn account gebruikt.

---

## 5. Herstel

| Probleem | Wie helpt | Hoe |
|---|---|---|
| Medewerker is zijn passkey of authenticator-app kwijt | Een beheerder van de organisatie | *2FA opnieuw instellen* (bestaat al): nieuwe uitnodigingscode, persoonlijk of via een ander kanaal doorgegeven. De beheerder controleert eerst wie er belt (stem, Teams, persoonlijk) |
| Medewerker is zijn werkmailbox kwijt | Niemand | Dat is de bedoeling: het account hoort niet meer bij die persoon. Een beheerder maakt zo nodig een nieuw account aan |
| Medewerker met SSO kan niet aanmelden | De IT-dienst van de organisatie | Probleem bij Microsoft 365 of Google, niet bij het platform |
| Een beheerder is zijn toegang kwijt | Een andere beheerder | Zoals bij een medewerker |
| **Alle beheerders** zijn hun toegang kwijt | De operator | De contactpersoon van de organisatie vraagt het aan. De operator belt die terug op het nummer uit de verwerkersovereenkomst (niet het nummer uit de vraag), maakt een nieuwe uitnodigingscode voor één beheerder en mailt alle beheerders dat dit gebeurd is. Het staat in het auditlog |
| Operator is zijn dagelijkse account kwijt | Het noodaccount | Zie 1.1 |

Regel bij elk herstel: **controleren buiten het platform om** wie de vraag stelt, en de betrokkenen achteraf verwittigen. Social engineering ("ik ben de directeur, ik moet er dringend in") is de gewone manier waarop accounts gestolen worden.

---

## 6. Standaarden en gewoontes waarop dit steunt

| Bron | Wat we eruit halen |
|---|---|
| **NIST SP 800-63B** (Digital Identity Guidelines) | Tweede factor, phishingbestendige factor voor beheer, geen verplichte wachtwoordwissel, mail niet als enige factor, herstel met nieuwe controle van de identiteit |
| **ISO/IEC 27001:2022**, bijlage A | 5.15 toegangsbeleid, 5.16 identiteitsbeheer, 5.17 authenticatie-informatie, 5.18 toegangsrechten en periodieke review, 8.2 bevoorrechte toegang, 8.5 veilige authenticatie |
| **CIS Controls v8** | 5.1 overzicht van accounts, 5.3 slapende accounts uitschakelen, 6.3 tot 6.5 MFA voor externe en beheertoegang |
| **OWASP ASVS** | Technische eisen voor aanmelden, sessies en herstel (controlelijst voor de code) |
| **GDPR**, art. 5 en 32 | Minimale gegevens, accounts niet langer bewaren dan nodig, passende beveiliging, verwerker kijkt enkel op instructie |
| Gewoonte bij Microsoft en andere | Twee noodaccounts (*break-glass*) die buiten de gewone aanmeldketen staan |
| Gewoonte bij SaaS-platformen | Domein bewijzen met DNS, SSO verplicht voor dat domein, ondersteuningstoegang die de klant zelf aanzet |
| **OpenID Connect**, **SCIM 2.0** | Standaarden voor SSO en voor het automatisch bijwerken van accounts |

---

## 7. Instellingen per installatie

| Instelling | Voorbeeld FMG | Voorbeeld Meulestede |
|---|---|---|
| `AANMELD_DOMEINEN` (werkadres zonder SSO) | `onderwijs.gent.be` | (leeg) |
| SSO-domeinen en provider | (geen) | `meulestede.gent` via Microsoft 365 |
| Privé-adressen toegelaten | nee | ja (vrijwilligers) |
| E-mailcontrole | 180 dagen | 180 dagen |
| Goedkeuring privé-adressen | n.v.t. | 365 dagen |
| Inactief na | 12 maanden | 12 maanden |
| Operators | jouw adres + noodaccount | idem |

---

## 8. Plaats in de fases

Dit komt in **fase 2 (Aanmelden)** van het plan, in deze volgorde:

1. **Operatorrol en noodaccount**: rol los van de beheerders van de organisatie, vastgelegd in de configuratie, enkel met passkey, ondersteuningstoegang
2. **Levenscyclus**: soort account (SSO, werk, privé), toestanden, e-mailcontrole om de 6 maanden, inactiviteit, beveiligingsmails, minstens twee beheerders
3. **Jaarlijkse goedkeuring** van privé-adressen met de herinneringen (dagelijkse taak die al bestaat)
4. **SSO** via OpenID Connect, met DNS-controle van het domein en SSO verplicht voor dat domein
5. Later: **SCIM**

Een deel daarvan (operatorrol, rechten) hangt samen met stap 0.7 van fase 0 (rechten in plaats van rolnamen) en wordt daar voorbereid.
