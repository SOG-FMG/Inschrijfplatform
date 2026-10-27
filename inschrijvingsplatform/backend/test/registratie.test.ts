// Integratietest: migraties + seed in een lokale D1 (Miniflare, echte SQLite) en
// alle aanvragen via de volledige Worker (validatie, routes, foutvertaling).
// Uitvoeren:  cd backend && npm test
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ fout: 'DUBBELE_INSCHRIJVING', omgewisseld: false, mailVerstuurd: true });
  });

  test('2b. omgewisselde voor- en achternaam telt ook als dubbel; de bevestiging gaat opnieuw met een nieuwe link', async () => {
    const d = deelnemer({ naam: 'Janssens', voornaam: 'Marie' });
    const eerste = await registreer(d, [vm1.id], []);
    expect(eerste.status).toBe(201);
    const oudeLink = token(eerste);
    expect((await api('GET', `/api/registraties/${oudeLink}`)).status).toBe(200);

    const r = await registreer({ ...d, naam: 'Marie', voornaam: 'Janssens' }, [vm1.id], []);
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ fout: 'DUBBELE_INSCHRIJVING', omgewisseld: true, mailVerstuurd: true });

    // De bevestiging bevat een nieuwe persoonlijke link, dus de oude werkt niet meer.
    expect((await api('GET', `/api/registraties/${oudeLink}`)).status).toBe(404);
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

describe('keuzes wijzigen via de persoonlijke link', () => {
  let t: string;
  const wijzig = (sessies: string[]) => api('PATCH', `/api/registraties/${t}`, { sessies });
  const bevestigd = async (id: string) => (await een(`select bevestigd from v_sessie_bezetting where sessie_id = ?`, id)).bevestigd as number;

  test('overzicht toont de huidige keuzes en wat er te kiezen valt', async () => {
    const r = await registreer(deelnemer({ naam: 'Wissel', voornaam: 'Wout' }), [vm1.id], [sessie(k1, 'kunst').id, sessie(k2, 'wiskunde').id]);
    t = token(r);
    const o = (await api('GET', `/api/registraties/${t}`)).data;
    expect(o.wijzigen.keuzes).toEqual({ [k1.id]: sessie(k1, 'kunst').id, [k2.id]: sessie(k2, 'wiskunde').id });
    expect(o.wijzigen.dagen).toHaveLength(1);
    expect(o.wijzigen.dagen[0].dagdeel.id).toBe(vm1.id);
  });

  test('ander lesje kiezen: oude plaats komt vrij, nieuwe wordt bezet, ongewijzigd blok blijft', async () => {
    const [kunst, wet, wis] = [sessie(k1, 'kunst').id, sessie(k1, 'wetenschappen').id, sessie(k2, 'wiskunde').id];
    const voor = { kunst: await bevestigd(kunst), wet: await bevestigd(wet), wis: await bevestigd(wis) };
    const r = await wijzig([wet, wis]);
    expect(r.status).toBe(200);
    expect(r.data.keuzes.map((k: any) => k.titel)).toEqual(['Domein Wetenschappen', 'Lesje Wiskunde']);
    expect(await bevestigd(kunst)).toBe(voor.kunst - 1);
    expect(await bevestigd(wet)).toBe(voor.wet + 1);
    expect(await bevestigd(wis)).toBe(voor.wis);
  });

  test('zelfde regels als bij inschrijven: dubbel, volzet, ander dagdeel', async () => {
    expect((await wijzig([sessie(k1, 'kunst').id, sessie(k2, 'kunst').id])).data.fout).toBe('ZELFDE_ONDERDEEL_DUBBEL');
    const vol = await wijzig([sessie(k1, 'latijn').id, sessie(k2, 'wiskunde').id]);
    expect(vol.data).toMatchObject({ fout: 'SESSIE_VOLZET', id: sessie(k1, 'latijn').id });
    expect((await wijzig([nm1.tijdsblokken[1].sessies[0].id])).data.fout).toBe('ONGELDIGE_SESSIEKEUZE');
    // Niets veranderd na een geweigerde wijziging
    const o = (await api('GET', `/api/registraties/${t}`)).data;
    expect(o.keuzes.map((k: any) => k.titel)).toEqual(['Domein Wetenschappen', 'Lesje Wiskunde']);
  });

  test('geen lesje meer en na annuleren niet meer wijzigbaar', async () => {
    expect((await wijzig([])).data.keuzes).toEqual([]);
    await api('DELETE', `/api/registraties/${t}`);
    expect((await api('GET', `/api/registraties/${t}`)).data.wijzigen).toBeNull();
    expect((await wijzig([sessie(k1, 'kunst').id])).data.fout).toBe('REGISTRATIE_NIET_GEVONDEN');
  });

  test('na de inschrijfperiode niet meer wijzigbaar', async () => {
    const r = await registreer(deelnemer(), [vm1.id], [sessie(k1, 'kunst').id]);
    await sql(`update evenementen set inschrijving_tot = ? where slug = ?`, new Date(Date.now() - 1000).toISOString(), SLUG);
    expect((await api('GET', `/api/registraties/${token(r)}`)).data.wijzigen).toBeNull();
    expect((await api('PATCH', `/api/registraties/${token(r)}`, { sessies: [] })).data.fout).toBe('NIET_MEER_WIJZIGBAAR');
    await sql(`update evenementen set inschrijving_tot = null where slug = ?`, SLUG);
  });
});

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
    // Ander domein dan AANMELD_DOMEINEN: geweigerd, ook als de rij in gebruikers bestaat (als platformbeheerder)
    for (const extern of ['iemand@gmail.com', 'a@evilonderwijs.gent.be']) {
      await sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'X', 'Y', ?, rol_id from rollen where code = 'platformbeheerder'`, extern);
      env.DEV_BEHEER_EMAIL = extern;
      expect((await api('GET', `/api/beheer/evenementen/${ev.evenementId}/deelnemers.csv`)).status).toBe(403);
      await sql(`delete from gebruikers where email = ?`, extern);
    }
    await expect(sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'X', 'Y', 'a@b@c.be', rol_id from rollen limit 1`)).rejects.toThrow(/CHECK/);
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

  test('rapporten: lesjes met aantallen en namen (ontsleuteld), gelogd', async () => {
    const r = await api('GET', `/api/beheer/evenementen/${ev.evenementId}/rapport`);
    expect(r.status).toBe(200);
    expect(r.data.kanSchrijven).toBe(true);
    const dd = r.data.dagen[0].dagdelen.find((d: any) => d.id === vm1.id);
    expect(dd.tijdsblokken.map((t: any) => t.naam)).toEqual(['Keuzelesje 1', 'Keuzelesje 2']); // enkel keuzeblokken
    const ned = dd.tijdsblokken[0].sessies.find((s: any) => s.titel.startsWith('Nederlands'));
    expect(ned.bevestigd).toBe((await een(`select bevestigd from v_sessie_bezetting where sessie_id = ?`, ned.id)).bevestigd);
    expect(ned.deelnemers).toHaveLength(ned.bevestigd + ned.wachtlijst);
    expect(ned.deelnemers[0]).toMatchObject({ naam: 'Test', leerjaar: '6de leerjaar', status: 'bevestigd' });
    expect(JSON.stringify(r.data)).not.toContain('v1.');
    expect((await een(`select count(*) as n from audit_log where actie = 'RAPPORT'`)).n).toBe(1);
  });

  test('rapportteksten aanpassen en terugzetten', async () => {
    const pad = `/api/beheer/evenementen/${ev.evenementId}/rapport/teksten`;
    expect((await api('PATCH', pad, { teksten: { 'r1.titel': '  Overzicht   DAG 1 ' } })).data.teksten).toEqual({ 'r1.titel': 'Overzicht DAG 1' });
    expect((await api('PATCH', pad, { teksten: { 'r1.titel': '' } })).data.teksten).toEqual({});
    expect((await api('PATCH', pad, { teksten: { '<script>': 'x' } })).status).toBe(400);
  });

  test('etiketten: deelnemers met lesjes, opmaak bewaren, verdieping per lokaal', async () => {
    const pad = `/api/beheer/evenementen/${ev.evenementId}/etiketten`;
    const r = await api('GET', pad);
    expect(r.status).toBe(200);
    expect(r.data.instellingen).toBeNull(); // standaard
    const d = r.data.deelnemers.find((x: any) => x.naam === 'Test' && x.lesjes.length);
    expect(d.lesjes.length).toBeGreaterThan(0);
    expect(d.lesjes[0]).toHaveProperty('titel');
    expect(JSON.stringify(r.data)).not.toContain('v1.');
    // QR-code voor de check-in op het etiket: ook voor inschrijvingen van vóór de QR-code
    expect(d.checkin).toMatch(/^http:\/\/localhost:5173\/checkin\/[A-Za-z0-9_-]{43}\?v=\d+$/);
    expect(await een(`select count(*) as n from deelnemers where evenement_id = ? and status = 'actief' and checkin_token is null
                      and deelnemer_id in (select deelnemer_id from inschrijvingen where status = 'bevestigd')`, ev.evenementId)).toEqual({ n: 0 });

    const opmaak = {
      blad: { breedte: 210, hoogte: 297 }, kolommen: 3, rijen: 8, marge: { boven: 0, onder: 0, links: 0, rechts: 0 },
      tussen: { horizontaal: 0, verticaal: 0 }, binnen: 3, regels: [{ tekst: '{voornaam} {achternaam}', pt: 20, vet: false, passend: true, perLesje: false }],
      qr: { mm: 14 },
    };
    expect((await api('PATCH', `${pad}/instellingen`, { instellingen: opmaak })).data.instellingen).toEqual(opmaak);
    expect((await api('PATCH', `${pad}/instellingen`, { instellingen: { ...opmaak, kolommen: 0 } })).status).toBe(400);
    expect((await api('PATCH', `${pad}/instellingen`, { instellingen: { ...opmaak, marge: { ...opmaak.marge, links: 100, rechts: 100 } } })).status).toBe(400);
    expect((await api('GET', pad)).data.instellingen).toEqual(opmaak);
    expect((await api('PATCH', `${pad}/instellingen`, { instellingen: null })).data.instellingen).toBeNull();

    const lokaal = r.data.lokalen[0];
    expect((await api('PATCH', `${pad}/lokalen/${lokaal.id}`, { verdieping: '  verdieping 1 ' })).data.verdieping).toBe('verdieping 1');
    expect((await api('GET', pad)).data.lokalen.find((l: any) => l.id === lokaal.id).verdieping).toBe('verdieping 1');
    expect((await api('PATCH', `${pad}/lokalen/bestaat-niet`, { verdieping: 'x' })).data.fout).toBe('GEEN_TOEGANG');
  });

  test('leerkracht: enkel eigen domein; klaslijst mailen', async () => {
    const ned = sessie(k1, 'nederlands').id;
    const fout = await api('PATCH', `/api/beheer/instellingen/sessie/${ned}`, { waarden: { lesgever_email: 'juf@gmail.com' } });
    expect(fout.data.velden.lesgever_email).toContain('onderwijs.gent.be');
    await api('PATCH', `/api/beheer/instellingen/sessie/${ned}`, { waarden: { lesgever: 'Juf Kelly', lesgever_email: 'kelly@onderwijs.gent.be' } });
    const m = await api('POST', `/api/beheer/evenementen/${ev.evenementId}/rapport/mail`, { sessieIds: [ned, sessie(k1, 'kunst').id] });
    expect(m.data).toEqual({ verzonden: 1, zonderAdres: ['Domein Kunst'], mislukt: [] });
    expect((await een(`select nieuwe_waarde from audit_log where actie = 'MAIL_KLASLIJSTEN'`)).nieuwe_waarde).not.toContain('@');
  });

  test('lesjes en momenten kopiëren', async () => {
    // Zelfde code staat al in het doelblok: overgeslagen
    const dubbel = await api('POST', '/api/beheer/kopieer', { soort: 'sessies', ids: [sessie(k1, 'kunst').id], naar: [k2.id] });
    expect(dubbel.data).toMatchObject({ gekopieerd: 0, overgeslagen: [{ titel: 'Domein Kunst' }] });
    // Nieuw blok: alles mee, inclusief leerkracht en capaciteit, zonder inschrijvingen
    const { data: blok } = await api('POST', '/api/beheer/instellingen/tijdsblok', { ouderId: vm1.id, waarden: { naam: 'Keuzelesje 3', start_uur: '12:10', eind_uur: '12:40' } });
    const ids = k1.sessies.map((s: any) => s.id);
    const ok = await api('POST', '/api/beheer/kopieer', { soort: 'sessies', ids, naar: [blok.id] });
    expect(ok.data.gekopieerd).toBe(ids.length);
    const kopie = await een(`select capaciteit, lesgever, code from sessies where tijdsblok_id = ? and code = 'nederlands'`, blok.id);
    expect(kopie).toEqual({ capaciteit: 8, lesgever: 'Juf Kelly', code: 'nederlands' });
    expect((await een(`select count(*) as n from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id where s.tijdsblok_id = ?`, blok.id)).n).toBe(0);
    // Heel moment naar de tweede dag
    const dag2 = ev.dagen[1].id;
    const voor = (await een(`select count(*) as n from dagdelen where dag_id = ?`, dag2)).n;
    expect((await api('POST', '/api/beheer/kopieer', { soort: 'dagdeel', ids: [vm1.id], naar: [dag2] })).data.gekopieerd).toBe(1);
    expect((await een(`select count(*) as n from dagdelen where dag_id = ?`, dag2)).n).toBe(voor + 1);
    // Onbekend record: geweigerd
    expect((await api('POST', '/api/beheer/kopieer', { soort: 'sessies', ids: [crypto.randomUUID()], naar: [k2.id] })).data.fout).toBe('GEEN_TOEGANG');
    await sql(`delete from tijdsblokken where tijdsblok_id = ?`, blok.id);
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

  test('lokalen zijn schoolbreed: beheren vraagt een eigen recht', async () => {
    const nieuw = await api('POST', '/api/beheer/instellingen/locatie', {
      ouderId: evId, // wordt genegeerd: een lokaal hangt niet aan een evenement
      waarden: { naam: 'Zaal Noord', site: 'Hoofdsite', blok: 'N', verdieping: 'gelijkvloers', lokaal: 'N001', capaciteit: 40, faciliteiten: 'projector, micro' },
    });
    expect(nieuw.status).toBe(201);
    expect(await een(`select naam, site, capaciteit, faciliteiten from locaties where locatie_id = ?`, nieuw.data.id)).toMatchObject({
      naam: 'Zaal Noord', site: 'Hoofdsite', capaciteit: 40, faciliteiten: '["projector","micro"]',
    });

    // Het tabblad krijgt de lokalen met de faciliteiten als lijst; de keuzelijst bij een sessie kent het nieuwe lokaal.
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    expect(ev.locaties.find((l: any) => l.locatie_id === nieuw.data.id).faciliteiten).toEqual(['projector', 'micro']);
    expect(ev.opties.locatie.some((o: any) => o.waarde === nieuw.data.id)).toBe(true);

    expect((await api('PATCH', `/api/beheer/instellingen/locatie/${nieuw.data.id}`, { waarden: { capaciteit: 35 } })).status).toBe(200);
    expect((await een(`select capaciteit from locaties where locatie_id = ?`, nieuw.data.id)).capaciteit).toBe(35);

    // De onthaalmedewerker (zie de rechtentest hierboven) heeft het recht niet, ook niet op zijn eigen evenement.
    env.DEV_BEHEER_EMAIL = 'onthaal.test@onderwijs.gent.be';
    expect((await api('PATCH', `/api/beheer/instellingen/locatie/${nieuw.data.id}`, { waarden: { capaciteit: 1 } })).status).toBe(403);
    expect((await api('POST', '/api/beheer/instellingen/locatie', { ouderId: evId, waarden: { naam: 'Mag niet' } })).status).toBe(403);
    env.DEV_BEHEER_EMAIL = BEHEERDER;

    expect((await api('DELETE', `/api/beheer/instellingen/locatie/${nieuw.data.id}`)).status).toBe(200);
  });

  test('een verborgen tijdsblok verdwijnt uit het formulier, en komt terug als je het weer aanzet', async () => {
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    const blok = ev.dagen
      .flatMap((d: any) => d.dagdelen.flatMap((dd: any) => dd.tijdsblokken))
      .find((t: any) => t.type === 'keuze' && t.sessies.length);
    expect(blok).toBeTruthy();

    const inFormulier = async () => {
      const p = await api('GET', `/api/evenementen/${SLUG}`);
      return p.data.dagen.flatMap((d: any) => d.dagdelen.flatMap((dd: any) => dd.tijdsblokken ?? [])).some((t: any) => t.id === blok.tijdsblok_id);
    };

    expect(await inFormulier()).toBe(true);
    expect((await api('PATCH', `/api/beheer/instellingen/tijdsblok/${blok.tijdsblok_id}`, { waarden: { zichtbaar: false } })).status).toBe(200);
    expect(await inFormulier()).toBe(false);

    // In de instellingen blijft het wel staan, zodat je het kan terugzetten.
    const na = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    expect(na.dagen.flatMap((d: any) => d.dagdelen.flatMap((dd: any) => dd.tijdsblokken)).some((t: any) => t.tijdsblok_id === blok.tijdsblok_id)).toBe(true);

    expect((await api('PATCH', `/api/beheer/instellingen/tijdsblok/${blok.tijdsblok_id}`, { waarden: { zichtbaar: true } })).status).toBe(200);
    expect(await inFormulier()).toBe(true);
  });

  test('lokaal op sessiecode raakt elk lesje met die code, ongeacht letterkast', async () => {
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    const blokken = ev.dagen.flatMap((d: any) => d.dagdelen.flatMap((dd: any) => dd.tijdsblokken)).filter((t: any) => t.type === 'keuze');
    expect(blokken.length).toBeGreaterThan(1);
    const a = await api('POST', '/api/beheer/instellingen/sessie', { ouderId: blokken[0].tijdsblok_id, waarden: { titel: 'Code-test A', code: 'CT1' } });
    const b = await api('POST', '/api/beheer/instellingen/sessie', { ouderId: blokken[1].tijdsblok_id, waarden: { titel: 'Code-test B', code: 'ct1' } });
    const lok = await api('POST', '/api/beheer/instellingen/locatie', { waarden: { naam: 'Codelokaal' } });

    const r = await api('POST', '/api/beheer/instellingen/lokaal-op-code', { evenementId: evId, code: 'CT1', locatieId: lok.data.id });
    expect(r.status).toBe(200);
    expect(r.data.aantal).toBe(2); // 'CT1' en 'ct1' horen bij hetzelfde lesje
    for (const id of [a.data.id, b.data.id]) {
      expect((await een(`select locatie_id from sessies where sessie_id = ?`, id)).locatie_id).toBe(lok.data.id);
    }

    // Een onbestaand lokaal of een lege code wordt geweigerd.
    expect((await api('POST', '/api/beheer/instellingen/lokaal-op-code', { evenementId: evId, code: 'CT1', locatieId: 'bestaat-niet' })).status).toBe(400);
    expect((await api('POST', '/api/beheer/instellingen/lokaal-op-code', { evenementId: evId, code: '  ', locatieId: lok.data.id })).status).toBe(400);

    await api('DELETE', `/api/beheer/instellingen/sessie/${a.data.id}`);
    await api('DELETE', `/api/beheer/instellingen/sessie/${b.data.id}`);
    await api('DELETE', `/api/beheer/instellingen/locatie/${lok.data.id}`);
  });

  test('leerkracht uit de contacten: enkel intern, en naam en adres worden overgenomen', async () => {
    // Twee contacten via "Contacten plakken": een lesgever van de eigen organisatie en een ouder van buiten.
    const toe = await api('POST', '/api/beheer/contacten/toevoegen', {
      groep: 'Lesgevers test',
      rijen: [
        { email: 'lea.lesgever@onderwijs.gent.be', voornaam: 'Lea', naam: 'Lesgever' },
        { email: 'olga.ouder@voorbeeld.example', voornaam: 'Olga', naam: 'Ouder' },
      ],
    });
    expect(toe.status).toBe(200);
    const inGroep = (intern: number) =>
      een<{ contact_id: string }>(
        `select c.contact_id from contacten c join contact_groepen g on g.contact_id = c.contact_id
         where g.groep = 'Lesgevers test' and g.intern = ?`,
        intern,
      );
    const lea = (await inGroep(1))!;
    const olga = (await inGroep(0))!;
    await sql(`update contacten set functie = 'leerkracht Latijn', bedrijfsnaam = 'FMG' where contact_id = ?`, lea.contact_id);

    // De keuzelijst bevat de interne lesgever met functie en bedrijfsnaam, en niet de ouder.
    const ev = (await api('GET', `/api/beheer/evenementen/${evId}/instellingen`)).data;
    expect(ev.opties.contact).toContainEqual({ waarde: lea.contact_id, label: 'Lea Lesgever — leerkracht Latijn, FMG' });
    expect(ev.opties.contact.some((o: any) => o.label.includes('Ouder'))).toBe(false);

    const sessie = ev.dagen[0].dagdelen[0].tijdsblokken.find((t: any) => t.sessies.length).sessies[0];
    expect((await api('PATCH', `/api/beheer/instellingen/sessie/${sessie.sessie_id}`, { waarden: { lesgever_contact_id: lea.contact_id } })).status).toBe(200);
    expect(await een(`select lesgever_contact_id, lesgever, lesgever_email from sessies where sessie_id = ?`, sessie.sessie_id)).toMatchObject({
      lesgever_contact_id: lea.contact_id,
      lesgever: 'Lea Lesgever',
      lesgever_email: 'lea.lesgever@onderwijs.gent.be',
    });

    // Een ouder (niet intern) kan geen leerkracht worden: anders zou die naam op een klaslijst komen.
    const fout = await api('PATCH', `/api/beheer/instellingen/sessie/${sessie.sessie_id}`, { waarden: { lesgever_contact_id: olga.contact_id } });
    expect(fout.status).toBe(400);
    expect(fout.data.velden).toHaveProperty('lesgever_contact_id');

    // Opruimen: de verwijzing in de sessie valt op null (on delete set null), de groepen gaan mee.
    await sql(`delete from contacten where contact_id in (?, ?)`, lea.contact_id, olga.contact_id);
    await sql(`update sessies set lesgever = null, lesgever_email = null where sessie_id = ?`, sessie.sessie_id);
  });
});

