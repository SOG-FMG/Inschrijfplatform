import { describe, expect, test } from 'vitest';
import { HANDLEIDINGEN, HELP_PER_PAD, helpUrl } from './handleidingen';

describe('handleiding', () => {
  test('elke pagina verwijst naar een bestaande stap; ids uniek en in kleine letters (zie de route)', () => {
    for (const [, h, s] of HELP_PER_PAD) expect(HANDLEIDINGEN.find((x) => x.id === h)?.stappen.some((x) => x.id === s), `${h}/${s}`).toBe(true);
    const ids = HANDLEIDINGEN.flatMap((h) => [h.id, ...h.stappen.map((s) => `${h.id}/${s.id}`)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((i) => /^[a-z]+(\/[a-z]+)?$/.test(i))).toBe(true);
  });

  test('help bij deze pagina: stap en evenement', () => {
    expect(helpUrl('/dashboard/evenementen/abc-1/overzicht')).toBe('/dashboard/help/overzicht/tellers?evenement=abc-1');
    expect(helpUrl('/dashboard/evenementen/abc-1')).toBe('/dashboard/help/evenement/algemeen?evenement=abc-1');
    expect(helpUrl('/dashboard/importeren', '?evenement=xyz')).toBe('/dashboard/help/vorigjaar/evenement?evenement=xyz');
    expect(helpUrl('/dashboard/onbekend')).toBe('/dashboard/help');
  });
});
