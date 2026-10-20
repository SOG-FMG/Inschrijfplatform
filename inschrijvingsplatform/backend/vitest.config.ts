import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Eén databank voor alle scenario's: sequentieel uitvoeren
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
