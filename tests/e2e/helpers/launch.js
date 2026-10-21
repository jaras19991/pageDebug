// E2E harness (E0-T16b): Chromium with the built extension, the real popup opened with
// activeTab through CDP (design D10 path (a), recipe in docs/epics/E0/spike-T17.md) and
// a download helper. The popup is not a Playwright Page, so it is driven over a
// non-flatten CDP session (Target.sendMessageToTarget + Runtime.evaluate).
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Output of `npm run build` for Chrome; e2e never loads the sources (AC-3.3). */
export const DIST_CHROME = resolve(ROOT, 'dist/chrome');

const POPUP_TIMEOUT = 5_000;
const POLL_MS = 50;

// context -> { extensionId, browserCdp }, so openPopupFor(page) needs only the page.
const harnesses = new WeakMap();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function readExtensionInfo(context, distDir) {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions');
    const infos = await page.evaluate(() => globalThis.chrome.developerPrivate.getExtensionsInfo());
    const info = infos.find((i) => resolve(i.path ?? '') === distDir);
    if (!info) throw new Error(`Extension from ${distDir} is not loaded`);
    return { id: info.id, name: info.name, version: info.version, path: info.path };
  } finally {
    await page.close();
  }
}

/**
 * Starts Chromium with only the given unpacked extension. Downloads stay in Playwright's
 * temp dir (no downloadsPath), never in the user's Downloads folder (AC-3.4).
 * @param {{ distDir?: string, headless?: boolean }} [options]
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, extensionId: string,
 *   extensionInfo: { id: string, name: string, version: string, path: string },
 *   browserCdp: import('@playwright/test').CDPSession, close: () => Promise<void> }>}
 */
export async function launchWithExtension({
  distDir = DIST_CHROME,
  headless = process.env.PDS_E2E_HEADED !== '1',
} = {}) {
  distDir = resolve(distDir);
  // channel 'chromium' runs the full browser in new headless mode (extensions need it).
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      // Exposes the CDP Extensions domain (Extensions.triggerAction).
      '--enable-unsafe-extension-debugging',
    ],
  });
  try {
    const extensionInfo = await readExtensionInfo(context, distDir);
    const browserCdp = await context.browser().newBrowserCDPSession();
    harnesses.set(context, { extensionId: extensionInfo.id, browserCdp });
    return {
      context,
      extensionId: extensionInfo.id,
      extensionInfo,
      browserCdp,
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
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

function toMatcher(predicate) {
  if (typeof predicate === 'function') return predicate;
  if (predicate instanceof RegExp) return (text) => predicate.test(text);
  return (text) => text.includes(String(predicate));
}

/**
 * Opens the extension popup for `page` like a user clicking the toolbar icon, so the popup
 * gets activeTab for this tab. activeTab is lost on navigation: call again after goto.
 * @param {import('@playwright/test').Page} page a page from launchWithExtension().context
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ url: string, targetId: string, evaluate: (expression: string) => Promise<any>,
 *   click: (selector: string) => Promise<void>, textOf: (selector: string) => Promise<string>,
 *   waitForText: (selector: string, predicate: string | RegExp | ((text: string) => boolean), timeout?: number) => Promise<string>,
 *   close: () => Promise<void> }>}
 */
export async function openPopupFor(page, { timeout = POPUP_TIMEOUT } = {}) {
  const harness = harnesses.get(page.context());
  if (!harness) throw new Error('openPopupFor: page does not come from launchWithExtension()');
  const { extensionId, browserCdp: cdp } = harness;
  await page.bringToFront();
  const tabTargetId = await findTabTarget(cdp, page);
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const before = new Set((await cdp.send('Target.getTargets')).targetInfos.map((t) => t.targetId));

  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tabTargetId });
  const target = await waitForPopupTarget(cdp, popupUrl, before, timeout);

  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const client = createSessionClient(cdp, sessionId);

  async function evaluate(expression) {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(`Popup evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value;
  }

  // Module scripts run before DOMContentLoaded, so 'complete' means popup.js is wired up.
  const deadline = Date.now() + timeout;
  while ((await evaluate('document.readyState')) !== 'complete') {
    if (Date.now() > deadline) throw new Error('Popup did not finish loading');
    await delay(POLL_MS);
  }

  const popup = {
    url: target.url,
    targetId: target.targetId,
    evaluate,
    async click(selector) {
      const found = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
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
    async close() {
      client.dispose();
      await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
    },
  };
  return popup;
}

/**
 * Runs `action` and returns the download it starts on `page`. The file lives in Playwright's
 * temp dir and is deleted when the context closes.
 * @param {import('@playwright/test').Page} page the tab that saves the file
 * @param {() => Promise<unknown>} action
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ suggestedFilename: string, path: string }>}
 */
export async function expectDownload(page, action, { timeout = 10_000 } = {}) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const failure = await download.failure();
  if (failure) throw new Error(`Download failed: ${failure}`);
  return { suggestedFilename: download.suggestedFilename(), path: await download.path() };
}
