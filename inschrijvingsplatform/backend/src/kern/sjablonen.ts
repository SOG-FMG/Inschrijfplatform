import type { Env } from '../types';

/**
 * Mailsjablonen (kern). Een module meldt haar mails in haar manifest (mailsjablonen): een sleutel, de velden die
 * erin kunnen, en de standaardtekst. De module "mailsjablonen" laat beheerders de tekst aanpassen; die aangepaste
 * tekst staat in de tabel mailsjablonen en wordt bij het versturen gebruikt (zie verstuur in mail.ts).
 *
 * Opmaak van een sjabloon (gewone tekst, geen HTML):
 *   lege regel            nieuwe alinea
 *   **vet**               vet
 *   {{veld}}              waarde van het veld (tekst wordt veilig gemaakt; blokken zoals een lijst met links blijven)
 *   {{#veld}}…{{/veld}}   enkel als het veld ingevuld is      {{^veld}}…{{/veld}}  enkel als het leeg is
 */

/** Een veldwaarde: tekst (wordt ge-escaped) of een kant-en-klaar HTML-blok (lijst, link, tabel). */
export type Veldwaarde = string | { html: string } | null | undefined;
export type Velden = Record<string, Veldwaarde>;

export interface SjabloonVeld {
  naam: string;
  omschrijving: string;
  /** Voorbeeldwaarde voor het voorbeeld en de testmail. */
  voorbeeld: Veldwaarde;
}

export interface SjabloonDefinitie {
  sleutel: string;
  naam: string;
  omschrijving: string;
  velden: SjabloonVeld[];
  standaard: { onderwerp: string; tekst: string };
  /**
   * Waarom de ontvanger deze mail krijgt, voor de vaste regel onderaan ("Je ontvangt ze omdat …"). Mag velden
   * bevatten, bv. "je een inschrijving deed voor {{evenement}}". Niet aan te passen door beheerders.
   */
  reden: string;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ingevuld = (v: Veldwaarde) => (typeof v === 'string' ? v.trim() !== '' : !!v && v.html.trim() !== '');

/** {{#veld}}…{{/veld}} en {{^veld}}…{{/veld}}, ook genest en over meerdere alinea's. */
function secties(tekst: string, velden: Velden): string {
  let vorige: string;
  do {
    vorige = tekst;
    tekst = tekst.replace(/\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, soort: string, naam: string, binnen: string) =>
      (soort === '#') === ingevuld(velden[naam]) ? binnen : '',
    );
  } while (tekst !== vorige);
  return tekst;
}

const waarde = (v: Veldwaarde) => (typeof v === 'object' && v ? v.html : esc(v));

/** Sjabloontekst → HTML voor de mail. */
export function maakHtml(tekst: string, velden: Velden): string {
  return secties(tekst.replace(/\r\n/g, '\n'), velden)
    .split(/\n\s*\n/)
    .map((alinea) => alinea.trim())
    .filter(Boolean)
    .map((alinea) => {
      // Een alinea die enkel uit één blokveld bestaat (lijst, tabel): zonder <p> eromheen.
      const alleen = /^\{\{(\w+)\}\}$/.exec(alinea);
      if (alleen && typeof velden[alleen[1]] === 'object') return waarde(velden[alleen[1]]);
      const html = esc(alinea)
        .replace(/\{\{(\w+)\}\}/g, (_, naam: string) => waarde(velden[naam]))
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      return `<p>${html}</p>`;
    })
    .join('\n');
}

