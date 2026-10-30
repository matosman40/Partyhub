import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sous charge (99 fichiers en parallèle), 5 s ne suffisent pas à certains tests d’intégration.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
