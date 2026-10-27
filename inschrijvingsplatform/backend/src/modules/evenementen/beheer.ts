import { ontsleutel } from '../../crypto/versleuteling';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { promoveerWachtlijst, referentie, STATUS_SESSIE, vandaag } from './capaciteit';
import { audit } from '../../kern/audit';
import { koppelAanContact } from '../../kern/contacten';
import { DbFout, schrijf } from '../../kern/fouten';

export async function evenementVanDeelnemer(env: Env, deelnemerId: string, enkelActief: boolean) {
  const dn = await env.DB.prepare(`select evenement_id from deelnemers where deelnemer_id = ?${enkelActief ? ` and status = 'actief'` : ''}`)
    .bind(deelnemerId)
    .first<{ evenement_id: string }>();
  // Zelfde antwoord als bij ontbrekende rechten: verraadt niet of een deelnemer bestaat.
  if (!dn) throw new DbFout('GEEN_TOEGANG');
  return dn.evenement_id;
}

// ---------------------------------------------------------------------------
// Deelnemerslijst (CSV-export), ontsleuteld
// ---------------------------------------------------------------------------
export async function deelnemerslijst(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId);
  const db = env.DB;
  const [deelnemers, inschrijvingen] = await db.batch<any>([
    db
      .prepare(
        `select dn.*, gr.naam as doelgroep, sc.naam as school_naam, sc.gemeente as school_gemeente
         from deelnemers dn
         left join doelgroepen gr on gr.doelgroep_id = dn.doelgroep_id
         left join scholen sc on sc.school_id = dn.school_id
         where dn.evenement_id = ? and dn.status = 'actief'`,
      )
      .bind(evenementId),
    db
      .prepare(
        `select i.deelnemer_id, i.sessie_id, i.status, d.naam as dag, dd.naam as dagdeel, t.start_uur, s.titel, l.naam as locatie
         from inschrijvingen i
         join evenement_dagen d on d.dag_id = i.dag_id
         join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
         left join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
         left join sessies s on s.sessie_id = i.sessie_id
         left join locaties l on l.locatie_id = s.locatie_id
         where i.evenement_id = ? and i.status <> 'geannuleerd'
         order by d.datum, dd.start_uur, t.start_uur`,
      )
      .bind(evenementId),
    audit(env, g, 'evenementen', evenementId, 'EXPORT_DEELNEMERS', undefined, ip),
  ]);

  const perDeelnemer = new Map<string, any[]>();
  for (const i of inschrijvingen.results) perDeelnemer.set(i.deelnemer_id, [...(perDeelnemer.get(i.deelnemer_id) ?? []), i]);
  const o = (v: string | null) => ontsleutel(env, v);

  const rijen = await Promise.all(
    deelnemers.results.map(async (dn: any) => {
      const [voornaam, naam, email, contactVoornaam, contactNaam, telefoon, schoolAndere, functie, opmerkingen] = await Promise.all([
        o(dn.voornaam_enc), o(dn.naam_enc), o(dn.email_enc), o(dn.contact_voornaam_enc), o(dn.contact_naam_enc),
        o(dn.telefoon_enc), o(dn.school_andere_enc), o(dn.functie_enc), o(dn.opmerkingen_enc),
      ]);
      const eigen = perDeelnemer.get(dn.deelnemer_id) ?? [];
      return {
        referentie: referentie(dn.deelnemer_id),
        ingeschreven_op: dn.created_at,
        doelgroep: dn.doelgroep,
        voornaam,
        naam,
        email,
        contact_voornaam: contactVoornaam,
        contact_naam: contactNaam,
        telefoon,
        school: dn.school_naam ?? schoolAndere,
        gemeente: dn.school_gemeente ?? dn.gemeente,
        leerjaar: dn.leerjaar,
        functie,
        momenten: eigen.filter((i) => !i.sessie_id).map((i) => `${i.dag} – ${i.dagdeel}`).join('; '),
        keuzes: eigen
          .filter((i) => i.sessie_id)
          .map((i) => `${i.start_uur} ${i.titel}${i.status === 'wachtlijst' ? ' (wachtlijst)' : ''}${i.locatie ? ` @ ${i.locatie}` : ''}`)
          .join('; '),
        opmerkingen,
      };
    }),
  );
  const nl = new Intl.Collator('nl', { sensitivity: 'base' });
  return rijen.sort((a, b) => nl.compare(a.naam ?? '', b.naam ?? '') || nl.compare(a.voornaam ?? '', b.voornaam ?? ''));
}

