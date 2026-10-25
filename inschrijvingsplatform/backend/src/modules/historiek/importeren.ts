import { blindeIndex, versleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { bewaarPersonenStmts, planPersonen } from '../../kern/contacten';
import { DbFout } from '../../kern/fouten';
import { isToegelatenEmail } from '../../kern/installatie';
import { controleerToegang, heeftRecht, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { vandaag } from '../evenementen/capaciteit';

/**
 * Inschrijvingen van vorige jaren (bv. een export van Google Formulieren) in een evenement zetten, met het programma
 * dat eruit blijkt: dagen, dagdelen, tijdsblokken en lesjes worden aangemaakt waar ze nog niet bestaan. Zo kan je
 * per kind zien wie vooraf inschreef, wie kwam, en wat broers en zussen deden. De frontend leest het bestand en
 * koppelt kolommen, scholen en kinderen; hier wordt gevalideerd, versleuteld en in één batch bewaard.
 */

export const MAX_RIJEN = 3000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const UUR = /^([01]\d|2[0-3]):[0-5]\d$/;

const tekst = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const geldigEmail = (v: unknown) => {
  const e = tekst(v, 254)?.toLowerCase() ?? null;
  return e && EMAIL.test(e) ? e : null;
};
const isoDatum = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const sleutelVan = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9:_-]{1,40}$/.test(v) ? v : null);
const gelijk = (a: string, b: string) => a.trim().toLocaleLowerCase('nl') === b.trim().toLocaleLowerCase('nl');
const perDeel = <T>(lijst: T[], n: number) => Array.from({ length: Math.ceil(lijst.length / n) }, (_, i) => lijst.slice(i * n, i * n + n));

/** "2024-2025" → het schooljaar loopt van 1 september 2024 tot 31 augustus 2025. */
export function schooljaarVan(datum: string): string {
  const [j, m] = datum.split('-').map(Number);
  const begin = m >= 9 ? j : j - 1;
  return `${begin}-${begin + 1}`;
}

// ---------------------------------------------------------------------------
// Nieuw evenement voor een vorig schooljaar
// ---------------------------------------------------------------------------

/**
 * Een gearchiveerd evenement (niet zichtbaar voor ouders) om de gegevens van een vorig schooljaar in te zetten.
 * De datums volgen na de import uit de dagen; "bewaren tot" blijft daarbij hetzelfde (zie bijwerkenNaImport).
 */
export async function maakVorigEvenement(env: Env, g: Gebruiker, body: any, ip: string | null) {
  if (!heeftRecht(g, 'evenementen.aanmaken')) throw new DbFout('GEEN_TOEGANG');
  const sj = typeof body?.schooljaar === 'string' ? /^(\d{4})-(\d{4})$/.exec(body.schooljaar) : null;
  const titel = tekst(body?.titel, 200);
  const slug = tekst(body?.slug, 80);
  const bewaarTot = typeof body?.bewaarTot === 'string' && DATUM.test(body.bewaarTot) ? body.bewaarTot : null;
  const fouten: Record<string, string> = {};
  if (!sj || Number(sj[2]) !== Number(sj[1]) + 1) fouten.schooljaar = 'Kies een schooljaar, bv. 2024-2025.';
  if (!titel) fouten.titel = 'Geef het evenement een titel.';
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fouten.slug = 'Enkel kleine letters, cijfers en streepjes.';
  if (!bewaarTot || bewaarTot <= vandaag()) fouten.bewaarTot = 'Kies een datum in de toekomst: daarna worden de gegevens automatisch geanonimiseerd.';
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);

  // Voorlopige datum (midden van het schooljaar); de import zet de echte datums.
  const datum = `${sj![2]}-01-15`;
  const dagen = Math.round((Date.parse(bewaarTot!) - Date.parse(datum)) / 86_400_000);
  const id = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `insert into evenementen (evenement_id, slug, titel, type_evenement, start_datum, eind_datum, status, deelnemer_type,
                                  bewaartermijn_dagen, opmerkingen, created_by)
         values (?, ?, ?, 'Infodag', ?, ?, 'gearchiveerd', 'leerling', ?, ?, ?)`,
      ).bind(id, slug, titel, datum, datum, dagen, `Gegevens van schooljaar ${sj![0]}, geïmporteerd.`, g.gebruikerId),
      audit(env, g, 'evenementen', id, 'AANMAKEN', { schooljaar: sj![0], vorigJaar: true }, ip),
    ]);
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new ValidatieFout({ slug: 'Dit adres is al in gebruik door een ander evenement.' });
    throw e;
  }
  return { id };
}

