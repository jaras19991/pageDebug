// E3-TEST3: privacy of the whole package (AC-3.4, 3.5, 3.6, 3.7, NFR prywatność). privacy.html plants secrets at load
// (JWT in localStorage, cookie sid, console.log({ token })) and on "Zaloguj" (POST /api/login?access_token=… with
// Authorization: Bearer … and the e-mail and password typed by the test). Every value is grepped as bytes over every
// unzipped file, screenshot.jpg included: 0 hits. Each test also checks that the trap was recorded at all (masked), so
// 0 hits cannot come from an empty package. privacy-hostile.html does the same after breaking JSON, replace and map.
import { test, expect, chromium } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidSnapshot, validateZipEntries } from '../helpers/snapshot-validator.js';
import { readZipPackage } from './helpers/download.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONSOLE_SCRIPT = resolve(ROOT, 'src/standalone/console-snapshot.js');
const MARKER = /^\[redacted:[\w-]+\]$/;
// Pre-filled values of privacy.html that only the form holds (dom.forms keeps valueLength, never the value).
const FORM_VALUES = { card: '4111 1111 1111 1111', cardDigits: '4111111111111111', phone: '+48 600 700 800' };

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

async function withTab(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// window.__pdsTraps over CDP: privacy-hostile.html breaks the built-ins page.evaluate could serialize with.
async function readTraps(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'window.__pdsTraps', returnByValue: true });
    expect(result.value, 'window.__pdsTraps').toBeTruthy();
    return result.value;
  } finally {
    await cdp.detach();
  }
}

/** Typed by the test, so they exist only in the page and in the request (fresh per test). */
function credentials() {
  const id = randomBytes(6).toString('hex');
  return { email: `pds.trap.${id}@example.com`, password: `Trap-${id}-Haslo!` };
}

// Every value whose presence in the package is a leak, with the forms it could take in text (URL encoding).
function trapValues(traps, { email, password }, { formValues = true } = {}) {
  const [, jwtPayload, jwtSignature] = traps.jwt.split('.');
  const values = {
    jwt: traps.jwt,
    jwtPayload,
    jwtSignature,
    sid: traps.sid,
    token: traps.token,
    bearer: traps.bearer,
    email,
    emailEncoded: encodeURIComponent(email),
    password,
    passwordEncoded: encodeURIComponent(password),
  };
  return formValues ? { ...values, ...FORM_VALUES } : values;
}

// { name: [files with the value] } for every value found as bytes in any file of the zip.
function leaks(files, values) {
  const found = {};
  for (const [name, value] of Object.entries(values)) {
    const needle = Buffer.from(value, 'utf8');
    const where = Object.entries(files).filter(([, bytes]) => Buffer.from(bytes).includes(needle)).map(([file]) => file);
    if (where.length) found[name] = where;
  }
  return found;
}

// Same grep over any JSON-able value (storage dumps).
function leaksInText(text, values) {
  return Object.entries(values).filter(([, value]) => text.includes(value)).map(([name]) => name);
}

async function login(page, creds) {
  await page.fill('#f-email', creds.email);
  await page.fill('#f-password', creds.password);
  await page.click('#t-login');
  await expect(page.locator('#t-result')).toHaveText('status 401');
}

// The traps were recorded and masked, not lost: otherwise 0 hits proves nothing.
function expectTrapsRecorded(json) {
  const login = json.network.filter((e) => e.url.includes('/api/login'));
  expect(login, JSON.stringify(json.network.map((e) => e.url))).toHaveLength(1);
  expect(login[0]).toMatchObject({ method: 'POST', status: 401 });
  expect(login[0].url).toMatch(/access_token=\[redacted:[\w-]+\]/);
  const auth = Object.entries(login[0].requestHeaders ?? {}).find(([k]) => k.toLowerCase() === 'authorization');
  expect(auth, JSON.stringify(login[0].requestHeaders)).toBeTruthy();
  expect(auth[1]).toMatch(MARKER);
  expect(String(login[0].requestBody)).toContain('[redacted:');

  const sid = json.storage.cookies.find((c) => c.name === 'sid');
  expect(sid, JSON.stringify(json.storage.cookies)).toBeTruthy();
  expect(sid.valueHash).toMatch(/^[0-9a-f]{8}$/);
  expect(sid.sizeBytes).toBeGreaterThanOrEqual(32);
  expect(json.storage.localStorage.auth).toMatch(MARKER);

  const tokenLogs = json.consoleLogs.filter((e) => JSON.stringify(e.args).includes('token'));
  expect(tokenLogs.length, JSON.stringify(json.consoleLogs)).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(tokenLogs)).toContain('[redacted:');
}

