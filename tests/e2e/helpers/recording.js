// Recording flow for e2e (E1-T18): Nagrywaj and Zapisz paczkę through the real popup, as the
// reporter does it. Popup ids from src/popup/popup.html, texts from src/popup/messages.js.
import { assertValidSnapshot, validateZipEntries } from '../../helpers/snapshot-validator.js';
import { readZipPackage } from './download.js';
import { harnessOf, openPopupFor, waitForDownloadFile } from './launch.js';

const STEP_TIMEOUT = 10_000;
// The popup controller gives up on a lost `collect` after 15 s and shows `pageBusy`; waiting
// longer makes a lost answer surface as that message and not as "no save result" (F-e1-2).
const SAVE_RESULT_TIMEOUT = 16_000;
/** storage.session key read by the background instead of the 10-minute limit (E1-T12). */
export const TEST_LIMIT_KEY = 'pds:test:recordingLimitMs';

// Two saves within one second get the same name and Chrome uniquifies it to `… (1).zip`, so the name may have a space.
// "Plik: <name>" on the saved screen (E4 D7); the name may contain a space (`… (1).zip`).
const SAVED_FILE_RE = /^Plik: (.+)$/;
const RECORDING_RE = /^Nagrywam od \d{2}:\d{2}:\d{2}$/;

export const SCREENSHOT_DECIDED = `document.getElementById('includeScreenshot').checked || document.getElementById('screenshotNote').textContent !== ''`;

const STATE_EXPRESSION = `(() => {
  const byId = (id) => document.getElementById(id);
  const section = !byId('ready').hidden ? 'ready' : !byId('recording').hidden ? 'recording' : !byId('saved').hidden ? 'saved' : null;
  return {
    section,
    since: byId('since').textContent,
    note: byId('note').textContent,
    status: byId('status').textContent,
    savedFile: byId('savedFile').textContent,
    savedShot: byId('savedShot').textContent,
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

const SAVE_OUTCOME_EXPRESSION = `(() => {
  const byId = (id) => document.getElementById(id);
  if (!byId('saved').hidden) return { savedFile: byId('savedFile').textContent, savedShot: byId('savedShot').textContent };
  const s = byId('status');
  if (s.classList.contains('error') && s.textContent) return { error: s.textContent };
  return null;
})()`;

/**
 * Save verdict of the popup (E4 TEST0): the saved screen (`#savedFile`, plus the `#savedShot` sentence) or an error status.
 * Waits up to `timeout` for either.
 * @param {{ evaluate: Function }} popup
 * @param {number} [timeout]
 * @returns {Promise<{ fileName: string, savedShot: string } | { error: string }>}
 */
export async function readSaveOutcome(popup, timeout = SAVE_RESULT_TIMEOUT) {
  const end = Date.now() + timeout;
  for (;;) {
    const r = await popup.evaluate(SAVE_OUTCOME_EXPRESSION);
    if (r?.error) return { error: r.error };
    if (r?.savedFile) {
      const m = SAVED_FILE_RE.exec(r.savedFile);
      if (!m) return { error: `Unexpected saved file text: ${r.savedFile}` };
      return { fileName: m[1], savedShot: r.savedShot };
    }
    if (Date.now() > end) throw new Error(`Popup: no save result within ${timeout} ms`);
    await new Promise((res) => setTimeout(res, 50));
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
 * @returns {Promise<{ section: 'ready' | 'recording' | 'saved' | null, since: string, note: string, status: string,
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
    // After a save the popup shows the saved screen (E4 D7); "Nowe nagranie" leads back to the ready screen.
    const first = await readState(popup, timeout);
    if (first.section === 'saved') await popup.click('#newRecording');
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
 * Clicks "Zapisz paczkę" for `page`, waits for the saved screen and unzips that file from the
 * harness download dir in memory (v4 zip, E3-TEST0). Every save is checked against schema v4
 * (`validate: false` skips it, for tests that look at a broken package on purpose).
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number, resultTimeout?: number, validate?: boolean }} [options]
 * @returns {Promise<{ fileName: string, path: string, entries: string[], json: any, summary: string,
 *   files: Record<string, Uint8Array>, statusText: string (the savedShot sentence, '' when the file has the screenshot), savedAfterMs: number }>}
 *   json: parsed snapshot.json; summary: summary.md text; files: raw bytes of every entry.
 *   savedAfterMs: click on "Zapisz paczkę" → saved screen visible (popup polled every 50 ms).
 */
export async function saveRecording(
  page,
  { timeout = STEP_TIMEOUT, resultTimeout = SAVE_RESULT_TIMEOUT, validate = true, awaitFrameCheck = true, forceScreenshot = false } = {},
) {
  const popup = await openPopupFor(page);
  let statusText;
  let fileName;
  let clickedAt;
  let savedAfterMs;
  try {
    await waitForState(popup, (s) => s.section === 'recording' && s.saveEnabled, '"Zapisz paczkę" button', timeout);
    // Review N6 (fail-closed): until frameCheck answers the screenshot switch is OFF with an empty note; an early click saves
    // without the screenshot. Wait for the verdict: switch on (0 frames) or a note (frames / check failed).
    if (awaitFrameCheck) await popup.waitFor(SCREENSHOT_DECIDED, 10_000);
    // forceScreenshot: the reporter switches it on after a failed check / frames note (the tab is off the recorded origin etc.).
    if (forceScreenshot && !(await popup.evaluate(`document.getElementById('includeScreenshot').checked`))) await popup.click('#includeScreenshot');
    clickedAt = Date.now();
    await popup.click('#save');
    const outcome = await readSaveOutcome(popup, resultTimeout);
    if ('error' in outcome) throw new Error(`Save failed: ${outcome.error}`);
    savedAfterMs = Date.now() - clickedAt;
    fileName = outcome.fileName;
    statusText = outcome.savedShot;
  } finally {
    await popup.close();
  }
  const { path } = await waitForDownloadFile(page, { fileName, timeout });
  const pkg = await readZipPackage(path);
  if (validate) {
    assertValidSnapshot(pkg.json, { expectRulesVersion: 2 });
    const zip = validateZipEntries(pkg.entries, pkg.json);
    if (!zip.ok) throw new Error(`Zip entries of ${fileName}:\n${zip.errors.join('\n')}`);
  }
  return { fileName, path, ...pkg, statusText, savedAfterMs };
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
