import { defineConfig, devices } from '@playwright/test';
const persistencePath: string = `.wrangler/e2e-${Date.now()}`;
export default defineConfig({
  testDir: 'tests/e2e',
  metadata: { persistencePath },
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build:web && wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to ${persistencePath} && wrangler dev --config wrangler.local.jsonc --local --port 8787 --persist-to ${persistencePath}`,
    url: 'http://127.0.0.1:8787/api/boot',
    reuseExistingServer: false,
    timeout: 120000,
    env: { CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  },
});
