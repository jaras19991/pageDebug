// E1-T19b: the recording stops by itself at the time limit (AC-1.9, AC-4.9). The test shortens
// the 10-minute limit to 3 s through the test-only storage.session key (E1-T12).
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { popupState, saveRecording, setRecordingLimit, startRecording } from './helpers/recording.js';

const LIMIT_MS = 3000;

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

const isNativeLog = () => Function.prototype.toString.call(console.log).includes('[native code]');
const has = (record, marker) => JSON.stringify(record).includes(marker);

test('time-limit (3 s test limit): popup shows stoppedByLimit, console.log is native again, save has recordingStoppedReason time-limit and no after-limit entry', async () => {
  const page = await ext.context.newPage();
  try {
    await setRecordingLimit(ext, LIMIT_MS);
    await page.goto(`${server.url}/basic.html`);
    const { clickedAt } = await startRecording(page);
    expect(await page.evaluate(isNativeLog)).toBe(false);
    await page.evaluate(() => console.log('pds-early-marker'));

    // The limit counts from the start, which happens between the click and the reload.
    await expect.poll(() => page.evaluate(isNativeLog), { timeout: LIMIT_MS + 5000 }).toBe(true);
    expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(LIMIT_MS - 100);
    const lateAt = clickedAt + LIMIT_MS + 500;
    if (Date.now() < lateAt) await page.waitForTimeout(lateAt - Date.now());
    await page.evaluate(() => console.log('pds-late-marker'));

    const state = await popupState(page);
    expect(state.section).toBe('recording');
    expect(state.since).toBe(MESSAGES.stoppedByLimit);
    expect(state.saveEnabled).toBe(true);

    const { json } = await saveRecording(page);
    expect(json.recordingStoppedReason).toBe('time-limit');
    expect(json.consoleLogs.filter((r) => has(r, 'pds-early-marker'))).toHaveLength(1);
    expect(json.consoleLogs.filter((r) => has(r, 'pds-late-marker'))).toHaveLength(0);
    const startedAt = Date.parse(json.recordingStartedAt);
    for (const key of ['consoleLogs', 'runtimeErrors', 'network']) {
      for (const r of json[key]) {
        const { timeOrigin } = json.documents[r.doc];
        expect(timeOrigin + r.t, `${key} entry after the limit`).toBeLessThan(startedAt + LIMIT_MS);
      }
    }
  } finally {
    await setRecordingLimit(ext, null);
    await page.close();
  }
});
