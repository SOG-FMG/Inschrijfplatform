import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { InstellingVeld } from '../services/beheerApi';

/** De instellingenpagina met tabbladen, op een nagemaakt antwoord van de API. */

vi.mock('../services/beheerApi', async (origineel) => ({
  ...(await origineel<typeof import('../services/beheerApi')>()),
  instellingenApi: { lees: vi.fn(), wijzig: vi.fn(), maak: vi.fn(), verwijder: vi.fn(), uploadLogo: vi.fn(), verwijderLogo: vi.fn() },
  kopieerApi: { sessies: vi.fn(), dagdeel: vi.fn() },
}));

const { instellingenApi, kopieerApi } = await import('../services/beheerApi');
const { Instellingen } = await import('./Instellingen');

const v = (naam: string, label: string, type: string, extra: Partial<InstellingVeld> = {}) => ({ naam, label, type, ...extra }) as InstellingVeld;
const keuze = (...w: string[]) => w.map((x) => ({ waarde: x, label: x }));

const SCHEMA = {
  evenement: [
    v('titel', 'Titel', 'tekst', { verplicht: true }),
    v('slug', 'Adres (slug)', 'slug', { verplicht: true }),
    v('status', 'Status', 'keuze', { verplicht: true, opties: keuze('concept', 'gepubliceerd') }),
    v('organisator', 'Organisator', 'tekst'),
    v('start_datum', 'Eerste dag', 'datum', { verplicht: true }),
    v('eind_datum', 'Laatste dag', 'datum', { verplicht: true }),
    v('inschrijving_vanaf', 'Inschrijven vanaf', 'datumtijd'),
    v('inschrijving_tot', 'Inschrijven tot', 'datumtijd'),
    v('max_dagdelen', 'Max. aantal momenten per inschrijving', 'getal', { verplicht: true }),
    v('contact_email', 'E-mailadres voor vragen', 'email'),
    v('bewaartermijn_dagen', 'Bewaartermijn (dagen na het evenement)', 'getal', { verplicht: true }),
    v('logo', 'Logo', 'logo'),
    v('opmerkingen', 'Interne opmerkingen', 'lang'),
    // Staat in geen enkele groep: hoort onder "Overige" te komen.
    v('nieuw_in_de_backend', 'Nieuw veld', 'tekst'),
  ],
  doelgroep: [v('naam', 'Naam', 'tekst', { verplicht: true }), v('beschrijving', 'Beschrijving', 'lang'), v('sessiekeuze', 'Kiest lesjes', 'jaNee'), v('volgorde', 'Volgorde', 'getal')],
  dag: [v('naam', 'Naam', 'tekst', { verplicht: true }), v('datum', 'Datum', 'datum', { verplicht: true }), v('start_uur', 'Van', 'uur'), v('eind_uur', 'Tot', 'uur'), v('sessiekeuze_tot', 'Lesjes kiezen tot', 'datumtijd'), v('status', 'Status', 'keuze', { opties: keuze('actief', 'geannuleerd') }), v('volgorde', 'Volgorde', 'getal')],
  dagdeel: [v('naam', 'Naam', 'tekst', { verplicht: true }), v('start_uur', 'Van', 'uur'), v('eind_uur', 'Tot', 'uur'), v('capaciteit', 'Max. deelnemers', 'getal'), v('status', 'Status', 'keuze', { opties: keuze('actief', 'geannuleerd') }), v('volgorde', 'Volgorde', 'getal')],
  tijdsblok: [v('naam', 'Naam', 'tekst', { verplicht: true }), v('type', 'Soort', 'keuze', { opties: keuze('keuze', 'programma') }), v('start_uur', 'Van', 'uur'), v('eind_uur', 'Tot', 'uur'), v('verplicht', 'Keuze verplicht', 'jaNee'), v('volgorde', 'Volgorde', 'getal')],
  sessie: [
    v('titel', 'Titel', 'tekst', { verplicht: true }),
    v('code', 'Code', 'tekst'),
    v('locatie_id', 'Lokaal', 'ref', { ref: 'locatie' }),
    v('lesgever', 'Leerkracht', 'tekst'),
    v('capaciteit', 'Max. deelnemers', 'getal'),
    v('doelgroep_id', 'Doelgroep', 'ref', { ref: 'doelgroep' }),
    v('status', 'Status', 'keuze', { verplicht: true, opties: keuze('open', 'gesloten') }),
    v('zichtbaar', 'Zichtbaar', 'jaNee'),
    v('beschrijving', 'Beschrijving', 'lang'),
    v('volgorde', 'Volgorde', 'getal'),
    v('opmerkingen', 'Interne opmerkingen', 'lang'),
  ],
};

