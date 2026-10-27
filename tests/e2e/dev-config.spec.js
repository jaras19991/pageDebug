// E4-TEST4a (2): developer configuration built into the extension (AC-6.1, 6.4, 6.5). `build --config
// tests/fixtures/config/disable-email.json` goes to a temp dir (never to dist/): with the `email` rule off the typed e-mail
// stays in snapshot.json, the package says so in redaction.disabledRules and summary.md, and the popup says so before
// "Nagrywaj". Passwords stay masked (rules of level "always" cannot be turned off).
import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { build } from '../../scripts/build.mjs';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = join(ROOT, 'tests/fixtures/config/disable-email.json');

let server;
let ext;
let outDir;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  outDir = await mkdtemp(join(tmpdir(), 'pds-devconfig-'));
  await build({ outDir, targets: ['chrome'], devConfigPath: CONFIG, warn: () => {} });
  ext = await launchWithExtension({ distDir: join(outDir, 'chrome') });
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

test('build with disable-email.json: e-mail present in snapshot.json, disabledRules ["email"], summary line, disclosure lists it (AC-6.1, 6.4, 6.5)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/privacy.html`);

    // AC-6.5: before "Nagrywaj" the reporter is told (developer options load asynchronously, ≤ 1 s).
    const popup = await openPopupFor(page);
    try {
      await popup.waitFor(`!document.getElementById('ready').hidden && !document.getElementById('disclosureDev').hidden`, 5000);
      expect(await popup.textOf('#disclosureDev')).toBe(MESSAGES.disclosureDevExtra.email);
      expect(await popup.textOf('#disclosureDev')).toContain('e-mail');
      // Only the listed rule: nothing about phones or the page structure.
      expect(await popup.textOf('#disclosureDev')).not.toContain(MESSAGES.disclosureDevExtra.phone);
    } finally {
      await popup.close();
    }

    await startRecording(page);
    const id = randomBytes(6).toString('hex');
    const email = `pds.devconfig.${id}@example.com`;
    const password = `Dev-${id}-Haslo!`;
    await page.fill('#f-email', email);
    await page.fill('#f-password', password);
    await page.click('#t-login');
    await expect(page.locator('#t-result')).toHaveText('status 401');

    const { json, summary, files } = await saveRecording(page);
    expect(json.redaction.disabledRules).toEqual(['email']);
    expect(json.redaction.rulesVersion).toBe(2);
    expect(summary).toContain('Wyłączone przez developera: email');

    const login = json.network.find((e) => e.url.includes('/api/login'));
    expect(login, JSON.stringify(json.network.map((e) => e.url))).toBeTruthy();
    expect(String(login.requestBody)).toContain(email);
    // The password is a rule of level "always": still masked everywhere.
    const all = Buffer.concat(Object.values(files).map((b) => Buffer.from(b)));
    expect(all.includes(Buffer.from(password))).toBe(false);
    expect(String(login.requestBody)).toContain('[redacted:');
  } finally {
    await page.close();
  }
});
