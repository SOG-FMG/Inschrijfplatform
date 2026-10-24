import { ontsleutel } from '../../crypto/versleuteling';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';

/**
 * Etiketten van een evenement (/dashboard/evenementen/<id>/etiketten): één etiket per deelnemer met
 * de gekozen lesjes. De opmaak (blad, marges, regels met {velden}) wordt per evenement bewaard; het
 * invullen en afdrukken gebeurt in de browser. De verdieping van een lokaal staat bij de locatie.
 */

export interface EtiketRegel {
  tekst: string;
  pt: number;
  vet: boolean;
  /** Op één lijn, zo groot mogelijk tot `pt`. */
  passend: boolean;
  /** Herhaald voor elk lesje van de deelnemer. */
  perLesje: boolean;
}

export interface EtiketInstellingen {
  blad: { breedte: number; hoogte: number }; // mm
  kolommen: number;
  rijen: number;
  marge: { boven: number; onder: number; links: number; rechts: number }; // mm, rand van het blad
  tussen: { horizontaal: number; verticaal: number }; // mm tussen de etiketten
  binnen: number; // mm witruimte binnen een etiket
  regels: EtiketRegel[];
}

export async function etiketten(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId);
  const kanSchrijven = await controleerToegang(env, g, evenementId, true).then(() => true, () => false);
  const db = env.DB;
  const [ev, dagdelen, lokalen, deelnemers, inschrijvingen] = await db.batch<any>([
    db.prepare(`select evenement_id, titel, slug, etiket_instellingen from evenementen where evenement_id = ?`).bind(evenementId),
    db.prepare(
      `select dd.dagdeel_id, d.naam as dag, dd.naam from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? order by d.volgorde, d.datum, dd.volgorde, dd.start_uur`,
    ).bind(evenementId),
    db.prepare(
      `select distinct l.locatie_id, l.naam, l.lokaal, l.gebouw, l.verdieping
       from locaties l join sessies s on s.locatie_id = l.locatie_id join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? order by l.naam, l.lokaal`,
    ).bind(evenementId),
    db.prepare(
      `select dn.deelnemer_id, dn.voornaam_enc, dn.naam_enc, dn.school_andere_enc, dn.leerjaar, sc.naam as school, dg.naam as doelgroep
       from deelnemers dn left join scholen sc on sc.school_id = dn.school_id left join doelgroepen dg on dg.doelgroep_id = dn.doelgroep_id
       where dn.evenement_id = ? and dn.status = 'actief'`,
    ).bind(evenementId),
    db.prepare(
      `select i.deelnemer_id, i.dagdeel_id, s.titel, s.locatie_id, t.naam as moment, t.start_uur, t.eind_uur
       from inschrijvingen i join dagdelen dd on dd.dagdeel_id = i.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id
       left join sessies s on s.sessie_id = i.sessie_id left join tijdsblokken t on t.tijdsblok_id = i.tijdsblok_id
       where i.evenement_id = ? and i.status = 'bevestigd'
       order by d.datum, d.volgorde, dd.start_uur, t.start_uur, t.volgorde`,
    ).bind(evenementId),
    audit(env, g, 'evenementen', evenementId, 'ETIKETTEN', undefined, ip),
  ]);
  const e = ev.results[0];
  if (!e) throw new DbFout('GEEN_TOEGANG');

  const perDeelnemer = new Map<string, any[]>();
  for (const i of inschrijvingen.results) perDeelnemer.set(i.deelnemer_id, [...(perDeelnemer.get(i.deelnemer_id) ?? []), i]);

  const o = (v: string | null) => ontsleutel(env, v);
  const lijst = await Promise.all(
    deelnemers.results
      .filter((dn: any) => perDeelnemer.has(dn.deelnemer_id))
      .map(async (dn: any) => {
        const [voornaam, naam, schoolAndere] = await Promise.all([o(dn.voornaam_enc), o(dn.naam_enc), o(dn.school_andere_enc)]);
        const rijen = perDeelnemer.get(dn.deelnemer_id)!;
        return {
          voornaam: voornaam ?? '',
          naam: naam ?? '',
          school: dn.school ?? schoolAndere ?? '',
          leerjaar: dn.leerjaar ?? '',
          doelgroep: dn.doelgroep ?? '',
          dagdelen: [...new Set(rijen.map((i) => i.dagdeel_id as string))],
          lesjes: rijen
            .filter((i) => i.titel != null)
            .map((i) => ({ titel: i.titel, locatieId: i.locatie_id, dagdeelId: i.dagdeel_id, moment: i.moment, startUur: i.start_uur, eindUur: i.eind_uur })),
        };
      }),
  );

  return {
    kanSchrijven,
    evenement: { id: e.evenement_id, titel: e.titel, slug: e.slug },
    instellingen: e.etiket_instellingen ? (JSON.parse(e.etiket_instellingen) as EtiketInstellingen) : null,
    dagdelen: dagdelen.results.map((dd: any) => ({ id: dd.dagdeel_id, naam: `${dd.dag} – ${dd.naam}` })),
    lokalen: lokalen.results.map((l: any) => ({ id: l.locatie_id, naam: l.naam, lokaal: l.lokaal, gebouw: l.gebouw, verdieping: l.verdieping })),
    deelnemers: lijst,
  };
}

