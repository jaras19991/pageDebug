// Spike E0-T17: can Playwright trigger the extension action so the popup gets activeTab?
// Usage: node tests/e2e/spike/run.spike.mjs [--headed]
// Not a test file on purpose (no *.spec/*.test suffix) — prints facts for docs/epics/E0/spike-T17.md.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ext');
const HEADED = process.argv.includes('--headed');
const log = (...a) => console.log('[spike]', ...a);

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Fixture T17 ${req.url}</title><p>fixture</p>`);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function launch(extDir) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !HEADED,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--enable-unsafe-extension-debugging'],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10000 });
  return { context, sw, extensionId: sw.url().split('/')[2] };
}

async function idViaDeveloperPrivate(context) {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  const infos = await page.evaluate(() => chrome.developerPrivate.getExtensionsInfo());
  await page.close();
  return infos.filter((i) => i.name === 'PDS Spike T17').map((i) => i.id);
}

async function waitResult(sw, before, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await sw.evaluate(() => globalThis.spikeResults);
    if (r.length > before) return r[r.length - 1];
    await new Promise((x) => setTimeout(x, 100));
  }
  return 'no popup result within ' + ms + 'ms';
}
const count = (sw) => sw.evaluate(() => globalThis.spikeResults.length);

async function freshFixture(context, base, name) {
  const page = await context.newPage();
  await page.goto(`${base}/${name}`);
  await page.bringToFront();
  return page;
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  log('mode', HEADED ? 'headed' : 'headless (new, channel chromium)');
  const { context, sw, extensionId } = await launch(EXT);
  const browser = context.browser();
  log('browser version', browser && browser.version());
  log('id from SW url', extensionId);
  try { log('id via developerPrivate', JSON.stringify(await idViaDeveloperPrivate(context))); }
  catch (e) { log('developerPrivate FAILED', e.message); }

  // (a) probe the Extensions CDP domain on a browser-level session
  const cdp = await browser.newBrowserCDPSession();
  for (const m of ['Extensions.triggerAction', 'Extensions.loadUnpacked', 'Extensions.uninstall',
    'Extensions.getStorageItems', 'Extensions.openPopup', 'Extensions.getExtensions']) {
    try { await cdp.send(m, {}); log('probe', m, '-> ok with {}'); }
    catch (e) { log('probe', m, '->', e.message.split('\n')[0]); }
  }

  // negative control: popup as a tab with ?tabId=, no host permission -> must fail
  {
    const fx = await freshFixture(context, base, 'control');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
    const n = await count(sw);
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
    log('control popup-as-tab ?tabId (no host perm):', JSON.stringify(await waitResult(sw, n)));
    await p.close(); await fx.close();
  }

  // (b) Extensions.triggerAction on a fresh fixture tab
  {
    const fx = await freshFixture(context, base, 'trigger');
    // triggerAction wants a *tab* target (not the page target); getTargets hides tabs unless filtered in.
    const all = (await cdp.send('Target.getTargets', { filter: [{}] })).targetInfos;
    const tabT = all.find((t) => t.type === 'tab' && t.url === fx.url());
    log('tab target for fixture:', JSON.stringify(tabT && [tabT.type, tabT.url]));
    const targetInfo = tabT;
    const n = await count(sw);
    const pagesBefore = context.pages().length;
    try {
      const r = await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfo.targetId });
      log('triggerAction returned', JSON.stringify(r));
    } catch (e) { log('triggerAction FAILED', e.message.split('\n')[0]); }
    log('triggerAction popup result:', JSON.stringify(await waitResult(sw, n)));
    const popupPage = context.pages().find((p) => p.url().includes('popup.html'));
    log('popup visible as Playwright page:', !!popupPage, popupPage?.url() ?? '', 'pages', pagesBefore, '->', context.pages().length);
    const targets = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.url.includes(extensionId));
    log('extension targets:', JSON.stringify(targets.map((t) => [t.type, t.url])));
    // Can the test drive the popup? Attach (non-flatten) and evaluate inside it.
    const popupT = targets.find((t) => t.url.includes('popup.html'));
    if (popupT) {
      try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popupT.targetId, flatten: false });
        const reply = new Promise((r) => cdp.on('Target.receivedMessageFromTarget', (e) => {
          const m = JSON.parse(e.message); if (m.id === 1) r(m);
        }));
        await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({
          id: 1, method: 'Runtime.evaluate', params: { expression: 'document.getElementById("out").textContent' } }) });
        log('popup driven via CDP attach (non-flatten):', JSON.stringify((await reply).result?.result?.value));
      } catch (e) { log('popup attach FAILED', e.message.split('\n')[0]); }
      await cdp.send('Target.closeTarget', { targetId: popupT.targetId }).catch(() => {});
    }
    if (popupPage) await popupPage.close().catch(() => {});
    await fx.close();
  }

  // (c1) chrome.action.openPopup() from the service worker
  {
    const fx = await freshFixture(context, base, 'openpopup');
    const n = await count(sw);
    const r = await sw.evaluate(() => chrome.action.openPopup().then(() => 'resolved', (e) => 'rejected: ' + e.message));
    log('openPopup from SW:', r);
    log('openPopup popup result:', JSON.stringify(await waitResult(sw, n)));
    await fx.close();
  }

  // (c2) _execute_action shortcut via CDP Input.dispatchKeyEvent (page.keyboard)
  {
    const fx = await freshFixture(context, base, 'shortcut');
    const n = await count(sw);
    await fx.keyboard.press('Alt+Shift+Y');
    log('shortcut popup result:', JSON.stringify(await waitResult(sw, n, 3000)));
    await fx.close();
  }
  await context.close();

  // (d) fallback: copy with host_permissions for 127.0.0.1 + popup as tab with ?tabId=
  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pds-spike-'));
    await fs.cp(EXT, dir, { recursive: true });
    const mf = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    mf.host_permissions = ['http://127.0.0.1/*'];
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2));
    const l = await launch(dir);
    const fx = await freshFixture(l.context, base, 'fallback');
    const tabId = await l.sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${base}/fallback`);
    const n = await count(l.sw);
    const p = await l.context.newPage();
    await p.goto(`chrome-extension://${l.extensionId}/popup.html?tabId=${tabId}`);
    log('fallback (d) popup-as-tab ?tabId + host_permissions:', JSON.stringify(await waitResult(l.sw, n)));
    await l.context.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
