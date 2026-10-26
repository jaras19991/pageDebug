// E2E harness (E0-T16b, extended in E1-T18): Chromium with the built extension, the real popup
// opened with activeTab through CDP (design D10, recipe in docs/epics/E0/spike-T17.md), the
// background service worker, origin grants and downloads into a temp dir (D11 as corrected by
// docs/epics/E1/spike-T0.md). The popup is not a Playwright Page, so it is driven over a
// non-flatten CDP session (Target.sendMessageToTarget + Runtime.evaluate).
import { chromium } from '@playwright/test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Output of `npm run build` for Chrome; e2e never loads the sources (AC-3.3). */
export const DIST_CHROME = resolve(ROOT, 'dist/chrome');

const POPUP_TIMEOUT = 5_000;
const POPUP_CLOSE_TIMEOUT = 2_000;
const SW_TIMEOUT = 5_000;
const DOWNLOAD_TIMEOUT = 10_000;
const POLL_MS = 50;

// context -> harness (see launchWithExtension), so page-based helpers need only the page.
const harnesses = new WeakMap();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The harness of a page or of the object returned by launchWithExtension().
 * @param {import('@playwright/test').Page | { context: import('@playwright/test').BrowserContext }} pageOrExt
 */
export function harnessOf(pageOrExt) {
  const context = typeof pageOrExt?.context === 'function' ? pageOrExt.context() : pageOrExt?.context;
  const harness = context && harnesses.get(context);
  if (!harness) throw new Error('Page or context does not come from launchWithExtension()');
  return harness;
}

async function withExtensionsPage(context, fn) {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions');
    return await fn(page);
  } finally {
    await page.close();
  }
}

function readExtensionInfo(context, distDir) {
  return withExtensionsPage(context, async (page) => {
    const infos = await page.evaluate(() => globalThis.chrome.developerPrivate.getExtensionsInfo());
    const info = infos.find((i) => resolve(i.path ?? '') === distDir);
    if (!info) throw new Error(`Extension from ${distDir} is not loaded`);
    return { id: info.id, name: info.name, version: info.version, path: info.path };
  });
}

// Chrome's own download directory for a fresh profile. With Browser.setDownloadBehavior 'allow'
// Chrome ignores downloads.download({ filename }) and saves `<blob uuid>.json` (spike T0, S7),
// so downloads stay in Chrome's hands ('default') and land in this directory instead.
async function writeProfilePreferences(profileDir, downloadDir) {
  await mkdir(join(profileDir, 'Default'), { recursive: true });
  const prefs = { download: { default_directory: downloadDir, prompt_for_download: false, directory_upgrade: true } };
  await writeFile(join(profileDir, 'Default', 'Preferences'), JSON.stringify(prefs));
}

// Overrides Playwright's per-context download behaviour, globally and for the page context.
async function useChromeDownloads(cdp) {
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const { targetInfos } = await cdp.send('Target.getTargets');
  const contextIds = new Set(targetInfos.map((t) => t.browserContextId).filter(Boolean));
  for (const browserContextId of contextIds) {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', browserContextId });
  }
}

/**
 * Starts Chromium with only the given unpacked extension, in a throwaway profile. Downloads go
 * to `downloadDir` (a temp dir by default), never to the user's Downloads folder (AC-3.4).
 * @param {{ distDir?: string, headless?: boolean, downloadDir?: string, args?: string[], viewport?: null }} [options]
 *   downloadDir: an existing directory owned by the caller; by default one is created and
 *   removed by close(). args: extra Chromium switches; viewport: null turns off Playwright's emulated viewport
 *   (E3-TEST4: a real DPR 2 needs `args: ['--force-device-scale-factor=2']` and `viewport: null`).
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, extensionId: string,
 *   extensionInfo: { id: string, name: string, version: string, path: string },
 *   browserCdp: import('@playwright/test').CDPSession, downloadDir: string,
 *   serviceWorker: (options?: { timeout?: number }) => Promise<import('@playwright/test').Worker>,
 *   stopServiceWorker: (options?: { timeout?: number }) => Promise<void>,
 *   grantOrigin: (pattern: string) => Promise<void>,
 *   sessionStorage: { get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void> },
 *   close: () => Promise<void> }>}
 */
