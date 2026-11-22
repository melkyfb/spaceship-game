import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Task 1 não possui testes; evita que `pnpm -r test` falhe antes da Task 3.
    passWithNoTests: true,
  },
});
