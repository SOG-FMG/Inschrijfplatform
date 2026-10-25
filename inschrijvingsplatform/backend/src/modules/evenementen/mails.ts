import { checkinSectieHtml, type Checkin } from '../../kern/checkin';
import { esc, type SjabloonDefinitie, type Velden } from '../../kern/sjablonen';
import { mailVolgensSjabloon, type Mail } from '../../mail';
import type { Keuze, Moment } from '../../types';

/**
 * De mails van de module evenementen, als sjablonen (zie kern/sjablonen.ts). Beheerders passen de tekst aan in
 * Dashboard → Mailteksten; de velden en de standaardtekst staan hier.
 */

const lijst = (items: string[]) => ({ html: items.length ? `<ul>${items.join('')}</ul>` : '' });
const link = (url: string, tekst: string) => ({ html: `<a href="${esc(url)}">${esc(tekst)}</a>` });
const mailto = (adres: string | null) => (adres ? { html: `<a href="mailto:${esc(adres)}">${esc(adres)}</a>` } : null);

const momentenHtml = (m: Moment[]) => lijst(m.map((x) => `<li><strong>${esc(x.dag)} – ${esc(x.dagdeel)}</strong> (${esc(x.startUur)} – ${esc(x.eindUur)})</li>`));
const keuzesHtml = (k: Keuze[]) =>
  lijst(k.map((x) => `<li>${esc(x.startUur)} – ${esc(x.titel)}${x.locatie ? ` (lokaal ${esc(x.locatie)})` : ''}${x.status === 'wachtlijst' ? ' – <em>op de wachtlijst</em>' : ''}</li>`));

const VOORBEELD_MOMENTEN = momentenHtml([{ dag: 'Zaterdag 23 januari', dagdeel: 'Voormiddag', startUur: '09:00', eindUur: '12:00' }]);
const VOORBEELD_KEUZES = keuzesHtml([
  { titel: 'Proeflesje Frans', tijdsblok: 'Keuze 1', startUur: '09:30', locatie: 'B1.04', status: 'bevestigd' },
  { titel: 'Proeflesje STEM', tijdsblok: 'Keuze 2', startUur: '10:30', locatie: null, status: 'wachtlijst' },
]);

const V = {
  voornaam: { naam: 'voornaam', omschrijving: 'Voornaam van de deelnemer (het kind)', voorbeeld: 'Lotte' },
  evenement: { naam: 'evenement', omschrijving: 'Naam van het evenement', voorbeeld: 'Infodagen 2027' },
  referentie: { naam: 'referentie', omschrijving: 'Referentie van de inschrijving', voorbeeld: '3F2A9C1E' },
  contactEmail: { naam: 'contactEmail', omschrijving: 'Contactadres van het evenement (als link; leeg als er geen is)', voorbeeld: mailto('infodag@school.example') },
} as const;

