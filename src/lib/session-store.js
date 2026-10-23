// Background state, kept only in storage.session (design D2). The store holds no
// state of its own: a fresh instance after an SW / event page restart reads the same
// data. Writes go through a promise queue that only orders operations.

export const KEYS = Object.freeze({
  rec: 'pds:rec',
  pending: 'pds:pending',
  docPrefix: 'pds:doc:',
  lastPrefix: 'pds:last:',
  testLimit: 'pds:test:recordingLimitMs',
});

// Test-only override of the 10 min recording limit is clamped into this range (D10).
export const TEST_LIMIT_RANGE = Object.freeze({ min: 1000, max: 600_000 });

// Buffers of one document as exported by the recorder (exportBuffers, design T3c); `steps` since E2 (T10a).
export const DOC_LISTS = Object.freeze(['consoleLogs', 'runtimeErrors', 'network', 'steps']);

const MB = 1024 * 1024;
// D4: one flushed document ≤ 3 MB, all documents ≤ 8 MB (Chrome session quota is 10 MB).
const DEFAULT_DOC_BUDGET = 3 * MB;
const DEFAULT_TOTAL_BUDGET = 8 * MB;

const encoder = new TextEncoder();
const byteSize = (value) => encoder.encode(JSON.stringify(value) ?? '').length;

const docKey = (id) => `${KEYS.docPrefix}${id}`;
const lastKey = (tabId) => `${KEYS.lastPrefix}${tabId}`;

