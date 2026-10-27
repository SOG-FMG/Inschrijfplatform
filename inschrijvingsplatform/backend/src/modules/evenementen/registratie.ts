import { blindeIndex, ontsleutel, versleutel } from '../../crypto/versleuteling';
import { koppelAanContact, werkContactBij } from '../../kern/contacten';
import { geldigeUitnodiging, markeerGebruiktStmt } from './uitnodigingen';
import type { Env, Keuze, Moment, RegistratieInvoer, RegistratieResultaat } from '../../types';
import { plaatshouders, promoveerWachtlijst, referentie, STATUS_DAGDEEL, STATUS_SESSIE, vandaag } from './capaciteit';
import { binnen, publiekEvenement } from './evenement';
import { DbFout, schrijf } from '../../kern/fouten';
import { door } from './beheer';
import { nieuwToken } from '../../kern/http';

/**
 * Atomische registratie: deelnemer + dagde(e)l(en) + sessies in één D1-batch.
 * Eerst alles valideren (lezen), daarna één schrijfbatch waarin ook de capaciteit
 * gecontroleerd wordt. Faalt één keuze, dan wordt niets bewaard.
 * De invoer is al gevalideerd en genormaliseerd door validatie.ts.
 * `tokenHash`: hash van de beheertoken (link in de mail); `checkinToken`: aparte token voor de QR-code (kern/checkin.ts).
 */