/** Sjabloon voor het onderwerp → platte tekst (blokken worden weggelaten). */
export function maakOnderwerp(tekst: string, velden: Velden): string {
  return secties(tekst, velden)
    .replace(/\{\{(\w+)\}\}/g, (_, naam: string) => (typeof velden[naam] === 'object' ? '' : String(velden[naam] ?? '')))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fouten in een sjabloon: onbekende velden en secties die niet gesloten worden. */
export function controleerSjabloon(tekst: string, def: SjabloonDefinitie): string[] {
  const fouten: string[] = [];
  const bekend = new Set(def.velden.map((v) => v.naam));
  for (const m of tekst.matchAll(/\{\{([#^/]?)(\w*)\}\}/g)) {
    if (!bekend.has(m[2])) fouten.push(`Onbekend veld {{${m[1]}${m[2]}}}.`);
  }
  const open = [...tekst.matchAll(/\{\{[#^](\w+)\}\}/g)].length;
  const dicht = [...tekst.matchAll(/\{\{\/(\w+)\}\}/g)].length;
  if (open !== dicht) fouten.push('Een {{#veld}} of {{^veld}} wordt niet gesloten met {{/veld}}.');
  if (/\{\{(?!\s*[#^/]?\w+\s*\}\})/.test(tekst)) fouten.push('Een veld is niet goed geschreven: gebruik {{naam}}.');
  return [...new Set(fouten)];
}

export const voorbeeldVelden = (def: SjabloonDefinitie): Velden => Object.fromEntries(def.velden.map((v) => [v.naam, v.voorbeeld]));

/** De aangepaste tekst van dit sjabloon, of null (dan geldt de standaardtekst). Werkt ook als de tabel nog niet bestaat. */
export async function aangepastSjabloon(env: Env, sleutel: string): Promise<{ onderwerp: string; tekst: string } | null> {
  try {
    return await env.DB.prepare(`select onderwerp, tekst from mailsjablonen where sleutel = ?`).bind(sleutel).first<{ onderwerp: string; tekst: string }>();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Opmaak van elke mail: banner bovenaan, inhoud, banner onderaan, eigen voettekst en de vaste regel
// ---------------------------------------------------------------------------

/** Aanbevolen afmetingen (px). Mails zijn 600 px breed; dubbele resolutie blijft scherp op telefoons. */
export const BANNERS = {
  kop: { breedte: 1200, hoogte: 300, toon: '600 × 150', maxVerhouding: 0.5 },
  voet: { breedte: 1200, hoogte: 200, toon: '600 × 100', maxVerhouding: 0.34 },
} as const;

export interface Mailopmaak {
  kopBanner: string | null;
  voetBanner: string | null;
  voettekst: string | null;
  /** Bovenaan het logo van het evenement (Algemeen > Huisstijl) in plaats van de kopbanner. */
  logoUitHuisstijl: boolean;
}

/** De opmaak van deze installatie (module mailsjablonen), of leeg. Werkt ook als de tabel nog niet bestaat. */
export async function leesOpmaak(env: Env): Promise<Mailopmaak> {
  // Eerst met de kolom logo_uit_huisstijl; bestaat die nog niet (migratie nog niet uitgevoerd), dan met de
  // standaardwaarde 1, zodat een mail nooit zonder banner of logo komt te staan.
  for (const kolom of ['logo_uit_huisstijl', '1']) {
    try {
      const r = await env.DB.prepare(`select kop_banner, voet_banner, voettekst, ${kolom} as logo_uit_huisstijl from mailopmaak where id = 1`)
        .first<{ kop_banner: string | null; voet_banner: string | null; voettekst: string | null; logo_uit_huisstijl: number | null }>();
      return {
        kopBanner: r?.kop_banner ?? null,
        voetBanner: r?.voet_banner ?? null,
        voettekst: r?.voettekst ?? null,
        logoUitHuisstijl: (r?.logo_uit_huisstijl ?? 1) === 1,
      };
    } catch {
      // volgende poging
    }
  }
  return { kopBanner: null, voetBanner: null, voettekst: null, logoUitHuisstijl: true };
}

export const VOETTEKST_VELDEN: SjabloonVeld[] = [
  { naam: 'organisatie', omschrijving: 'Naam van de organisatie (installatie)', voorbeeld: 'Freinetmiddenschool Gent' },
  { naam: 'website', omschrijving: 'Adres van het platform', voorbeeld: 'inschrijven.example' },
];

/**
 * Verpakt de inhoud van een mail: banner bovenaan (of anders het logo van het evenement), inhoud, banner onderaan, eigen voettekst en altijd de regel
 * wie de mail stuurt, via welk platform en waarom. Tabellen en inline stijl: zo tonen ook Outlook en Gmail het goed.
 */
/** Logo van het formulier: bovenaan de mail als er geen eigen banner is (zie verstuur()). */
export interface MailLogo {
  /** Publiek pad, bv. /api/logo/<evenement>?v=… */
  pad: string;
  hoogte: number | null;
}

/** Hoogste logo in een mail (px); het formulier toont standaard 135. */
const MAX_LOGO_HOOGTE = 120;

export function verpakMail(inhoud: string, p: { opmaak: Mailopmaak; organisatie: string; basisUrl: string; reden: string | undefined; logo?: MailLogo | null }): string {
  const website = p.basisUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const beeld = (pad: string, alt: string, breedte: number) =>
    `<img src="${esc(p.basisUrl.replace(/\/$/, '') + pad)}" alt="${esc(alt)}" width="${breedte}" style="display:block;width:100%;max-width:${breedte}px;height:auto;border:0">`;
  // Geen lijn onder het logo: de mail begint met het beeld zelf (beslissing 26/10/2026).
  const logoRij = (l: MailLogo) => {
    const h = Math.min(l.hoogte ?? MAX_LOGO_HOOGTE, MAX_LOGO_HOOGTE);
    return `<tr><td align="center" style="padding:16px 24px"><img src="${esc(p.basisUrl.replace(/\/$/, '') + l.pad)}" alt="${esc(p.organisatie)}" height="${h}" style="display:block;height:${h}px;width:auto;max-width:100%;border:0"></td></tr>`;
  };
  // Met het vinkje "afbeelding uit Algemeen > Huisstijl" (standaard aan) gaat het logo van het evenement voor op
  // de gemeenschappelijke kopbanner. Heeft het evenement geen logo, dan komt de banner alsnog bovenaan.
  const bannerRij = p.opmaak.kopBanner ? `<tr><td>${beeld(p.opmaak.kopBanner, p.organisatie, 600)}</td></tr>` : '';
  const kop = p.opmaak.logoUitHuisstijl && p.logo ? logoRij(p.logo) : bannerRij || (p.logo ? logoRij(p.logo) : '');
  // Staat er een banner onderaan, dan loopt die door in de voettekst: wit in plaats van een grijze streep eronder.
  const voetLijn = p.opmaak.voetBanner ? '#ffffff' : '#cfd6df';
  const eigen = p.opmaak.voettekst ? maakHtml(p.opmaak.voettekst, { organisatie: p.organisatie, website }) : '';
  const vast = `<p>Deze mail werd verstuurd door ${esc(p.organisatie)} via het inschrijvingsplatform <a href="${esc(p.basisUrl)}">${esc(website)}</a>.
Je ontvangt ze omdat ${esc(p.reden ?? `je via dit platform contact had met ${p.organisatie}`)}.</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse">
${kop}
<tr><td style="padding:20px 24px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1b1f24">
${inhoud}
</td></tr>
${p.opmaak.voetBanner ? `<tr><td>${beeld(p.opmaak.voetBanner, '', 600)}</td></tr>` : ''}
<tr><td style="padding:12px 24px 18px;border-top:1px solid ${voetLijn};font:12px/1.5 Arial,Helvetica,sans-serif;color:#545c66">
${eigen}
${vast}
</td></tr>
</table>
</td></tr></table>`;
}
