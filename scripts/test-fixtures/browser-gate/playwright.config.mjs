import { defineConfig } from '@playwright/test';
import { browserTestPolicy } from '../../browser-test-policy.mjs';

// No browser, server, data provider or documents: tests the verification gate itself.
export default defineConfig({
  ...browserTestPolicy(),
  testDir: '.',
  testMatch: 'outcome.spec.mjs',
  workers: 1,
});