export async function registreer(env: Env, slug: string, invoer: RegistratieInvoer, tokenHash: string, checkinToken: string): Promise<RegistratieResultaat> {
  const db = env.DB;
  const { deelnemer: d, dagdelen, sessies } = invoer;

  const e = await db
    .prepare(
      `select evenement_id, titel, contact_email, inschrijving_vanaf, inschrijving_tot, max_dagdelen, deelnemer_type
       from evenementen where slug = ? and status = 'gepubliceerd'`,
    )
    .bind(slug)
    .first<{ evenement_id: string; titel: string; contact_email: string | null; inschrijving_vanaf: string | null; inschrijving_tot: string | null; max_dagdelen: number; deelnemer_type: string }>();
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
                s.status, s.zichtbaar, t.zichtbaar as blok_zichtbaar, t.naam as tijdsblok, t.start_uur, t.type, t.dagdeel_id, l.naam as locatie
         from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
         left join locaties l on l.locatie_id = s.locatie_id
         where s.sessie_id in (${plaatshouders(sessies.length)})
         order by t.start_uur`,
      )
      .bind(...sessies),
    db
      .prepare(
        `select tijdsblok_id, dagdeel_id from tijdsblokken
         where type = 'keuze' and verplicht = 1 and zichtbaar = 1 and dagdeel_id in (${plaatshouders(dagdelen.length)})`,
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
      s.blok_zichtbaar === 1 &&
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

  // Contact en persoon (kern): via de uitnodiging, of herkend aan e-mailadres en naam.
  const uitnodiging = invoer.uitnodiging ? await geldigeUitnodiging(env, invoer.uitnodiging, eid) : null;
  const volwassene = e.deelnemer_type === 'volwassene';
  const contactGegevens = {
    email: d.email,
    voornaam: d.contactVoornaam ?? (volwassene ? d.voornaam : null),
    naam: d.contactNaam ?? (volwassene ? d.naam : null),
    telefoon: d.telefoon ?? null,
  };
  const koppeling = uitnodiging?.persoonId
    ? { contactId: uitnodiging.contactId, persoonId: uitnodiging.persoonId }
    : await koppelAanContact(env, contactGegevens, { voornaam: d.voornaam, naam: d.naam }, uitnodiging?.contactId);
  if (uitnodiging?.persoonId) await werkContactBij(env, uitnodiging.contactId, contactGegevens);

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
           email_hash, dubbel_hash, school_id, gemeente, leerjaar, privacy_akkoord_op, beheer_token_hash, contact_id, persoon_id, checkin_token, checkin_gemaild_op)
         values (${plaatshouders(23)})`,
      )
      .bind(deelnemerId, eid, groep?.doelgroep_id ?? null, ...enc, d.schoolId ?? null, d.gemeente ?? null, d.leerjaar ?? null,
        new Date(nu).toISOString(), tokenHash, koppeling.contactId, koppeling.persoonId, checkinToken, new Date(nu).toISOString()),
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
    // Als laatste, zodat de resultaten van de sessies (hierboven) op hun plaats blijven.
    ...(uitnodiging ? [markeerGebruiktStmt(env, uitnodiging.uitnodigingId, deelnemerId)] : []),
    // De triggers tellen elke ingevoegde rij als wijziging; een nieuwe inschrijving begint bij versie 1.
    db.prepare(`update deelnemers set checkin_versie = 1, gewijzigd_op = null where deelnemer_id = ?`).bind(deelnemerId),
  ];

  let resultaten: D1Result[];
  try {
    resultaten = await schrijf(db, stmts);
  } catch (fout) {
    if (fout instanceof DbFout) await welkeIsVolzet(env, fout, dagdelen, sessies);
    throw fout;
  }

  const statussen = resultaten.slice(1 + dagdelen.length, 1 + dagdelen.length + gekozen.length).map((r) => (r.results[0] as { status: string }).status);
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
      `select dn.deelnemer_id, dn.status, dn.naam_enc, dn.voornaam_enc, dn.doelgroep_id, e.titel, e.slug, e.contact_email,
              e.status as evenement_status, e.inschrijving_vanaf, e.inschrijving_tot, coalesce(gr.sessiekeuze, 1) as sessiekeuze
       from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id
       left join doelgroepen gr on gr.doelgroep_id = dn.doelgroep_id
       where dn.beheer_token_hash = ? and dn.geanonimiseerd_op is null`,
    )
    .bind(tokenHash)
    .first<{
      deelnemer_id: string; status: 'actief' | 'geannuleerd'; naam_enc: string; voornaam_enc: string; doelgroep_id: string | null;
      titel: string; slug: string; contact_email: string | null;
      evenement_status: string; inschrijving_vanaf: string | null; inschrijving_tot: string | null; sessiekeuze: number;
    }>();
  if (!dn) return null;

  const [momenten, keuzes, voorbij] = await db.batch<any>([
    db
      .prepare(
        `select dd.dagdeel_id as dagdeelId, d.naam as dag, dd.naam as dagdeel, dd.start_uur as startUur, dd.eind_uur as eindUur, i.status
         from inschrijvingen i join dagdelen dd on dd.dagdeel_id = i.dagdeel_id join evenement_dagen d on d.dag_id = i.dag_id
         where i.deelnemer_id = ? and i.sessie_id is null
         order by d.datum, dd.start_uur`,
      )
      .bind(dn.deelnemer_id),
    db
      .prepare(
        `select s.sessie_id as sessieId, i.tijdsblok_id as tijdsblokId, s.titel, t.naam as tijdsblok, t.start_uur as startUur,
                l.naam as locatie, i.status
         from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
         left join locaties l on l.locatie_id = s.locatie_id
         where i.deelnemer_id = ?
         order by t.start_uur`,
      )
      .bind(dn.deelnemer_id),
    heeftVoorbijeDag(db, dn.deelnemer_id),
  ]);

  const actief = dn.status === 'actief' && voorbij.results[0].n === 0;
  const alleKeuzes = keuzes.results as (Keuze & { tijdsblokId: string })[];
  // Een gewijzigde keuze laat een geannuleerde rij achter: toon enkel de huidige (tenzij alles geannuleerd is).
  const zichtbareKeuzes = dn.status === 'geannuleerd' ? alleKeuzes : alleKeuzes.filter((k) => k.status !== 'geannuleerd');
  const wijzigen =
    actief && dn.sessiekeuze === 1 && dn.evenement_status === 'gepubliceerd' && binnen(Date.now(), dn.inschrijving_vanaf, dn.inschrijving_tot)
      ? await keuzeOpties(env, dn.slug, momenten.results as Moment[], zichtbareKeuzes, dn.doelgroep_id)
      : null;

  return {
    referentie: referentie(dn.deelnemer_id),
    evenement: dn.titel,
    slug: dn.slug,
    contactEmail: dn.contact_email,
    status: dn.status,
    voornaam: await ontsleutel(env, dn.voornaam_enc),
    naam: await ontsleutel(env, dn.naam_enc),
    annuleerbaar: actief,
    momenten: momenten.results as Moment[],
    keuzes: zichtbareKeuzes,
    wijzigen,
  };
}