// ---------------------------------------------------------------------------
// Verplaatsen naar een ander dagdeel of een andere sessie
// ---------------------------------------------------------------------------
/** Wie de inschrijving wijzigde (het versienummer zelf houden de triggers bij, zie migraties/checkin_versie.sql). */
export const door = (db: D1Database, deelnemerId: string, wie: 'ouder' | 'school') =>
  db.prepare(`update deelnemers set gewijzigd_door = ? where deelnemer_id = ?`).bind(wie, deelnemerId);

export async function verplaatsDagdeel(env: Env, g: Gebruiker, deelnemerId: string, van: string, naar: string, forceer = false) {
  const db = env.DB;
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, false);
  await controleerToegang(env, g, evenementId, true);
  if (van === naar) throw new DbFout('ONGELDIG_DAGDEEL');

  const [doel, huidig, oudeSessies] = await db.batch<any>([
    db
      .prepare(
        `select dd.dagdeel_id, dd.dag_id from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id
         where dd.dagdeel_id = ? and d.evenement_id = ?`,
      )
      .bind(naar, evenementId),
    db
      .prepare(`select inschrijving_id from inschrijvingen where deelnemer_id = ? and dagdeel_id = ? and sessie_id is null and status <> 'geannuleerd'`)
      .bind(deelnemerId, van),
    db
      .prepare(`select inschrijving_id, sessie_id from inschrijvingen where deelnemer_id = ? and dagdeel_id = ? and sessie_id is not null and status <> 'geannuleerd'`)
      .bind(deelnemerId, van),
  ]);
  if (!doel.results.length) throw new DbFout('ONGELDIG_DAGDEEL');
  if (!huidig.results.length) throw new DbFout('INSCHRIJVING_NIET_GEVONDEN');

  await schrijf(db, [
    // Capaciteit van het nieuwe dagdeel in dezelfde instructie (status 'volzet' → trigger breekt af)
    db
      .prepare(
        `update inschrijvingen set dagdeel_id = ?2, dag_id = ?3,
           status = case when ?4 = 0 and (select capaciteit from dagdelen where dagdeel_id = ?2) is not null
                           and (select count(*) from inschrijvingen b where b.dagdeel_id = ?2 and b.sessie_id is null and b.status = 'bevestigd')
                               >= (select capaciteit from dagdelen where dagdeel_id = ?2)
                         then 'volzet' else status end
         where inschrijving_id = ?1`,
      )
      .bind(huidig.results[0].inschrijving_id, naar, doel.results[0].dag_id, forceer ? 1 : 0),
    // Sessies van het oude dagdeel vervallen; daarna nieuwe kiezen met kenSessieToe
    ...oudeSessies.results.map((i: any) => db.prepare(`update inschrijvingen set status = 'geannuleerd' where inschrijving_id = ?`).bind(i.inschrijving_id)),
    ...oudeSessies.results.map((i: any) => promoveerWachtlijst(db, i.sessie_id)),
    door(db, deelnemerId, 'school'),
    audit(env, g, 'deelnemers', deelnemerId, 'VERPLAATS_DAGDEEL', { van, naar, forceer }),
  ]);
  return { verplaatst: true, sessiesGeannuleerd: oudeSessies.results.length };
}

/**
 * Een lesje toekennen (vervangt de keuze in hetzelfde tijdsblok). `gecontroleerd`: de oproeper controleerde de rechten
 * al (aanwezigheid: onthaal met evenementen.lesje_wijzigen, of een sessiegever); anders moet g organisator zijn.
 */
/**
 * Uitschrijven door de school = annuleren, niet verwijderen.
 *
 * Annuleren maakt de plaats vrij, laat de wachtlijst doorschuiven, en houdt de statistiek en het audit-logboek
 * heel. Hard verwijderen breekt die vier, en is daarom voorbehouden aan een echt GDPR-verzoek: dat gaat via
 * anonimiseerEvenement, dat de persoonsgegevens wist en de cijfers laat staan.
 *
 * Zet ook de uitnodiging op 'afgemeld', zodat er langs de voorinschrijvingskant geen herinnering meer vertrekt.
 */
