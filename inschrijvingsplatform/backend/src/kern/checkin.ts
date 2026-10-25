import { esc } from './sjablonen';

/**
 * Check-in met een QR-code, voor elk soort evenement (infodag, sessie, congres, ticket). De QR-code bevat enkel
 * een link met een willekeurige check-intoken (nieuwToken(), 32 bytes) en het versienummer van de inschrijving op
 * het moment van de mail: geen naam, e-mail of school. Die token staat los van de beheertoken: wie de QR-code ziet
 * of scant, kan de inschrijving niet bekijken, wijzigen of annuleren. Is het versienummer lager dan het huidige,
 * dan toont iemand een oude mail (zie Plan_Checkin_en_Aanwezigheid.md).
 *
 * De afbeelding is een PNG (kern/qr.ts) op een eigen adres (/api/checkin/<token>/qr.png) en niet ingebed: Gmail en
 * Outlook tonen geen data:-afbeeldingen. De link staat er ook als tekst onder, voor wie afbeeldingen geblokkeerd heeft.
 */

export interface Checkin {
  basisUrl: string;
  token: string;
  versie: number;
}

const basis = (basisUrl: string) => basisUrl.replace(/\/$/, '');

/** Geldig versienummer uit een URL, of null. */
export function leesVersie(v: string | null): number | null {
  return v && /^[1-9][0-9]{0,6}$/.test(v) ? Number(v) : null;
}

/** Wat de QR-code bevat: de pagina die de scanner van het onthaal opent. */
export const checkinUrl = (c: Checkin) => `${basis(c.basisUrl)}/checkin/${c.token}?v=${c.versie}`;

export const qrAfbeeldingUrl = (c: Checkin) => `${basis(c.basisUrl)}/api/checkin/${c.token}/qr.png?v=${c.versie}`;

/** Vaste sectie onderaan een mail met QR-code (onder de tekst die beheerders aanpassen). */
export function checkinSectieHtml(c: Checkin): string {
  const url = checkinUrl(c);
  return `<h3>QR-code voor aanmelden op de dag van het evenement</h3>
<p>Toon deze QR-code bij aankomst aan het onthaal. De code wordt gebruikt om uw aanwezigheid te registreren.</p>
<p>Kreeg u meerdere mails over deze inschrijving? Gebruik dan de QR-code uit de meest recente mail.</p>
<p><img src="${esc(qrAfbeeldingUrl(c))}" width="220" height="220" alt="QR-code voor het onthaal" style="display:block;width:220px;height:220px;border:0"></p>
<p><small>Lukt het tonen van de afbeelding niet? Gebruik deze link: <a href="${esc(url)}" style="word-break:break-all">${esc(url)}</a></small></p>`;
}
