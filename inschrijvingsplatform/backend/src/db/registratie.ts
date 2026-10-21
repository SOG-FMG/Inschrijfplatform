import { blindeIndex, ontsleutel, versleutel } from '../crypto/versleuteling';
import type { Env, Keuze, Moment, RegistratieInvoer, RegistratieResultaat } from '../types';
import { plaatshouders, promoveerWachtlijst, referentie, STATUS_DAGDEEL, STATUS_SESSIE, vandaag } from './capaciteit';
import { binnen } from './evenement';
import { DbFout, schrijf } from './fouten';

/**
 * Atomische registratie: deelnemer + dagde(e)l(en) + sessies in één D1-batch.
 * Eerst alles valideren (lezen), daarna één schrijfbatch waarin ook de capaciteit
 * gecontroleerd wordt. Faalt één keuze, dan wordt niets bewaard.
 * De invoer is al gevalideerd en genormaliseerd door validatie.ts.
 */
export async function registreer(env: Env, slug: string, invoer: RegistratieInvoer, tokenHash: string): Promise<RegistratieResultaat> {
  const db = env.DB;
  const { deelnemer: d, dagdelen, sessies } = invoer;

  const e = await db
    .prepare(
      `select evenement_id, titel, contact_email, inschrijving_vanaf, inschrijving_tot, max_dagdelen
       from evenementen where slug = ? and status = 'gepubliceerd'`,
    )
    .bind(slug)
    .first<{ evenement_id: string; titel: string; contact_email: string | null; inschrijving_vanaf: string | null; inschrijving_tot: string | null; max_dagdelen: number }>();
  if (!e) throw new DbFout('EVENEMENT_NIET_GEVONDEN');
  const nu = Date.now();
  if (!binnen(nu, e.inschrijving_vanaf, e.inschrijving_tot)) throw new DbFout('INSCHRIJVING_GESLOTEN');
  if (new Set(dagdelen).size !== dagdelen.length || dagdelen.length > e.max_dagdelen) throw new DbFout('ONGELDIG_AANTAL_DAGDELEN');
  if (new Set(sessies).size !== sessies.length) throw new DbFout('ONGELDIGE_SESSIEKEUZE');

  const eid = e.evenement_id;
  const [groepenR, dagdelenR, sessiesR, verplichtR, schoolR] = await db.batch<any>([
    db.prepare(`select doelgroep_id, sessiekeuze from doelgroepen where evenement_id = ?`).bind(eid),
    db
      .prepare(
        `select dd.dagdeel_id, dd.naam, dd.start_uur, dd.eind_uur, d.naam as dag, d.sessiekeuze_tot
         from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id
         where d.evenement_id = ? and dd.status = 'actief' and d.status = 'actief'
           and dd.dagdeel_id in (${plaatshouders(dagdelen.length)})
         order by d.datum, dd.start_uur`,
      )
      .bind(eid, ...dagdelen),
    db
      .prepare(
        `select s.sessie_id, s.tijdsblok_id, s.code, s.titel, s.doelgroep_id, s.uniek_per_deelnemer,
                s.status, s.zichtbaar, t.naam as tijdsblok, t.start_uur, t.type, t.dagdeel_id, l.naam as locatie
         from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
         left join locaties l on l.locatie_id = s.locatie_id
         where s.sessie_id in (${plaatshouders(sessies.length)})
         order by t.start_uur`,
      )
      .bind(...sessies),
    db
      .prepare(
        `select tijdsblok_id, dagdeel_id from tijdsblokken
         where type = 'keuze' and verplicht = 1 and dagdeel_id in (${plaatshouders(dagdelen.length)})`,
      )
      .bind(...dagdelen),
    db.prepare(`select count(*) as n from scholen where school_id = ?`).bind(d.schoolId ?? ''),
  ]);

  // Doelgroep (verplicht zodra het evenement doelgroepen heeft)
  const groepen = groepenR.results as { doelgroep_id: string; sessiekeuze: number }[];
  const groep = groepen.find((g) => g.doelgroep_id === d.doelgroepId);
  if (groepen.length && !groep) throw new DbFout('ONGELDIGE_DOELGROEP');
  if (groep && !groep.sessiekeuze && sessies.length) throw new DbFout('GEEN_SESSIEKEUZE_VOOR_DOELGROEP');
  if (d.schoolId && schoolR.results[0].n === 0) throw new DbFout('ONGELDIGE_GEGEVENS');

  // Dagdelen
  const gekozenDagdelen = dagdelenR.results as { dagdeel_id: string; naam: string; start_uur: string; eind_uur: string; dag: string; sessiekeuze_tot: string | null }[];
  if (gekozenDagdelen.length !== dagdelen.length) throw new DbFout('ONGELDIG_DAGDEEL');
  const keuzeOpen = new Map(gekozenDagdelen.map((dd) => [dd.dagdeel_id, dd.sessiekeuze_tot == null || nu <= Date.parse(dd.sessiekeuze_tot)]));

  // Sessies: geldig, binnen de gekozen dagdelen, juiste doelgroep, keuze nog open
  const gekozen = sessiesR.results as any[];
  const geldig = gekozen.filter(
    (s) =>
      s.type === 'keuze' &&
      s.status === 'open' &&
      s.zichtbaar === 1 &&
      keuzeOpen.get(s.dagdeel_id) === true &&
      (s.doelgroep_id == null || s.doelgroep_id === groep?.doelgroep_id),
  );
  if (geldig.length !== sessies.length) throw new DbFout('ONGELDIGE_SESSIEKEUZE');
  if (new Set(gekozen.map((s) => s.tijdsblok_id)).size !== gekozen.length) throw new DbFout('MEERDERE_SESSIES_IN_TIJDSBLOK');
  const codes = gekozen.filter((s) => s.uniek_per_deelnemer === 1 && s.code != null).map((s) => s.code);
  if (new Set(codes).size !== codes.length) throw new DbFout('ZELFDE_ONDERDEEL_DUBBEL');
  if (!groep || groep.sessiekeuze) {
    const ontbreekt = (verplichtR.results as { tijdsblok_id: string; dagdeel_id: string }[]).some(
      (t) => keuzeOpen.get(t.dagdeel_id) && !gekozen.some((s) => s.tijdsblok_id === t.tijdsblok_id),
    );
    if (ontbreekt) throw new DbFout('VERPLICHT_TIJDSBLOK_ONTBREEKT');
  }

  // Persoonsgegevens versleutelen; blinde indexen voor dubbels en inzageverzoeken
  const deelnemerId = crypto.randomUUID();
  const v = (x?: string) => versleutel(env, x);
  const enc = await Promise.all([
    v(d.naam), v(d.voornaam), v(d.email), v(d.contactVoornaam), v(d.contactNaam),
    v(d.telefoon), v(d.schoolAndere), v(d.functie), v(d.opmerkingen),
    blindeIndex(env, 'email', d.email),
    blindeIndex(env, 'dubbel', eid, d.email, d.naam.toLowerCase(), d.voornaam.toLowerCase()),
  ]);

  const stmts = [
    db
      .prepare(
        `insert into deelnemers (deelnemer_id, evenement_id, doelgroep_id, naam_enc, voornaam_enc, email_enc,
           contact_voornaam_enc, contact_naam_enc, telefoon_enc, school_andere_enc, functie_enc, opmerkingen_enc,
           email_hash, dubbel_hash, school_id, gemeente, leerjaar, privacy_akkoord_op, beheer_token_hash)
         values (${plaatshouders(19)})`,
      )
      .bind(deelnemerId, eid, groep?.doelgroep_id ?? null, ...enc, d.schoolId ?? null, d.gemeente ?? null, d.leerjaar ?? null,
        new Date(nu).toISOString(), tokenHash),
    ...dagdelen.map((id) =>
      db
        .prepare(
          `insert into inschrijvingen (inschrijving_id, deelnemer_id, evenement_id, dag_id, dagdeel_id, status)
           select ?1, ?2, ?3, dd.dag_id, dd.dagdeel_id, ${STATUS_DAGDEEL}
           from dagdelen dd where dd.dagdeel_id = ?4`,
        )
        .bind(crypto.randomUUID(), deelnemerId, eid, id),
    ),
    ...gekozen.map((s) =>
      db
        .prepare(
          `insert into inschrijvingen (inschrijving_id, deelnemer_id, evenement_id, dag_id, dagdeel_id, tijdsblok_id, sessie_id, status)
           select ?1, ?2, ?3, dd.dag_id, dd.dagdeel_id, s.tijdsblok_id, s.sessie_id, ${STATUS_SESSIE}
           from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
           where s.sessie_id = ?4
           returning status`,
        )
        .bind(crypto.randomUUID(), deelnemerId, eid, s.sessie_id),
    ),
  ];

  let resultaten: D1Result[];
  try {
    resultaten = await schrijf(db, stmts);
  } catch (fout) {
    if (fout instanceof DbFout) await welkeIsVolzet(env, fout, dagdelen, sessies);
    throw fout;
  }

  const statussen = resultaten.slice(1 + dagdelen.length).map((r) => (r.results[0] as { status: string }).status);
  const momenten: Moment[] = gekozenDagdelen.map((dd) => ({
    dagdeelId: dd.dagdeel_id, dag: dd.dag, dagdeel: dd.naam, startUur: dd.start_uur, eindUur: dd.eind_uur,
  }));
  const keuzes: Keuze[] = gekozen.map((s, i) => ({
    sessieId: s.sessie_id, titel: s.titel, tijdsblok: s.tijdsblok, startUur: s.start_uur, locatie: s.locatie, status: statussen[i],
  }));
  return { deelnemerId, referentie: referentie(deelnemerId), evenement: e.titel, contactEmail: e.contact_email, momenten, keuzes };
}

