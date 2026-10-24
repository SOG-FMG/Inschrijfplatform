import { checkinSectieHtml } from '../../kern/checkin';
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

/** `checkin`: de QR-code voor het onthaal (kern/checkin.ts), als vaste sectie onder de (aanpasbare) tekst. */
export function bevestigingsmail(
  r: { referentie: string; evenement: string; contactEmail: string | null; momenten: Moment[]; keuzes: Keuze[] },
  aan: string, voornaam: string, beheerUrl: string, checkin?: { basisUrl: string; token: string },
): Mail {
  const velden: Velden = {
    voornaam, evenement: r.evenement, referentie: r.referentie, momenten: momentenHtml(r.momenten), keuzes: keuzesHtml(r.keuzes),
    beheerlink: link(beheerUrl, 'deze persoonlijke link'), contactEmail: mailto(r.contactEmail),
  };
  const mail = mailVolgensSjabloon(sjabloon('bevestiging'), velden, { aan, type: 'bevestiging', referentie: r.referentie });
  return checkin ? { ...mail, onderaan: checkinSectieHtml(checkin.basisUrl, checkin.token) } : mail;
}

export function wijzigingsmail(p: { aan: string; voornaam: string; evenement: string; referentie: string; keuzes: Keuze[]; beheerUrl: string; contactEmail: string | null }): Mail {
  const velden: Velden = {
    voornaam: p.voornaam, evenement: p.evenement, referentie: p.referentie, keuzes: keuzesHtml(p.keuzes),
    beheerlink: link(p.beheerUrl, 'je persoonlijke link'), contactEmail: mailto(p.contactEmail),
  };
  return mailVolgensSjabloon(sjabloon('wijziging'), velden, { aan: p.aan, type: 'wijziging', referentie: p.referentie });
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
