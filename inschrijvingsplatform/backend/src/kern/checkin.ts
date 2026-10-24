import { esc } from './sjablonen';

/**
 * Check-in met een QR-code, voor elk soort evenement (infodag, sessie, congres, ticket). De QR-code bevat enkel
 * een link met een willekeurige check-intoken (nieuwToken(), 32 bytes): geen naam, e-mail of school. Die token
 * staat los van de beheertoken: wie de QR-code ziet of scant, kan de inschrijving niet bekijken, wijzigen of annuleren.
 *
 * De afbeelding is een PNG (kern/qr.ts) op een eigen adres (/api/checkin/<token>/qr.png) en niet ingebed: Gmail en Outlook
 * tonen geen data:-afbeeldingen. De link staat er ook als tekst onder, voor wie afbeeldingen geblokkeerd heeft.
 */

const basis = (basisUrl: string) => basisUrl.replace(/\/$/, '');

/** Wat de QR-code bevat: de pagina die de scanner van het onthaal later opent. */
export const checkinUrl = (basisUrl: string, token: string) => `${basis(basisUrl)}/checkin/${token}`;

export const qrAfbeeldingUrl = (basisUrl: string, token: string) => `${basis(basisUrl)}/api/checkin/${token}/qr.png`;

/** Vaste sectie onderaan een bevestigingsmail (onder de tekst die beheerders aanpassen). */
export function checkinSectieHtml(basisUrl: string, token: string): string {
  const url = checkinUrl(basisUrl, token);
  return `<h3>QR-code voor aanmelden op de dag van het evenement</h3>
<p>Toon deze QR-code bij aankomst aan het onthaal. De code wordt gebruikt om uw aanwezigheid te registreren.</p>
<p><img src="${esc(qrAfbeeldingUrl(basisUrl, token))}" width="220" height="220" alt="QR-code voor het onthaal" style="display:block;width:220px;height:220px;border:0"></p>
<p><small>Lukt het tonen van de afbeelding niet? Gebruik deze link: <a href="${esc(url)}" style="word-break:break-all">${esc(url)}</a></small></p>`;
}
