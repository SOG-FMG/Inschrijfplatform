import { versleutel } from '../crypto/versleuteling';
import { audit } from './audit';
import { emailSleutel } from './contacten';
import { isToegelatenEmail } from './installatie';
import type { ContactBron } from './module';
import type { Gebruiker } from './toegang';
import type { Env } from '../types';
import { ValidatieFout } from '../validatie';

/**
 * Contacten met de hand toevoegen (Dashboard → Contacten → Contacten plakken), in een groep. De frontend leest de
 * geplakte adressen; hier wordt gevalideerd en bewaard. Een bestaand contact (zelfde e-mailadres) krijgt enkel de
 * groep erbij; een naam die er al staat, wordt niet overschreven.
 */

export const STANDAARD_GROEP = 'Met de hand toegevoegd';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const tekst = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function voegContactenToe(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const groep = tekst(body?.groep, 100) ?? STANDAARD_GROEP;
  const rijen: any[] = Array.isArray(body?.rijen) ? body.rijen.slice(0, 2000) : [];
  if (!rijen.length) throw new ValidatieFout({ rijen: 'Er zijn geen adressen om toe te voegen.' });

  const perAdres = new Map<string, { email: string; voornaam: string | null; naam: string | null }>();
  let ongeldig = 0;
  for (const r of rijen) {
    const email = tekst(r?.email, 254)?.toLowerCase();
    if (!email || !EMAIL.test(email)) { ongeldig++; continue; }
    perAdres.set(email, { email, voornaam: tekst(r?.voornaam, 100), naam: tekst(r?.naam, 100) });
  }
  const lijst = [];
  for (const c of perAdres.values()) {
    lijst.push({
      id: crypto.randomUUID(),
      hash: await emailSleutel(env, c.email),
      email: await versleutel(env, c.email),
      voornaam: await versleutel(env, c.voornaam),
      naam: await versleutel(env, c.naam),
      intern: isToegelatenEmail(env, c.email) ? 1 : 0,
    });
  }
  const json = JSON.stringify(lijst);
  const { results: bestaand } = await env.DB.prepare(`select email_hash from contacten where email_hash in (select json_extract(value, '$.hash') from json_each(?))`)
    .bind(json)
    .all<{ email_hash: string }>();

  const v = (veld: string) => `json_extract(j.value, '$.${veld}')`;
  await env.DB.batch([
    env.DB.prepare(
      `insert into contacten (contact_id, email_hash, email_enc, voornaam_enc, naam_enc)
       select ${v('id')}, ${v('hash')}, ${v('email')}, ${v('voornaam')}, ${v('naam')} from json_each(?) j where true
       on conflict (email_hash) do update set voornaam_enc = coalesce(contacten.voornaam_enc, excluded.voornaam_enc),
         naam_enc = coalesce(contacten.naam_enc, excluded.naam_enc)`,
    ).bind(json),
    env.DB.prepare(
      `insert or ignore into contact_groepen (contact_id, groep, intern, toegevoegd_door)
       select c.contact_id, ?1, ${v('intern')}, ?2 from json_each(?3) j join contacten c on c.email_hash = ${v('hash')}`,
    ).bind(groep, g.gebruikerId, json),
    audit(env, g, 'contacten', '*', 'TOEGEVOEGD', { groep, aantal: lijst.length, ongeldig }, ip),
  ]);
  return {
    groep,
    nieuw: lijst.length - bestaand.length,
    bestaand: bestaand.length,
    ongeldig,
    buitenOrganisatie: lijst.filter((x) => !x.intern).length,
  };
}

/** Iemand uit een groep halen. Zit het contact nergens anders, dan ruimt de dagelijkse taak het op. */
export async function haalUitGroep(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const id = typeof body?.id === 'string' && /^[0-9a-f]{64}$/.test(body.id) ? body.id : null;
  const groep = tekst(body?.groep, 100);
  if (!id || !groep) throw new ValidatieFout({ groep: 'Onbekend contact of groep.' });
  const r = await env.DB.prepare(`delete from contact_groepen where groep = ? and contact_id = (select contact_id from contacten where email_hash = ?)`)
    .bind(groep, id)
    .run();
  await audit(env, g, 'contacten', '*', 'UIT_GROEP', { groep, verwijderd: r.meta.changes }, ip).run();
  return { ok: true };
}

const bron = (intern: boolean): ContactBron => ({
  id: intern ? 'groepen-intern' : 'groepen-extern',
  extern: !intern,
  async lees(env) {
    const { results } = await env.DB.prepare(`select contact_id, groep, toegevoegd_op from contact_groepen where intern = ?`)
      .bind(intern ? 1 : 0)
      .all<{ contact_id: string; groep: string; toegevoegd_op: string }>();
    return results.map((x) => ({ contactId: x.contact_id, soort: 'Contact', omschrijving: x.groep, datum: x.toegevoegd_op }));
  },
});

/** Groepen in de contactenlijst: adressen van de eigen organisatie bij Medewerkers en lesgevers, de rest bij Ouders en inschrijvers. */
export const GROEPEN_BRONNEN: ContactBron[] = [bron(true), bron(false)];