export async function launchWithExtension({
  distDir = DIST_CHROME,
  headless = process.env.PDS_E2E_HEADED !== '1',
  downloadDir,
  args = [],
  viewport,
} = {}) {
  distDir = resolve(distDir);
  const tempRoot = await mkdtemp(join(tmpdir(), 'pds-e2e-'));
  const profileDir = join(tempRoot, 'profile');
  downloadDir = downloadDir ? resolve(downloadDir) : join(tempRoot, 'downloads');
  await mkdir(downloadDir, { recursive: true });
  await writeProfilePreferences(profileDir, downloadDir);

  let context;
  const cleanup = async () => {
    await context?.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    // channel 'chromium' runs the full browser in new headless mode (extensions need it).
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless,
      acceptDownloads: true,
      ...(viewport === null ? { viewport: null } : {}),
      args: [
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
        // Exposes the CDP Extensions domain (Extensions.triggerAction).
        '--enable-unsafe-extension-debugging',
        ...args,
      ],
    });
    const extensionInfo = await readExtensionInfo(context, distDir);
    const browserCdp = await context.browser().newBrowserCDPSession();
    await useChromeDownloads(browserCdp);
    const ext = createHarness({ context, extensionInfo, browserCdp, downloadDir, close: cleanup });
    harnesses.set(context, ext);
    return ext;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function createHarness({ context, extensionInfo, browserCdp: cdp, downloadDir, close }) {
  const extensionId = extensionInfo.id;
  const swUrlPrefix = `chrome-extension://${extensionId}/`;
  // Worker handles of the background. Playwright reports neither 'close' for a worker stopped
  // with Target.closeTarget (spike T0, S2) nor a new 'serviceworker' when it starts again: the
  // old handle reattaches to the restarted worker (same version target), so it is reused.
  const workers = context.serviceWorkers().filter((w) => w.url().startsWith(swUrlPrefix));
  context.on('serviceworker', (w) => {
    if (w.url().startsWith(swUrlPrefix)) workers.push(w);
  });

  async function swTargets() {
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith(swUrlPrefix));
  }

  // Any event wakes a stopped worker; a message from an extension page is the simplest one.
  // The router ignores unknown types, so sendMessage rejects (no receiver) — that is expected.
  async function wakeServiceWorker() {
    const page = await context.newPage();
    try {
      await page.goto(`${swUrlPrefix}manifest.json`);
      await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'pds:e2e:wake' }).catch(() => {}));
    } finally {
      await page.close();
    }
  }

  async function serviceWorker({ timeout = SW_TIMEOUT } = {}) {
    const deadline = Date.now() + timeout;
    if ((await swTargets()).length === 0) await wakeServiceWorker();
    while (workers.length === 0 || (await swTargets()).length === 0) {
      if (Date.now() > deadline) throw new Error(`Service worker of ${extensionId} did not start within ${timeout} ms`);
      await delay(POLL_MS);
    }
    return workers[workers.length - 1];
  }

  async function stopServiceWorker({ timeout = SW_TIMEOUT } = {}) {
    for (const target of await swTargets()) {
      await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
    }
    const deadline = Date.now() + timeout;
    while ((await swTargets()).length > 0) {
      if (Date.now() > deadline) throw new Error(`Service worker of ${extensionId} did not stop within ${timeout} ms`);
      await delay(POLL_MS);
    }
  }

  // developerPrivate.addHostPermission alone does not grant (permissions.contains stays false),
  // but the next permissions.request from a popup click with a user gesture resolves true
  // without a prompt (spike T0, S3/S4). So this prepares the grant made by "Nagrywaj".
  function grantOrigin(pattern) {
    return withExtensionsPage(context, (page) =>
      page.evaluate(
        ([id, host]) => globalThis.chrome.developerPrivate.addHostPermission(id, host),
        [extensionId, pattern],
      ),
    );
  }

  const sessionStorage = {
    async get(key) {
      const sw = await serviceWorker();
      return sw.evaluate(async (k) => (await globalThis.chrome.storage.session.get(k))[k], key);
    },
    /** `undefined` removes the key. */
    async set(key, value) {
      const sw = await serviceWorker();
      await sw.evaluate(
        ([k, v]) => (v === undefined ? globalThis.chrome.storage.session.remove(k) : globalThis.chrome.storage.session.set({ [k]: v })),
        [key, value],
      );
    },
  };

  return {
    context,
    extensionId,
    extensionInfo,
    browserCdp: cdp,
    downloadDir,
    serviceWorker,
    stopServiceWorker,
    grantOrigin,
    sessionStorage,
    close,
  };
}

