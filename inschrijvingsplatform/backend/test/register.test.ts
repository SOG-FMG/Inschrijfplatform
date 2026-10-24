// Module-register: manifesten controleren, modules aan/uit, routes zoeken, rechten (geen D1 nodig).
import { describe, expect, test } from 'vitest';
import { defineModule, type Module } from '../src/kern/module';
import { maakRegister } from '../src/kern/register';
import type { Gebruiker } from '../src/kern/toegang';
import { ALLE_MODULES } from '../src/modules';

const leeg = async () => ({});
const basis = (m: Partial<Module> & { id: string }): Module => defineModule({ naam: m.id, versie: '1.0.0', vereistKern: '^1.0.0', ...m });
const gebruiker = (rol: Gebruiker['rol']) => ({ gebruikerId: 'x', email: 'x@y.be', rol, schoolId: null, moetWachtwoordInstellen: false }) as Gebruiker;

describe('de modules in deze code', () => {
  test('laden zonder fouten, kern altijd eerst', () => {
    const r = maakRegister(ALLE_MODULES);
    expect(r.actief.map((m) => m.id)).toEqual(['kern', 'evenementen', 'onderwijs', 'rapporten', 'etiketten', 'meldingen']);
  });

  test('MODULES kiest een deel; de kern blijft actief', () => {
    const r = maakRegister(ALLE_MODULES, 'evenementen, meldingen');
    expect(r.actief.map((m) => m.id)).toEqual(['kern', 'evenementen', 'meldingen']);
    expect(r.zoek('beheer', 'GET', '/evenementen/abc/rapport')).toBeNull();
    expect(r.zoek('publiek', 'GET', '/scholen')).toBeNull();
    expect(r.zoek('publiek', 'POST', '/meldingen')?.module.id).toBe('meldingen');
  });

  test('de dagelijkse taken komen van de actieve modules', () => {
    expect(maakRegister(ALLE_MODULES).taken.map((t) => t.module.id)).toEqual(['kern', 'evenementen', 'meldingen']);
    expect(maakRegister(ALLE_MODULES, 'evenementen').taken.map((t) => t.module.id)).toEqual(['kern', 'evenementen']);
  });

  test('een module zonder haar afhankelijkheid wordt geweigerd', () => {
    expect(() => maakRegister(ALLE_MODULES, 'rapporten')).toThrow(/vereist module "evenementen"/);
  });

  test('een tikfout in MODULES wordt geweigerd', () => {
    expect(() => maakRegister(ALLE_MODULES, 'evenementen,ticket')).toThrow(/onbekende module "ticket"/);
  });
});

describe('routes', () => {
  const r = maakRegister(ALLE_MODULES);

  test('parameters en soorten', () => {
    expect(r.zoek('publiek', 'GET', '/evenementen/fmg-infodagen-2027')?.params).toEqual({ slug: 'fmg-infodagen-2027' });
    expect(r.zoek('publiek', 'GET', '/evenementen/FMG')).toBeNull(); // slug: kleine letters
    expect(r.zoek('publiek', 'GET', `/registraties/${'a'.repeat(43)}`)?.params.token).toHaveLength(43);
    expect(r.zoek('publiek', 'GET', `/registraties/${'a'.repeat(42)}`)).toBeNull();
    const id = '3f2a9c1e-1111-4a6b-9c1e-aaaaaaaaaaaa';
    expect(r.zoek('beheer', 'GET', `/evenementen/${id}/deelnemers.csv`)?.params.id).toBe(id);
    expect(r.zoek('beheer', 'GET', `/evenementen/${id}/deelnemersXcsv`)).toBeNull(); // punt is letterlijk
    expect(r.zoek('beheer', 'GET', '/evenementen/geen-uuid-maar-wel-36-tekens-lang-abcdef/deelnemers.csv')).toBeNull();
  });

  test('methode telt mee; publiek en beheer zijn gescheiden', () => {
    expect(r.zoek('beheer', 'DELETE', '/meldingen')).toBeNull();
    expect(r.zoek('publiek', 'GET', '/meldingen')).toBeNull();
    expect(r.zoek('beheer', 'GET', '/meldingen')?.module.id).toBe('meldingen');
  });
});

describe('rechten', () => {
  const r = maakRegister(ALLE_MODULES);
  test('platformbeheerder heeft alle rechten; andere rollen enkel wat het manifest geeft', () => {
    expect(r.heeftRecht(gebruiker('platformbeheerder'), 'meldingen.beheren')).toBe(true);
    expect(r.heeftRecht(gebruiker('organisator'), 'meldingen.beheren')).toBe(false);
    expect(r.heeftRecht(gebruiker('onthaal'), 'kern.mail.testen')).toBe(false);
  });
});

describe('manifesten die niet kloppen', () => {
  const route = (pad: string, extra = {}) => ({ methode: 'GET' as const, pad, toegang: 'publiek' as const, handler: leeg, ...extra });

  test('dubbele id, foute id, andere kernversie', () => {
    expect(() => maakRegister([basis({ id: 'a' }), basis({ id: 'a' })])).toThrow(/twee keer/);
    expect(() => maakRegister([basis({ id: 'Tickets' })])).toThrow(/Ongeldige module-id/);
    expect(() => maakRegister([basis({ id: 'a', vereistKern: '^2.0.0' })])).toThrow(/vereist kern/);
  });

  test('twee modules met dezelfde route', () => {
    expect(() => maakRegister([basis({ id: 'a', routes: [route('/x/:id')] }), basis({ id: 'b', routes: [route('/x/:nr')] })])).toThrow(/bestaat al in module a/);
  });

  test('recht moet bij de module horen en bestaan', () => {
    expect(() => maakRegister([basis({ id: 'a', rechten: { 'b.lezen': { omschrijving: '', rollen: [] } } })])).toThrow(/moet beginnen met "a."/);
    expect(() =>
      maakRegister([basis({ id: 'a', routes: [{ methode: 'GET', pad: '/a', toegang: 'beheer', recht: 'a.onbekend', handler: leeg }] })]),
    ).toThrow(/onbekend recht/);
  });

  test('onbekende soort parameter en kringverwijzing', () => {
    expect(() => maakRegister([basis({ id: 'a', routes: [route('/a/:x:getal')] })])).toThrow(/onbekende soort/);
    expect(() => maakRegister([basis({ id: 'a', afhankelijkVan: ['b'] }), basis({ id: 'b', afhankelijkVan: ['a'] })])).toThrow(/Kringverwijzing/);
  });

  test('dezelfde foutcode in twee modules', () => {
    expect(() => maakRegister([basis({ id: 'a', fouten: { X: [400, 'a'] } }), basis({ id: 'b', fouten: { X: [409, 'b'] } })])).toThrow(/Foutcode X/);
  });
});
