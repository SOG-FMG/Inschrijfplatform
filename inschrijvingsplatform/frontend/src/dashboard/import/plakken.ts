/**
 * Geplakte adressen lezen (Contacten → Contacten plakken), zonder schermen. Werkt met:
 *   - Outlook: "De Schepper Stijn" <stijn.deschepper@onderwijs.gent.be>; "Peeters An" <an.peeters@…>
 *   - "Achternaam, Voornaam" <adres>
 *   - losse adressen, gescheiden door ; , spaties of nieuwe regels (de naam komt dan uit het adres)
 *   - rijen uit Excel (cellen gescheiden door tabs: naam en adres in kolommen)
 * De voornaam is het deel van de naam dat overeenkomt met het begin van het e-mailadres (vóór de punt):
 * "De Schepper Stijn" + stijn.deschepper@… → voornaam Stijn, achternaam De Schepper. Lukt dat niet, dan
 * beslist de gekozen volgorde.
 */

export type Volgorde = 'naam-voornaam' | 'voornaam-naam';

export interface GeplakContact {
  voornaam: string;
  naam: string;
  email: string;
  /** Hoe de naam bepaald werd, om te tonen bij het nakijken. */
  herkend: 'adres' | 'komma' | 'volgorde' | 'uit-adres';
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MET_NAAM = /(?:"([^"]*)"|'([^']*)'|([^"'<>;,\n\r\t]*?))\s*<\s*([^\s<>;,]+@[^\s<>;,]+)\s*>/g;
const LOS = /[^\s<>;,"'()]+@[^\s<>;,"'()]+\.[a-z]{2,}/gi;

/** "Élise-Marie" → "elisemarie": voor het vergelijken met het adres. */
const vlak = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Naam en adres → voornaam en achternaam. */
export function splitsOpAdres(naam: string, email: string, standaard: Volgorde): GeplakContact {
  const schoon = naam.replace(/\([^)]*\)/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').trim();
  const adres = email.toLowerCase();
  if (!schoon || schoon.toLowerCase() === adres) {
    const delen = adres.split('@')[0].split(/[._]/).filter(Boolean);
    return { voornaam: hoofdletter(delen[0] ?? ''), naam: delen.slice(1).map(hoofdletter).join(' '), email: adres, herkend: 'uit-adres' };
  }
  if (schoon.includes(',')) {
    const [achter, ...voor] = schoon.split(',');
    return { voornaam: voor.join(',').trim(), naam: achter.trim(), email: adres, herkend: 'komma' };
  }
  const woorden = schoon.split(' ');
  if (woorden.length === 1) return { voornaam: woorden[0], naam: '', email: adres, herkend: 'volgorde' };

  const lokaal = adres.split('@')[0];
  const eerste = vlak(lokaal.split(/[._]/)[0]);
  const heel = vlak(lokaal);
  const deel = (n: number, achteraan: boolean) => (achteraan ? woorden.slice(-n) : woorden.slice(0, n));
  const rest = (n: number, achteraan: boolean) => (achteraan ? woorden.slice(0, -n) : woorden.slice(n));
  const maak = (n: number, achteraan: boolean): GeplakContact => ({ voornaam: deel(n, achteraan).join(' '), naam: rest(n, achteraan).join(' '), email: adres, herkend: 'adres' });
  // Eerst: het eerste deel van het adres is precies de voornaam (ook een voornaam van twee woorden).
  for (let n = 1; n < woorden.length; n++) {
    for (const achteraan of [standaard === 'naam-voornaam', standaard !== 'naam-voornaam']) {
      if (vlak(deel(n, achteraan).join('')) === eerste) return maak(n, achteraan);
    }
  }
  // Dan: het adres begint met de voornaam (stijndeschepper@…, stijn@…).
  for (const achteraan of [standaard === 'naam-voornaam', standaard !== 'naam-voornaam']) {
    const v = vlak(deel(1, achteraan).join(''));
    if (v.length >= 2 && heel.startsWith(v)) return maak(1, achteraan);
  }
  const achteraan = standaard === 'naam-voornaam';
  return { ...maak(1, achteraan), herkend: 'volgorde' };
}

export function leesGeplakt(tekst: string, standaard: Volgorde): GeplakContact[] {
  const gevonden: { naam: string; email: string }[] = [];
  if (tekst.includes('\t')) {
    // Rijen uit Excel: per regel het adres, de andere cellen samen vormen de naam.
    for (const regel of tekst.split(/\r?\n/)) {
      const cellen = regel.split('\t').map((c) => c.trim()).filter(Boolean);
      const email = cellen.find((c) => EMAIL.test(c));
      if (email) gevonden.push({ naam: cellen.filter((c) => c !== email).join(' '), email });
    }
  } else {
    let rest = tekst;
    for (const m of tekst.matchAll(MET_NAAM)) {
      gevonden.push({ naam: m[1] ?? m[2] ?? m[3] ?? '', email: m[4] });
      rest = rest.replace(m[0], ' ');
    }
    for (const m of rest.matchAll(LOS)) gevonden.push({ naam: '', email: m[0] });
  }
  const uit = new Map<string, GeplakContact>();
  for (const g of gevonden) {
    const email = g.email.trim().toLowerCase();
    if (!EMAIL.test(email) || uit.has(email)) continue;
    uit.set(email, splitsOpAdres(g.naam, email, standaard));
  }
  return [...uit.values()];
}
