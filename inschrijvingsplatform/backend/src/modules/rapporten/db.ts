import { ontsleutel } from '../../crypto/versleuteling';
import { isToegelatenEmail } from '../../kern/installatie';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';

/**
 * Rapporten van een evenement (/dashboard/evenementen/<id>/rapporten):
 *   1. overzicht per dagdeel: lesjes met lokaal, leerkracht, maximum en aantal ingeschreven
 *   2. inschrijvingen per moment (tijdsblok): elk lesje een kolom met de namen eronder
 *   3. klaslijst per lesje: voornaam, naam, huidige school en leerjaar
 * Eén aanroep levert alles; de frontend kiest wat getoond, afgedrukt of geëxporteerd wordt.
 */

export interface RapportDeelnemer {
  voornaam: string;
  naam: string;
  school: string;
  leerjaar: string;
  status: 'bevestigd' | 'wachtlijst';
}

export interface RapportSessie {
  id: string;
  titel: string;
  locatieId: string | null;
  lokaal: string | null;
  lesgever: string | null;
  lesgeverEmail: string | null;
  capaciteit: number | null;
  status: string;
  zichtbaar: boolean;
  bevestigd: number;
  wachtlijst: number;
  deelnemers: RapportDeelnemer[];
}

const nl = new Intl.Collator('nl', { sensitivity: 'base' });
const opNaam = (a: RapportDeelnemer, b: RapportDeelnemer) =>
  (a.status === b.status ? 0 : a.status === 'bevestigd' ? -1 : 1) || nl.compare(a.naam, b.naam) || nl.compare(a.voornaam, b.voornaam);

