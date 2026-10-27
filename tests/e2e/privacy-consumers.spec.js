// E4-TEST4c: privacy of the new consumers of a package (AC-2.5, AC-2.9, E4-IN1b).
//  1. privacy-iterator.html replaces Array.prototype[Symbol.iterator]: JWT in a 500 response, the Authorization header and a
//     token in a step URL are still masked at the source (grep over every file of the zip = 0), and they were recorded
//     (network, steps and console present, E4-IN2b).
//  2. "Uncaught Error: password: …" (key and value after a prefix) does not leak into the zip.
//  3. privacy.html zip, three consumers: summary.md, the viewer opened from file:// (text of every tab) and the MCP server
//     spawned on the download directory (answer of every tool) contain none of the trap values.
import { test, expect, chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FIXTURE_SECRETS, startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWER = pathToFileURL(resolve(ROOT, 'src/standalone/viewer.html')).href;
const MCP_SERVER = resolve(ROOT, 'mcp/server.js');
const TABS = ['summary', 'steps', 'errors', 'network', 'console', 'vitals', 'dom', 'storage'];
const MARKER = /\[redacted:[\w-]+\]/;
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

// Evaluation over CDP (the page replaced a built-in page.evaluate could rely on).
async function cdpEval(page, expression) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return result.value;
  } finally {
    await cdp.detach();
  }
}

async function readTraps(page) {
  const traps = await cdpEval(page, 'window.__pdsTraps');
  expect(traps, 'window.__pdsTraps').toBeTruthy();
  return traps;
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

const leaksInText = (text, values) => Object.entries(values).filter(([, value]) => text.includes(value)).map(([name]) => name);

function credentials() {
  const id = randomBytes(6).toString('hex');
  return { email: `pds.consumers.${id}@example.com`, password: `Cons-${id}-Haslo!` };
}

function privacyValues(traps, { email, password }) {
  const [, jwtPayload, jwtSignature] = traps.jwt.split('.');
  return {
    jwt: traps.jwt, jwtPayload, jwtSignature, sid: traps.sid, token: traps.token, bearer: traps.bearer,
    email, emailEncoded: encodeURIComponent(email), password, passwordEncoded: encodeURIComponent(password), ...FORM_VALUES,
  };
}

test('page replacing Array.prototype[Symbol.iterator]: JWT in a 500 response, Authorization header and step URL token absent from the zip (AC-2.5)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/privacy-iterator.html`);
    await startRecording(page);
    const traps = await readTraps(page);
    expect(await cdpEval(page, '[...[1, 2, 3]].length'), 'the page really has no array iteration').toBe(0);

    await page.click('#t-fetch');
    await expect(page.locator('#t-result')).toHaveText('status 500');
    await page.click('#t-nav');
    await expect(page.locator('#t-result')).toHaveText('nav');
    await page.click('#t-throw');
    await expect(page.locator('#t-result')).toHaveText('thrown');
    // The uncaught error reaches the recorder asynchronously.
    await page.waitForTimeout(300);
    const { json, files } = await saveRecording(page);

    const values = {
      jwt: FIXTURE_SECRETS.jwt,
      jwtPayload: FIXTURE_SECRETS.jwt.split('.')[1],
      jwtSignature: FIXTURE_SECRETS.jwt.split('.')[2],
      serverBearer: FIXTURE_SECRETS.bearer,
      bearer: traps.bearer,
      stepToken: traps.stepToken,
      password: traps.password,
    };
    // E4-IN2b: MAIN records under the replaced iterator, so the zip holds the entries and the test proves masking, not
    // an empty recording. No note may say that a section of the page was lost.
    const lost = (json.notes ?? []).filter((n) => /was not received/i.test(JSON.stringify(n)));
    expect(lost, JSON.stringify(json.notes)).toEqual([]);
    const failed = json.network.filter((n) => n.url.includes('/status/500'));
    expect(failed.length, JSON.stringify(json.network)).toBeGreaterThanOrEqual(1);
    for (const e of failed) {
      expect(e.status).toBe(500);
      // The server puts the JWT under "access_token", so the key rule masks it (marker key-token, not jwt).
      expect(String(e.responseBodyPreview ?? '')).toMatch(/"access_token":"\[redacted:[\w-]+\]"/);
      const auth = Object.entries(e.requestHeaders ?? {}).find(([k]) => k.toLowerCase() === 'authorization');
      expect(auth, JSON.stringify(e.requestHeaders)).toBeTruthy();
      expect(auth[1]).toMatch(MARKER);
    }
    const nav = json.steps.filter((s) => s.type === 'navigate' && String(s.url).includes('access_token='));
    expect(nav.length, JSON.stringify(json.steps)).toBeGreaterThanOrEqual(1);
    for (const s of nav) expect(s.url).toMatch(/access_token=\[redacted:[\w-]+\]/);
    expect(json.steps.filter((s) => s.type === 'click').length, JSON.stringify(json.steps)).toBeGreaterThanOrEqual(3);
    const logs = json.consoleLogs.filter((e) => JSON.stringify(e.args).includes('password'));
    expect(logs.length, JSON.stringify(json.consoleLogs)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(logs)).toMatch(MARKER);
    const doc = json.documents.find((d) => String(d.url).includes('privacy-iterator.html?'));
    expect(doc, JSON.stringify(json.documents)).toBeTruthy();
    expect(doc.url).toMatch(/access_token=\[redacted:[\w-]+\]/);
    expect(leaks(files, values)).toEqual({});
  });
});