/**
 * Wat de inschrijver nog kan kiezen: de eigen dagdelen (zoals op het formulier, met vrije plaatsen)
 * en de huidige keuze per tijdsblok. Null als er niets (meer) te kiezen valt.
 */
async function keuzeOpties(env: Env, slug: string, momenten: Moment[], keuzes: (Keuze & { tijdsblokId: string })[], doelgroepId: string | null) {
  const ev = await publiekEvenement(env, slug);
  if (!ev) return null;
  const eigen = new Set(momenten.filter((m) => m.status !== 'geannuleerd').map((m) => m.dagdeelId));
  const dagen = ev.dagen
    .filter((d) => d.sessiekeuzeOpen)
    .flatMap((d) => d.dagdelen.filter((dd) => eigen.has(dd.id)).map((dagdeel) => ({ dagNaam: d.naam, dagdeel })))
    .filter((x) => x.dagdeel.tijdsblokken.some((t) => t.type === 'keuze'));
  if (!dagen.length) return null;
  const huidig: Record<string, string> = {};
  for (const x of dagen) for (const t of x.dagdeel.tijdsblokken) if (t.type === 'keuze') huidig[t.id] = '';
  for (const k of keuzes) if (k.tijdsblokId in huidig) huidig[k.tijdsblokId] = k.sessieId!;
  return { doelgroepId: doelgroepId ?? '', dagen, keuzes: huidig };
}

/**
 * Lesjes wijzigen via de persoonlijke link. Enkel blokken waarin iets verandert worden aangeraakt:
 * de oude keuze wordt geannuleerd (en de wachtlijst schuift door), de nieuwe ingevoegd met dezelfde
 * capaciteitscontrole als bij inschrijven, alles in één batch. `sessies` = de gewenste keuzes in de
 * dagdelen waar kiezen nog open is; keuzes in andere dagdelen blijven ongewijzigd.
 */
