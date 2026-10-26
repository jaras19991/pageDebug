// Package size budget (design E3 D8, E3-S2, AC-6.1–6.3): the size is measured for real (compressed, by the injected
// `measure`), then data is cut in a fixed order — least useful first — towards a character target derived from the
// observed compression ratio, and measured again (≤ 4 measurements). Never throws because of size: when everything
// cuttable is gone the package is returned anyway, with a note. Protected (never cut): overview, redaction, documents,
// notes, steps, runtimeErrors entries, failed network entries (status ≥ 400 or error), vitals, screenshots.
// Pure: no chrome.*, no DOM, no clock. Bundled into the console fallback through export.js.

import { cutPreview } from './mask-secrets.js';

export const BUDGET_LIMITS = Object.freeze({
  packageBytes: 2097152,
  fullHtmlPackageBytes: 10485760,
  // `snapshot.json` unpacked, enforced with the default configuration (NFR).
  jsonChars: 10485760,
  maxMeasures: 4,
  resourcesKeep: 200,
  domListItems: 100,
  structureChars: 100000,
  storageValueChars: 1000,
  stackChars: 4000,
  // Character target = what the ratio predicts × this factor (per cutting round; later rounds cut harder).
  safety: Object.freeze([0.97, 0.9, 0.8]),
  closeAttempts: 8,
});

const MB = 1048576;
const DOM_LISTS = ['meta', 'scripts', 'stylesheets', 'images', 'iframes', 'hreflangs'];
// Key/value maps of `storage` (the page's two web storage areas, schema keys); `cookies` is a list and is not cut.
const STORAGE_AREAS = ['localStorage', 'sessionStorage'];
function storageAreas(storage) {
  return STORAGE_AREAS.filter((key) => isObject(storage[key]));
}
const RECORD_KEYS = ['consoleLogs', 'runtimeErrors', 'network', 'steps'];
const RATED_METRICS = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP'];
const LOG_GROUPS = ['debug', 'log', 'info', 'warn'];
const API_TYPES = ['fetch', 'xhr'];
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// A cut string must not end inside `[redacted:<rule>]` (any prefix of it).
const PARTIAL_MARKER = /\[(?:r(?:e(?:d(?:a(?:c(?:t(?:e(?:d(?::[^\]]*)?)?)?)?)?)?)?)?)?$/;

const FIT = 'to fit the package size limit';
const NOTES = {
  resources: (n) => `${n} oldest performance.resources entries were removed ${FIT}.`,
  network: (n) => `${n} oldest successful network requests were removed ${FIT}.`,
  consoleLogs: (n) => `${n} oldest console logs (debug, log, info, warn) were removed ${FIT}.`,
  dom: (n) => `${n} items of dom lists (${DOM_LISTS.join(', ')}) were removed ${FIT}; each list keeps at most ${BUDGET_LIMITS.domListItems}.`,
  html: (n) => `dom.structure was cut by ${n} characters ${FIT}.`,
  storage: (n) => `${n} storage values were cut to ${BUDGET_LIMITS.storageValueChars} characters ${FIT}.`,
  errorLogs: (n) => `${n} oldest console errors were removed ${FIT}.`,
  stacks: (n) => `${n} stack traces were cut to ${BUDGET_LIMITS.stackChars} characters ${FIT}.`,
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sizeLabel(bytes) {
  return bytes >= MB ? `${Math.round((bytes / MB) * 10) / 10} MB` : `${bytes} bytes`;
}

// Characters an item takes in `JSON.stringify(pkg, null, 2)` at `depth` levels of indentation (+ comma and newline).
function sizeOf(value, depth) {
  const s = JSON.stringify(value, null, 2);
  if (s === undefined) return 0;
  let lines = 1;
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) lines++;
  return s.length + lines * depth * 2 + 2;
}

/** `text` cut to ≤ `max` characters at a word boundary, never inside a `[redacted:<rule>]` marker. */
export function cutText(text, max) {
  return cutPreview(text, max).preview.replace(PARTIAL_MARKER, '');
}

