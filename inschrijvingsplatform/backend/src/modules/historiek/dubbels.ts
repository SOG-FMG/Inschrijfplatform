import { ontsleutel } from '../../crypto/versleuteling';
import { audit } from '../../kern/audit';
import { DbFout } from '../../kern/fouten';
import { maakHtml } from '../../kern/sjablonen';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import { verstuur } from '../../mail';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';
import { promoveerWachtlijst } from '../evenementen/capaciteit';

/**
 * Dubbels in een evenement oplossen. Het dashboard zoekt de groepen (zelfde kind, ook met een ander e-mailadres of
 * een licht andere naam) en stelt voor wat te bewaren; hier gebeurt het samenvoegen en het mailen van een vraag.
 */

const ids = (x: unknown, max = 20) =>
  Array.isArray(x) && x.length <= max && x.every((i) => typeof i === 'string' && /^[0-9a-f-]{36}$/.test(i)) ? [...new Set(x as string[])] : null;

/** Deelnemers die allemaal bij dit evenement horen (anders: geen toegang, zonder te verraden wat bestaat). */
async function vanEvenement(env: Env, evenementId: string, deelnemerIds: string[]) {
  const { results } = await env.DB.prepare(
    `select deelnemer_id, persoon_id, contact_id, email_enc, status from deelnemers where evenement_id = ? and deelnemer_id in (select value from json_each(?))`,
  )
    .bind(evenementId, JSON.stringify(deelnemerIds))
    .all<{ deelnemer_id: string; persoon_id: string | null; contact_id: string | null; email_enc: string | null; status: string }>();
  if (results.length !== deelnemerIds.length) throw new DbFout('GEEN_TOEGANG');
  return results;
}

/**
 * Samenvoegen: één inschrijving blijft (meestal de laatste), de andere worden geannuleerd en verwijzen voortaan naar
 * hetzelfde kind, zodat de historiek ze samen toont. Vrijgekomen plaatsen gaan naar de wachtlijst.
 */
export async function voegSamen(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const behoud = ids([body?.behoud], 1)?.[0];
  const weg = ids(body?.weg);
  if (!behoud || !weg?.length || weg.includes(behoud)) throw new ValidatieFout({ dubbels: 'Kies welke inschrijving blijft en welke weg mogen.' });
  const rijen = await vanEvenement(env, evenementId, [behoud, ...weg]);
  const blijft = rijen.find((r) => r.deelnemer_id === behoud)!;

  const db = env.DB;
  const { results: sessies } = await db.prepare(
    `select distinct sessie_id from inschrijvingen where deelnemer_id in (select value from json_each(?)) and sessie_id is not null and status = 'bevestigd'`,
  )
    .bind(JSON.stringify(weg))
    .all<{ sessie_id: string }>();
  const lijst = JSON.stringify(weg);
  await db.batch([
    db.prepare(`update inschrijvingen set status = 'geannuleerd' where deelnemer_id in (select value from json_each(?))`).bind(lijst),
    db.prepare(`update deelnemers set status = 'geannuleerd', persoon_id = coalesce(?, persoon_id) where deelnemer_id in (select value from json_each(?))`)
      .bind(blijft.persoon_id, lijst),
    // Een eerder vervangen (geannuleerde) inschrijving bewaren: ze wordt weer actief, met haar momenten en lesjes
    // (zonder capaciteitscontrole; "or ignore" slaat een lesje over als er in dat tijdsblok al een ander actief is).
    ...(blijft.status === 'actief' ? [] : [
      db.prepare(`update deelnemers set status = 'actief' where deelnemer_id = ?`).bind(behoud),
      db.prepare(`update or ignore inschrijvingen set status = 'bevestigd' where deelnemer_id = ? and status = 'geannuleerd'`).bind(behoud),
    ]),
    ...sessies.map((s) => promoveerWachtlijst(db, s.sessie_id)),
    audit(env, g, 'evenementen', evenementId, 'DUBBELS_SAMENGEVOEGD', { behoud, weg }, ip),
  ]);
  return { ok: true, geannuleerd: weg.length };
}

/** Een vraag mailen aan de ouder(s) van deze inschrijvingen (één mail per adres), met de tekst uit het dashboard. */
export async function mailVraag(env: Env, g: Gebruiker, evenementId: string, body: any, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const deelnemers = ids(body?.deelnemers);
  const onderwerp = typeof body?.onderwerp === 'string' ? body.onderwerp.trim().slice(0, 200) : '';
  const tekst = typeof body?.tekst === 'string' ? body.tekst.trim().slice(0, 10_000) : '';
  const fouten: Record<string, string> = {};
  if (!deelnemers?.length) fouten.deelnemers = 'Geen inschrijvingen gekozen.';
  if (!onderwerp) fouten.onderwerp = 'Vul een onderwerp in.';
  if (!tekst) fouten.tekst = 'Vul de tekst van de mail in.';
  if (Object.keys(fouten).length) throw new ValidatieFout(fouten);

  const rijen = await vanEvenement(env, evenementId, deelnemers!);
  const adressen = new Set<string>();
  for (const r of rijen) {
    const e = (await ontsleutel(env, r.email_enc))?.toLowerCase();
    if (e) adressen.add(e);
  }
  if (!adressen.size) throw new ValidatieFout({ deelnemers: 'Er is geen e-mailadres gekend voor deze inschrijving(en).' });
  let verstuurd = 0;
  let mislukt = 0;
  for (const aan of adressen) {
    try {
      await verstuur(env, {
        aan,
        onderwerp,
        html: maakHtml(tekst, {}),
        type: 'vraag',
        reden: 'je je kind inschreef en we een vraag hebben over die inschrijving',
        evenementId,
      });
      verstuurd++;
    } catch (e) {
      console.error('vraagmail', String(e).slice(0, 200));
      mislukt++;
    }
  }
  await audit(env, g, 'evenementen', evenementId, 'DUBBELS_MAIL', { deelnemers, verstuurd, mislukt }, ip).run();
  return { verstuurd, mislukt, aan: [...adressen] };
}
