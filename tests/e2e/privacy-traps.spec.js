// E3 review (iteration 1) privacy traps F1, F2, F3, F5, F6 end to end. traps-e3.html plants fresh random values at load
// (window.__pdsTraps); every one is grepped as bytes over every file of the unzipped package, screenshot.jpg included.
// Each test also checks that the trap was recorded at all (masked), so 0 hits cannot come from an empty package.
//   F1 redux-persist JSON-in-JSON in localStorage and `data-props` JSON in dom.structure
//   F2 secret split by the MAIN cut (requestBody 5000 chars, console entry 40000 chars of JSON)
//   F3 `password: "x"` in a console.log text, F5 `?code=` / `?ticket=` in URLs, F6 `cvv=` in sessionStorage
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { validateSnapshot } from '../helpers/snapshot-validator.js';
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

async function readTraps(page) {
  return page.evaluate(() => globalThis.__pdsTraps);
}

function leaks(files, values) {
  const found = {};
  for (const [name, value] of Object.entries(values)) {
    const needle = Buffer.from(value, 'utf8');
    const where = Object.entries(files).filter(([, bytes]) => Buffer.from(bytes).includes(needle)).map(([file]) => file);
    if (where.length) found[name] = where;
  }
  return found;
}

async function recordTraps() {
  const page = await ext.context.newPage();
  try {
    const code = `ac${randomBytes(6).toString('hex')}`;
    await page.goto(`${server.url}/traps-e3.html?code=${code}`);
    await startRecording(page);
    const traps = await readTraps(page);
    expect(traps.code).toBe(code);
    await page.click('#t-send');
    await expect(page.locator('#t-result')).toHaveText('status 401');
    const saved = await saveRecording(page);
    return { ...saved, traps, code };
  } finally {
    await page.close();
  }
}

test('F1 F2 F3 F6 traps and F5 in every field but console stack: 0 hits of every value (and of the kept part of cut secrets) in the whole zip, data still recorded', async () => {
  const { json, files, entries, traps, code } = await recordTraps();
  expect(entries).toContain('screenshot.jpg');

  // E3-PD1 fixed: the console preview cut at entryChars stays within the limit after redaction (saveRecording validates too).
  expect(validateSnapshot(json).errors).toEqual([]);

  const values = {
    accessToken: traps.accessToken,
    refreshToken: traps.refreshToken,
    persistPassword: traps.persistPassword,
    apiKey: traps.apiKey,
    cvvPair: `cvv=${traps.cvv}`,
    consolePassword: traps.consolePassword,
    cutBody: traps.cutBody,
    cutBodyKept: traps.cutBodyKept,
    cutConsole: traps.cutConsole,
    cutConsoleKept: traps.cutConsoleKept,
  };
  const found = leaks(files, values);
  // F5 outside console stack traces (see the next test for the stack).
  const noStack = JSON.stringify(json, (key, value) => (key === 'stack' ? undefined : value));
  expect(noStack.includes(code), 'F5: ?code= value in snapshot.json outside stack').toBe(false);
  expect(found).toEqual({});

  // Recorded, not lost.
  const persist = json.storage.localStorage['persist:root'];
  expect(persist, JSON.stringify(json.storage.localStorage)).toContain('[redacted:'); // F1
  expect(persist).toContain('currentUser');
  expect(json.storage.sessionStorage.checkout, JSON.stringify(json.storage.sessionStorage)).toContain('cvv=[redacted:'); // F6
  expect(json.dom.structure, 'dom.structure').toContain('data-props'); // F1
  const consoleText = JSON.stringify(json.consoleLogs);
  expect(consoleText).toContain('password'); // F3 / F2 entries exist
  expect(consoleText).toContain('[redacted:');
  const send = json.network.filter((e) => e.url.includes('/api/login'));
  expect(send, JSON.stringify(json.network.map((e) => e.url))).toHaveLength(1);
  expect(send[0].url).toMatch(/code=\[redacted:[\w-]+\]/); // F5
  expect(String(send[0].requestBody)).toContain('[redacted:'); // F2
  expect(JSON.stringify(json.environment.location), 'F5 location').toContain('code=[redacted:');
});

