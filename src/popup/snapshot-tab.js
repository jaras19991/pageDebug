// Popup orchestration for E0 (design D6/D8/D12): probe the page with runInPage in the
// MAIN world, inject the page script only when it is not there yet, and reduce
// everything to a closed outcome { kind, fileName? }. Browser APIs come in via `api`,
// so this module is testable without a browser. Replaced in E1 by the background flow.
import { runInPage } from './run-in-page.js';
import { classifyUrl, mapInjectionError } from './target.js';

/**
 * @param {{ id?: number, url?: string } | undefined} tab
 * @param {{ scripting: { executeScript: Function },
 *           isAllowedFileSchemeAccess: () => Promise<boolean | null>,
 *           isFirefox: boolean }} api
 * @returns {Promise<{ kind: 'success', fileName: string }
 *                 | { kind: 'restricted' | 'fileAccess' | 'noTab' | 'failed' }>}
 */
export async function snapshotTab(tab, api) {
  if (typeof tab?.id !== 'number') return { kind: 'noTab' };

  const target = classifyUrl(tab.url);
  if (target === 'restricted') return { kind: 'restricted' };
  // Only an explicit "no" short-circuits; an unavailable probe falls through to injection.
  if (target === 'file' && !api.isFirefox && (await api.isAllowedFileSchemeAccess()) === false) {
    return { kind: 'fileAccess' };
  }

  const inMain = { target: { tabId: tab.id }, world: 'MAIN' };
  const probe = async () => {
    const results = await api.scripting.executeScript({ ...inMain, func: runInPage });
    return results?.[0]?.result;
  };

  try {
    let result = await probe();
    if (result?.ok === false && result.reason === 'not-loaded') {
      // First click on this page: define window.PageDebugSnapshot, then run again.
      // Later clicks skip this, so hooks are never installed twice (AC-1.5).
      await api.scripting.executeScript({ ...inMain, files: ['page/page-debug-snapshot.js'] });
      result = await probe();
    }
    if (result?.ok === true && typeof result.fileName === 'string' && result.fileName) {
      return { kind: 'success', fileName: result.fileName };
    }
    console.error('[Page Debug Snapshot] snapshot not saved', result);
    return { kind: 'failed' };
  } catch (error) {
    console.error('[Page Debug Snapshot] executeScript failed', error);
    return { kind: mapInjectionError(error, tab.url, { isFirefox: api.isFirefox }) };
  }
}