/** Vult bij een volzet-fout aan wélk dagdeel/welke sessie volzet is (id + titel voor de melding). */
async function welkeIsVolzet(env: Env, fout: DbFout, dagdelen: string[], sessies: string[]) {
  if (fout.code === 'SESSIE_VOLZET' && sessies.length) {
    const s = await env.DB.prepare(
      `select s.sessie_id, s.titel from sessies s
       where s.sessie_id in (${plaatshouders(sessies.length)}) and s.capaciteit is not null and s.wachtlijst_toegelaten = 0
         and (select count(*) from inschrijvingen b where b.sessie_id = s.sessie_id and b.status = 'bevestigd') >= s.capaciteit
       limit 1`,
    )
      .bind(...sessies)
      .first<{ sessie_id: string; titel: string }>();
    if (s) [fout.detail, fout.hint] = [s.sessie_id, s.titel];
  } else if (fout.code === 'DAGDEEL_VOLZET') {
    const dd = await env.DB.prepare(
      `select dd.dagdeel_id from dagdelen dd
       where dd.dagdeel_id in (${plaatshouders(dagdelen.length)}) and dd.capaciteit is not null
         and (select count(*) from inschrijvingen b
              where b.dagdeel_id = dd.dagdeel_id and b.sessie_id is null and b.status = 'bevestigd') >= dd.capaciteit
       limit 1`,
    )
      .bind(...dagdelen)
      .first<{ dagdeel_id: string }>();
    if (dd) fout.detail = dd.dagdeel_id;
  }
}