// ---------------------------------------------------------------------------
// Inschrijvingen importeren
// ---------------------------------------------------------------------------

interface SessieIn { sleutel: string; titel: string }
interface TijdsblokIn { sleutel: string; naam: string; start: string; eind: string; sessies: SessieIn[] }
interface DagdeelIn { sleutel: string; naam: string; start: string; eind: string; tijdsblokken: TijdsblokIn[] }
interface DagIn { sleutel: string; naam: string; datum: string; dagdelen: DagdeelIn[] }

export interface InschrijvingRij {
  ingediendOp?: string | null;
  email?: string | null;
  ouderVoornaam?: string | null;
  ouderNaam?: string | null;
  telefoon?: string | null;
  kindVoornaam?: string | null;
  kindNaam?: string | null;
  schoolId?: string | null;
  schoolAndere?: string | null;
  leerjaar?: string | null;
  doelgroep?: string | null;
  /** Sleutel van een dagdeel uit het programma. */
  dagdeel?: string | null;
  /** Sleutels van sessies uit het programma (hoogstens één per tijdsblok). */
  sessies?: string[];
  aanwezig?: boolean;
  opmerkingen?: string | null;
  persoonKeuze?: string | null;
}

/** Rijen zonder moment worden niet geïmporteerd; ze tellen ook niet mee bij het herkennen van kinderen. */
const telt = (r: InschrijvingRij) => !!sleutelVan(r.dagdeel);

function leesProgramma(x: unknown): DagIn[] {
  const fout = (m: string) => new ValidatieFout({ programma: m });
  if (!Array.isArray(x) || x.length > 30) throw fout('Ongeldig programma.');
  const uur = (v: unknown) => {
    if (typeof v !== 'string' || !UUR.test(v)) throw fout(`Ongeldig uur "${String(v)}".`);
    return v;
  };
  const sleutel = (v: unknown) => sleutelVan(v) ?? (() => { throw fout('Ongeldige sleutel.'); })();
  const naam = (v: unknown, wat: string) => tekst(v, 200) ?? (() => { throw fout(`${wat} zonder naam.`); })();
  return x.map((d: any) => {
    if (typeof d?.datum !== 'string' || !DATUM.test(d.datum)) throw fout(`Dag "${String(d?.naam)}" heeft geen geldige datum.`);
    return {
      sleutel: sleutel(d.sleutel),
      naam: naam(d.naam, 'Een dag'),
      datum: d.datum,
      dagdelen: (Array.isArray(d.dagdelen) ? d.dagdelen.slice(0, 10) : []).map((dd: any) => {
        const [start, eind] = [uur(dd.start), uur(dd.eind)];
        if (eind <= start) throw fout(`Dagdeel "${dd.naam}": het einde moet na het begin liggen.`);
        return {
          sleutel: sleutel(dd.sleutel),
          naam: naam(dd.naam, 'Een dagdeel'),
          start,
          eind,
          tijdsblokken: (Array.isArray(dd.tijdsblokken) ? dd.tijdsblokken.slice(0, 20) : []).map((t: any) => {
            const [ts, te] = [uur(t.start), uur(t.eind)];
            if (te <= ts) throw fout(`Tijdsblok "${t.naam}": het einde moet na het begin liggen.`);
            return {
              sleutel: sleutel(t.sleutel),
              naam: naam(t.naam, 'Een tijdsblok'),
              start: ts,
              eind: te,
              sessies: (Array.isArray(t.sessies) ? t.sessies.slice(0, 60) : []).map((s: any) => ({ sleutel: sleutel(s.sleutel), titel: naam(s.titel, 'Een lesje') })),
            };
          }),
        };
      }),
    };
  });
}

/** Code van een lesje: dezelfde code in een ander tijdsblok = hetzelfde lesje (niet twee keer te kiezen). */
const lesCode = (titel: string) =>
  titel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || null;

/**
 * Zoekt het programma op in het evenement (dag op datum, dagdeel en tijdsblok op naam, lesje op titel) en maakt aan
 * wat ontbreekt. Geeft de id's per sleutel en de instructies om de nieuwe onderdelen te bewaren.
 */
