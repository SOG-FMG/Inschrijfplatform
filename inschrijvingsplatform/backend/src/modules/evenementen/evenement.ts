import type { Env } from '../../types';

interface EvenementRij {
  evenement_id: string;
  slug: string;
  titel: string;
  omschrijving: string | null;
  type_evenement: string;
  organisator: string | null;
  deelnemer_type: string;
  leerjaar_opties: string;
  max_dagdelen: number;
  contact_email: string | null;
  privacy_tekst: string | null;
  bewaartermijn_dagen: number;
  logo: string | null;
  logo_hoogte: number | null;
  afbeelding: string | null;
  kleur_primair: string | null;
  kleur_accent: string | null;
  inschrijving_vanaf: string | null;
  inschrijving_tot: string | null;
}

/** Ligt `nu` binnen [vanaf, tot]? Lege grenzen = open. Tijdstippen zijn ISO 8601 in UTC. */
export function binnen(nu: number, vanaf: string | null, tot: string | null): boolean {
  return (vanaf == null || nu >= Date.parse(vanaf)) && (tot == null || nu <= Date.parse(tot));
}

/** Publieke weergave van een gepubliceerd evenement, incl. vrije plaatsen (vervangt publiek_evenement()). */
export async function publiekEvenement(env: Env, slug: string) {
  const e = await env.DB.prepare(`select * from evenementen where slug = ? and status = 'gepubliceerd'`).bind(slug).first<EvenementRij>();
  if (!e) return null;
  const id = e.evenement_id;
  const [groepen, dagen, dagdelen, blokken, sessies] = await env.DB.batch<any>([
    env.DB.prepare(`select doelgroep_id, naam, beschrijving, sessiekeuze from doelgroepen where evenement_id = ? order by volgorde, naam`).bind(id),
    env.DB.prepare(
      `select dag_id, naam, datum, sessiekeuze_tot from evenement_dagen
       where evenement_id = ? and status = 'actief' order by volgorde, datum`,
    ).bind(id),
    env.DB.prepare(
      `select dd.dagdeel_id, dd.dag_id, dd.naam, dd.start_uur, dd.eind_uur, dd.capaciteit,
              (select count(*) from inschrijvingen i
               where i.dagdeel_id = dd.dagdeel_id and i.sessie_id is null and i.status = 'bevestigd') as bevestigd
       from dagdelen dd join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? and dd.status = 'actief'
       order by dd.volgorde, dd.start_uur`,
    ).bind(id),
    env.DB.prepare(
      `select t.tijdsblok_id, t.dagdeel_id, t.naam, t.omschrijving, t.start_uur, t.eind_uur, t.type, t.verplicht
       from tijdsblokken t join dagdelen dd on dd.dagdeel_id = t.dagdeel_id join evenement_dagen d on d.dag_id = dd.dag_id
       where d.evenement_id = ? and t.zichtbaar = 1 order by t.volgorde, t.start_uur`,
    ).bind(id),
    env.DB.prepare(
      `select s.sessie_id, s.tijdsblok_id, s.code, s.titel, s.beschrijving, so.naam as soort, s.doelgroep_id,
              l.naam as locatie, s.kleur, s.capaciteit, s.wachtlijst_toegelaten, s.uniek_per_deelnemer, s.volzet_weergave,
              (select count(*) from inschrijvingen i where i.sessie_id = s.sessie_id and i.status = 'bevestigd') as bevestigd
       from sessies s
       join tijdsblokken t on t.tijdsblok_id = s.tijdsblok_id
       join dagdelen dd on dd.dagdeel_id = t.dagdeel_id
       join evenement_dagen d on d.dag_id = dd.dag_id
       left join soorten_onderdelen so on so.soort_id = s.soort_id
       left join locaties l on l.locatie_id = s.locatie_id
       where d.evenement_id = ? and s.zichtbaar = 1 and t.zichtbaar = 1 and s.status = 'open'
       order by s.volgorde, s.titel`,
    ).bind(id),
  ]);

  const nu = Date.now();
  const vrij = (cap: number | null, bezet: number) => (cap == null ? null : Math.max(cap - bezet, 0));
  const perSleutel = <T>(rijen: T[], sleutel: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rijen) m.set(sleutel(r), [...(m.get(sleutel(r)) ?? []), r]);
    return m;
  };
  const sessiesPerBlok = perSleutel(sessies.results, (s: any) => s.tijdsblok_id);
  const blokkenPerDagdeel = perSleutel(blokken.results, (t: any) => t.dagdeel_id);
  const dagdelenPerDag = perSleutel(dagdelen.results, (dd: any) => dd.dag_id);

  return {
    evenementId: id,
    slug: e.slug,
    titel: e.titel,
    omschrijving: e.omschrijving,
    typeEvenement: e.type_evenement,
    organisator: e.organisator,
    deelnemerType: e.deelnemer_type,
    leerjaarOpties: JSON.parse(e.leerjaar_opties),
    maxDagdelen: e.max_dagdelen,
    contactEmail: e.contact_email,
    privacyTekst: e.privacy_tekst,
    bewaartermijnDagen: e.bewaartermijn_dagen,
    logo: e.logo,
    logoHoogte: e.logo_hoogte,
    afbeelding: e.afbeelding,
    kleurPrimair: e.kleur_primair,
    kleurAccent: e.kleur_accent,
    inschrijvingVanaf: e.inschrijving_vanaf,
    inschrijvingTot: e.inschrijving_tot,
    inschrijvingOpen: binnen(nu, e.inschrijving_vanaf, e.inschrijving_tot),
    doelgroepen: groepen.results.map((g: any) => ({
      id: g.doelgroep_id,
      naam: g.naam,
      beschrijving: g.beschrijving,
      sessiekeuze: g.sessiekeuze === 1,
    })),
    dagen: dagen.results.map((d: any) => ({
      id: d.dag_id,
      naam: d.naam,
      datum: d.datum,
      sessiekeuzeOpen: d.sessiekeuze_tot == null || nu <= Date.parse(d.sessiekeuze_tot),
      dagdelen: (dagdelenPerDag.get(d.dag_id) ?? []).map((dd: any) => ({
        id: dd.dagdeel_id,
        naam: dd.naam,
        startUur: dd.start_uur,
        eindUur: dd.eind_uur,
        capaciteit: dd.capaciteit,
        vrij: vrij(dd.capaciteit, dd.bevestigd),
        tijdsblokken: (blokkenPerDagdeel.get(dd.dagdeel_id) ?? []).map((t: any) => ({
          id: t.tijdsblok_id,
          naam: t.naam,
          omschrijving: t.omschrijving,
          startUur: t.start_uur,
          eindUur: t.eind_uur,
          type: t.type,
          verplicht: t.verplicht === 1,
          sessies: (sessiesPerBlok.get(t.tijdsblok_id) ?? [])
            .map((s: any) => ({ ...s, volzet: s.capaciteit != null && s.bevestigd >= s.capaciteit }))
            .filter((s: any) => !(s.volzet_weergave === 'verbergen' && !s.wachtlijst_toegelaten && s.volzet))
            .map((s: any) => ({
              id: s.sessie_id,
              code: s.code,
              titel: s.titel,
              beschrijving: s.beschrijving,
              soort: s.soort,
              doelgroepId: s.doelgroep_id,
              locatie: s.locatie,
              kleur: s.kleur,
              capaciteit: s.capaciteit,
              vrij: vrij(s.capaciteit, s.bevestigd),
              volzet: s.volzet,
              wachtlijst: s.wachtlijst_toegelaten === 1,
              uniek: s.uniek_per_deelnemer === 1,
            })),
        })),
      })),
    })),
  };
}

export async function scholen(env: Env) {
  const { results } = await env.DB.prepare(
    `select school_id as id, naam, gemeente from scholen where actief = 1 order by naam collate nocase`,
  ).all();
  return results;
}