export const SJABLONEN: SjabloonDefinitie[] = [
  {
    sleutel: 'bevestiging',
    reden: 'je een inschrijving deed voor {{evenement}}',
    naam: 'Bevestiging van een inschrijving',
    omschrijving: 'Na het inschrijven via het formulier.',
    velden: [
      V.voornaam, V.evenement, V.referentie,
      { naam: 'momenten', omschrijving: 'Lijst van de gekozen momenten (blok)', voorbeeld: VOORBEELD_MOMENTEN },
      { naam: 'keuzes', omschrijving: 'Lijst van de gekozen onderdelen, met wachtlijst (blok; leeg zonder keuzes)', voorbeeld: VOORBEELD_KEUZES },
      { naam: 'beheerlink', omschrijving: 'Persoonlijke link om te bekijken, wijzigen of annuleren', voorbeeld: link('https://inschrijven.example/beheer/…', 'deze persoonlijke link') },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: 'Bevestiging inschrijving {{evenement}} ({{referentie}})',
      tekst: `Beste,

Bedankt! De inschrijving van **{{voornaam}}** voor **{{evenement}}** is goed ontvangen.

{{momenten}}

{{#keuzes}}Gekozen onderdelen:

{{keuzes}}{{/keuzes}}

Referentie: **{{referentie}}**

Wil je je inschrijving bekijken, een ander lesje kiezen of annuleren? Gebruik {{beheerlink}}. Deel deze link niet met anderen.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}

Tot dan!`,
    },
  },
  {
    sleutel: 'wijziging',
    reden: 'je een inschrijving voor {{evenement}} wijzigde',
    naam: 'Keuzes gewijzigd',
    omschrijving: 'Na het wijzigen van de lesjes via de persoonlijke link.',
    velden: [
      V.voornaam, V.evenement, V.referentie,
      { naam: 'keuzes', omschrijving: 'Lijst van de nieuwe keuzes (blok; leeg zonder keuzes)', voorbeeld: VOORBEELD_KEUZES },
      { naam: 'beheerlink', omschrijving: 'Persoonlijke link', voorbeeld: link('https://inschrijven.example/beheer/…', 'je persoonlijke link') },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: 'Keuze gewijzigd: {{evenement}} ({{referentie}})',
      tekst: `Beste,

De keuzes van **{{voornaam}}** voor **{{evenement}}** zijn gewijzigd. Dit is het nieuwe overzicht:

{{keuzes}}{{^keuzes}}Geen lesjes gekozen.{{/keuzes}}

Referentie: **{{referentie}}**

Opnieuw iets aanpassen of annuleren? Gebruik {{beheerlink}}. Deel deze link niet met anderen.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  },
  {
    sleutel: 'annulatie',
    reden: 'je een inschrijving voor {{evenement}} annuleerde',
    naam: 'Inschrijving geannuleerd',
    omschrijving: 'Na het annuleren via de persoonlijke link.',
    velden: [
      V.voornaam, V.evenement, V.referentie,
      { naam: 'formulierlink', omschrijving: 'Link naar het formulier om opnieuw in te schrijven', voorbeeld: link('https://inschrijven.example/infodagen', 'Schrijf je opnieuw in') },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: 'Inschrijving geannuleerd: {{evenement}} ({{referentie}})',
      tekst: `Beste,

De inschrijving van **{{voornaam}}** voor **{{evenement}}** is geannuleerd. De plaatsen zijn vrijgegeven.

Referentie: **{{referentie}}**

Toch komen? {{formulierlink}}.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  },
  {
    sleutel: 'schoolwijziging',
    reden: 'de school je inschrijving voor {{evenement}} aanpaste',
    naam: 'Inschrijving aangepast door de school',
    omschrijving: 'Na een wijziging van het moment of de lesjes door de school (onthaal of organisator). Met een nieuwe QR-code.',
    velden: [
      V.voornaam, V.evenement, V.referentie,
      { naam: 'momenten', omschrijving: 'Lijst van de momenten (blok)', voorbeeld: VOORBEELD_MOMENTEN },
      { naam: 'keuzes', omschrijving: 'Lijst van de lesjes, met wachtlijst (blok; leeg zonder keuzes)', voorbeeld: VOORBEELD_KEUZES },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: 'Inschrijving aangepast: {{evenement}} ({{referentie}})',
      tekst: `Beste,

De school heeft de inschrijving van **{{voornaam}}** voor **{{evenement}}** aangepast. Dit is het nieuwe overzicht:

{{momenten}}

{{#keuzes}}Gekozen onderdelen:

{{keuzes}}{{/keuzes}}

Referentie: **{{referentie}}**

Toon op de dag zelf de QR-code uit deze mail, niet die uit een vorige mail. Je inschrijving bekijken of annuleren doe je met de persoonlijke link uit je eerste bevestigingsmail.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  },
  {
    sleutel: 'qrcode',
    reden: 'je ingeschreven bent voor {{evenement}}',
    naam: 'QR-code voor het onthaal',
    omschrijving: 'Voor inschrijvingen van vóór de QR-code: verstuurd met de knop "QR-code mailen" bij het evenement.',
    velden: [
      V.voornaam, V.evenement, V.referentie,
      { naam: 'momenten', omschrijving: 'Lijst van de momenten (blok)', voorbeeld: VOORBEELD_MOMENTEN },
      { naam: 'keuzes', omschrijving: 'Lijst van de lesjes, met wachtlijst (blok; leeg zonder keuzes)', voorbeeld: VOORBEELD_KEUZES },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: 'Je QR-code voor {{evenement}} ({{referentie}})',
      tekst: `Beste,

Binnenkort is het zover: **{{voornaam}}** komt naar **{{evenement}}**.

{{momenten}}

{{#keuzes}}Gekozen onderdelen:

{{keuzes}}{{/keuzes}}

Referentie: **{{referentie}}**

Om het aanmelden aan het onthaal vlot te laten verlopen, vind je hieronder een QR-code. Toon die bij aankomst, op je smartphone of afgedrukt.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  },
  {
    sleutel: 'sessiegever',
    reden: 'je geregistreerd bent als {{rol}} voor {{evenement}}',
    naam: 'Uitnodiging voor een sessiegever (lesgever, spreker)',
    omschrijving: 'Met de knop "Uitnodigen" bij de sessiegevers van een evenement. Hoe de sessiegever heet, volgt de installatie.',
    velden: [
      V.voornaam, V.evenement,
      { naam: 'rol', omschrijving: 'Hoe deze organisatie een sessiegever noemt (bv. lesgever)', voorbeeld: 'lesgever' },
      { naam: 'sessies', omschrijving: 'Lijst van de eigen sessies (blok)', voorbeeld: lijst(['<li>Zaterdag 23 januari, 09:30 – Proeflesje Frans</li>']) },
      { naam: 'link', omschrijving: 'Link naar de pagina om aan te melden', voorbeeld: link('https://inschrijven.example/sessiegever', 'Mijn sessies') },
    ],
    standaard: {
      onderwerp: '{{evenement}}: je sessies en je aanwezigheidslijst',
      tekst: `Beste {{voornaam}},

Je bent geregistreerd als **{{rol}}** voor **{{evenement}}**:

{{sessies}}

Via {{link}} zie je vooraf wie er ingeschreven is. Op de dag zelf duid je daar aan wie er in je sessie zit; je kan ook de QR-code op het etiket van een deelnemer scannen.

Aanmelden gaat met je e-mailadres en een code die je per mail krijgt. Je hoeft geen wachtwoord te onthouden.`,
    },
  },
  {
    sleutel: 'aanmeldcode',
    reden: 'iemand met dit adres een aanmeldcode vroeg',
    naam: 'Aanmeldcode voor een sessiegever',
    omschrijving: 'Een code van 6 cijfers om aan te melden op de pagina voor sessiegevers.',
    velden: [
      V.voornaam,
      { naam: 'code', omschrijving: 'De code van 6 cijfers', voorbeeld: '493 027' },
      { naam: 'minuten', omschrijving: 'Hoe lang de code geldig is', voorbeeld: '10' },
    ],
    standaard: {
      onderwerp: 'Je aanmeldcode: {{code}}',
      tekst: `Beste {{voornaam}},

Je aanmeldcode is **{{code}}**. Ze is {{minuten}} minuten geldig en werkt één keer.

Vroeg je geen code aan? Dan kan je deze mail negeren.`,
    },
  },
  ...(['uitnodiging', 'herinnering'] as const).map((soort): SjabloonDefinitie => ({
    sleutel: soort,
    reden: 'je eerder interesse toonde (voorinschrijving) en nog niet ingeschreven bent voor {{evenement}}',
    naam: soort === 'uitnodiging' ? 'Uitnodiging om in te schrijven' : 'Herinnering om in te schrijven',
    omschrijving: 'Eén mail per gezin, met per kind een link naar het vooraf ingevulde formulier (Voorinschrijvingen → Uitnodigen).',
    velden: [
      V.evenement,
      { naam: 'inschrijvingTot', omschrijving: 'Laatste dag om in te schrijven (leeg als er geen is)', voorbeeld: 'vrijdag 5 maart' },
      { naam: 'kinderen', omschrijving: 'Per kind een link "inschrijven" en "komt niet" (blok)', voorbeeld: kinderenHtml([{ naam: 'Lotte Proef', inschrijven: 'https://…', afmelden: 'https://…' }]) },
      { naam: 'anderKind', omschrijving: 'Link om een ander kind in te schrijven', voorbeeld: link('https://…', 'Gebruik deze link') },
      V.contactEmail,
    ],
    standaard: {
      onderwerp: soort === 'uitnodiging' ? 'Inschrijven voor {{evenement}}' : 'Herinnering: inschrijven voor {{evenement}}',
      tekst: `Beste,

${soort === 'uitnodiging' ? 'Je toonde eerder interesse in onze school.' : 'We hebben nog geen inschrijving ontvangen.'} De inschrijvingen voor **{{evenement}}** zijn open{{#inschrijvingTot}} tot {{inschrijvingTot}}{{/inschrijvingTot}}.

Met de knop hieronder opent het formulier, met de gegevens die je al gaf ingevuld. Kijk ze na en kies een moment.

{{kinderen}}

{{#anderKind}}Een ander kind inschrijven? {{anderKind}}.{{/anderKind}}

Deze links zijn persoonlijk. Deel ze niet met anderen.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  })),
];

const sjabloon = (sleutel: string) => SJABLONEN.find((s) => s.sleutel === sleutel)!;

function kinderenHtml(k: { naam: string; inschrijven: string; afmelden: string }[]) {
  return lijst(k.map((x) => `<li><a href="${esc(x.inschrijven)}"><strong>${esc(x.naam)} inschrijven</strong></a>
<br><small><a href="${esc(x.afmelden)}">${esc(x.naam)} komt niet</a> (dan sturen we geen herinnering meer)</small></li>`));
}

/** De QR-code voor het onthaal (kern/checkin.ts) als vaste sectie onder de (aanpasbare) tekst. */
const metQr = (mail: Mail, checkin: Checkin | null | undefined): Mail => (checkin ? { ...mail, onderaan: checkinSectieHtml(checkin) } : mail);

export function bevestigingsmail(
  r: { referentie: string; evenement: string; contactEmail: string | null; momenten: Moment[]; keuzes: Keuze[] },
  aan: string, voornaam: string, beheerUrl: string, checkin?: Checkin,
): Mail {
  const velden: Velden = {
    voornaam, evenement: r.evenement, referentie: r.referentie, momenten: momentenHtml(r.momenten), keuzes: keuzesHtml(r.keuzes),
    beheerlink: link(beheerUrl, 'deze persoonlijke link'), contactEmail: mailto(r.contactEmail),
  };
  return metQr(mailVolgensSjabloon(sjabloon('bevestiging'), velden, { aan, type: 'bevestiging', referentie: r.referentie }), checkin);
}

export function wijzigingsmail(p: { aan: string; voornaam: string; evenement: string; referentie: string; keuzes: Keuze[]; beheerUrl: string; contactEmail: string | null; checkin?: Checkin | null }): Mail {
  const velden: Velden = {
    voornaam: p.voornaam, evenement: p.evenement, referentie: p.referentie, keuzes: keuzesHtml(p.keuzes),
    beheerlink: link(p.beheerUrl, 'je persoonlijke link'), contactEmail: mailto(p.contactEmail),
  };
  return metQr(mailVolgensSjabloon(sjabloon('wijziging'), velden, { aan: p.aan, type: 'wijziging', referentie: p.referentie }), p.checkin);
}

/** Wijziging door de school, of de QR-code voor een inschrijving van vóór de QR-code: overzicht + QR. */
export function overzichtsmail(
  soort: 'schoolwijziging' | 'qrcode',
  p: { aan: string; voornaam: string; evenement: string; referentie: string; momenten: Moment[]; keuzes: Keuze[]; contactEmail: string | null; checkin: Checkin },
): Mail {
  const velden: Velden = {
    voornaam: p.voornaam, evenement: p.evenement, referentie: p.referentie, momenten: momentenHtml(p.momenten), keuzes: keuzesHtml(p.keuzes),
    contactEmail: mailto(p.contactEmail),
  };
  return metQr(mailVolgensSjabloon(sjabloon(soort), velden, { aan: p.aan, type: soort, referentie: p.referentie }), p.checkin);
}

export function annulatiemail(p: { aan: string; voornaam: string; evenement: string; referentie: string; formulierUrl: string; contactEmail: string | null }): Mail {
  const velden: Velden = {
    voornaam: p.voornaam, evenement: p.evenement, referentie: p.referentie,
    formulierlink: link(p.formulierUrl, 'Schrijf je opnieuw in'), contactEmail: mailto(p.contactEmail),
  };
  return mailVolgensSjabloon(sjabloon('annulatie'), velden, { aan: p.aan, type: 'annulatie', referentie: p.referentie });
}

export function uitnodigingsmail(p: {
  aan: string; evenement: string; inschrijvingTot: string | null; contactEmail: string | null; herinnering: boolean;
  kinderen: { naam: string; inschrijven: string; afmelden: string }[]; anderKind: string | null;
}): Mail {
  const tot = p.inschrijvingTot
    ? new Date(p.inschrijvingTot).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' })
    : null;
  const soort = p.herinnering ? 'herinnering' : 'uitnodiging';
  const velden: Velden = {
    evenement: p.evenement, inschrijvingTot: tot, kinderen: kinderenHtml(p.kinderen),
    anderKind: p.anderKind ? link(p.anderKind, 'Gebruik deze link') : null, contactEmail: mailto(p.contactEmail),
  };
  return mailVolgensSjabloon(sjabloon(soort), velden, { aan: p.aan, type: soort });
}

export function sessiegevermail(p: {
  aan: string; voornaam: string; evenement: string; term: string; link: string;
  sessies: { titel: string; dag: string; startUur: string }[];
}): Mail {
  const velden: Velden = {
    voornaam: p.voornaam, evenement: p.evenement, rol: p.term,
    sessies: lijst(p.sessies.map((s) => `<li>${esc(s.dag)}, ${esc(s.startUur)} – ${esc(s.titel)}</li>`)),
    link: link(p.link, 'deze pagina'),
  };
  return mailVolgensSjabloon(sjabloon('sessiegever'), velden, { aan: p.aan, type: 'sessiegever' });
}

export function aanmeldcodemail(p: { aan: string; voornaam: string; code: string; minuten: number }): Mail {
  const velden: Velden = { voornaam: p.voornaam, code: `${p.code.slice(0, 3)} ${p.code.slice(3)}`, minuten: String(p.minuten) };
  return mailVolgensSjabloon(sjabloon('aanmeldcode'), velden, { aan: p.aan, type: 'aanmeldcode' });
}
