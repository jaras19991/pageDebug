// E4 QA (manual-style) run: reporter scenario + production of packages for the developer scenario.
// Run from the repo root: node docs/epics/E4/qa/run-reporter.mjs   (Chromium with dist/chrome loaded)
import { mkdir, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from '../../../../tests/e2e/helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from '../../../../tests/e2e/helpers/launch.js';
import { saveRecording, startRecording } from '../../../../tests/e2e/helpers/recording.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const PKGS = join(HERE, 'pkgs');
const DL = join(HERE, 'dl');
await mkdir(SHOTS, { recursive: true });
await mkdir(PKGS, { recursive: true });
await rm(DL, { recursive: true, force: true });
await mkdir(DL, { recursive: true });
const results = {};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startFixtureServer({ port: 0 });
const ext = await launchWithExtension({ downloadDir: DL });
const cdp = ext.browserCdp;

// Popup screenshot over a non-flatten session (the same mechanism the harness uses for Runtime.evaluate).
async function snap(popup, name) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
  const id = 1;
  const done = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('snap timeout')), 8000);
    cdp.on('Target.receivedMessageFromTarget', function h(ev) {
      if (ev.sessionId !== sessionId) return;
      const msg = JSON.parse(ev.message);
      if (msg.id !== id) return;
      clearTimeout(t);
      cdp.off('Target.receivedMessageFromTarget', h);
      res(msg);
    });
  });
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }) });
  const msg = await done;
  if (msg.result?.data) await writeFile(join(SHOTS, `${name}.png`), Buffer.from(msg.result.data, 'base64'));
  await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
}

const POPUP_STATE = `(() => { const q = (s) => document.querySelector(s);
  const vis = (e) => !!e && !e.hidden;
  return { sections: ['ready','recording','saved'].filter((i) => vis(q('#'+i))),
    status: q('#status').textContent, statusClass: q('#status').className,
    savedFile: q('#savedFile').textContent, savedInstruction: q('#savedInstruction').textContent, savedShot: q('#savedShot').textContent,
    savedMissing: q('#savedMissing').textContent, since: q('#since').textContent, note: q('#note').textContent,
    screenshotNote: q('#screenshotNote').textContent,
    disclosure: [...document.querySelectorAll('#disclosure li')].filter(vis).map((l) => l.textContent),
    scrollH: document.documentElement.scrollHeight, innerH: innerHeight, innerW: innerWidth,
    saveBottom: (() => { const b = q('#save'); const r = b && b.getBoundingClientRect(); return r && r.bottom; })(),
    showBottom: (() => { const b = q('#newRecording'); const r = b && b.getBoundingClientRect(); return r && r.bottom; })(),
    recordBottom: (() => { const b = q('#record'); const r = b && b.getBoundingClientRect(); return r && r.bottom; })(),
    buttons: [...document.querySelectorAll('button')].filter((b) => !b.closest('[hidden]')).map((b) => b.textContent + (b.disabled ? ' (disabled)' : '')) }; })()`;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    results[name] = { ok: true, ...(await fn()) };
  } catch (e) {
    results[name] = { ok: false, error: String(e?.stack ?? e).slice(0, 800) };
  }
  results[name].ms = Date.now() - t0;
  console.log(name, JSON.stringify(results[name]).slice(0, 1500));
}

async function popupInfo(page, shot) {
  const popup = await openPopupFor(page);
  try {
    await delay(500);
    const state = await popup.evaluate(POPUP_STATE);
    if (shot) await snap(popup, shot);
    return state;
  } finally {
    await popup.close();
  }
}

const keep = async (name, path) => { await copyFile(path, join(PKGS, name)); };

