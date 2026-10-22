// E1-T18: smoke of the e2e harness for the background flow. dist/chrome (AC-3.3), the real popup
// through CDP, "Nagrywaj" with a granted origin, "Zapisz paczkę" into the temp download dir.
import { test, expect } from '@playwright/test';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

let server;
let ext;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
});

test('harness: record basic fixture, log a marker and save a v2 package', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const marker = `harness-marker-${Date.now()}`;
    await page.evaluate((m) => console.log(m), marker);

    const { fileName, json } = await saveRecording(page);
    expect(fileName).toMatch(/^page-debug-snapshot-\d+\.json$/);
    expect(json.schemaVersion).toBe(2);
    expect(json.documents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(json.consoleLogs)).toContain(marker);
  } finally {
    await page.close();
  }
});