export async function wijzigKeuzesViaToken(env: Env, tokenHash: string, sessies: string[]) {
  const db = env.DB;
  const dn = await db
    .prepare(
      `select dn.deelnemer_id, dn.doelgroep_id, e.status as evenement_status, e.inschrijving_vanaf, e.inschrijving_tot,
              coalesce(gr.sessiekeuze, 1) as sessiekeuze
       from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id
       left join doelgroepen gr on gr.doelgroep_id = dn.doelgroep_id
       where dn.beheer_token_hash = ? and dn.status = 'actief' and dn.geanonimiseerd_op is null`,
    )
    .bind(tokenHash)
    .first<{ deelnemer_id: string; doelgroep_id: string | null; evenement_status: string; inschrijving_vanaf: string | null; inschrijving_tot: string | null; sessiekeuze: number }>();
  if (!dn) throw new DbFout('REGISTRATIE_NIET_GEVONDEN');
  const id = dn.deelnemer_id;
  const nu = Date.now();
  if (dn.evenement_status !== 'gepubliceerd' || !binnen(nu, dn.inschrijving_vanaf, dn.inschrijving_tot) || !dn.sessiekeuze) {
    throw new DbFout('NIET_MEER_WIJZIGBAAR');
  }
  if (new Set(sessies).size !== sessies.length) throw new DbFout('ONGELDIGE_SESSIEKEUZE');

  const [voorbij, dagdelenR, huidigR, gekozenR] = await db.batch<any>([
    heeftVoorbijeDag(db, id),
    db
      .prepare(
        `select i.dagdeel_id, d.sessiekeuze_tot from inschrijvingen i join evenement_dagen d on d.dag_id = i.dag_id
         where i.deelnemer_id = ? and i.sessie_id is null and i.status <> 'geannuleerd'`,
      )
      .bind(id),
    db
      .prepare(`select inschrijving_id, sessie_id, dagdeel_id from inschrijvingen where deelnemer_id = ? and sessie_id is not null and status <> 'geannuleerd'`)
      .bind(id),
    db
      .prepare(
        `select s.sessie_id, s.tijdsblok_id, s.code, s.doelgroep_id, s.uniek_per_deelnemer, s.status, s.zichtbaar,
                t.zichtbaar as blok_zichtbaar, t.type, t.dagdeel_id
         from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
         where s.sessie_id in (${plaatshouders(Math.max(sessies.length, 1))})`,
      )
      .bind(...(sessies.length ? sessies : [''])),
  ]);
  if (voorbij.results[0].n > 0) throw new DbFout('NIET_MEER_WIJZIGBAAR');

  const keuzeOpen = new Map<string, boolean>(
    dagdelenR.results.map((dd: any) => [dd.dagdeel_id, dd.sessiekeuze_tot == null || nu <= Date.parse(dd.sessiekeuze_tot)]),
  );
  const huidig = huidigR.results as { inschrijving_id: string; sessie_id: string; dagdeel_id: string }[];
  const gekozen = gekozenR.results as any[];
  const alGekozen = new Set(huidig.map((h) => h.sessie_id));

  // Elke gevraagde keuze: in een eigen dagdeel waar kiezen nog open is en voor de juiste doelgroep;
  // een nieuw lesje moet bovendien open en zichtbaar zijn (een huidig lesje mag blijven).
  const geldig = gekozen.filter(
    (s) =>
      s.type === 'keuze' &&
      keuzeOpen.get(s.dagdeel_id) === true &&
      (s.doelgroep_id == null || s.doelgroep_id === dn.doelgroep_id) &&
      (alGekozen.has(s.sessie_id) || (s.status === 'open' && s.zichtbaar === 1 && s.blok_zichtbaar === 1)),
  );
  if (geldig.length !== sessies.length) throw new DbFout('ONGELDIGE_SESSIEKEUZE');
  if (new Set(gekozen.map((s) => s.tijdsblok_id)).size !== gekozen.length) throw new DbFout('MEERDERE_SESSIES_IN_TIJDSBLOK');
  const codes = gekozen.filter((s) => s.uniek_per_deelnemer === 1 && s.code != null).map((s) => s.code);
  if (new Set(codes).size !== codes.length) throw new DbFout('ZELFDE_ONDERDEEL_DUBBEL');

  const open = [...keuzeOpen.entries()].filter(([, o]) => o).map(([dd]) => dd);
  if (open.length) {
    const verplicht = await db
      .prepare(`select tijdsblok_id from tijdsblokken where type = 'keuze' and verplicht = 1 and dagdeel_id in (${plaatshouders(open.length)})`)
      .bind(...open)
      .all<{ tijdsblok_id: string }>();
    if (verplicht.results.some((t) => !gekozen.some((s) => s.tijdsblok_id === t.tijdsblok_id))) throw new DbFout('VERPLICHT_TIJDSBLOK_ONTBREEKT');
  }

  const weg = huidig.filter((h) => keuzeOpen.get(h.dagdeel_id) && !sessies.includes(h.sessie_id));
  const erbij = gekozen.filter((s) => !alGekozen.has(s.sessie_id));
  if (!weg.length && !erbij.length) return { gewijzigd: false };

  try {
    await schrijf(db, [
      // Eerst de oude keuzes vrijgeven, zodat de unieke index (één keuze per tijdsblok) de nieuwe toelaat
      ...weg.map((h) => db.prepare(`update inschrijvingen set status = 'geannuleerd' where inschrijving_id = ?`).bind(h.inschrijving_id)),
      ...erbij.map((s) =>
        db
          .prepare(
            `insert into inschrijvingen (inschrijving_id, deelnemer_id, evenement_id, dag_id, dagdeel_id, tijdsblok_id, sessie_id, status)
             select ?1, ?2, d.evenement_id, dd.dag_id, dd.dagdeel_id, s.tijdsblok_id, s.sessie_id, ${STATUS_SESSIE}
             from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
             join evenement_dagen d on d.dag_id = dd.dag_id
             where s.sessie_id = ?3`,
          )
          .bind(crypto.randomUUID(), id, s.sessie_id),
      ),
      ...weg.map((h) => promoveerWachtlijst(db, h.sessie_id)),
      door(db, id, 'ouder'),
    ]);
  } catch (fout) {
    if (fout instanceof DbFout) await welkeIsVolzet(env, fout, [], erbij.map((s) => s.sessie_id));
    throw fout;
  }
  return { gewijzigd: true };
}