describe('e-mail via de Power Automate-webhook', () => {
  const URL_FLOW = 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=geheim';
  type Aanroep = { url: string; body: any };
  let aanroepen: Aanroep[];
  let antwoord: () => Response;
  const echteFetch = globalThis.fetch;

  const wacht = async () => {
    await Promise.all(wachtend.splice(0));
  };

  beforeAll(() => {
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    env.MAIL_PROVIDER = 'webhook';
    env.MAIL_WEBHOOK_URL = URL_FLOW;
    env.MAIL_WEBHOOK_SLEUTEL = 'testsleutel-123';
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://prod-12.westeurope.logic.azure.com')) {
        aanroepen.push({ url: String(url), body: JSON.parse(init.body) });
        return antwoord();
      }
      return echteFetch(url, init);
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = echteFetch;
    env.MAIL_PROVIDER = 'log';
  });
  beforeEach(() => {
    aanroepen = [];
    antwoord = () => new Response(null, { status: 202 });
  });

  test('inschrijven stuurt één bevestigingsmail met de persoonlijke link', async () => {
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const dagdeel = ev.dagen[0].dagdelen[0];
    const r = await registreer(deelnemer({ voornaam: 'Mailtest' }), [dagdeel.id], []);
    expect(r.status).toBe(201);
    await wacht();
    expect(aanroepen).toHaveLength(1);
    const b = aanroepen[0].body;
    expect(b).toMatchObject({ sleutel: 'testsleutel-123', type: 'bevestiging', aan: expect.stringMatching(/^ouder\d+@example\.org$/) });
    expect(b.onderwerp).toContain(r.data.referentie);
    expect(b.html).toContain(r.data.beheerUrl); // de link om te bekijken of te annuleren
    const rij = await een(`select status, type, fout from mail_berichten order by created_at desc limit 1`);
    expect(rij).toMatchObject({ status: 'verzonden', type: 'bevestiging', fout: null });
    // De inhoud van de mail wordt nergens in de database bewaard.
    expect(JSON.stringify(await een(`select * from mail_berichten order by created_at desc limit 1`))).not.toContain('example.org');
  });

  test('{{contactEmail}} komt uit het evenement; zonder contactadres valt de regel weg', async () => {
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const dagdeel = ev.dagen[0].dagdelen[0];
    const adres = 'infodag@freinetmiddenschool.example'; // staat zo in de seed

    expect((await registreer(deelnemer({ voornaam: 'Contactwel' }), [dagdeel.id], [])).status).toBe(201);
    await wacht();
    expect(aanroepen[0].body.html).toContain(`mailto:${adres}`);
    expect(aanroepen[0].body.html).toContain('Vragen? Mail naar');

    // Leeg laten in de instellingen van het evenement = geen contactregel in de mail.
    await sql(`update evenementen set contact_email = null where slug = ?`, SLUG);
    aanroepen.length = 0;
    expect((await registreer(deelnemer({ voornaam: 'Contactniet' }), [dagdeel.id], [])).status).toBe(201);
    await wacht();
    expect(aanroepen[0].body.html).not.toContain('Vragen? Mail naar');
    expect(aanroepen[0].body.html).not.toContain(adres);

    await sql(`update evenementen set contact_email = ? where slug = ?`, adres, SLUG);
  });

  test('voetbanner: geen grijze streep tussen de banner en de voettekst', async () => {
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const dagdeel = ev.dagen[0].dagdelen[0];
    await sql(`insert or ignore into mailopmaak (id) values (1)`);
    await sql(`update mailopmaak set voet_banner = '/api/mailbeelden/voet-test' where id = 1`);
    aanroepen.length = 0;
    expect((await registreer(deelnemer({ voornaam: 'Banner' }), [dagdeel.id], [])).status).toBe(201);
    await wacht();
    expect(aanroepen[0].body.html).toContain('/api/mailbeelden/voet-test');
    expect(aanroepen[0].body.html).toContain('border-top:1px solid #ffffff');
    expect(aanroepen[0].body.html).not.toContain('border-top:1px solid #cfd6df');

    // Zonder banner blijft de lijn wel staan: die scheidt de inhoud van de voettekst.
    await sql(`update mailopmaak set voet_banner = null where id = 1`);
    aanroepen.length = 0;
    expect((await registreer(deelnemer({ voornaam: 'Geenbanner' }), [dagdeel.id], [])).status).toBe(201);
    await wacht();
    expect(aanroepen[0].body.html).toContain('border-top:1px solid #cfd6df');
  });

  test('bevestigingsmail: QR-code voor de check-in met een eigen token, zonder persoonsgegevens', async () => {
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const r = await registreer(deelnemer({ voornaam: 'Qrtest', email: 'qrtest@example.org' }), [ev.dagen[0].dagdelen[0].id], []);
    await wacht();
    const html: string = aanroepen[0].body.html;
    const { sha256 } = await import('../src/crypto/versleuteling');
    const { checkin_token } = await een(`select checkin_token from deelnemers where beheer_token_hash = ?`, await sha256(token(r)));
    expect(checkin_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(checkin_token).not.toBe(token(r)); // los van de beheertoken
    expect(html).toContain('QR-code voor aanmelden op de dag van het evenement');
    expect(html).toContain(`http://localhost:5173/api/checkin/${checkin_token}/qr.png`);
    expect(html).toContain(`http://localhost:5173/checkin/${checkin_token}`);
    expect(html).toContain(r.data.beheerUrl); // de beheerlink blijft
    // De sectie staat onder de tekst van het sjabloon.
    expect(html.indexOf('QR-code voor aanmelden')).toBeGreaterThan(html.indexOf(r.data.beheerUrl));

    const png = await worker.fetch(new Request(`http://localhost/api/checkin/${checkin_token}/qr.png`), env, ctx);
    expect(png.status).toBe(200);
    expect(png.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await png.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // Geen QR-code voor een onbekende token (geen open generator)
    expect((await api('GET', `/api/checkin/${'x'.repeat(43)}/qr.png`)).status).toBe(404);
    // De check-intoken geeft geen toegang tot het zelfbeheer
    expect((await api('GET', `/api/registraties/${checkin_token}`)).status).toBe(404);
  });

  test('een aangepaste mailtekst houdt de QR-code onderaan', async () => {
    await sql(`insert into mailsjablonen (sleutel, onderwerp, tekst) values ('bevestiging', 'Eigen onderwerp', 'Eigen tekst voor {{voornaam}}.')
               on conflict (sleutel) do update set onderwerp = excluded.onderwerp, tekst = excluded.tekst`);
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    await registreer(deelnemer({ voornaam: 'Eigen' }), [ev.dagen[0].dagdelen[0].id], []);
    await wacht();
    expect(aanroepen[0].body.html).toContain('Eigen tekst voor Eigen.');
    expect(aanroepen[0].body.html).toContain('QR-code voor aanmelden op de dag van het evenement');
    await sql(`delete from mailsjablonen where sleutel = 'bevestiging'`);
  });

  test('versienummer: elke wijziging door ouder of school geeft een mail met een nieuwe QR-code', async () => {
    const { sha256 } = await import('../src/crypto/versleuteling');
    const r = await registreer(deelnemer({ voornaam: 'Versie' }), [vm1.id], []);
    await wacht();
    const stand = async () =>
      een(`select deelnemer_id, checkin_token, checkin_versie, gewijzigd_door, checkin_gemaild_op from deelnemers where beheer_token_hash = ?`, await sha256(token(r)));
    const s1 = await stand();
    expect(s1).toMatchObject({ checkin_versie: 1, gewijzigd_door: null });
    expect(s1.checkin_gemaild_op).toBeTruthy();
    expect(aanroepen[0].body.html).toContain(`/checkin/${s1.checkin_token}?v=1`);

    // De ouder kiest een lesje via de persoonlijke link
    aanroepen = [];
    expect((await api('PATCH', `/api/registraties/${token(r)}`, { sessies: [sessie(k1, 'infomoment').id] })).status).toBe(200);
    await wacht();
    const s2 = await stand();
    expect(s2.checkin_versie).toBeGreaterThan(1);
    expect(s2.gewijzigd_door).toBe('ouder');
    expect(aanroepen).toHaveLength(1);
    expect(aanroepen[0].body.type).toBe('wijziging');
    expect(aanroepen[0].body.html).toContain(`/checkin/${s1.checkin_token}?v=${s2.checkin_versie}`);

    // De school kent een ander lesje toe: mail met overzicht en nieuwe QR, zonder de persoonlijke link
    aanroepen = [];
    expect((await api('POST', `/api/beheer/deelnemers/${s1.deelnemer_id}/sessie`, { sessieId: sessie(k1, 'kunst').id, forceer: true })).status).toBe(200);
    await wacht();
    const s3 = await stand();
    expect(s3.checkin_versie).toBeGreaterThan(s2.checkin_versie);
    expect(s3.gewijzigd_door).toBe('school');
    expect(aanroepen).toHaveLength(1);
    expect(aanroepen[0].body.type).toBe('schoolwijziging');
    expect(aanroepen[0].body.html).toContain('Kunst');
    expect(aanroepen[0].body.html).toContain(`/checkin/${s1.checkin_token}?v=${s3.checkin_versie}`);
    expect(aanroepen[0].body.html).not.toContain(token(r));

    // Zonder verwittigen: geen mail. Aanwezigheid registreren verandert het versienummer niet.
    aanroepen = [];
    await api('POST', `/api/beheer/deelnemers/${s1.deelnemer_id}/sessie`, { sessieId: sessie(k1, 'infomoment').id, verwittig: false });
    await wacht();
    expect(aanroepen).toHaveLength(0);
    const s4 = await stand();
    await sql(`update inschrijvingen set aanwezig = 1, checkin_datum = 'x' where deelnemer_id = ?`, s1.deelnemer_id);
    expect((await stand()).checkin_versie).toBe(s4.checkin_versie);
  });

  test('QR-code mailen aan inschrijvingen van vóór de QR-code: één keer per inschrijving', async () => {
    const r = await registreer(deelnemer({ voornaam: 'Oud' }), [vm1.id], []);
    await wacht();
    const { sha256 } = await import('../src/crypto/versleuteling');
    const { deelnemer_id: id } = await een(`select deelnemer_id from deelnemers where beheer_token_hash = ?`, await sha256(token(r)));
    // Zoals een inschrijving van vóór de QR-code; alle andere hebben er al een gekregen
    await sql(`update deelnemers set checkin_token = null, checkin_gemaild_op = null where deelnemer_id = ?`, id);
    await sql(`update deelnemers set checkin_gemaild_op = coalesce(checkin_gemaild_op, 'test') where deelnemer_id <> ?`, id);
    const pad = `/api/beheer/evenementen/${ev.evenementId}/qrcode-mails`;
    expect((await api('GET', pad)).data).toEqual({ teVersturen: 1 });

    aanroepen = [];
    expect((await api('POST', pad)).data).toEqual({ verstuurd: 1, mislukt: 0, teVersturen: 0 });
    const { checkin_token } = await een(`select checkin_token from deelnemers where deelnemer_id = ?`, id);
    expect(checkin_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(aanroepen).toHaveLength(1);
    expect(aanroepen[0].body.type).toBe('qrcode');
    expect(aanroepen[0].body.html).toContain(`/checkin/${checkin_token}?v=1`);

    aanroepen = [];
    expect((await api('POST', pad)).data).toMatchObject({ verstuurd: 0, teVersturen: 0 });
    expect(aanroepen).toHaveLength(0);
  });

  test('bovenaan het logo van het evenement of de banner, volgens het vinkje Huisstijl (geen WebP)', async () => {
    const id = ev.evenementId;
    await sql(`update mailopmaak set kop_banner = null`);
    await env.STORAGE.put(`logos/${id}`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { httpMetadata: { contentType: 'image/png' } });
    await sql(`update evenementen set logo = ?, logo_hoogte = 200, kleur_primair = '#123456' where evenement_id = ?`, `/api/logo/${id}?v=7`, id);
    const mailVoor = async () => {
      aanroepen = [];
      await registreer(deelnemer(), [vm1.id], []);
      await wacht();
      return aanroepen[0].body.html as string;
    };

    let html = await mailVoor();
    expect(html).toContain(`http://localhost:5173/api/logo/${id}?v=7`);
    expect(html).toContain('height="120"'); // begrensd
    expect(html).not.toContain('border-bottom:4px solid'); // geen lijn onder het logo, ook niet in de hoofdkleur

    await env.STORAGE.put(`logos/${id}`, new Uint8Array([1]), { httpMetadata: { contentType: 'image/webp' } });
    expect(await mailVoor()).not.toContain('/api/logo/');

    // Het vinkje "afbeelding uit Algemeen > Huisstijl" staat standaard aan: het logo van het evenement gaat voor
    // op de gemeenschappelijke banner uit Mailteksten.
    await env.STORAGE.put(`logos/${id}`, new Uint8Array([1]), { httpMetadata: { contentType: 'image/png' } });
    await sql(`insert into mailopmaak (id, kop_banner) values (1, '/api/mailbeelden/kop-test') on conflict (id) do update set kop_banner = excluded.kop_banner`);
    html = await mailVoor();
    expect(html).toContain(`/api/logo/${id}`);
    expect(html).not.toContain('/api/mailbeelden/kop-test');

    // Vinkje uit: dan gaat de banner van Mailteksten voor.
    await sql(`update mailopmaak set logo_uit_huisstijl = 0`);
    html = await mailVoor();
    expect(html).toContain('/api/mailbeelden/kop-test');
    expect(html).not.toContain('/api/logo/');

    // Vinkje aan, maar het evenement heeft geen logo: dan valt de banner alsnog in.
    await sql(`update mailopmaak set logo_uit_huisstijl = 1`);
    await sql(`update evenementen set logo = null where evenement_id = ?`, id);
    expect(await mailVoor()).toContain('/api/mailbeelden/kop-test');

    await sql(`update mailopmaak set kop_banner = null`);
    await sql(`update evenementen set logo = null, logo_hoogte = null, kleur_primair = null where evenement_id = ?`, id);
    await env.STORAGE.delete(`logos/${id}`);
  });

  test('annuleren via de link stuurt een annulatiemail', async () => {
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const r = await registreer(deelnemer(), [ev.dagen[0].dagdelen[0].id], []);
    await wacht();
    aanroepen = [];
    const t = r.data.beheerUrl.split('/beheer/')[1];
    expect((await api('DELETE', `/api/registraties/${t}`)).status).toBe(200);
    await wacht();
    expect(aanroepen).toHaveLength(1);
    expect(aanroepen[0].body).toMatchObject({ type: 'annulatie' });
    expect(aanroepen[0].body.html).toContain('geannuleerd');
    // Nog eens annuleren: geen tweede mail
    aanroepen = [];
    expect((await api('DELETE', `/api/registraties/${t}`)).status).toBe(404);
    await wacht();
    expect(aanroepen).toHaveLength(0);
  });

  test('een flow die uitvalt: de inschrijving lukt, de mislukking wordt gelogd (zonder inhoud)', async () => {
    antwoord = () => new Response('boom', { status: 500 });
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    const r = await registreer(deelnemer(), [ev.dagen[0].dagdelen[0].id], []);
    expect(r.status).toBe(201);
    expect(r.data.beheerUrl).toBeTruthy(); // de ouder ziet de link nog altijd op het scherm
    await wacht();
    expect(aanroepen).toHaveLength(2); // twee pogingen
    const rij = await een(`select status, fout from mail_berichten order by created_at desc limit 1`);
    expect(rij.status).toBe('mislukt');
    expect(rij.fout).toContain('500');
    expect(rij.fout).not.toContain('example.org');
  });

  test('een ongeldig webhook-adres wordt nooit aangeroepen', async () => {
    env.MAIL_WEBHOOK_URL = 'https://kwaadaardig.example/hook';
    const ev = (await api('GET', `/api/evenementen/${SLUG}`)).data;
    await registreer(deelnemer(), [ev.dagen[0].dagdelen[0].id], []);
    await wacht();
    expect(aanroepen).toHaveLength(0);
    expect((await een(`select status from mail_berichten order by created_at desc limit 1`)).status).toBe('mislukt');
    env.MAIL_WEBHOOK_URL = URL_FLOW;
  });

  test('testmail: enkel platformbeheer, naar jezelf, met duidelijke fout als de flow niet werkt', async () => {
    const ok = await api('POST', '/api/beheer/mail/test', {});
    expect(ok.data).toMatchObject({ ok: true, provider: 'webhook', status: 'verzonden' });
    expect(aanroepen[0].body).toMatchObject({ type: 'test', aan: BEHEERDER });
    antwoord = () => new Response('nee', { status: 401 });
    const fout = await api('POST', '/api/beheer/mail/test', {});
    expect(fout.data).toMatchObject({ ok: false });
    expect(fout.data.fout).toContain('401');
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'organisator') where email = ?`, BEHEERDER);
    expect((await api('POST', '/api/beheer/mail/test', {})).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, BEHEERDER);
  });
});

describe('voorinschrijvingen importeren', () => {
  const IMPORTEUR = 'import.test@onderwijs.gent.be';
  let schoolId: string;
  let importId: string;

  beforeAll(async () => {
    await sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'I', 'T', ?, rol_id from rollen where code = 'platformbeheerder'`, IMPORTEUR);
    schoolId = (await een(`select school_id from scholen order by naam limit 1`)).school_id;
    // Een ouder die zich ook voor een infodag inschreef (zelfde blinde index als bij een echte inschrijving).
    const { blindeIndex } = await import('../src/crypto/versleuteling');
    await sql(`insert into deelnemers (deelnemer_id, evenement_id, email_hash, privacy_akkoord_op) select ?, evenement_id, ?, '2026-01-01' from evenementen limit 1`,
      crypto.randomUUID(), await blindeIndex(env, 'email', 'zelfde@example.org'));
  });

  test('enkel met het recht voorinschrijvingen.beheren', async () => {
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'organisator') where email = ?`, BEHEERDER);
    expect((await api('GET', '/api/beheer/voorinschrijvingen/importen')).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, BEHEERDER);
    env.DEV_BEHEER_EMAIL = IMPORTEUR;
  });

  test('importeren: versleuteld, school gekoppeld of als andere, ongeldige rijen gecontroleerd', async () => {
    expect((await api('POST', '/api/beheer/voorinschrijvingen/importen', { naam: '', rijen: [] })).data.velden).toMatchObject({ naam: expect.any(String), rijen: expect.any(String) });
    expect((await api('POST', '/api/beheer/voorinschrijvingen/importen', { naam: 'X', rijen: [{ schoolId: crypto.randomUUID() }] })).status).toBe(400);

    const r = await api('POST', '/api/beheer/voorinschrijvingen/importen', {
      naam: 'Voorinschrijvingen 2025-2026',
      bestandsnaam: 'proef.csv',
      rijen: [
        { ingediendOp: '2025-03-11T13:26:06', schooljaar: 'Schooljaar 2026 - 2027', klas: '6de leerjaar', schoolId, kindNaam: 'Proef Kind', email: 'Zelfde@Example.org', telefoon: '0400000000', opmerkingen: 'Vraag' },
        { ingediendOp: '2025-04-02T09:00:00', schooljaar: 'Schooljaar 2026 - 2027', klas: '5de leerjaar', schoolAndere: 'School buiten de lijst', kindNaam: 'Tweede Kind', email: 'ander@example.org' },
        { ingediendOp: 'geen datum', klas: '6de leerjaar', schoolId, kindNaam: 'Derde Kind', email: 'ander@example.org' },
      ],
    });
    expect(r.status).toBe(201);
    importId = r.data.importId;
    const rij = await een(`select * from voorinschrijvingen where import_id = ? and school_id is not null order by ingediend_op limit 1`, importId);
    // Naam en e-mail staan bij de persoon en het contact van de kern, versleuteld; niet meer in de rij zelf.
    expect(rij.kind_naam_enc).toBeNull();
    expect((await een(`select naam_enc from personen where persoon_id = ?`, rij.persoon_id)).naam_enc).toMatch(/^v1\./);
    expect(JSON.stringify(rij)).not.toContain('Proef Kind');
    expect(await een(`select count(*) as n from voorinschrijvingen where import_id = ? and ingediend_op is null`, importId)).toEqual({ n: 1 });
    expect(await een(`select school_andere from voorinschrijvingen where import_id = ? and school_id is null`, importId)).toEqual({ school_andere: 'School buiten de lijst' });
  });

  test('statistieken en controles, zonder persoonsgegevens', async () => {
    const s = (await api('GET', '/api/beheer/voorinschrijvingen/statistieken')).data.find((x: any) => x.id === importId);
    expect(s.aantal).toBe(3);
    expect(s.controle).toEqual({ zonderEmail: 0, dubbeleAdressen: 1, ookIngeschreven: 1, ookInAndereImport: 0, adressen: 2, kinderen: 3, kinderenIngeschreven: 0 });
    expect(s.scholen.find((x: any) => x.soort === 'andere')).toMatchObject({ school: 'School buiten de lijst', aantal: 1 });
    expect(s.klassen).toContainEqual({ klas: '6de leerjaar', aantal: 2 });
    expect(s.maanden).toEqual([{ maand: '2025-03', aantal: 1 }, { maand: '2025-04', aantal: 1 }]);
    expect(JSON.stringify(s)).not.toMatch(/Kind|example\.org/);
  });

  test('anonimiseren wist persoonsgegevens, statistieken blijven; verwijderen wist alles', async () => {
    expect((await api('POST', `/api/beheer/voorinschrijvingen/importen/${importId}/anonimiseer`)).status).toBe(200);
    expect(await een(`select count(*) as n from voorinschrijvingen where import_id = ? and (kind_naam_enc is not null or email_enc is not null or telefoon_enc is not null or opmerkingen_enc is not null or email_hash is not null)`, importId)).toEqual({ n: 0 });
    const s = (await api('GET', '/api/beheer/voorinschrijvingen/statistieken')).data.find((x: any) => x.id === importId);
    expect(s.geanonimiseerdOp).toBeTruthy();
    expect(s.klassen).toContainEqual({ klas: '6de leerjaar', aantal: 2 });
    expect(await een(`select count(*) as n from audit_log where entiteit = 'voorinschrijvingen_importen' and record_id = ?`, importId)).toEqual({ n: 2 });

    expect((await api('DELETE', `/api/beheer/voorinschrijvingen/importen/${importId}`)).status).toBe(200);
    expect(await een(`select count(*) as n from voorinschrijvingen where import_id = ?`, importId)).toEqual({ n: 0 });
    expect((await api('DELETE', `/api/beheer/voorinschrijvingen/importen/${importId}`)).status).toBe(404);
  });
});

describe('contacten, personen en uitnodigingen', () => {
  const BEHEER = 'import.test@onderwijs.gent.be';
  const URL_FLOW = 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=geheim';
  const echteFetch = globalThis.fetch;
  let mails: any[] = [];
  let evId: string;
  let dagdeelId: string;
  let importA: string;
  let importB: string;
  const importeer = (naam: string, rijen: object[]) => api('POST', '/api/beheer/voorinschrijvingen/importen', { naam, rijen });
  const contactVan = async (email: string) => {
    const { blindeIndex } = await import('../src/crypto/versleuteling');
    return (await een(`select contact_id from contacten where email_hash = ?`, await blindeIndex(env, 'email', email)))?.contact_id ?? null;
  };
  const tokens = (html: string) => [...html.matchAll(/uitnodiging=([A-Za-z0-9_-]{43})(&amp;afmelden=1)?/g)].map((m) => ({ token: m[1], afmelden: !!m[2] }));
  const inschrijven = (extra: Record<string, unknown>, uitnodiging?: string) =>
    api('POST', `/api/evenementen/${SLUG}/registraties`, { deelnemer: deelnemer(extra), dagdelen: [dagdeelId], sessies: [], uitnodiging });

  beforeAll(async () => {
    env.DEV_BEHEER_EMAIL = BEHEER;
    env.MAIL_PROVIDER = 'webhook';
    env.MAIL_WEBHOOK_URL = URL_FLOW;
    env.MAIL_WEBHOOK_SLEUTEL = 'testsleutel-123';
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://prod-12.westeurope.logic.azure.com')) {
        mails.push(JSON.parse(init.body));
        return new Response(null, { status: 202 });
      }
      return echteFetch(url, init);
    }) as typeof fetch;
    // Het evenement open en zonder capaciteitsgrens, ongeacht wat eerdere tests deden.
    await sql(`update evenementen set inschrijving_tot = null, eind_datum = '2099-12-31', status = 'gepubliceerd' where slug = ?`, SLUG);
    evId = (await een(`select evenement_id from evenementen where slug = ?`, SLUG)).evenement_id;
    await sql(`update dagdelen set capaciteit = null where dag_id in (select dag_id from evenement_dagen where evenement_id = ?)`, evId);
    dagdeelId = vm1.id;
  });
  afterAll(() => {
    globalThis.fetch = echteFetch;
    env.MAIL_PROVIDER = 'log';
  });

  test('import: één contact per adres, zelfde kind herkend, broer of zus apart, twijfel moet beslist worden', async () => {
    const a = await importeer('A', [
      { email: 'gezin@example.org', kindVoornaam: 'Robin', kindNaam: 'Proef', klas: '6de leerjaar' },
      { email: 'Gezin@Example.org', kindVoornaam: 'Lotte', kindNaam: 'Proef', klas: '5de leerjaar' },
      { email: 'gezin@example.org', kindVoornaam: 'robin', kindNaam: 'proef' }, // zelfde kind, ook in hetzelfde bestand
    ]);
    expect(a.data).toMatchObject({ contacten: 1, nieuweKinderen: 2 });
    importA = a.data.importId;
    const gezin = await contactVan('gezin@example.org');
    expect(await een(`select count(*) as n from personen where contact_id = ?`, gezin)).toEqual({ n: 2 });

    const rijen = [
      { email: 'gezin@example.org', kindVoornaam: 'Robin', kindNaam: 'Proef' }, // zelfde
      { email: 'gezin@example.org', kindVoornaam: 'Robbin', kindNaam: 'Proef' }, // tikfout = twijfel
      { email: 'nieuw@example.org', kindVoornaam: 'Mo', kindNaam: 'Test' },
    ];
    const c = await api('POST', '/api/beheer/voorinschrijvingen/personen', { rijen });
    expect(c.data.map((r: any) => [r.contact, r.status])).toEqual([['bestaand', 'zelfde'], ['bestaand', 'twijfel'], ['nieuw', 'nieuw']]);
    expect(c.data[1].kandidaten).toEqual([{ id: expect.any(String), naam: 'Robin Proef' }]);

    expect((await importeer('B', rijen)).status).toBe(400); // twijfel niet beslist
    const b = await importeer('B', rijen.map((r, i) => (i === 1 ? { ...r, persoonKeuze: 'nieuw' } : r)));
    expect(b.data).toMatchObject({ contacten: 2, nieuweKinderen: 2 });
    importB = b.data.importId;
    expect(await een(`select count(*) as n from personen where contact_id = ?`, gezin)).toEqual({ n: 3 });
  });

  test('inschrijven via het formulier: zelfde contact en kind, ook met andere hoofdletters', async () => {
    const r = await inschrijven({ email: 'GEZIN@example.org', voornaam: 'Robin', naam: 'Proef' });
    expect(r.status).toBe(201);
    const d = await een(`select persoon_id from deelnemers where contact_id = ?`, await contactVan('gezin@example.org'));
    const robin = await een(`select persoon_id from voorinschrijvingen where import_id = ? and klas = '6de leerjaar'`, importA);
    expect(d.persoon_id).toBe(robin.persoon_id);
  });

  test('uitnodigen: één mail per gezin met een link per kind; al ingeschreven niet; vooraf ingevuld; link één keer', async () => {
    const pad = `/api/beheer/voorinschrijvingen/importen/${importA}/uitnodigingen/${evId}`;
    expect((await api('GET', pad)).data).toMatchObject({ nogNietIngeschreven: 1, contacten: 1 });
    mails = [];
    expect((await api('POST', pad, { soort: 'uitnodiging' })).data).toEqual({ verstuurd: 1, mislukt: 0, resterend: 0 });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ aan: 'gezin@example.org', type: 'uitnodiging' });
    expect(mails[0].html).toContain('Lotte Proef inschrijven');
    expect(mails[0].html).not.toContain('Robin');
    const links = tokens(mails[0].html);
    const lotte = links[0].token;
    const ander = links.find((l) => l.token !== lotte && !l.afmelden)!.token;
    expect(links.filter((l) => l.afmelden).map((l) => l.token)).toEqual([lotte]);

    const v = await api('GET', `/api/uitnodigingen/${lotte}`);
    expect(v.data).toMatchObject({ slug: SLUG, status: 'verstuurd', contact: { email: 'gezin@example.org' }, persoon: { voornaam: 'Lotte', naam: 'Proef' }, leerjaar: '5de leerjaar' });

    // Inschrijven via de link: koppelt aan Lotte, ook als de ouder het e-mailadres wijzigt.
    expect((await inschrijven({ email: 'ander.adres@example.org', voornaam: 'Lotte', naam: 'Proef' }, lotte)).status).toBe(201);
    const { sha256 } = await import('../src/crypto/versleuteling');
    const lotteId = (await een(`select persoon_id from uitnodigingen where token_hash = ?`, await sha256(lotte))).persoon_id;
    expect(await een(`select count(*) as n from deelnemers where persoon_id = ?`, lotteId)).toEqual({ n: 1 });
    expect((await api('GET', `/api/uitnodigingen/${lotte}`)).data).toEqual({ slug: SLUG, evenement: expect.any(String), status: 'gebruikt' });
    expect((await inschrijven({ email: 'gezin@example.org', voornaam: 'Lotte', naam: 'Proef' }, lotte)).data.fout).toBe('UITNODIGING_GEBRUIKT');

    // "Een ander kind": nieuw kind bij hetzelfde contact; de link blijft bruikbaar.
    expect((await inschrijven({ email: 'gezin@example.org', voornaam: 'Mila', naam: 'Proef' }, ander)).status).toBe(201);
    expect(await een(`select count(*) as n from personen where contact_id = ?`, await contactVan('gezin@example.org'))).toEqual({ n: 4 });
    expect((await api('GET', `/api/uitnodigingen/${'x'.repeat(43)}`)).data.fout).toBe('UITNODIGING_ONGELDIG');
  });

  test('afmelden en herinneringen: enkel wie nog niet reageerde', async () => {
    const pad = `/api/beheer/voorinschrijvingen/importen/${importB}/uitnodigingen/${evId}`;
    await Promise.allSettled(wachtend.splice(0)); // bevestigingsmails van vorige tests eerst laten vertrekken
    mails = [];
    expect((await api('POST', pad, { soort: 'uitnodiging' })).data).toMatchObject({ verstuurd: 2, resterend: 0 });
    const naarGezin = mails.find((m) => m.aan === 'gezin@example.org');
    expect(naarGezin.html).toContain('Robbin Proef inschrijven'); // Robin is al ingeschreven en staat er niet in
    expect(naarGezin.html).not.toContain('Robin Proef');
    const robbin = tokens(naarGezin.html)[0].token;
    expect((await api('POST', `/api/uitnodigingen/${robbin}/afmelden`)).data).toEqual({ ok: true });

    // Meteen opnieuw: niets (minstens een uur tussen twee mails). Later: enkel wie nog niet reageerde.
    expect((await api('POST', pad, { soort: 'herinnering' })).data).toMatchObject({ verstuurd: 0 });
    await sql(`update uitnodigingen set laatst_verstuurd_op = '2000-01-01T00:00:00Z' where bron = ?`, `voorinschrijvingen:${importB}`);
    mails = [];
    expect((await api('POST', pad, { soort: 'herinnering' })).data).toMatchObject({ verstuurd: 1, resterend: 0 });
    expect(mails.map((m) => [m.aan, m.type])).toEqual([['nieuw@example.org', 'herinnering']]);
    expect((await api('GET', pad)).data).toMatchObject({ afgemeld: 1, verstuurd: 1 });
  });

  test('anonimiseren verbreekt de koppeling; de kern ruimt ongebruikte contacten en personen op', async () => {
    expect((await api('POST', `/api/beheer/voorinschrijvingen/importen/${importB}/anonimiseer`)).status).toBe(200);
    expect(await een(`select count(*) as n from uitnodigingen where bron = ?`, `voorinschrijvingen:${importB}`)).toEqual({ n: 0 });
    await worker.scheduled!({} as ScheduledController, env, ctx);
    await Promise.allSettled(wachtend.splice(0));
    expect(await contactVan('nieuw@example.org')).toBeNull(); // enkel in import B
    const gezin = await contactVan('gezin@example.org');
    expect(gezin).not.toBeNull(); // nog in import A en ingeschreven
    // Robbin (enkel in B) is weg; Robin, Lotte en Mila blijven.
    expect(await een(`select count(*) as n from personen where contact_id = ?`, gezin)).toEqual({ n: 3 });
  });
});

describe('mailteksten aanpassen (module mailsjablonen)', () => {
  const URL_FLOW = 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=geheim';
  const echteFetch = globalThis.fetch;
  let mails: any[] = [];

  beforeAll(() => {
    env.DEV_BEHEER_EMAIL = 'import.test@onderwijs.gent.be'; // platformbeheerder
    env.MAIL_PROVIDER = 'webhook';
    env.MAIL_WEBHOOK_URL = URL_FLOW;
    env.MAIL_WEBHOOK_SLEUTEL = 'testsleutel-123';
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://prod-12.westeurope.logic.azure.com')) {
        mails.push(JSON.parse(init.body));
        return new Response(null, { status: 202 });
      }
      return echteFetch(url, init);
    }) as typeof fetch;
  });
  afterAll(async () => {
    await sql(`delete from mailsjablonen`);
    await sql(`delete from mailopmaak`);
    globalThis.fetch = echteFetch;
    env.MAIL_PROVIDER = 'log';
  });

  test('lijst met sjablonen, velden en standaardtekst; enkel met het recht', async () => {
    const r = await api('GET', '/api/beheer/mailsjablonen');
    expect(r.data.map((s: any) => s.sleutel)).toEqual(['bevestiging', 'wijziging', 'annulatie', 'schoolwijziging', 'qrcode', 'sessiegever', 'aanmeldcode', 'uitnodiging', 'herinnering', 'klaslijst', 'voorinschrijving']);
    const b = r.data[0];
    expect(b).toMatchObject({ module: 'Evenementen en inschrijvingen', aangepast: null });
    expect(b.velden.map((v: any) => v.naam)).toContain('beheerlink');
    expect(b.standaard.tekst).toContain('{{beheerlink}}');

    env.DEV_BEHEER_EMAIL = BEHEERDER;
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'organisator') where email = ?`, BEHEERDER);
    expect((await api('GET', '/api/beheer/mailsjablonen')).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, BEHEERDER);
    env.DEV_BEHEER_EMAIL = 'import.test@onderwijs.gent.be';
  });

  test('aanpassen: controle op velden, voorbeeld, testmail; de echte mail gebruikt de nieuwe tekst', async () => {
    const pad = '/api/beheer/mailsjablonen/bevestiging';
    const fout = await api('PATCH', pad, { onderwerp: 'Ingeschreven: {{evenement}}', tekst: 'Dag {{ouder}}' });
    expect(fout.data.velden.tekst).toContain('Onbekend veld {{ouder}}.');

    const tekst = 'Hallo,\n\n**{{voornaam}}** is ingeschreven voor {{evenement}}.\n\n{{momenten}}\n\nWijzigen? {{beheerlink}}.';
    const v = await api('POST', `${pad}/voorbeeld`, { onderwerp: 'Ingeschreven: {{evenement}}', tekst });
    expect(v.data).toMatchObject({ onderwerp: 'Ingeschreven: Infodagen 2027', fouten: { onderwerp: [], tekst: [] } });
    expect(v.data.html).toContain('<strong>Lotte</strong>');

    mails = [];
    expect((await api('POST', `${pad}/test`, { onderwerp: 'Ingeschreven: {{evenement}}', tekst })).data).toEqual({ ok: true, aan: 'import.test@onderwijs.gent.be' });
    expect(mails[0].onderwerp).toBe('[Test] Ingeschreven: Infodagen 2027');

    expect((await api('PATCH', pad, { onderwerp: 'Ingeschreven: {{evenement}}', tekst })).data).toEqual({ ok: true });
    expect((await api('GET', '/api/beheer/mailsjablonen')).data[0].aangepast).toMatchObject({ onderwerp: 'Ingeschreven: {{evenement}}', gewijzigdDoor: 'T I' });

    mails = [];
    const r = await registreer(deelnemer({ voornaam: 'Sjabloon', email: 'sjabloon@example.org' }), [vm1.id], []);
    expect(r.status).toBe(201);
    await Promise.allSettled(wachtend.splice(0));
    const m = mails.find((x) => x.aan === 'sjabloon@example.org');
    expect(m.onderwerp).toMatch(/^Ingeschreven: /);
    expect(m.html).toContain('<strong>Sjabloon</strong> is ingeschreven');
    expect(m.html).toContain(r.data.beheerUrl); // de persoonlijke link blijft erin

    // Standaardtekst terug.
    expect((await api('DELETE', pad)).data).toEqual({ ok: true });
    mails = [];
    await registreer(deelnemer({ voornaam: 'Standaard', email: 'standaard@example.org' }), [vm1.id], []);
    await Promise.allSettled(wachtend.splice(0));
    expect(mails.find((x) => x.aan === 'standaard@example.org').onderwerp).toMatch(/^Bevestiging inschrijving /);
    expect((await api('PATCH', '/api/beheer/mailsjablonen/bestaatniet', { onderwerp: 'x', tekst: 'y' })).status).toBe(404);
  });

  /** Enkel de kop van een PNG (de afmetingen); genoeg voor de controle bij het opladen. */
  const png = (b: number, h: number) => {
    const d = new Uint8Array(64);
    d.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(d.buffer).setUint32(16, b);
    new DataView(d.buffer).setUint32(20, h);
    return d;
  };
  const oplaad = (plaats: string, data: Uint8Array, type = 'image/png') =>
    worker.fetch(new Request(`http://localhost/api/beheer/mailsjablonen/opmaak/${plaats}`, { method: 'POST', headers: { 'Content-Type': type }, body: data }), env, ctx)
      .then(async (r) => ({ status: r.status, data: (await r.json()) as any }));

  test('banners: afmetingen gecontroleerd; elke mail krijgt banner, voettekst en de regel wie en waarom', async () => {
    expect((await oplaad('kop', png(400, 100))).data.velden.banner).toContain('minstens 600 px');
    expect((await oplaad('kop', png(1200, 900))).data.velden.banner).toContain('Aanbevolen: 1200 × 300 px');
    expect((await oplaad('kop', new Uint8Array(64))).data.velden.banner).toContain('PNG- of JPG');
    expect((await oplaad('zijkant', png(1200, 300))).status).toBe(404);
    expect((await oplaad('kop', png(1200, 300))).data).toMatchObject({ ok: true, afmetingen: { breedte: 1200, hoogte: 300 } });

    const o = (await api('GET', '/api/beheer/mailsjablonen/opmaak')).data;
    expect(o.kopBanner).toMatch(/^http:\/\/localhost:5173\/api\/mailbeelden\/kop-[0-9a-f]{8}$/);
    expect(o.banners.kop).toMatchObject({ breedte: 1200, hoogte: 300 });
    const beeld = await worker.fetch(new Request(o.kopBanner.replace('http://localhost:5173', 'http://localhost')), env, ctx);
    expect(beeld.headers.get('Content-Type')).toBe('image/png');

    expect((await api('PATCH', '/api/beheer/mailsjablonen/opmaak', { voettekst: '{{organisatie}} · {{straat}}' })).data.velden.voettekst).toContain('{{straat}}');
    expect((await api('PATCH', '/api/beheer/mailsjablonen/opmaak', { voettekst: '**{{organisatie}}** · Voorbeeldstraat 1, 9000 Gent' })).data).toEqual({ ok: true });

    mails = [];
    await registreer(deelnemer({ voornaam: 'Opmaak', email: 'opmaak@example.org' }), [vm1.id], []);
    await Promise.allSettled(wachtend.splice(0));
    const html = mails.find((x) => x.aan === 'opmaak@example.org').html as string;
    expect(html).toContain(`<img src="${o.kopBanner}"`);
    expect(html).toContain('<strong>Stedelijk Onderwijs Gent</strong> · Voorbeeldstraat 1, 9000 Gent');
    expect(html).toContain('Deze mail werd verstuurd door Stedelijk Onderwijs Gent via het inschrijvingsplatform');
    expect(html).toMatch(/Je ontvangt ze omdat je een inschrijving deed voor [^<]+\./);
    expect(html.indexOf('Opmaak')).toBeLessThan(html.indexOf('Je ontvangt ze omdat')); // de inhoud staat boven de voet

    // Het voorbeeld in het dashboard toont dezelfde opmaak.
    expect((await api('POST', '/api/beheer/mailsjablonen/klaslijst/voorbeeld', {})).data.html).toContain('omdat je als leerkracht een lesje geeft op Infodagen 2027');

    expect((await api('DELETE', '/api/beheer/mailsjablonen/opmaak/kop')).data).toEqual({ ok: true });
    expect((await api('GET', '/api/beheer/mailsjablonen/opmaak')).data.kopBanner).toBeNull();
  });

  test('voorinschrijvingsformulier: huisstijl van een evenement, gezin en kind gekoppeld, geen dubbels, bevestigingsmail', async () => {
    const evId = (await een(`select evenement_id from evenementen where slug = ?`, SLUG)).evenement_id;
    await sql(`update evenementen set logo = '/api/logo/x', organisator = 'Freinetmiddenschool Gent', kleur_primair = '#123456' where evenement_id = ?`, evId);
    const fout = await api('POST', '/api/beheer/voorinschrijvingen/formulieren', { titel: '', slug: 'Ongeldig Adres' });
    expect(Object.keys(fout.data.velden).sort()).toEqual(['slug', 'titel']);
    const f = await api('POST', '/api/beheer/voorinschrijvingen/formulieren', {
      titel: 'Voorinschrijving 2027-2028', slug: 'voorinschrijving-2027', schooljaar: 'Schooljaar 2027 - 2028',
      leerjaarOpties: ['5de leerjaar', '6de leerjaar'], evenementId: evId, contactEmail: 'info@school.example',
    });
    expect(f.status).toBe(201);
    expect((await api('POST', '/api/beheer/voorinschrijvingen/formulieren', { titel: 'X', slug: 'voorinschrijving-2027' })).data.velden.slug).toContain('al in gebruik');

    const pub = await api('GET', '/api/voorinschrijven/voorinschrijving-2027');
    expect(pub.data).toMatchObject({ titel: 'Voorinschrijving 2027-2028', open: true, logo: '/api/logo/x', organisator: 'Freinetmiddenschool Gent', kleurPrimair: '#123456', leerjaarOpties: ['5de leerjaar', '6de leerjaar'] });
    expect((await api('GET', '/api/voorinschrijven/bestaat-niet')).status).toBe(404);

    const schoolId = (await een(`select school_id from scholen limit 1`)).school_id;
    const inzending = (extra: object) => api('POST', '/api/voorinschrijven/voorinschrijving-2027', {
      ouderVoornaam: 'An', email: 'formulier@example.org', kindVoornaam: 'Noor', kindNaam: 'Proef', schoolId, klas: '5de leerjaar', privacyAkkoord: true, ...extra,
    });
    expect(Object.keys((await inzending({ email: 'geen', klas: '3de leerjaar', privacyAkkoord: false })).data.velden).sort()).toEqual(['email', 'klas', 'privacyAkkoord']);

    mails = [];
    expect((await inzending({})).data).toEqual({ ok: true, bijgewerkt: false });
    await Promise.allSettled(wachtend.splice(0));
    expect(mails[0]).toMatchObject({ aan: 'formulier@example.org', type: 'voorinschrijving', onderwerp: 'Voorinschrijving ontvangen: Noor Proef' });
    expect(mails[0].html).toContain('Je ontvangt ze omdat je via ons formulier een voorinschrijving deed voor Noor Proef.');

    // Zelfde kind opnieuw (andere schrijfwijze): bijgewerkt. Broer: nieuwe rij bij hetzelfde gezin.
    expect((await inzending({ kindVoornaam: 'noor', kindNaam: 'PROEF', klas: '6de leerjaar' })).data).toEqual({ ok: true, bijgewerkt: true });
    expect((await inzending({ kindVoornaam: 'Bas', schoolId: undefined, schoolAndere: 'School in Brugge' })).data.bijgewerkt).toBe(false);
    const importId = f.data.importId;
    expect((await een(`select aantal from voorinschrijvingen_importen where import_id = ?`, importId)).aantal).toBe(2);
    expect(await een(`select count(distinct contact_id) as gezinnen, count(*) as rijen from voorinschrijvingen where import_id = ?`, importId)).toEqual({ gezinnen: 1, rijen: 2 });
    expect(await een(`select klas from voorinschrijvingen v join personen p on p.persoon_id = v.persoon_id where v.import_id = ? and v.school_id is not null`, importId)).toEqual({ klas: '6de leerjaar' });

    // De inzendingen staan als import bij Voorinschrijvingen (statistieken, uitnodigen).
    const s = (await api('GET', '/api/beheer/voorinschrijvingen/statistieken')).data.find((x: any) => x.id === importId);
    expect(s).toMatchObject({ aantal: 2, bestandsnaam: 'formulier', controle: { kinderen: 2, adressen: 1 } });

    // Dicht: geen inzendingen meer.
    expect((await api('PATCH', `/api/beheer/voorinschrijvingen/formulieren/${f.data.id}`, { open: false })).data).toEqual({ ok: true });
    expect((await inzending({ kindVoornaam: 'Later' })).data.fout).toBe('FORMULIER_GESLOTEN');
    expect((await api('GET', '/api/voorinschrijven/voorinschrijving-2027')).data.open).toBe(false);
  });
});