export async function schrijfUit(env: Env, g: Gebruiker, deelnemerId: string, ip: string | null) {
  const db = env.DB;
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, false);
  await controleerToegang(env, g, evenementId, true);
  const { results: sessies } = await db
    .prepare(`select distinct sessie_id from inschrijvingen where deelnemer_id = ? and sessie_id is not null and status <> 'geannuleerd'`)
    .bind(deelnemerId)
    .all<{ sessie_id: string }>();

  await schrijf(db, [
    db.prepare(`update deelnemers set status = 'geannuleerd' where deelnemer_id = ? and status = 'actief'`).bind(deelnemerId),
    db.prepare(`update inschrijvingen set status = 'geannuleerd' where deelnemer_id = ? and status <> 'geannuleerd'`).bind(deelnemerId),
    db.prepare(`update uitnodigingen set status = 'afgemeld' where deelnemer_id = ? and status <> 'afgemeld'`).bind(deelnemerId),
    ...sessies.map((s) => promoveerWachtlijst(db, s.sessie_id)),
    audit(env, g, 'deelnemers', deelnemerId, 'UITSCHRIJVEN', { sessies: sessies.length }, ip),
  ]);
  return { ok: true };
}

/**
 * "Komt niet": de school weet dat deze deelnemer niet komt. Hij blijft ingeschreven en houdt zijn plaats — hij
 * kan nog altijd verschijnen — maar krijgt geen herinnering meer. Wil je de plaats vrijmaken, gebruik dan
 * uitschrijven.
 */
export async function zetKomtNiet(env: Env, g: Gebruiker, deelnemerId: string, komtNiet: boolean, ip: string | null) {
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, false);
  await controleerToegang(env, g, evenementId, true);
  await env.DB.batch([
    env.DB.prepare(`update deelnemers set komt_niet = ? where deelnemer_id = ?`).bind(komtNiet ? 1 : 0, deelnemerId),
    audit(env, g, 'deelnemers', deelnemerId, 'KOMT_NIET', { komtNiet }, ip),
  ]);
  return { ok: true };
}

export async function kenSessieToe(env: Env, g: Gebruiker | null, deelnemerId: string, sessieId: string, forceer = false, gecontroleerd = false) {
  const db = env.DB;
  const evenementId = await evenementVanDeelnemer(env, deelnemerId, true);
  if (!gecontroleerd) await controleerToegang(env, g!, evenementId, true);

  const s = await db
    .prepare(
      `select s.sessie_id, s.tijdsblok_id, t.dagdeel_id from sessies s
       join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id
       where s.sessie_id = ? and d.evenement_id = ?`,
    )
    .bind(sessieId, evenementId)
    .first<{ sessie_id: string; tijdsblok_id: string; dagdeel_id: string }>();
  if (!s) throw new DbFout('ONGELDIGE_SESSIEKEUZE');

  const [dagdeel, oud] = await db.batch<any>([
    db
      .prepare(`select 1 from inschrijvingen where deelnemer_id = ? and dagdeel_id = ? and sessie_id is null and status <> 'geannuleerd'`)
      .bind(deelnemerId, s.dagdeel_id),
    db
      .prepare(`select inschrijving_id, sessie_id from inschrijvingen where deelnemer_id = ? and tijdsblok_id = ? and status <> 'geannuleerd'`)
      .bind(deelnemerId, s.tijdsblok_id),
  ]);
  if (!dagdeel.results.length) throw new DbFout('EERST_DAGDEEL_VERPLAATSEN');
  const vorige = oud.results[0] as { inschrijving_id: string; sessie_id: string } | undefined;

  const res = await schrijf(db, [
    // Bestaande keuze in hetzelfde tijdsblok vervangen
    ...(vorige ? [db.prepare(`update inschrijvingen set status = 'geannuleerd' where inschrijving_id = ?`).bind(vorige.inschrijving_id)] : []),
    db
      .prepare(
        `insert into inschrijvingen (inschrijving_id, deelnemer_id, evenement_id, dag_id, dagdeel_id, tijdsblok_id, sessie_id, status)
         select ?1, ?2, ?3, dd.dag_id, dd.dagdeel_id, s.tijdsblok_id, s.sessie_id,
                case when ?5 = 1 then 'bevestigd' else ${STATUS_SESSIE} end
         from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
         where s.sessie_id = ?4
         returning status`,
      )
      .bind(crypto.randomUUID(), deelnemerId, evenementId, sessieId, forceer ? 1 : 0),
    ...(vorige ? [promoveerWachtlijst(db, vorige.sessie_id)] : []),
    door(db, deelnemerId, 'school'),
    audit(env, g, 'deelnemers', deelnemerId, 'KEN_SESSIE_TOE', { sessieId, vorige: vorige?.sessie_id ?? null, forceer }),
  ]);
  return { status: (res[vorige ? 1 : 0].results[0] as { status: string }).status };
}

