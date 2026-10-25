import { ontsleutel, versleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { contactenOpSleutel, emailSleutel, herken, koppelAanContact, naamSleutel, personenVan, type Persoon } from '../../kern/contacten';
import { DbFout } from '../../kern/fouten';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import { verstuur } from '../../mail';
import { uitnodigingsmail } from '../evenementen/mails';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { aantalTeVersturen, maakUitnodigingen, markeerVerstuurd, teVersturen, uitnodigingStatus } from '../evenementen/uitnodigingen';

/** Eén rij zoals de frontend ze stuurt, na het koppelen van kolommen en scholen. */
export interface ImportRij {
  ingediendOp?: string | null;
  schooljaar?: string | null;
  klas?: string | null;
  schoolId?: string | null;
  schoolAndere?: string | null;
  kindVoornaam?: string | null;
  /** Familienaam, of de volledige naam als de voornaam niet apart staat. */
  kindNaam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  opmerkingen?: string | null;
  /** Bij een twijfel: id van de bestaande persoon, 'rij:<n>' (persoon van een eerdere rij in dit bestand) of 'nieuw'. */
  persoonKeuze?: string | null;
}

export const MAX_RIJEN = 5000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const tekst = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const geldigEmail = (v: unknown) => {
  const e = tekst(v, 254)?.toLowerCase() ?? null;
  return e && EMAIL.test(e) ? e : null;
};

function datum(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Personen herkennen (voor de nakijkstap én bij het importeren: dezelfde regels)
// ---------------------------------------------------------------------------

export interface RijPlan {
  contact: 'nieuw' | 'bestaand' | 'geen';
  status: 'zelfde' | 'twijfel' | 'nieuw' | 'geen';
  /** Kandidaten bij twijfel: bestaande personen, of 'rij:<n>' voor een kind van een eerdere rij in dit bestand. */
  kandidaten: { id: string; naam: string }[];
  /** Uiteindelijke keuze (na persoonKeuze): bestaande persoon, 'rij:<n>', of 'nieuw'. */
  persoon?: string;
  sleutel?: string;
  emailSleutel?: string;
}

const volledigeNaam = (p: { voornaam: string | null; naam: string | null }) => [p.voornaam, p.naam].filter(Boolean).join(' ');

async function plan(env: Env, rijen: ImportRij[], metKeuzes: boolean): Promise<RijPlan[]> {
  const emails = rijen.map((r) => geldigEmail(r.email));
  const sleutels = await Promise.all(emails.map((e) => (e ? emailSleutel(env, e) : null)));
  const contacten = await contactenOpSleutel(env, [...new Set(sleutels.filter((s): s is string => !!s))]);
  const personen = await personenVan(env, [...contacten.values()]);
  // Personen die dit bestand zelf aanmaakt, per contact (sleutel van het e-mailadres).
  const nieuwInBestand = new Map<string, Persoon[]>();

  const uit: RijPlan[] = [];
  for (let i = 0; i < rijen.length; i++) {
    const r = rijen[i];
    const es = sleutels[i];
    const voornaam = tekst(r.kindVoornaam, 100);
    const naam = tekst(r.kindNaam, 200);
    if (!es) {
      uit.push({ contact: 'geen', status: 'geen', kandidaten: [] });
      continue;
    }
    const contactId = contacten.get(es);
    if (!voornaam && !naam) {
      uit.push({ contact: contactId ? 'bestaand' : 'nieuw', status: 'geen', kandidaten: [], emailSleutel: es });
      continue;
    }
    const sleutel = await naamSleutel(env, voornaam, naam);
    const kandidaten = [...(contactId ? personen.get(contactId) ?? [] : []), ...(nieuwInBestand.get(es) ?? [])];
    const h = herken(kandidaten, voornaam, naam, sleutel);
    const p: RijPlan = {
      contact: contactId ? 'bestaand' : 'nieuw',
      status: h.status,
      kandidaten: h.kandidaten.map((k) => ({ id: k.persoonId, naam: volledigeNaam(k) })),
      sleutel,
      emailSleutel: es,
    };
    if (h.status === 'zelfde') p.persoon = h.persoonId;
    else if (h.status === 'nieuw') p.persoon = 'nieuw';
    else if (metKeuzes) {
      const k = r.persoonKeuze;
      if (k === 'nieuw' || (k && h.kandidaten.some((x) => x.persoonId === k))) p.persoon = k;
      else throw new ValidatieFout({ rijen: `Rij ${i + 1}: kies of dit hetzelfde kind is of een ander kind.` });
    }
    if (p.persoon === 'nieuw') {
      const lijst = nieuwInBestand.get(es) ?? [];
      lijst.push({ persoonId: `rij:${i}`, contactId: '', voornaam, naam, sleutel });
      nieuwInBestand.set(es, lijst);
    }
    uit.push(p);
  }
  return uit;
}

/** Voor de nakijkstap in het dashboard: per rij nieuw of bestaand contact, en zelfde, twijfel of nieuw kind. */
export async function controleerPersonen(env: Env, body: any) {
  const rijen: ImportRij[] = Array.isArray(body?.rijen) ? body.rijen.slice(0, MAX_RIJEN) : [];
  return (await plan(env, rijen, false)).map(({ contact, status, kandidaten }) => ({ contact, status, kandidaten }));
}

// ---------------------------------------------------------------------------
// Importeren
// ---------------------------------------------------------------------------

export async function importeer(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const naam = tekst(body?.naam, 120);
  const rijen: ImportRij[] = Array.isArray(body?.rijen) ? body.rijen : [];
  const fouten: Record<string, string> = {};
  if (!naam) fouten.naam = 'Geef de import een naam, bv. "Voorinschrijvingen 2025-2026".';
  if (!rijen.length) fouten.rijen = 'Er zijn geen rijen om te importeren.';
  if (rijen.length > MAX_RIJEN) fouten.rijen = `Maximaal ${MAX_RIJEN} rijen per import.`;
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);

  // Enkel scholen uit de officiële lijst.
  const schoolIds = [...new Set(rijen.map((r) => r.schoolId).filter((x): x is string => typeof x === 'string' && !!x))];
  const { results: bekend } = await env.DB.prepare(`select school_id from scholen where school_id in (select value from json_each(?))`)
    .bind(JSON.stringify(schoolIds))
    .all<{ school_id: string }>();
  if (bekend.length !== schoolIds.length) throw new ValidatieFout({ rijen: 'Een gekozen school staat niet in de lijst. Vernieuw de pagina en probeer opnieuw.' });

  const plannen = await plan(env, rijen, true);
  const bestaand = await contactenOpSleutel(env, [...new Set(plannen.map((p) => p.emailSleutel).filter((s): s is string => !!s))]);

  // Contacten: één per e-mailadres; het laatst ingevulde telefoonnummer telt.
  const contactPer = new Map<string, { id: string; email: string; telefoon: string | null }>();
  rijen.forEach((r, i) => {
    const es = plannen[i].emailSleutel;
    if (!es) return;
    const vorige = contactPer.get(es);
    contactPer.set(es, { id: bestaand.get(es) ?? vorige?.id ?? crypto.randomUUID(), email: geldigEmail(r.email)!, telefoon: tekst(r.telefoon, 40) ?? vorige?.telefoon ?? null });
  });
  const contactRijen = [];
  for (const [es, c] of contactPer) {
    contactRijen.push({ id: c.id, sleutel: es, email: await versleutel(env, c.email), tel: await versleutel(env, c.telefoon) });
  }

  // Personen: nieuw per 'nieuw'-keuze; 'rij:<n>' verwijst naar de persoon die rij n aanmaakte.
  const persoonVanRij = new Map<number, string>();
  const persoonRijen = [];
  const importId = crypto.randomUUID();
  const rijData = [];
  for (let i = 0; i < rijen.length; i++) {
    const r = rijen[i];
    const p = plannen[i];
    const contactId = p.emailSleutel ? contactPer.get(p.emailSleutel)!.id : null;
    let persoonId: string | null = null;
    if (p.persoon === 'nieuw') {
      persoonId = crypto.randomUUID();
      persoonVanRij.set(i, persoonId);
      persoonRijen.push({
        id: persoonId, contact: contactId, sleutel: p.sleutel,
        voornaam: await versleutel(env, tekst(r.kindVoornaam, 100)), naam: await versleutel(env, tekst(r.kindNaam, 200)),
      });
    } else if (p.persoon?.startsWith('rij:')) persoonId = persoonVanRij.get(Number(p.persoon.slice(4))) ?? null;
    else if (p.persoon) persoonId = p.persoon;
    rijData.push({
      id: crypto.randomUUID(),
      op: datum(r.ingediendOp),
      jaar: tekst(r.schooljaar, 60),
      klas: tekst(r.klas, 60),
      school: r.schoolId || null,
      andere: r.schoolId ? null : tekst(r.schoolAndere, 200),
      // Zonder geldig e-mailadres geen contact: de naam blijft dan bij de rij zelf.
      kind: contactId ? null : await versleutel(env, [tekst(r.kindVoornaam, 100), tekst(r.kindNaam, 200)].filter(Boolean).join(' ') || null),
      opm: await versleutel(env, tekst(r.opmerkingen, 2000)),
      hash: p.emailSleutel ?? null,
      contact: contactId,
      persoon: persoonId,
    });
  }

  // Alles in één atomische batch; rijen als JSON (json_each) zodat ook duizenden rijen weinig query's vragen.
  const v = (veld: string) => `json_extract(j.value, '$.${veld}')`;
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`insert into voorinschrijvingen_importen (import_id, naam, bestandsnaam, aantal, created_by) values (?, ?, ?, ?, ?)`)
      .bind(importId, naam, tekst(body?.bestandsnaam, 200), rijen.length, g.gebruikerId),
  ];
  const perDeel = <T>(lijst: T[], n: number) => Array.from({ length: Math.ceil(lijst.length / n) }, (_, i) => lijst.slice(i * n, i * n + n));
  for (const deel of perDeel(contactRijen, 400)) {
    stmts.push(
      env.DB.prepare(
        `insert into contacten (contact_id, email_hash, email_enc, telefoon_enc)
         select ${v('id')}, ${v('sleutel')}, ${v('email')}, ${v('tel')} from json_each(?) j where true
         on conflict (email_hash) do update set telefoon_enc = coalesce(excluded.telefoon_enc, telefoon_enc),
           gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).bind(JSON.stringify(deel)),
    );
  }
  for (const deel of perDeel(persoonRijen, 400)) {
    stmts.push(
      env.DB.prepare(
        `insert into personen (persoon_id, contact_id, voornaam_enc, naam_enc, naam_sleutel)
         select ${v('id')}, ${v('contact')}, ${v('voornaam')}, ${v('naam')}, ${v('sleutel')} from json_each(?) j`,
      ).bind(JSON.stringify(deel)),
    );
  }
  for (const deel of perDeel(rijData, 400)) {
    stmts.push(
      env.DB.prepare(
        `insert into voorinschrijvingen (id, import_id, ingediend_op, schooljaar, klas, school_id, school_andere,
                                         kind_naam_enc, opmerkingen_enc, email_hash, contact_id, persoon_id)
         select ${v('id')}, ?1, ${v('op')}, ${v('jaar')}, ${v('klas')}, ${v('school')}, ${v('andere')},
                ${v('kind')}, ${v('opm')}, ${v('hash')}, ${v('contact')}, ${v('persoon')}
         from json_each(?2) j`,
      ).bind(importId, JSON.stringify(deel)),
    );
  }
  stmts.push(
    audit(env, g, 'voorinschrijvingen_importen', importId, 'IMPORT',
      { rijen: rijen.length, nieuweContacten: contactRijen.filter((c) => ![...bestaand.values()].includes(c.id)).length, nieuweKinderen: persoonRijen.length }, ip),
  );
  await env.DB.batch(stmts);
  return { importId, aantal: rijen.length, contacten: contactRijen.length, nieuweKinderen: persoonRijen.length };
}

export async function importen(env: Env) {
  const { results } = await env.DB.prepare(
    `select import_id as id, naam, bestandsnaam, aantal, geanonimiseerd_op as geanonimiseerdOp, created_at as aangemaakt
     from voorinschrijvingen_importen order by created_at desc`,
  ).all();
  return results;
}

async function bestaat(env: Env, importId: string) {
  const r = await env.DB.prepare(`select 1 from voorinschrijvingen_importen where import_id = ?`).bind(importId).first();
  if (!r) throw new DbFout('IMPORT_NIET_GEVONDEN');
}

const bron = (importId: string) => `voorinschrijvingen:${importId}`;

/**
 * Wist alles wat naar een persoon wijst, ook de koppeling met contacten en de uitnodigingen van deze import;
 * contacten en personen waar niets meer naar verwijst, ruimt de kern op. Schooljaar, klas, school en datum blijven.
 */
export async function anonimiseer(env: Env, g: Gebruiker, importId: string, ip: string | null) {
  await bestaat(env, importId);
  await env.DB.batch([
    env.DB.prepare(
      `update voorinschrijvingen set kind_naam_enc = null, email_enc = null, telefoon_enc = null, opmerkingen_enc = null, email_hash = null,
         contact_id = null, persoon_id = null
       where import_id = ?`,
    ).bind(importId),
    env.DB.prepare(`delete from uitnodigingen where bron = ?`).bind(bron(importId)),
    // Een formulier dat in deze import verzamelt, gaat dicht: nieuwe inzendingen zouden niet meer te koppelen zijn.
    env.DB.prepare(`update voorinschrijvingen_formulieren set open = 0 where import_id = ?`).bind(importId),
    env.DB.prepare(`update voorinschrijvingen_importen set geanonimiseerd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where import_id = ?`).bind(importId),
    audit(env, g, 'voorinschrijvingen_importen', importId, 'ANONIMISEER', undefined, ip),
  ]);
  return { ok: true };
}

export async function verwijder(env: Env, g: Gebruiker, importId: string, ip: string | null) {
  await bestaat(env, importId);
  await env.DB.batch([
    env.DB.prepare(`delete from uitnodigingen where bron = ?`).bind(bron(importId)),
    env.DB.prepare(`delete from voorinschrijvingen where import_id = ?`).bind(importId),
    env.DB.prepare(`delete from voorinschrijvingen_importen where import_id = ?`).bind(importId),
    audit(env, g, 'voorinschrijvingen_importen', importId, 'VERWIJDER', undefined, ip),
  ]);
  return { ok: true };
}

/** Statistieken en controles per import. Geen persoonsgegevens: enkel aantallen. */
export async function statistieken(env: Env) {
  const lijst = (await importen(env)) as { id: string; naam: string; aantal: number; geanonimiseerdOp: string | null; aangemaakt: string }[];
  const uit = [];
  for (const imp of lijst) {
    const [scholen, klassen, maanden, schooljaren, controle] = await env.DB.batch<any>([
      env.DB.prepare(
        `select coalesce(s.naam || coalesce(' (' || s.gemeente || ')', ''), v.school_andere, '(niet ingevuld)') as school,
                case when v.school_id is not null then 'lijst' when v.school_andere is not null then 'andere' else 'leeg' end as soort,
                count(*) as aantal
         from voorinschrijvingen v left join scholen s on s.school_id = v.school_id
         where v.import_id = ? group by 1, 2 order by aantal desc, school`,
      ).bind(imp.id),
      env.DB.prepare(`select coalesce(klas, '(niet ingevuld)') as klas, count(*) as aantal from voorinschrijvingen where import_id = ? group by 1 order by aantal desc`).bind(imp.id),
      env.DB.prepare(
        `select substr(ingediend_op, 1, 7) as maand, count(*) as aantal from voorinschrijvingen
         where import_id = ? and ingediend_op is not null group by 1 order by 1`,
      ).bind(imp.id),
      env.DB.prepare(`select coalesce(schooljaar, '(niet ingevuld)') as schooljaar, count(*) as aantal from voorinschrijvingen where import_id = ? group by 1 order by 1`).bind(imp.id),
      env.DB.prepare(
        `select
           (select count(*) from voorinschrijvingen where import_id = ?1 and email_hash is null) as zonderEmail,
           (select count(*) from (select email_hash from voorinschrijvingen where import_id = ?1 and email_hash is not null
                                  group by email_hash having count(*) > 1)) as dubbeleAdressen,
           (select count(distinct v.email_hash) from voorinschrijvingen v
              where v.import_id = ?1 and exists (select 1 from deelnemers d where d.email_hash = v.email_hash)) as ookIngeschreven,
           (select count(distinct v.email_hash) from voorinschrijvingen v
              where v.import_id = ?1 and exists (select 1 from voorinschrijvingen w where w.email_hash = v.email_hash and w.import_id <> ?1)) as ookInAndereImport,
           (select count(distinct email_hash) from voorinschrijvingen where import_id = ?1 and email_hash is not null) as adressen,
           (select count(distinct persoon_id) from voorinschrijvingen where import_id = ?1 and persoon_id is not null) as kinderen,
           (select count(distinct v.persoon_id) from voorinschrijvingen v
              where v.import_id = ?1 and exists (select 1 from deelnemers d where d.persoon_id = v.persoon_id and d.status = 'actief')) as kinderenIngeschreven`,
      ).bind(imp.id),
    ]);
    uit.push({ ...imp, scholen: scholen.results, klassen: klassen.results, maanden: maanden.results, schooljaren: schooljaren.results, controle: controle.results[0] });
  }
  return uit;
}

/**
 * Dagelijks: rijen van vóór de contacten (met naam en e-mail nog in de rij zelf) koppelen aan een contact en een
 * persoon, en daarna die kolommen leeg maken. Per keer een beperkt aantal.
 */
export async function koppelBestaandeRijen(env: Env, max = 200): Promise<number> {
  const { results } = await env.DB.prepare(
    `select v.id, v.kind_naam_enc, v.email_enc, v.telefoon_enc from voorinschrijvingen v
     join voorinschrijvingen_importen i on i.import_id = v.import_id
     where v.contact_id is null and v.email_enc is not null and i.geanonimiseerd_op is null limit ?`,
  )
    .bind(max)
    .all<{ id: string; kind_naam_enc: string | null; email_enc: string; telefoon_enc: string | null }>();
  for (const r of results) {
    const email = geldigEmail(await ontsleutel(env, r.email_enc));
    const kind = await ontsleutel(env, r.kind_naam_enc);
    if (!email || !kind) {
      await env.DB.prepare(`update voorinschrijvingen set email_enc = null, telefoon_enc = null where id = ?`).bind(r.id).run();
      continue;
    }
    const k = await koppelAanContact(env, { email, telefoon: await ontsleutel(env, r.telefoon_enc) }, { voornaam: '', naam: kind });
    await env.DB.prepare(
      `update voorinschrijvingen set contact_id = ?, persoon_id = ?, kind_naam_enc = null, email_enc = null, telefoon_enc = null where id = ?`,
    )
      .bind(k.contactId, k.persoonId, r.id)
      .run();
  }
  return results.length;
}

// ---------------------------------------------------------------------------
// Uitnodigen voor een evenement
// ---------------------------------------------------------------------------

/** Kinderen uit deze import die nog niet ingeschreven zijn voor het evenement, met wat het formulier vooraf invult. */
async function teUitnodigen(env: Env, importId: string, evenementId: string) {
  const { results } = await env.DB.prepare(
    `select v.contact_id, v.persoon_id, v.school_id, v.school_andere, v.klas from voorinschrijvingen v
     where v.import_id = ?1 and v.persoon_id is not null
       and not exists (select 1 from deelnemers d where d.evenement_id = ?2 and d.persoon_id = v.persoon_id and d.status = 'actief')
     order by v.ingediend_op`,
  )
    .bind(importId, evenementId)
    .all<{ contact_id: string; persoon_id: string; school_id: string | null; school_andere: string | null; klas: string | null }>();
  // De laatste rij per kind telt (meest recente school en klas).
  const perKind = new Map(results.map((r) => [r.persoon_id, r]));
  return [...perKind.values()];
}

async function evenementVoorUitnodigen(env: Env, g: Gebruiker, evenementId: string) {
  await controleerToegang(env, g, evenementId, true);
  const ev = await env.DB.prepare(`select evenement_id, slug, titel, inschrijving_tot, contact_email from evenementen where evenement_id = ?`)
    .bind(evenementId)
    .first<{ evenement_id: string; slug: string; titel: string; inschrijving_tot: string | null; contact_email: string | null }>();
  if (!ev) throw new DbFout('EVENEMENT_NIET_GEVONDEN');
  return ev;
}

export async function uitnodigingOverzicht(env: Env, g: Gebruiker, importId: string, evenementId: string) {
  await bestaat(env, importId);
  await evenementVoorUitnodigen(env, g, evenementId);
  const kinderen = await teUitnodigen(env, importId, evenementId);
  const status = await uitnodigingStatus(env, evenementId, bron(importId));
  return {
    nogNietIngeschreven: kinderen.length,
    contacten: new Set(kinderen.map((k) => k.contact_id)).size,
    ...status,
  };
}

export const MAILS_PER_KEER = 25;

/**
 * Maakt de ontbrekende uitnodigingen aan en mailt een deel van de contacten (de frontend herhaalt tot alles weg is).
 * Eén mail per contact: een link per kind, een link voor een ander kind, en per kind een afmeldlink.
 */
export async function verstuurUitnodigingen(env: Env, g: Gebruiker, importId: string, evenementId: string, body: any, ip: string | null) {
  await bestaat(env, importId);
  const ev = await evenementVoorUitnodigen(env, g, evenementId);
  const soort = body?.soort === 'herinnering' ? 'herinnering' : 'uitnodiging';
  const kinderen = await teUitnodigen(env, importId, evenementId);
  await maakUitnodigingen(env, evenementId, [
    ...kinderen.map((k) => ({
      contactId: k.contact_id,
      persoonId: k.persoon_id,
      voorinvullen: { schoolId: k.school_id, schoolAndere: k.school_andere, leerjaar: k.klas },
      bron: bron(importId),
    })),
    ...[...new Set(kinderen.map((k) => k.contact_id))].map((contactId) => ({ contactId, persoonId: null, bron: bron(importId) })),
  ]);

  const lijst = await teVersturen(env, evenementId, bron(importId), soort, MAILS_PER_KEER);
  const basis = env.PUBLIC_APP_URL.replace(/\/$/, '');
  const link = (token: string, extra = '') => `${basis}/${ev.slug}?uitnodiging=${token}${extra}`;
  let verstuurd = 0;
  let mislukt = 0;
  for (const c of lijst) {
    const kinderenInMail = c.links.filter((l) => l.persoonId);
    const ander = c.links.find((l) => !l.persoonId);
    try {
      const mail = uitnodigingsmail({
        aan: c.email,
        evenement: ev.titel,
        inschrijvingTot: ev.inschrijving_tot,
        contactEmail: ev.contact_email,
        herinnering: soort === 'herinnering',
        kinderen: kinderenInMail.map((l) => ({ naam: volledigeNaam(l), inschrijven: link(l.token), afmelden: link(l.token, '&afmelden=1') })),
        anderKind: ander ? link(ander.token) : null,
      });
      await verstuur(env, { ...mail, evenementId });
      await markeerVerstuurd(env, c.uitnodigingIds);
      verstuurd++;
    } catch (e) {
      console.error('uitnodigingsmail', String(e).slice(0, 200));
      mislukt++;
    }
  }
  const resterend = await aantalTeVersturen(env, evenementId, bron(importId), soort);
  await audit(env, g, 'voorinschrijvingen_importen', importId, soort === 'herinnering' ? 'HERINNERING' : 'UITNODIGING',
    { evenementId, verstuurd, mislukt }, ip).run();
  // Bij mislukte mails stopt de frontend (anders zou hij dezelfde mislukte mails blijven proberen).
  return { verstuurd, mislukt, resterend };
}