// E4-IN1b: a key–value pair after another word ("Error: password: x") used to survive maskText.
test('"Uncaught Error: password: …" in console and uncaught error: value absent from the zip, recorded masked (AC-2.3, E4-IN1b)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/privacy-iterator.html?keep=1`);
    await startRecording(page);
    const traps = await readTraps(page);
    await page.click('#t-throw');
    await expect(page.locator('#t-result')).toHaveText('thrown');
    // The uncaught error reaches the recorder asynchronously.
    await page.waitForTimeout(300);
    const { json, files, summary } = await saveRecording(page);

    const logs = json.consoleLogs.filter((e) => JSON.stringify(e.args).includes('password'));
    expect(logs.length, JSON.stringify(json.consoleLogs)).toBeGreaterThanOrEqual(1);
    const errors = json.runtimeErrors.filter((e) => String(e.message).includes('password'));
    expect(errors.length, JSON.stringify(json.runtimeErrors)).toBeGreaterThanOrEqual(1);
    expect(leaks(files, { password: traps.password })).toEqual({});
    expect(summary).not.toContain(traps.password);
    expect(JSON.stringify([...logs, ...errors])).toMatch(MARKER);
  });
});

// Minimal MCP client over stdio (the integration test in tests/unit does the same with a bigger one).
function startMcp(dir) {
  const child = spawn(process.execPath, [MCP_SERVER, dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-5000); });
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((res, rej) => {
      const id = nextId++;
      const timer = setTimeout(() => rej(new Error(`no reply to ${method}; stderr: ${stderr}`)), 20_000);
      pending.set(id, (msg) => { clearTimeout(timer); res(msg); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  return {
    request,
    stop: () => new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.stdin.end();
      setTimeout(() => child.kill(), 3000);
    }),
  };
}

test('privacy.html zip: trap values absent from summary.md, viewer text of every tab (file://) and every MCP tool answer (AC-2.9)', async () => {
  test.setTimeout(90_000);
  let saved;
  let values;
  await withTab(async (page) => {
    await page.goto(`${server.url}/privacy.html`);
    await startRecording(page);
    const traps = await readTraps(page);
    const creds = credentials();
    await page.fill('#f-email', creds.email);
    await page.fill('#f-password', creds.password);
    await page.click('#t-login');
    await expect(page.locator('#t-result')).toHaveText('status 401');
    saved = await saveRecording(page);
    values = privacyValues(traps, creds);
  });

  // Consumer 0 control: the traps were recorded (masked), so the checks below are not vacuous.
  const login = saved.json.network.find((e) => e.url.includes('/api/login'));
  expect(login, JSON.stringify(saved.json.network.map((e) => e.url))).toBeTruthy();
  expect(JSON.stringify(login)).toMatch(MARKER);
  expect(leaks(saved.files, values)).toEqual({});

  // Consumer 1: summary.md.
  expect(saved.summary.length).toBeGreaterThan(200);
  expect(leaksInText(saved.summary, values)).toEqual([]);

  // Consumer 2: the viewer, text of every tab.
  const browser = await chromium.launch({ channel: 'chromium', headless: process.env.PDS_E2E_HEADED !== '1' });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(VIEWER);
    await page.setInputFiles('#file', saved.path);
    await expect(page.locator('#summary-text')).toBeVisible({ timeout: 10_000 });
    expect(await page.locator('#summary-text').textContent()).toBe(saved.summary);
    const texts = {};
    for (const id of TABS) {
      await page.click(`nav[role="tablist"] button[data-tab="${id}"]`);
      texts[id] = await page.evaluate((tab) => globalThis.document.querySelector(`#app [data-tab-panel="${tab}"]`).textContent, id);
    }
    // The viewer also shows the header; join everything on the page.
    const whole = await page.evaluate(() => globalThis.document.body.textContent);
    for (const [id, text] of Object.entries(texts)) expect(leaksInText(text, values), `viewer tab ${id}`).toEqual([]);
    expect(leaksInText(whole, values), 'viewer page').toEqual([]);
    expect(texts.network, 'network tab shows the recorded login').toContain('/api/login');
    expect(whole).toMatch(MARKER);
  } finally {
    await browser.close();
  }

  // Consumer 3: the MCP server on a directory holding this zip.
  const dir = await mkdtemp(join(tmpdir(), 'pds-mcp-e2e-'));
  const mcp = startMcp(dir);
  try {
    await copyFile(saved.path, join(dir, basename(saved.path)));
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pds-e2e', version: '1.0.0' } });
    expect(init.result.serverInfo.name).toBe('page-debug-mcp');
    const call = async (name, args = {}) => {
      const reply = await mcp.request('tools/call', { name, arguments: args });
      expect(reply.error, name).toBeUndefined();
      expect(reply.result.isError === true, `${name} ${JSON.stringify(args)}: ${reply.result.content?.[0]?.text}`).toBe(false);
      return reply.result.content[0].text;
    };
    const listing = await call('list_snapshots');
    const id = JSON.parse(listing).items[0].id;
    const answers = { list_snapshots: listing };
    answers.get_summary = await call('get_summary', { id });
    answers.get_errors = await call('get_errors', { id, limit: 200 });
    answers.get_steps = await call('get_steps', { id, limit: 2000 });
    answers.get_vitals = await call('get_vitals', { id });
    answers.get_network_default = await call('get_network', { id });
    answers.get_network_all = await call('get_network', { id, status: '100-599', includeHeaders: true, includeBody: true, limit: 500 });
    answers.get_network_any = await call('get_network', { id, failedOnly: false, includeHeaders: true, includeBody: true, limit: 500 });
    answers.diff_snapshots = await call('diff_snapshots', { a: id, b: id });
    expect(answers.get_summary).toBe(saved.summary); // AC-5.3 across the real extension's package
    for (const [name, text] of Object.entries(answers)) expect(leaksInText(text, values), `MCP ${name}`).toEqual([]);
    expect(answers.get_network_any, 'the recorded login is in the answer').toContain('/api/login');
    expect(answers.get_network_any).toMatch(MARKER);
  } finally {
    await mcp.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