const sessie = (id: string, titel: string, lokaal: string, lesgever: string, max: number | null, bevestigd: number, wachtlijst = 0) => ({
  sessie_id: id, titel, code: null, locatie_id: lokaal, lesgever, capaciteit: max, doelgroep_id: null,
  status: 'open', zichtbaar: 1, beschrijving: null, volgorde: 1, opmerkingen: null,
  ingeschreven: { bevestigd, wachtlijst },
});

const blok = (id: string, naam: string, start: string, eind: string, sessies: ReturnType<typeof sessie>[]) => ({
  tijdsblok_id: id, naam, type: 'keuze', start_uur: start, eind_uur: eind, verplicht: 1, volgorde: 1,
  // De API levert de sessies al gesorteerd op volgorde; hier krijgt elke sessie haar eigen nummer.
  sessies: sessies.map((s, i) => ({ ...s, volgorde: i + 1 })),
});

const moment = (id: string, naam: string, start: string, eind: string, bevestigd: number, tijdsblokken: ReturnType<typeof blok>[]) => ({
  dagdeel_id: id, naam, start_uur: start, eind_uur: eind, capaciteit: 250, status: 'actief', volgorde: 1,
  ingeschreven: { bevestigd, wachtlijst: 0 }, tijdsblokken,
});

const data = () => ({
  kanSchrijven: true,
  schema: SCHEMA,
  opties: {
    soort: keuze('Workshop'),
    locatie: [{ waarde: 'l1', label: 'A104' }, { waarde: 'l2', label: 'B012' }],
    doelgroep: [{ waarde: 'dg1', label: 'A-stroom' }],
  },
  evenement: {
    evenement_id: 'ev1', titel: 'Infodagen 2027', slug: 'infodagen-2027', status: 'gepubliceerd', organisator: 'FMG',
    start_datum: '2027-01-23', eind_datum: '2027-03-06', inschrijving_vanaf: null, inschrijving_tot: null,
    max_dagdelen: 1, contact_email: null, bewaartermijn_dagen: 30, logo: null, opmerkingen: null, nieuw_in_de_backend: null,
  },
  doelgroepen: [{ doelgroep_id: 'dg1', naam: 'A-stroom', beschrijving: '', sessiekeuze: 1, volgorde: 1 }],
  dagen: [
    {
      dag_id: 'd1', naam: 'Zaterdag 23 januari', datum: '2027-01-23', start_uur: '10:00', eind_uur: '16:00',
      sessiekeuze_tot: null, status: 'actief', volgorde: 1,
      dagdelen: [
        moment('dd1', 'Voormiddag', '10:00', '12:30', 18, [
          blok('t1', 'Keuzelesje 1', '10:30', '11:15', [sessie('s1', 'Latijn', 'l1', 'Peeters', 20, 18), sessie('s2', 'Wetenschappen', 'l2', 'Jacobs', 20, 20, 3)]),
          blok('t2', 'Keuzelesje 2', '11:30', '12:15', [sessie('s3', 'Latijn', 'l1', 'Peeters', 20, 12)]),
        ]),
        moment('dd2', 'Namiddag', '13:00', '15:30', 0, [blok('t3', 'Keuzelesje 1', '13:30', '14:15', [])]),
      ],
    },
    {
      dag_id: 'd2', naam: 'Zaterdag 6 maart', datum: '2027-03-06', start_uur: '10:00', eind_uur: '16:00',
      sessiekeuze_tot: null, status: 'actief', volgorde: 2,
      dagdelen: [moment('dd3', 'Voormiddag', '10:00', '12:30', 0, [blok('t4', 'Keuzelesje 1', '10:30', '11:15', [])])],
    },
  ],
});

