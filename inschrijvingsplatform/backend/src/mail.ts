import type { Env, RegistratieResultaat } from './types';

export interface Mail {
  aan: string;
  onderwerp: string;
  html: string;
  /** Soort bericht, voor het logboek en de flow ('bevestiging', 'annulatie', 'test', 'melding'). */
  type?: string;
  referentie?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function bevestigingsmail(r: RegistratieResultaat, aan: string, voornaam: string, beheerUrl: string): Mail {
  const momenten = r.momenten
    .map((m) => `<li><strong>${esc(m.dag)} – ${esc(m.dagdeel)}</strong> (${esc(m.startUur)} – ${esc(m.eindUur)})</li>`)
    .join('');
  const keuzes = r.keuzes.length
    ? `<p>Gekozen onderdelen:</p><ul>${r.keuzes
        .map(
          (k) =>
            `<li>${esc(k.startUur)} – ${esc(k.titel)}${k.locatie ? ` (lokaal ${esc(k.locatie)})` : ''}${
              k.status === 'wachtlijst' ? ' – <em>op de wachtlijst</em>' : ''
            }</li>`,
        )
        .join('')}</ul>`
    : '';
  return {
    aan,
    type: 'bevestiging',
    referentie: r.referentie,
    onderwerp: `Bevestiging inschrijving ${r.evenement} (${r.referentie})`,
    html: `<p>Beste,</p>
<p>Bedankt! De inschrijving van <strong>${esc(voornaam)}</strong> voor <strong>${esc(r.evenement)}</strong> is goed ontvangen.</p>
<ul>${momenten}</ul>
${keuzes}
<p>Referentie: <strong>${esc(r.referentie)}</strong></p>
<p>Wil je je inschrijving bekijken of annuleren? Gebruik <a href="${esc(beheerUrl)}">deze persoonlijke link</a>.
Deel deze link niet met anderen.</p>
${r.contactEmail ? `<p>Vragen? Mail naar <a href="mailto:${esc(r.contactEmail)}">${esc(r.contactEmail)}</a>.</p>` : ''}
<p>Tot dan!</p>`,
  };
}

export function annulatiemail(p: { aan: string; voornaam: string; evenement: string; referentie: string; formulierUrl: string; contactEmail: string | null }): Mail {
  return {
    aan: p.aan,
    type: 'annulatie',
    referentie: p.referentie,
    onderwerp: `Inschrijving geannuleerd: ${p.evenement} (${p.referentie})`,
    html: `<p>Beste,</p>
<p>De inschrijving van <strong>${esc(p.voornaam)}</strong> voor <strong>${esc(p.evenement)}</strong> is geannuleerd. De plaatsen zijn vrijgegeven.</p>
<p>Referentie: <strong>${esc(p.referentie)}</strong></p>
<p>Toch komen? <a href="${esc(p.formulierUrl)}">Schrijf je opnieuw in</a>.</p>
${p.contactEmail ? `<p>Vragen? Mail naar <a href="mailto:${esc(p.contactEmail)}">${esc(p.contactEmail)}</a>.</p>` : ''}`,
  };
}

export function testmail(aan: string): Mail {
  return {
    aan,
    type: 'test',
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
