import { audit } from '../../kern/audit';
import { controleerToegang, type Gebruiker } from '../../kern/toegang';
import type { PubliekCtx } from '../../kern/module';
import { type Mail, verstuur } from '../../mail';
import type { Env } from '../../types';
import { overzichtsmail } from './mails';
import { mailGegevens } from './registratie';

export const basisUrl = (env: Env) => env.PUBLIC_APP_URL.replace(/\/$/, '');

/**
 * Check-in van de module evenementen (zie kern/checkin.ts en Plan_Checkin_en_Aanwezigheid.md).
 * Hier: de QR-code mailen aan inschrijvingen van vóór de QR-code.
 */

/** Per klik; zo blijft één aanvraag ruim binnen de limieten van een Worker (zelfde aantal als bij de uitnodigingen). */
export const QR_MAILS_PER_KEER = 25;

/** Resultaat van een mail bewaren, zonder inhoud (mail_berichten). */
export function logMail(env: Env, deelnemerId: string, type: string, status: string, fout?: string) {
  return env.DB.prepare(`insert into mail_berichten (bericht_id, deelnemer_id, type, status, fout) values (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), deelnemerId, type, status, fout ?? null)
    .run();
}

export const markeerQrGemaild = (env: Env, deelnemerId: string) =>
  env.DB.prepare(`update deelnemers set checkin_gemaild_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where deelnemer_id = ?`).bind(deelnemerId).run();

const zonderQr = `from deelnemers where evenement_id = ? and status = 'actief' and geanonimiseerd_op is null
  and email_enc is not null and checkin_gemaild_op is null`;

/** Hoeveel actieve inschrijvingen nog nooit een mail met QR-code kregen. */
export async function qrMailsTeVersturen(env: Env, g: Gebruiker, evenementId: string) {
  await controleerToegang(env, g, evenementId);
  const r = await env.DB.prepare(`select count(*) as n ${zonderQr}`).bind(evenementId).first<{ n: number }>();
  return { teVersturen: r?.n ?? 0 };
}

/** Stuurt de volgende reeks QR-mails. Een tweede klik stuurt niemand een tweede keer. */
export async function verstuurQrMails(env: Env, g: Gebruiker, evenementId: string, basisUrl: string, ip: string | null) {
  await controleerToegang(env, g, evenementId, true);
  const { results } = await env.DB.prepare(`select deelnemer_id ${zonderQr} order by created_at limit ?`)
    .bind(evenementId, QR_MAILS_PER_KEER)
    .all<{ deelnemer_id: string }>();
  let verstuurd = 0;
  let mislukt = 0;
  for (const { deelnemer_id: id } of results) {
    const m = await mailGegevens(env, id);
    if (!m?.checkin) continue;
    try {
      const status = await verstuur(env, { ...overzichtsmail('qrcode', { ...m, aan: m.email, checkin: { basisUrl, ...m.checkin } }), evenementId });
      await markeerQrGemaild(env, id);
      await logMail(env, id, 'qrcode', status);
      verstuurd++;
    } catch (e) {
      await logMail(env, id, 'qrcode', 'mislukt', String(e).slice(0, 500));
      mislukt++;
    }
  }
  await audit(env, g, 'evenementen', evenementId, 'QR_MAILS', { verstuurd, mislukt }, ip).run();
  return { verstuurd, mislukt, ...(await qrMailsTeVersturen(env, g, evenementId)) };
}

/**
 * Verstuurt een mail op de achtergrond en bewaart het resultaat (zonder inhoud) in mail_berichten.
 * `qr`: de mail bevat de QR-code voor het onthaal; dan onthouden we dat deze inschrijving er een kreeg.
 */
export function stuurEnLog(env: Env, ctx: PubliekCtx, deelnemerId: string, mail: Mail, qr = false) {
  const log = (status: string, fout?: string) => logMail(env, deelnemerId, mail.type ?? 'bericht', status, fout);
  const evenement = () =>
    env.DB.prepare(`select evenement_id from deelnemers where deelnemer_id = ?`).bind(deelnemerId).first<{ evenement_id: string }>();
  ctx.waitUntil(
    evenement()
      .then((e) => verstuur(env, { ...mail, evenementId: mail.evenementId ?? e?.evenement_id }))
      .then(async (status) => {
        if (qr) await markeerQrGemaild(env, deelnemerId);
        return log(status);
      })
      .catch((e) => log('mislukt', String(e).slice(0, 500))),
  );
}

/** Na een wijziging door de school: mail met het nieuwe overzicht en een nieuwe QR-code. */
export async function verwittigNaWijzigingDoorSchool(env: Env, ctx: PubliekCtx, deelnemerId: string) {
  const m = await mailGegevens(env, deelnemerId);
  if (!m) return;
  stuurEnLog(env, ctx, deelnemerId, overzichtsmail('schoolwijziging', { ...m, aan: m.email, checkin: { basisUrl: basisUrl(env), ...m.checkin } }), true);
}

