// Verzonnen namen en adressen.
import { describe, expect, test } from 'vitest';
import { leesGeplakt, splitsOpAdres } from './plakken';

const kort = (l: ReturnType<typeof leesGeplakt>) => l.map((c) => [c.voornaam, c.naam, c.email, c.herkend]);

describe('contacten plakken', () => {
  test('Outlook: de voornaam is wat vooraan in het adres staat, in welke volgorde ook', () => {
    const l = leesGeplakt('"De Schepper Stijn" <stijn.deschepper@onderwijs.gent.be>; "An Peeters" <An.Peeters@onderwijs.gent.be>', 'voornaam-naam');
    expect(kort(l)).toEqual([
      ['Stijn', 'De Schepper', 'stijn.deschepper@onderwijs.gent.be', 'adres'],
      ['An', 'Peeters', 'an.peeters@onderwijs.gent.be', 'adres'],
    ]);
  });

  test('voornaam van twee woorden, met streepje of accent, en een adres zonder punt', () => {
    expect(splitsOpAdres('Van Damme Jan-Pieter', 'jan-pieter.vandamme@x.be', 'voornaam-naam')).toMatchObject({ voornaam: 'Jan-Pieter', naam: 'Van Damme' });
    expect(splitsOpAdres('Van den Broeck Anne Marie', 'annemarie.vandenbroeck@x.be', 'voornaam-naam')).toMatchObject({ voornaam: 'Anne Marie', naam: 'Van den Broeck' });
    expect(splitsOpAdres('Désiré Martens', 'desire.martens@x.be', 'naam-voornaam')).toMatchObject({ voornaam: 'Désiré', naam: 'Martens' });
    expect(splitsOpAdres('Claes Lotte', 'lotteclaes@x.be', 'voornaam-naam')).toMatchObject({ voornaam: 'Lotte', naam: 'Claes', herkend: 'adres' });
  });

  test('komma, geen naam, onbekend adres, dubbels en losse adressen', () => {
    const l = leesGeplakt(`"De Schepper, Stijn" <s.ds@x.be>
info@school.be, jan.janssens@x.be
"Iemand Anders" <xyz@x.be>
<jan.janssens@x.be>`, 'naam-voornaam');
    expect(kort(l)).toEqual([
      ['Stijn', 'De Schepper', 's.ds@x.be', 'komma'],
      ['Anders', 'Iemand', 'xyz@x.be', 'volgorde'],
      ['Jan', 'Janssens', 'jan.janssens@x.be', 'uit-adres'],
      ['Info', '', 'info@school.be', 'uit-adres'],
    ]);
  });

  test('rijen uit Excel (tabs)', () => {
    const l = leesGeplakt('Voornaam\tNaam\tE-mail\nStijn\tDe Schepper\tstijn.deschepper@x.be\nLotte\tClaes\tlotte.claes@x.be\n', 'naam-voornaam');
    expect(kort(l)).toEqual([
      ['Stijn', 'De Schepper', 'stijn.deschepper@x.be', 'adres'],
      ['Lotte', 'Claes', 'lotte.claes@x.be', 'adres'],
    ]);
  });
});
