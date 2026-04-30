import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'lib/**/*.test.ts'],
    environment: 'node',
  },
});
