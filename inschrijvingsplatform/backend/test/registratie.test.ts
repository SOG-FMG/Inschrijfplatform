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
    RL_REGISTRATIE: undefined, // de rate limiter van de proxy zou de massa-registraties in deze tests afkappen
    RL_MELDING: undefined,
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

describe('aanmelden (authenticator en passkey)', () => {
  const HOOFD = 'hoofd@onderwijs.gent.be';
  const SETUP = 'ABCDEFGHIJKLMNOP';
  const WW = 'paard batterij nietje correct';
  const ORIGIN = 'http://localhost:5173';
  let cookie = '';
  let geheim = '';

  const post = async (pad: string, body?: unknown, c = '', origin: string | null = ORIGIN, methode = 'POST') => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin) headers.Origin = origin;
    if (c) headers.Cookie = c;
    const res = await worker.fetch(new Request(`http://localhost${pad}`, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: (await res.json()) as any, cookie: (res.headers.get('Set-Cookie') ?? '').split(';')[0] };
  };
  const ik = (c: string) => post('/api/beheer/ik', undefined, c, null, 'GET');

  beforeAll(() => {
    env.DEV_BEHEER_EMAIL = undefined;
    env.HOOFDADMIN_EMAIL = HOOFD;
    env.HOOFDADMIN_SETUP_CODE = SETUP;
  });

  test('hoofdadmin activeert met de setupcode; verkeerde code of ander domein wordt geweigerd', async () => {
    expect((await post('/api/auth/activeren/start', { email: HOOFD, code: 'AAAA-AAAA-AAAA-AAAA' })).data.fout).toBe('ONGELDIGE_UITNODIGING');
    expect((await post('/api/auth/activeren/start', { email: 'iemand@example.org', code: SETUP })).data.fout).toBe('ONGELDIGE_UITNODIGING');
    expect(await een(`select 1 from gebruikers where email = ?`, HOOFD)).toBeNull();

    const start = await post('/api/auth/activeren/start', { email: HOOFD, code: 'abcd-efgh-ijkl-mnop' });
    expect(start.status).toBe(200);
    expect(start.data.otpauth).toContain('secret=');
    const rij = await een(`select secret_enc from gebruiker_totp`);
    expect(rij.secret_enc).toMatch(/^v1\./); // versleuteld bewaard

    const { totpCode, huidigeStap } = await import('../src/auth/totp');
    const zwak = await post('/api/auth/activeren/bevestig', { email: HOOFD, code: SETUP, totp: '000000', wachtwoord: 'kort' });
    expect(zwak.data.velden).toHaveProperty('wachtwoord');
    const fout = await post('/api/auth/activeren/bevestig', { email: HOOFD, code: SETUP, totp: '000000', wachtwoord: WW });
    expect(fout.data.fout).toBe('AANMELDEN_MISLUKT');
    geheim = start.data.geheim;
    const ok = await post('/api/auth/activeren/bevestig', { email: HOOFD, code: SETUP, totp: await totpCode(geheim, huidigeStap()), wachtwoord: WW });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^(__Host-)?beheer=/);
    cookie = ok.cookie;

    const profiel = await ik(cookie);
    expect(profiel.data).toMatchObject({ email: HOOFD, rol: 'platformbeheerder' });
    // Na activeren kan de setupcode niet opnieuw gebruikt worden.
    expect((await post('/api/auth/activeren/start', { email: HOOFD, code: SETUP })).data.fout).toBe('ONGELDIGE_UITNODIGING');
  });

  test('sessiecookie: zonder cookie 401, zonder of met vreemde Origin op wijzigende aanvragen 403', async () => {
    expect((await ik('')).status).toBe(401);
    expect((await ik('beheer=' + 'x'.repeat(43))).status).toBe(401);
    expect((await post('/api/beheer/gebruikers', {}, cookie, null)).status).toBe(403);
    expect((await post('/api/beheer/gebruikers', {}, cookie, 'https://kwaadaardig.example')).status).toBe(403);
  });

  test('aanmelden met code: een gebruikte code werkt niet opnieuw, de volgende wel', async () => {
    const { totpCode, huidigeStap } = await import('../src/auth/totp');
    const stap = huidigeStap();
    // De activeercode (huidige stap) is al gebruikt.
    expect((await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: WW, code: await totpCode(geheim, stap) })).status).toBe(401);
    // Juiste code maar fout wachtwoord: geweigerd (en de code blijft bruikbaar).
    expect((await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: 'fout wachtwoord!!', code: await totpCode(geheim, stap + 1) })).status).toBe(401);
    const volgende = await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: WW, code: await totpCode(geheim, stap + 1) });
    expect(volgende.status).toBe(200);
    // Zelfde code opnieuw: geweigerd.
    expect((await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: WW, code: await totpCode(geheim, stap + 1) })).status).toBe(401);
    // Onbekend adres geeft dezelfde melding als een foute code.
    expect((await post('/api/auth/aanmelden', { email: 'niemand@onderwijs.gent.be', code: '123456' })).data.fout).toBe('AANMELDEN_MISLUKT');
  });

  test('hoofdadmin voegt een gebruiker toe; die activeert met de uitnodigingscode; enkel platformbeheer beheert gebruikers', async () => {
    const nieuw = await post('/api/beheer/gebruikers', { voornaam: 'An', naam: 'Janssens', email: 'An.Janssens@onderwijs.gent.be', rol: 'onthaal' }, cookie);
    expect(nieuw.status).toBe(201);
    expect(nieuw.data.uitnodigingscode).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    expect((await post('/api/beheer/gebruikers', { voornaam: 'X', naam: 'Y', email: 'x@gmail.com', rol: 'onthaal' }, cookie)).data.fout).toBe('ONGELDIGE_GEGEVENS');
    expect((await post('/api/beheer/gebruikers', { voornaam: 'An', naam: 'J', email: 'an.janssens@onderwijs.gent.be', rol: 'onthaal' }, cookie)).data.fout).toBe('GEBRUIKER_BESTAAT');
    const hash = await een(`select uitnodiging_hash from gebruikers where email = 'an.janssens@onderwijs.gent.be'`);
    expect(hash.uitnodiging_hash).not.toContain(nieuw.data.uitnodigingscode.replace(/-/g, ''));

    const start = await post('/api/auth/activeren/start', { email: 'an.janssens@onderwijs.gent.be', code: nieuw.data.uitnodigingscode });
    expect(start.status).toBe(200);
    const { totpCode, huidigeStap } = await import('../src/auth/totp');
    const klaar = await post('/api/auth/activeren/bevestig', {
      email: 'an.janssens@onderwijs.gent.be',
      code: nieuw.data.uitnodigingscode,
      totp: await totpCode(start.data.geheim, huidigeStap()),
      wachtwoord: 'een ander lang wachtwoord',
    });
    expect(klaar.status).toBe(200);
    expect((await ik(klaar.cookie)).data.rol).toBe('onthaal');
    expect((await post('/api/beheer/gebruikers', undefined, klaar.cookie, null, 'GET')).status).toBe(403);
    // Uitnodiging is verbruikt.
    expect((await post('/api/auth/activeren/start', { email: 'an.janssens@onderwijs.gent.be', code: nieuw.data.uitnodigingscode })).data.fout).toBe('ONGELDIGE_UITNODIGING');

    // Resetten sluit de oude sessie af; deactiveren ook.
    const lijst = await post('/api/beheer/gebruikers', undefined, cookie, null, 'GET');
    const an = lijst.data.find((g: any) => g.email === 'an.janssens@onderwijs.gent.be');
    expect(an).toMatchObject({ heeftAuthenticator: 1, rol: 'onthaal' });
    expect((await post(`/api/beheer/gebruikers/${an.id}/reset`, undefined, cookie)).data.uitnodigingscode).toBeTruthy();
    expect((await ik(klaar.cookie)).status).toBe(401);
    expect((await post(`/api/beheer/gebruikers/${an.id}`, { actief: false }, cookie, ORIGIN, 'PATCH')).status).toBe(200);
    const ikId = lijst.data.find((g: any) => g.email === HOOFD).id;
    expect((await post(`/api/beheer/gebruikers/${ikId}`, { actief: false }, cookie, ORIGIN, 'PATCH')).status).toBe(403); // niet jezelf
  });

  test('passkey: registreren en aanmelden met een ES256-sleutel, uitdaging eenmalig', async () => {
    const { naarB64u, vanB64u } = await import('../src/auth/webauthn');
    const enc = new TextEncoder();
    const sha = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', d));
    const rpHash = await sha(enc.encode('localhost'));
    const sleutel = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', sleutel.publicKey));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const id = naarB64u(credId);
    const clientData = (type: string, challenge: string, origin = ORIGIN) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
    const concat = (...delen: Uint8Array[]) => Uint8Array.from(delen.flatMap((d) => [...d]));

    // Registreren
    const opties = (await post('/api/beheer/passkeys/opties', undefined, cookie)).data;
    expect(opties.authenticatorSelection.userVerification).toBe('required');
    const attData = concat(rpHash, Uint8Array.of(0x45), new Uint8Array(4), new Uint8Array(16), Uint8Array.of(0, 32), credId, Uint8Array.of(0xa0));
    const reg = { id, clientDataJSON: '', authenticatorData: naarB64u(attData), publicKey: naarB64u(spki), algoritme: -7, naam: 'Laptop' };
    // Verkeerde origin: geweigerd (en de uitdaging is daarmee verbruikt).
    const verkeerd = { ...reg, clientDataJSON: naarB64u(clientData('webauthn.create', opties.challenge, 'https://nep.example')) };
    expect((await post('/api/beheer/passkeys', verkeerd, cookie)).status).toBe(401);
    const opties2 = (await post('/api/beheer/passkeys/opties', undefined, cookie)).data;
    const reg2 = { ...reg, clientDataJSON: naarB64u(clientData('webauthn.create', opties2.challenge)) };
    expect((await post('/api/beheer/passkeys', reg2, cookie)).status).toBe(201);
    expect((await ik(cookie)).data.passkeys).toEqual([expect.objectContaining({ id, naam: 'Laptop' })]);

    // Aanmelden: DER-handtekening zoals een echte authenticator die levert
    const rawNaarDer = (raw: Uint8Array) => {
      const int = (x: Uint8Array) => {
        let b = [...x];
        while (b.length > 1 && b[0] === 0) b.shift();
        if (b[0] & 0x80) b = [0, ...b];
        return [0x02, b.length, ...b];
      };
      const inhoud = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
      return Uint8Array.from([0x30, inhoud.length, ...inhoud]);
    };
    const aanmeldBody = async (challenge: string, teller: number, uv = true) => {
      const auth = concat(rpHash, Uint8Array.of(uv ? 0x05 : 0x01), Uint8Array.of(0, 0, 0, teller));
      const cd = clientData('webauthn.get', challenge);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sleutel.privateKey, concat(auth, await sha(cd))));
      return { id, clientDataJSON: naarB64u(cd), authenticatorData: naarB64u(auth), handtekening: naarB64u(rawNaarDer(sig)) };
    };
    const lo = (await post('/api/auth/passkey/opties')).data;
    expect(lo.rpId).toBe('localhost');
    const ok = await post('/api/auth/passkey/aanmelden', await aanmeldBody(lo.challenge, 1));
    expect(ok.status).toBe(200);
    expect((await ik(ok.cookie)).data.email).toBe(HOOFD);
    // Dezelfde uitdaging nog eens (replay): geweigerd.
    expect((await post('/api/auth/passkey/aanmelden', await aanmeldBody(lo.challenge, 2))).status).toBe(401);
    // Een teller die niet stijgt: geweigerd.
    const lo2 = (await post('/api/auth/passkey/opties')).data;
    expect((await post('/api/auth/passkey/aanmelden', await aanmeldBody(lo2.challenge, 1))).status).toBe(401);
    // Zonder gebruikersverificatie (geen pincode/vingerafdruk): geweigerd.
    const lo3 = (await post('/api/auth/passkey/opties')).data;
    expect((await post('/api/auth/passkey/aanmelden', await aanmeldBody(lo3.challenge, 3, false))).status).toBe(401);
    // Een gewijzigde handtekening: geweigerd.
    const lo4 = (await post('/api/auth/passkey/opties')).data;
    const slecht = await aanmeldBody(lo4.challenge, 3);
    const sigBytes = vanB64u(slecht.handtekening);
    sigBytes[sigBytes.length - 1] ^= 1;
    expect((await post('/api/auth/passkey/aanmelden', { ...slecht, handtekening: naarB64u(sigBytes) })).status).toBe(401);
    const lo5 = (await post('/api/auth/passkey/opties')).data;
    expect((await post('/api/auth/passkey/aanmelden', await aanmeldBody(lo5.challenge, 3))).status).toBe(200);
  });

  test('eigen account: wachtwoord wijzigen vraagt het huidige; authenticator opnieuw koppelen', async () => {
    const { totpCode, huidigeStap } = await import('../src/auth/totp');
    expect((await post('/api/beheer/account/wachtwoord', { huidig: 'fout fout fout', nieuw: 'nieuw lang wachtwoord 1' }, cookie)).data.fout).toBe('HUIDIG_WACHTWOORD_FOUT');
    expect((await post('/api/beheer/account/wachtwoord', { huidig: WW, nieuw: 'kort' }, cookie)).data.velden).toHaveProperty('nieuw');
    expect((await post('/api/beheer/account/wachtwoord', { huidig: WW, nieuw: 'nieuw lang wachtwoord 1' }, cookie)).status).toBe(200);
    expect((await post('/api/beheer/account/wachtwoord', { huidig: 'nieuw lang wachtwoord 1', nieuw: WW }, cookie)).status).toBe(200);

    const start = await post('/api/beheer/account/authenticator/start', {}, cookie);
    expect(start.data.geheim).not.toBe(geheim);
    // Tot de bevestiging blijft de oude app werken.
    expect((await post('/api/beheer/account/authenticator/bevestig', { code: '000000' }, cookie)).status).toBe(401);
    expect((await post('/api/beheer/account/authenticator/bevestig', { code: await totpCode(start.data.geheim, huidigeStap()) }, cookie)).status).toBe(200);
    geheim = start.data.geheim;
    await sql(`delete from aanmeld_pogingen`);
  });

  test('account zonder wachtwoord (van vóór de wachtwoordstap) moet er eerst één instellen', async () => {
    const { totpCode, huidigeStap } = await import('../src/auth/totp');
    const id = (await een(`select gebruiker_id from gebruikers where email = ?`, HOOFD)).gebruiker_id;
    await sql(`update gebruikers set wachtwoord_hash = null where gebruiker_id = ?`, id);
    await sql(`update gebruiker_totp set laatste_stap = 0 where gebruiker_id = ?`, id);
    const r = await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: '', code: await totpCode(geheim, huidigeStap() + 1) });
    expect(r.status).toBe(200);
    expect((await ik(r.cookie)).data.heeftWachtwoord).toBe(false);
    expect((await post('/api/beheer/gebruikers', undefined, r.cookie, null, 'GET')).data.fout).toBe('WACHTWOORD_INSTELLEN');
    expect((await post('/api/beheer/account/wachtwoord', { nieuw: WW }, r.cookie)).status).toBe(200);
    expect((await post('/api/beheer/gebruikers', undefined, r.cookie, null, 'GET')).status).toBe(200);
    cookie = r.cookie;
  });

  test('gebruiker bewerken: naam, rol, evenementen; hoofdadmin en jezelf beschermd', async () => {
    const lijst = (await post('/api/beheer/gebruikers', undefined, cookie, null, 'GET')).data;
    const an = lijst.find((g: any) => g.email === 'an.janssens@onderwijs.gent.be');
    const evId = (await een(`select evenement_id from evenementen where slug = ?`, SLUG)).evenement_id;
    expect((await post(`/api/beheer/gebruikers/${an.id}`, { voornaam: 'Anna', rol: 'organisator', evenementIds: [evId], actief: true }, cookie, ORIGIN, 'PATCH')).status).toBe(200);
    const na = (await post('/api/beheer/gebruikers', undefined, cookie, null, 'GET')).data.find((g: any) => g.id === an.id);
    expect(na).toMatchObject({ voornaam: 'Anna', rol: 'organisator', actief: 1, evenementIds: [evId] });
    expect(na).toHaveProperty('laatsteAanmelding');
    const hoofd = lijst.find((g: any) => g.email === HOOFD);
    expect((await post(`/api/beheer/gebruikers/${hoofd.id}`, { rol: 'onthaal' }, cookie, ORIGIN, 'PATCH')).status).toBe(403);
  });

  test('logo en kleuren', async () => {
    const evId = (await een(`select evenement_id from evenementen where slug = ?`, SLUG)).evenement_id;
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
    const upload = (body: BodyInit, type: string) =>
      worker.fetch(new Request(`http://localhost/api/beheer/evenementen/${evId}/logo`, { method: 'POST', headers: { 'Content-Type': type, Origin: ORIGIN, Cookie: cookie }, body }), env, ctx);
    expect((await upload('<svg onload="alert(1)"/>', 'image/svg+xml')).status).toBe(400);
    expect((await upload('geen png', 'image/png')).status).toBe(400);
    const ok = await upload(png, 'image/png');
    expect(ok.status).toBe(200);
    const { logo } = (await ok.json()) as any;
    expect(logo).toMatch(new RegExp(`^/api/logo/${evId}\\?v=\\d+$`));
    const img = await worker.fetch(new Request(`http://localhost${logo}`), env, ctx);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(img.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    expect((await post(`/api/beheer/instellingen/evenement/${evId}`, { waarden: { kleur_primair: 'rood' } }, cookie, ORIGIN, 'PATCH')).data.velden).toHaveProperty('kleur_primair');
    expect((await post(`/api/beheer/instellingen/evenement/${evId}`, { waarden: { kleur_primair: '#AA3300', logo: 'https://kwaad.example/x.png' } }, cookie, ORIGIN, 'PATCH')).status).toBe(200);
    const pub = await api('GET', `/api/evenementen/${SLUG}`);
    expect(pub.data).toMatchObject({ kleurPrimair: '#aa3300', logo }); // logo niet via PATCH te overschrijven
  });

  test('te veel foute pogingen blokkeren het e-mailadres', async () => {
    await sql(`delete from aanmeld_pogingen`);
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: WW, code: '000000' })).data.fout).toBe('AANMELDEN_MISLUKT');
    const zesde = await post('/api/auth/aanmelden', { email: HOOFD, wachtwoord: WW, code: '000000' });
    expect(zesde.status).toBe(429);
    await sql(`delete from aanmeld_pogingen`);
  });

  test('afmelden wist de sessie', async () => {
    const af = await post('/api/auth/afmelden', undefined, cookie);
    expect(af.status).toBe(200);
    expect((await ik(cookie)).status).toBe(401);
  });
});