// ---------------------------------------------------------------------------
// GDPR: anonimiseren na afloop + bewaartermijn
// ---------------------------------------------------------------------------
async function anonimiseer(env: Env, evenementId: string): Promise<number> {
  const db = env.DB;
  const vanEvenement = `(select deelnemer_id from deelnemers where evenement_id = ?)`;
  const res = await schrijf(db, [
    db.prepare(`delete from audit_log where entiteit = 'deelnemers' and record_id in ${vanEvenement}`).bind(evenementId),
    db.prepare(`delete from mail_berichten where deelnemer_id in ${vanEvenement}`).bind(evenementId),
    // Enkel statistisch bruikbare velden (school, gemeente, leerjaar, doelgroep) blijven behouden
    db
      .prepare(
        `update deelnemers set
           naam_enc = null, voornaam_enc = null, email_enc = null, contact_voornaam_enc = null, contact_naam_enc = null,
           telefoon_enc = null, school_andere_enc = null, functie_enc = null, opmerkingen_enc = null,
           email_hash = null, dubbel_hash = null, beheer_token_hash = null, checkin_token = null, contact_id = null, persoon_id = null, geanonimiseerd_op = ?
         where evenement_id = ? and geanonimiseerd_op is null`,
      )
      .bind(new Date().toISOString(), evenementId),
    // Uitnodigingen bevatten een link en voor ingevulde gegevens; de contacten zelf ruimt de kern op (kern/contacten.ts).
    db.prepare(`delete from uitnodigingen where evenement_id = ?`).bind(evenementId),
  ]);
  return res[2].meta.changes;
}

/** Manueel, door een organisator van het evenement. */
export async function anonimiseerEvenement(env: Env, g: Gebruiker, evenementId: string) {
  await controleerToegang(env, g, evenementId, true);
  const aantal = await anonimiseer(env, evenementId);
  await audit(env, g, 'evenementen', evenementId, 'ANONIMISEER', { aantal }).run();
  return { aantal };
}

/** Dagelijks via de Cron Trigger (wrangler.toml). */
export async function anonimiseerVerlopenEvenementen(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `select e.evenement_id from evenementen e
     where date(e.eind_datum, '+' || e.bewaartermijn_dagen || ' days') < ?
       and exists (select 1 from deelnemers d where d.evenement_id = e.evenement_id and d.geanonimiseerd_op is null)`,
  )
    .bind(vandaag())
    .all<{ evenement_id: string }>();
  let totaal = 0;
  for (const { evenement_id } of results) {
    const aantal = await anonimiseer(env, evenement_id);
    await audit(env, null, 'evenementen', evenement_id, 'ANONIMISEER_AUTOMATISCH', { aantal }).run();
    totaal += aantal;
  }
  return totaal;
}

/**
 * Dagelijks: inschrijvingen van vóór de contacten (of van een import zonder koppeling) aan een contact en een
 * persoon koppelen. Per keer een beperkt aantal, zodat de taak binnen de limieten van een Worker blijft.
 */
export async function koppelBestaandeDeelnemers(env: Env, max = 200): Promise<number> {
  const { results } = await env.DB.prepare(
    `select d.deelnemer_id, e.deelnemer_type, d.email_enc, d.voornaam_enc, d.naam_enc, d.contact_voornaam_enc, d.contact_naam_enc, d.telefoon_enc
     from deelnemers d join evenementen e on e.evenement_id = d.evenement_id
     where d.contact_id is null and d.email_enc is not null and d.geanonimiseerd_op is null
     order by d.created_at limit ?`,
  )
    .bind(max)
    .all<Record<string, string | null>>();
  for (const r of results) {
    const o = (k: string) => ontsleutel(env, r[k]);
    const [email, voornaam, naam, cVoornaam, cNaam, telefoon] = await Promise.all(
      ['email_enc', 'voornaam_enc', 'naam_enc', 'contact_voornaam_enc', 'contact_naam_enc', 'telefoon_enc'].map(o),
    );
    if (!email) continue;
    const volwassene = r.deelnemer_type === 'volwassene';
    const k = await koppelAanContact(
      env,
      { email, voornaam: cVoornaam ?? (volwassene ? voornaam : null), naam: cNaam ?? (volwassene ? naam : null), telefoon },
      { voornaam: voornaam ?? '', naam: naam ?? '' },
    );
    await env.DB.prepare(`update deelnemers set contact_id = ?, persoon_id = ? where deelnemer_id = ?`).bind(k.contactId, k.persoonId, r.deelnemer_id).run();
  }
  return results.length;
}