// Closing tags for the elements still open at the end of `prefix` (innermost first).
function closingTags(prefix) {
  const stack = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
  for (let m = tag.exec(prefix); m; m = tag.exec(prefix)) {
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
    } else if (!m[3] && !VOID_TAGS.has(name)) {
      stack.push(name);
    }
  }
  return stack.reverse().map((name) => `</${name}>`).join('');
}

/** HTML cut after a complete tag, open elements closed, result ≤ `max` characters ('' when nothing fits). */
export function cutHtml(html, max) {
  if (typeof html !== 'string') return '';
  if (html.length <= max) return html;
  let end = html.lastIndexOf('>', max - 1) + 1;
  for (let i = 0; i < BUDGET_LIMITS.closeAttempts && end > 0; i++) {
    const prefix = html.slice(0, end);
    const closing = closingTags(prefix);
    if (prefix.length + closing.length <= max) return prefix + closing;
    const next = html.lastIndexOf('>', Math.min(end - 2, max - closing.length - 1)) + 1;
    end = next < end ? next : 0;
  }
  return '';
}

// Copy-on-write: only containers the cuts touch are copied; untouched entries are shared with the input.
function copyForCuts(pkg) {
  const work = { ...pkg };
  work.truncated = { ...(isObject(pkg.truncated) ? pkg.truncated : {}) };
  work.notes = Array.isArray(pkg.notes) ? [...pkg.notes] : [];
  for (const key of ['network', 'consoleLogs', 'runtimeErrors']) if (Array.isArray(pkg[key])) work[key] = [...pkg[key]];
  if (Array.isArray(pkg.documents)) work.documents = pkg.documents.map((d) => (isObject(d) ? { ...d } : d));
  if (isObject(pkg.performance)) {
    work.performance = { ...pkg.performance };
    if (Array.isArray(pkg.performance.resources)) work.performance.resources = [...pkg.performance.resources];
  }
  if (isObject(pkg.dom)) {
    work.dom = { ...pkg.dom };
    for (const key of DOM_LISTS) if (Array.isArray(pkg.dom[key])) work.dom[key] = [...pkg.dom[key]];
  }
  if (isObject(pkg.storage)) {
    work.storage = { ...pkg.storage };
    for (const key of storageAreas(pkg.storage)) work.storage[key] = { ...pkg.storage[key] };
  }
  return work;
}

const isFailed = (r) => (typeof r?.status === 'number' && r.status >= 400) || (r?.error !== null && r?.error !== undefined);

// Removes entries of `list` at `candidates` (indices, in cut order) until `state.excess` is covered. Returns the count.
function removeEntries(list, candidates, state, depth) {
  const drop = new Set();
  for (const i of candidates) {
    if (state.excess <= 0) break;
    state.excess -= sizeOf(list[i], depth);
    drop.add(i);
  }
  if (!drop.size) return 0;
  let w = 0;
  for (let r = 0; r < list.length; r++) if (!drop.has(r)) list[w++] = list[r];
  list.length = w;
  return drop.size;
}

function indicesWhere(list, test) {
  const out = [];
  list.forEach((item, i) => { if (test(item)) out.push(i); });
  return out;
}

