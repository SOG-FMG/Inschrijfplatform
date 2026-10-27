import { audit } from '../../kern/audit';
import type { Gebruiker } from '../../kern/toegang';
import { BANNERS, controleerSjabloon, leesOpmaak, VOETTEKST_VELDEN, type SjabloonDefinitie } from '../../kern/sjablonen';
import type { Env } from '../../types';
import { ValidatieFout } from '../../validatie';

/** Banners en voettekst voor alle mails (zie kern/sjablonen.ts, verpakMail). */

const MAX_BYTES = 500 * 1024;
export type Plaats = keyof typeof BANNERS;
export const isPlaats = (p: string): p is Plaats => p in BANNERS;

/** Breedte en hoogte uit de kop van een PNG- of JPG-bestand, of null als het geen van beide is. */
export function afmetingen(data: Uint8Array): { type: 'image/png' | 'image/jpeg'; breedte: number; hoogte: number } | null {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { type: 'image/png', breedte: dv.getUint32(16), hoogte: dv.getUint32(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const lengte = dv.getUint16(i + 2);
      // SOF0..SOF15 behalve DHT (C4), JPG (C8) en DAC (CC): daar staan de afmetingen
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', hoogte: dv.getUint16(i + 5), breedte: dv.getUint16(i + 7) };
      }
      i += 2 + lengte;
    }
  }
  return null;
}

const VOETTEKST_DEF: SjabloonDefinitie = {
  sleutel: 'voettekst', naam: 'Voettekst', omschrijving: '', reden: '', velden: VOETTEKST_VELDEN, standaard: { onderwerp: '', tekst: '' },
};

export async function opmaak(env: Env) {
  const o = await leesOpmaak(env);
  const basis = env.PUBLIC_APP_URL.replace(/\/$/, '');
  return {
    kopBanner: o.kopBanner ? basis + o.kopBanner : null,
    voetBanner: o.voetBanner ? basis + o.voetBanner : null,
    voettekst: o.voettekst ?? '',
    logoUitHuisstijl: o.logoUitHuisstijl,
    velden: VOETTEKST_VELDEN.map(({ naam, omschrijving }) => ({ naam, omschrijving })),
    banners: BANNERS,
  };
}

const zorgVoorRij = (env: Env) => env.DB.prepare(`insert or ignore into mailopmaak (id) values (1)`);

/** Voettekst en/of het vinkje "afbeelding uit Algemeen > Huisstijl"; enkel wat meegestuurd wordt, verandert. */
export async function bewaarOpmaak(env: Env, g: Gebruiker, body: any, ip: string | null) {
  const stap = `gewijzigd_door = ?, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  const stmts: D1PreparedStatement[] = [zorgVoorRij(env)];

  if (typeof body?.voettekst === 'string') {
    const tekst = body.voettekst.replace(/\r\n/g, '\n').trim();
    if (tekst.length > 2000) throw new ValidatieFout({ voettekst: 'Maximaal 2000 tekens.' });
    const fouten = controleerSjabloon(tekst, VOETTEKST_DEF);
    if (fouten.length) throw new ValidatieFout({ voettekst: fouten.join(' ') });
    stmts.push(
      env.DB.prepare(`update mailopmaak set voettekst = ?, ${stap} where id = 1`).bind(tekst || null, g.gebruikerId),
      audit(env, g, 'mailopmaak', '1', 'VOETTEKST', undefined, ip),
    );
  }
  if (typeof body?.logoUitHuisstijl === 'boolean') {
    stmts.push(
      env.DB.prepare(`update mailopmaak set logo_uit_huisstijl = ?, ${stap} where id = 1`).bind(body.logoUitHuisstijl ? 1 : 0, g.gebruikerId),
      audit(env, g, 'mailopmaak', '1', 'LOGO_UIT_HUISSTIJL', { aan: body.logoUitHuisstijl }, ip),
    );
  }
  if (stmts.length === 1) throw new ValidatieFout({ algemeen: 'Er is niets om te bewaren.' });
  await env.DB.batch(stmts);
  return { ok: true };
}

export async function bewaarBanner(env: Env, g: Gebruiker, plaats: Plaats, request: Request, ip: string | null) {
  const fout = (m: string) => new ValidatieFout({ banner: m });
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES) throw fout('Het bestand is groter dan 500 kB.');
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.length > MAX_BYTES) throw fout('Het bestand is groter dan 500 kB.');
  const a = afmetingen(data);
  if (!a) throw fout('Kies een PNG- of JPG-bestand (WebP en andere formaten tonen niet in alle mailprogramma\'s).');
  const b = BANNERS[plaats];
  if (a.breedte < 600) throw fout(`De afbeelding is ${a.breedte} px breed; minstens 600 px, liefst ${b.breedte} px.`);
  if (a.breedte > 2400) throw fout(`De afbeelding is ${a.breedte} px breed; hoogstens 2400 px (liefst ${b.breedte} px).`);
  if (a.hoogte > a.breedte * b.maxVerhouding) {
    throw fout(`De afbeelding is te hoog (${a.breedte} × ${a.hoogte} px). Aanbevolen: ${b.breedte} × ${b.hoogte} px.`);
  }
  // Nieuwe naam bij elke upload: mailprogramma's en browsers bewaren afbeeldingen lang.
  const naam = `${plaats}-${crypto.randomUUID().slice(0, 8)}`;
  const vorige = (await leesOpmaak(env))[plaats === 'kop' ? 'kopBanner' : 'voetBanner'];
  await env.STORAGE.put(`mailbeelden/${naam}`, data, { httpMetadata: { contentType: a.type } });
  await env.DB.batch([
    zorgVoorRij(env),
    env.DB.prepare(`update mailopmaak set ${plaats === 'kop' ? 'kop_banner' : 'voet_banner'} = ?, gewijzigd_door = ?, gewijzigd_op = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = 1`)
      .bind(`/api/mailbeelden/${naam}`, g.gebruikerId),
    audit(env, g, 'mailopmaak', '1', `BANNER_${plaats.toUpperCase()}`, { breedte: a.breedte, hoogte: a.hoogte, bytes: data.length }, ip),
  ]);
  // De vorige banner blijft staan: mails die al verstuurd zijn, verwijzen er nog naar.
  return { ok: true, afmetingen: { breedte: a.breedte, hoogte: a.hoogte }, vorige };
}

export async function verwijderBanner(env: Env, g: Gebruiker, plaats: Plaats, ip: string | null) {
  await env.DB.batch([
    zorgVoorRij(env),
    env.DB.prepare(`update mailopmaak set ${plaats === 'kop' ? 'kop_banner' : 'voet_banner'} = null, gewijzigd_door = ? where id = 1`).bind(g.gebruikerId),
    audit(env, g, 'mailopmaak', '1', `BANNER_${plaats.toUpperCase()}_WEG`, undefined, ip),
  ]);
  return { ok: true };
}
