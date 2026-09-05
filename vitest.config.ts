import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['electron/**/*.test.ts', 'lib/**/*.test.ts'],
    exclude: ['**/._*'],
    environment: 'node',
  },
});
