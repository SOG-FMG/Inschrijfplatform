import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Versie onderaan het dashboard en in meldingen: package.json-versie + commit + builddatum.
// Workers Builds zet WORKERS_CI_COMMIT_SHA; CF_PAGES_COMMIT_SHA was van Cloudflare Pages en blijft als terugval
// staan. Bouw je lokaal, dan komt de commit uit git zelf, zodat een handmatige deploy ook herkenbaar is.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const lokaleCommit = () => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'lokaal';
  }
};
const commit = (process.env.WORKERS_CI_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA)?.slice(0, 7) ?? lokaleCommit();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSIE__: JSON.stringify(`${version} (${commit}, ${new Date().toISOString().slice(0, 10)})`),
  },
  test: {
    // De tests klikken het formulier door in demomodus. Zonder dit zou een eigen .env.local met
    // VITE_API_URL (voor `npm run dev` tegen een lokale backend) de demomodus uitzetten en de tests breken.
    env: { VITE_API_URL: '' },
  },
});