async function findTabTarget(cdp, page) {
  // Target.getTargets hides `tab` targets unless filtered in. A tab target has no link to its
  // page target, so match by URL among active tabs (page was just brought to front).
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
  const tabs = targetInfos.filter(
    (t) => t.type === 'tab' && t.url === page.url() && t.embedderData?.tabActive,
  );
  if (tabs.length !== 1) {
    throw new Error(`Expected one active tab target for ${page.url()}, found ${tabs.length}`);
  }
  return tabs[0].targetId;
}

async function waitForPopupTarget(cdp, popupUrl, knownIds, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const popup = targetInfos.find(
      (t) => t.type === 'page' && t.url === popupUrl && !knownIds.has(t.targetId),
    );
    if (popup) return popup;
    await delay(POLL_MS);
  }
  throw new Error(`Popup ${popupUrl} did not open within ${timeout} ms`);
}

// Minimal CDP client for one non-flatten session on the browser-level CDP session.
function createSessionClient(cdp, sessionId) {
  let nextId = 1;
  const pending = new Map();
  const onMessage = (event) => {
    if (event.sessionId !== sessionId) return;
    const msg = JSON.parse(event.message);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(`${waiter.method}: ${msg.error.message}`));
    else waiter.resolve(msg.result);
  };
  const onDetached = (event) => {
    if (event.sessionId !== sessionId) return;
    for (const waiter of pending.values()) waiter.reject(new Error('Popup closed'));
    pending.clear();
  };
  cdp.on('Target.receivedMessageFromTarget', onMessage);
  cdp.on('Target.detachedFromTarget', onDetached);
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { method, resolve: resolveSend, reject: rejectSend });
        cdp
          .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
          .catch((error) => {
            pending.delete(id);
            rejectSend(error);
          });
      });
    },
    dispose() {
      cdp.off('Target.receivedMessageFromTarget', onMessage);
      cdp.off('Target.detachedFromTarget', onDetached);
    },
  };
}

const POPUP_LOADED = `location.pathname.endsWith('/popup/popup.html') && document.readyState === 'complete'
  && !!(document.getElementById('ready') || document.getElementById('recording') || document.getElementById('status'))`;

function toMatcher(predicate) {
  if (typeof predicate === 'function') return predicate;
  if (predicate instanceof RegExp) return (text) => predicate.test(text);
  return (text) => text.includes(String(predicate));
}

/**
 * Opens the extension popup for `page` like a user clicking the toolbar icon, so the popup
 * gets activeTab for this tab. Only one popup is open at a time: opening another closes it.
 * @param {import('@playwright/test').Page} page a page from launchWithExtension().context
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ url: string, targetId: string,
 *   evaluate: (expression: string, options?: { userGesture?: boolean }) => Promise<any>,
 *   click: (selector: string) => Promise<void>, textOf: (selector: string) => Promise<string>,
 *   waitForText: (selector: string, predicate: string | RegExp | ((text: string) => boolean), timeout?: number) => Promise<string>,
 *   waitFor: (expression: string, timeout?: number) => Promise<any>,
 *   close: () => Promise<void> }>}
 */
