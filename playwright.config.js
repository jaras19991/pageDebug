import { defineConfig } from '@playwright/test';

// E2E runs Chromium with the built extension from dist/chrome (AC-3.3). Each spec file
// launches its own persistent context in tests/e2e/helpers/launch.js, so `use` stays empty.
// Headless by default (Chromium's new headless via channel 'chromium'); PDS_E2E_HEADED=1 to watch.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  testIgnore: ['**/spike/**'],
  globalSetup: './tests/e2e/global-setup.js',
  globalTeardown: './tests/e2e/global-teardown.js',
  outputDir: 'test-results',
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  projects: [{ name: 'chromium' }],
});