async function programmaIds(env: Env, g: Gebruiker, evenementId: string, programma: DagIn[]) {
  const db = env.DB;
  const [dagen, dagdelen, tijdsblokken, sessies] = await db.batch<any>([
    db.prepare(`select dag_id, datum, naam, start_uur, eind_uur from evenement_dagen where evenement_id = ?`).bind(evenementId),
    db.prepare(`select dd.dagdeel_id, dd.dag_id, dd.naam from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ?`).bind(evenementId),
    db.prepare(
      `select t.tijdsblok_id, t.dagdeel_id, t.naam from tijdsblokken t join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ?`,
    ).bind(evenementId),
    db.prepare(
      `select s.sessie_id, s.tijdsblok_id, s.titel from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ?`,
    ).bind(evenementId),
  ]);
  const ids = new Map<string, string>();
  /** Per dagdeel- en sessiesleutel ook de bovenliggende id's (voor de inschrijvingen). */
  const ouders = new Map<string, { dag: string; dagdeel: string; tijdsblok?: string }>();
  const stmts: D1PreparedStatement[] = [];
  const nieuw = { dagen: 0, dagdelen: 0, tijdsblokken: 0, sessies: 0 };

  for (const [di, d] of programma.entries()) {
    const uren = d.dagdelen.flatMap((dd) => [dd.start, dd.eind]).sort();
    let dagId = (dagen.results as any[]).find((x) => x.datum === d.datum)?.dag_id as string | undefined;
    if (!dagId) {
      dagId = crypto.randomUUID();
      stmts.push(
        db.prepare(`insert into evenement_dagen (dag_id, evenement_id, naam, datum, start_uur, eind_uur, volgorde) values (?, ?, ?, ?, ?, ?, ?)`)
          .bind(dagId, evenementId, d.naam, d.datum, uren[0] ?? '09:00', uren[uren.length - 1] ?? '17:00', di + 1),
      );
      nieuw.dagen++;
    } else if (uren.length) {
      // Bestaande dag: de uren verruimen als het nieuwe dagdeel erbuiten valt.
      stmts.push(
        db.prepare(`update evenement_dagen set start_uur = min(start_uur, ?), eind_uur = max(eind_uur, ?) where dag_id = ?`).bind(uren[0], uren[uren.length - 1], dagId),
      );
    }
    ids.set(d.sleutel, dagId);

    for (const [ddi, dd] of d.dagdelen.entries()) {
      let ddId = (dagdelen.results as any[]).find((x) => x.dag_id === dagId && gelijk(x.naam, dd.naam))?.dagdeel_id as string | undefined;
      if (!ddId) {
        ddId = crypto.randomUUID();
        stmts.push(
          db.prepare(`insert into dagdelen (dagdeel_id, dag_id, naam, start_uur, eind_uur, volgorde) values (?, ?, ?, ?, ?, ?)`)
            .bind(ddId, dagId, dd.naam, dd.start, dd.eind, ddi + 1),
        );
        nieuw.dagdelen++;
      }
      ids.set(dd.sleutel, ddId);
      ouders.set(dd.sleutel, { dag: dagId, dagdeel: ddId });

      for (const [ti, t] of dd.tijdsblokken.entries()) {
        let tId = (tijdsblokken.results as any[]).find((x) => x.dagdeel_id === ddId && gelijk(x.naam, t.naam))?.tijdsblok_id as string | undefined;
        if (!tId) {
          tId = crypto.randomUUID();
          stmts.push(
            db.prepare(`insert into tijdsblokken (tijdsblok_id, dagdeel_id, naam, start_uur, eind_uur, volgorde, type) values (?, ?, ?, ?, ?, ?, 'keuze')`)
              .bind(tId, ddId, t.naam, t.start, t.eind, ti + 1),
          );
          nieuw.tijdsblokken++;
        }
        for (const [si, s] of t.sessies.entries()) {
          let sId = (sessies.results as any[]).find((x) => x.tijdsblok_id === tId && gelijk(x.titel, s.titel))?.sessie_id as string | undefined;
          if (!sId) {
            sId = crypto.randomUUID();
            stmts.push(
              db.prepare(
                `insert into sessies (sessie_id, tijdsblok_id, code, titel, status, volgorde, created_by) values (?, ?, ?, ?, 'gesloten', ?, ?)`,
              ).bind(sId, tId, lesCode(s.titel), s.titel, si + 1, g.gebruikerId),
            );
            nieuw.sessies++;
          }
          ids.set(s.sleutel, sId);
          ouders.set(s.sleutel, { dag: dagId, dagdeel: ddId, tijdsblok: tId });
        }
      }
    }
  }
  return { ids, ouders, stmts, nieuw };
}

