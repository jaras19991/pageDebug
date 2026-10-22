// Classifies the target tab and maps injection failures to a closed set of
// outcomes (design D7/D8). Pure functions; browser APIs are passed in.

const RESTRICTED_SCHEMES = new Set([
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'devtools:',
  'edge:',
  'about:',
  'moz-extension:',
  'resource:',
  'view-source:',
  'data:',
  'javascript:',
]);

// Extension stores refuse scripting. Maintained by hand (D8 consequences).
const STORE_HOSTS = [
  { host: 'chromewebstore.google.com' },
  { host: 'chrome.google.com', path: '/webstore' },
  { host: 'addons.mozilla.org' },
  { host: 'microsoftedge.microsoft.com', path: '/addons' },
];

const RESTRICTED_ERROR_PATTERNS = [
  /Cannot access a chrome/i,
  /extensions gallery cannot be scripted/i,
  /Cannot access contents of/i,
  /Missing host permission/i,
  /must request permission/i,
];

// Error messages are matched only on their head; long texts carry nothing we use.
const MAX_ERROR_LENGTH = 1000;

/** @returns {'web' | 'file' | 'restricted' | 'unknown'} */
export function classifyUrl(url) {
  if (typeof url !== 'string' || url === '') return 'unknown';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    // A URL the browser reports but we cannot parse is never treated as a normal page.
    return 'restricted';
  }
  const scheme = parsed.protocol;
  if (scheme === 'file:') return 'file';
  if (RESTRICTED_SCHEMES.has(scheme)) return 'restricted';
  if (scheme !== 'http:' && scheme !== 'https:') return 'restricted';
  const isStore = STORE_HOSTS.some(
    ({ host, path }) =>
      parsed.hostname === host &&
      (!path || parsed.pathname === path || parsed.pathname.startsWith(path + '/')),
  );
  return isStore ? 'restricted' : 'web';
}

// Chrome names the page in host-permission errors: Cannot access contents of url "file:///…".
const ERROR_URL = /\burl\s+"([^"]{1,2048})"/i;
// Errors that name the kind of page themselves; never a file without access.
const NON_FILE_ERROR_PATTERNS = [/Cannot access a chrome/i, /extensions gallery cannot be scripted/i];

/**
 * @param {{ isFirefox?: boolean, fileAccessDenied?: boolean }} [options]
 *   fileAccessDenied: Chrome's file-URL probe said "no"; used only when the tab URL is unknown.
 * @returns {'restricted' | 'fileAccess' | 'failed'}
 */
export function mapInjectionError(err, url, { isFirefox = false, fileAccessDenied = false } = {}) {
  const raw = typeof err === 'string' ? err : err?.message;
  if (typeof raw !== 'string' || raw === '') return 'failed';
  const message = raw.slice(0, MAX_ERROR_LENGTH);
  if (!RESTRICTED_ERROR_PATTERNS.some((re) => re.test(message))) return 'failed';
  // The file-access hint names a Chrome setting; in Firefox it would be untrue.
  if (isFirefox) return 'restricted';

  const target = classifyUrl(url);
  if (target === 'file') return 'fileAccess';
  if (target !== 'unknown') return 'restricted';

  // Without file-URL access Chrome hides tab.url for file:// (QA E0 F2), so fall back
  // to the URL in the error text, then to the probe for errors that name no page.
  const named = ERROR_URL.exec(message)?.[1];
  if (named !== undefined) return classifyUrl(named) === 'file' ? 'fileAccess' : 'restricted';
  if (fileAccessDenied && !NON_FILE_ERROR_PATTERNS.some((re) => re.test(message))) return 'fileAccess';
  return 'restricted';
}

// runtime.getBrowserInfo exists only in Firefox; no UA sniffing.
export function isFirefoxRuntime(chromeApi) {
  return typeof chromeApi?.runtime?.getBrowserInfo === 'function';
}

/**
 * Chrome's "Allow access to file URLs" toggle.
 * @returns {Promise<boolean | null>} null when the probe is unavailable (Firefox) or fails.
 */
export async function isFileAccessAllowed(chromeApi) {
  const probe = chromeApi?.extension?.isAllowedFileSchemeAccess;
  if (typeof probe !== 'function') return null;
  try {
    return (await probe.call(chromeApi.extension)) === true;
  } catch {
    return null;
  }
}
