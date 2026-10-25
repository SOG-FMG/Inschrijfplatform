// Verzonnen gegevens.
import { describe, expect, test } from 'vitest';
import type { OverzichtInschrijving } from '../services/beheerApi';
import { vraagTekst, zoekDubbels } from './EvenementOverzicht';

let n = 0;
const ins = (w: Partial<OverzichtInschrijving>): OverzichtInschrijving => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, persoonId: null, contactId: null, voornaam: 'Kim', naam: 'Proef', email: 'a@example.org',
  ouder: 'Ouder', ingeschrevenOp: '2026-01-01T10:00:00Z', status: 'actief', school: 'S', leerjaar: '6de leerjaar', doelgroep: 'A-stroom',
  momenten: [{ id: 'vm', dag: 'Zaterdag 24 januari', datum: '2026-01-24', dagdeel: 'Voormiddag', aanwezig: false }], lesjes: [], voorinschrijving: false, ...w,
});

describe('dubbels', () => {
  test('zelfde naam met een ander adres, tikfout bij hetzelfde adres; broer of zus apart', () => {
    const g = zoekDubbels([
      ins({ voornaam: 'Victor', naam: 'Schotte', email: 'een@example.org' }),
      ins({ voornaam: 'Victor', naam: 'Schotte', email: 'twee@example.org', ingeschrevenOp: '2026-02-22T10:00:00Z' }),
      // zelfde naam, ander adres, andere school en ander leerjaar: twee kinderen
      ins({ voornaam: 'Lou', naam: 'Maes', email: 'x@example.org', school: 'S1', leerjaar: '5de leerjaar' }),
      ins({ voornaam: 'Lou', naam: 'Maes', email: 'y@example.org', school: 'S2', leerjaar: '6de leerjaar' }),
      ins({ voornaam: 'Aylin', naam: 'Malikshahi', email: 'c@example.org' }),
      ins({ voornaam: 'Aylin', naam: 'Malkshahi', email: 'c@example.org', ingeschrevenOp: '2026-01-20T10:00:00Z' }),
      ins({ voornaam: 'Wies', naam: 'Lootens', email: 'd@example.org' }),
      ins({ voornaam: 'Ada', naam: 'Lootens', email: 'd@example.org' }),
    ]);
    expect(g.map((x) => [x.soort, x.leden.map((l) => l.voornaam + ' ' + l.naam)])).toEqual([
      ['open', ['Aylin Malkshahi', 'Aylin Malikshahi']],
      ['open', ['Victor Schotte', 'Victor Schotte']],
    ]);
    expect(g[1].leden[0].email).toBe('twee@example.org'); // de laatste eerst: die blijft
    expect(g.map((x) => x.waarom)).toEqual([['bijna dezelfde naam, zelfde e-mailadres'], ['zelfde naam, ander e-mailadres']]);
  });

  test('vervangen met een andere stroom: navragen, met een voorstel van mail', () => {
    const [g] = zoekDubbels([
      ins({ persoonId: 'p1', status: 'geannuleerd', ingeschrevenOp: '2025-12-09T10:00:00Z', lesjes: [{ id: 's', tijdsblok: 'Keuzelesje 1', start: '13:10', titel: 'Domein Kunst', wachtlijst: false, klas: null }] }),
      ins({ persoonId: 'p1', doelgroep: 'B-stroom', ingeschrevenOp: '2026-01-21T10:00:00Z' }),
    ]);
    expect(g).toMatchObject({ soort: 'vraag', verschillen: ['stroom', 'lesjes'] });
    const m = vraagTekst(g, 'Infodagen 2025-2026');
    expect(m.onderwerp).toBe('Vraag over de inschrijving van Kim voor Infodagen 2025-2026');
    expect(m.tekst).toContain('Dag Ouder,');
    expect(m.tekst).toContain('We houden de laatste inschrijving aan: **B-stroom, Zaterdag 24 januari voormiddag, geen lesje**.');
    expect(m.tekst).toContain('A-stroom, Zaterdag 24 januari voormiddag, lesjes: Domein Kunst');
  });
});