// PRODUCT DEFECT (E3-PD2, review F5): `?code=` is masked in URL fields (location, network, steps) but a URL inside a console
// `stack` ("at http://host/page?code=VALUE:44:15") keeps the value. Left red on purpose: the AC is 0 hits in the whole zip.
test('F5: ?code= value of the page URL does not appear anywhere in the zip, console stack traces included', async () => {
  const { files, code } = await recordTraps();
  expect(leaks(files, { code })).toEqual({});
});

// Re-review iteration 2: N1 (`order-id-<test card>`), N2 (`payload=` + %-encoded JSON in requestBody), N3 (name/value pairs,
// [...new FormData(form)] in console.log), N4 (`&lt;password&gt;…&lt;/password&gt;` in a data attribute) → 0 hits in the whole zip.
test('N1 N2 N3 N4 traps: 0 hits of every value in the whole zip (screenshot included), data still recorded', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/traps-e3b.html`);
    await startRecording(page);
    const traps = await readTraps(page);
    await page.click('#t-send');
    await expect(page.locator('#t-result')).toHaveText('status 401');
    const { json, files, entries } = await saveRecording(page);
    expect(entries).toContain('screenshot.jpg');
    expect(leaks(files, {
      card: traps.card,
      payloadPassword: traps.payloadPassword,
      pairPassword: traps.pairPassword,
      formPassword: traps.formPassword,
      xmlPassword: traps.xmlPassword,
      encodedPayload: encodeURIComponent(traps.payloadPassword),
    })).toEqual({});
    // Recorded, not lost.
    const send = json.network.filter((e) => e.url.includes('/api/login'));
    expect(send, JSON.stringify(json.network.map((e) => e.url))).toHaveLength(1);
    expect(String(send[0].requestBody)).toContain('[redacted:'); // N2
    expect(String(send[0].requestBody)).toContain('payload=');
    expect(JSON.stringify(json.consoleLogs)).toContain('[redacted:'); // N1, N3
    expect(JSON.stringify(json.dom.structure)).toContain('data-xml'); // N4
  } finally {
    await page.close();
  }
});

// Re-review iteration 2, N9: console.log argument pairs (`'password:', pw`, `'token=', t`, `'login','jan','password', pw`) and the same
// pair inside a > 40000 char entry stored as {truncated, preview} → 0 hits in the whole zip; benign `'Pressed key', 'Enter'` survives.
test('N9/N13/N14 console argument pairs: 0 hits in the whole zip (also in a truncated long entry), benign pairs kept', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/traps-e3c.html`);
    await startRecording(page);
    const traps = await readTraps(page);
    const { json, files, entries } = await saveRecording(page);
    expect(entries).toContain('screenshot.jpg');
    expect(leaks(files, traps)).toEqual({});
    const consoleText = JSON.stringify(json.consoleLogs);
    expect(consoleText).toContain('[redacted:');
    expect(consoleText, 'long entry recorded').toContain('truncated');
    expect(consoleText).toContain('Pressed key');
    expect(consoleText).toContain('Enter');
    // Re-review iteration 3: N13 chains (`'[Auth]', 'Token:', t`, …) and N14 nested arrays are masked (0 hits above, also in
    // the preview of the long entry); benign controls stay as they were logged.
    expect(consoleText).toContain('[redacted:key-token]');
    const logged = json.consoleLogs.map((entry) => JSON.stringify(entry.args));
    for (const benign of [['token count', 5], ['auth ok', true], ['login', 'jan', 'theme', 'dark']]) {
      expect(logged, JSON.stringify(benign)).toContain(JSON.stringify(benign));
    }
  } finally {
    await page.close();
  }
});
