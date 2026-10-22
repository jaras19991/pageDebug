/* global process, console, setTimeout, chrome, document */
// E1-T0 spike (Chromium via Playwright): S1-S7 from docs/epics/E1/design.md. Prints PASS/FAIL per
// point plus evidence. Usage: node tests/e2e/spike-e1/run.spike.mjs [--headed]
import { chromium } from '@playwright/test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.spike.mjs';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), 'ext');
const headless = !process.argv.includes('--headed');
const skipS3 = process.argv.includes('--skip-s3');
const acceptDownloads = !process.argv.includes('--no-accept-downloads');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const evidence = (label, value) => console.log(`  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} spike: ${name}`);
  if (detail !== undefined) evidence('evidence', detail);
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
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
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

const marks = (page) =>
  page.evaluate(() => {
    const get = (k) => {
      const v = document.documentElement.getAttribute(k);
      return v && JSON.parse(v);
    };
    return { main: get('data-spike-main'), iso: get('data-spike-iso'), page: get('data-spike-page') };
  });

async function waitMarks(page, prevOrigin) {
  for (let i = 0; i < 100; i++) {
    await delay(50);
    const m = await marks(page).catch(() => null);
    if (!m?.page || !m.main?.sent || m.main.timeOrigin === prevOrigin) continue;
    return m;
  }
  return marks(page).catch(() => ({}));
}

const summarize = (m) => ({
  caught: !!m.main?.errors?.some((e) => e.includes('head-boom')),
  mainBeforePage: m.main && m.page ? m.main.t0 < m.page.t0 : null,
  order: m.main && m.iso ? (m.main.t0 < m.iso.t0 ? 'main-first' : 'iso-first') : null,
  bound: m.main?.bound,
  isoBound: m.iso?.bound,
  nodeConnected: m.main?.nodeConnected,
  received: m.main?.received,
  objDetail: m.main?.objDetail,
  pageEvents: m.page?.events,
  pageLeaks: m.page?.leaks?.map((l) => {
    let msg = null;
    try {
      msg = JSON.parse(l.detail);
    } catch {
      /* not JSON */
    }
    return `${l.via}:${l.type}:${msg ? `${msg.type} nonce=${msg.n ? 'yes' : 'no'}` : l.detail}`;
  }),
  fakeNodeMessages: m.page?.fakeNodeMessages,
});

