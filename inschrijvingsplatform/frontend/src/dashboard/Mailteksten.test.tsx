import { describe, expect, test } from 'vitest';
import { zetInspring, zetLijst } from './Mailteksten';

describe('opmaak-knoppen: lijst en inspringen (zuivere regelfuncties)', () => {
  test('zetLijst: aan zet "- " ervoor, uit haalt het (met inspringen) weg', () => {
    expect(zetLijst('hallo', true)).toBe('- hallo');
    expect(zetLijst('- hallo', true)).toBe('- hallo'); // al een lijst: ongewijzigd
    expect(zetLijst('- hallo', false)).toBe('hallo');
    expect(zetLijst('  - diep', false)).toBe('  diep'); // inspringen blijft staan, voor als de regel terug een lijst wordt
    expect(zetLijst('gewone tekst', false)).toBe('gewone tekst'); // geen lijst: ongewijzigd
  });

  test('zetInspring: enkel op een lijstregel, twee spaties per niveau, nooit onder nul', () => {
    expect(zetInspring('- a', 1)).toBe('  - a');
    expect(zetInspring('  - a', 1)).toBe('    - a');
    expect(zetInspring('  - a', -1)).toBe('- a');
    expect(zetInspring('- a', -1)).toBe('- a'); // al op niveau 0
    expect(zetInspring('gewone tekst', 1)).toBe('gewone tekst'); // geen lijstregel: ongewijzigd
  });
});