export async function importeerInschrijvingen(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const ev = await env.DB.prepare(`select eind_datum, bewaartermijn_dagen, deelnemer_type from evenementen where evenement_id = ?`)
    .bind(evenementId)
    .first<{ eind_datum: string; bewaartermijn_dagen: number; deelnemer_type: string }>();
  if (!ev) throw new DbFout('GEEN_TOEGANG');
  // Zonder deze controle zou de dagelijkse taak (anonimiseerVerlopenEvenementen) alles vannacht weer wissen.
  const grens = new Date(Date.parse(ev.eind_datum) + ev.bewaartermijn_dagen * 86_400_000).toISOString().slice(0, 10);
  if (grens < vandaag()) throw new DbFout('BEWAARTERMIJN_VERSTREKEN');

  const rijen: InschrijvingRij[] = Array.isArray(body?.rijen) ? body.rijen : [];
  if (!rijen.length) throw new ValidatieFout({ rijen: 'Er zijn geen rijen om te importeren.' });
  if (rijen.length > MAX_RIJEN) throw new ValidatieFout({ rijen: `Maximaal ${MAX_RIJEN} rijen per import.` });
  const programma = leesProgramma(body?.programma);

  const schoolIds = [...new Set(rijen.map((r) => r.schoolId).filter((x): x is string => typeof x === 'string' && !!x))];
  const { results: bekend } = await env.DB.prepare(`select school_id from scholen where school_id in (select value from json_each(?))`)
    .bind(JSON.stringify(schoolIds))
    .all<{ school_id: string }>();
  if (bekend.length !== schoolIds.length) throw new ValidatieFout({ rijen: 'Een gekozen school staat niet in de lijst. Vernieuw de pagina en probeer opnieuw.' });

  const prog = await programmaIds(env, g, evenementId, programma);

  // Doelgroepen (bv. A-stroom, B-stroom) op naam; ontbrekende worden aangemaakt.
  const { results: groepen } = await env.DB.prepare(`select doelgroep_id, naam from doelgroepen where evenement_id = ?`).bind(evenementId).all<{ doelgroep_id: string; naam: string }>();
  const groepId = new Map(groepen.map((x) => [x.naam.toLocaleLowerCase('nl'), x.doelgroep_id]));
  const groepStmts: D1PreparedStatement[] = [];
  for (const naam of new Set(rijen.map((r) => tekst(r.doelgroep, 100)).filter((x): x is string => !!x))) {
    if (groepId.has(naam.toLocaleLowerCase('nl'))) continue;
    const id = crypto.randomUUID();
    groepId.set(naam.toLocaleLowerCase('nl'), id);
    groepStmts.push(env.DB.prepare(`insert into doelgroepen (doelgroep_id, evenement_id, naam, volgorde) values (?, ?, ?, ?)`).bind(id, evenementId, naam, groepId.size));
  }

  // Kinderen herkennen over alle rijen (zoals in de nakijkstap), daarna pas dubbels weglaten.
  const invoer = rijen.map((r) => ({
    email: telt(r) ? geldigEmail(r.email) : null,
    voornaam: tekst(r.kindVoornaam, 100),
    naam: tekst(r.kindNaam, 200),
    persoonKeuze: r.persoonKeuze,
    telefoon: tekst(r.telefoon, 40),
    contactVoornaam: tekst(r.ouderVoornaam, 100),
    contactNaam: tekst(r.ouderNaam, 100),
  }));
  const plannen = await planPersonen(env, invoer, true);
  const personen = await bewaarPersonenStmts(env, invoer, plannen);

  // Per kind de laatste inzending (ouders vulden het formulier soms opnieuw in om iets te wijzigen).
  const dubbel = await Promise.all(
    invoer.map((r) => (r.email && r.voornaam && r.naam ? blindeIndex(env, 'dubbel', evenementId, r.email, r.naam.toLowerCase(), r.voornaam.toLowerCase()) : null)),
  );
  // Al in het evenement (bv. een vorige import van een deel van de lijst): de nieuwste inzending telt.
  const { results: alInEvenement } = await env.DB.prepare(
    `select deelnemer_id, dubbel_hash, created_at, status from deelnemers where evenement_id = ? and dubbel_hash in (select value from json_each(?))`,
  )
    .bind(evenementId, JSON.stringify(dubbel.filter(Boolean)))
    .all<{ deelnemer_id: string; dubbel_hash: string; created_at: string; status: string }>();
  const bestaand = new Map(alInEvenement.filter((x) => x.status === 'actief').map((x) => [x.dubbel_hash, x]));
  // Dezelfde inzending (zelfde kind, zelfde tijdstip) staat er al, actief of vervangen: niet opnieuw.
  const alGeimporteerd = new Set(alInEvenement.map((x) => `${x.dubbel_hash}|${x.created_at}`));
  const metHash = new Set(alInEvenement.map((x) => x.dubbel_hash));
  const volgorde = rijen
    .map((r, i) => ({ i, op: isoDatum(r.ingediendOp) ?? '' }))
    .filter(({ i }) => telt(rijen[i]))
    .sort((a, b) => a.op.localeCompare(b.op) || a.i - b.i);
  const laatste = new Map<string, number>();
  for (const { i } of volgorde) if (dubbel[i]) laatste.set(dubbel[i]!, i);

  const verslag = { geimporteerd: 0, vervangen: 0, dubbelInBestand: 0, alIngeschreven: 0, zonderNaam: 0, zonderMoment: 0, lesjes: 0 };
  const nu = new Date().toISOString();
  const dnRijen = [];
  const insRijen = [];
  const vervangen: string[] = [];
  for (let i = 0; i < rijen.length; i++) {
    const r = rijen[i];
    const k = invoer[i];
    if (!k.voornaam && !k.naam) { verslag.zonderNaam++; continue; }
    const dd = sleutelVan(r.dagdeel);
    const plaats = dd ? prog.ouders.get(dd) : undefined;
    if (!plaats) { verslag.zonderMoment++; continue; }
    const tijdstip = isoDatum(r.ingediendOp);
    // Zo kan je dezelfde (of een aangevulde) lijst opnieuw importeren zonder dubbels.
    if (dubbel[i] && (tijdstip ? alGeimporteerd.has(`${dubbel[i]}|${tijdstip}`) : metHash.has(dubbel[i]!))) { verslag.alIngeschreven++; continue; }
    const vorige = dubbel[i] ? bestaand.get(dubbel[i]!) : undefined;
    // Een oudere inzending van hetzelfde kind blijft bewaard als geannuleerd: zo zie je bij de dubbels wat er veranderde
    // (bv. eerst A-stroom, later B-stroom) en kan je het navragen.
    const ouder = !!dubbel[i] && (laatste.get(dubbel[i]!) !== i || (!!vorige && (!tijdstip || tijdstip <= vorige.created_at)));
    if (ouder) verslag.dubbelInBestand++;
    else if (vorige) {
      vervangen.push(vorige.deelnemer_id);
      verslag.vervangen++;
    }

    const id = crypto.randomUUID();
    const op = isoDatum(r.ingediendOp) ?? nu;
    const schoolId = typeof r.schoolId === 'string' && r.schoolId ? r.schoolId : null;
    dnRijen.push({
      id,
      groep: groepId.get(tekst(r.doelgroep, 100)?.toLocaleLowerCase('nl') ?? '') ?? null,
      naam: await versleutel(env, k.naam),
      voornaam: await versleutel(env, k.voornaam),
      email: await versleutel(env, k.email),
      cvoornaam: await versleutel(env, k.contactVoornaam),
      cnaam: await versleutel(env, k.contactNaam),
      tel: await versleutel(env, k.telefoon),
      andere: schoolId ? null : await versleutel(env, tekst(r.schoolAndere, 200)),
      opm: await versleutel(env, tekst(r.opmerkingen, 2000)),
      ehash: plannen[i].emailSleutel ?? null,
      dhash: dubbel[i],
      status: ouder ? 'geannuleerd' : 'actief',
      school: schoolId,
      leerjaar: tekst(r.leerjaar, 60),
      op,
      contact: personen.contactIds[i],
      persoon: personen.persoonIds[i],
    });
    const status = ouder ? 'geannuleerd' : 'bevestigd';
    insRijen.push({ id: crypto.randomUUID(), dn: id, dag: plaats.dag, dagdeel: plaats.dagdeel, tb: null, sessie: null, op, status, aanwezig: !ouder && r.aanwezig === true ? 1 : 0 });
    const tijdsblokken = new Set<string>();
    for (const s of Array.isArray(r.sessies) ? r.sessies.slice(0, 20) : []) {
      const sl = sleutelVan(s);
      const p = sl ? prog.ouders.get(sl) : undefined;
      // Enkel lesjes van het eigen dagdeel, en één per tijdsblok.
      if (!p?.tijdsblok || p.dagdeel !== plaats.dagdeel || tijdsblokken.has(p.tijdsblok)) continue;
      tijdsblokken.add(p.tijdsblok);
      insRijen.push({ id: crypto.randomUUID(), dn: id, dag: p.dag, dagdeel: p.dagdeel, tb: p.tijdsblok, sessie: prog.ids.get(sl!), op, status, aanwezig: 0 });
      if (!ouder) verslag.lesjes++;
    }
    if (!vorige && !ouder) verslag.geimporteerd++;
  }

  const db = env.DB;
  const v = (veld: string) => `json_extract(j.value, '$.${veld}')`;
  const stmts: D1PreparedStatement[] = [...prog.stmts, ...groepStmts, ...personen.stmts];
  // Vervangen inschrijvingen blijven bestaan als geannuleerd (zichtbaar bij de dubbels in het overzicht).
  if (vervangen.length) {
    stmts.push(
      db.prepare(`update inschrijvingen set status = 'geannuleerd' where deelnemer_id in (select value from json_each(?))`).bind(JSON.stringify(vervangen)),
      db.prepare(`update deelnemers set status = 'geannuleerd' where deelnemer_id in (select value from json_each(?))`).bind(JSON.stringify(vervangen)),
    );
  }
  for (const deel of perDeel(dnRijen, 200)) {
    stmts.push(
      db.prepare(
        `insert into deelnemers (deelnemer_id, evenement_id, doelgroep_id, naam_enc, voornaam_enc, email_enc, contact_voornaam_enc, contact_naam_enc,
           telefoon_enc, school_andere_enc, opmerkingen_enc, email_hash, dubbel_hash, school_id, leerjaar, privacy_akkoord_op, created_at,
           contact_id, persoon_id, status)
         select ${v('id')}, ?1, ${v('groep')}, ${v('naam')}, ${v('voornaam')}, ${v('email')}, ${v('cvoornaam')}, ${v('cnaam')},
           ${v('tel')}, ${v('andere')}, ${v('opm')}, ${v('ehash')}, ${v('dhash')}, ${v('school')}, ${v('leerjaar')}, ${v('op')}, ${v('op')},
           ${v('contact')}, ${v('persoon')}, ${v('status')}
         from json_each(?2) j`,
      ).bind(evenementId, JSON.stringify(deel)),
    );
  }
  for (const deel of perDeel(insRijen, 400)) {
    stmts.push(
      db.prepare(
        `insert into inschrijvingen (inschrijving_id, deelnemer_id, evenement_id, dag_id, dagdeel_id, tijdsblok_id, sessie_id, status, inschrijf_datum, aanwezig, aanmeld_via)
         select ${v('id')}, ${v('dn')}, ?1, ${v('dag')}, ${v('dagdeel')}, ${v('tb')}, ${v('sessie')}, ${v('status')}, ${v('op')}, ${v('aanwezig')},
           case when ${v('aanwezig')} = 1 then 'balie' end
         from json_each(?2) j`,
      ).bind(evenementId, JSON.stringify(deel)),
    );
  }
  // Datums van het evenement volgen de dagen; "bewaren tot" (einde + bewaartermijn) blijft gelijk.
  stmts.push(
    db.prepare(
      `update evenementen set
         start_datum = coalesce((select min(datum) from evenement_dagen where evenement_id = ?1), start_datum),
         eind_datum = coalesce((select max(datum) from evenement_dagen where evenement_id = ?1), eind_datum),
         bewaartermijn_dagen = max(0, cast(round(julianday(eind_datum) + bewaartermijn_dagen
           - julianday(coalesce((select max(datum) from evenement_dagen where evenement_id = ?1), eind_datum))) as integer))
       where evenement_id = ?1`,
    ).bind(evenementId),
    audit(env, g, 'evenementen', evenementId, 'IMPORT_INSCHRIJVINGEN',
      { ...verslag, programma: prog.nieuw, nieuweContacten: personen.nieuweContacten, nieuweKinderen: personen.nieuwePersonen }, ip),
  );
  await db.batch(stmts);
  return { ...verslag, programma: prog.nieuw, nieuweKinderen: personen.nieuwePersonen };
}