// Steps in cut order (D8); each returns how many items it removed or shortened. `fullHtml` only with the option on.
const STEPS = [
  ['fullHtml', 'html', (work, state) => {
    const html = work.dom?.fullHtml;
    if (typeof html !== 'string' || html === '') return 0;
    const cut = cutHtml(html, Math.max(0, html.length - Math.ceil(state.excess)));
    if (cut.length === html.length) return 0;
    work.dom.fullHtml = cut;
    state.excess -= html.length - cut.length;
    return html.length - cut.length;
  }],
  ['resources', 'resources', (work, state) => {
    const list = work.performance?.resources;
    if (!Array.isArray(list) || list.length <= BUDGET_LIMITS.resourcesKeep) return 0;
    const candidates = Array.from({ length: list.length - BUDGET_LIMITS.resourcesKeep }, (_, i) => i);
    return removeEntries(list, candidates, state, 3);
  }],
  ['network', 'network', (work, state) => {
    const list = work.network;
    if (!Array.isArray(list)) return 0;
    const ok = (api) => (r) => !isFailed(r) && API_TYPES.includes(r?.type) === api;
    return removeEntries(list, [...indicesWhere(list, ok(false)), ...indicesWhere(list, ok(true))], state, 2);
  }],
  ['consoleLogs', 'consoleLogs', (work, state) => {
    const list = work.consoleLogs;
    if (!Array.isArray(list)) return 0;
    const group = (r) => (LOG_GROUPS.includes(r?.level) ? r.level : 'log');
    const candidates = LOG_GROUPS.flatMap((level) => indicesWhere(list, (r) => r?.level !== 'error' && group(r) === level));
    return removeEntries(list, candidates, state, 2);
  }],
  ['dom', 'dom', (work, state) => {
    if (!isObject(work.dom)) return 0;
    let removed = 0;
    for (const key of DOM_LISTS) {
      const list = work.dom[key];
      while (Array.isArray(list) && list.length > BUDGET_LIMITS.domListItems && state.excess > 0) {
        state.excess -= sizeOf(list.pop(), 3);
        removed++;
      }
    }
    return removed;
  }],
  ['html', 'html', (work, state) => {
    const html = work.dom?.structure;
    if (typeof html !== 'string' || html.length <= BUDGET_LIMITS.structureChars) return 0;
    const cut = cutHtml(html, Math.max(BUDGET_LIMITS.structureChars, html.length - Math.ceil(state.excess)));
    if (cut.length === html.length) return 0;
    work.dom.structure = cut;
    state.excess -= html.length - cut.length;
    return html.length - cut.length;
  }],
  ['storage', 'storage', (work, state) => {
    if (!isObject(work.storage)) return 0;
    let removed = 0;
    for (const area of storageAreas(work.storage)) {
      const map = work.storage[area];
      if (!isObject(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        if (state.excess <= 0) return removed;
        if (typeof value !== 'string' || value.length <= BUDGET_LIMITS.storageValueChars) continue;
        map[key] = cutText(value, BUDGET_LIMITS.storageValueChars);
        state.excess -= value.length - map[key].length;
        removed++;
      }
    }
    return removed;
  }],
  ['errorLogs', 'consoleLogs', (work, state) => {
    const list = work.consoleLogs;
    if (!Array.isArray(list)) return 0;
    return removeEntries(list, indicesWhere(list, (r) => r?.level === 'error'), state, 2);
  }],
  ['stacks', 'stacks', (work, state) => {
    let removed = 0;
    for (const key of ['runtimeErrors', 'consoleLogs']) {
      const list = work[key];
      if (!Array.isArray(list)) continue;
      for (let i = 0; i < list.length && state.excess > 0; i++) {
        const stack = list[i]?.stack;
        if (typeof stack !== 'string' || stack.length <= BUDGET_LIMITS.stackChars) continue;
        list[i] = { ...list[i], stack: cutText(stack, BUDGET_LIMITS.stackChars) };
        state.excess -= stack.length - list[i].stack.length;
        removed++;
      }
    }
    return removed;
  }],
];

// Runs the steps in order until the excess is covered. Returns true when the excess is still positive (nothing left to cut).
function runSteps(work, state, cuts, withFullHtml) {
  for (const [step, flag, cut] of STEPS) {
    if (state.excess <= 0) return false;
    if (step === 'fullHtml' && !withFullHtml) continue;
    const removed = cut(work, state);
    if (removed > 0) {
      cuts.set(step, (cuts.get(step) ?? 0) + removed);
      work.truncated[flag] = true;
    }
  }
  return state.excess > 0;
}

function cutNotes(cuts, limit) {
  return [...cuts].map(([step, n]) => (step === 'fullHtml' ? `Full HTML was cut to fit ${sizeLabel(limit)}.` : NOTES[step](n)));
}

/**
 * `overview` and `documents[].kept` from what is in the package (after cuts). Mutates `pkg`; same formulas as package.js.
 * @returns {object} pkg
 */
export function recount(pkg) {
  const list = (key) => (Array.isArray(pkg[key]) ? pkg[key] : []);
  const vitals = list('vitals');
  pkg.overview = {
    runtimeErrors: list('runtimeErrors').length,
    consoleErrors: list('consoleLogs').filter((r) => r?.level === 'error').length,
    failedRequests: list('network').filter(isFailed).length,
    steps: list('steps').length,
    poorVitals: vitals.reduce((sum, v) => sum + RATED_METRICS.filter((name) => v?.[name]?.rating === 'poor').length, 0),
    screenshot: list('screenshots').length > 0,
  };
  for (const doc of list('documents')) {
    if (!isObject(doc)) continue;
    const kept = {};
    for (const key of RECORD_KEYS) kept[key] = list(key).filter((r) => r?.doc === doc.id).length;
    doc.kept = kept;
  }
  return pkg;
}

/**
 * @param {object} pkg  redacted v4 package (not mutated; a copy is cut)
 * @param {{ measure: (pkg: object) => Promise<number>, limitBytes?: number, maxJsonChars?: number, reserveBytes?: number }} options
 *        `measure`: compressed bytes of `snapshot.json` for this object; `reserveBytes`: added to every measurement
 *        (screenshot JPEG, summary.md, zip headers). Defaults: `limits.packageBytes` of the package, else 2 MB (10 MB
 *        with `dom.fullHtml`); `maxJsonChars` 10 MB, unlimited with `dom.fullHtml`.
 * @returns {Promise<{ pkg: object, packageBytes: number, cuts: { step: string, removed: number }[] }>}
 */
export async function fitBudget(pkg, { measure, limitBytes, maxJsonChars, reserveBytes = 0 } = {}) {
  const work = copyForCuts(pkg);
  const withFullHtml = typeof work.dom?.fullHtml === 'string' && work.dom.fullHtml !== '';
  const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);
  const limit = positive(limitBytes) ?? positive(pkg.limits?.packageBytes)
    ?? (withFullHtml ? BUDGET_LIMITS.fullHtmlPackageBytes : BUDGET_LIMITS.packageBytes);
  const maxChars = positive(maxJsonChars) ?? (withFullHtml ? Infinity : BUDGET_LIMITS.jsonChars);
  const reserve = Number.isFinite(reserveBytes) && reserveBytes > 0 ? Math.ceil(reserveBytes) : 0;
  const baseNotes = work.notes;
  const cuts = new Map();

  let measures = 0;
  const sizeNow = async () => {
    const chars = JSON.stringify(work, null, 2).length;
    measures++;
    let bytes;
    try {
      bytes = await measure(work);
    } catch {
      bytes = null;
    }
    // No measurement: the uncompressed length is an upper bound.
    if (!Number.isFinite(bytes) || bytes < 0) bytes = chars;
    return { chars, bytes: Math.ceil(bytes) + reserve };
  };

  // Over the unpacked limit the cut is needed whatever the ratio: do it before the first (costly) compression.
  let exhausted = false;
  const unpacked = JSON.stringify(work, null, 2).length;
  if (unpacked > maxChars) {
    exhausted = runSteps(work, { excess: unpacked - Math.floor(maxChars * BUDGET_LIMITS.safety[0]) }, cuts, withFullHtml);
    work.notes = [...baseNotes, ...cutNotes(cuts, limit)];
  }
  let { chars, bytes } = await sizeNow();
  while ((bytes > limit || chars > maxChars) && !exhausted && measures < BUDGET_LIMITS.maxMeasures) {
    const ratio = Math.max(1, bytes - reserve) / Math.max(1, chars);
    const safety = BUDGET_LIMITS.safety[Math.min(measures - 1, BUDGET_LIMITS.safety.length - 1)];
    const byBytes = (Math.max(0, limit - reserve) / ratio) * safety;
    const target = Math.floor(Math.min(maxChars, byBytes));
    exhausted = runSteps(work, { excess: chars - target }, cuts, withFullHtml);
    work.notes = [...baseNotes, ...cutNotes(cuts, limit)];
    ({ chars, bytes } = await sizeNow());
  }

  if (cuts.size) recount(work);
  if (withFullHtml && bytes > BUDGET_LIMITS.packageBytes) {
    work.notes.push(`Package exceeds ${sizeLabel(BUDGET_LIMITS.packageBytes)}: full HTML enabled by developer.`);
  }
  if (bytes > limit) work.notes.push(`Package is larger than ${sizeLabel(limit)} (${bytes} bytes) after all cuts.`);
  return { pkg: work, packageBytes: bytes, cuts: [...cuts].map(([step, removed]) => ({ step, removed })) };
}