function parseDocId(key) {
  const raw = key.slice(KEYS.docPrefix.length);
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function compareIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function countsOf(data) {
  if (data?.counts && typeof data.counts === 'object') return { ...data.counts };
  const counts = {};
  for (const list of DOC_LISTS) counts[list] = Array.isArray(data?.[list]) ? data[list].length : 0;
  return counts;
}

const countsOnly = (data) => ({ counts: countsOf(data), dropped: true });

/**
 * Trims a document to `budget` bytes, dropping its oldest entries (by `t`, then by
 * position) across all lists. Returns null when even an empty document does not fit.
 */
function fitDocument(data, budget) {
  if (byteSize(data) <= budget) return { data, truncated: false };
  const entries = [];
  for (const list of DOC_LISTS) {
    const items = Array.isArray(data[list]) ? data[list] : [];
    items.forEach((item, index) => {
      const t = typeof item?.t === 'number' ? item.t : -Infinity;
      entries.push({ list, index, t, size: byteSize(item) + 1 });
    });
  }
  // Newest first; within equal `t` the later position is newer.
  entries.sort((a, b) => b.t - a.t || b.index - a.index);

  const build = (kept) => {
    const out = { ...data, truncated: { ...(data.truncated ?? {}) } };
    for (const list of DOC_LISTS) {
      if (!Array.isArray(data[list])) continue;
      const keep = kept.get(list) ?? new Set();
      out[list] = data[list].filter((_, i) => keep.has(i));
      if (out[list].length < data[list].length) out.truncated[list] = true;
    }
    return out;
  };

  const empty = build(new Map());
  let room = budget - byteSize(empty);
  if (room < 0) return null;
  const chosen = [];
  for (const e of entries) {
    if (e.size > room) break;
    room -= e.size;
    chosen.push(e);
  }
  // Size estimate is per entry; shrink further if the assembled JSON still exceeds.
  for (;;) {
    const kept = new Map();
    for (const e of chosen) {
      if (!kept.has(e.list)) kept.set(e.list, new Set());
      kept.get(e.list).add(e.index);
    }
    const out = build(kept);
    if (byteSize(out) <= budget) return { data: out, truncated: true };
    if (!chosen.length) return null;
    chosen.pop();
  }
}

/**
 * @param {chrome.storage.StorageArea} area  always `storage.session`
 * @param {{ docBudgetBytes?: number, totalBudgetBytes?: number }} [options]
 */
export function createStore(area, { docBudgetBytes = DEFAULT_DOC_BUDGET, totalBudgetBytes = DEFAULT_TOTAL_BUDGET } = {}) {
  let queue = Promise.resolve();
  const enqueue = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const read = async (key) => (await area.get(key))[key] ?? null;

  async function getAllDocs() {
    const all = await area.get(null);
    return Object.keys(all)
      .filter((k) => k.startsWith(KEYS.docPrefix))
      .map((k) => ({ id: parseDocId(k), data: all[k] }))
      .sort((a, b) => compareIds(a.id, b.id));
  }

  // Replaces the oldest other documents with counts until they, plus `reserve` bytes for the document about to be
  // written under `currentId`, fit the total budget. Runs before the write, so a full quota never costs the newest.
  async function enforceTotalBudget(currentId, reserve = 0) {
    const docs = (await getAllDocs()).filter((d) => d.id !== currentId);
    let total = docs.reduce((sum, d) => sum + byteSize(d.data), 0) + reserve;
    if (total <= totalBudgetBytes) return;
    const replacements = {};
    for (const doc of docs) {
      if (total <= totalBudgetBytes) break;
      if (doc.data?.dropped) continue;
      const slim = countsOnly(doc.data);
      total -= byteSize(doc.data) - byteSize(slim);
      replacements[docKey(doc.id)] = slim;
    }
    if (Object.keys(replacements).length) await area.set(replacements);
  }

  return {
    getRec: () => enqueue(() => read(KEYS.rec)),

    /**
     * Read-modify-write of `pds:rec` in the queue. `fn(rec | null)` returns the next
     * state, `null` to delete it, or `undefined` to leave it as is. Resolves to the
     * resulting state. `fn` must not call the store (it would wait for itself).
     */
    updateRec: (fn) =>
      enqueue(async () => {
        const current = await read(KEYS.rec);
        const next = await fn(current);
        if (next === undefined) return current;
        if (next === null) {
          await area.remove(KEYS.rec);
          return null;
        }
        await area.set({ [KEYS.rec]: next });
        return next;
      }),

    clearRec: () => enqueue(() => area.remove(KEYS.rec)),

    /**
     * Stores a flushed document within the D4 budget.
     * @returns {Promise<{ stored: 'full' | 'truncated' | 'dropped' | 'lost' }>}
     */
    putDoc: (id, data) =>
      enqueue(async () => {
        const fitted = fitDocument(data, docBudgetBytes);
        let value = fitted ? fitted.data : countsOnly(data);
        let stored = !fitted ? 'dropped' : fitted.truncated ? 'truncated' : 'full';
        try {
          await enforceTotalBudget(id, byteSize(value));
        } catch {
          // Slimming failed: the write below still falls back to counts on quota.
        }
        try {
          await area.set({ [docKey(id)]: value });
        } catch {
          // Quota (or any write error): keep only how much was lost.
          value = countsOnly(data);
          stored = 'dropped';
          try {
            await area.set({ [docKey(id)]: value });
          } catch {
            return { stored: 'lost' };
          }
        }
        return { stored };
      }),

    /** @returns {Promise<Array<{ id: number | string, data: object }>>} ascending by id */
    listDocs: () => enqueue(getAllDocs),

    clearDocs: () =>
      enqueue(async () => {
        const keys = Object.keys(await area.get(null)).filter((k) => k.startsWith(KEYS.docPrefix));
        if (keys.length) await area.remove(keys);
      }),

    getPending: () => enqueue(() => read(KEYS.pending)),
    setPending: (pending) => enqueue(() => area.set({ [KEYS.pending]: pending })),
    clearPending: () => enqueue(() => area.remove(KEYS.pending)),

    getLast: (tabId) => enqueue(() => read(lastKey(tabId))),
    setLast: (tabId, last) => enqueue(() => area.set({ [lastKey(tabId)]: last })),
    clearLast: (tabId) => enqueue(() => area.remove(lastKey(tabId))),

    /** Test-only recording limit (ms) clamped to TEST_LIMIT_RANGE, or null when unset/invalid. */
    getTestLimit: () =>
      enqueue(async () => {
        const raw = await read(KEYS.testLimit);
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
        return Math.min(TEST_LIMIT_RANGE.max, Math.max(TEST_LIMIT_RANGE.min, Math.floor(raw)));
      }),
  };
}
