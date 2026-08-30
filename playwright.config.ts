import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config for pdfjs-yjs-pilot.
 *
 * NOTE: The app loads a sample PDF from an external URL
 * (raw.githubusercontent.com) and its pdf.js worker from a CDN
 * (cdn.jsdelivr.net). Tests therefore require outbound internet access.
 * Timeouts are generous to tolerate network latency when fetching the PDF.
 */
export default defineConfig({
  testDir: './e2e',

  // Generous per-test timeout to account for PDF download + render over the network.
  timeout: 60_000,

  expect: {
    // Individual expect() polling timeout (e.g. waiting for canvas to appear).
    timeout: 30_000,
  },

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Give navigation/actions room for slow network PDF fetches.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start the Vite dev server before tests.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
