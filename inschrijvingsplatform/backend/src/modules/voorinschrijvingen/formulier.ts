import { versleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { emailSleutel, koppelAanContact } from '../../kern/contacten';
import { DbFout } from '../../kern/fouten';
import type { Gebruiker } from '../../kern/toegang';
import { esc, type SjabloonDefinitie, type Velden } from '../../kern/sjablonen';
import { mailVolgensSjabloon, type Mail, verstuur } from '../../mail';
import type { Env } from '../../types';
import { isUuid, ValidatieFout } from '../../validatie';

/**
 * Eigen voorinschrijvingsformulier (publiek: /voorinschrijven/<slug>). Elke inzending wordt meteen gekoppeld aan
 * het gezin (e-mailadres) en het kind (naam) en komt in de "import" van het formulier, zodat statistieken,
 * controles en uitnodigen dezelfde zijn als bij een bestand uit Forms. Zelfde kind opnieuw = bijwerken, geen dubbel.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TELEFOON = /^[+0-9 ()./-]{8,20}$/;

const tekst = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

interface FormulierRij {
  formulier_id: string;
  import_id: string;
  slug: string;
  titel: string;
  intro: string | null;
  schooljaar: string | null;
  leerjaar_opties: string;
  evenement_id: string | null;
  privacy_tekst: string | null;
  contact_email: string | null;
  open: number;
}

// ---------------------------------------------------------------------------
// Bevestigingsmail (sjabloon, aan te passen in Mailteksten)
// ---------------------------------------------------------------------------

export const SJABLONEN: SjabloonDefinitie[] = [
  {
    sleutel: 'voorinschrijving',
    naam: 'Bevestiging van een voorinschrijving',
    omschrijving: 'Na het invullen van het voorinschrijvingsformulier.',
    reden: 'je via ons formulier een voorinschrijving deed voor {{kind}}',
    velden: [
      { naam: 'ouder', omschrijving: 'Voornaam van de ouder', voorbeeld: 'An' },
      { naam: 'kind', omschrijving: 'Voornaam en naam van het kind', voorbeeld: 'Lotte Proef' },
      { naam: 'formulier', omschrijving: 'Titel van het formulier', voorbeeld: 'Voorinschrijving schooljaar 2026-2027' },
      { naam: 'schooljaar', omschrijving: 'Schooljaar (leeg als het niet ingesteld is)', voorbeeld: 'Schooljaar 2026 - 2027' },
      { naam: 'formulierlink', omschrijving: 'Link naar het formulier (om nog een kind toe te voegen)', voorbeeld: { html: '<a href="https://…">het formulier</a>' } },
      { naam: 'contactEmail', omschrijving: 'Contactadres (als link; leeg als er geen is)', voorbeeld: { html: '<a href="mailto:info@school.example">info@school.example</a>' } },
    ],
    standaard: {
      onderwerp: 'Voorinschrijving ontvangen: {{kind}}',
      tekst: `Beste {{ouder}},

Bedankt! We hebben de voorinschrijving van **{{kind}}**{{#schooljaar}} voor {{schooljaar}}{{/schooljaar}} goed ontvangen.

Zodra de inschrijvingen voor onze infodagen openen, krijg je een mail met een persoonlijke link. Het formulier is dan al ingevuld met de gegevens die je nu gaf.

Nog een kind voorinschrijven? Gebruik {{formulierlink}}.

{{#contactEmail}}Vragen? Mail naar {{contactEmail}}.{{/contactEmail}}`,
    },
  },
];

function bevestigingsmail(p: { aan: string; ouder: string; kind: string; formulier: string; schooljaar: string | null; formulierUrl: string; contactEmail: string | null }): Mail {
  const velden: Velden = {
    ouder: p.ouder, kind: p.kind, formulier: p.formulier, schooljaar: p.schooljaar,
    formulierlink: { html: `<a href="${esc(p.formulierUrl)}">het formulier</a>` },
    contactEmail: p.contactEmail ? { html: `<a href="mailto:${esc(p.contactEmail)}">${esc(p.contactEmail)}</a>` } : null,
  };
  return mailVolgensSjabloon(SJABLONEN[0], velden, { aan: p.aan, type: 'voorinschrijving' });
}

// ---------------------------------------------------------------------------
// Publiek
// ---------------------------------------------------------------------------

async function formulierOpSlug(env: Env, slug: string) {
  return env.DB.prepare(`select * from voorinschrijvingen_formulieren where slug = ?`).bind(slug).first<FormulierRij>();
}

/** Wat de publieke pagina toont, met de huisstijl van het gekozen evenement. */
export async function publiekFormulier(env: Env, slug: string) {
  const f = await formulierOpSlug(env, slug);
  if (!f) throw new DbFout('FORMULIER_NIET_GEVONDEN');
  const ev = f.evenement_id
    ? await env.DB.prepare(`select organisator, logo, logo_hoogte, kleur_primair, kleur_accent from evenementen where evenement_id = ?`)
        .bind(f.evenement_id)
        .first<{ organisator: string | null; logo: string | null; logo_hoogte: number | null; kleur_primair: string | null; kleur_accent: string | null }>()
    : null;
  return {
    slug: f.slug,
    titel: f.titel,
    intro: f.intro,
    schooljaar: f.schooljaar,
    leerjaarOpties: JSON.parse(f.leerjaar_opties) as string[],
    privacyTekst: f.privacy_tekst,
    contactEmail: f.contact_email,
    open: f.open === 1,
    organisator: ev?.organisator ?? null,
    logo: ev?.logo ?? null,
    logoHoogte: ev?.logo_hoogte ?? null,
    kleurPrimair: ev?.kleur_primair ?? null,
    kleurAccent: ev?.kleur_accent ?? null,
  };
}

export function valideerVoorinschrijving(body: any, leerjaarOpties: string[]) {
  const fouten: Record<string, string> = {};
  const v = {
    ouderVoornaam: tekst(body?.ouderVoornaam, 100),
    ouderNaam: tekst(body?.ouderNaam, 100),
    email: tekst(body?.email, 254)?.toLowerCase() ?? null,
    telefoon: tekst(body?.telefoon, 20),
    kindVoornaam: tekst(body?.kindVoornaam, 100),
    kindNaam: tekst(body?.kindNaam, 100),
    schoolId: tekst(body?.schoolId, 36),
    schoolAndere: tekst(body?.schoolAndere, 200),
    klas: tekst(body?.klas, 50),
    opmerkingen: tekst(body?.opmerkingen, 1000),
  };
  if (!v.ouderVoornaam) fouten.ouderVoornaam = 'Vul je voornaam in.';
  if (!v.email || !EMAIL.test(v.email)) fouten.email = 'Vul een geldig e-mailadres in.';
  if (v.telefoon && !TELEFOON.test(v.telefoon)) fouten.telefoon = 'Vul een geldig telefoonnummer in, bv. 0470 12 34 56.';
  if (!v.kindVoornaam) fouten.kindVoornaam = 'Vul de voornaam van je kind in.';
  if (!v.kindNaam) fouten.kindNaam = 'Vul de naam van je kind in.';
  if (v.schoolId && !isUuid(v.schoolId)) fouten.school = 'Kies een school uit de lijst.';
  if (!v.schoolId && !v.schoolAndere) fouten.school = 'Kies de huidige school.';
  if (leerjaarOpties.length && (!v.klas || !leerjaarOpties.includes(v.klas))) fouten.klas = 'Kies de huidige klas.';
  if (body?.privacyAkkoord !== true) fouten.privacyAkkoord = 'Je moet de privacyverklaring aanvaarden.';
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);
  return v as typeof v & { email: string; ouderVoornaam: string; kindVoornaam: string; kindNaam: string };
}

