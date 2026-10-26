import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Versie in meldingen: package.json-versie + commit (Cloudflare Pages zet CF_PAGES_COMMIT_SHA) + builddatum.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const commit = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? 'lokaal';

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
