/* global process, console, setTimeout, chrome, document, window */
// E2-T0 spike (Chromium via Playwright): S1, S2, S3, S5, S6 from docs/epics/E2/design.md.
// Prints PASS/FAIL per point plus evidence. The extension is copied to a temp dir (S5 adds
// `webRequest` to the copy only). Usage: node tests/e2e/spike-e2/run.spike.mjs [--headed] [--dpr2 | --dpr2-real]
// --dpr2 = Playwright deviceScaleFactor emulation, --dpr2-real = --force-device-scale-factor=2 without viewport emulation.
import { chromium } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.spike.mjs';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'ext');
const headless = !process.argv.includes('--headed');
const dpr2 = process.argv.includes('--dpr2');
const dpr2real = process.argv.includes('--dpr2-real');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const evidence = (label, value) => console.log(`  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} spike: ${name}`);
  if (detail !== undefined) evidence('evidence', detail);
}

const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

function copyExt(work, name, overlay) {
  const dir = join(work, name);
  cpSync(SRC, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(overlay(m), null, 2));
  return dir;
}

// Non-flatten CDP session on the browser-level session (popup is not a Playwright Page, E0 T17).
function sessionClient(cdp, sessionId) {
  let nextId = 1;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    if (event.sessionId !== sessionId) return;
    const msg = JSON.parse(event.message);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  return (method, params = {}) => {
    const id = nextId++;
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(rej);
    });
  };
}

async function openPopup(cdp, extensionId, page) {
  await page.bringToFront();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
  const tab = targetInfos.find((t) => t.type === 'tab' && t.url === page.url() && t.embedderData?.tabActive);
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const known = new Set(targetInfos.map((t) => t.targetId));
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await delay(50);
    target = (await cdp.send('Target.getTargets')).targetInfos.find(
      (t) => t.type === 'page' && t.url === popupUrl && !known.has(t.targetId),
    );
  }
  if (!target) throw new Error('popup did not open');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const send = sessionClient(cdp, sessionId);
  const evaluate = async (expression, userGesture = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 100 && (await evaluate('document.body?.dataset.ready ?? null')) !== '1'; i++) await delay(50);
  return {
    evaluate,
    click: (sel, userGesture) => evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`, userGesture),
    waitOut: async (pred, ms = 5000) => {
      const end = Date.now() + ms;
      let text = '';
      while (Date.now() < end) {
        text = await evaluate('document.getElementById("out").textContent');
        if (pred(text)) return text;
        await delay(50);
      }
      return `TIMEOUT(last=${text})`;
    },
    close: () => cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {}),
  };
}

async function swFor(context, extensionId, timeout = 5000) {
  const match = (w) => w.url().startsWith(`chrome-extension://${extensionId}/`);
  const found = context.serviceWorkers().find(match);
  if (found) return found;
  return context.waitForEvent('serviceworker', { predicate: match, timeout });
}

