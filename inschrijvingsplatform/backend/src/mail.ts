import { installatie } from './kern/installatie';
import { aangepastSjabloon, esc, leesOpmaak, maakHtml, maakOnderwerp, verpakMail, type MailLogo, type SjabloonDefinitie, type Velden } from './kern/sjablonen';
import type { Env } from './types';

export interface Mail {
  aan: string;
  onderwerp: string;
  html: string;
  /** Soort bericht, voor het logboek en de flow ('bevestiging', 'annulatie', 'test', 'melding'). */
  type?: string;
  referentie?: string;
  /** Waarom de ontvanger deze mail krijgt (vaste regel onderaan elke mail). */
  reden?: string;
  /** Mail volgens een sjabloon: bij het versturen geldt de aangepaste tekst (Dashboard → Mailteksten), als die er is. */
  sjabloon?: { sleutel: string; velden: Velden };
  /** Vaste HTML onder de tekst, ook onder een aangepaste tekst (bv. de QR-code voor de check-in). */
  onderaan?: string;
  /** Evenement van de mail: zonder eigen banner (Mailteksten) staat het logo van het formulier bovenaan. */
  evenementId?: string | null;
}

/** Logo van het formulier van dit evenement, of null. WebP slaan we over: Outlook en oudere mailprogramma's tonen het niet. */
async function evenementLogo(env: Env, evenementId: string): Promise<MailLogo | null> {
  try {
    const e = await env.DB.prepare(`select logo, logo_hoogte from evenementen where evenement_id = ?`)
      .bind(evenementId)
      .first<{ logo: string | null; logo_hoogte: number | null }>();
    if (!e?.logo) return null;
    const obj = await env.STORAGE.head(`logos/${evenementId}`);
    if (!obj || obj.httpMetadata?.contentType === 'image/webp') return null;
    return { pad: e.logo, hoogte: e.logo_hoogte };
  } catch {
    return null;
  }
}

/** Bouwt een mail met de standaardtekst van het sjabloon; verstuur() vervangt die door de aangepaste tekst. */
export function mailVolgensSjabloon(def: SjabloonDefinitie, velden: Velden, extra: { aan: string; type: string; referentie?: string }): Mail {
  return {
    ...extra,
    onderwerp: maakOnderwerp(def.standaard.onderwerp, velden),
    html: maakHtml(def.standaard.tekst, velden),
    reden: maakOnderwerp(def.reden, velden),
    sjabloon: { sleutel: def.sleutel, velden },
  };
}


export function testmail(aan: string): Mail {
  return {
    aan,
    type: 'test',
    reden: 'je zelf een testmail vroeg in het beheer van het platform',
    onderwerp: '[Inschrijvingsplatform] Testmail',
    html: `<p>Dit is een testmail van het Inschrijvingsplatform.</p>
<p>Ontvang je dit, dan werkt de e-mailverzending: Worker → Power Automate → Outlook. Er is geen actie nodig.</p>`,
  };
}

/** Intern seintje bij een nieuwe melding. Bewust zonder de inhoud (kan persoonsgegevens bevatten). */
export function meldingsmail(aan: string, referentie: string, type: unknown): Mail {
  const soort = type === 'wens' ? 'Nieuwe wens/idee' : 'Nieuw gemeld probleem';
  return {
    aan,
    reden: 'dit adres ingesteld is om een seintje te krijgen bij nieuwe meldingen',
    onderwerp: `[Inschrijvingsplatform] ${soort} (${referentie})`,
    html: `<p>${soort} via het inschrijvingsformulier, referentie <strong>${esc(referentie)}</strong>.</p>
<p>Bekijk de melding in de beheeromgeving (GET /api/beheer/meldingen).</p>`,
  };
}

/** Verstuurt via Microsoft Graph (app-registratie met Mail.Send op één gedeelde mailbox). */
async function viaGraph(env: Env, mail: Mail): Promise<void> {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GRAPH_CLIENT_ID!,
      client_secret: env.GRAPH_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!tokenRes.ok) throw new Error(`Graph token ${tokenRes.status}`);
  const { access_token } = await tokenRes.json<{ access_token: string }>();

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.GRAPH_SENDER!)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: mail.onderwerp,
        body: { contentType: 'HTML', content: mail.html },
        toRecipients: [{ emailAddress: { address: mail.aan } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}`);
}

/** Enkel Microsoft-adressen voor Power Automate / Teams Workflows: een verkeerd secret kan geen andere server aanspreken. */
const TOEGELATEN_WEBHOOK_HOSTS = ['.logic.azure.com', '.powerplatform.com', '.powerautomate.com'];

export function webhookAdresGeldig(url: string | undefined): url is string {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' && TOEGELATEN_WEBHOOK_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

/**
 * Verstuurt via een Power Automate-flow (Teams Workflows): de Worker stuurt het volledige bericht als JSON,
 * de flow controleert `sleutel` en verstuurt de mail vanuit de gedeelde mailbox. Twee pogingen.
 */
async function viaWebhook(env: Env, mail: Mail): Promise<void> {
  if (!webhookAdresGeldig(env.MAIL_WEBHOOK_URL)) throw new Error('MAIL_WEBHOOK_URL ontbreekt of is geen Power Automate-adres');
  const body = JSON.stringify({
    sleutel: env.MAIL_WEBHOOK_SLEUTEL ?? '',
    type: mail.type ?? 'bericht',
    referentie: mail.referentie ?? '',
    aan: mail.aan,
    onderwerp: mail.onderwerp,
    html: mail.html,
  });
  let laatste = '';
  for (let poging = 1; poging <= 2; poging++) {
    try {
      const res = await fetch(env.MAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return; // 200/202: de flow heeft het bericht aanvaard
      laatste = `status ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // opnieuw proberen helpt niet
    } catch (e) {
      laatste = e instanceof Error ? e.name : 'netwerkfout';
    }
    if (poging < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`webhook ${laatste}`);
}

export async function verstuur(env: Env, mail: Mail): Promise<'verzonden' | 'overgeslagen'> {
  if (mail.sjabloon) {
    const aangepast = await aangepastSjabloon(env, mail.sjabloon.sleutel);
    if (aangepast) {
      mail = { ...mail, onderwerp: maakOnderwerp(aangepast.onderwerp, mail.sjabloon.velden), html: maakHtml(aangepast.tekst, mail.sjabloon.velden) };
    }
  }
  // Banner (of anders het logo van het formulier), voettekst en de vaste regel wie de mail stuurt en waarom.
  const opmaak = await leesOpmaak(env);
  const logo = !opmaak.kopBanner && mail.evenementId ? await evenementLogo(env, mail.evenementId) : null;
  mail = { ...mail, html: verpakMail(mail.html + (mail.onderaan ?? ''), { opmaak, organisatie: installatie(env).organisatie, basisUrl: env.PUBLIC_APP_URL, reden: mail.reden, logo }) };
  if (env.MAIL_PROVIDER === 'webhook') {
    await viaWebhook(env, mail);
    return 'verzonden';
  }
  if (env.MAIL_PROVIDER === 'graph') {
    await viaGraph(env, mail);
    return 'verzonden';
  }
  // Ontwikkeling: niet versturen, enkel het onderwerp loggen (geen persoonsgegevens in logs).
  console.log(`[mail overgeslagen] ${mail.onderwerp}`);
  return 'overgeslagen';
}
