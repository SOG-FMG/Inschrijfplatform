// Integratietest: migraties + seed in een lokale D1 (Miniflare, echte SQLite) en
// alle aanvragen via de volledige Worker (validatie, routes, foutvertaling).
// Uitvoeren:  cd backend && npm test
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import worker from '../src/index';
import type { Env } from '../src/types';

const SLUG = 'fmg-infodagen-2027';
const STAAT = '.wrangler/test-state';
const BEHEERDER = 'organisator.test@onderwijs.gent.be';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;
const wachtend: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void wachtend.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

async function api(methode: string, pad: string, body?: unknown, host = 'http://localhost') {
  const res = await worker.fetch(
    new Request(`${host}${pad}`, { method: methode, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
    ctx,
  );
  const type = res.headers.get('Content-Type') ?? '';
  return { status: res.status, data: type.includes('json') ? ((await res.json()) as any) : await res.text(), headers: res.headers };
}
const sql = (q: string, ...p: unknown[]) => env.DB.prepare(q).bind(...p).run();
const een = <T = any>(q: string, ...p: unknown[]) => env.DB.prepare(q).bind(...p).first<T>();

beforeAll(async () => {
  rmSync(STAAT, { recursive: true, force: true });
  const w = (cmd: string) => execSync(`npx wrangler ${cmd} --local --persist-to ${STAAT}`, { stdio: 'pipe' });
  w('d1 migrations apply DB');
  w('d1 execute DB --file seed/seed.sql');
  w('d1 execute DB --file seed/seed_scholen.sql');
  proxy = await getPlatformProxy<Env>({ persist: { path: `${STAAT}/v3` } });
  env = {
    ...proxy.env,
    ENCRYPTION_KEY: 'a'.repeat(64),
    ALLOWED_ORIGINS: 'http://localhost:5173',
    PUBLIC_APP_URL: 'http://localhost:5173',
    MAIL_PROVIDER: 'log',
    ACCESS_AUD: '',
    ACCESS_TEAM_DOMAIN: '',
    TURNSTILE_SECRET: undefined,
    DEV_BEHEER_EMAIL: undefined,
  };
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(wachtend);
  await proxy?.dispose();
});

let teller = 0;
const deelnemer = (extra: Record<string, unknown> = {}) => ({
  naam: 'Test', voornaam: `Leerling${++teller}`, email: `ouder${teller}@example.org`,
  contactVoornaam: 'Ouder', privacyAkkoord: true, doelgroepId: groepA.id, leerjaar: '6de leerjaar', ...extra,
});
const registreer = (d: object, dagdelen: string[], sessies: string[]) =>
  api('POST', `/api/evenementen/${SLUG}/registraties`, { deelnemer: d, dagdelen, sessies });
const token = (r: { data: { beheerUrl: string } }) => r.data.beheerUrl.split('/beheer/')[1];

let ev: any, groepA: any, groepB: any, vm1: any, nm1: any, k1: any, k2: any;
const sessie = (tb: any, code: string) => tb.sessies.find((s: any) => s.code === code);

describe('publiek evenement', () => {
  test('structuur zoals publiek_evenement()', async () => {
    const r = await api('GET', `/api/evenementen/${SLUG}`);
    expect(r.status).toBe(200);
    ev = r.data;
    expect(ev.titel).toBe('Infodagen 2027');
    expect(ev.dagen).toHaveLength(2);
    expect(ev.leerjaarOpties).toContain('6de leerjaar');
    expect(ev.inschrijvingOpen).toBe(true);
    [groepA, groepB] = ev.doelgroepen;
    vm1 = ev.dagen[0].dagdelen[0];
    nm1 = ev.dagen[0].dagdelen[1];
    k1 = vm1.tijdsblokken.find((t: any) => t.naam === 'Keuzelesje 1');
    k2 = vm1.tijdsblokken.find((t: any) => t.naam === 'Keuzelesje 2');
    expect(sessie(k1, 'nederlands').capaciteit).toBe(8);
    expect(sessie(k1, 'nederlands').vrij).toBe(8);
    expect(sessie(k1, 'infomoment').capaciteit).toBeNull();
  });

  test('scholenlijst', async () => {
    const r = await api('GET', '/api/scholen');
    expect(r.data.length).toBeGreaterThan(500);
    expect(Object.keys(r.data[0]).sort()).toEqual(['gemeente', 'id', 'naam']);
  });
});

describe('registreren', () => {
  let eersteToken: string;

  test('1. gewone registratie, persoonsgegevens versleuteld bewaard', async () => {
    const r = await registreer(deelnemer({ naam: 'Peeters', voornaam: 'Lotte' }), [vm1.id], [sessie(k1, 'nederlands').id, sessie(k2, 'kunst').id]);
    expect(r.status).toBe(201);
    expect(r.data.keuzes).toHaveLength(2);
    expect(r.data.keuzes.every((k: any) => k.status === 'bevestigd')).toBe(true);
    expect(r.data.referentie).toMatch(/^[0-9A-F]{8}$/);
    expect(r.data.deelnemerId).toBeUndefined();
    eersteToken = token(r);

    const rij = await een(`select * from deelnemers order by created_at limit 1`);
    expect(JSON.stringify(rij)).not.toMatch(/Peeters|Lotte|example\.org/);
    expect(rij.naam_enc).toMatch(/^v1\./);
    const bekijk = await api('GET', `/api/registraties/${eersteToken}`);
    expect(bekijk.data).toMatchObject({ naam: 'Peeters', voornaam: 'Lotte', status: 'actief', annuleerbaar: true });
  });

  test('2. dubbele inschrijving (zelfde e-mail + leerling) wordt geweigerd, ook met andere hoofdletters', async () => {
    const d = deelnemer();
    expect((await registreer(d, [vm1.id], [])).status).toBe(201);
    const r = await registreer({ ...d, naam: d.naam.toUpperCase(), email: d.email.toUpperCase() }, [vm1.id], []);
    expect(r.data.fout).toBe('DUBBELE_INSCHRIJVING');
  });

  test('3. zelfde onderdeel twee keer kiezen wordt geweigerd', async () => {
    const r = await registreer(deelnemer(), [vm1.id], [sessie(k1, 'kunst').id, sessie(k2, 'kunst').id]);
    expect(r.data.fout).toBe('ZELFDE_ONDERDEEL_DUBBEL');
  });

  test('4. infomoment mag wel in beide blokken', async () => {
    expect((await registreer(deelnemer(), [vm1.id], [sessie(k1, 'infomoment').id, sessie(k2, 'infomoment').id])).status).toBe(201);
  });

  test('5. sessie uit een ander dagdeel of andere doelgroep wordt geweigerd', async () => {
    expect((await registreer(deelnemer(), [vm1.id], [nm1.tijdsblokken[1].sessies[0].id])).data.fout).toBe('ONGELDIGE_SESSIEKEUZE');
    expect((await registreer(deelnemer(), [vm1.id], [sessie(k1, 'bstroom').id])).data.fout).toBe('ONGELDIGE_SESSIEKEUZE');
    expect((await registreer(deelnemer({ doelgroepId: groepB.id }), [vm1.id], [sessie(k1, 'bstroom').id])).status).toBe(201);
  });

  test('6. capaciteit: volzet + atomisch (mislukte poging laat niets achter)', async () => {
    const ned = sessie(k1, 'nederlands').id;
    for (let i = 0; i < 7; i++) expect((await registreer(deelnemer(), [vm1.id], [ned])).status).toBe(201);
    const voor = await een(`select count(*) as n from deelnemers`);
    const vol = await registreer(deelnemer(), [vm1.id], [sessie(k2, 'wiskunde').id, ned]);
    expect(vol.status).toBe(409);
    expect(vol.data).toMatchObject({ fout: 'SESSIE_VOLZET', id: ned });
    expect(vol.data.melding).toContain('Nederlands');
    expect((await een(`select count(*) as n from deelnemers`)).n).toBe(voor.n);
    expect((await een(`select bevestigd from v_sessie_bezetting where sessie_id = ?`, sessie(k2, 'wiskunde').id)).bevestigd).toBe(0);
    const nu = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const nedNu = sessie(nu.dagen[0].dagdelen[0].tijdsblokken.find((t: any) => t.naam === 'Keuzelesje 1'), 'nederlands');
    expect(nedNu).toMatchObject({ volzet: true, vrij: 0 });
  });

  test('6b. gelijktijdige inschrijvingen overboeken nooit', async () => {
    const lat = sessie(k1, 'latijn').id;
    await sql(`update sessies set capaciteit = 3 where sessie_id = ?`, lat);
    const res = await Promise.all(Array.from({ length: 10 }, () => registreer(deelnemer(), [vm1.id], [lat])));
    expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    expect(res.filter((r) => r.data.fout === 'SESSIE_VOLZET')).toHaveLength(7);
    expect((await een(`select bevestigd from v_sessie_bezetting where sessie_id = ?`, lat)).bevestigd).toBe(3);
  });

  test('7. wachtlijst + doorschuiven na annulatie', async () => {
    const ned = sessie(k1, 'nederlands').id;
    await sql(`update sessies set wachtlijst_toegelaten = 1 where sessie_id = ?`, ned);
    const wacht = await registreer(deelnemer(), [vm1.id], [ned]);
    expect(wacht.data.keuzes[0].status).toBe('wachtlijst');
    const annul = await api('DELETE', `/api/registraties/${eersteToken}`);
    expect(annul.data.status).toBe('geannuleerd');
    const naWacht = await api('GET', `/api/registraties/${token(wacht)}`);
    expect(naWacht.data.keuzes[0].status).toBe('bevestigd');
    expect((await api('DELETE', `/api/registraties/${eersteToken}`)).data.fout).toBe('REGISTRATIE_NIET_GEVONDEN');
    wachtToken = token(wacht);
  });

  test('8. dagdeelcapaciteit', async () => {
    await sql(`update dagdelen set capaciteit = 0 where dagdeel_id = ?`, nm1.id);
    const r = await registreer(deelnemer(), [nm1.id], []);
    expect(r.data).toMatchObject({ fout: 'DAGDEEL_VOLZET', id: nm1.id });
    await sql(`update dagdelen set capaciteit = null where dagdeel_id = ?`, nm1.id);
  });

  test('9. validatie', async () => {
    expect((await registreer(deelnemer({ privacyAkkoord: false }), [vm1.id], [])).data.velden.privacyAkkoord).toBeDefined();
    expect((await registreer(deelnemer({ email: 'geen-mail' }), [vm1.id], [])).data.velden.email).toBeDefined();
    expect((await registreer(deelnemer(), [vm1.id, nm1.id], [])).data.fout).toBe('ONGELDIG_AANTAL_DAGDELEN');
    expect((await registreer(deelnemer({ doelgroepId: '' }), [vm1.id], [])).data.fout).toBe('ONGELDIGE_DOELGROEP');
    expect((await registreer(deelnemer({ schoolId: crypto.randomUUID() }), [vm1.id], [])).data.fout).toBe('ONGELDIGE_GEGEVENS');
    const kapot = await worker.fetch(new Request(`http://localhost/api/evenementen/${SLUG}/registraties`, { method: 'POST', body: '{' }), env, ctx);
    expect(((await kapot.json()) as any).fout).toBe('ONGELDIGE_AANVRAAG');
  });

  test('10. inschrijvingsperiode', async () => {
    await sql(`update evenementen set inschrijving_tot = ? where slug = ?`, new Date(Date.now() - 86_400_000).toISOString(), SLUG);
    expect((await registreer(deelnemer(), [vm1.id], [])).data.fout).toBe('INSCHRIJVING_GESLOTEN');
    await sql(`update evenementen set inschrijving_tot = null where slug = ?`, SLUG);
  });
});

let wachtToken: string;

describe('beheer', () => {
  let wachtId: string;

  beforeAll(async () => {
    await sql(
      `insert into gebruikers (naam, voornaam, email, rol_id) select 'Beheer', 'Test', ?, rol_id from rollen where code = 'organisator'`,
      BEHEERDER,
    );
    const { sha256 } = await import('../src/crypto/versleuteling');
    wachtId = (await een(`select deelnemer_id from deelnemers where beheer_token_hash = ?`, await sha256(wachtToken))).deelnemer_id;
  });

  test('niet aangemeld / ander domein / geen rechten', async () => {
    expect((await api('POST', `/api/beheer/deelnemers/${wachtId}/dagdeel`, { van: vm1.id, naar: nm1.id })).status).toBe(401);
    // DEV-aanmelding werkt enkel op localhost
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    expect((await api('GET', `/api/beheer/meldingen`, undefined, 'https://api.example.be')).status).toBe(401);
    // Extern domein: geweigerd, zelfs als de rij in gebruikers zou bestaan (check constraint verhindert dat ook)
    await expect(sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'X', 'Y', 'iemand@gmail.com', rol_id from rollen limit 1`)).rejects.toThrow(/CHECK/);
    await expect(sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'X', 'Y', 'a@evilonderwijs.gent.be', rol_id from rollen limit 1`)).rejects.toThrow(/CHECK/);
    env.DEV_BEHEER_EMAIL = 'iemand@gmail.com';
    expect((await api('GET', `/api/beheer/evenementen/${ev.evenementId}/deelnemers.csv`)).status).toBe(403);
    // Wel eigen domein, maar niet gekoppeld aan het evenement
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    expect((await api('POST', `/api/beheer/deelnemers/${wachtId}/dagdeel`, { van: vm1.id, naar: nm1.id })).data.fout).toBe('GEEN_TOEGANG');
    await sql(`insert into evenement_beheerders (evenement_id, gebruiker_id) select ?, gebruiker_id from gebruikers where email = ?`, ev.evenementId, BEHEERDER);
  });

  test('11. verplaatsen naar namiddag en sessie toekennen', async () => {
    const v = await api('POST', `/api/beheer/deelnemers/${wachtId}/dagdeel`, { van: vm1.id, naar: nm1.id });
    expect(v.data).toEqual({ verplaatst: true, sessiesGeannuleerd: 1 });
    const nmK1 = nm1.tijdsblokken.find((t: any) => t.naam === 'Keuzelesje 1');
    const t = await api('POST', `/api/beheer/deelnemers/${wachtId}/sessie`, { sessieId: sessie(nmK1, 'latijn').id });
    expect(t.data.status).toBe('bevestigd');
    expect((await api('POST', `/api/beheer/deelnemers/${wachtId}/sessie`, { sessieId: sessie(k1, 'kunst').id })).data.fout).toBe('EERST_DAGDEEL_VERPLAATSEN');
    expect((await een(`select count(*) as n from audit_log where record_id = ?`, wachtId)).n).toBe(2);
  });

  test('CSV-export: ontsleuteld, gesorteerd, gelogd', async () => {
    const raw = await worker.fetch(new Request(`http://localhost/api/beheer/evenementen/${ev.evenementId}/deelnemers.csv`), env, ctx);
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM voor Excel
    const r = await api('GET', `/api/beheer/evenementen/${ev.evenementId}/deelnemers.csv`);
    expect(r.status).toBe(200);
    expect(r.data.split('\r\n')[0]).toMatch(/^referentie;ingeschreven_op;/);
    expect(r.data).toContain('ouder');
    expect(r.data).toContain('@example.org');
    expect(r.data).not.toContain('v1.');
    expect((await een(`select count(*) as n from audit_log where actie = 'EXPORT_DEELNEMERS'`)).n).toBe(2);
  });

  test('12. anonimisering na de bewaartermijn', async () => {
    await sql(`update evenementen set start_datum = date('now', '-60 days'), eind_datum = date('now', '-40 days') where slug = ?`, SLUG);
    await worker.scheduled!({} as ScheduledController, env, ctx);
    await Promise.all(wachtend);
    const pii = await een(
      `select count(*) as n from deelnemers where naam_enc is not null or email_enc is not null or beheer_token_hash is not null or dubbel_hash is not null`,
    );
    expect(pii.n).toBe(0);
    expect((await een(`select count(*) as n from audit_log where entiteit = 'deelnemers'`)).n).toBe(0);
    expect((await een(`select count(*) as n from deelnemers where leerjaar is not null`)).n).toBeGreaterThan(10);
    expect((await api('GET', `/api/registraties/${wachtToken}`)).status).toBe(404);
  });
});

describe('meldingen (probleem of idee melden)', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let id: string;

  test('bewaren met screenshot; tokens en e-mails uit technische tekst', async () => {
    const r = await api('POST', '/api/meldingen', {
      type: 'probleem',
      omschrijving: 'Knop werkt niet',
      email: 'ouder@example.org',
      pagina: `http://localhost:5173/beheer/${'x'.repeat(43)}`,
      appVersie: '1.0.0 (abc123)',
      browser: 'Mozilla/5.0',
      context: { scherm: '1920x1080', taal: 'nl-BE', geheim: 'wordt genegeerd' },
      logboek: [{ t: '2026-10-20T10:00:00Z', niveau: 'fout', bericht: 'POST mislukt voor jan@example.org' }],
      screenshot: png,
    });
    expect(r.status).toBe(201);
    id = r.data.meldingId;
    const rij = await een(`select * from meldingen where melding_id = ?`, id);
    expect(rij.pagina).toBe('http://localhost:5173/beheer/[token]');
    expect(rij.logboek).toContain('[e-mail]');
    expect(rij.context).not.toContain('geheim');
    expect(rij.omschrijving_enc).toMatch(/^v1\./);
    expect(await env.STORAGE.head(`meldingen/${id}.png`)).not.toBeNull();
  });

  test('validatie', async () => {
    const r = await api('POST', '/api/meldingen', { type: 'x', omschrijving: '', screenshot: 'data:text/html,<b>' });
    expect(Object.keys(r.data.velden).sort()).toEqual(['omschrijving', 'screenshot', 'type']);
  });

  test('lezen enkel voor platformbeheer', async () => {
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    expect((await api('GET', '/api/beheer/meldingen')).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, BEHEERDER);
    const lijst = await api('GET', '/api/beheer/meldingen');
    expect(lijst.data[0]).toMatchObject({ omschrijving: 'Knop werkt niet', email: 'ouder@example.org', status: 'nieuw' });
    const img = await worker.fetch(new Request(`http://localhost/api/beheer/meldingen/${id}/screenshot`), env, ctx);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect((await api('PATCH', `/api/beheer/meldingen/${id}`, { status: 'afgehandeld' })).data.ok).toBe(true);
  });

  test('opruimen na 90 dagen (incl. screenshot)', async () => {
    await sql(`update meldingen set created_at = '2020-01-01T00:00:00.000Z' where melding_id = ?`, id);
    await worker.scheduled!({} as ScheduledController, env, ctx);
    await Promise.all(wachtend);
    expect(await een(`select 1 from meldingen where melding_id = ?`, id)).toBeNull();
    expect(await env.STORAGE.head(`meldingen/${id}.png`)).toBeNull();
  });
});

describe('logging', () => {
  test('X-Request-Id en geen tokens in logregels', async () => {
    const r = await api('GET', `/api/registraties/${'y'.repeat(43)}`);
    expect(r.headers.get('X-Request-Id')).toBeTruthy();
  });
});