async function launch(extDir, profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless,
    ...(dpr2 ? { deviceScaleFactor: 2 } : {}),
    ...(dpr2real ? { viewport: null } : {}),
    args: [...(dpr2real ? ['--force-device-scale-factor=2'] : []),`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--enable-unsafe-extension-debugging'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const ext = await context.newPage();
  await ext.goto('chrome://extensions');
  const infos = await ext.evaluate(() => globalThis.chrome.developerPrivate.getExtensionsInfo());
  const extensionId = infos.find((i) => resolve(i.path ?? '') === resolve(extDir)).id;
  const sw = await swFor(context, extensionId);
  // grantOrigin as in the E1 harness: addHostPermission, then a gesture click on #request in a popup.
  const grantOrigin = async (page) => {
    await ext.evaluate((id) => globalThis.chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
    const popup = await openPopup(cdp, extensionId, page);
    await popup.click('#request', true);
    const out = await popup.waitOut((t) => t.length > 0);
    return { out, popup };
  };
  return { context, cdp, ext, extensionId, sw, grantOrigin };
}

const capture = (sw, page, summary = false) =>
  sw.evaluate(async ({ url, summary: s }) => {
    const [tab] = await chrome.tabs.query({ url });
    return { tabActive: tab?.active ?? null, ...(await globalThis.spike.capture({ windowId: tab?.windowId, summary: s })) };
  }, { url: page.url(), summary });

const near = (c, [r, g, b], tol = 12) => Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol;

async function attr(page, name, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate((n) => document.documentElement.getAttribute(n), name).catch(() => null);
    if (v) return JSON.parse(v);
    await delay(100);
  }
  return null;
}

async function main() {
  const server = await startServer();
  const closedPort = await freePort();
  const work = mkdtempSync(join(tmpdir(), 'pds-spike-e2-'));
  const extA = copyExt(work, 'ext', (m) => m);
  const extB = copyExt(work, 'ext-webrequest', (m) => ({ ...m, name: 'PDS Spike E2-T0 webRequest', permissions: [...m.permissions, 'webRequest'] }));
  let a;
  let b;
  try {
    a = await launch(extA, join(work, 'profile-a'));
    console.log(`Chromium ${a.context.browser().version()}, headless=${headless}, dpr2=${dpr2}, dpr2real=${dpr2real}`);
    const { sw, cdp, extensionId } = a;

    // S1: controls first, before any popup was opened on this tab.
    const page = await a.context.newPage();
    await page.goto(`${server.origin}/shot`);
    const noGrant = await capture(sw, page, true);
    const { out: granted, popup } = await a.grantOrigin(page);
    const view = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }));
    const shot = await capture(sw, page);
    const ok1 = shot.ok && shot.prefix === 'data:image/jpeg;base64,' && shot.width === Math.round(view.w * view.dpr) &&
      shot.height === Math.round(view.h * view.dpr) && shot.corners.every((c) => near(c, [0, 128, 255]));
    report('S1 captureVisibleTab after triggerAction (jpeg, dims, corners)', ok1, { view, granted, noPopupYet: noGrant, shot });
    await delay(600);
    const burst = await Promise.all([1, 2, 3].map(() => capture(sw, page, true)));
    evidence('S1 burst of 3 captures', burst);
    await popup.close();
    await delay(1100);
    evidence('S1 after popup closed (same doc)', await capture(sw, page, true));

    // Second tab on the same origin, popup never opened there.
    const page2 = await a.context.newPage();
    await page2.goto(`${server.origin}/shot?tab2`);
    await page2.bringToFront();
    await delay(600);
    evidence('S1 control: other tab same origin, no popup (origin granted)', await capture(sw, page2, true));
    await page2.close();
    await page.bringToFront();

    // S2: popup opened, same-origin reload and same-origin navigation, then cross-origin and back.
    const p2 = await openPopup(cdp, extensionId, page);
    await page.reload();
    await delay(600);
    const afterReload = await capture(sw, page, true);
    await page.goto(`${server.origin}/shot?other-path`);
    await delay(600);
    const afterPath = await capture(sw, page, true);
    await p2.close();
    await page.goto(`${server.cross}/shot`);
    await page.goto(`${server.origin}/shot?back`);
    await delay(600);
    const afterCross = await capture(sw, page, true);
    report('S2 activeTab survives same-origin reload', afterReload.ok, { afterReload, afterSameOriginPath: afterPath, controlCrossOriginAndBack: afterCross });
    await page.goto('chrome://version');
    const p3 = await openPopup(cdp, extensionId, page).catch((e) => ({ error: e.message }));
    await delay(600);
    evidence('S1 control: chrome://version with popup opened', await capture(sw, page, true));
    if (p3.close) await p3.close();
    await page.goto(`${server.origin}/shot?bg`);
    const p4 = await openPopup(cdp, extensionId, page);
    const front = await a.context.newPage();
    await front.goto('about:blank');
    await delay(600);
    evidence('S1 control: recording tab in background, popup was opened on it', await capture(sw, page, true));
    await p4.close();
    await front.close();

    // S3: Resource / Navigation Timing statuses (no extension involved).
    const s3page = await a.context.newPage();
    await s3page.goto(`${server.origin}/s3?closed=${encodeURIComponent(`http://127.0.0.1:${closedPort}`)}`);
    const s3 = await attr(s3page, 'data-spike-s3');
    await s3page.goto(`${server.origin}/missing`);
    const nav = await attr(s3page, 'data-spike-nav');
    const byName = (n) => s3?.rt.find((e) => e.name === n);
    const s3ok = s3 && byName('/missing.png')?.responseStatus === 404 && byName('/missing.js')?.responseStatus === 404 &&
      byName('/ok.css')?.responseStatus === 200 && byName('[cross]/ok.png')?.responseStatus === 0 && nav?.status === 404;
    report('S3 responseStatus same-origin 404 / cross-origin 0 / navigation 404', !!s3ok, { features: s3?.features, rt: s3?.rt, errors: s3?.errors, nav });
    // S6: clone + reader + cancel on an endless 500 stream.
    await s3page.goto(`${server.origin}/s6`);
    const s6 = await attr(s3page, 'data-spike-s6', 15000);
    const s6ok = s6 && s6.status === 500 && s6.cloneTimedOut && s6.cloneMs < 2600 && s6.pageChunks >= 3 &&
      !s6.bodyUsedAfterClone && !s6.bodyUsedAfterCloneCancel && s6.jsonPageParsed === '{"error":"boom","code":42}';
    report('S6 clone reader cancel keeps page branch', !!s6ok, s6);
    await s3page.close();
    await a.context.close();
    a = null;

    // S5: webRequest + granted 127.0.0.1 only; image from localhost (cross-origin).
    b = await launch(extB, join(work, 'profile-b'));
    const bp = await b.context.newPage();
    await bp.goto(`${server.origin}/shot`);
    const seenBeforeGrant = await b.sw.evaluate(() => ({ api: !!chrome.webRequest, seen: globalThis.spike.seen.map((s) => `${s.ev}:${s.url}`) }));
    const g = await b.grantOrigin(bp);
    await g.popup.close();
    const dbg = await b.sw.evaluate(async () => {
      const late = [];
      chrome.webRequest.onBeforeRequest.addListener((d) => { late.push(`before:${d.url}`); }, { urls: ['<all_urls>'] });
      globalThis.late = late;
      return { contains: await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }), all: await chrome.permissions.getAll() };
    });
    evidence('S5 permissions in SW', dbg);
    await delay(1000);
    await bp.goto(`${server.origin}/s5`);
    await delay(1500);
    evidence('S5 seen after 1st nav', await b.sw.evaluate(() => globalThis.spike.seen.length));
    const bp2 = await b.context.newPage();
    await bp2.goto(`${server.origin}/s5?again`);
    await delay(1500);
    const late = await b.sw.evaluate(() => globalThis.late);
    const swNow = await swFor(b.context, b.extensionId);
    evidence('S5 same SW instance', swNow === b.sw);
    const seen = await swNow.evaluate(() => globalThis.spike.seen.slice());
    // onBeforeRequest (added after the grant) is the evidence; top-level onCompleted/onErrorOccurred
    // stayed silent in Chromium 156 here (anomaly noted in spike-T0.md, not needed by D2).
    const urls = [...late, ...seen.map((x) => x.url)];
    const s5ok = urls.some((u) => u.includes('s5=same')) && !urls.some((u) => u.includes('s5=cross'));
    report('S5 webRequest sees only granted origin', s5ok, { granted: g.out, seenBeforeGrant, lateOnBeforeRequest: late, topLevelCompletedOrError: seen });
  } finally {
    await a?.context.close().catch(() => {});
    await b?.context.close().catch(() => {});
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
