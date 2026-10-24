import { defineConfig, devices } from '@playwright/test';
import { browserTestServer } from './scripts/browser-test-server.mjs';
import { browserTestPolicy } from './scripts/browser-test-policy.mjs';

const server = browserTestServer(process.env.PDFMASON_BROWSER_TEST_PORT);

export default defineConfig({
  ...browserTestPolicy(),
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: server.url,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
  },
  webServer: {
    ...server,
    env: {
      ...server.env,
      NEXT_PUBLIC_FEATURE_COMMENT_REVIEW_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_MEASUREMENT_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_REDACTION_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_STAMPS_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_TABLES_ENABLED: 'true',
      NEXT_PUBLIC_FEATURE_OCR_ENABLED: 'true',
    },
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