describe('aanwezigheid op de dag zelf en sessiegevers', () => {
  const URL_FLOW = 'https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=geheim';
  const echteFetch = globalThis.fetch;
  const BALIE = 'balie.test@onderwijs.gent.be';
  const PLATFORM = 'import.test@onderwijs.gent.be';
  const ORIGIN = 'http://localhost:5173';
  let mails: any[] = [];
  let oud: { datum: string; start: string; eind: string };
  let A: { id: string; token: string; versie: number };
  let E: { id: string; token: string };
  let sessiegeverId: string;
  let cookie = '';

  const wacht = () => Promise.allSettled(wachtend.splice(0));
  const sg = async (methode: string, pad: string, body?: unknown, metOrigin = true) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (metOrigin) headers.Origin = ORIGIN;
    const res = await worker.fetch(new Request(`http://localhost${pad}`, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: (await res.json()) as any, cookie: res.headers.get('Set-Cookie') };
  };
  const nieuweDeelnemer = async (voornaam: string, sessies: string[] = []) => {
    const { sha256 } = await import('../src/crypto/versleuteling');
    const r = await registreer(deelnemer({ voornaam }), [vm1.id], sessies);
    expect(r.status).toBe(201);
    return een(`select deelnemer_id as id, checkin_token as token, checkin_versie as versie from deelnemers where beheer_token_hash = ?`, await sha256(token(r)));
  };
  const scan = (t: string, v?: number) => api('GET', `/api/beheer/checkin/${t}${v ? `?v=${v}` : ''}`);
  const zetRecht = (rol: string, recht: string, toegestaan: boolean) => {
    env.DEV_BEHEER_EMAIL = PLATFORM;
    return api('PATCH', '/api/beheer/rollen-rechten', { rol, recht, toegestaan });
  };

  beforeAll(async () => {
    const { vandaag } = await import('../src/modules/evenementen/capaciteit');
    env.MAIL_PROVIDER = 'webhook';
    env.MAIL_WEBHOOK_URL = URL_FLOW;
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://prod-12.westeurope.logic.azure.com')) {
        mails.push(JSON.parse(init.body));
        return new Response(null, { status: 202 });
      }
      return echteFetch(url, init);
    }) as typeof fetch;
    // Het evenement is vandaag, en het dagdeel loopt de hele dag (dan hangt de test niet af van het uur).
    oud = await een(
      `select d.datum, dd.start_uur as start, dd.eind_uur as eind from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id where dd.dagdeel_id = ?`,
      vm1.id,
    );
    await sql(`update evenement_dagen set datum = ? where dag_id = (select dag_id from dagdelen where dagdeel_id = ?)`, vandaag(), vm1.id);
    await sql(`update dagdelen set start_uur = '00:00', eind_uur = '23:59' where dagdeel_id = ?`, vm1.id);
    await sql(`insert into gebruikers (naam, voornaam, email, rol_id) select 'Balie', 'Test', ?, rol_id from rollen where code = 'onthaal'`, BALIE);
    await sql(`insert into evenement_beheerders (evenement_id, gebruiker_id, rol) select ?, gebruiker_id, 'onthaal' from gebruikers where email = ?`, ev.evenementId, BALIE);
  });
  afterAll(async () => {
    globalThis.fetch = echteFetch;
    env.MAIL_PROVIDER = 'log';
    await sql(`update evenement_dagen set datum = ? where dag_id = (select dag_id from dagdelen where dagdeel_id = ?)`, oud.datum, vm1.id);
    await sql(`update dagdelen set start_uur = ?, eind_uur = ? where dagdeel_id = ?`, oud.start, oud.eind, vm1.id);
  });
  beforeEach(() => {
    mails = [];
  });

  test('scan aan het onthaal: groen, geel (oude mail, wachtlijst), blauw, rood', async () => {
    A = await nieuweDeelnemer('Scan', [sessie(k1, 'infomoment').id]);
    expect(A.versie).toBe(1);
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await scan(A.token, 1)).data).toMatchObject({ kleur: 'groen', code: 'OK', deelnemer: { voornaam: 'Scan' } });
    expect((await scan(A.token)).data).toMatchObject({ kleur: 'geel', code: 'OUDE_MAIL' }); // QR zonder versie
    expect((await scan('x'.repeat(43), 1)).data).toMatchObject({ kleur: 'rood', code: 'ONBEKEND' });

    expect((await api('POST', `/api/beheer/checkin/${A.token}`)).data).toEqual({ aangemeld: true });
    expect((await api('POST', `/api/beheer/checkin/${A.token}`)).data).toEqual({ aangemeld: false }); // tweede scan wint niet
    expect((await scan(A.token, 1)).data).toMatchObject({ kleur: 'blauw', code: 'AL_AANGEMELD' });
    const rij = await een(`select aanwezig, aanmeld_via, checkin_datum from inschrijvingen where deelnemer_id = ? and sessie_id is null`, A.id);
    expect(rij).toMatchObject({ aanwezig: 1, aanmeld_via: 'qr' });
    expect((await een(`select checkin_versie from deelnemers where deelnemer_id = ?`, A.id)).checkin_versie).toBe(1);
    await api('DELETE', `/api/beheer/checkin/${A.token}`);
    expect((await scan(A.token, 1)).data.kleur).toBe('groen');

    // Wachtlijst: de wijziging verhoogt de versie; met de nieuwe QR is het geel om een andere reden.
    await sql(`update inschrijvingen set status = 'wachtlijst' where deelnemer_id = ? and sessie_id is not null`, A.id);
    const v = (await een(`select checkin_versie from deelnemers where deelnemer_id = ?`, A.id)).checkin_versie;
    expect((await scan(A.token, 1)).data.code).toBe('OUDE_MAIL');
    expect((await scan(A.token, v)).data).toMatchObject({ kleur: 'geel', code: 'WACHTLIJST' });
    await sql(`update inschrijvingen set status = 'bevestigd' where deelnemer_id = ? and sessie_id is not null`, A.id);
    A.versie = (await een(`select checkin_versie from deelnemers where deelnemer_id = ?`, A.id)).checkin_versie;

    // Een andere dag en een geannuleerde inschrijving: rood
    const ander = await registreer(deelnemer({ voornaam: 'Middag' }), [ev.dagen[1].dagdelen[0].id], []);
    const { sha256 } = await import('../src/crypto/versleuteling');
    const am = await een(`select checkin_token from deelnemers where beheer_token_hash = ?`, await sha256(token(ander)));
    expect((await scan(am.checkin_token, 1)).data).toMatchObject({ kleur: 'rood', code: 'ANDERE_DAG' });
    await api('DELETE', `/api/registraties/${token(ander)}`);
    expect((await scan(am.checkin_token, 1)).data).toMatchObject({ kleur: 'rood', code: 'GEANNULEERD' });
    await wacht();
  });

  test('rechten per rol: in te stellen, enkel voor instelbare rechten', async () => {
    const r = await zetRecht('onthaal', 'evenementen.inchecken', false);
    expect(r.status).toBe(200);
    const recht = r.data.rechten.find((x: any) => x.recht === 'evenementen.inchecken');
    expect(recht.per.onthaal).toEqual({ toegestaan: false, standaard: true, vast: false });
    expect(recht.per.platformbeheerder).toEqual({ toegestaan: true, standaard: true, vast: true }); // platformbeheerder: altijd
    expect(r.data.rollen.map((x: any) => x.rol)).toEqual(['platformbeheerder', 'schoolbeheerder', 'organisator', 'onthaal', 'sessiegever']);
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await scan(A.token, A.versie)).status).toBe(403);
    await zetRecht('onthaal', 'evenementen.inchecken', true);
    expect(await een(`select count(*) as n from rol_rechten`)).toEqual({ n: 0 }); // gelijk aan de standaard: geen rij
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await scan(A.token, A.versie)).status).toBe(200);
    // Niet-instelbare rechten en onbekende rollen worden geweigerd; enkel de platformbeheerder mag het raster wijzigen
    expect((await zetRecht('onthaal', 'evenementen.aanmaken', true)).status).toBe(400);
    expect((await zetRecht('platformbeheerder', 'evenementen.inchecken', false)).status).toBe(400);
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await api('GET', '/api/beheer/rollen-rechten')).status).toBe(403);
  });

  test('overzicht voor het onthaal, balie, en lesje wijzigen met overboeken', async () => {
    env.DEV_BEHEER_EMAIL = BALIE;
    const o = await api('GET', `/api/beheer/evenementen/${ev.evenementId}/aanwezigheid`);
    expect(o.status).toBe(200);
    expect(o.data.dag.id).toBeTruthy();
    const a = o.data.deelnemers.find((d: any) => d.id === A.id);
    expect(a).toMatchObject({ voornaam: 'Scan', aanwezig: false, heeftQr: true });
    expect(o.data.rechten).toEqual({ lesjeWijzigen: true, overboeken: true, inchecken: true });

    expect((await api('POST', `/api/beheer/aanwezigheid/deelnemers/${A.id}`, { aanwezig: true })).data).toEqual({ aangemeld: true });
    const na = (await api('GET', `/api/beheer/evenementen/${ev.evenementId}/aanwezigheid`)).data;
    expect(na.deelnemers.find((d: any) => d.id === A.id)).toMatchObject({ aanwezig: true, via: 'balie' });
    expect(na.dagdelen.find((d: any) => d.id === vm1.id).aanwezig).toBeGreaterThanOrEqual(1);

    const opties = (await api('GET', `/api/beheer/aanwezigheid/deelnemers/${A.id}/lesjes`)).data;
    const blok = opties.blokken.find((b: any) => b.id === k1.id);
    const latijn = blok.sessies.find((s: any) => s.id === sessie(k1, 'latijn').id);
    expect(latijn).toMatchObject({ vol: true, gekozen: null });
    expect(blok.sessies.find((s: any) => s.gekozen)?.id).toBe(sessie(k1, 'infomoment').id);

    const pad = `/api/beheer/aanwezigheid/deelnemers/${A.id}/lesje`;
    expect((await api('POST', pad, { sessieId: latijn.id })).data.fout).toBe('SESSIE_VOLZET');
    // Overboeken: het onthaal mag dat standaard; na het uitzetten niet meer
    await zetRecht('onthaal', 'evenementen.overboeken', false);
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await api('POST', pad, { sessieId: latijn.id, forceer: true })).status).toBe(403);
    await zetRecht('onthaal', 'evenementen.overboeken', true);
    env.DEV_BEHEER_EMAIL = BALIE;
    expect((await api('POST', pad, { sessieId: latijn.id, forceer: true })).data).toEqual({ status: 'bevestigd' });
    await wacht();
    expect(mails.map((m) => m.type)).toEqual(['schoolwijziging']);
  });

  test('sessiegever: registreren, aanmelden met code, enkel de eigen sessie', async () => {
    const kunst = sessie(k1, 'kunst').id;
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    expect((await api('POST', '/api/beheer/sessiegevers', { voornaam: 'Gast', naam: 'X', email: 'gast@gmail.com' })).data.velden.email).toBeDefined();
    const m = await api('POST', '/api/beheer/sessiegevers', { voornaam: 'Lies', naam: 'Leraar', email: 'Lies.Leraar@onderwijs.gent.be' });
    expect(m.status).toBe(200);
    sessiegeverId = m.data.id;
    expect((await api('PATCH', `/api/beheer/sessies/${kunst}/sessiegevers`, { sessiegevers: [sessiegeverId] })).data).toEqual({ ok: true });
    const lijst = (await api('GET', `/api/beheer/evenementen/${ev.evenementId}/sessiegevers`)).data;
    expect(lijst.termen).toEqual({ sessiegever: 'lesgever', sessiegevers: 'lesgevers' }); // TERM_SESSIEGEVER uit wrangler.toml
    expect(lijst.sessiegevers.find((x: any) => x.id === sessiegeverId)).toMatchObject({ email: 'lies.leraar@onderwijs.gent.be', sessies: [kunst] });

    // Een deelnemer in het lesje van de sessiegever (de school zet hem erin)
    E = await nieuweDeelnemer('Klas');
    await api('POST', `/api/beheer/deelnemers/${E.id}/sessie`, { sessieId: kunst, forceer: true, verwittig: false });
    await wacht();
    mails = [];

    // Code aanvragen: altijd hetzelfde antwoord, enkel een mail voor een geregistreerd adres
    expect((await sg('POST', '/api/sessiegever/code', { email: 'niemand@onderwijs.gent.be' })).data).toEqual({ ok: true });
    await wacht();
    expect(mails).toHaveLength(0);
    expect((await sg('POST', '/api/sessiegever/code', { email: 'lies.leraar@onderwijs.gent.be' })).data).toEqual({ ok: true });
    await wacht();
    expect(mails.map((x) => x.type)).toEqual(['aanmeldcode']);
    const code = /(\d{3}) (\d{3})/.exec(mails[0].html)!.slice(1).join('');

    expect((await sg('POST', '/api/sessiegever/aanmelden', { email: 'lies.leraar@onderwijs.gent.be', code: code === '000000' ? '111111' : '000000' })).status).toBe(401);
    const aan = await sg('POST', '/api/sessiegever/aanmelden', { email: 'lies.leraar@onderwijs.gent.be', code });
    expect(aan.data).toEqual({ ok: true, voornaam: 'Lies' });
    expect(aan.cookie).toMatch(/^sessiegever=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+/);
    expect((await sg('POST', '/api/sessiegever/aanmelden', { email: 'lies.leraar@onderwijs.gent.be', code })).status).toBe(401); // één keer
    cookie = aan.cookie!.split(';')[0];

    const ik = (await sg('GET', '/api/sessiegever/ik')).data;
    expect(ik.sessies.map((s: any) => s.id)).toEqual([kunst]);
    expect(ik.rechten).toEqual(expect.arrayContaining(['evenementen.inchecken', 'evenementen.sessie_inzien']));
    expect(ik.rechten).not.toContain('evenementen.lesje_wijzigen');

    let tabel = (await sg('GET', `/api/sessiegever/sessies/${kunst}`)).data;
    expect(tabel.vandaag).toBe(true);
    const e = tabel.deelnemers.find((d: any) => d.id === E.id);
    expect(e).toMatchObject({ voornaam: 'Klas', opSchool: false, klas: null, extra: {} });
    expect((await sg('GET', `/api/sessiegever/sessies/${sessie(k1, 'latijn').id}`)).status).toBe(403); // niet de eigen sessie

    // Extra velden: enkel wat de organisator openzet
    await api('PATCH', `/api/beheer/evenementen/${ev.evenementId}/sessiegever-velden`, { velden: ['email', 'onbestaand'] });
    tabel = (await sg('GET', `/api/sessiegever/sessies/${kunst}`)).data;
    expect(tabel.deelnemers.find((d: any) => d.id === E.id).extra).toEqual({ email: expect.stringMatching(/@example\.org$/) });
    await api('PATCH', `/api/beheer/evenementen/${ev.evenementId}/sessiegever-velden`, { velden: [] });

    // In de klas aanduiden: ook aangemeld op school, via de klas
    expect((await sg('POST', `/api/sessiegever/sessies/${kunst}/deelnemers/${E.id}`, { klas: 'aanwezig' }, false)).status).toBe(403); // zonder Origin
    expect((await sg('POST', `/api/sessiegever/sessies/${kunst}/deelnemers/${E.id}`, { klas: 'aanwezig' })).data).toEqual({ ok: true });
    expect(await een(`select aanwezig, aanmeld_via from inschrijvingen where deelnemer_id = ? and sessie_id is null`, E.id)).toEqual({ aanwezig: 1, aanmeld_via: 'klas' });
    env.DEV_BEHEER_EMAIL = BALIE;
    const o = (await api('GET', `/api/beheer/evenementen/${ev.evenementId}/aanwezigheid`)).data;
    expect(o.deelnemers.find((d: any) => d.id === E.id)).toMatchObject({ aanwezig: true, via: 'klas' });

    // Etiket scannen: wie op de lijst staat, wordt aangeduid; wie niet, kan de sessiegever niet toevoegen (standaard)
    expect((await sg('POST', `/api/sessiegever/sessies/${kunst}/scan`, { token: E.token })).data).toMatchObject({ resultaat: 'aangeduid', naam: 'Klas Test' });
    const nietOp = (await sg('POST', `/api/sessiegever/sessies/${kunst}/scan`, { token: A.token, toevoegen: true })).data;
    expect(nietOp).toMatchObject({ resultaat: 'niet_op_lijst', kanToevoegen: false });
    expect(nietOp.lesjes.length).toBeGreaterThan(0);
    expect((await sg('POST', `/api/sessiegever/sessies/${kunst}/scan`, { token: 'y'.repeat(43) })).data).toEqual({ resultaat: 'onbekend' });

    // Afmelden; een verwijderde sessiegever kan niet meer binnen
    expect((await sg('POST', '/api/sessiegever/afmelden')).status).toBe(200);
    expect((await sg('GET', '/api/sessiegever/ik')).status).toBe(401);
    env.DEV_BEHEER_EMAIL = BEHEERDER;
    expect((await api('DELETE', `/api/beheer/sessiegevers/${sessiegeverId}`)).data).toEqual({ ok: true });
    expect(await een(`select count(*) as n from sessie_sessiegevers where sessiegever_id = ?`, sessiegeverId)).toEqual({ n: 0 });
  });
});