// Records `fixture`, logs in and saves; returns the package and every value that must not be in it.
async function recordLogin(page, fixture, options) {
  await page.goto(`${server.url}/${fixture}`);
  await startRecording(page);
  const traps = await readTraps(page);
  const creds = credentials();
  await login(page, creds);
  const saved = await saveRecording(page);
  return { ...saved, values: trapValues(traps, creds, options) };
}

test('grep -c of each trap value over all unzipped files (incl. screenshot.jpg bytes) = 0 (AC-3.5)', async () => {
  await withTab(async (page) => {
    const { json, files, entries, values } = await recordLogin(page, 'privacy.html');
    expect(entries).toContain('screenshot.jpg'); // the image is part of the grep
    expectTrapsRecorded(json);
    expect(leaks(files, values)).toEqual({});
  });
});

test('hostile page: package valid JSON, validator passes, 0 trap hits (AC-3.6)', async () => {
  await withTab(async (page) => {
    // saveRecording parses snapshot.json strictly and runs the v4 validator on it.
    const { json, files, values } = await recordLogin(page, 'privacy-hostile.html', { formValues: false });
    assertValidSnapshot(json);
    expect(JSON.stringify(json.consoleLogs)).not.toContain('"hostile":true'); // the page's JSON.stringify was not used
    expect(leaks(files, values)).toEqual({});
  });
});

// The 0 hits above must not come from an empty package: the broken built-ins must not cost the recording its data
// (AC-3.6: redaction does not depend on what the page replaced; E3-T0: args recorded correctly).
test('hostile page: console, network and steps are still recorded and masked (AC-3.6)', async () => {
  await withTab(async (page) => {
    const { json } = await recordLogin(page, 'privacy-hostile.html', { formValues: false });
    expectTrapsRecorded(json);
    const click = json.steps.find((s) => s.type === 'click' && s.selector === '#t-login');
    expect(click, JSON.stringify(json.steps)).toBeTruthy();
    expect(click.text).toBe('Zaloguj');
  });
});

test('console fallback on privacy.html: 0 trap hits (AC-3.7)', async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: process.env.PDS_E2E_HEADED !== '1' });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(`${server.url}/privacy.html`);
    await page.addScriptTag({ path: CONSOLE_SCRIPT });
    const traps = await readTraps(page);
    const creds = credentials();
    await login(page, creds);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async () => await globalThis.PageDebugSnapshot.download()),
    ]);
    const { entries, files, json } = await readZipPackage(await download.path());
    expect(validateZipEntries(entries, json).errors).toEqual([]);
    assertValidSnapshot(json);
    expect(json.source).toBe('console');
    expectTrapsRecorded(json);
    expect(leaks(files, trapValues(traps, creds))).toEqual({});
  } finally {
    await browser.close();
  }
});

test('file input: steps have fileCount, no fakepath, no valueLength (AC-3.4)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/privacy.html`);
    await startRecording(page);
    const fileName = `tajny-dokument-${randomBytes(4).toString('hex')}.txt`;
    // A path, not a buffer: Playwright sets buffers in-page with an untrusted `change`, which the recorder ignores
    // like any synthetic event; a path goes through the browser's own file selection (trusted events).
    const dir = await mkdtemp(join(tmpdir(), 'pds-e2e-file-'));
    const file = join(dir, fileName);
    await writeFile(file, 'zawartosc pliku');
    try {
      await page.setInputFiles('#t-file', file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(await page.$eval('#t-file', (el) => el.value)).toContain('fakepath'); // the value the recorder must not read
    const { json, files } = await saveRecording(page);

    const fileSteps = json.steps.filter((s) => JSON.stringify(s).includes('t-file'));
    expect(fileSteps.length, JSON.stringify(json.steps)).toBeGreaterThanOrEqual(1);
    const change = fileSteps.find((s) => s.type === 'change');
    expect(change, JSON.stringify(fileSteps)).toBeTruthy();
    expect(change.fileCount).toBe(1);
    for (const step of fileSteps) expect('valueLength' in step, JSON.stringify(step)).toBe(false);
    expect(leaks(files, { fakepath: 'fakepath', fileName, fileNameNoExt: fileName.slice(0, -4) })).toEqual({});
  });
});

test('storage.session after save contains none of the trap values (NFR prywatność)', async () => {
  await withTab(async (page) => {
    const { values } = await recordLogin(page, 'privacy.html');
    const sw = await ext.serviceWorker();
    const dump = await sw.evaluate(async () => {
      const chrome = globalThis.chrome;
      return JSON.stringify({ session: await chrome.storage.session.get(null), local: await chrome.storage.local.get(null) });
    });
    expect(leaksInText(dump, values)).toEqual([]);
  });
});
