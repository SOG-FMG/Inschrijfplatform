// Verzonnen gegevens in het formaat van een Microsoft Forms-export; nooit echte inschrijvingen in tests.
import { describe, expect, test } from 'vitest';
import type { School } from '../../types';
import { herkenDatumvorm, koppelSchool, leesCsv, leesDatum, schoon, stelKoppelingVoor } from './importlogica';

const CSV = [
  'ID;Begintijd;Tijd van voltooien;E-mail;Naam;Tijd van laatste wijziging;Naam + Voornaam kind;Informatie gewenst voor�;Huidige school;Huidige klas;Mailadres�;Telefoonnummer�;Specifieke vragen of opmerkingen?',
  '1;13/3/25 13:26:06;13/3/25 13:27:09;anonymous;;;Janssens Proef;Schooljaar 2026 - 2027;Leefschool De Boomhut (De Pinte);6de leerjaar�;ouder@example.org;0400000000;"Vraag; met puntkomma"',
  '2;14/3/25 19:21:54;14/3/25 19:22:40;anonymous;;;Peeters Test;Schooljaar 2026 - 2027;sint paulus;6de leerjaar�;andere@example.org;;Nee',
  ';;;;;;;;;;;;',
  ';;;;;;;;;;;;',
].join('\r\n');

describe('CSV', () => {
  test('lege rijen weg, onzichtbare tekens weg, aanhalingstekens met scheidingsteken', () => {
    const { kolommen, rijen } = leesCsv(CSV);
    expect(rijen).toHaveLength(2);
    expect(kolommen[10]).toBe('Mailadres');
    expect(rijen[0][9]).toBe('6de leerjaar');
    expect(rijen[0][12]).toBe('Vraag; met puntkomma');
    expect(schoon(' a ​b ')).toBe('a b');
  });

  test('koppeling: Mailadres (met adressen) in plaats van E-mail (anonymous)', () => {
    const { kolommen, rijen } = leesCsv(CSV);
    const k = stelKoppelingVoor(kolommen, rijen);
    expect(kolommen[k.email!]).toBe('Mailadres');
    expect(kolommen[k.kindNaam!]).toBe('Naam + Voornaam kind');
    expect(kolommen[k.school!]).toBe('Huidige school');
    expect(kolommen[k.klas!]).toBe('Huidige klas');
    expect(kolommen[k.schooljaar!]).toBe('Informatie gewenst voor');
    expect(kolommen[k.telefoon!]).toBe('Telefoonnummer');
    expect(kolommen[k.opmerkingen!]).toBe('Specifieke vragen of opmerkingen?');
    expect(kolommen[k.ingediendOp!]).toBe('Tijd van voltooien');
  });
});

describe('datums', () => {
  test('vorm herkennen, of null als het niet blijkt', () => {
    expect(herkenDatumvorm(['11/3/25 13:26:06', '13/3/25 10:00:00'])).toBe('DMJ');
    expect(herkenDatumvorm(['3/13/25 10:00:00'])).toBe('MDJ');
    expect(herkenDatumvorm(['11/3/25 13:26:06'])).toBeNull();
  });
  test('lezen', () => {
    expect(leesDatum('11/3/25 13:26:06', 'DMJ')).toBe('2025-03-11T13:26:06');
    expect(leesDatum('11/3/25 13:26:06', 'MDJ')).toBe('2025-11-03T13:26:06');
    expect(leesDatum('2025-03-11T13:26:06', 'DMJ')).toBe('2025-03-11T13:26:06');
    expect(leesDatum('31/13/25', 'DMJ')).toBeNull();
    expect(leesDatum('geen', 'DMJ')).toBeNull();
  });
});

describe('scholen koppelen', () => {
  const scholen: School[] = [
    { id: '1', naam: 'Leefschool De Boomhut', gemeente: 'Nazareth-De Pinte' },
    { id: '2', naam: "Gemeentelijke Basisschool 'De Blije School'", gemeente: 'Nazareth-De Pinte' },
    { id: '3', naam: 'Sint-Paulusschool', gemeente: 'Deinze' },
    { id: '4', naam: 'Vrije Basisschool Sint-Paulus', gemeente: 'Gent' },
    { id: '5', naam: 'Gemeentelijke Basisschool', gemeente: 'Lochristi' },
    { id: '6', naam: 'De Kleurdoos', gemeente: 'Gent' },
  ];

  test('zeker: naam en gemeente (ook een deel van een fusiegemeente)', () => {
    const r = koppelSchool('Leefschool De Boomhut (De Pinte)', scholen);
    expect(r.zekerheid).toBe('zeker');
    expect(r.suggesties[0].school.id).toBe('1');
    expect(koppelSchool('De Kleurdoos Ledeberg', scholen).suggesties[0].school.id).toBe('6');
  });

  test('twijfel: meerdere scholen met dezelfde naam, of een algemene naam', () => {
    const r = koppelSchool('Sint Paulus', scholen);
    expect(r.zekerheid).toBe('twijfel');
    expect(r.suggesties.map((s) => s.school.id).sort()).toEqual(['3', '4']);
    expect(koppelSchool('gemeentelijke basisschool lochristi', scholen).zekerheid).toBe('twijfel');
    const deinze = koppelSchool('St.-Paulus Deinze', scholen);
    expect(deinze.zekerheid).toBe('zeker');
    expect(deinze.suggesties[0].school.id).toBe('3');
  });

  test('geen: onbekende school of leeg', () => {
    expect(koppelSchool('Atheneum Brugge', scholen).zekerheid).toBe('geen');
    expect(koppelSchool('', scholen).zekerheid).toBe('geen');
  });
});
