import { createContext, useContext, type ReactNode } from 'react';

/**
 * De handleidingen van het dashboard: per onderwerp stappen die je doorloopt. Links in de uitleg openen de
 * betrokken pagina in een nieuw tabblad; ":ev" in een link wordt het evenement waar je vandaan kwam (of, zonder
 * evenement, de lijst van evenementen). HELP_PER_PAD bepaalt welke stap "Help bij deze pagina" opent.
 * Een nieuwe pagina in het dashboard: voeg een stap toe en een regel in HELP_PER_PAD.
 */

export interface Stap { id: string; titel: string; inhoud: ReactNode }
export interface Handleiding { id: string; titel: string; voorWie: string; stappen: Stap[] }

/** Het evenement waar de gebruiker vandaan kwam (uit ?evenement=), voor de links. */
export const HelpEvenement = createContext<string | null>(null);

/** Link naar een pagina van het dashboard, in een nieuw tabblad. */
export function Naar({ pad, children }: { pad: string; children: ReactNode }) {
  const ev = useContext(HelpEvenement);
  const zonderEv = pad.includes(':ev') && !ev;
  const href = zonderEv ? '/dashboard' : pad.replace(':ev', ev ?? '');
  return (
    <a href={href} target="_blank" rel="noopener" className="help-naar">
      {children} ↗{zonderEv && <span className="d-klein"> (kies daar het evenement)</span>}
    </a>
  );
}

const Tip = ({ children }: { children: ReactNode }) => <div className="d-melding d-melding--info help-tip"><strong>Tip.</strong> {children}</div>;
const Let = ({ children }: { children: ReactNode }) => <div className="d-melding d-melding--let-op help-tip"><strong>Let op.</strong> {children}</div>;

