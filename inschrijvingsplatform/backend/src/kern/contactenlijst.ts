import { ontsleutel } from '../crypto/versleuteling';
import { audit } from './audit';
import { emailSleutel } from './contacten';
import type { Module, Vermelding } from './module';
import { heeftRecht, leesbareEvenementen, type Gebruiker } from './toegang';
import type { Env } from '../types';

/**
 * De contactenlijst (Dashboard → Contacten): iedereen die in het platform voorkomt, één keer per e-mailadres, met waar
 * die persoon voorkomt. De modules leveren de vermeldingen (Module.contactBronnen); hier worden ze samengevoegd op de
 * blinde index van het e-mailadres, zodat een medewerker die ook lesgever en ouder is, één contact is.
 *
 * Ouders en inschrijvers (bronnen met extern) enkel met het recht kern.contacten.extern, dat ook voor de
 * platformbeheerder standaard uit staat. Wie niet alle evenementen mag lezen, ziet enkel vermeldingen van de eigen
 * evenementen (en vermeldingen zonder evenement, zoals "Medewerker").
 */

type Item = Omit<Vermelding, 'email' | 'contactId' | 'persoonId' | 'naam'>;

export interface ContactRij {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  soorten: string[];
  /** Komt (ook) voor als ouder of inschrijver. */
  extern: boolean;
  vermeldingen: Item[];
  /** Personen van dit contact (bv. kinderen) met hun eigen vermeldingen. */
  personen: { naam: string; vermeldingen: Item[] }[];
}

/** Eén onleesbare waarde (bv. een andere sleutel na een fout) mag de hele lijst niet blokkeren. */
const ONLEESBAAR = '(onleesbaar)';
const veilig = (env: Env, x: string | null) => ontsleutel(env, x).catch(() => ONLEESBAAR);

export async function contactenlijst(env: Env, g: Gebruiker, modules: Module[], ip: string | null) {
  const extern = heeftRecht(g, 'kern.contacten.extern');
  const evenementen = await leesbareEvenementen(env, g);
  const bronnen = modules.flatMap((m) => m.contactBronnen ?? []).filter((b) => extern || !b.extern);
  const per = await Promise.all(bronnen.map(async (b) => (await b.lees(env, { gebruiker: g, evenementen })).map((v) => ({ ...v, extern: b.extern }))));
  const alle = per.flat().filter((v) => !v.evenementId || !evenementen || evenementen.has(v.evenementId));

  // Contacten van de kern (ouders, inschrijvers): ontsleutelen, met hun personen.
  const contactIds = [...new Set(alle.map((v) => v.contactId).filter((x): x is string => !!x))];
  const contacten = new Map<string, { hash: string; email: string | null; naam: string; telefoon: string | null }>();
  for (let i = 0; i < contactIds.length; i += 300) {
    const { results } = await env.DB.prepare(
      `select contact_id, email_hash, email_enc, voornaam_enc, naam_enc, telefoon_enc from contacten where contact_id in (select value from json_each(?))`,
    )
      .bind(JSON.stringify(contactIds.slice(i, i + 300)))
      .all<{ contact_id: string; email_hash: string; email_enc: string | null; voornaam_enc: string | null; naam_enc: string | null; telefoon_enc: string | null }>();
    for (const r of results) {
      const [email, voornaam, naam, telefoon] = await Promise.all([r.email_enc, r.voornaam_enc, r.naam_enc, r.telefoon_enc].map((x) => veilig(env, x)));
      contacten.set(r.contact_id, { hash: r.email_hash, email: email === ONLEESBAAR ? null : email, naam: [voornaam, naam].filter(Boolean).join(' '), telefoon });
    }
  }
  const persoonNaam = new Map<string, string>();
  for (let i = 0; i < contactIds.length; i += 300) {
    const { results } = await env.DB.prepare(`select persoon_id, voornaam_enc, naam_enc from personen where contact_id in (select value from json_each(?))`)
      .bind(JSON.stringify(contactIds.slice(i, i + 300)))
      .all<{ persoon_id: string; voornaam_enc: string | null; naam_enc: string | null }>();
    for (const r of results) {
      const delen = await Promise.all([veilig(env, r.voornaam_enc), veilig(env, r.naam_enc)]);
      persoonNaam.set(r.persoon_id, delen.filter(Boolean).join(' ') || '(zonder naam)');
    }
  }

  const lijst = new Map<string, ContactRij & { personenMap: Map<string, ContactRij['personen'][number]> }>();
  for (const v of alle) {
    const c = v.contactId ? contacten.get(v.contactId) : undefined;
    const email = v.email?.trim().toLowerCase() || c?.email || null;
    const sleutel = c?.hash ?? (email ? await emailSleutel(env, email) : null);
    if (!sleutel) continue;
    let rij = lijst.get(sleutel);
    if (!rij) {
      rij = { id: sleutel, naam: '', email, telefoon: null, soorten: [], extern: false, vermeldingen: [], personen: [], personenMap: new Map() };
      lijst.set(sleutel, rij);
    }
    // De naam van een medewerker of lesgever gaat voor op die van het contact (die mensen kennen we zelf).
    if (v.naam && (!rij.naam || !v.extern)) rij.naam = v.naam;
    if (!rij.naam && c?.naam) rij.naam = c.naam;
    rij.email ??= email;
    rij.telefoon ??= c?.telefoon ?? null;
    rij.extern ||= v.extern;
    if (!rij.soorten.includes(v.soort)) rij.soorten.push(v.soort);
    const item: Item = { soort: v.soort, omschrijving: v.omschrijving, evenementId: v.evenementId ?? null, link: v.link ?? null, datum: v.datum ?? null };
    if (v.persoonId) {
      let p = rij.personenMap.get(v.persoonId);
      if (!p) rij.personenMap.set(v.persoonId, (p = { naam: persoonNaam.get(v.persoonId) ?? '(onbekend)', vermeldingen: [] }));
      p.vermeldingen.push(item);
    } else rij.vermeldingen.push(item);
  }

  const nl = new Intl.Collator('nl', { sensitivity: 'base' });
  const uit: ContactRij[] = [...lijst.values()].map(({ personenMap, ...r }) => ({
    ...r,
    naam: r.naam || r.email || '(zonder naam)',
    personen: [...personenMap.values()].sort((a, b) => nl.compare(a.naam, b.naam)),
  }));
  uit.sort((a, b) => nl.compare(a.naam, b.naam));
  await audit(env, g, 'contacten', '*', 'LIJST', { aantal: uit.length, extern }, ip).run();
  return { extern, contacten: uit };
}