async function main() {
  const server = await startServer();
  const downloadDir = mkdtempSync(join(tmpdir(), 'pds-spike-e1-dl-'));
  const profileDir = mkdtempSync(join(tmpdir(), 'pds-spike-e1-profile-'));
  const prefsDownloadDir = join(downloadDir, 'prefs');
  mkdirSync(prefsDownloadDir);
  mkdirSync(join(profileDir, 'Default'));
  writeFileSync(
    join(profileDir, 'Default', 'Preferences'),
    JSON.stringify({ download: { default_directory: prefsDownloadDir, prompt_for_download: false, directory_upgrade: true } }),
  );
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless,
    acceptDownloads, // true in tests/e2e/helpers/launch.js
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--enable-unsafe-extension-debugging'],
  });
  console.log(`Chromium ${context.browser().version()}, headless=${headless}`);
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    // ID from chrome://extensions, as in the E0 harness.
    const ext = await context.newPage();
    await ext.goto('chrome://extensions');
    const infos = await ext.evaluate(() => globalThis.chrome.developerPrivate.getExtensionsInfo());
    const extensionId = infos.find((i) => resolve(i.path ?? '') === EXT).id;

    // S1
    let sw = await swFor(context, extensionId);
    const swId = await sw.evaluate(() => chrome.runtime.id);
    report('S1 service worker handle', swId === extensionId, { url: sw.url(), runtimeId: swId });

    // S3
    const before = await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }));
    let addErr = null;
    try {
      if (!skipS3) await ext.evaluate((id) => globalThis.chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*'), extensionId);
    } catch (e) {
      addErr = e.message;
    }
    const after = await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }));
    const all = await sw.evaluate(() => chrome.permissions.getAll());
    const localhost = await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] }));
    const info = await ext.evaluate((id) => globalThis.chrome.developerPrivate.getExtensionInfo(id), extensionId);
    report('S3 developerPrivate.addHostPermission grants origin directly', !before && after && !addErr, {
      before, after, addErr, origins: all.origins, localhostStillDenied: !localhost,
      runtimeHostPermissions: info.permissions?.runtimeHostPermissions?.hosts?.map((h) => `${h.host}:${h.granted}`),
    });

    // S4
    const page = await context.newPage();
    await page.goto(`${server.origin}/plain`);
    let popup = await openPopup(cdp, extensionId, page);
    evidence('popup pattern', await popup.evaluate('document.body.dataset.pattern'));
    await popup.click('#request', false);
    const noGesture = await popup.waitOut((t) => t.length > 0);
    await popup.evaluate('document.getElementById("out").textContent = ""');
    await popup.click('#request', true);
    const withGesture = await popup.waitOut((t) => t.length > 0).catch((e) => `popup gone: ${e.message}`);
    if (withGesture.startsWith('popup gone')) {
      report('S4 gesture click resolves permissions.request', false, { noGesture, withGesture });
      return;
    }
    evidence('S4 contains after request', await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })));
    report('S4 gesture click resolves permissions.request', withGesture === 'granted:true' && noGesture.startsWith('error:'), {
      noGesture, withGesture,
    });

    // S4b: not-granted origin + gesture shows the native bubble; Playwright cannot answer it.
    const lpage = await context.newPage();
    await lpage.goto(`http://localhost:${server.port}/plain`);
    const lpopup = await openPopup(cdp, extensionId, lpage);
    await lpopup.click('#request', true);
    evidence('S4b localhost (not granted) after 2 s', await lpopup.waitOut((t) => t.length > 0, 2000).catch((e) => `popup gone: ${e.message}`));
    evidence('S4b contains localhost', await sw.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost/*'] })));
    evidence('S4b targets', (await cdp.send('Target.getTargets')).targetInfos.map((t) => `${t.type}:${t.url.slice(0, 60)}`));
    await lpopup.close();
    await lpage.close();

    // S2
    await sw.evaluate(() => chrome.storage.session.set({ spikeKey: 'kept' }));
    const boot1 = await sw.evaluate(() => globalThis.spike.bootId);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const swTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
    let closeErr = null;
    const closed = new Promise((r) => sw.once('close', () => r(true)));
    try {
      evidence('Target.closeTarget', await cdp.send('Target.closeTarget', { targetId: swTarget.targetId }));
    } catch (e) {
      closeErr = e.message;
    }
    const swClosed = await Promise.race([closed, delay(3000).then(() => false)]);
    const left = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker').length;
    // S4b closed the S4 popup (one popup per window): open a fresh one and wake the worker with a message.
    popup = await openPopup(cdp, extensionId, page);
    const ping = await popup.evaluate('chrome.runtime.sendMessage({ type: "ping" })');
    sw = await swFor(context, extensionId);
    const kept = await sw.evaluate(() => chrome.storage.session.get('spikeKey'));
    report('S2 SW restart keeps storage.session', !closeErr && left === 0 && ping.bootId !== boot1 && kept.spikeKey === 'kept', {
      closeErr, swClosedEvent: swClosed, swTargetsAfterClose: left, boot1, boot2: ping.bootId, kept,
      newHandleBootId: await sw.evaluate(() => globalThis.spike.bootId),
    });

    // S7: try the download behaviour browser-wide and for the page's browser context.
    const cdpEvents = [];
    cdp.on('Browser.downloadWillBegin', (e) => cdpEvents.push(`willBegin:${e.suggestedFilename}`));
    cdp.on('Browser.downloadProgress', (e) => e.state !== 'inProgress' && cdpEvents.push(`progress:${e.state}`));
    const pwDownloads = [];
    page.on('download', (d) => pwDownloads.push(d.suggestedFilename()));
    const pageTarget = (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url === page.url());
    const s7 = {};
    for (const variant of ['browser', 'context', 'default']) {
      // 'default' hands downloads back to Chrome; the directory then comes from profile Preferences.
      const dir = variant === 'default' ? prefsDownloadDir : join(downloadDir, variant);
      if (variant !== 'default') mkdirSync(dir);
      const params = variant === 'default' ? { behavior: 'default' } : { behavior: 'allow', downloadPath: dir, eventsEnabled: true };
      if (variant === 'context') params.browserContextId = pageTarget.browserContextId;
      let setDl = await cdp.send('Browser.setDownloadBehavior', params).then(() => 'ok', (e) => e.message);
      if (variant === 'default') {
        setDl += await cdp
          .send('Browser.setDownloadBehavior', { ...params, browserContextId: pageTarget.browserContextId })
          .then(() => '+ctx ok', (e) => `+ctx ${e.message}`);
      }
      const saves = [];
      for (let i = 0; i < 2; i++) {
        await popup.evaluate('document.getElementById("out").textContent = ""');
        await popup.click('#download', false);
        const out = await popup.waitOut((t) => t.length > 0, 10000);
        const downloadId = JSON.parse(out).download?.downloadId;
        let state = null;
        for (let j = 0; j < 100 && !state; j++) {
          await delay(100);
          state = (await sw.evaluate((k) => chrome.storage.session.get(k), `dl:${downloadId}`))[`dl:${downloadId}`] ?? null;
        }
        saves.push({ downloadId, state: state?.state, basename: state?.basename, bootId: state?.bootId });
      }
      const files = readdirSync(dir).map((f) => `${f}:${statSync(join(dir, f)).size}`);
      const ok = setDl.startsWith('ok') && saves.every((x) => x.state === 'complete' && x.basename?.startsWith('pds-spike-e1') &&
        files.some((f) => f.startsWith(`${x.basename}:`)));
      s7[variant] = { ok, contextId: params.browserContextId ?? null, setDl, saves, files };
    }
    report('S7 popup blob download lands with real name', Object.values(s7).some((v) => v.ok), {
      acceptDownloads, ...s7, cdpEvents, playwrightDownloadEvents: pwDownloads,
    });
    await popup.close();

    // S5 + S6: register MAIN + ISOLATED for the origin, reload through tabs.reload.
    await page.goto(`${server.origin}/head`);
    const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());
    let prev = (await marks(page)).main?.timeOrigin ?? null;
    evidence('before register (no scripts yet)', prev);
    const reg = await sw.evaluate(
      (o) => globalThis.spike.register(o),
      { pattern: 'http://127.0.0.1/*', order: 'main-first', slash: true, tabId },
    );
    evidence('registered', reg);
    const runs = [];
    let m = await waitMarks(page, prev);
    runs.push(summarize(m));
    for (let i = 1; i < 10; i++) {
      prev = m.main?.timeOrigin;
      await sw.evaluate((id) => chrome.tabs.reload(id), tabId);
      m = await waitMarks(page, prev);
      runs.push(summarize(m));
    }
    const caught = runs.filter((r) => r.caught && r.mainBeforePage).length;
    report('S5 document_start before inline head script 10/10', caught === 10, { caught, orders: runs.map((r) => r.order) });
    evidence('S5 sample run', runs[0]);

    const s6ok = (r) =>
      r.bound && r.isoBound && r.nodeConnected === false && r.pageEvents?.length === 0 && r.fakeNodeMessages === 0 &&
      r.received?.includes('pong-safe') && r.pageLeaks?.every((l) => l.includes('-naive'));
    const variants = {};
    for (const [label, order, mode, slash] of [
      ['iso-first', 'iso-first', 'related', true],
      ['fallback', 'main-first', 'fallback', true],
      ['no-slash', 'main-first', 'related', false],
    ]) {
      await sw.evaluate((o) => globalThis.spike.register(o), { pattern: 'http://127.0.0.1/*', order, slash, tabId: null });
      prev = m.main?.timeOrigin;
      await page.goto(`${server.origin}/head?mode=${mode}`);
      m = await waitMarks(page, prev);
      variants[label] = summarize(m);
    }
    report('S6 private channel invisible to page', runs.every(s6ok) && s6ok(variants['iso-first']), {
      relatedTargetRuns: runs.filter(s6ok).length, variants,
    });
    evidence('S6 iso reports in SW', await sw.evaluate(async () => (await chrome.storage.session.get('isoReports')).isoReports?.length));

    // S2b: registered scripts survive a worker stop.
    const swT = (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
    await cdp.send('Target.closeTarget', { targetId: swT.targetId });
    await delay(300);
    prev = m.main?.timeOrigin;
    await page.goto(`${server.origin}/head`);
    m = await waitMarks(page, prev);
    evidence('S2b scripts after SW stop', summarize(m));
  } finally {
    await context.close();
    await server.close();
    rmSync(downloadDir, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