export const HANDLEIDINGEN: Handleiding[] = [
  {
    id: 'start',
    titel: 'Aan de slag',
    voorWie: 'Iedereen',
    stappen: [
      {
        id: 'aanmelden',
        titel: 'Aanmelden',
        inhoud: (
          <>
            <p>Je meldt je aan op <Naar pad="/dashboard">het dashboard</Naar> met je e-mailadres van school, je wachtwoord en de code van 6 cijfers uit je authenticator-app (Microsoft Authenticator, Google Authenticator …). Met een passkey (pincode of vingerafdruk van je laptop) gaat het in één keer.</p>
            <p>De eerste keer gebruik je de <strong>uitnodigingscode</strong> die je van een platformbeheerder kreeg, op <Naar pad="/dashboard/activeren">Account activeren</Naar>. Die code is 7 dagen geldig.</p>
            <Tip>Je blijft maximaal 8 uur aangemeld, en na 2 uur zonder activiteit meld je je opnieuw aan.</Tip>
          </>
        ),
      },
      {
        id: 'account',
        titel: 'Je account beveiligen',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/account">Mijn account</Naar> wijzig je je wachtwoord (minstens 12 tekens), stel je de authenticator-app opnieuw in, en voeg je een <strong>passkey</strong> toe.</p>
            <ol>
              <li>Klik bij <em>Passkeys</em> op toevoegen en geef het toestel een naam (bv. "laptop school").</li>
              <li>Bevestig met de pincode of vingerafdruk van je toestel.</li>
              <li>Voortaan kies je bij het aanmelden voor de passkey.</li>
            </ol>
          </>
        ),
      },
      {
        id: 'menu',
        titel: 'Het menu',
        inhoud: (
          <>
            <p>Links staat het menu. Wat je ziet, hangt af van je rol en de evenementen waaraan je gekoppeld bent.</p>
            <ul>
              <li><Naar pad="/dashboard">Evenementen</Naar>: de lijst, met per evenement Overzicht, Instellingen, Aanwezigheid, Sessiegevers, Rapporten, Etiketten en de export naar Excel.</li>
              <li><Naar pad="/dashboard/voorinschrijvingen">Voorinschrijvingen</Naar>: formulieren, imports, statistieken en uitnodigen.</li>
              <li><Naar pad="/dashboard/importeren">Importeren</Naar>: gegevens van een schooljaar inladen.</li>
              <li>Medewerkers, Meldingen, Mailteksten en Privacy: voor beheerders.</li>
            </ul>
            <p>Onderaan het menu staat <strong>Help bij deze pagina</strong>: dat opent deze handleiding bij de stap over de pagina waar je bent.</p>
          </>
        ),
      },
      {
        id: 'melden',
        titel: 'Een probleem of idee melden',
        inhoud: (
          <>
            <p>Rechtsonder op elke pagina staat <strong>Probleem of idee?</strong>. Kies <em>Er loopt iets mis</em> of <em>Ik heb een wens of idee</em> en beschrijf kort wat er gebeurde.</p>
            <p>Er gaat een schermafbeelding mee (ingevulde velden en namen worden onherkenbaar gemaakt; je kan ze uitvinken) en technische gegevens die je vooraf kan bekijken.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'evenement',
    titel: 'Een infodag opzetten',
    voorWie: 'Organisatoren',
    stappen: [
      {
        id: 'nieuw',
        titel: 'Nieuw evenement',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard">Evenementen</Naar> klik je <strong>+ Nieuw evenement</strong> (enkel voor platformbeheerders). Geef een titel, het adres (slug) en de eerste en laatste dag.</p>
            <p>Het evenement start als <strong>concept</strong>: ouders zien het nog niet. Zo kan je alles rustig instellen.</p>
            <Tip>Het adres wordt de link naar het formulier, bv. <code>/fmg-infodagen-2027</code>. Kies het goed: het staat later in mails en op affiches.</Tip>
          </>
        ),
      },
      {
        id: 'algemeen',
        titel: 'Algemene gegevens',
        inhoud: (
          <>
            <p>In <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar>, blok <em>Algemeen</em>:</p>
            <ul>
              <li><strong>Inschrijven vanaf / tot</strong>: leeg = meteen open, tot het evenement.</li>
              <li><strong>Keuzes voor leerjaar</strong>, gescheiden door komma's (bv. 5de leerjaar, 6de leerjaar).</li>
              <li><strong>E-mailadres voor vragen</strong>: staat op het formulier en in de bevestigingsmail.</li>
              <li><strong>Logo, hoofdkleur en accentkleur</strong> voor het formulier en de mails.</li>
            </ul>
            <p>Met <em>Wijzigingen ongedaan maken</em> zet je een blok terug zoals het bewaard was.</p>
          </>
        ),
      },
      {
        id: 'doelgroepen',
        titel: 'Doelgroepen (A- en B-stroom)',
        inhoud: (
          <>
            <p>Bij <em>Doelgroepen</em> in <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar> maak je bv. <strong>A-stroom</strong> en <strong>B-stroom</strong>. De ouder kiest er één op het formulier.</p>
            <ul>
              <li>Een lesje met een doelgroep is enkel zichtbaar voor die doelgroep; zonder doelgroep ziet iedereen het.</li>
              <li>Zet <em>Kiest lesjes</em> uit als die doelgroep enkel een moment kiest (bv. de B-stroom).</li>
            </ul>
            <p>Geen doelgroepen = iedereen ziet dezelfde lesjes.</p>
          </>
        ),
      },
      {
        id: 'momenten',
        titel: 'Dagen en momenten',
        inhoud: (
          <>
            <p>Bij <em>Dagen, momenten en lesjes</em> in <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar>:</p>
            <ol>
              <li><strong>Dag toevoegen</strong>: naam (bv. Zaterdag 24 januari), datum en uren. Met <em>Lesjes kiezen tot</em> sluit je de keuze van lesjes af, terwijl inschrijven voor een moment nog kan.</li>
              <li><strong>Moment (dagdeel) toevoegen</strong>: bv. Voormiddag 10:00–12:10, met een maximum aantal deelnemers (leeg = onbeperkt).</li>
            </ol>
            <Tip>Een moment met alle tijdsblokken en lesjes kopieer je naar een andere dag met <em>Kopiëren naar andere dag…</em>.</Tip>
          </>
        ),
      },
      {
        id: 'lesjes',
        titel: 'Tijdsblokken en lesjes',
        inhoud: (
          <>
            <p>Binnen een moment voeg je <strong>tijdsblokken</strong> toe (bv. Keuzelesje 1 om 10:10, Rondleiding om 10:50). Soort <em>Keuze</em> = de leerling kiest een lesje; <em>Programma</em> = voor iedereen.</p>
            <p>In een keuzeblok voeg je <strong>lesjes</strong> toe met lokaal, maximum, leerkracht en e-mail leerkracht (die krijgt de klaslijst). Met <em>Wachtlijst</em> kunnen ouders zich op een volzet lesje toch aanmelden.</p>
            <ul>
              <li><strong>Code</strong>: dezelfde code in een ander tijdsblok = hetzelfde lesje; een leerling kan het dan maar één keer kiezen.</li>
              <li>Een lesje met inschrijvingen kan je niet verwijderen: zet het op <em>gesloten</em> of <em>geannuleerd</em>.</li>
            </ul>
            <Tip>Met <em>Lesjes kopiëren naar…</em> zet je dezelfde lesjes in andere keuzeblokken, ook op een andere dag. Inschrijvingen gaan nooit mee.</Tip>
          </>
        ),
      },
      {
        id: 'privacy',
        titel: 'Privacytekst en bewaartermijn',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/privacy">Privacy</Naar> zie je per evenement of er een privacytekst is en hoe lang gegevens bewaard worden. Je vult beide in bij <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar> → Algemeen.</p>
            <p>Na de bewaartermijn (dagen na de laatste dag) worden namen, e-mailadressen en telefoonnummers elke nacht automatisch gewist. De aantallen per school, leerjaar en lesje blijven.</p>
            <Let>De bewaartermijn en de privacytekst stem je af met de DPO.</Let>
          </>
        ),
      },
      {
        id: 'publiceren',
        titel: 'Testen en publiceren',
        inhoud: (
          <>
            <ol>
              <li>Open het formulier via <em>Formulier ↗</em> op <Naar pad="/dashboard">Evenementen</Naar> en schrijf een testkind in.</li>
              <li>Kijk de bevestigingsmail na (met de persoonlijke link en de QR-code).</li>
              <li>Annuleer de test via de persoonlijke link.</li>
              <li>Zet in <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar> de status op <strong>Gepubliceerd</strong>.</li>
            </ol>
            <p>Na het evenement zet je de status op <em>Gesloten</em> of <em>Gearchiveerd</em>.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'voorinschrijvingen',
    titel: 'Voorinschrijvingen',
    voorWie: 'Platformbeheerders',
    stappen: [
      {
        id: 'formulier',
        titel: 'Eigen voorinschrijvingsformulier',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/voorinschrijvingen">Voorinschrijvingen</Naar>, blok <em>Formulieren</em>, maak je met <strong>+ Nieuw formulier</strong> een eigen formulier in plaats van Microsoft Forms. Inzendingen komen meteen binnen als gezin en kind, zonder import.</p>
            <p>Kies het evenement voor de huisstijl (logo, kleuren) en het schooljaar. Het formulier staat op <code>/voorinschrijven/&lt;adres&gt;</code>.</p>
          </>
        ),
      },
      {
        id: 'importeren',
        titel: 'Een bestand importeren',
        inhoud: (
          <>
            <p>Een export (CSV) van bv. Microsoft Forms importeer je op <Naar pad="/dashboard/voorinschrijvingen">Voorinschrijvingen</Naar> met <strong>+ Bestand importeren</strong>, of op <Naar pad="/dashboard/importeren">Importeren</Naar> (tab Voorinschrijvingen) meteen bij het juiste evenement.</p>
            <ol>
              <li>Kies het bestand en geef de import een naam.</li>
              <li>Kies bij <em>Hoort bij evenement</em> het evenement van dat schooljaar: dan zie je in het overzicht wie vooraf inschreef en wie kwam.</li>
              <li>Kijk de kolommen na en kies de datumvorm (dag/maand/jaar).</li>
            </ol>
            <Let>Het bestand bevat persoonsgegevens. Het wordt enkel in je browser gelezen; verwijder het van je computer na de import.</Let>
          </>
        ),
      },
      {
        id: 'nakijken',
        titel: 'Scholen en kinderen nakijken',
        inhoud: (
          <>
            <p><strong>Scholen</strong>: de namen uit het bestand worden gekoppeld aan de officiële lijst. Kies bij elke <em>twijfel</em> de juiste school, of <em>Niet in de lijst</em>.</p>
            <p><strong>Kinderen</strong>: klik <em>Kinderen nakijken</em>. Eén gezin per e-mailadres; een kind met dezelfde naam bij hetzelfde adres wordt herkend. Bij een naam die bijna hetzelfde is (tikfout), kies je: <em>zelfde kind</em> of <em>een ander kind (broer of zus)</em>.</p>
          </>
        ),
      },
      {
        id: 'statistieken',
        titel: 'Statistieken en controles',
        inhoud: (
          <>
            <p>Per import zie je op <Naar pad="/dashboard/voorinschrijvingen">Voorinschrijvingen</Naar> het aantal gezinnen en kinderen, wie ook voor een infodag inschreef, dubbele adressen, en tabellen per school, klas, schooljaar en maand.</p>
            <p>Het volledige beeld per kind (ook vorige jaren en broers of zussen) vind je in het <Naar pad="/dashboard/evenementen/:ev/overzicht">Overzicht</Naar> van het evenement.</p>
          </>
        ),
      },
      {
        id: 'uitnodigen',
        titel: 'Uitnodigen om in te schrijven',
        inhoud: (
          <>
            <p>Onder elke import staat <em>Uitnodigen om in te schrijven</em>. Kies het gepubliceerde evenement en klik <strong>Uitnodiging versturen</strong>.</p>
            <ul>
              <li>Eén mail per gezin, met per kind een link naar het formulier waarin de gegevens al ingevuld zijn, een link voor een ander kind, en een link "komt niet".</li>
              <li>Kinderen die al ingeschreven zijn, krijgen niets.</li>
              <li>Later stuur je een <strong>herinnering</strong> aan wie nog niet reageerde.</li>
            </ul>
            <p>De tekst van de mail pas je aan bij <Naar pad="/dashboard/mailteksten">Mailteksten</Naar>.</p>
          </>
        ),
      },
      {
        id: 'anonimiseren',
        titel: 'Anonimiseren',
        inhoud: (
          <>
            <p>Zodra de controles en uitnodigingen gedaan zijn, klik je bij de import op <strong>Anonimiseren</strong>. Namen, e-mailadressen, telefoonnummers en opmerkingen worden gewist; de statistieken blijven.</p>
            <Let>Dit kan niet ongedaan gemaakt worden. Na het anonimiseren werken de historiek per kind en het uitnodigen voor die import niet meer.</Let>
          </>
        ),
      },
    ],
  },
  {
    id: 'vorigjaar',
    titel: 'Een vorig schooljaar importeren',
    voorWie: 'Platformbeheerders',
    stappen: [
      {
        id: 'evenement',
        titel: 'Evenement voor dat schooljaar',
        inhoud: (
          <>
            <p>Ga naar <Naar pad="/dashboard/importeren">Importeren</Naar> en klik <strong>+ Evenement voor een vorig schooljaar</strong>.</p>
            <ol>
              <li>Kies het schooljaar (bv. 2025-2026). Titel en adres worden ingevuld.</li>
              <li>Kies <strong>Gegevens bewaren tot</strong>: daarna worden namen en contactgegevens automatisch gewist.</li>
            </ol>
            <p>Het evenement is <em>gearchiveerd</em>: ouders zien het niet. In de lijst van evenementen zie je het met de filter <em>Alle</em>. De datums volgen na de import uit de dagen in het bestand.</p>
            <Let>Stem de bewaartermijn af met de DPO.</Let>
          </>
        ),
      },
      {
        id: 'bestand',
        titel: 'Het bestand klaarzetten',
        inhoud: (
          <>
            <p>Open het Google Spreadsheet met de antwoorden en kies <strong>Bestand → Downloaden → Kommagescheiden waarden (.csv)</strong>. Pas het bestand niet aan: de kolommen mogen blijven zoals ze zijn.</p>
            <ul>
              <li>Kwamen er later nog inschrijvingen bij? Exporteer gewoon opnieuw de volledige lijst; dubbels worden herkend.</li>
              <li>Een bestand zonder kopregel (bv. een aanvulling) kan: de kolomnamen van het vorige bestand worden gebruikt.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'kolommen',
        titel: 'Kolommen, moment en lesjes',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/importeren">Importeren</Naar>, tab <strong>Inschrijvingen (met lesjes)</strong>, kies je het bestand. Het platform stelt voor welke kolom wat is; kijk het na.</p>
            <ul>
              <li><strong>Moment</strong>: vink alle momentkolommen aan (bv. <em>Moment</em> en <em>Moment B-stroom</em>). Per rij telt de laatst ingevulde.</li>
              <li><strong>Lesje</strong>: vink de keuzelesje-kolommen aan. Het tijdsblok en het startuur komen uit de kolomnaam ("Keuzelesje 1 - start 10.10 u."); je kan ze aanpassen.</li>
              <li>"- geen" = geen lesje, "#ERROR!" = onbekend (die keuze wordt overgeslagen).</li>
            </ul>
          </>
        ),
      },
      {
        id: 'programma',
        titel: 'Het programma nakijken',
        inhoud: (
          <>
            <p>Onder <em>Programma uit het bestand</em> zie je de dagen, momenten, tijdsblokken en lesjes die aangemaakt worden, met het aantal inschrijvingen.</p>
            <ul>
              <li>Het tijdsblok volgt het moment dat de ouder koos, niet de kolom: in de exports staan lesjes soms in de kolommen van een andere dag.</li>
              <li>"Lesje Geschiedenis" en "Lesje geschiedenis" worden hetzelfde lesje.</li>
              <li>Rijen zonder moment worden overgeslagen; je ziet hoeveel.</li>
            </ul>
            <p>Wat al bestaat in het evenement (zelfde datum, moment, tijdsblok of titel), wordt hergebruikt. Na de import kan je alles verfijnen in <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar> (lokaal, leerkracht …).</p>
          </>
        ),
      },
      {
        id: 'nakijken',
        titel: 'Scholen en kinderen nakijken',
        inhoud: (
          <>
            <p>Zoals bij de voorinschrijvingen: koppel elke school met een twijfel aan de officiële lijst en klik <strong>Kinderen nakijken</strong>.</p>
            <p>Een kind dat al bekend is (uit een ander schooljaar of een voorinschrijving), wordt herkend: zo ontstaat de historiek. Bij een bijna gelijke naam (bv. omgewisselde of verkeerd gespelde naam) kies jij.</p>
          </>
        ),
      },
      {
        id: 'importeren',
        titel: 'Importeren en opnieuw importeren',
        inhoud: (
          <>
            <p>Klik op de knop onderaan. Je krijgt een verslag: geïmporteerd, vervangen, overgeslagen.</p>
            <ul>
              <li>Schreef een ouder hetzelfde kind meer dan eens in, dan telt de <strong>laatste inzending</strong>. De oudere blijven bewaard als "vervangen", zodat je ze bij de dubbels ziet.</li>
              <li>Opnieuw importeren (bv. de volledige lijst met de latere inschrijvingen) mag: wat er al staat, wordt overgeslagen; een nieuwere inzending vervangt de vorige.</li>
            </ul>
            <p>Kijk daarna de <Naar pad="/dashboard/evenementen/:ev/overzicht">dubbels in het overzicht</Naar> na.</p>
          </>
        ),
      },
      {
        id: 'voorinschrijvingen',
        titel: 'Voorinschrijvingen erbij',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/importeren">Importeren</Naar>, tab <strong>Voorinschrijvingen</strong>, importeer je de voorinschrijvingen van dat schooljaar. Ze worden meteen aan het gekozen evenement gekoppeld.</p>
            <p>Een import die er al was, koppel je op <Naar pad="/dashboard/voorinschrijvingen">Voorinschrijvingen</Naar> met <em>Hoort bij evenement</em>.</p>
          </>
        ),
      },
      {
        id: 'sessiegevers',
        titel: 'Sessiegevers (lesgevers) importeren',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/importeren">Importeren</Naar>: kies eerst het evenement, dan de tab <strong>Sessiegevers</strong>. Die tab verschijnt pas als er een evenement gekozen is.</p>
            <ol>
              <li>Maak een CSV met de kolommen <em>Voornaam</em>, <em>Naam</em>, <em>E-mailadres</em> en eventueel <em>Lesje</em> (meerdere titels gescheiden door <code>;</code>).</li>
              <li>Kies het bestand en kijk de koppeling en het voorbeeld na.</li>
              <li>Klik importeren.</li>
            </ol>
            <ul>
              <li>Wie al bestaat (zelfde e-mailadres), wordt niet dubbel aangemaakt.</li>
              <li>Lesjes worden gekoppeld op titel, in alle tijdsblokken. Importeer dus eerst de inschrijvingen, zodat de lesjes bestaan.</li>
              <li>Enkel adressen van de eigen organisatie (bv. @onderwijs.gent.be) kunnen; andere worden overgeslagen.</li>
            </ul>
            <p>Het resultaat zie je bij <Naar pad="/dashboard/evenementen/:ev/sessiegevers">Sessiegevers</Naar>.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'overzicht',
    titel: 'Overzicht, historiek en dubbels',
    voorWie: 'Organisatoren',
    stappen: [
      {
        id: 'tellers',
        titel: 'Het overzicht in één oogopslag',
        inhoud: (
          <>
            <p>Bij elk evenement op <Naar pad="/dashboard">Evenementen</Naar> staat de link <strong>Overzicht</strong> (<Naar pad="/dashboard/evenementen/:ev/overzicht">open het overzicht</Naar>). Bovenaan staan de tellers:</p>
            <ul>
              <li>ingeschreven, en hoeveel voorinschrijvingen</li>
              <li>vooraf ingeschreven én ingeschreven voor de infodag, en wie vooraf inschreef maar niet kwam inschrijven</li>
              <li>ingeschreven zonder voorinschrijving</li>
              <li>aanwezig (als de aanwezigheid geregistreerd werd)</li>
              <li>kinderen van wie het kind zelf of een broer of zus al eerder bij ons was</li>
            </ul>
          </>
        ),
      },
      {
        id: 'rapporten',
        titel: 'Filters, rapporten en Excel',
        inhoud: (
          <>
            <p>Kies bij <strong>Rapport</strong> wat je wil zien:</p>
            <ul>
              <li><em>Inschrijvingen</em>: wie, wanneer, welk moment en lesje, school, leerjaar, voorinschrijving.</li>
              <li><em>Voorinschrijvingen</em>: en of ze kwamen inschrijven.</li>
              <li><em>Per lagere school</em>, <em>Per leerjaar</em>, <em>Per lesje</em>, <em>Per week</em> (wanneer schreven ze in).</li>
            </ul>
            <p>Met de filters (naam, school, leerjaar, moment, lesje, stroom, voorinschrijving, status) verfijn je elk rapport. <strong>Excel</strong> downloadt precies wat je ziet.</p>
          </>
        ),
      },
      {
        id: 'historiek',
        titel: 'Historiek bij een naam',
        inhoud: (
          <>
            <p>Ga met de muis over een naam (of tab ernaar met het toetsenbord). Je ziet per schooljaar:</p>
            <ul>
              <li>voorinschrijving of inschrijving, met datum, school, leerjaar, moment en lesjes</li>
              <li>of het kind aanwezig was, en vervangen inzendingen</li>
              <li><strong>broers en zussen</strong>: andere kinderen met hetzelfde e-mailadres, met hun historiek</li>
            </ul>
            <Tip>Je ziet enkel evenementen waar je toegang toe hebt.</Tip>
          </>
        ),
      },
      {
        id: 'dubbels',
        titel: 'Dubbels nakijken en samenvoegen',
        inhoud: (
          <>
            <p>Kies het rapport <strong>Dubbels nakijken</strong> in het <Naar pad="/dashboard/evenementen/:ev/overzicht">overzicht</Naar>. Een groep is een kind dat waarschijnlijk meer dan eens inschreef: hetzelfde kind, dezelfde naam (ook met een ander e-mailadres, als school of leerjaar overeenkomen), of een bijna gelijke naam bij hetzelfde adres. Bij elke groep staat waarom.</p>
            <ul>
              <li><strong>Samenvoegen</strong>: meer dan één actieve inschrijving. Voorstel: de laatste blijft (aangeduid). Kies eventueel een andere en klik <em>Samenvoegen</em>; de andere worden geannuleerd en vrijgekomen plaatsen gaan naar de wachtlijst.</li>
              <li><strong>Keuzes verschillen</strong>: er is er nog één actief, maar stroom, moment of lesjes verschilden. De verschillen zijn geel. Vraag na wat klopt (volgende stap).</li>
              <li><strong>Opgelost</strong>: verborgen, tenzij je <em>Ook opgeloste tonen</em> aanvinkt.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'mail',
        titel: 'Een mail met de vraag sturen',
        inhoud: (
          <>
            <p>Klik bij een groep op <strong>Mail met vraag…</strong>. Je krijgt een voorstel van mail met alle inschrijvingen van dat kind en de keuze die het platform aanhoudt (de laatste).</p>
            <ol>
              <li>Pas het onderwerp en de tekst aan. Een lege regel = nieuwe alinea; <code>**zo**</code> wordt vet.</li>
              <li>Bekijk het <em>Voorbeeld</em>.</li>
              <li>Klik <strong>Versturen</strong> (één mail per adres, met de opmaak van het platform), of <em>Openen in mijn mail</em> om vanuit je eigen mailbox te sturen.</li>
            </ol>
            <p>Komt het antwoord binnen, kies dan in de groep de juiste inschrijving en voeg samen, of pas het lesje aan bij <Naar pad="/dashboard/evenementen/:ev/aanwezigheid">Aanwezigheid</Naar>.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'rapporten',
    titel: 'Rapporten, klaslijsten en etiketten',
    voorWie: 'Organisatoren en onthaal',
    stappen: [
      {
        id: 'kiezen',
        titel: 'Een rapport kiezen',
        inhoud: (
          <>
            <p>Open <Naar pad="/dashboard/evenementen/:ev/rapporten">Rapporten</Naar> bij het evenement. Er zijn drie rapporten:</p>
            <ol>
              <li><strong>Overzicht per dagdeel</strong>: per keuzeblok de lesjes met lokaal, leerkracht, maximum, ingeschreven, wachtlijst en vrije plaatsen.</li>
              <li><strong>Inschrijvingen per moment</strong>: elk lesje een kolom met de namen, plus wie geen lesje koos.</li>
              <li><strong>Klaslijst per lesje</strong>: genummerd tot het maximum, met de wachtlijst apart en een QR-code voor de live aanwezigheid.</li>
            </ol>
            <p>Kies daarna het dagdeel of moment, of <em>Alle</em>.</p>
          </>
        ),
      },
      {
        id: 'wijzigen',
        titel: 'Teksten en lesjes aanpassen',
        inhoud: (
          <>
            <p>Klik op een titel, kolomkop of (in het overzicht per dagdeel) op een gegeven van een lesje (titel, lokaal, leerkracht, maximum) om het te wijzigen. Klik <strong>Bewaren</strong>; titels en kolomkoppen worden per evenement onthouden.</p>
            <Tip>Een titel leeg maken zet de standaardtekst terug.</Tip>
          </>
        ),
      },
      {
        id: 'afdrukken',
        titel: 'Afdrukken, Excel en mailen',
        inhoud: (
          <>
            <ul>
              <li><strong>Afdrukken</strong>: één rapport per blad, met onderaan wie wanneer afdrukte.</li>
              <li><strong>Exporteren naar Excel</strong>: één tabblad per dagdeel, moment of lesje.</li>
              <li><strong>Mailen naar leerkrachten</strong>: elke leerkracht krijgt één mail met de klaslijsten van zijn lesjes. Vul daarvoor <em>E-mail leerkracht</em> in bij het lesje in <Naar pad="/dashboard/evenementen/:ev">Instellingen</Naar>; enkel adressen van de eigen organisatie.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'etiketten',
        titel: 'Naametiketten',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/evenementen/:ev/etiketten">Etiketten</Naar> druk je naametiketten met de lesjes van elke leerling.</p>
            <ol>
              <li>Kies het blad (standaard 3 × 8 op A4), de marges en de ruimte tussen de etiketten.</li>
              <li>Stel bij <em>Inhoud</em> de regels van het etiket samen (vet, op één lijn, één regel per lesje, volgorde met ↑ ↓), en eventueel de verdieping per lokaal en de QR-code voor de check-in.</li>
              <li>Kies het dagdeel en de sortering, en klik <strong>Afdrukken</strong>.</li>
            </ol>
            <p>Met <em>Opmaak bewaren</em> wordt de opmaak voor het evenement onthouden.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'dagzelf',
    titel: 'Sessiegevers en de dag zelf',
    voorWie: 'Organisatoren en onthaal',
    stappen: [
      {
        id: 'sessiegevers',
        titel: 'Sessiegevers toevoegen',
        inhoud: (
          <>
            <p>Een sessiegever (lesgever, workshopgever) is geen medewerker: die ziet enkel de eigen sessies. Op <Naar pad="/dashboard/evenementen/:ev/sessiegevers">Sessiegevers</Naar>:</p>
            <ul>
              <li><strong>Overnemen uit de lesjes</strong>: maakt sessiegevers aan uit de velden Leerkracht en E-mail leerkracht van de lesjes.</li>
              <li>Een sessiegever toevoegen met voornaam, naam en e-mailadres, en koppelen aan zijn sessies.</li>
              <li>Een hele lijst in één keer: zie <Naar pad="/dashboard/help/vorigjaar/sessiegevers">Sessiegevers importeren</Naar>.</li>
            </ul>
            <p>Kies ook welke extra velden ze zien (standaard enkel wat op de klaslijst staat).</p>
          </>
        ),
      },
      {
        id: 'uitnodigen',
        titel: 'Sessiegevers uitnodigen',
        inhoud: (
          <>
            <p>Klik <strong>Allen uitnodigen</strong> (of per persoon). Ze krijgen een mail met hun sessies en de link <code>/sessiegever</code>.</p>
            <ul>
              <li>Aanmelden gaat met hun e-mailadres en een code van 6 cijfers per mail.</li>
              <li>De aanmelding blijft geldig tot 5 dagen na hun laatste sessie.</li>
              <li>Op de dag zelf opent de QR-code op de klaslijst de live tabel van hun sessie.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'qrmail',
        titel: 'Vooraf: QR-code mailen',
        inhoud: (
          <>
            <p>Wie inschreef vóór de QR-code bestond, heeft er nog geen in de mail. Onderaan <Naar pad="/dashboard/evenementen/:ev/aanwezigheid">Aanwezigheid</Naar> staat <strong>QR-code mailen</strong>: stuur het bij voorkeur een week vooraf.</p>
          </>
        ),
      },
      {
        id: 'aanwezigheid',
        titel: 'Aanwezigheid en scannen',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/evenementen/:ev/aanwezigheid">Aanwezigheid</Naar> zie je per dag wie al aanwezig is; de lijst ververst zichzelf.</p>
            <ul>
              <li><strong>QR-code scannen</strong>: scan de QR-code uit de mail van de bezoeker. Groen = in orde, geel = kijk even na (bv. een oudere mail), rood = naar de balie.</li>
              <li>Zonder QR-code: zoek de naam en klik <strong>Aanwezig</strong>. <em>Ongedaan maken</em> zet het terug.</li>
              <li>Met de QR-code bij <em>Op je smartphone</em> open je dit overzicht op je gsm.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'lesje',
        titel: 'Een lesje aanpassen of overboeken',
        inhoud: (
          <>
            <p>Klik bij een leerling op <strong>Lesje aanpassen</strong> en kies een ander lesje. Is het vol, dan kan wie het recht <em>overboeken</em> heeft het toch kiezen.</p>
            <p>De ouder krijgt een mail met de nieuwe keuze en een nieuwe QR-code.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'beheer',
    titel: 'Platformbeheer',
    voorWie: 'Platformbeheerders',
    stappen: [
      {
        id: 'medewerkers',
        titel: 'Medewerkers toevoegen',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/medewerkers">Medewerkers</Naar> klik je <strong>+ Medewerker toevoegen</strong>: voornaam, naam, e-mailadres van de organisatie, rol en evenementen.</p>
            <ol>
              <li>Je krijgt een <strong>eenmalige code</strong> (7 dagen geldig) en een kant-en-klaar bericht. Kopieer het of open het in je mail.</li>
              <li>De medewerker activeert het account op <code>/dashboard/activeren</code>.</li>
            </ol>
            <p>Met <em>2FA opnieuw instellen</em> help je iemand die zijn gsm kwijt is; met <em>Deactiveren</em> sluit je een account af. <em>E-mailverzending testen</em> stuurt een testmail naar jezelf.</p>
          </>
        ),
      },
      {
        id: 'rechten',
        titel: 'Rollen en rechten',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/medewerkers/rechten">Rollen en rechten</Naar> zet je per rol (organisator, schoolbeheerder, onthaal, sessiegever) rechten aan of uit, bv. inchecken, lesje wijzigen, overboeken, het overzicht met historiek bekijken of vorige jaren importeren.</p>
            <p>Een platformbeheerder mag altijd alles. Welke evenementen iemand ziet, kies je bij de medewerker.</p>
          </>
        ),
      },
      {
        id: 'mailteksten',
        titel: 'Mailteksten',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/mailteksten">Mailteksten</Naar> lees en wijzig je elke mail van het platform: bevestiging, wijziging, annulatie, uitnodiging, herinnering …</p>
            <ul>
              <li>Velden zoals <code>{'{{voornaam}}'}</code> worden ingevuld; met <em>Veld invoegen</em> zet je ze op de cursor.</li>
              <li>Bekijk het <em>Voorbeeld</em> of klik <em>Testmail naar mezelf</em>; <em>Standaardtekst terugzetten</em> zet de oorspronkelijke tekst terug.</li>
              <li>Bij <em>Opmaak van alle mails</em>: kopbanner, voetbanner en voettekst.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'meldingen',
        titel: 'Meldingen opvolgen',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/meldingen">Meldingen</Naar> komen de berichten van <em>Probleem of idee?</em> binnen, met schermafbeelding, technische gegevens en logboek. Zet de status op <em>In behandeling</em> of <em>Afgehandeld</em>. Meldingen worden na 90 dagen automatisch verwijderd.</p>
          </>
        ),
      },
      {
        id: 'privacy',
        titel: 'Privacy en bewaartermijnen',
        inhoud: (
          <>
            <p>Op <Naar pad="/dashboard/privacy">Privacy</Naar> zie je per evenement de privacytekst en de bewaartermijn, en hoe het platform met gegevens omgaat (versleuteling, anonimiseren).</p>
            <Let>Een evenement voor een vorig schooljaar bewaart gegevens tot de datum die je koos bij het aanmaken. Pas ze aan in de instellingen (bewaartermijn in dagen na de laatste dag).</Let>
          </>
        ),
      },
    ],
  },
];

/** Welke stap "Help bij deze pagina" opent: [patroon van het pad, handleiding, stap]. De eerste die past, wint. */
export const HELP_PER_PAD: [RegExp, string, string][] = [
  [/^\/dashboard\/evenementen\/[^/]+\/overzicht$/, 'overzicht', 'tellers'],
  [/^\/dashboard\/evenementen\/[^/]+\/rapporten$/, 'rapporten', 'kiezen'],
  [/^\/dashboard\/evenementen\/[^/]+\/etiketten$/, 'rapporten', 'etiketten'],
  [/^\/dashboard\/evenementen\/[^/]+\/sessiegevers$/, 'dagzelf', 'sessiegevers'],
  [/^\/dashboard\/evenementen\/[^/]+\/aanwezigheid$/, 'dagzelf', 'aanwezigheid'],
  [/^\/dashboard\/evenementen\/[^/]+$/, 'evenement', 'algemeen'],
  [/^\/dashboard\/importeren/, 'vorigjaar', 'evenement'],
  [/^\/dashboard\/voorinschrijvingen/, 'voorinschrijvingen', 'formulier'],
  [/^\/dashboard\/medewerkers\/rechten/, 'beheer', 'rechten'],
  [/^\/dashboard\/medewerkers/, 'beheer', 'medewerkers'],
  [/^\/dashboard\/mailteksten/, 'beheer', 'mailteksten'],
  [/^\/dashboard\/meldingen/, 'beheer', 'meldingen'],
  [/^\/dashboard\/privacy/, 'beheer', 'privacy'],
  [/^\/dashboard\/account/, 'start', 'account'],
  [/^\/dashboard$/, 'evenement', 'nieuw'],
];

/** Adres van de help voor deze pagina (met het evenement uit het pad of uit ?evenement=). */
export function helpUrl(pad: string, zoek = ''): string {
  const ev = /^\/dashboard\/evenementen\/([^/]+)/.exec(pad)?.[1] ?? new URLSearchParams(zoek).get('evenement');
  const treffer = HELP_PER_PAD.find(([p]) => p.test(pad));
  const basis = treffer ? `/dashboard/help/${treffer[1]}/${treffer[2]}` : '/dashboard/help';
  return ev ? `${basis}?evenement=${encodeURIComponent(ev)}` : basis;
}
