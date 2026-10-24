// Profiel van de installatie: aanmelddomeinen en organisatienaam uit de configuratie (geen D1 nodig).
import { describe, expect, test } from 'vitest';
import worker from '../src/index';
import { domeinTekst, installatie, isToegelatenEmail } from '../src/kern/installatie';
import type { Env } from '../src/types';

const metDomeinen = (AANMELD_DOMEINEN?: string) => ({ AANMELD_DOMEINEN }) as Env;

describe('aanmelddomeinen', () => {
  test('één domein, hoofdletters en spaties maken niet uit', () => {
    const env = metDomeinen(' Onderwijs.Gent.be ');
    expect(isToegelatenEmail(env, 'An.Janssens@onderwijs.gent.be')).toBe(true);
    expect(isToegelatenEmail(env, 'a@evilonderwijs.gent.be')).toBe(false);
    expect(isToegelatenEmail(env, 'a@onderwijs.gent.be.evil.com')).toBe(false);
    expect(isToegelatenEmail(env, 'a@b@onderwijs.gent.be')).toBe(false);
    expect(domeinTekst(env)).toBe('@onderwijs.gent.be');
  });

  test('meerdere domeinen, ook met @ ervoor', () => {
    const env = metDomeinen('meulestede.be, @gent.be');
    expect(installatie(env).aanmeldDomeinen).toEqual(['meulestede.be', 'gent.be']);
    expect(isToegelatenEmail(env, 'x@gent.be')).toBe(true);
    expect(isToegelatenEmail(env, 'x@meulestede.be')).toBe(true);
    expect(isToegelatenEmail(env, 'x@onderwijs.gent.be')).toBe(false);
    expect(domeinTekst(env)).toBe('@meulestede.be of @gent.be');
  });

  test('"*" laat elk geldig adres toe', () => {
    const env = metDomeinen('*');
    expect(isToegelatenEmail(env, 'iemand@gmail.com')).toBe(true);
    expect(isToegelatenEmail(env, 'geen-adres')).toBe(false);
  });

  test('niet ingesteld: niemand toegelaten', () => {
    expect(isToegelatenEmail(metDomeinen(undefined), 'a@onderwijs.gent.be')).toBe(false);
    expect(isToegelatenEmail(metDomeinen(' , '), 'a@onderwijs.gent.be')).toBe(false);
  });
});

test('GET /api/installatie geeft naam, domeinen en actieve modules, zonder aanmelden', async () => {
  const env = { ORGANISATIE_NAAM: 'Cultureel Centrum Meulestede', AANMELD_DOMEINEN: 'meulestede.be', MODULES: 'evenementen,meldingen', ALLOWED_ORIGINS: '' } as Env;
  const res = await worker.fetch(new Request('http://localhost/api/installatie'), env, {} as ExecutionContext);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ organisatie: 'Cultureel Centrum Meulestede', aanmeldDomeinen: ['meulestede.be'], modules: ['kern', 'evenementen', 'meldingen'] });
});