export async function bewaarVoorinschrijving(env: Env, slug: string, body: any, waitUntil: (p: Promise<unknown>) => void) {
  const f = await formulierOpSlug(env, slug);
  if (!f) throw new DbFout('FORMULIER_NIET_GEVONDEN');
  if (!f.open) throw new DbFout('FORMULIER_GESLOTEN');
  const v = valideerVoorinschrijving(body, JSON.parse(f.leerjaar_opties));
  if (v.schoolId) {
    const s = await env.DB.prepare(`select 1 from scholen where school_id = ?`).bind(v.schoolId).first();
    if (!s) throw new ValidatieFout({ school: 'Kies een school uit de lijst.' });
  }

  const k = await koppelAanContact(
    env,
    { email: v.email, voornaam: v.ouderVoornaam, naam: v.ouderNaam, telefoon: v.telefoon },
    { voornaam: v.kindVoornaam, naam: v.kindNaam },
  );
  const velden = [new Date().toISOString(), f.schooljaar, v.klas, v.schoolId, v.schoolId ? null : v.schoolAndere, await versleutel(env, v.opmerkingen)];
  const bestaand = await env.DB.prepare(`select id from voorinschrijvingen where import_id = ? and persoon_id = ?`).bind(f.import_id, k.persoonId).first<{ id: string }>();
  if (bestaand) {
    // Zelfde kind opnieuw: de laatste gegevens tellen, geen dubbele rij.
    await env.DB.prepare(
      `update voorinschrijvingen set ingediend_op = ?, schooljaar = ?, klas = ?, school_id = ?, school_andere = ?, opmerkingen_enc = ? where id = ?`,
    ).bind(...velden, bestaand.id).run();
  } else {
    await env.DB.batch([
      env.DB.prepare(
        `insert into voorinschrijvingen (id, import_id, ingediend_op, schooljaar, klas, school_id, school_andere, opmerkingen_enc, email_hash, contact_id, persoon_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), f.import_id, ...velden, await emailSleutel(env, v.email), k.contactId, k.persoonId),
      env.DB.prepare(`update voorinschrijvingen_importen set aantal = aantal + 1 where import_id = ?`).bind(f.import_id),
    ]);
  }

  const formulierUrl = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/voorinschrijven/${f.slug}`;
  waitUntil(
    verstuur(env, bevestigingsmail({
      aan: v.email, ouder: v.ouderVoornaam, kind: `${v.kindVoornaam} ${v.kindNaam}`, formulier: f.titel, schooljaar: f.schooljaar,
      formulierUrl, contactEmail: f.contact_email,
    })).catch((e) => console.error('voorinschrijvingsmail', String(e).slice(0, 200))),
  );
  return { ok: true, bijgewerkt: !!bestaand };
}

// ---------------------------------------------------------------------------
// Beheer
// ---------------------------------------------------------------------------

export async function formulieren(env: Env) {
  const { results } = await env.DB.prepare(
    `select f.formulier_id as id, f.import_id as importId, f.slug, f.titel, f.intro, f.schooljaar, f.leerjaar_opties as leerjaarOpties,
            f.evenement_id as evenementId, f.privacy_tekst as privacyTekst, f.contact_email as contactEmail, f.open, i.aantal
     from voorinschrijvingen_formulieren f join voorinschrijvingen_importen i on i.import_id = f.import_id order by f.created_at desc`,
  ).all<any>();
  return results.map((r) => ({ ...r, open: r.open === 1, leerjaarOpties: JSON.parse(r.leerjaarOpties) }));
}

function leesInstellingen(body: any, nieuw: boolean) {
  const fouten: Record<string, string> = {};
  const uit: Record<string, unknown> = {};
  const veld = (naam: string, max: number) => {
    if (body?.[naam] === undefined && !nieuw) return;
    uit[naam] = tekst(body?.[naam], max);
  };
  veld('titel', 120); veld('intro', 2000); veld('schooljaar', 60); veld('privacyTekst', 4000); veld('contactEmail', 254);
  if (body?.slug !== undefined || nieuw) {
    const slug = tekst(body?.slug, 80)?.toLowerCase() ?? '';
    if (!SLUG.test(slug)) fouten.slug = 'Enkel kleine letters, cijfers en enkele streepjes, bv. voorinschrijving-2027.';
    uit.slug = slug;
  }
  if (nieuw && !uit.titel) fouten.titel = 'Geef een titel.';
  if (body?.titel !== undefined && !uit.titel) fouten.titel = 'Geef een titel.';
  if (uit.contactEmail && !EMAIL.test(String(uit.contactEmail))) fouten.contactEmail = 'Geen geldig e-mailadres.';
  if (body?.leerjaarOpties !== undefined || nieuw) {
    const o = Array.isArray(body?.leerjaarOpties) ? body.leerjaarOpties.map((x: unknown) => tekst(x, 50)).filter(Boolean).slice(0, 20) : [];
    uit.leerjaarOpties = JSON.stringify(o);
  }
  if (body?.evenementId !== undefined || nieuw) {
    if (body?.evenementId && !isUuid(body.evenementId)) fouten.evenementId = 'Kies een evenement.';
    uit.evenementId = body?.evenementId || null;
  }
  if (body?.open !== undefined) uit.open = body.open === true ? 1 : 0;
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);
  return uit;
}

const KOLOM: Record<string, string> = {
  titel: 'titel', intro: 'intro', schooljaar: 'schooljaar', privacyTekst: 'privacy_tekst', contactEmail: 'contact_email',
  slug: 'slug', leerjaarOpties: 'leerjaar_opties', evenementId: 'evenement_id', open: 'open',
};

function slugFout(e: unknown): never {
  if (String(e).includes('voorinschrijvingen_formulieren.slug')) throw new ValidatieFout({ slug: 'Dit adres is al in gebruik.' });
  throw e;
}

export async function maakFormulier(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const w = leesInstellingen(body, true);
  const importId = crypto.randomUUID();
  const formulierId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`insert into voorinschrijvingen_importen (import_id, naam, bestandsnaam, aantal, created_by) values (?, ?, 'formulier', 0, ?)`)
      .bind(importId, w.titel, g.gebruikerId),
    env.DB.prepare(
      `insert into voorinschrijvingen_formulieren (formulier_id, import_id, slug, titel, intro, schooljaar, leerjaar_opties, evenement_id, privacy_tekst, contact_email)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(formulierId, importId, w.slug, w.titel, w.intro, w.schooljaar, w.leerjaarOpties, w.evenementId, w.privacyTekst, w.contactEmail),
    audit(env, g, 'voorinschrijvingen_formulieren', formulierId, 'MAAK', { slug: w.slug }, ip),
  ]).catch(slugFout);
  return { id: formulierId, importId };
}

export async function wijzigFormulier(env: Env, g: Gebruiker, id: string, body: any, ip: string | null) {
  const w = leesInstellingen(body, false);
  const delen = Object.keys(w);
  if (!delen.length) return { ok: true };
  const r = await env.DB.batch([
    env.DB.prepare(`update voorinschrijvingen_formulieren set ${delen.map((k) => `${KOLOM[k]} = ?`).join(', ')} where formulier_id = ?`).bind(...delen.map((k) => w[k]), id),
    ...(w.titel ? [env.DB.prepare(`update voorinschrijvingen_importen set naam = ? where import_id = (select import_id from voorinschrijvingen_formulieren where formulier_id = ?)`).bind(w.titel, id)] : []),
    audit(env, g, 'voorinschrijvingen_formulieren', id, 'WIJZIG', { velden: delen }, ip),
  ]).catch(slugFout);
  if (!r[0].meta.changes) throw new DbFout('FORMULIER_NIET_GEVONDEN');
  return { ok: true };
}
