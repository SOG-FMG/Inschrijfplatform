import { describe, expect, test } from 'vitest';
import { leesCsv } from './importlogica';
import { bouwProgramma, heeftKopregel, leesLesje, leesMoment, leesTijdsblok, leesTijdstempel, stelInsKoppelingVoor } from './inschrijvingen';

// Zelfde kolommen als de export van Google Formulieren (infodagen 2026), met verzonnen gegevens.
const KOP = 'Tijdstempel;E-mailadres;Voornaam Ouder;TelefoonnummerOuder;Naam leerling;Voornaam leerling;Huidige school;Huidig schooljaar;"Ik wil info en proeflesjes voor A of B-stroom\n";Moment;'
  + 'Keuzelesje 1 - start 10.10 u.;Keuzelesje 2 - start 11.30 u.;Keuzelesje 1 - start 13.10 u.;Keuzelesje 2 - start 14.30 u.;'
  + 'Keuzelesje 1 - start 10.10 u.;Keuzelesje 2 - start 11.30 u.;Keuzelesje 1 - start 13.10 u.;Keuzelesje 2 - start 14.30 u.;Moment B-stroom';
const A = 'A-stroom - leerlingen met getuigschrift lager onderwijs';
const B = 'B-stroom - hoofdzakelijk leerlingen zonder getuigschrift lager onderwijs';
const CSV = [
  KOP,
  `8/12/2025 17:05;een@example.org;Ouder;0400;Proef;Een;School A;5de leerjaar;${A};Zaterdag 24 januari - Namiddag 13.00u. - 15.10u.;;;Domein Kunst;Lesje wiskunde;;;;;`,
  `9/12/2025 9:00;twee@example.org;Ouder;;Proef;Twee;School B;6de leerjaar;${A};Zaterdag 24 januari - Voormiddag 10.00u. - 12.10u.;#ERROR!;- geen;;;;;;;`,
  // Lesjes in de kolommen van 24 januari, maar moment 7 maart (komt voor in de echte export)
  `10/01/2026 10:00;drie@example.org;Ouder;;Proef;Drie;School C;6de leerjaar;${A};Zaterdag 7 maart - Namiddag 13.00u. - 15.00u.;;;Lesje Geschiedenis;- Infomoment met ouder(s);;;;;`,
  `11/01/2026 10:00;vier@example.org;Ouder;;Proef;Vier;School C;6de leerjaar;${A};Zaterdag 7 maart - Namiddag 13.00u. - 15.00u.;;;;;;;Lesje geschiedenis;- geen;`,
  `12/01/2026 10:00;vijf@example.org;Ouder;;Proef;Vijf;School D;Andere;${B};;;;;;;;;;Zaterdag 24 januari - Voormiddag 10.00u. - 12.10u.`,
  `13/01/2026 10:00;zes@example.org;Ouder;;Proef;Zes;School D;6de leerjaar;${A};;;;;;;;;;`,
].join('\n');

describe('inschrijvingen uit een formulier', () => {
  const { kolommen, rijen } = leesCsv(CSV);

  test('kolommen voorstellen: velden, momenten en lesjes', () => {
    expect(heeftKopregel(kolommen)).toBe(true);
    const k = stelInsKoppelingVoor(kolommen, rijen);
    expect(k.velden).toMatchObject({ ingediendOp: 0, email: 1, ouderVoornaam: 2, telefoon: 3, kindNaam: 4, kindVoornaam: 5, school: 6, leerjaar: 7, doelgroep: 8 });
    expect(k.momenten).toEqual([9, 18]);
    expect(k.lesjes.map((l) => [l.kolom, l.tijdsblok, l.start])).toEqual([
      [10, 'Keuzelesje 1', '10:10'], [11, 'Keuzelesje 2', '11:30'], [12, 'Keuzelesje 1', '13:10'], [13, 'Keuzelesje 2', '14:30'],
      [14, 'Keuzelesje 1', '10:10'], [15, 'Keuzelesje 2', '11:30'], [16, 'Keuzelesje 1', '13:10'], [17, 'Keuzelesje 2', '14:30'],
    ]);
  });

  test('zonder kopregel: lege eerste regel of meteen gegevens', () => {
    expect(heeftKopregel(['', '', ''])).toBe(false);
    expect(heeftKopregel(['26-1-2026 11:43:59', 'x@example.org'])).toBe(false);
  });

  test('moment, tijdsblok, lesje en tijdstempel lezen', () => {
    expect(leesMoment('Zaterdag 24 januari - Voormiddag 10.00u. - 12.100u.', '2025-2026'))
      .toEqual({ dagNaam: 'Zaterdag 24 januari', datum: '2026-01-24', dagdeel: 'Voormiddag', start: '10:00', eind: '12:10' });
    expect(leesMoment('Zaterdag 6 december - Namiddag', '2025-2026')).toMatchObject({ datum: '2025-12-06', dagdeel: 'Namiddag', start: '13:00' });
    expect(leesMoment('onbekend', '2025-2026')?.datum).toBeNull();
    expect(leesTijdsblok('Keuzelesje 2 - start 14.30 u.')).toEqual({ tijdsblok: 'Keuzelesje 2', start: '14:30' });
    expect(leesLesje('- geen')).toEqual({ soort: 'geen' });
    expect(leesLesje('#ERROR!')).toEqual({ soort: 'fout' });
    expect(leesLesje('- Infomoment met ouder(s)')).toEqual({ soort: 'lesje', titel: 'Infomoment met ouder(s)' });
    expect(leesLesje('')).toBeNull();
    expect(leesTijdstempel('26-1-2026 11:43:59', 'DMJ')).toBe(new Date('2026-01-26T11:43:59').toISOString());
    expect(leesTijdstempel('8/12/2025 17:05', 'DMJ')).toBe(new Date('2025-12-08T17:05:00').toISOString());
  });

  test('programma: tijdsblok volgt het moment, schrijfwijzen samen, onbekende keuzes geteld', () => {
    const k = stelInsKoppelingVoor(kolommen, rijen);
    const p = bouwProgramma(rijen, k, '2025-2026');
    expect(p.dagen.map((d) => [d.datum, d.dagdelen.map((dd) => dd.naam)])).toEqual([['2026-01-24', ['Voormiddag', 'Namiddag']], ['2026-03-07', ['Namiddag']]]);
    const maart = p.dagen[1].dagdelen[0];
    expect(maart.tijdsblokken.map((t) => [t.naam, t.start, t.sessies.map((s) => s.titel)])).toEqual([
      ['Keuzelesje 1', '13:10', ['Lesje Geschiedenis']], // even vaak: de eerste schrijfwijze
      ['Keuzelesje 2', '14:30', ['Infomoment met ouder(s)']],
    ]);
    expect(p.rijen[3].sessies[0]).toBe(p.rijen[2].sessies[0]); // zelfde lesje, andere kolom en schrijfwijze
    expect(p.rijen[1]).toMatchObject({ sessies: [], onbekend: 1 });
    expect(p.rijen[4].dagdeel).toBe(p.dagen[0].dagdelen[0].sleutel); // B-stroom: moment uit "Moment B-stroom"
    expect(p.rijen[5].dagdeel).toBeNull();
  });
});
