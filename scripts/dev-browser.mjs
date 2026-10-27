// Builds the extension and runs it in Chrome/Chromium or Firefox on a temporary profile via web-ext.
// Usage: node scripts/dev-browser.mjs <chrome|firefox> [--url <url>]   (also: --browser <b>, --url=<u>)
// Chrome: web-ext loads the extension over CDP (Extensions.loadUnpacked), because Chrome stable >= 137
// ignores --load-extension. Override the binary with PDS_CHROMIUM_BINARY; if the default Chrome fails
// to start, the Chromium bundled with Playwright is tried once.
// Developer configuration (E4 D5): PDS_CONFIG=<file> builds it in, as `build --config`.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, cliOptions } from './build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BROWSERS = ['chrome', 'firefox'];
export const DEFAULT_URL = 'https://www.example.com';
const WEB_EXT_TARGET = { chrome: 'chromium', firefox: 'firefox-desktop' };
const MAX_ARG_LENGTH = 2048;

export class UsageError extends Error {
  name = 'UsageError';
}

/**
 * @param {string[]} argv arguments after the script path
 * @returns {{ browser: string, url: string }}
 */
export function parseArgs(argv) {
  let browser;
  let url = DEFAULT_URL;
  const unknownBrowser = (value) =>
    new UsageError(`Unknown browser "${String(value).slice(0, 100)}". Allowed: ${BROWSERS.join(', ')}`);

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    if (arg.length > MAX_ARG_LENGTH) throw new UsageError('Argument too long');
    const eq = arg.match(/^--(browser|url)=(.*)$/s);
    let name = eq ? eq[1] : arg === '--browser' || arg === '--url' ? arg.slice(2) : null;
    let value = eq ? eq[2] : undefined;
    if (name && value === undefined) {
      value = argv[++i];
      if (value === undefined || value === '') throw new UsageError(`Missing value for --${name}`);
    } else if (!name) {
      if (arg.startsWith('-')) throw new UsageError(`Unknown option "${arg.slice(0, 100)}"`);
      name = 'browser';
      value = arg;
    }

    if (name === 'url') {
      url = value;
    } else {
      if (browser !== undefined) throw new UsageError('Browser given more than once');
      if (!BROWSERS.includes(value)) throw unknownBrowser(value);
      browser = value;
    }
  }
  if (browser === undefined) throw unknownBrowser('');
  return { browser, url };
}

/**
 * Options for webExt.cmd.run().
 * @param {{ browser: string, url: string }} args
 * @param {{ env?: Record<string, string | undefined> }} [ctx]
 */
export function runOptions({ browser, url }, { env = process.env } = {}) {
  const options = {
    sourceDir: join(ROOT, 'dist', browser),
    target: [WEB_EXT_TARGET[browser]],
    startUrl: [url],
  };
  if (browser === 'chrome' && env.PDS_CHROMIUM_BINARY) options.chromiumBinary = env.PDS_CHROMIUM_BINARY;
  return options;
}

async function playwrightChromium() {
  try {
    const { chromium } = await import('playwright');
    const path = chromium.executablePath();
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    console.error('Usage: node scripts/dev-browser.mjs <chrome|firefox> [--url <url>]');
    return 2;
  }

  await build({ targets: [args.browser], devConfigPath: cliOptions([], process.env).devConfigPath });
  const options = runOptions(args);
  if (!existsSync(join(options.sourceDir, 'manifest.json'))) {
    console.error(`No manifest.json in ${options.sourceDir} after build`);
    return 1;
  }
  console.log(`Target: ${args.browser}  |  Extension directory: ${options.sourceDir}`);

  const { default: webExt } = await import('web-ext');
  try {
    await webExt.cmd.run(options, { shouldExitProgram: false });
  } catch (error) {
    const fallback = args.browser === 'chrome' && !options.chromiumBinary && (await playwrightChromium());
    if (!fallback) throw error;
    console.warn(`Chrome failed to start (${error.message}). Retrying with Playwright Chromium: ${fallback}`);
    await webExt.cmd.run({ ...options, chromiumBinary: fallback }, { shouldExitProgram: false });
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code) process.exitCode = code;
    },
    (error) => {
      console.error(`dev-browser failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