export async function rapport(env: Env, g: Gebruiker, evenementId: string, ip: string | null) {
  await controleerToegang(env, g, evenementId);
  const kanSchrijven = await controleerToegang(env, g, evenementId, true).then(() => true, () => false);
  const db = env.DB;
  const [ev, dagen, dagdelen, blokken, sessies, deelnemers, inschrijvingen, locaties] = await db.batch<any>([
    db.prepare(`select evenement_id, titel, slug, rapport_teksten from evenementen where evenement_id = ?`).bind(evenementId),
    db.prepare(`select dag_id, naam, datum from evenement_dagen where evenement_id = ? order by volgorde, datum`).bind(evenementId),
    db.prepare(
      `select dd.dagdeel_id, dd.dag_id, dd.naam, dd.start_uur, dd.eind_uur, dd.capaciteit, dd.status
       from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id where d.evenement_id = ? order by dd.volgorde, dd.start_uur`,
    ).bind(evenementId),
    db.prepare(
      `select t.tijdsblok_id, t.dagdeel_id, t.naam, t.start_uur, t.eind_uur, t.type
       from tijdsblokken t join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? order by t.volgorde, t.start_uur`,
    ).bind(evenementId),
    db.prepare(
      `select s.sessie_id, s.tijdsblok_id, s.titel, s.locatie_id, coalesce(l.lokaal, l.naam) as lokaal, s.lesgever, s.lesgever_email,
              s.capaciteit, s.status, s.zichtbaar
       from sessies s join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id left join locaties l on l.locatie_id = s.locatie_id
       where d.evenement_id = ? order by s.volgorde, s.titel`,
    ).bind(evenementId),
    db.prepare(
      `select dn.deelnemer_id, dn.voornaam_enc, dn.naam_enc, dn.school_andere_enc, dn.leerjaar, sc.naam as school
       from deelnemers dn left join scholen sc on sc.school_id = dn.school_id
       where dn.evenement_id = ? and dn.status = 'actief'`,
    ).bind(evenementId),
    db.prepare(
      `select deelnemer_id, dagdeel_id, tijdsblok_id, sessie_id, status from inschrijvingen
       where evenement_id = ? and status in ('bevestigd', 'wachtlijst')`,
    ).bind(evenementId),
    db.prepare(
      `select locatie_id as waarde, coalesce(lokaal, naam) as label from locaties
       where school_id is null or school_id = (select school_id from evenementen where evenement_id = ?) or ? = 'platformbeheerder'
       order by naam`,
    ).bind(evenementId, g.rol),
    audit(env, g, 'evenementen', evenementId, 'RAPPORT', undefined, ip),
  ]);
  const e = ev.results[0];
  if (!e) throw new DbFout('GEEN_TOEGANG');

  // Elke deelnemer één keer ontsleutelen
  const o = (v: string | null) => ontsleutel(env, v);
  const personen = new Map<string, Omit<RapportDeelnemer, 'status'>>();
  await Promise.all(
    deelnemers.results.map(async (dn: any) => {
      const [voornaam, naam, schoolAndere] = await Promise.all([o(dn.voornaam_enc), o(dn.naam_enc), o(dn.school_andere_enc)]);
      personen.set(dn.deelnemer_id, { voornaam: voornaam ?? '', naam: naam ?? '', school: dn.school ?? schoolAndere ?? '', leerjaar: dn.leerjaar ?? '' });
    }),
  );
  const persoon = (i: any): RapportDeelnemer | null => {
    const p = personen.get(i.deelnemer_id);
    return p ? { ...p, status: i.status } : null;
  };

  const rijen = inschrijvingen.results as { deelnemer_id: string; dagdeel_id: string; tijdsblok_id: string | null; sessie_id: string | null; status: RapportDeelnemer['status'] }[];
  const perSessie = new Map<string, RapportDeelnemer[]>();
  const keuzeIn = new Set<string>(); // deelnemer|tijdsblok
  for (const i of rijen) {
    if (!i.sessie_id) continue;
    const p = persoon(i);
    if (!p) continue;
    perSessie.set(i.sessie_id, [...(perSessie.get(i.sessie_id) ?? []), p]);
    keuzeIn.add(`${i.deelnemer_id}|${i.tijdsblok_id}`);
  }
  const inDagdeel = (dagdeelId: string) => rijen.filter((i) => !i.sessie_id && i.dagdeel_id === dagdeelId && i.status === 'bevestigd');

  return {
    kanSchrijven,
    evenement: { id: e.evenement_id, titel: e.titel, slug: e.slug },
    teksten: JSON.parse(e.rapport_teksten ?? '{}') as Record<string, string>,
    locaties: locaties.results,
    dagen: dagen.results.map((d: any) => ({
      id: d.dag_id,
      naam: d.naam,
      datum: d.datum,
      dagdelen: dagdelen.results
        .filter((dd: any) => dd.dag_id === d.dag_id)
        .map((dd: any) => {
          const aanwezig = inDagdeel(dd.dagdeel_id);
          return {
            id: dd.dagdeel_id,
            naam: dd.naam,
            startUur: dd.start_uur,
            eindUur: dd.eind_uur,
            capaciteit: dd.capaciteit,
            status: dd.status,
            ingeschreven: aanwezig.length,
            tijdsblokken: blokken.results
              .filter((t: any) => t.dagdeel_id === dd.dagdeel_id && t.type === 'keuze')
              .map((t: any) => ({
                id: t.tijdsblok_id,
                naam: t.naam,
                startUur: t.start_uur,
                eindUur: t.eind_uur,
                sessies: sessies.results
                  .filter((s: any) => s.tijdsblok_id === t.tijdsblok_id)
                  .map((s: any): RapportSessie => {
                    const lijst = (perSessie.get(s.sessie_id) ?? []).sort(opNaam);
                    return {
                      id: s.sessie_id,
                      titel: s.titel,
                      locatieId: s.locatie_id,
                      lokaal: s.lokaal,
                      lesgever: s.lesgever,
                      lesgeverEmail: s.lesgever_email,
                      capaciteit: s.capaciteit,
                      status: s.status,
                      zichtbaar: s.zichtbaar === 1,
                      bevestigd: lijst.filter((x) => x.status === 'bevestigd').length,
                      wachtlijst: lijst.filter((x) => x.status === 'wachtlijst').length,
                      deelnemers: lijst,
                    };
                  }),
                // Wel ingeschreven voor het dagdeel, maar geen lesje gekozen in dit blok
                zonderKeuze: aanwezig
                  .filter((i) => !keuzeIn.has(`${i.deelnemer_id}|${t.tijdsblok_id}`))
                  .map(persoon)
                  .filter((p): p is RapportDeelnemer => !!p)
                  .sort(opNaam),
              })),
          };
        }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Aangepaste titels en kolomkoppen
// ---------------------------------------------------------------------------
export async function bewaarTeksten(env: Env, g: Gebruiker, evenementId: string, invoer: unknown, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  if (!invoer || typeof invoer !== 'object' || Array.isArray(invoer)) throw new ValidatieFout({ teksten: 'Ongeldige teksten.' });
  const huidig = await env.DB.prepare(`select rapport_teksten from evenementen where evenement_id = ?`).bind(evenementId).first<{ rapport_teksten: string | null }>();
  const teksten: Record<string, string> = JSON.parse(huidig?.rapport_teksten ?? '{}');
  for (const [k, v] of Object.entries(invoer)) {
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(k) || (v !== null && typeof v !== 'string')) throw new ValidatieFout({ teksten: 'Ongeldige teksten.' });
    const tekst = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (tekst) teksten[k] = tekst;
    else delete teksten[k]; // leeg = terug naar de standaardtekst
  }
  if (Object.keys(teksten).length > 500) throw new ValidatieFout({ teksten: 'Te veel aangepaste teksten.' });
  await env.DB.batch([
    env.DB.prepare(`update evenementen set rapport_teksten = ? where evenement_id = ?`).bind(JSON.stringify(teksten), evenementId),
    audit(env, g, 'evenementen', evenementId, 'RAPPORT_TEKSTEN', { aantal: Object.keys(teksten).length }, ip),
  ]);
  return { teksten };
}

// ---------------------------------------------------------------------------
// Klaslijsten mailen naar de leerkrachten
// ---------------------------------------------------------------------------
export interface Klaslijst {
  sessie: RapportSessie;
  moment: string;
  uur: string;
}

/** Klaslijsten van de gevraagde lesjes, gegroepeerd per leerkracht (één mail per adres). */
export async function klaslijstenPerLeerkracht(env: Env, g: Gebruiker, evenementId: string, sessieIds: string[], ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const r = await rapport(env, g, evenementId, ip);
  const gevraagd = new Set(sessieIds);
  const perAdres = new Map<string, Klaslijst[]>();
  const zonderAdres: string[] = [];
  for (const dag of r.dagen)
    for (const dd of dag.dagdelen)
      for (const t of dd.tijdsblokken)
        for (const s of t.sessies) {
          if (!gevraagd.has(s.id)) continue;
          if (!s.lesgeverEmail || !isToegelatenEmail(env, s.lesgeverEmail)) {
            zonderAdres.push(s.titel);
            continue;
          }
          const lijst: Klaslijst = { sessie: s, moment: `${dag.naam} – ${dd.naam} – ${t.naam}`, uur: `${t.startUur} – ${t.eindUur}` };
          perAdres.set(s.lesgeverEmail, [...(perAdres.get(s.lesgeverEmail) ?? []), lijst]);
        }
  const afzender = await env.DB.prepare(`select voornaam, naam from gebruikers where gebruiker_id = ?`).bind(g.gebruikerId).first<{ voornaam: string; naam: string }>();
  return { evenement: r.evenement.titel, perAdres, zonderAdres, afzender: afzender ? `${afzender.voornaam} ${afzender.naam}` : g.email };
}
