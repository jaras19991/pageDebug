// Download helpers for e2e (E0-T7a) built on expectDownload from launch.js.
import { readFile } from 'node:fs/promises';
import { expectDownload } from './launch.js';

/**
 * Runs `action`, waits for the download on `page` and parses the file as JSON.
 * @param {import('@playwright/test').Page} page the tab that saves the file
 * @param {() => Promise<unknown>} action
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ suggestedFilename: string, json: any }>}
 */
export async function waitForDownloadJson(page, action, options) {
  const { suggestedFilename, path } = await expectDownload(page, action, options);
  return { suggestedFilename, json: JSON.parse(await readFile(path, 'utf8')) };
}

/**
 * Resolves when no download starts on `page` within `ms`; rejects as soon as one does.
 * Waits on the event with a timeout instead of sleeping.
 * @param {import('@playwright/test').Page} page
 * @param {number} [ms]
 */
export async function expectNoDownload(page, ms = 1000) {
  let download;
  try {
    download = await page.waitForEvent('download', { timeout: ms });
  } catch (error) {
    if (error?.name === 'TimeoutError') return;
    throw error;
  }
  throw new Error(`Unexpected download: ${download.suggestedFilename()}`);
}

/**
 * Records downloads on `page` from now on, to assert "exactly one" or "none" afterwards.
 * @param {import('@playwright/test').Page} page
 * @returns {{ names: string[], readonly count: number }}
 */
export function countDownloads(page) {
  const names = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  return {
    names,
    get count() {
      return names.length;
    },
  };
}
