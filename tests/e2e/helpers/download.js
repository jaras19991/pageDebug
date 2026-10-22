// Download helpers for e2e (E0-T7a, E1-T18). Downloads land in the harness download dir
// (launchWithExtension), not in Playwright's `download` event: the popup starts them (spike T0, S7).
import { readFile } from 'node:fs/promises';
import { expectDownload, listDownloads } from './launch.js';

/**
 * Runs `action`, waits for the new file in the download dir and parses it as JSON.
 * @param {import('@playwright/test').Page | object} pageOrExt a page or launchWithExtension() result
 * @param {() => Promise<unknown>} action
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ suggestedFilename: string, path: string, json: any }>}
 */
export async function waitForDownloadJson(pageOrExt, action, options) {
  const { suggestedFilename, path } = await expectDownload(pageOrExt, action, options);
  return { suggestedFilename, path, json: JSON.parse(await readFile(path, 'utf8')) };
}

/**
 * Resolves when no new file (finished or in progress) appears in the download dir within `ms`;
 * rejects as soon as one does. Polls the directory instead of sleeping once.
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @param {number} [ms]
 */
export async function expectNoDownload(pageOrExt, ms = 1000) {
  const before = new Set(await listDownloads(pageOrExt, { includePartial: true }));
  const deadline = Date.now() + ms;
  for (;;) {
    const added = (await listDownloads(pageOrExt, { includePartial: true })).filter((n) => !before.has(n));
    if (added.length) throw new Error(`Unexpected download: ${added.join(', ')}`);
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Counts files saved into the download dir from now on, to assert "exactly one" or "none".
 * @param {import('@playwright/test').Page | object} pageOrExt
 * @returns {Promise<{ names: () => Promise<string[]>, count: () => Promise<number> }>}
 */
export async function countDownloads(pageOrExt) {
  const before = new Set(await listDownloads(pageOrExt));
  const names = async () => (await listDownloads(pageOrExt)).filter((n) => !before.has(n));
  return { names, count: async () => (await names()).length };
}
