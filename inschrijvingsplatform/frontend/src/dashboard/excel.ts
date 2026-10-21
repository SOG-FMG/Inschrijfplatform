/**
 * Minimale .xlsx-schrijver (Office Open XML in een ZIP zonder compressie), zodat de rapporten
 * als echt Excel-bestand met meerdere tabbladen te downloaden zijn zonder extra bibliotheek.
 * Ondersteunt tekst, getallen, vette koppen en kolombreedtes.
 */

export type Cel = string | number | null | undefined | { v: string | number | null | undefined; vet?: boolean };

export interface Blad {
  naam: string;
  rijen: Cel[][];
  breedtes?: number[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function kolom(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function bladXml(b: Blad): string {
  const rijen = b.rijen
    .map((rij, r) => {
      const cellen = rij
        .map((c, k) => {
          const { v, vet } = c !== null && typeof c === 'object' ? c : { v: c, vet: false };
          if (v === null || v === undefined || v === '') return '';
          const ref = `${kolom(k)}${r + 1}`;
          const stijl = vet ? ' s="1"' : '';
          if (typeof v === 'number') return `<c r="${ref}"${stijl}><v>${v}</v></c>`;
          return `<c r="${ref}"${stijl} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cellen}</row>`;
    })
    .join('');
  const cols = b.breedtes?.length
    ? `<cols>${b.breedtes.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rijen}</sheetData></worksheet>`;
}

/** Tabbladnamen: max. 31 tekens, zonder []:*?/\ en uniek. */
function bladNamen(namen: string[]): string[] {
  const gebruikt = new Set<string>();
  return namen.map((n) => {
    const basis = (n.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Blad').slice(0, 31);
    let naam = basis;
    for (let i = 2; gebruikt.has(naam.toLowerCase()); i++) naam = `${basis.slice(0, 31 - String(i).length - 1)} ${i}`;
    gebruikt.add(naam.toLowerCase());
    return naam;
  });
}

// ---------------------------------------------------------------------------
// ZIP (enkel 'stored', dus zonder compressie)
// ---------------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(bestanden: { naam: string; inhoud: string }[]): Blob {
  const enc = new TextEncoder();
  const nu = new Date();
  const tijd = (nu.getHours() << 11) | (nu.getMinutes() << 5) | (nu.getSeconds() >> 1);
  const datum = ((nu.getFullYear() - 1980) << 9) | ((nu.getMonth() + 1) << 5) | nu.getDate();
  const delen: Uint8Array[] = [];
  const centraal: Uint8Array[] = [];
  let positie = 0;
  for (const b of bestanden) {
    const naam = enc.encode(b.naam);
    const data = enc.encode(b.inhoud);
    const crc = crc32(data);
    const kop = new DataView(new ArrayBuffer(30));
    kop.setUint32(0, 0x04034b50, true);
    kop.setUint16(4, 20, true);
    kop.setUint16(6, 0x0800, true); // UTF-8-namen
    kop.setUint16(10, tijd, true);
    kop.setUint16(12, datum, true);
    kop.setUint32(14, crc, true);
    kop.setUint32(18, data.length, true);
    kop.setUint32(22, data.length, true);
    kop.setUint16(26, naam.length, true);
    delen.push(new Uint8Array(kop.buffer), naam, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, tijd, true);
    c.setUint16(14, datum, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, naam.length, true);
    c.setUint32(42, positie, true);
    centraal.push(new Uint8Array(c.buffer), naam);
    positie += 30 + naam.length + data.length;
  }
  const grootte = centraal.reduce((n, d) => n + d.length, 0);
  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true);
  eind.setUint16(8, bestanden.length, true);
  eind.setUint16(10, bestanden.length, true);
  eind.setUint32(12, grootte, true);
  eind.setUint32(16, positie, true);
  return new Blob([...delen, ...centraal, new Uint8Array(eind.buffer)] as BlobPart[], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function maakXlsx(bladen: Blad[]): Blob {
  const namen = bladNamen(bladen.map((b) => b.naam));
  const ns = 'http://schemas.openxmlformats.org';
  const bestanden = [
    {
      naam: '[Content_Types].xml',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${bladen
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      naam: '_rels/.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      naam: 'xl/workbook.xml',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${namen
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      naam: 'xl/_rels/workbook.xml.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${ns}/package/2006/relationships">${bladen
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${bladen.length + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      naam: 'xl/styles.xml',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...bladen.map((b, i) => ({ naam: `xl/worksheets/sheet${i + 1}.xml`, inhoud: bladXml(b) })),
  ];
  return zip(bestanden);
}

export function download(blob: Blob, bestandsnaam: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = bestandsnaam;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
