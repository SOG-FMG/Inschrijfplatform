import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Versie in meldingen: package.json-versie + commit (Cloudflare Pages zet CF_PAGES_COMMIT_SHA) + builddatum.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const commit = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? 'lokaal';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSIE__: JSON.stringify(`${version} (${commit}, ${new Date().toISOString().slice(0, 10)})`),
  },
});