const toon = async () => {
  render(<Instellingen evenementId="ev1" naVerandering={() => {}} />);
  await screen.findByRole('heading', { name: /Infodagen 2027/ });
};

/** Een cel in de tabel; de naam van het veld vermeldt het blok, want sessietitels komen terug. */
const cel = (kop: string, sessie: string, blok = 'Voormiddag Keuzelesje 1') => screen.getByLabelText(`${kop} van ${sessie} — ${blok}`);

beforeEach(() => {
  cleanup();
  vi.mocked(instellingenApi.lees).mockReset().mockResolvedValue(data());
  vi.mocked(instellingenApi.wijzig).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(kopieerApi.sessies).mockReset().mockResolvedValue({ gekopieerd: 1, overgeslagen: [] });
  location.hash = '';
});

test('tabblad Sessies: per dagdeel een tabel per tijdsblok, met de kolommen naast elkaar', async () => {
  await toon();

  // De eerste dag staat open, de tweede niet.
  expect(screen.getByText('Zaterdag 23 januari').closest('details')!.open).toBe(true);
  expect(screen.getByText('Zaterdag 6 maart').closest('details')!.open).toBe(false);
  expect(screen.getByText(/2 moment\(en\) · 3 sessie\(s\) · 18 ingeschreven/)).toBeTruthy();

  // Per tijdsblok een eigen tabel, met de kolommen in de gevraagde volgorde.
  const blok1 = cel('Naam', 'Latijn').closest('.it-tabel') as HTMLElement;
  expect(within(blok1).getByRole('heading', { level: 4 }).textContent).toMatch(/Keuzelesje 1\s*10:30–11:15/);
  expect(within(blok1).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Orde', 'Naam', 'Lokaal', 'Leerkracht', 'Ingeschreven', 'Maximum', 'Acties']);
  const rijen = within(blok1).getAllByRole('row').slice(1);
  expect(rijen).toHaveLength(2);
  expect(cel('Naam', 'Latijn')).toHaveProperty('value', 'Latijn');
  expect(cel('Lokaal', 'Latijn')).toHaveProperty('value', 'l1');
  expect(cel('Leerkracht', 'Latijn')).toHaveProperty('value', 'Peeters');
  expect(cel('Maximum', 'Latijn')).toHaveProperty('value', '20');
  expect(rijen[0].textContent).toMatch(/18 \/ 20/);
  // Volzette sessie met wachtlijst.
  expect(rijen[1].textContent).toMatch(/20 \/ 20/);
  expect(rijen[1].textContent).toMatch(/3 wachtlijst/);

  // Dezelfde titel in een ander blok is een aparte rij, met een eigen naam voor de schermlezer.
  expect(cel('Maximum', 'Latijn', 'Voormiddag Keuzelesje 2')).toHaveProperty('value', '20');

  // Lege tijdsblokken zeggen dat ze leeg zijn (Namiddag, en de tweede dag).
  expect(screen.getAllByText('Nog geen sessies in Keuzelesje 1.')).toHaveLength(2);
});

test('maximum en leerkracht aanpassen in de tabel, dan in één keer bewaren', async () => {
  await toon();
  expect(screen.queryByText(/nog niet bewaard/)).toBeNull();

  fireEvent.change(cel('Maximum', 'Latijn'), { target: { value: '24' } });
  fireEvent.change(cel('Leerkracht', 'Wetenschappen'), { target: { value: 'De Smet' } });
  expect(screen.getByText('2 wijziging(en) nog niet bewaard.')).toBeTruthy();

  // Terugzetten op de bewaarde waarde laat de wijziging weer vallen.
  fireEvent.change(cel('Leerkracht', 'Wetenschappen'), { target: { value: 'Jacobs' } });
  expect(screen.getByText('1 wijziging(en) nog niet bewaard.')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Bewaren' }));
  await screen.findByText('Wijzigingen bewaard.');
  expect(instellingenApi.wijzig).toHaveBeenCalledExactlyOnceWith('sessie', 's1', { capaciteit: '24' });
  expect(instellingenApi.lees).toHaveBeenCalledTimes(2); // opnieuw ingelezen
});

test('een sessie kopiëren: eerst het moment, dan het tijdsblok', async () => {
  await toon();
  const rij = cel('Naam', 'Latijn').closest('tr')!;
  fireEvent.click(within(rij).getByRole('button', { name: /Kopiëren/ }));

  // jsdom kent showModal niet, dus <dialog> blijft dicht en is niet te vinden via zijn rol.
  const venster = await waitFor(() => document.querySelector('dialog.d-venster') as HTMLElement);
  expect(venster.getAttribute('aria-label')).toBe('“Latijn” kopiëren');
  expect(venster.textContent).toMatch(/Staat nu in:\s*Zaterdag 23 januari · Voormiddag · Keuzelesje 1/);

  // Alle momenten van alle dagen staan er, met hun tijdsblokken.
  const momenten = [...venster.querySelectorAll<HTMLElement>('.kopie__dagdeel')];
  expect(momenten).toHaveLength(3);
  expect(within(momenten[0]).getByLabelText(/Keuzelesje 1/)).toHaveProperty('disabled', true); // staat hier al
  expect(within(momenten[0]).getByLabelText(/Keuzelesje 2/)).toHaveProperty('disabled', false);

  const kopieer = within(venster).getByRole('button', { name: 'Kopiëren', hidden: true });
  expect(kopieer).toHaveProperty('disabled', true); // nog geen doel gekozen

  fireEvent.click(within(momenten[0]).getByLabelText(/Keuzelesje 2/));
  fireEvent.click(within(momenten[2]).getByLabelText(/Keuzelesje 1/)); // ander moment, andere dag
  fireEvent.click(kopieer);
  await waitFor(() => expect(kopieerApi.sessies).toHaveBeenCalledWith(['s1'], ['t2', 't4']));
});

test('volgorde van sessies met de pijltjes in de lijst zelf', async () => {
  await toon();
  const rijen = within(cel('Naam', 'Latijn').closest('.it-tabel') as HTMLElement).getAllByRole('row').slice(1);

  // Bovenaan kan je niet hoger, onderaan niet lager.
  expect(within(rijen[0]).getByRole('button', { name: 'Latijn naar boven' })).toHaveProperty('disabled', true);
  expect(within(rijen[1]).getByRole('button', { name: 'Wetenschappen naar onder' })).toHaveProperty('disabled', true);

  fireEvent.click(within(rijen[1]).getByRole('button', { name: 'Wetenschappen naar boven' }));
  await waitFor(() => expect(instellingenApi.wijzig).toHaveBeenCalledWith('sessie', 's2', { volgorde: 1 }));
  expect(instellingenApi.wijzig).toHaveBeenCalledWith('sessie', 's1', { volgorde: 2 });
  expect(instellingenApi.wijzig).toHaveBeenCalledTimes(2); // enkel wat echt wijzigt
  expect(instellingenApi.lees).toHaveBeenCalledTimes(2); // opnieuw ingelezen
});

test('“Meer…” opent de volledige sessie en blijft na opslaan de bijgewerkte rij volgen', async () => {
  await toon();
  fireEvent.click(within(cel('Naam', 'Latijn').closest('tr')!).getByRole('button', { name: 'Meer…' }));

  const venster = await waitFor(() => document.querySelector('dialog.d-venster') as HTMLElement);
  expect(venster.getAttribute('aria-label')).toBe('Latijn — alle instellingen');
  expect([...venster.querySelectorAll('legend, summary')].map((e) => e.textContent)).toEqual(['De sessie', 'Voor wie', 'Inschrijven', 'Op het formulier', 'Intern']);
  // Velden die niet in de tabel staan, staan hier wel.
  expect(within(venster).getByLabelText(/Code/)).toBeTruthy();
  expect(within(venster).getByLabelText(/Zichtbaar/)).toBeTruthy();

  // Na opslaan komen de gegevens opnieuw binnen; het venster toont dan de bijgewerkte sessie.
  vi.mocked(instellingenApi.lees).mockResolvedValue({
    ...data(),
    dagen: data().dagen.map((d, i) => (i ? d : { ...d, naam: 'Zaterdag 23 januari (gewijzigd)' })),
  });
  fireEvent.change(within(venster).getByLabelText(/Code/), { target: { value: 'LAT' } });
  fireEvent.click(within(venster).getByRole('button', { name: 'Opslaan', hidden: true }));
  await waitFor(() => expect(instellingenApi.wijzig).toHaveBeenCalledWith('sessie', 's1', { code: 'LAT' }));
  await screen.findByText(/Zaterdag 23 januari \(gewijzigd\)/);
  expect(document.querySelector('dialog.d-venster')).toBeTruthy();
});

test('tabblad Algemeen: velden in groepen, zelden gebruikte ingeklapt, nieuwe velden onder Overige', async () => {
  await toon();
  fireEvent.click(screen.getByRole('tab', { name: 'Algemeen' }));

  const form = document.querySelector('.it-form') as HTMLElement;
  expect([...form.querySelectorAll('legend, summary')].map((e) => e.textContent)).toEqual([
    'Het evenement', 'Inschrijven', 'Contact, privacy en bewaren', 'Huisstijl op het formulier', 'Interne opmerkingen', 'Overige',
  ]);
  // Wat je zelden aanpast begint dicht.
  expect(form.querySelector('fieldset.it-groep legend')!.textContent).toBe('Het evenement');
  expect([...form.querySelectorAll('details.it-groep')].every((d) => !(d as HTMLDetailsElement).open)).toBe(true);
  // Een veld dat in de backend bijkomt, verdwijnt niet van het scherm.
  expect(within(form).getByLabelText('Nieuw veld')).toBeTruthy();

  // Opslaan kan niet zolang er niets gewijzigd is.
  expect(within(form).getByRole('button', { name: 'Opslaan' })).toHaveProperty('disabled', true);
  fireEvent.change(within(form).getByLabelText(/Organisator/), { target: { value: 'FMG Gent' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Opslaan' }));
  await waitFor(() => expect(instellingenApi.wijzig).toHaveBeenCalledWith('evenement', 'ev1', { organisator: 'FMG Gent' }));
});

test('tabbladen blijven staan na herladen, via het adres', async () => {
  await toon();
  fireEvent.click(screen.getByRole('tab', { name: 'Momenten' }));
  expect(location.hash).toBe('#momenten');
  const dag1 = screen.getByRole('heading', { name: /Zaterdag 23 januari/ }).closest('.d-kaart') as HTMLElement;
  expect(within(dag1).getByRole('heading', { name: 'Tijdsblokken in Voormiddag' })).toBeTruthy();
  expect(within(dag1).getByLabelText('Maximum van Voormiddag — Zaterdag 23 januari')).toHaveProperty('value', '250');

  cleanup();
  await toon();
  expect(screen.getByRole('tab', { name: 'Momenten' }).getAttribute('aria-selected')).toBe('true');
});

test('zonder schrijfrechten is er niets aan te passen', async () => {
  vi.mocked(instellingenApi.lees).mockResolvedValue({ ...data(), kanSchrijven: false });
  await toon();
  expect(screen.getByText(/enkel bekijken/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Kopiëren/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Meer…' })).toBeNull();
  expect(screen.queryByRole('button', { name: /toevoegen/ })).toBeNull();
  expect(cel('Naam', 'Latijn')).toHaveProperty('disabled', true);
});
