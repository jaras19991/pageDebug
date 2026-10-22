// Dynamic content script registration for the recorded origin and the toolbar badge
// (design D1, "Zmiany w manifeście"). Browser APIs are passed in.

export const SCRIPT_IDS = Object.freeze({ bridge: 'pds-bridge', recorder: 'pds-recorder' });

const BADGES = Object.freeze({
  recording: { text: '●', color: '#d93025' },
  stopped: { text: '■', color: '#5f6368' },
  none: { text: '', color: null },
});

/**
 * Both entries for one origin pattern. Paths are root-relative literals: Firefox resolves
 * relative `js` paths against the calling page (E0 F7), and the walker (T11) reads them.
 */
export function scriptsFor(pattern) {
  const common = { matches: [pattern], runAt: 'document_start', allFrames: false, persistAcrossSessions: false };
  return [
    { id: SCRIPT_IDS.bridge, js: ['/content/isolated-world.js'], world: 'ISOLATED', ...common },
    { id: SCRIPT_IDS.recorder, js: ['/content/main-world.js'], world: 'MAIN', ...common },
  ];
}

/** Removes our scripts if registered; foreign or missing ids are not an error. */
export async function unregisterAll(scripting) {
  const ids = Object.values(SCRIPT_IDS);
  try {
    const existing = await scripting.getRegisteredContentScripts({ ids });
    const found = existing.map((s) => s.id).filter((id) => ids.includes(id));
    if (found.length) await scripting.unregisterContentScripts({ ids: found });
  } catch {
    // Already gone (race with another cleanup); nothing to undo.
  }
}

/** Registers both scripts for `pattern`, replacing any earlier registration. Throws on failure. */
export async function registerFor(scripting, pattern) {
  await unregisterAll(scripting);
  await scripting.registerContentScripts(scriptsFor(pattern));
}

/** @param {'recording' | 'stopped' | 'none'} kind  best effort: a closed tab is not an error. */
export async function setBadge(action, tabId, kind) {
  const badge = BADGES[kind] ?? BADGES.none;
  try {
    await action.setBadgeText({ tabId, text: badge.text });
    if (badge.color) await action.setBadgeBackgroundColor({ tabId, color: badge.color });
  } catch {
    // Tab closed or navigated away from under us.
  }
}