// ---------------------------------------------------------------------------
// Zelfbeheer via de link in de bevestigingsmail
// ---------------------------------------------------------------------------

/** Heeft deze deelnemer een moment op een dag die al voorbij is? Dan kan annuleren niet meer. */
function heeftVoorbijeDag(db: D1Database, deelnemerId: string) {
  return db
    .prepare(
      `select count(*) as n from inschrijvingen i join evenement_dagen d on d.dag_id = i.dag_id
       where i.deelnemer_id = ? and d.datum < ?`,
    )
    .bind(deelnemerId, vandaag());
}

export async function registratieViaToken(env: Env, tokenHash: string) {
  const db = env.DB;
  const dn = await db
    .prepare(
      `select dn.deelnemer_id, dn.status, dn.naam_enc, dn.voornaam_enc, e.titel, e.slug, e.contact_email
       from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id
       where dn.beheer_token_hash = ? and dn.geanonimiseerd_op is null`,
    )
    .bind(tokenHash)
    .first<{ deelnemer_id: string; status: 'actief' | 'geannuleerd'; naam_enc: string; voornaam_enc: string; titel: string; slug: string; contact_email: string | null }>();
  if (!dn) return null;

  const [momenten, keuzes, voorbij] = await db.batch<any>([
    db
      .prepare(
        `select d.naam as dag, dd.naam as dagdeel, dd.start_uur as startUur, dd.eind_uur as eindUur, i.status
         from inschrijvingen i join dagdelen dd on dd.dagdeel_id = i.dagdeel_id join evenement_dagen d on d.dag_id = i.dag_id
         where i.deelnemer_id = ? and i.sessie_id is null
         order by d.datum, dd.start_uur`,
      )
      .bind(dn.deelnemer_id),
    db
      .prepare(
        `select s.titel, t.naam as tijdsblok, t.start_uur as startUur, l.naam as locatie, i.status
         from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
         left join locaties l on l.locatie_id = s.locatie_id
         where i.deelnemer_id = ?
         order by t.start_uur`,
      )
      .bind(dn.deelnemer_id),
    heeftVoorbijeDag(db, dn.deelnemer_id),
  ]);

  return {
    referentie: referentie(dn.deelnemer_id),
    evenement: dn.titel,
    slug: dn.slug,
    contactEmail: dn.contact_email,
    status: dn.status,
    voornaam: await ontsleutel(env, dn.voornaam_enc),
    naam: await ontsleutel(env, dn.naam_enc),
    annuleerbaar: dn.status === 'actief' && voorbij.results[0].n === 0,
    momenten: momenten.results as Moment[],
    keuzes: keuzes.results as Keuze[],
  };
}