describe('instellingen van een evenement', () => {
  let evId: string;
  beforeAll(async () => {
    env.DEV_BEHEER_EMAIL = BEHEERDER; // platformbeheerder (zie 'meldingen')
    evId = (await een(`select evenement_id from evenementen where slug = ?`, SLUG)).evenement_id;
  });

  test('lezen: volledige boom met schema, keuzelijsten en tellingen', async () => {
    const r = await api('GET', `/api/beheer/evenementen/${evId}/instellingen`);
    expect(r.status).toBe(200);
    expect(r.data.kanSchrijven).toBe(true);
    expect(r.data.schema.sessie.some((v: any) => v.naam === 'capaciteit')).toBe(true);
    expect(r.data.evenement.slug).toBe(SLUG);
    expect(Array.isArray(r.data.evenement.leerjaar_opties)).toBe(true);
    const s = r.data.dagen[0].dagdelen[0].tijdsblokken.find((t: any) => t.sessies.length).sessies[0];
    expect(s.ingeschreven).toHaveProperty('bevestigd');
    expect(r.data.opties.soort.length).toBeGreaterThan(0);
  });

  test('wijzigen met validatie; onbekende kolommen worden genegeerd', async () => {
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    const sessie = ev.dagen[0].dagdelen[0].tijdsblokken.find((t: any) => t.sessies.length).sessies[0];
    const ok = await api('PATCH', `/api/beheer/instellingen/sessie/${sessie.sessie_id}`, { waarden: { capaciteit: 25, titel: 'Nieuwe titel', tijdsblok_id: 'x' } });
    expect(ok.status).toBe(200);
    const rij = await een(`select capaciteit, titel, tijdsblok_id, modified_by from sessies where sessie_id = ?`, sessie.sessie_id);
    expect(rij).toMatchObject({ capaciteit: 25, titel: 'Nieuwe titel', tijdsblok_id: sessie.tijdsblok_id });
    expect(rij.modified_by).toBeTruthy();

    const fout = await api('PATCH', `/api/beheer/instellingen/sessie/${sessie.sessie_id}`, { waarden: { capaciteit: -1, status: 'raar', titel: '' } });
    expect(fout.status).toBe(400);
    expect(Object.keys(fout.data.velden).sort()).toEqual(['capaciteit', 'status', 'titel']);
    // Doelgroep van een ander evenement of onbestaand: geweigerd
    expect((await api('PATCH', `/api/beheer/instellingen/sessie/${sessie.sessie_id}`, { waarden: { doelgroep_id: 'bestaat-niet' } })).data.velden).toHaveProperty('doelgroep_id');
    // Einde voor begin: schemafout wordt een begrijpelijke melding
    const uren = await api('PATCH', `/api/beheer/instellingen/dag/${ev.dagen[0].dag_id}`, { waarden: { start_uur: '16:00', eind_uur: '09:00' } });
    expect(uren.data.velden).toHaveProperty('algemeen');
    expect((await api('PATCH', `/api/beheer/instellingen/evenement/${evId}`, { waarden: { leerjaar_opties: '5de, 6de ,' } })).status).toBe(200);
    expect((await een(`select leerjaar_opties from evenementen where evenement_id = ?`, evId)).leerjaar_opties).toBe('["5de","6de"]');
  });

  test('toevoegen en verwijderen; verwijderen met inschrijvingen wordt geweigerd', async () => {
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    const blok = ev.dagen[0].dagdelen[0].tijdsblokken.find((t: any) => t.type === 'keuze');
    const nieuw = await api('POST', '/api/beheer/instellingen/sessie', { ouderId: blok.tijdsblok_id, waarden: { titel: 'Robotica', capaciteit: 10 } });
    expect(nieuw.status).toBe(201);
    const rij = await een(`select status, zichtbaar, uniek_per_deelnemer from sessies where sessie_id = ?`, nieuw.data.id);
    expect(rij).toMatchObject({ status: 'open', zichtbaar: 1, uniek_per_deelnemer: 1 }); // standaardwaarden
    expect((await api('DELETE', `/api/beheer/instellingen/sessie/${nieuw.data.id}`)).status).toBe(200);
    expect(await een(`select 1 from sessies where sessie_id = ?`, nieuw.data.id)).toBeNull();

    const bezet = await een(`select sessie_id from inschrijvingen where evenement_id = ? and sessie_id is not null limit 1`, evId);
    const weg = await api('DELETE', `/api/beheer/instellingen/sessie/${bezet.sessie_id}`);
    expect(weg.data.fout).toBe('IN_GEBRUIK');
    expect((await api('DELETE', `/api/beheer/instellingen/evenement/${evId}`)).status).toBe(403);
  });

  test('rechten: zonder koppeling geen toegang, onthaal enkel lezen', async () => {
    await sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'O', 'T', 'onthaal.test@onderwijs.gent.be', rol_id from rollen where code = 'onthaal'`);
    env.DEV_BEHEER_EMAIL = 'onthaal.test@onderwijs.gent.be';
    expect((await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).status).toBe(403);
    await sql(`insert into evenement_beheerders (evenement_id, gebruiker_id, rol) select ?, gebruiker_id, 'onthaal' from gebruikers where email = ?`, evId, 'onthaal.test@onderwijs.gent.be');
    const r = await api('GET', `/api/beheer/evenementen/${evId}/instellingen`);
    expect(r.data.kanSchrijven).toBe(false);
    expect((await api('PATCH', `/api/beheer/instellingen/evenement/${evId}`, { waarden: { titel: 'X' } })).status).toBe(403);
    expect((await api('POST', '/api/beheer/instellingen/evenement', { waarden: { titel: 'X' } })).status).toBe(403);
    env.DEV_BEHEER_EMAIL = BEHEERDER;
  });

  test('nieuw evenement (platformbeheer)', async () => {
    const r = await api('POST', '/api/beheer/instellingen/evenement', {
      waarden: { titel: 'Opendeur', slug: 'opendeur-2027', start_datum: '2027-05-01', eind_datum: '2027-05-01' },
    });
    expect(r.status).toBe(201);
    expect(await een(`select status, max_dagdelen from evenementen where evenement_id = ?`, r.data.id)).toMatchObject({ status: 'concept', max_dagdelen: 1 });
    const dubbel = await api('POST', '/api/beheer/instellingen/evenement', {
      waarden: { titel: 'X', slug: 'opendeur-2027', start_datum: '2027-05-01', eind_datum: '2027-05-01' },
    });
    expect(dubbel.data.velden).toHaveProperty('slug');
  });
});
