// Mailsjablonen: opmaak, veiligheid en de standaardteksten van alle modules (geen D1 nodig).
import { describe, expect, test } from 'vitest';
import { controleerSjabloon, maakHtml, maakOnderwerp, voorbeeldVelden, type SjabloonDefinitie } from '../src/kern/sjablonen';
import { afmetingen } from '../src/modules/mailsjablonen/opmaak';
import { ALLE_MODULES } from '../src/modules';

const def: SjabloonDefinitie = {
  sleutel: 'proef',
  naam: 'Proef',
  omschrijving: '',
  velden: ['naam', 'lijst', 'link', 'extra'].map((naam) => ({ naam, omschrijving: '', voorbeeld: '' })),
  standaard: { onderwerp: '', tekst: '' },
  reden: '',
};

describe('opmaak', () => {
  test('alinea\'s, regeleinden en vet', () => {
    expect(maakHtml('Dag **{{naam}}**,\nwelkom.\n\nTot dan!', { naam: 'Lotte' })).toBe('<p>Dag <strong>Lotte</strong>,<br>welkom.</p>\n<p>Tot dan!</p>');
  });

  test('tekst wordt veilig gemaakt, ook in velden; blokken blijven HTML', () => {
    const html = maakHtml('<b>{{naam}}</b>\n\n{{lijst}}\n\nKlik {{link}}.', { naam: '<script>', lijst: { html: '<ul><li>a</li></ul>' }, link: { html: '<a href="x">hier</a>' } });
    expect(html).toBe('<p>&lt;b&gt;&lt;script&gt;&lt;/b&gt;</p>\n<ul><li>a</li></ul>\n<p>Klik <a href="x">hier</a>.</p>');
  });

  test('secties: enkel als ingevuld, of enkel als leeg; ook over alinea\'s heen', () => {
    const t = '{{#extra}}Extra:\n\n{{extra}}{{/extra}}{{^extra}}Niets extra.{{/extra}}';
    expect(maakHtml(t, { extra: 'ja' })).toBe('<p>Extra:</p>\n<p>ja</p>');
    expect(maakHtml(t, { extra: '' })).toBe('<p>Niets extra.</p>');
    expect(maakHtml(t, { extra: { html: '' } })).toBe('<p>Niets extra.</p>');
  });

  test('onderwerp: platte tekst, zonder blokken', () => {
    expect(maakOnderwerp('Klaslijst {{naam}}{{#extra}} ({{extra}}){{/extra}} {{lijst}}', { naam: 'Frans', extra: '3', lijst: { html: '<ul/>' } })).toBe('Klaslijst Frans (3)');
  });

  test('controle: onbekende velden en niet gesloten secties', () => {
    expect(controleerSjabloon('Dag {{naam}} {{#extra}}x{{/extra}}', def)).toEqual([]);
    expect(controleerSjabloon('Dag {{voornaam}}', def)).toEqual(['Onbekend veld {{voornaam}}.']);
    expect(controleerSjabloon('{{#extra}}x', def)).toContain('Een {{#veld}} of {{^veld}} wordt niet gesloten met {{/veld}}.');
    expect(controleerSjabloon('Dag {{ naam', def)).toContain('Een veld is niet goed geschreven: gebruik {{naam}}.');
  });
});

describe('afmetingen van banners', () => {
  test('PNG en JPG, anders null', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 1, 0x2c]);
    expect(afmetingen(png)).toEqual({ type: 'image/png', breedte: 1200, hoogte: 300 });
    // JPG: SOI, een APP0-blok, dan SOF0 met hoogte 200 en breedte 1200
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 200, 4, 0xb0, 3, 0, 0, 0, 0, 0, 0]);
    expect(afmetingen(jpg)).toEqual({ type: 'image/jpeg', breedte: 1200, hoogte: 200 });
    expect(afmetingen(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0]))).toBeNull(); // GIF
  });
});

describe('de sjablonen van alle modules', () => {
  const alle = ALLE_MODULES.flatMap((m) => m.mailsjablonen ?? []);

  test('er zijn sjablonen, met unieke sleutels', () => {
    expect(alle.map((s) => s.sleutel).sort()).toEqual(['aanmeldcode', 'annulatie', 'bevestiging', 'herinnering', 'klaslijst', 'qrcode', 'schoolwijziging', 'sessiegever', 'uitnodiging', 'voorinschrijving', 'wijziging']);
  });

  test.each(alle.map((s) => [s.sleutel, s] as const))('%s: standaardtekst gebruikt enkel bestaande velden en geeft een volledige mail', (_, s) => {
    expect(controleerSjabloon(s.standaard.onderwerp, s)).toEqual([]);
    expect(controleerSjabloon(s.standaard.tekst, s)).toEqual([]);
    const v = voorbeeldVelden(s);
    expect(maakOnderwerp(s.standaard.onderwerp, v)).not.toMatch(/\{\{/);
    expect(maakHtml(s.standaard.tekst, v)).not.toMatch(/\{\{/);
  });
});