// ---------------------------------------------------------------------------
// Instellingen bewaren (null = terug naar de standaard)
// ---------------------------------------------------------------------------
function valideer(x: any): EtiketInstellingen {
  const fout = (m: string) => new ValidatieFout({ etiket: m });
  const getal = (v: unknown, min: number, max: number, wat: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw fout(`${wat}: tussen ${min} en ${max}.`);
    return Math.round(v * 10) / 10;
  };
  const geheel = (v: unknown, min: number, max: number, wat: string) => {
    if (!Number.isInteger(v)) throw fout(`${wat}: geef een geheel getal.`);
    return getal(v, min, max, wat);
  };
  if (!x || typeof x !== 'object' || !Array.isArray(x.regels)) throw fout('Ongeldige instellingen.');
  if (x.regels.length > 20) throw fout('Hoogstens 20 regels.');
  const r: EtiketInstellingen = {
    blad: { breedte: getal(x.blad?.breedte, 50, 500, 'Breedte blad'), hoogte: getal(x.blad?.hoogte, 50, 500, 'Hoogte blad') },
    kolommen: geheel(x.kolommen, 1, 10, 'Kolommen'),
    rijen: geheel(x.rijen, 1, 40, 'Rijen'),
    marge: {
      boven: getal(x.marge?.boven, 0, 100, 'Marge boven'),
      onder: getal(x.marge?.onder, 0, 100, 'Marge onder'),
      links: getal(x.marge?.links, 0, 100, 'Marge links'),
      rechts: getal(x.marge?.rechts, 0, 100, 'Marge rechts'),
    },
    tussen: { horizontaal: getal(x.tussen?.horizontaal, 0, 50, 'Tussenruimte'), verticaal: getal(x.tussen?.verticaal, 0, 50, 'Tussenruimte') },
    binnen: getal(x.binnen, 0, 20, 'Witruimte binnen het etiket'),
    regels: x.regels.map((rg: any) => {
      if (typeof rg?.tekst !== 'string' || rg.tekst.length > 200) throw fout('Een regel is te lang (max. 200 tekens).');
      return { tekst: rg.tekst, pt: getal(rg.pt, 4, 72, 'Lettergrootte'), vet: rg.vet === true, passend: rg.passend === true, perLesje: rg.perLesje === true };
    }),
  };
  const breedte = r.blad.breedte - r.marge.links - r.marge.rechts - (r.kolommen - 1) * r.tussen.horizontaal;
  const hoogte = r.blad.hoogte - r.marge.boven - r.marge.onder - (r.rijen - 1) * r.tussen.verticaal;
  if (breedte / r.kolommen < 10 || hoogte / r.rijen < 5) throw fout('De etiketten passen niet op het blad: verklein de marges of het aantal.');
  return r;
}

export async function bewaarEtiketInstellingen(env: Env, g: Gebruiker, evenementId: string, invoer: unknown, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const instellingen = invoer === null ? null : valideer(invoer);
  await env.DB.batch([
    env.DB.prepare(`update evenementen set etiket_instellingen = ? where evenement_id = ?`).bind(instellingen && JSON.stringify(instellingen), evenementId),
    audit(env, g, 'evenementen', evenementId, 'ETIKET_INSTELLINGEN', undefined, ip),
  ]);
  return { instellingen };
}

/** Verdieping van een lokaal dat in dit evenement gebruikt wordt. */
export async function zetVerdieping(env: Env, g: Gebruiker, evenementId: string, locatieId: string, verdieping: unknown, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  if (verdieping !== null && typeof verdieping !== 'string') throw new ValidatieFout({ verdieping: 'Ongeldige verdieping.' });
  const waarde = (verdieping ?? '').replace(/\s+/g, ' ').trim().slice(0, 50) || null;
  const gebruikt = await env.DB.prepare(
    `select 1 from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
     join evenement_dagen d on d.dag_id = dd.dag_id where s.locatie_id = ? and d.evenement_id = ? limit 1`,
  ).bind(locatieId, evenementId).first();
  if (!gebruikt) throw new DbFout('GEEN_TOEGANG');
  await env.DB.batch([
    env.DB.prepare(`update locaties set verdieping = ? where locatie_id = ?`).bind(waarde, locatieId),
    audit(env, g, 'locaties', locatieId, 'VERDIEPING', { verdieping: waarde }, ip),
  ]);
  return { verdieping: waarde };
}
