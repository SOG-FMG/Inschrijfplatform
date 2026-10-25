import { ontsleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { evenementVanDeelnemer, kenSessieToe } from './beheer';
import { plaatshouders, referentie, vandaag } from './capaciteit';
import { evenementVanSessie, EXTRA_VELDEN, type ExtraVeld } from './sessiegevers';

/**
 * Aanwezigheid op de dag zelf (Plan_Checkin_en_Aanwezigheid.md):
 *   - de scan van de QR-code aan het onthaal: één resultaat met een kleur (rood, blauw, geel, groen)
 *   - aanwezig zetten: met QR, aan de balie, of in de klas door de sessiegever
 *   - het overzicht voor het onthaal, de keuze van een ander lesje, en de tabel van één sessie
 * Wie handelt, is een medewerker (Gebruiker) of een sessiegever; voor het auditlog en "aangemeld door".
 */

export type Actor = { soort: 'medewerker'; g: Gebruiker } | { soort: 'sessiegever'; id: string; rechten: string[] };

const gebruikerVan = (a: Actor) => (a.soort === 'medewerker' ? a.g : null);
const doorVan = (a: Actor) => (a.soort === 'medewerker' ? a.g.gebruikerId : `sessiegever:${a.id}`);
const heeft = (a: Actor, recht: string) => (a.soort === 'medewerker' ? a.g.rechten : a.rechten).includes(recht);
const isoNu = () => new Date().toISOString();

/** Medewerker: het recht én toegang tot het evenement (lezen volstaat; het recht bepaalt wat mag). */
export async function vereisMedewerker(env: Env, g: Gebruiker, evenementId: string, recht: string) {
  if (!g.rechten.includes(recht)) throw new DbFout('GEEN_TOEGANG');
  await controleerToegang(env, g, evenementId);
}

/** Uur in België als minuten na middernacht. */
function minutenNu(): number {
  const [u, m] = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return u * 60 + m;
}
const minuten = (uur: string) => Number(uur.slice(0, 2)) * 60 + Number(uur.slice(3, 5));
/** Zo lang vóór het begin van een dagdeel is aankomen nog "op tijd". */
const VROEG_MINUTEN = 60;

// ---------------------------------------------------------------------------
// De scan aan het onthaal
// ---------------------------------------------------------------------------

export type Kleur = 'rood' | 'blauw' | 'geel' | 'groen';

interface Rij {
  inschrijving_id: string;
  dagdeel_id: string;
  sessie_id: string | null;
  datum: string;
  dag: string;
  dagdeel: string;
  start_uur: string;
  eind_uur: string;
  status: string;
  aanwezig: number;
  checkin_datum: string | null;
  aanmeld_via: string | null;
  titel: string | null;
  tijdsblok: string | null;
  tijdsblok_start: string | null;
  lokaal: string | null;
}

async function rijenVan(env: Env, deelnemerId: string): Promise<Rij[]> {
  const { results } = await env.DB.prepare(
    `select i.inschrijving_id, i.dagdeel_id, i.sessie_id, d.datum, d.naam as dag, dd.naam as dagdeel, dd.start_uur, dd.eind_uur, i.status,
            i.aanwezig, i.checkin_datum, i.aanmeld_via, s.titel, t.naam as tijdsblok, t.start_uur as tijdsblok_start, coalesce(l.lokaal, l.naam) as lokaal
     from inschrijvingen i join evenement_dagen d on d.dag_id = i.dag_id join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
     left join sessies s on s.sessie_id = i.sessie_id left join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
     left join locaties l on l.locatie_id = s.locatie_id
     where i.deelnemer_id = ? and i.status <> 'geannuleerd'
     order by d.datum, dd.start_uur, t.start_uur`,
  )
    .bind(deelnemerId)
    .all<Rij>();
  return results;
}

/** Het resultaat van een scan, zonder iets te registreren. `versie`: uit de QR-code (null = ontbreekt). */
export async function scanResultaat(env: Env, g: Gebruiker, token: string, versie: number | null) {
  if (!g.rechten.includes('evenementen.inchecken')) throw new DbFout('GEEN_TOEGANG');
  const dn = await env.DB.prepare(
    `select dn.deelnemer_id, dn.evenement_id, dn.status, dn.geanonimiseerd_op, dn.voornaam_enc, dn.naam_enc, dn.checkin_versie,
            dn.gewijzigd_op, dn.gewijzigd_door, e.titel
     from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id where dn.checkin_token = ?`,
  )
    .bind(token)
    .first<{
      deelnemer_id: string; evenement_id: string; status: string; geanonimiseerd_op: string | null; voornaam_enc: string | null;
      naam_enc: string | null; checkin_versie: number; gewijzigd_op: string | null; gewijzigd_door: string | null; titel: string;
    }>();
  if (!dn) return { kleur: 'rood' as Kleur, code: 'ONBEKEND', melding: 'Geen geldige inschrijving. Stuur de bezoeker naar de balie.' };
  await controleerToegang(env, g, dn.evenement_id);

  const basis = {
    deelnemer: {
      id: dn.deelnemer_id,
      referentie: referentie(dn.deelnemer_id),
      voornaam: (await ontsleutel(env, dn.voornaam_enc)) ?? '',
      naam: (await ontsleutel(env, dn.naam_enc)) ?? '',
    },
    evenement: { id: dn.evenement_id, titel: dn.titel },
    gewijzigd: { op: dn.gewijzigd_op, door: dn.gewijzigd_door },
    versie: { qr: versie, huidig: dn.checkin_versie },
  };
  if (dn.status !== 'actief' || dn.geanonimiseerd_op) {
    return { ...basis, kleur: 'rood' as Kleur, code: 'GEANNULEERD', melding: 'Deze inschrijving is geannuleerd. Stuur de bezoeker naar de balie.', momenten: [], keuzes: [] };
  }

  const rijen = await rijenVan(env, dn.deelnemer_id);
  const momenten = rijen.filter((r) => !r.sessie_id).map((r) => ({
    dagdeelId: r.dagdeel_id, dag: r.dag, datum: r.datum, dagdeel: r.dagdeel, startUur: r.start_uur, eindUur: r.eind_uur,
    aanwezig: r.aanwezig === 1, op: r.checkin_datum, via: r.aanmeld_via,
  }));
  const keuzes = rijen.filter((r) => r.sessie_id).map((r) => ({
    sessieId: r.sessie_id!, dagdeelId: r.dagdeel_id, datum: r.datum, titel: r.titel, tijdsblok: r.tijdsblok, startUur: r.tijdsblok_start, lokaal: r.lokaal, status: r.status,
  }));
  const res = (kleur: Kleur, code: string, melding: string) => ({ ...basis, kleur, code, melding, momenten, keuzes });

  const dag = vandaag();
  const vandaagMomenten = momenten.filter((m) => m.datum === dag);
  if (!vandaagMomenten.length) {
    const wanneer = [...new Set(momenten.map((m) => m.dag))].join(', ');
    return res('rood', 'ANDERE_DAG', wanneer ? `Ingeschreven voor ${wanneer}, niet voor vandaag. Stuur de bezoeker naar de balie.` : 'Niet ingeschreven voor vandaag.');
  }
  const al = vandaagMomenten.find((m) => m.aanwezig);
  if (al) return res('blauw', 'AL_AANGEMELD', 'Al aangemeld.');
  if (versie == null || versie < dn.checkin_versie) {
    return res('geel', 'OUDE_MAIL', 'Deze QR-code komt uit een oudere mail. Kijk de huidige lesjes na.');
  }
  const nu = minutenNu();
  if (!vandaagMomenten.some((m) => nu >= minuten(m.startUur) - VROEG_MINUTEN && nu <= minuten(m.eindUur))) {
    return res('geel', 'ANDER_DAGDEEL', `Ingeschreven voor ${vandaagMomenten.map((m) => `${m.dagdeel} (${m.startUur} – ${m.eindUur})`).join(', ')}.`);
  }
  const wacht = keuzes.filter((k) => k.datum === dag && k.status === 'wachtlijst');
  if (wacht.length) return res('geel', 'WACHTLIJST', `Op de wachtlijst voor: ${wacht.map((k) => k.titel).join(', ')}. Kies een ander lesje.`);
  return res('groen', 'OK', 'In orde.');
}

/** Deelnemer bij een check-intoken; GEEN_TOEGANG als die niet bestaat (zelfde antwoord als zonder rechten). */
export async function deelnemerVanToken(env: Env, token: string): Promise<string> {
  const r = await env.DB.prepare(`select deelnemer_id from deelnemers where checkin_token = ? and status = 'actief' and geanonimiseerd_op is null`)
    .bind(token)
    .first<{ deelnemer_id: string }>();
  if (!r) throw new DbFout('GEEN_TOEGANG');
  return r.deelnemer_id;
}

/**
 * Aanwezig op school: de dagdelen van vandaag. Enkel wie nog niet aangemeld was (twee scans tegelijk: één wint).
 * Geeft het aantal gewijzigde rijen terug (0 = was al aangemeld).
 */
export async function zetAanwezig(env: Env, actor: Actor, deelnemerId: string, via: 'qr' | 'balie' | 'klas', ip: string | null, dagdeelId?: string) {
  const db = env.DB;
  const r = await db
    .prepare(
      `update inschrijvingen set aanwezig = 1, checkin_datum = ?, aanmeld_via = ?, aangemeld_door = ?
       where deelnemer_id = ? and sessie_id is null and status <> 'geannuleerd' and aanwezig = 0
         and ${dagdeelId ? 'dagdeel_id = ?' : `dag_id in (select dag_id from evenement_dagen where datum = ?)`}`,
    )
    .bind(isoNu(), via, doorVan(actor), deelnemerId, dagdeelId ?? vandaag())
    .run();
  if (r.meta.changes) await audit(env, gebruikerVan(actor), 'deelnemers', deelnemerId, 'AANWEZIG', { via, ...(actor.soort === 'sessiegever' ? { sessiegever: actor.id } : {}) }, ip).run();
  return r.meta.changes;
}

/** Aanmelding ongedaan maken (dagdelen van vandaag). */
export async function zetAfwezig(env: Env, actor: Actor, deelnemerId: string, ip: string | null) {
  await env.DB.batch([
    env.DB.prepare(
      `update inschrijvingen set aanwezig = 0, checkin_datum = null, aanmeld_via = null, aangemeld_door = null
       where deelnemer_id = ? and sessie_id is null and dag_id in (select dag_id from evenement_dagen where datum = ?)`,
    ).bind(deelnemerId, vandaag()),
    audit(env, gebruikerVan(actor), 'deelnemers', deelnemerId, 'NIET_AANWEZIG', undefined, ip),
  ]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Overzicht voor het onthaal
// ---------------------------------------------------------------------------

export async function overzicht(env: Env, g: Gebruiker, evenementId: string, dagId: string | null) {
  await vereisMedewerker(env, g, evenementId, 'evenementen.overzicht_aanwezigen');
  const db = env.DB;
  const ev = await db.prepare(`select titel from evenementen where evenement_id = ?`).bind(evenementId).first<{ titel: string }>();
  const dagen = (await db.prepare(`select dag_id as id, naam, datum from evenement_dagen where evenement_id = ? and status = 'actief' order by datum`).bind(evenementId).all<{ id: string; naam: string; datum: string }>()).results;
  const dag = dagen.find((d) => d.id === dagId) ?? dagen.find((d) => d.datum === vandaag()) ?? dagen.find((d) => d.datum > vandaag()) ?? dagen[dagen.length - 1];
  if (!ev || !dag) return { evenement: ev?.titel ?? '', dagen, dag: null, dagdelen: [], deelnemers: [] };

  const [dagdelen, rijen, lesjes] = await db.batch<any>([
    db.prepare(`select dagdeel_id as id, naam, start_uur as startUur, eind_uur as eindUur from dagdelen where dag_id = ? and status = 'actief' order by start_uur`).bind(dag.id),
    db.prepare(
      `select i.deelnemer_id, i.dagdeel_id, i.aanwezig, i.checkin_datum, i.aanmeld_via, dn.voornaam_enc, dn.naam_enc, dn.leerjaar,
              dn.checkin_token is not null as heeft_qr, coalesce(sc.naam, '') as school, dn.school_andere_enc
       from inschrijvingen i join deelnemers dn on dn.deelnemer_id = i.deelnemer_id left join scholen sc on sc.school_id = dn.school_id
       where i.dag_id = ? and i.sessie_id is null and i.status <> 'geannuleerd' and dn.status = 'actief' and dn.geanonimiseerd_op is null`,
    ).bind(dag.id),
    db.prepare(
      `select i.deelnemer_id, s.sessie_id, s.titel, t.naam as tijdsblok, t.start_uur as startUur, i.status, i.klas_status
       from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
       where i.dag_id = ? and i.status <> 'geannuleerd' order by t.start_uur`,
    ).bind(dag.id),
  ]);
  const perDeelnemer = new Map<string, any[]>();
  for (const l of lesjes.results as any[]) perDeelnemer.set(l.deelnemer_id, [...(perDeelnemer.get(l.deelnemer_id) ?? []), {
    sessieId: l.sessie_id, titel: l.titel, tijdsblok: l.tijdsblok, startUur: l.startUur, status: l.status, klas: l.klas_status,
  }]);
  const deelnemers = await Promise.all(
    (rijen.results as any[]).map(async (r) => ({
      id: r.deelnemer_id,
      referentie: referentie(r.deelnemer_id),
      voornaam: (await ontsleutel(env, r.voornaam_enc)) ?? '',
      naam: (await ontsleutel(env, r.naam_enc)) ?? '',
      school: r.school || ((await ontsleutel(env, r.school_andere_enc)) ?? ''),
      leerjaar: r.leerjaar ?? '',
      dagdeelId: r.dagdeel_id,
      aanwezig: r.aanwezig === 1,
      op: r.checkin_datum,
      via: r.aanmeld_via,
      heeftQr: r.heeft_qr === 1,
      lesjes: perDeelnemer.get(r.deelnemer_id) ?? [],
    })),
  );
  const nl = new Intl.Collator('nl', { sensitivity: 'base' });
  deelnemers.sort((a, b) => nl.compare(a.naam, b.naam) || nl.compare(a.voornaam, b.voornaam));
  return {
    evenement: ev.titel,
    dagen,
    dag,
    dagdelen: (dagdelen.results as any[]).map((d) => ({
      ...d,
      totaal: deelnemers.filter((x) => x.dagdeelId === d.id).length,
      aanwezig: deelnemers.filter((x) => x.dagdeelId === d.id && x.aanwezig).length,
    })),
    deelnemers,
    rechten: {
      lesjeWijzigen: g.rechten.includes('evenementen.lesje_wijzigen'),
      overboeken: g.rechten.includes('evenementen.overboeken'),
      inchecken: g.rechten.includes('evenementen.inchecken'),
    },
  };
}

/** Per tijdsblok van de eigen dagdelen: de lesjes met bezetting, het gekozen lesje aangeduid. */
export async function lesOpties(env: Env, actor: Actor, deelnemerId: string) {
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, true);
  if (actor.soort === 'medewerker') await vereisMedewerker(env, actor.g, evenementId, 'evenementen.lesje_wijzigen');
  else if (!heeft(actor, 'evenementen.lesje_wijzigen')) throw new DbFout('GEEN_TOEGANG');
  const db = env.DB;
  const [dn, dagdelen, gekozen] = await db.batch<any>([
    db.prepare(`select doelgroep_id from deelnemers where deelnemer_id = ?`).bind(deelnemerId),
    db.prepare(
      `select distinct i.dagdeel_id, d.naam as dag, dd.naam as dagdeel from inschrijvingen i join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
       join evenement_dagen d on d.dag_id = i.dag_id where i.deelnemer_id = ? and i.sessie_id is null and i.status <> 'geannuleerd'`,
    ).bind(deelnemerId),
    db.prepare(`select tijdsblok_id, sessie_id, status from inschrijvingen where deelnemer_id = ? and sessie_id is not null and status <> 'geannuleerd'`).bind(deelnemerId),
  ]);
  const ids = (dagdelen.results as any[]).map((d) => d.dagdeel_id);
  if (!ids.length) return { blokken: [] };
  const doelgroep = dn.results[0]?.doelgroep_id ?? null;
  const { results } = await db.prepare(
    `select t.tijdsblok_id, t.naam as tijdsblok, t.start_uur, t.eind_uur, t.dagdeel_id, s.sessie_id, s.titel, s.beschrijving, s.capaciteit,
            s.wachtlijst_toegelaten, s.status, s.doelgroep_id, coalesce(l.lokaal, l.naam) as lokaal, s.lesgever,
            (select count(*) from inschrijvingen b where b.sessie_id = s.sessie_id and b.status = 'bevestigd') as bevestigd,
            (select count(*) from inschrijvingen b where b.sessie_id = s.sessie_id and b.status = 'wachtlijst') as wachtlijst
     from tijdsblokken t join sessies s on s.tijdsblok_id = t.tijdsblok_id left join locaties l on l.locatie_id = s.locatie_id
     where t.type = 'keuze' and t.dagdeel_id in (${plaatshouders(ids.length)}) and s.status <> 'geannuleerd'
     order by t.start_uur, s.volgorde, s.titel`,
  )
    .bind(...ids)
    .all<any>();
  const keuze = new Map((gekozen.results as any[]).map((k) => [k.tijdsblok_id, k]));
  const blokken = new Map<string, any>();
  for (const r of results) {
    if (r.doelgroep_id && doelgroep && r.doelgroep_id !== doelgroep) continue;
    const dd = (dagdelen.results as any[]).find((d) => d.dagdeel_id === r.dagdeel_id);
    const b = blokken.get(r.tijdsblok_id) ?? { id: r.tijdsblok_id, naam: r.tijdsblok, startUur: r.start_uur, eindUur: r.eind_uur, dag: dd?.dag, dagdeel: dd?.dagdeel, sessies: [] as any[] };
    b.sessies.push({
      id: r.sessie_id, titel: r.titel, beschrijving: r.beschrijving, lokaal: r.lokaal, lesgever: r.lesgever, capaciteit: r.capaciteit,
      bevestigd: r.bevestigd, wachtlijst: r.wachtlijst, open: r.status === 'open',
      vol: r.capaciteit != null && r.bevestigd >= r.capaciteit,
      gekozen: keuze.get(r.tijdsblok_id)?.sessie_id === r.sessie_id ? keuze.get(r.tijdsblok_id).status : null,
    });
    blokken.set(r.tijdsblok_id, b);
  }
  return { blokken: [...blokken.values()] };
}

/** Ander lesje kiezen vanuit de aanwezigheid (onthaal) of de tabel van een sessie. Overboeken vraagt een eigen recht. */
export async function wijzigLesje(env: Env, actor: Actor, deelnemerId: string, sessieId: string, forceer: boolean) {
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, true);
  if (actor.soort === 'medewerker') await vereisMedewerker(env, actor.g, evenementId, 'evenementen.lesje_wijzigen');
  else if (!heeft(actor, 'evenementen.lesje_wijzigen')) throw new DbFout('GEEN_TOEGANG');
  if (forceer && !heeft(actor, 'evenementen.overboeken')) throw new DbFout('GEEN_TOEGANG');
  return kenSessieToe(env, gebruikerVan(actor), deelnemerId, sessieId, forceer, true);
}

// ---------------------------------------------------------------------------
// De tabel van één sessie (sessiegever of medewerker)
// ---------------------------------------------------------------------------

/** Rechtencontrole voor een medewerker op een sessie. */
export async function vereisMedewerkerVoorSessie(env: Env, g: Gebruiker, sessieId: string, recht: string) {
  await vereisMedewerker(env, g, await evenementVanSessie(env, sessieId), recht);
}

export async function sessieTabel(env: Env, sessieId: string) {
  const db = env.DB;
  const s = await db.prepare(
    `select s.sessie_id as id, s.titel, s.beschrijving, s.capaciteit, s.lesgever, coalesce(l.lokaal, l.naam) as lokaal, t.naam as tijdsblok,
            t.start_uur as startUur, t.eind_uur as eindUur, t.dagdeel_id as dagdeelId, d.naam as dag, d.datum, e.titel as evenement,
            e.evenement_id as evenementId, e.sessiegever_velden as velden
     from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
     join evenement_dagen d on d.dag_id = dd.dag_id join evenementen e on e.evenement_id = d.evenement_id
     left join locaties l on l.locatie_id = s.locatie_id where s.sessie_id = ?`,
  )
    .bind(sessieId)
    .first<any>();
  if (!s) throw new DbFout('GEEN_TOEGANG');
  const velden = (JSON.parse(s.velden ?? '[]') as string[]).filter((v): v is ExtraVeld => v in EXTRA_VELDEN);
  const { results } = await db.prepare(
    `select i.deelnemer_id, i.status, i.klas_status, i.klas_op, dn.voornaam_enc, dn.naam_enc, dn.leerjaar, coalesce(sc.naam, '') as school,
            dn.school_andere_enc, dn.email_enc, dn.contact_voornaam_enc, dn.contact_naam_enc, dn.telefoon_enc, dn.opmerkingen_enc,
            dd.aanwezig, dd.aanmeld_via, dd.checkin_datum
     from inschrijvingen i join deelnemers dn on dn.deelnemer_id = i.deelnemer_id left join scholen sc on sc.school_id = dn.school_id
     left join inschrijvingen dd on dd.deelnemer_id = i.deelnemer_id and dd.dagdeel_id = i.dagdeel_id and dd.sessie_id is null and dd.status <> 'geannuleerd'
     where i.sessie_id = ? and i.status <> 'geannuleerd' and dn.status = 'actief' and dn.geanonimiseerd_op is null`,
  )
    .bind(sessieId)
    .all<any>();
  const o = (x: string | null) => ontsleutel(env, x);
  const deelnemers = await Promise.all(
    results.map(async (r) => {
      const extra: Record<string, string> = {};
      // Enkel de velden die de organisator openzette, worden ontsleuteld en verstuurd.
      if (velden.includes('email')) extra.email = (await o(r.email_enc)) ?? '';
      if (velden.includes('contact')) extra.contact = [await o(r.contact_voornaam_enc), await o(r.contact_naam_enc)].filter(Boolean).join(' ');
      if (velden.includes('telefoon')) extra.telefoon = (await o(r.telefoon_enc)) ?? '';
      if (velden.includes('opmerkingen')) extra.opmerkingen = (await o(r.opmerkingen_enc)) ?? '';
      return {
        id: r.deelnemer_id,
        voornaam: (await o(r.voornaam_enc)) ?? '',
        naam: (await o(r.naam_enc)) ?? '',
        school: r.school || ((await o(r.school_andere_enc)) ?? ''),
        leerjaar: r.leerjaar ?? '',
        status: r.status as 'bevestigd' | 'wachtlijst',
        opSchool: r.aanwezig === 1,
        via: r.aanmeld_via as string | null,
        op: r.checkin_datum as string | null,
        klas: r.klas_status as 'aanwezig' | 'afwezig' | null,
        extra,
      };
    }),
  );
  const nl = new Intl.Collator('nl', { sensitivity: 'base' });
  deelnemers.sort((a, b) => nl.compare(a.naam, b.naam) || nl.compare(a.voornaam, b.voornaam));
  const { velden: _v, ...sessie } = s;
  return {
    sessie: { ...sessie, bevestigd: deelnemers.filter((d) => d.status === 'bevestigd').length },
    velden: velden.map((id) => ({ id, label: EXTRA_VELDEN[id] })),
    vandaag: s.datum === vandaag(),
    deelnemers,
  };
}

/** Wat de sessiegever in de klas aanduidt. "In het lesje" meldt de deelnemer ook aan op school (via 'klas'). */
export async function zetKlas(env: Env, actor: Actor, sessieId: string, deelnemerId: string, klas: unknown, ip: string | null) {
  if (klas !== 'aanwezig' && klas !== 'afwezig' && klas !== null) throw new ValidatieFout({ klas: 'Ongeldige keuze.' });
  const rij = await env.DB.prepare(`select dagdeel_id from inschrijvingen where sessie_id = ? and deelnemer_id = ? and status <> 'geannuleerd'`)
    .bind(sessieId, deelnemerId)
    .first<{ dagdeel_id: string }>();
  if (!rij) throw new DbFout('GEEN_TOEGANG');
  await env.DB.batch([
    env.DB.prepare(`update inschrijvingen set klas_status = ?, klas_door = ?, klas_op = ? where sessie_id = ? and deelnemer_id = ? and status <> 'geannuleerd'`)
      .bind(klas, klas ? doorVan(actor) : null, klas ? isoNu() : null, sessieId, deelnemerId),
    audit(env, gebruikerVan(actor), 'deelnemers', deelnemerId, 'KLAS', { sessieId, klas, ...(actor.soort === 'sessiegever' ? { sessiegever: actor.id } : {}) }, ip),
  ]);
  if (klas === 'aanwezig') await zetAanwezig(env, actor, deelnemerId, 'klas', ip, rij.dagdeel_id);
  return { ok: true };
}

/**
 * Etiket gescand in de tabel van een sessie. Staat de deelnemer op de lijst: meteen "in het lesje". Zo niet: wie het is
 * en voor welke lesjes die ingeschreven is; met `toevoegen` (en het recht evenementen.lesje_wijzigen) in dit lesje zetten.
 */
export async function scanInSessie(env: Env, actor: Actor, sessieId: string, token: unknown, toevoegen: boolean, ip: string | null) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { resultaat: 'onbekend' as const };
  const dn = await env.DB.prepare(
    `select dn.deelnemer_id, dn.voornaam_enc, dn.naam_enc from deelnemers dn
     where dn.checkin_token = ? and dn.status = 'actief' and dn.geanonimiseerd_op is null
       and dn.evenement_id = (select d.evenement_id from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
                              join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id where s.sessie_id = ?)`,
  )
    .bind(token, sessieId)
    .first<{ deelnemer_id: string; voornaam_enc: string | null; naam_enc: string | null }>();
  if (!dn) return { resultaat: 'onbekend' as const };
  const naam = `${(await ontsleutel(env, dn.voornaam_enc)) ?? ''} ${(await ontsleutel(env, dn.naam_enc)) ?? ''}`.trim();
  const opLijst = await env.DB.prepare(`select 1 from inschrijvingen where sessie_id = ? and deelnemer_id = ? and status <> 'geannuleerd'`).bind(sessieId, dn.deelnemer_id).first();
  if (opLijst) {
    await zetKlas(env, actor, sessieId, dn.deelnemer_id, 'aanwezig', ip);
    return { resultaat: 'aangeduid' as const, deelnemerId: dn.deelnemer_id, naam };
  }
  const kanToevoegen = heeft(actor, 'evenementen.lesje_wijzigen');
  if (toevoegen && kanToevoegen) {
    await kenSessieToe(env, gebruikerVan(actor), dn.deelnemer_id, sessieId, heeft(actor, 'evenementen.overboeken'), true);
    await zetKlas(env, actor, sessieId, dn.deelnemer_id, 'aanwezig', ip);
    return { resultaat: 'toegevoegd' as const, deelnemerId: dn.deelnemer_id, naam };
  }
  const lesjes = (await rijenVan(env, dn.deelnemer_id)).filter((r) => r.sessie_id && r.datum === vandaag()).map((r) => ({ titel: r.titel, startUur: r.tijdsblok_start, lokaal: r.lokaal }));
  return { resultaat: 'niet_op_lijst' as const, deelnemerId: dn.deelnemer_id, naam, lesjes, kanToevoegen };
}