/** Nakijkstap: welke kinderen zijn al bekend, welke zijn een twijfel (zelfde regels als bij het importeren). */
export async function controleerKinderen(env: Env, body: any) {
  const rijen: InschrijvingRij[] = Array.isArray(body?.rijen) ? body.rijen.slice(0, MAX_RIJEN) : [];
  const invoer = rijen.map((r) => ({ email: telt(r) ? geldigEmail(r.email) : null, voornaam: tekst(r.kindVoornaam, 100), naam: tekst(r.kindNaam, 200) }));
  return (await planPersonen(env, invoer, false)).map(({ contact, status, kandidaten }) => ({ contact, status, kandidaten }));
}

// ---------------------------------------------------------------------------
// Sessiegevers importeren
// ---------------------------------------------------------------------------

/**
 * Sessiegevers uit een lijst: per e-mailadres één sessiegever (bestaat die al, dan wordt die gebruikt), en gekoppeld
 * aan de lesjes van dit evenement met dezelfde titel (in alle tijdsblokken). Bij een lesje zonder leerkracht komen
 * naam en adres ook in de velden Leerkracht en E-mail leerkracht (voor de rapporten en klaslijsten).
 */
export async function importeerSessiegevers(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const rijen: any[] = Array.isArray(body?.rijen) ? body.rijen.slice(0, 500) : [];
  if (!rijen.length) throw new ValidatieFout({ rijen: 'Er zijn geen rijen om te importeren.' });
  const db = env.DB;
  const [bestaand, sessies] = await db.batch<any>([
    db.prepare(`select sessiegever_id, email from sessiegevers where email is not null`),
    db.prepare(
      `select s.sessie_id, s.titel, s.lesgever, s.lesgever_email from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ?`,
    ).bind(evenementId),
  ]);
  const perEmail = new Map((bestaand.results as any[]).map((x) => [String(x.email).toLowerCase(), x.sessiegever_id as string]));
  const verslag = { nieuw: 0, bestaand: 0, gekoppeld: 0, ongeldig: 0, buitenDomein: 0, lesjesNietGevonden: [] as string[] };
  const stmts: D1PreparedStatement[] = [];
  const nu = new Date().toISOString();
  const gezien = new Set<string>();
  for (const r of rijen) {
    const email = geldigEmail(r?.email);
    const voornaam = tekst(r?.voornaam, 100);
    if (!email || !voornaam) { verslag.ongeldig++; continue; }
    if (!isToegelatenEmail(env, email)) { verslag.buitenDomein++; continue; }
    const naam = tekst(r?.naam, 100) ?? '';
    let id = perEmail.get(email);
    if (!id) {
      id = crypto.randomUUID();
      perEmail.set(email, id);
      stmts.push(db.prepare(`insert into sessiegevers (sessiegever_id, voornaam, naam, email, created_at) values (?, ?, ?, ?, ?)`).bind(id, voornaam, naam, email, nu));
      verslag.nieuw++;
    } else if (!gezien.has(email)) verslag.bestaand++;
    gezien.add(email);

    const titels = (tekst(r?.lesjes, 1000) ?? '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
    for (const titel of titels) {
      const treffers = (sessies.results as any[]).filter((s) => gelijk(s.titel, titel));
      if (!treffers.length) { verslag.lesjesNietGevonden.push(titel); continue; }
      for (const s of treffers) {
        stmts.push(
          db.prepare(`insert or ignore into sessie_sessiegevers (id, sessie_id, sessiegever_id, rol) values (?, ?, ?, 'Hoofddocent')`).bind(crypto.randomUUID(), s.sessie_id, id),
          db.prepare(`update sessies set lesgever = coalesce(lesgever, ?), lesgever_email = coalesce(lesgever_email, ?) where sessie_id = ?`)
            .bind(`${voornaam} ${naam}`.trim(), email, s.sessie_id),
        );
        verslag.gekoppeld++;
      }
    }
  }
  verslag.lesjesNietGevonden = [...new Set(verslag.lesjesNietGevonden)];
  stmts.push(audit(env, g, 'evenementen', evenementId, 'IMPORT_SESSIEGEVERS', { ...verslag, lesjesNietGevonden: verslag.lesjesNietGevonden.length }, ip));
  await db.batch(stmts);
  return verslag;
}
