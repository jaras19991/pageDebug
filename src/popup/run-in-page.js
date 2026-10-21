// Runs in the page's MAIN world via scripting.executeScript({ func: runInPage, world: 'MAIN' }).
// The browser serialises this function with toString(), so it must be self-contained:
// no imports, no closures over module scope, no chrome.*. The only channel back to the
// popup is the return value (structured clone), so it returns plain JSON and never throws.
export function runInPage() {
  try {
    const pds = window.PageDebugSnapshot;
    if (!pds || typeof pds.download !== 'function' || typeof pds.init !== 'function') {
      return { ok: false, reason: 'not-loaded' };
    }

    if (!pds.initialized) {
      pds.init({ createFloatingButton: false });
    }

    const prefix = (pds.config && pds.config.fileNamePrefix) || 'page-debug-snapshot';
    const fileName = `${String(prefix).slice(0, 100)}-${Date.now()}.json`;
    pds.download(fileName);

    return { ok: true, fileName };
  } catch (error) {
    const name = error && typeof error.name === 'string' ? error.name : 'Error';
    return { ok: false, reason: 'snapshot-failed', errorName: name.slice(0, 100) };
  }
}
