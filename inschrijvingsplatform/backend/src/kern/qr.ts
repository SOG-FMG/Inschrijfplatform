import qrcode from 'qrcode-generator';

/** Witte rand rond de code, in modules (de QR-standaard vraagt er 4). */
const RAND = 4;

/**
 * QR-code als PNG, zonder canvas of Node-modules (werkt in een Worker). qrcode-generator (ook gebruikt in de frontend)
 * berekent de modules, de PNG (zwart-wit, 1 bit per pixel) bouwen we zelf; de compressie doet
 * CompressionStream('deflate') (= zlib, zoals PNG vraagt). Foutcorrectie M: leesbaar met elke smartphonecamera.
 */
export async function qrPng(tekst: string, pixelsPerModule = 8): Promise<Uint8Array> {
  const qr = qrcode(0, 'M');
  qr.addData(tekst);
  qr.make();
  const n = qr.getModuleCount();
  const zwart = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && qr.isDark(y, x);
  const breedte = (n + 2 * RAND) * pixelsPerModule;
  const rijBytes = Math.ceil(breedte / 8);

  // Per rij: filterbyte 0, daarna de pixels (bit 1 = wit, 0 = zwart).
  const ruw = new Uint8Array((rijBytes + 1) * breedte);
  for (let y = 0; y < breedte; y++) {
    const my = Math.floor(y / pixelsPerModule) - RAND;
    const start = y * (rijBytes + 1) + 1;
    for (let x = 0; x < breedte; x++) {
      if (!zwart(Math.floor(x / pixelsPerModule) - RAND, my)) ruw[start + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, breedte);
  v.setUint32(4, breedte);
  ihdr.set([1, 0, 0, 0, 0], 8); // bitdiepte 1, grijswaarden, standaard compressie/filter, geen interlacing

  return samen([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blok('IHDR', ihdr),
    blok('IDAT', await deflate(ruw)),
    blok('IEND', new Uint8Array()),
  ]);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stroom = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stroom).arrayBuffer());
}

function blok(type: string, inhoud: Uint8Array): Uint8Array {
  const uit = new Uint8Array(12 + inhoud.length);
  const v = new DataView(uit.buffer);
  v.setUint32(0, inhoud.length);
  for (let i = 0; i < 4; i++) uit[4 + i] = type.charCodeAt(i);
  uit.set(inhoud, 8);
  v.setUint32(8 + inhoud.length, crc32(uit.subarray(4, 8 + inhoud.length)));
  return uit;
}

function samen(delen: Uint8Array[]): Uint8Array {
  const uit = new Uint8Array(delen.reduce((n, d) => n + d.length, 0));
  let pos = 0;
  for (const d of delen) {
    uit.set(d, pos);
    pos += d.length;
  }
  return uit;
}

const CRC_TABEL = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABEL[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
