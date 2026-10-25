import { ontsleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { personenVan } from '../../kern/contacten';
import { DbFout } from '../../kern/fouten';
import { controleerToegang, heeftRecht, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { schooljaarVan } from './importeren';

/**
 * Overzicht van één evenement: wie schreef vooraf in (voorinschrijvingen gekoppeld aan dit evenement), wie schreef in
 * voor de infodag, wanneer, met welke lesjes, van welke school en welk leerjaar. Per kind ook de historiek over de
 * schooljaren heen en de broers en zussen (andere kinderen van hetzelfde contact). Enkel evenementen waar de
 * medewerker toegang toe heeft, tellen mee in de historiek.
 */

const json = (x: unknown) => JSON.stringify(x);

/** Evenementen die deze medewerker mag lezen (zelfde regels als controleerToegang). */
async function leesbareEvenementen(env: Env, g: Gebruiker) {
  const { results } = await env.DB.prepare(
    `select e.evenement_id as id, e.titel, e.start_datum as start from evenementen e
     where ?1 = 'platformbeheerder'
        or exists (select 1 from evenement_beheerders b where b.evenement_id = e.evenement_id and b.gebruiker_id = ?2)
        or (?1 = 'schoolbeheerder' and e.school_id = ?3)`,
  )
    .bind(g.rol, g.gebruikerId, g.schoolId)
    .all<{ id: string; titel: string; start: string }>();
  return new Map(results.map((e) => [e.id, { titel: e.titel, schooljaar: schooljaarVan(e.start) }]));
}

/** Voorinschrijvingen horen bij een evenement via de import, of via het formulier waarmee ze verzameld werden. */
const VOORINSCHRIJVING_EVENEMENT = `coalesce(vi.evenement_id, vf.evenement_id)`;
const VOORINSCHRIJVING_JOIN = `join voorinschrijvingen_importen vi on vi.import_id = v.import_id
  left join voorinschrijvingen_formulieren vf on vf.import_id = v.import_id`;

export async function overzicht(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId);
  const db = env.DB;
  const leesbaar = await leesbareEvenementen(env, g);
  const ev = leesbaar.get(evenementId);
  if (!ev) throw new DbFout('GEEN_TOEGANG');

  const [deelnemers, inschrijvingen, voorinschrijvingen] = await db.batch<any>([
    db.prepare(
      `select d.deelnemer_id, d.persoon_id, d.contact_id, d.voornaam_enc, d.naam_enc, d.created_at, d.leerjaar, d.status, d.geanonimiseerd_op,
              d.school_id, coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), '') as school, d.school_andere_enc, gr.naam as doelgroep,
              d.email_enc, d.contact_voornaam_enc
       from deelnemers d left join scholen s on s.school_id = d.school_id left join doelgroepen gr on gr.doelgroep_id = d.doelgroep_id
       where d.evenement_id = ?`,
    ).bind(evenementId),
    db.prepare(
      `select i.deelnemer_id, i.sessie_id, i.status, i.aanwezig, i.klas_status, i.dagdeel_id, dg.naam as dag, dg.datum, dd.naam as dagdeel,
              t.naam as tijdsblok, t.start_uur, s.titel
       from inschrijvingen i join evenement_dagen dg on dg.dag_id = i.dag_id join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
       left join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id left join sessies s on s.sessie_id = i.sessie_id
       join deelnemers d on d.deelnemer_id = i.deelnemer_id
       where i.evenement_id = ? and (i.status <> 'geannuleerd' or d.status = 'geannuleerd')
       order by dg.datum, dd.start_uur, t.start_uur`,
    ).bind(evenementId),
    db.prepare(
      `select v.id, v.persoon_id, v.contact_id, v.kind_naam_enc, v.ingediend_op, v.klas, v.schooljaar, v.school_id,
              coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), v.school_andere, '') as school
       from voorinschrijvingen v ${VOORINSCHRIJVING_JOIN} left join scholen s on s.school_id = v.school_id
       where ${VOORINSCHRIJVING_EVENEMENT} = ?`,
    ).bind(evenementId),
  ]);

  const perDeelnemer = new Map<string, any[]>();
  for (const i of inschrijvingen.results as any[]) perDeelnemer.set(i.deelnemer_id, [...(perDeelnemer.get(i.deelnemer_id) ?? []), i]);
  const ingeschrevenPersonen = new Set((deelnemers.results as any[]).filter((d) => d.status === 'actief' && d.persoon_id).map((d) => d.persoon_id as string));
  const voorPersonen = new Set((voorinschrijvingen.results as any[]).map((v) => v.persoon_id).filter(Boolean));

  const lijstInschrijvingen = await Promise.all(
    (deelnemers.results as any[]).map(async (d) => {
      const eigen = perDeelnemer.get(d.deelnemer_id) ?? [];
      return {
        id: d.deelnemer_id as string,
        persoonId: d.persoon_id as string | null,
        contactId: d.contact_id as string | null,
        voornaam: d.geanonimiseerd_op ? null : await ontsleutel(env, d.voornaam_enc),
        naam: d.geanonimiseerd_op ? '(geanonimiseerd)' : await ontsleutel(env, d.naam_enc),
        email: d.geanonimiseerd_op ? null : await ontsleutel(env, d.email_enc),
        ouder: d.geanonimiseerd_op ? null : await ontsleutel(env, d.contact_voornaam_enc),
        ingeschrevenOp: d.created_at as string,
        status: d.status as string,
        school: (d.school || (await ontsleutel(env, d.school_andere_enc)) || '') as string,
        leerjaar: d.leerjaar as string | null,
        doelgroep: d.doelgroep as string | null,
        momenten: eigen.filter((i) => !i.sessie_id).map((i) => ({ id: i.dagdeel_id, dag: i.dag, datum: i.datum, dagdeel: i.dagdeel, aanwezig: !!i.aanwezig })),
        lesjes: eigen.filter((i) => i.sessie_id).map((i) => ({
          id: i.sessie_id, tijdsblok: i.tijdsblok, start: i.start_uur, titel: i.titel, wachtlijst: i.status === 'wachtlijst', klas: i.klas_status,
        })),
        voorinschrijving: !!d.persoon_id && voorPersonen.has(d.persoon_id),
      };
    }),
  );

  const lijstVoor = await Promise.all(
    (voorinschrijvingen.results as any[]).map(async (v) => ({
      id: v.id as string,
      persoonId: v.persoon_id as string | null,
      contactId: v.contact_id as string | null,
      /** Enkel als er geen persoon is (zonder e-mailadres); anders komt de naam uit `personen`. */
      naam: v.persoon_id ? null : await ontsleutel(env, v.kind_naam_enc),
      ingediendOp: v.ingediend_op as string | null,
      school: v.school as string,
      klas: v.klas as string | null,
      schooljaar: v.schooljaar as string | null,
      ingeschreven: !!v.persoon_id && ingeschrevenPersonen.has(v.persoon_id),
    })),
  );

  const historiek = await gezinshistoriek(env, g, leesbaar, [
    ...lijstInschrijvingen.map((x) => x.contactId),
    ...lijstVoor.map((x) => x.contactId),
  ]);
  await audit(env, g, 'evenementen', evenementId, 'OVERZICHT', undefined, ip).run();
  return { evenement: { id: evenementId, ...ev }, inschrijvingen: lijstInschrijvingen, voorinschrijvingen: lijstVoor, ...historiek };
}

export interface HistoriekItem {
  soort: 'inschrijving' | 'voorinschrijving';
  evenementId: string | null;
  evenement: string | null;
  schooljaar: string | null;
  datum: string | null;
  school: string | null;
  leerjaar: string | null;
  /** Inschrijving: moment en lesjes; voorinschrijving: gewenst schooljaar. */
  detail: string | null;
  aanwezig?: boolean;
  geannuleerd?: boolean;
}

/**
 * Alle kinderen van deze contacten (gezinnen) met hun inschrijvingen en voorinschrijvingen over de jaren heen.
 * Voorinschrijvingen zonder evenement zie je enkel met het recht voorinschrijvingen.beheren.
 */
async function gezinshistoriek(env: Env, g: Gebruiker, leesbaar: Map<string, { titel: string; schooljaar: string }>, contacten: (string | null)[]) {
  const ids = [...new Set(contacten.filter((x): x is string => !!x))];
  const personenPerContact = await personenVan(env, ids);
  const personen: Record<string, { naam: string; contactId: string }> = {};
  const gezinnen: Record<string, string[]> = {};
  for (const [c, lijst] of personenPerContact) {
    gezinnen[c] = lijst.map((p) => p.persoonId);
    for (const p of lijst) personen[p.persoonId] = { naam: [p.voornaam, p.naam].filter(Boolean).join(' ') || '(zonder naam)', contactId: c };
  }
  const items: Record<string, HistoriekItem[]> = {};
  const voeg = (persoonId: string, item: HistoriekItem) => (items[persoonId] ??= []).push(item);
  const alleVoorinschrijvingen = heeftRecht(g, 'voorinschrijvingen.beheren');

  const db = env.DB;
  for (let i = 0; i < ids.length; i += 300) {
    const deel = json(ids.slice(i, i + 300));
    const [dn, ins, vi] = await db.batch<any>([
      db.prepare(
        `select d.deelnemer_id, d.persoon_id, d.evenement_id, d.created_at, d.leerjaar, d.status,
                coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), '') as school
         from deelnemers d left join scholen s on s.school_id = d.school_id
         where d.contact_id in (select value from json_each(?)) and d.persoon_id is not null`,
      ).bind(deel),
      db.prepare(
        `select i.deelnemer_id, i.sessie_id, i.aanwezig, dg.naam as dag, dd.naam as dagdeel, s.titel
         from inschrijvingen i join deelnemers d on d.deelnemer_id = i.deelnemer_id
         join evenement_dagen dg on dg.dag_id = i.dag_id join dagdelen dd on dd.dagdeel_id = i.dagdeel_id
         left join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id left join sessies s on s.sessie_id = i.sessie_id
         where d.contact_id in (select value from json_each(?)) and i.status <> 'geannuleerd'
         order by dg.datum, dd.start_uur, t.start_uur`,
      ).bind(deel),
      db.prepare(
        `select v.persoon_id, v.ingediend_op, v.klas, v.schooljaar, ${VOORINSCHRIJVING_EVENEMENT} as evenement_id,
                coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), v.school_andere, '') as school
         from voorinschrijvingen v ${VOORINSCHRIJVING_JOIN} left join scholen s on s.school_id = v.school_id
         where v.contact_id in (select value from json_each(?)) and v.persoon_id is not null`,
      ).bind(deel),
    ]);
    const perDn = new Map<string, any[]>();
    for (const x of ins.results as any[]) perDn.set(x.deelnemer_id, [...(perDn.get(x.deelnemer_id) ?? []), x]);
    for (const d of dn.results as any[]) {
      const e = leesbaar.get(d.evenement_id);
      if (!e) continue;
      const rijen = perDn.get(d.deelnemer_id) ?? [];
      const momenten = rijen.filter((x) => !x.sessie_id);
      const lesjes = rijen.filter((x) => x.sessie_id).map((x) => x.titel);
      voeg(d.persoon_id, {
        soort: 'inschrijving',
        evenementId: d.evenement_id,
        evenement: e.titel,
        schooljaar: e.schooljaar,
        datum: d.created_at,
        school: d.school || null,
        leerjaar: d.leerjaar,
        detail: [momenten.map((m) => `${m.dag} ${m.dagdeel.toLowerCase()}`).join(', '), lesjes.join(', ')].filter(Boolean).join(' · ') || null,
        aanwezig: momenten.some((m) => m.aanwezig),
        geannuleerd: d.status !== 'actief',
      });
    }
    for (const v of vi.results as any[]) {
      const e = v.evenement_id ? leesbaar.get(v.evenement_id) : undefined;
      if (!e && !alleVoorinschrijvingen) continue;
      voeg(v.persoon_id, {
        soort: 'voorinschrijving',
        evenementId: e ? v.evenement_id : null,
        evenement: e?.titel ?? null,
        schooljaar: e?.schooljaar ?? (v.ingediend_op ? schooljaarVan(v.ingediend_op.slice(0, 10)) : null),
        datum: v.ingediend_op,
        school: v.school || null,
        leerjaar: v.klas,
        detail: v.schooljaar,
      });
    }
  }
  for (const lijst of Object.values(items)) lijst.sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''));
  return { personen, gezinnen, historiek: items };
}
