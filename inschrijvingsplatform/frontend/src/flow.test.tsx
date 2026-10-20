import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { test, expect } from 'vitest';
import { InschrijfPagina } from './pages/InschrijfPagina';
import { BeheerPagina } from './pages/BeheerPagina';

window.scrollTo = () => {};
const veld = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const typ = (id: string, v: string) => fireEvent.change(veld(id), { target: { value: v } });
const volgende = () => fireEvent.click(screen.getByRole('button', { name: /Volgende|versturen/ }));

test('volledige inschrijving + annulatie in demomodus', async () => {
  render(<InschrijfPagina slug="fmg-infodagen-2027" />);
  await screen.findByRole('heading', { name: 'Infodagen 2027' });

  volgende();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toMatch(/punten in orde brengen/);

  typ('veld-email', 'ouder@example.org');
  typ('veld-contactVoornaam', 'An');
  typ('veld-voornaam', 'Lotte');
  typ('veld-naam', 'Peeters');
  typ('veld-school', 'Basisschool Test (Gent)');
  fireEvent.click(screen.getByLabelText('6de leerjaar'));
  fireEvent.click(screen.getByLabelText(/A-stroom/));
  volgende();

  await screen.findByRole('heading', { name: 'Kies je moment' });
  const radios = await screen.findAllByRole('radio');
  fireEvent.click(radios[0]);
  volgende();

  await screen.findByRole('heading', { name: 'Stel je programma samen' });
  const k1 = await waitFor(() => document.querySelectorAll('fieldset.keuzeblok')[0] as HTMLElement);
  const k2 = document.querySelectorAll('fieldset.keuzeblok')[1] as HTMLElement;
  const ned = within(k1).getByText('Nederlands – Escape Room').closest('label')!.querySelector('input')!;
  expect(ned.disabled).toBe(true); // volzet in de demo
  fireEvent.click(within(k1).getByText('Domein Kunst'));
  const kunstK2 = within(k2).getByText('Domein Kunst').closest('label')!.querySelector('input')!;
  expect(kunstK2.disabled).toBe(true); // al gekozen in keuzelesje 1
  expect(within(k2).queryByText('Proeflesje B-stroom')).toBeNull(); // andere stroom
  volgende();
  expect((await screen.findByRole('alert')).textContent).toMatch(/keuzelesje 2/);
  fireEvent.click(within(k2).getByText('Lesje Wiskunde'));
  volgende();

  await screen.findByRole('heading', { name: 'Controleer en verstuur' });
  expect(document.body.textContent).toMatch(/Domein Kunst/);
  fireEvent.click(screen.getByRole('checkbox'));
  volgende();

  await screen.findByRole('heading', { name: 'Je inschrijving is gelukt!' }, { timeout: 3000 });
  const link = screen.getByRole('link', { name: /beheerlink/ }) as HTMLAnchorElement;
  const token = link.href.split('/beheer/')[1];

  // Tweede keer zelfde kind → dubbel
  fireEvent.click(screen.getByRole('button', { name: /Nog een kind/ }));
  await screen.findByRole('heading', { name: 'Over jou en je kind' });
  expect(veld('veld-email').value).toBe('ouder@example.org');

  cleanup();
  render(<BeheerPagina token={token} />);
  await screen.findByRole('heading', { name: /Inschrijving van Lotte Peeters/ });
  fireEvent.click(screen.getByRole('button', { name: 'Inschrijving annuleren' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ja, annuleren' }));
  await screen.findByRole('heading', { name: 'Deze inschrijving is geannuleerd' }, { timeout: 3000 });
}, 15000);

test('probleem melden: verplichte velden, technische gegevens en logboek', async () => {
  cleanup();
  const { MeldKnop } = await import('./components/MeldKnop');
  const { log, logboek } = await import('./services/logboek');
  log('info', 'GET /api/registraties/' + 'z'.repeat(43) + ' door ouder@example.org');
  expect(logboek()[logboek().length - 1].bericht).toBe('GET /api/registraties/[token] door [e-mail]');

  render(<MeldKnop />);
  fireEvent.click(screen.getByRole('button', { name: 'Probleem of idee?' }));
  const venster = await screen.findByRole('dialog', { name: 'Probleem of idee melden' });
  expect(within(venster).getByText(/Welke technische gegevens/)).toBeTruthy();
  expect(venster.querySelector('pre')!.textContent).toMatch(/appVersie[\s\S]*browser[\s\S]*tijdzone/);

  fireEvent.click(within(venster).getByRole('button', { name: 'Melding versturen' }));
  expect(within(venster).getByText('Kies wat je wil melden.')).toBeTruthy();

  fireEvent.click(within(venster).getByLabelText('Er loopt iets mis'));
  fireEvent.change(venster.querySelector('#meld-omschrijving')!, { target: { value: 'De knop Volgende reageert niet' } });
  fireEvent.click(within(venster).getByRole('button', { name: 'Melding versturen' }));
  await within(venster).findByRole('status');

  fireEvent.click(within(venster).getByRole('button', { name: 'Sluiten' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