/** Gegevens voor de annulatiemail; op te halen vóór het annuleren. */
export async function annulatieGegevens(env: Env, tokenHash: string) {
  const dn = await env.DB
    .prepare(
      `select dn.deelnemer_id, dn.email_enc, dn.voornaam_enc, e.titel, e.slug, e.contact_email
       from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id
       where dn.beheer_token_hash = ? and dn.status = 'actief' and dn.geanonimiseerd_op is null`,
    )
    .bind(tokenHash)
    .first<{ deelnemer_id: string; email_enc: string | null; voornaam_enc: string | null; titel: string; slug: string; contact_email: string | null }>();
  if (!dn?.email_enc) return null;
  return {
    deelnemerId: dn.deelnemer_id,
    email: await ontsleutel(env, dn.email_enc),
    voornaam: (await ontsleutel(env, dn.voornaam_enc)) ?? '',
    evenement: dn.titel,
    slug: dn.slug,
    contactEmail: dn.contact_email,
    referentie: referentie(dn.deelnemer_id),
  };
}

export async function annuleerViaToken(env: Env, tokenHash: string) {
  const db = env.DB;
  const dn = await db
    .prepare(`select deelnemer_id from deelnemers where beheer_token_hash = ? and status = 'actief' and geanonimiseerd_op is null`)
    .bind(tokenHash)
    .first<{ deelnemer_id: string }>();
  if (!dn) throw new DbFout('REGISTRATIE_NIET_GEVONDEN');
  const id = dn.deelnemer_id;

  const [voorbij, sessies] = await db.batch<any>([
    heeftVoorbijeDag(db, id),
    db.prepare(`select distinct sessie_id from inschrijvingen where deelnemer_id = ? and sessie_id is not null and status <> 'geannuleerd'`).bind(id),
  ]);
  if (voorbij.results[0].n > 0) throw new DbFout('NIET_MEER_ANNULEERBAAR');

  await schrijf(db, [
    db.prepare(`update deelnemers set status = 'geannuleerd' where deelnemer_id = ? and status = 'actief'`).bind(id),
    db.prepare(`update inschrijvingen set status = 'geannuleerd' where deelnemer_id = ? and status <> 'geannuleerd'`).bind(id),
    ...sessies.results.map((s: { sessie_id: string }) => promoveerWachtlijst(db, s.sessie_id)),
  ]);
  return registratieViaToken(env, tokenHash);
}
