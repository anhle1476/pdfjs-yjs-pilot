import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright e2e specs live under e2e/ and are run via `playwright test`,
    // not vitest. Exclude them so vitest's test() doesn't collide with
    // Playwright's test() runner.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});