export async function openPopupFor(page, { timeout = POPUP_TIMEOUT } = {}) {
  const { extensionId, browserCdp: cdp } = harnessOf(page);
  await page.bringToFront();
  const tabTargetId = await findTabTarget(cdp, page);
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const before = new Set((await cdp.send('Target.getTargets')).targetInfos.map((t) => t.targetId));

  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTargetId });
  const target = await waitForPopupTarget(cdp, popupUrl, before, timeout);

  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const client = createSessionClient(cdp, sessionId);

  async function evaluate(expression, { userGesture = false } = {}) {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (exceptionDetails) {
      throw new Error(`Popup evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value;
  }

  // Module scripts run before DOMContentLoaded, so 'complete' means popup.js is wired up. The
  // session may first see the initial about:blank document, so wait for popup.html itself.
  const deadline = Date.now() + timeout;
  for (;;) {
    const loaded = await evaluate(POPUP_LOADED).catch(() => false);
    if (loaded) break;
    if (Date.now() > deadline) throw new Error('Popup did not finish loading');
    await delay(POLL_MS);
  }

  const popup = {
    url: target.url,
    targetId: target.targetId,
    evaluate,
    // A user gesture, as a real click: permissions.request rejects without one (spike T0, S4).
    async click(selector) {
      const found = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
        { userGesture: true },
      );
      if (!found) throw new Error(`Popup: no element ${selector}`);
    },
    async textOf(selector) {
      const text = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`,
      );
      if (text === null) throw new Error(`Popup: no element ${selector}`);
      return text;
    },
    async waitForText(selector, predicate, waitTimeout = POPUP_TIMEOUT) {
      const matches = toMatcher(predicate);
      const end = Date.now() + waitTimeout;
      for (;;) {
        const text = await popup.textOf(selector);
        if (matches(text)) return text;
        if (Date.now() > end) {
          throw new Error(`Popup: ${selector} text did not match within ${waitTimeout} ms, last: ${JSON.stringify(text)}`);
        }
        await delay(POLL_MS);
      }
    },
    /** Polls a popup expression until it is truthy and returns its value. */
    async waitFor(expression, waitTimeout = POPUP_TIMEOUT) {
      const end = Date.now() + waitTimeout;
      for (;;) {
        const value = await evaluate(expression);
        if (value) return value;
        if (Date.now() > end) throw new Error(`Popup: ${expression} stayed falsy for ${waitTimeout} ms`);
        await delay(POLL_MS);
      }
    },
    // Returns once the target is gone: a popup opened while this one is still closing may be
    // left unanswered or evaluated in the wrong document.
    async close() {
      client.dispose();
      await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
      const end = Date.now() + POPUP_CLOSE_TIMEOUT;
      while ((await cdp.send('Target.getTargets')).targetInfos.some((t) => t.targetId === target.targetId)) {
        if (Date.now() > end) throw new Error(`Popup ${target.targetId} did not close within ${POPUP_CLOSE_TIMEOUT} ms`);
        await delay(POLL_MS);
      }
    },
  };
  return popup;
}

// Finished downloads only: Chrome writes `<name>.crdownload` / `Unconfirmed <n>.crdownload`
// and renames the file when the download completes.
async function finishedFiles(dir) {
  const names = await readdir(dir);
  return names.filter((n) => !n.endsWith('.crdownload') && !n.startsWith('Unconfirmed '));
}

/**
 * Names of files in the harness download dir: finished ones, or all with `includePartial`.
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @param {{ includePartial?: boolean }} [options]
 */
export function listDownloads(pageOrExt, { includePartial = false } = {}) {
  const { downloadDir } = harnessOf(pageOrExt);
  return includePartial ? readdir(downloadDir) : finishedFiles(downloadDir);
}

/**
 * Waits until the finished file `fileName` (or, without a name, any file not in `known`)
 * appears in the harness download dir.
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @param {{ fileName?: string, known?: Iterable<string>, timeout?: number }} [options]
 * @returns {Promise<{ suggestedFilename: string, path: string }>}
 */
export async function waitForDownloadFile(pageOrExt, { fileName, known = [], timeout = DOWNLOAD_TIMEOUT } = {}) {
  const { downloadDir } = harnessOf(pageOrExt);
  const skip = new Set(known);
  const deadline = Date.now() + timeout;
  for (;;) {
    const files = await finishedFiles(downloadDir);
    const found = fileName ? files.find((n) => n === fileName) : files.find((n) => !skip.has(n));
    if (found) return { suggestedFilename: found, path: join(downloadDir, found) };
    if (Date.now() > deadline) {
      throw new Error(`No ${fileName ?? 'new file'} in ${downloadDir} within ${timeout} ms (have: ${files.join(', ') || 'none'})`);
    }
    await delay(POLL_MS);
  }
}

/**
 * Runs `action` and returns the first new file it saves into the harness download dir.
 * The popup starts the download, so Playwright's `download` event never fires (spike T0, S7).
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @param {() => Promise<unknown>} action
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ suggestedFilename: string, path: string }>}
 */
export async function expectDownload(pageOrExt, action, { timeout = DOWNLOAD_TIMEOUT } = {}) {
  const known = await listDownloads(pageOrExt);
  await action();
  return waitForDownloadFile(pageOrExt, { known, timeout });
}