describe('historiek: vorige jaren importeren en overzicht', () => {
  let evId: string;
  let schoolId: string;
  const programma = [{
    sleutel: 'd0', naam: 'Zaterdag 25 januari', datum: '2025-01-25',
    dagdelen: [{
      sleutel: 'dd0', naam: 'Voormiddag', start: '10:00', eind: '12:10',
      tijdsblokken: [
        { sleutel: 't0', naam: 'Keuzelesje 1', start: '10:10', eind: '10:50', sessies: [{ sleutel: 's0', titel: 'Domein Kunst' }, { sleutel: 's1', titel: 'Lesje wiskunde' }] },
        { sleutel: 't1', naam: 'Keuzelesje 2', start: '11:30', eind: '12:10', sessies: [{ sleutel: 's2', titel: 'Domein Kunst' }] },
      ],
    }],
  }];

  const HISTORIEK = 'historiek.test@onderwijs.gent.be';

  beforeAll(async () => {
    await sql(`insert or ignore into gebruikers (naam, voornaam, email, rol_id) select 'H', 'T', ?, rol_id from rollen where code = 'platformbeheerder'`, HISTORIEK);
    env.DEV_BEHEER_EMAIL = HISTORIEK;
    schoolId = (await een(`select school_id from scholen order by naam limit 1`)).school_id;
  });

  test('vorig evenement aanmaken: gearchiveerd, bewaren tot moet in de toekomst liggen', async () => {
    expect((await api('POST', '/api/beheer/historiek/evenementen', { schooljaar: '2024-2025', titel: 'X', slug: 'x', bewaarTot: '2020-01-01' })).status).toBe(400);
    const r = await api('POST', '/api/beheer/historiek/evenementen', { schooljaar: '2024-2025', titel: 'Infodagen 2024-2025', slug: 'infodagen-2024-2025', bewaarTot: '2099-08-31' });
    expect(r.status).toBe(201);
    evId = r.data.id;
    expect(await een(`select status, date(eind_datum, '+' || bewaartermijn_dagen || ' days') as tot from evenementen where evenement_id = ?`, evId))
      .toEqual({ status: 'gearchiveerd', tot: '2099-08-31' });
  });

  test('inschrijvingen importeren: programma aangemaakt, laatste inzending telt, opnieuw importeren dubbelt niet', async () => {
    const rijen = [
      { ingediendOp: '2024-12-01T10:00:00+01:00', email: 'hist@example.org', ouderVoornaam: 'Ouder', kindVoornaam: 'An', kindNaam: 'Hist', schoolId, leerjaar: '6de leerjaar', doelgroep: 'A-stroom', dagdeel: 'dd0', sessies: ['s1'] },
      { ingediendOp: '2024-12-05T10:00:00+01:00', email: 'hist@example.org', kindVoornaam: 'An', kindNaam: 'Hist', schoolId, leerjaar: '6de leerjaar', doelgroep: 'A-stroom', dagdeel: 'dd0', sessies: ['s0', 's2'], aanwezig: true },
      { ingediendOp: '2024-12-02T10:00:00+01:00', email: 'hist@example.org', kindVoornaam: 'Bo', kindNaam: 'Hist', schoolAndere: 'Andere school', leerjaar: '5de leerjaar', doelgroep: 'B-stroom', dagdeel: 'dd0', sessies: [], persoonKeuze: 'nieuw' }, // lijkt op An (2 letters verschil): broer
      { email: 'x@example.org', kindVoornaam: 'Zonder', kindNaam: 'Moment' },
    ];
    const c = await api('POST', '/api/beheer/historiek/kinderen', { rijen });
    expect(c.data.map((x: any) => x.status)).toEqual(['nieuw', 'zelfde', 'twijfel', 'geen']);
    expect((await api('POST', `/api/beheer/historiek/evenementen/${evId}/inschrijvingen`, { programma, rijen: rijen.map(({ persoonKeuze: _, ...x }) => x) })).status).toBe(400);
    const r = await api('POST', `/api/beheer/historiek/evenementen/${evId}/inschrijvingen`, { programma, rijen });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ geimporteerd: 2, dubbelInBestand: 1, zonderMoment: 1, lesjes: 2, programma: { dagen: 1, dagdelen: 1, tijdsblokken: 2, sessies: 3 }, nieuweKinderen: 2 });
    // Datums volgen de dag; bewaren tot blijft gelijk.
    expect(await een(`select start_datum, eind_datum, date(eind_datum, '+' || bewaartermijn_dagen || ' days') as tot from evenementen where evenement_id = ?`, evId))
      .toEqual({ start_datum: '2025-01-25', eind_datum: '2025-01-25', tot: '2099-08-31' });
    const an = await een(`select deelnemer_id, created_at from deelnemers where evenement_id = ? and leerjaar = '6de leerjaar' and status = 'actief'`, evId);
    // De oudere inzending van An blijft als geannuleerd (voor de dubbels), met haar lesje.
    expect(await een(`select count(*) as n from deelnemers d join inschrijvingen i on i.deelnemer_id = d.deelnemer_id
      where d.evenement_id = ? and d.leerjaar = '6de leerjaar' and d.status = 'geannuleerd' and i.status = 'geannuleerd'`, evId)).toEqual({ n: 2 });
    expect(an.created_at).toBe('2024-12-05T09:00:00.000Z');
    expect(await een(`select count(*) as n, sum(aanwezig) as a from inschrijvingen where deelnemer_id = ?`, an.deelnemer_id)).toEqual({ n: 3, a: 1 });

    const opnieuw = await api('POST', `/api/beheer/historiek/evenementen/${evId}/inschrijvingen`, { programma, rijen });
    expect(opnieuw.data).toMatchObject({ geimporteerd: 0, vervangen: 0, alIngeschreven: 3, dubbelInBestand: 0, programma: { dagen: 0, sessies: 0 } });

    // Een nieuwere inzending voor een kind dat er al staat, vervangt de vorige (die blijft als geannuleerd).
    const nieuwer = await api('POST', `/api/beheer/historiek/evenementen/${evId}/inschrijvingen`, { programma, rijen: [
      { ingediendOp: '2025-01-10T10:00:00+01:00', email: 'hist@example.org', kindVoornaam: 'Bo', kindNaam: 'Hist', leerjaar: '5de leerjaar', doelgroep: 'A-stroom', dagdeel: 'dd0', sessies: ['s1'] },
    ] });
    expect(nieuwer.data).toMatchObject({ geimporteerd: 0, vervangen: 1 });
    expect(await een(`select count(*) as n, sum(status = 'actief') as actief from deelnemers where evenement_id = ? and leerjaar = '5de leerjaar'`, evId)).toEqual({ n: 2, actief: 1 });
  });

  test('sessiegevers importeren: per adres één, gekoppeld op titel, buiten het domein overgeslagen', async () => {
    const r = await api('POST', `/api/beheer/historiek/evenementen/${evId}/sessiegevers`, { rijen: [
      { voornaam: 'Kim', naam: 'Kunst', email: 'kim.kunst@onderwijs.gent.be', lesjes: 'Domein Kunst; Bestaat niet' },
      { voornaam: 'Ext', naam: 'Ern', email: 'ext@example.org', lesjes: 'Domein Kunst' },
    ] });
    expect(r.data).toMatchObject({ nieuw: 1, gekoppeld: 2, buitenDomein: 1, lesjesNietGevonden: ['Bestaat niet'] });
    expect(await een(`select count(*) as n from sessies s join sessie_sessiegevers sg on sg.sessie_id = s.sessie_id where s.titel = 'Domein Kunst' and s.lesgever = 'Kim Kunst'`)).toEqual({ n: 2 });
  });

  test('voorinschrijving aan het evenement koppelen; overzicht met historiek en broer of zus', async () => {
    const v = await api('POST', '/api/beheer/voorinschrijvingen/importen', {
      naam: 'Voor 2024-2025', evenementId: evId,
      rijen: [{ ingediendOp: '2024-03-01T10:00:00', klas: '5de leerjaar', schoolId, kindVoornaam: 'An', kindNaam: 'Hist', email: 'hist@example.org' },
        { ingediendOp: '2024-03-02T10:00:00', klas: '5de leerjaar', schoolId, kindVoornaam: 'Cas', kindNaam: 'Anders', email: 'anders@example.org' }],
    });
    expect(v.status).toBe(201);
    const o = await api('GET', `/api/beheer/historiek/evenementen/${evId}/overzicht`);
    expect(o.status).toBe(200);
    expect(o.data.evenement).toMatchObject({ schooljaar: '2024-2025' });
    const an = o.data.inschrijvingen.find((x: any) => x.voornaam === 'An' && x.status === 'actief');
    expect(an).toMatchObject({ voorinschrijving: true, lesjes: [{ titel: 'Domein Kunst' }, { titel: 'Domein Kunst' }], momenten: [{ aanwezig: true }] });
    expect(o.data.voorinschrijvingen.map((x: any) => x.ingeschreven).sort()).toEqual([false, true]);
    expect(o.data.gezinnen[an.contactId]).toHaveLength(2); // An en Bo
    expect(o.data.historiek[an.persoonId].map((x: any) => [x.soort, !!x.geannuleerd])).toEqual([['voorinschrijving', false], ['inschrijving', true], ['inschrijving', false]]);

    // Dubbels: de vervangen inschrijving van Bo is zichtbaar (geannuleerd, met haar moment) en kan terug gekozen worden.
    const bo = o.data.inschrijvingen.filter((x: any) => x.voornaam === 'Bo');
    expect(bo.map((x: any) => x.status).sort()).toEqual(['actief', 'geannuleerd']);
    expect(bo.every((x: any) => x.momenten.length === 1 && x.email === 'hist@example.org')).toBe(true);
    const oud = bo.find((x: any) => x.status === 'geannuleerd');
    const nieuw = bo.find((x: any) => x.status === 'actief');
    expect((await api('POST', `/api/beheer/historiek/evenementen/${evId}/dubbels/samenvoegen`, { behoud: oud.id, weg: [nieuw.id] })).data).toEqual({ ok: true, geannuleerd: 1 });
    expect(await een(`select status from deelnemers where deelnemer_id = ?`, oud.id)).toEqual({ status: 'actief' });
    expect(await een(`select count(*) as n from inschrijvingen where deelnemer_id = ? and status = 'bevestigd'`, oud.id)).toEqual({ n: 1 });
    expect((await api('POST', `/api/beheer/historiek/evenementen/${evId}/dubbels/samenvoegen`, { behoud: oud.id, weg: [crypto.randomUUID()] })).status).toBe(403);

    const m = await api('POST', `/api/beheer/historiek/evenementen/${evId}/dubbels/mail`, { deelnemers: [oud.id, nieuw.id], onderwerp: 'Vraag', tekst: 'Dag,\n\nWelke klopt?' });
    expect(m.data).toEqual({ verstuurd: 1, mislukt: 0, aan: ['hist@example.org'] });

    // Een organisator zonder toegang tot dit evenement ziet het niet.
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'organisator') where email = ?`, HISTORIEK);
    expect((await api('GET', `/api/beheer/historiek/evenementen/${evId}/overzicht`)).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, HISTORIEK);
  });
});

describe('contactenlijst', () => {
  const PLATFORM = 'historiek.test@onderwijs.gent.be'; // platformbeheerder uit de historiek-tests
  const zet = (rol: string, recht: string, toegestaan: boolean) => api('PATCH', '/api/beheer/rollen-rechten', { rol, recht, toegestaan });
  beforeAll(() => {
    env.DEV_BEHEER_EMAIL = PLATFORM;
  });

  test('standaard enkel medewerkers en lesgevers, met waar ze voorkomen', async () => {
    const r = await api('GET', '/api/beheer/contacten');
    expect(r.status).toBe(200);
    expect(r.data.extern).toBe(false);
    const kim = r.data.contacten.find((c: any) => c.email === 'kim.kunst@onderwijs.gent.be');
    expect(kim.soorten).toEqual(['Lesgever']);
    expect(kim.vermeldingen.map((v: any) => v.omschrijving)).toEqual(expect.arrayContaining([expect.stringContaining('Infodagen 2024-2025 · Domein Kunst')]));
    expect(r.data.contacten.find((c: any) => c.email === PLATFORM)).toMatchObject({ naam: 'T H', soorten: ['Medewerker'] });
    expect(r.data.contacten.some((c: any) => c.extern)).toBe(false);
  });

  test('ouders na het aanzetten in Rollen en rechten: één contact, kinderen eronder', async () => {
    expect((await zet('platformbeheerder', 'meldingen.beheren', false)).status).toBe(400); // niet instelbaar voor de platformbeheerder
    const raster = await zet('platformbeheerder', 'kern.contacten.extern', true);
    expect(raster.data.rechten.find((x: any) => x.recht === 'kern.contacten.extern').per.platformbeheerder).toMatchObject({ toegestaan: true, standaard: false, vast: false });
    const r = await api('GET', '/api/beheer/contacten');
    expect(r.data.extern).toBe(true);
    const gezin = r.data.contacten.find((c: any) => c.email === 'hist@example.org');
    expect(gezin.soorten).toEqual(expect.arrayContaining(['Inschrijving', 'Voorinschrijving']));
    expect(gezin.personen.map((p: any) => p.naam).sort()).toEqual(['An Hist', 'Bo Hist']);
    expect(gezin.personen.find((p: any) => p.naam === 'An Hist').vermeldingen.map((v: any) => v.soort)).toEqual(expect.arrayContaining(['Inschrijving', 'Voorinschrijving']));
    await zet('platformbeheerder', 'kern.contacten.extern', false);
  });

  test('contacten plakken: in een groep, bestaande naam blijft, buiten de organisatie enkel bij ouders; uit de groep halen', async () => {
    const r = await api('POST', '/api/beheer/contacten/toevoegen', { groep: 'Leerkrachten FMG', rijen: [
      { voornaam: 'Stijn', naam: 'De Schepper', email: 'Stijn.DeSchepper@onderwijs.gent.be' },
      { voornaam: 'Kim', naam: 'Anders', email: 'kim.kunst@onderwijs.gent.be' }, // bestaat als lesgever, nog geen contact
      { voornaam: 'Extern', naam: 'Iemand', email: 'iemand@example.org' },
      { voornaam: 'Fout', naam: 'Adres', email: 'geen-adres' },
    ] });
    expect(r.data).toEqual({ groep: 'Leerkrachten FMG', nieuw: 3, bestaand: 0, ongeldig: 1, buitenOrganisatie: 1 });
    const l = (await api('GET', '/api/beheer/contacten')).data.contacten;
    const stijn = l.find((c: any) => c.email === 'stijn.deschepper@onderwijs.gent.be');
    expect(stijn).toMatchObject({ naam: 'Stijn De Schepper', soorten: ['Contact'], vermeldingen: [{ soort: 'Contact', omschrijving: 'Leerkrachten FMG' }] });
    expect(l.find((c: any) => c.email === 'kim.kunst@onderwijs.gent.be')).toMatchObject({ naam: 'Kim Kunst', soorten: expect.arrayContaining(['Lesgever', 'Contact']) });
    expect(l.some((c: any) => c.email === 'iemand@example.org')).toBe(false); // ouders en inschrijvers staan uit

    // Opnieuw plakken met een andere naam: het contact bestaat, de naam blijft.
    expect((await api('POST', '/api/beheer/contacten/toevoegen', { rijen: [{ voornaam: 'S', naam: 'X', email: 'stijn.deschepper@onderwijs.gent.be' }] })).data)
      .toMatchObject({ groep: 'Met de hand toegevoegd', nieuw: 0, bestaand: 1 });
    expect((await api('POST', '/api/beheer/contacten/uit-groep', { id: stijn.id, groep: 'Leerkrachten FMG' })).data).toEqual({ ok: true });
    const na = (await api('GET', '/api/beheer/contacten')).data.contacten.find((c: any) => c.id === stijn.id);
    expect(na).toMatchObject({ naam: 'Stijn De Schepper', vermeldingen: [{ omschrijving: 'Met de hand toegevoegd' }] });
  });

  test('lesgevers toevoegen zonder evenement', async () => {
    const r = await api('POST', '/api/beheer/sessiegevers/toevoegen', { rijen: [
      { voornaam: 'Stijn', naam: 'De Schepper', email: 'stijn.deschepper@onderwijs.gent.be' },
      { voornaam: 'Kim', naam: 'Kunst', email: 'kim.kunst@onderwijs.gent.be' },
      { voornaam: 'Ext', naam: 'Ern', email: 'ext@example.org' },
    ] });
    expect(r.data).toEqual({ nieuw: 1, bestaand: 1, buitenDomein: 1, ongeldig: 0 });
    const stijn = (await api('GET', '/api/beheer/contacten')).data.contacten.find((c: any) => c.email === 'stijn.deschepper@onderwijs.gent.be');
    expect(stijn.soorten).toEqual(expect.arrayContaining(['Lesgever', 'Contact']));
  });

  test('een organisator zonder het recht ziet de lijst niet', async () => {
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'organisator') where email = ?`, PLATFORM);
    expect((await api('GET', '/api/beheer/contacten')).status).toBe(403);
    await sql(`update gebruikers set rol_id = (select rol_id from rollen where code = 'platformbeheerder') where email = ?`, PLATFORM);
  });
});