try {
  // --- 1. Reporter: basic.html, literal flow ---
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/basic.html`);
  await step('1-ready', async () => ({ state: await popupInfo(page, '01-ready') }));
  await step('2-record', async () => {
    const r = await startRecording(page);
    return { since: r.since, clickToRecordingMs: r.reloadedAt - r.clickedAt, clicks: 'Nagrywaj (1)' };
  });
  await step('3-recording-screen', async () => ({ state: await popupInfo(page, '02-recording') }));
  await page.click('#action');
  await page.evaluate(() => console.error('QA basic error'));
  let basicPkg;
  await step('4-save', async () => {
    basicPkg = await saveRecording(page);
    await keep('basic.zip', basicPkg.path);
    return { fileName: basicPkg.fileName, savedAfterMs: basicPkg.savedAfterMs, entries: basicPkg.entries, zipBytes: Object.values(basicPkg.files).reduce((a, b) => a + b.length, 0) };
  });
  await step('5-saved-screen', async () => ({ state: await popupInfo(page, '03-saved') }));
  // "Pokaż plik": existing file
  await step('6-show-file-existing', async () => {
    const popup = await openPopupFor(page);
    try {
      await popup.click('#showFile');
      await delay(1200);
      const s = await popup.evaluate(POPUP_STATE);
      await snap(popup, '04-show-file-existing');
      return { state: s };
    } finally { await popup.close(); }
  });
  // reopen -> still saved (AC-1.6) already covered by 5; delete file and click again
  await step('7-show-file-deleted', async () => {
    await rm(basicPkg.path);
    const popup = await openPopupFor(page);
    try {
      await delay(300);
      await popup.click('#showFile');
      await delay(1500);
      const s = await popup.evaluate(POPUP_STATE);
      await snap(popup, '05-show-file-deleted');
      return { state: s };
    } finally { await popup.close(); }
  });
  // other tab recording line on saved screen
  await step('8-other-tab-recording', async () => {
    const b = await ext.context.newPage();
    await b.goto(`${server.url}/network.html`);
    const r = await startRecording(b);
    const stateA = await popupInfo(page, '06-saved-with-other-tab-recording');
    const stateB = await popupInfo(b, '07-recording-tab-b');
    // third tab, ready screen with otherTabRecording
    const c = await ext.context.newPage();
    await c.goto(`${server.url}/cls.html`);
    const stateC = await popupInfo(c, '08-ready-with-other-tab-recording');
    await c.close();
    await b.close();
    return { stateA, stateB, stateC };
  });
  // Nowe nagranie
  await step('9-new-recording', async () => {
    const popup = await openPopupFor(page);
    try {
      await delay(400);
      await popup.click('#newRecording');
      await delay(600);
      const s = await popup.evaluate(POPUP_STATE);
      await snap(popup, '09-after-new-recording');
      return { state: s };
    } finally { await popup.close(); }
  });
  await page.close();

  // --- negative: restricted page ---
  await step('10-restricted-chrome-url', async () => {
    const p = await ext.context.newPage();
    await p.goto('chrome://version');
    const s = await popupInfo(p, '10-restricted');
    await p.close();
    return { state: s };
  });

  // --- double Nagrywaj ---
  await step('11-double-record', async () => {
    const p = await ext.context.newPage();
    await p.goto(`${server.url}/basic.html`);
    await ext.grantOrigin(`http://127.0.0.1/*`);
    const popup = await openPopupFor(p);
    try {
      const reloaded = p.waitForEvent('load', { timeout: 15000 });
      await popup.click('#record');
      await popup.click('#record').catch((e) => String(e));
      await reloaded;
      await delay(1500);
      const s = await popup.evaluate(POPUP_STATE).catch((e) => ({ err: String(e) }));
      return { state: s };
    } finally { await popup.close().catch(() => {}); await p.close(); }
  });

  // --- 2. Developer packages: privacy-iterator (steps, fetch 500, throw) ---
  await step('20-pkg-iterator', async () => {
    const p = await ext.context.newPage();
    await p.goto(`${server.url}/privacy-iterator.html`);
    await startRecording(p);
    const traps = await p.evaluate(() => window.__pdsTraps);
    const t0 = Date.now();
    await p.click('#t-fetch');
    await p.waitForSelector('#t-result:has-text("status 500")');
    await p.click('#t-nav');
    await p.click('#t-throw');
    await p.waitForTimeout(400);
    const pkg = await saveRecording(p);
    await keep('iterator.zip', pkg.path);
    await writeFile(join(PKGS, 'iterator.traps.json'), JSON.stringify({ ...traps, jwt: undefined }, null, 1));
    await writeFile(join(PKGS, 'iterator.summary.md'), pkg.summary);
    await p.close();
    return { fileName: pkg.fileName, savedAfterMs: pkg.savedAfterMs, summaryLines: pkg.summary.split('\n').length, summaryBytes: pkg.summary.length, rules: pkg.json.redaction };
  });

  // --- privacy.html: token in localStorage + e-mail in form ---
  await step('21-pkg-privacy', async () => {
    const p = await ext.context.newPage();
    await p.goto(`${server.url}/privacy.html`);
    await startRecording(p);
    const traps = await p.evaluate(() => window.__pdsTraps);
    await p.click('#t-login');
    await p.waitForSelector('#t-result:has-text("status")');
    await p.waitForTimeout(300);
    const pkg = await saveRecording(p);
    await keep('privacy.zip', pkg.path);
    await writeFile(join(PKGS, 'privacy.traps.json'), JSON.stringify({ ...traps, email: 'jan.kowalski@example.com', password: 'Sekret123!', phone: '+48 600 700 800', card: '4111 1111 1111 1111', cardDigits: '4111111111111111' }, null, 1));
    await writeFile(join(PKGS, 'privacy.summary.md'), pkg.summary);
    await p.close();
    return { fileName: pkg.fileName, savedAfterMs: pkg.savedAfterMs, redaction: pkg.json.redaction, zipBytes: (await readdir(DL)).length };
  });

  // --- keep-iterator variant (Uncaught Error: password) ---
  await step('22-pkg-iterator-keep', async () => {
    const p = await ext.context.newPage();
    await p.goto(`${server.url}/privacy-iterator.html?keep=1`);
    await startRecording(p);
    const traps = await p.evaluate(() => window.__pdsTraps);
    await p.click('#t-throw');
    await p.waitForTimeout(400);
    const pkg = await saveRecording(p);
    await keep('iterator-keep.zip', pkg.path);
    await writeFile(join(PKGS, 'iterator-keep.traps.json'), JSON.stringify(traps, null, 1));
    await p.close();
    return { fileName: pkg.fileName };
  });

  // --- page with frames / network failures for richer summary ---
  await step('23-pkg-network', async () => {
    const p = await ext.context.newPage();
    await p.goto(`${server.url}/network.html`);
    await startRecording(p);
    await p.waitForTimeout(1500);
    const pkg = await saveRecording(p);
    await keep('network.zip', pkg.path);
    await p.close();
    return { fileName: pkg.fileName, summaryLines: pkg.summary.split('\n').length };
  });
} finally {
  await writeFile(join(HERE, 'reporter-results.json'), JSON.stringify(results, null, 1));
  await ext.close();
  await server.close();
}
console.log('DONE');
