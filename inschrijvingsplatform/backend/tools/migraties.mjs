// Migraties per module samenvoegen in migrations/ (de enige map die wrangler kent).
//
//   node tools/migraties.mjs               kopieert nieuwe migraties van modules naar migrations/
//   node tools/migraties.mjs --controleer  stopt met een fout als er een ontbreekt of afwijkt (draait vóór npm test)
//
// Een module zet haar SQL in src/modules/<id>/migraties/<naam>.sql (enkel eigen tabellen, prefix <id>_).
// De kopie krijgt het volgende volgnummer, bv. migrations/0007_tickets_rangen.sql, met bovenaan een
// verwijzing naar de bron. Een migratie die al uitgevoerd is, wijzig je nooit: maak een nieuwe.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIES = 'migrations';
const MODULES = 'src/modules';
const controleer = process.argv.includes('--controleer');
const kop = (bron) => `-- Gekopieerd uit ${bron} door tools/migraties.mjs. Wijzig de bron, niet deze kopie.\n`;

const bestaand = readdirSync(MIGRATIES).filter((f) => f.endsWith('.sql')).sort();
const perBron = new Map();
for (const f of bestaand) {
  const eerste = readFileSync(join(MIGRATIES, f), 'utf8').split('\n')[0];
  const m = /^-- Gekopieerd uit (\S+) /.exec(eerste);
  if (m) perBron.set(m[1], f);
}
let volgnummer = Math.max(0, ...bestaand.map((f) => Number(f.slice(0, 4)) || 0));

const fouten = [];
let gekopieerd = 0;
for (const id of readdirSync(MODULES).sort()) {
  const map = join(MODULES, id, 'migraties');
  if (!existsSync(map)) continue;
  for (const f of readdirSync(map).filter((x) => x.endsWith('.sql')).sort()) {
    const bron = `${MODULES}/${id}/migraties/${f}`;
    const inhoud = kop(bron) + readFileSync(bron, 'utf8');
    const kopie = perBron.get(bron);
    if (kopie) {
      if (readFileSync(join(MIGRATIES, kopie), 'utf8') !== inhoud) fouten.push(`${bron} verschilt van ${MIGRATIES}/${kopie}. Wijzig een uitgevoerde migratie niet; maak een nieuwe.`);
      continue;
    }
    if (controleer) {
      fouten.push(`${bron} staat nog niet in ${MIGRATIES}/. Voer uit: npm run migraties`);
      continue;
    }
    const naam = `${String(++volgnummer).padStart(4, '0')}_${id}_${f}`;
    writeFileSync(join(MIGRATIES, naam), inhoud);
    console.log(`nieuw: ${MIGRATIES}/${naam}`);
    gekopieerd++;
  }
}
if (fouten.length) {
  console.error(fouten.join('\n'));
  process.exit(1);
}
if (!controleer) console.log(gekopieerd ? `${gekopieerd} migratie(s) gekopieerd.` : 'Niets nieuws.');
