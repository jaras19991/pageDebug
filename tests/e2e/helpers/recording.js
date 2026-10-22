// Recording flow for e2e (E1-T18): Nagrywaj and Zapisz paczkę through the real popup, as the
// reporter does it. Popup ids from src/popup/popup.html, texts from src/popup/messages.js.
import { readFile } from 'node:fs/promises';
import { harnessOf, openPopupFor, waitForDownloadFile } from './launch.js';

const STEP_TIMEOUT = 10_000;
// The popup controller gives up on a lost `collect` after 15 s and shows `pageBusy`; waiting
// longer makes a lost answer surface as that message and not as "no save result" (F-e1-2).
const SAVE_RESULT_TIMEOUT = 16_000;
/** storage.session key read by the background instead of the 10-minute limit (E1-T12). */
export const TEST_LIMIT_KEY = 'pds:test:recordingLimitMs';

const SAVED_RE = /^Zapisano plik (\S+) — /;
const RECORDING_RE = /^Nagrywam od \d{2}:\d{2}:\d{2}$/;

const STATE_EXPRESSION = `(() => {
  const byId = (id) => document.getElementById(id);
  const section = !byId('ready').hidden ? 'ready' : !byId('recording').hidden ? 'recording' : null;
  return {
    section,
    since: byId('since').textContent,
    note: byId('note').textContent,
    status: byId('status').textContent,
    statusIsError: byId('status').classList.contains('error'),
    recordEnabled: !byId('record').disabled,
    saveEnabled: !byId('save').disabled,
  };
})()`;

// popup.js renders after an async getStatus, so wait for a section or a status text.
async function readState(popup, timeout = STEP_TIMEOUT) {
  const end = Date.now() + timeout;
  for (;;) {
    const state = await popup.evaluate(STATE_EXPRESSION);
    if (state.section || state.status || Date.now() > end) return state;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function waitForState(popup, matches, what, timeout = STEP_TIMEOUT) {
  const end = Date.now() + timeout;
  let state;
  for (;;) {
    state = await popup.evaluate(STATE_EXPRESSION);
    if (matches(state)) return state;
    if (Date.now() > end) throw new Error(`Popup: no ${what} within ${timeout} ms, last: ${JSON.stringify(state)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** `http://127.0.0.1/*` for http://127.0.0.1:1234/x — the shape the popup asks for. */
export function originPatternOf(url) {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

/**
 * Popup state for `page`: opens the popup, reads it and closes it.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ section: 'ready' | 'recording' | null, since: string, note: string, status: string,
 *   statusIsError: boolean, recordEnabled: boolean, saveEnabled: boolean }>}
 */
export async function popupState(page) {
  const popup = await openPopupFor(page);
  try {
    return await readState(popup);
  } finally {
    await popup.close();
  }
}

/**
 * Clicks "Nagrywaj" for `page` and waits for the tab reload and "Nagrywam od HH:MM:SS".
 * With `grant` the origin is pre-approved, so permissions.request resolves without a prompt.
 * @param {import('@playwright/test').Page} page
 * @param {{ grant?: boolean, timeout?: number }} [options]
 * @returns {Promise<{ since: string, clickedAt: number, reloadedAt: number }>}
 */
export async function startRecording(page, { grant = true, timeout = STEP_TIMEOUT } = {}) {
  const ext = harnessOf(page);
  if (grant) await ext.grantOrigin(originPatternOf(page.url()));
  const popup = await openPopupFor(page);
  try {
    await waitForState(popup, (s) => s.section === 'ready' && s.recordEnabled, '"Nagrywaj" button', timeout);
    const reloaded = page.waitForEvent('load', { timeout });
    const clickedAt = Date.now();
    await popup.click('#record');
    await reloaded;
    const reloadedAt = Date.now();
    const state = await waitForState(
      popup,
      (s) => s.section === 'recording' && RECORDING_RE.test(s.since),
      '"Nagrywam od"',
      timeout,
    );
    return { since: state.since, clickedAt, reloadedAt };
  } finally {
    await popup.close();
  }
}

/**
 * Clicks "Zapisz paczkę" for `page`, waits for "Zapisano plik …" and reads that file from the
 * harness download dir.
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ fileName: string, path: string, json: any, statusText: string, savedAfterMs: number }>}
 *   savedAfterMs: click on "Zapisz paczkę" → "Zapisano plik …" visible (popup polled every 50 ms).
 */
export async function saveRecording(page, { timeout = STEP_TIMEOUT, resultTimeout = SAVE_RESULT_TIMEOUT } = {}) {
  const popup = await openPopupFor(page);
  let statusText;
  let clickedAt;
  let savedAfterMs;
  try {
    await waitForState(popup, (s) => s.section === 'recording' && s.saveEnabled, '"Zapisz paczkę" button', timeout);
    clickedAt = Date.now();
    await popup.click('#save');
    const state = await waitForState(
      popup,
      (s) => SAVED_RE.test(s.status) || (s.statusIsError && s.status),
      'save result',
      resultTimeout,
    );
    if (!SAVED_RE.test(state.status)) throw new Error(`Save failed: ${state.status}`);
    savedAfterMs = Date.now() - clickedAt;
    statusText = state.status;
  } finally {
    await popup.close();
  }
  const fileName = SAVED_RE.exec(statusText)[1];
  const { path } = await waitForDownloadFile(page, { fileName, timeout });
  return { fileName, path, json: JSON.parse(await readFile(path, 'utf8')), statusText, savedAfterMs };
}

/**
 * Sets the recording limit used by the background (E1-T12); `null` restores the 10 minutes.
 * The background clamps it to [1000, 600000] ms.
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @param {number | null} ms
 */
export function setRecordingLimit(pageOrExt, ms) {
  return harnessOf(pageOrExt).sessionStorage.set(TEST_LIMIT_KEY, ms ?? undefined);
}