/**
 * Alles voor een mail met het actuele overzicht en de QR-code (wijziging door ouder of school, QR voor een oude
 * inschrijving). Null voor een geannuleerde of geanonimiseerde inschrijving of een zonder e-mailadres.
 * Een inschrijving van vóór de QR-code krijgt hier haar check-intoken.
 */
export async function mailGegevens(env: Env, deelnemerId: string) {
  const db = env.DB;
  const dn = await db
    .prepare(
      `select dn.email_enc, dn.voornaam_enc, dn.checkin_token, dn.checkin_versie, e.evenement_id, e.titel, e.slug, e.contact_email
       from deelnemers dn join evenementen e on e.evenement_id = dn.evenement_id
       where dn.deelnemer_id = ? and dn.status = 'actief' and dn.geanonimiseerd_op is null`,
    )
    .bind(deelnemerId)
    .first<{ email_enc: string | null; voornaam_enc: string | null; checkin_token: string | null; checkin_versie: number; evenement_id: string; titel: string; slug: string; contact_email: string | null }>();
  if (!dn?.email_enc) return null;
  if (!dn.checkin_token) {
    await db.prepare(`update deelnemers set checkin_token = ? where deelnemer_id = ? and checkin_token is null`).bind(nieuwToken(), deelnemerId).run();
    const r = await db.prepare(`select checkin_token from deelnemers where deelnemer_id = ?`).bind(deelnemerId).first<{ checkin_token: string }>();
    dn.checkin_token = r!.checkin_token;
  }
  const [momenten, keuzes] = await db.batch<any>([
    db
      .prepare(
        `select dd.dagdeel_id as dagdeelId, d.naam as dag, dd.naam as dagdeel, dd.start_uur as startUur, dd.eind_uur as eindUur, i.status
         from inschrijvingen i join dagdelen dd on dd.dagdeel_id = i.dagdeel_id join evenement_dagen d on d.dag_id = i.dag_id
         where i.deelnemer_id = ? and i.sessie_id is null and i.status <> 'geannuleerd'
         order by d.datum, dd.start_uur`,
      )
      .bind(deelnemerId),
    db
      .prepare(
        `select s.sessie_id as sessieId, s.titel, t.naam as tijdsblok, t.start_uur as startUur, l.naam as locatie, i.status
         from inschrijvingen i join sessies s on s.sessie_id = i.sessie_id join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
         left join locaties l on l.locatie_id = s.locatie_id
         where i.deelnemer_id = ? and i.status <> 'geannuleerd'
         order by t.start_uur`,
      )
      .bind(deelnemerId),
  ]);
  return {
    deelnemerId,
    evenementId: dn.evenement_id,
    email: (await ontsleutel(env, dn.email_enc))!,
    voornaam: (await ontsleutel(env, dn.voornaam_enc)) ?? '',
    evenement: dn.titel,
    slug: dn.slug,
    contactEmail: dn.contact_email,
    referentie: referentie(deelnemerId),
    momenten: momenten.results as Moment[],
    keuzes: keuzes.results as Keuze[],
    checkin: { token: dn.checkin_token, versie: dn.checkin_versie },
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
