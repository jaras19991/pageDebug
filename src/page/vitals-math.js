// Pure metric math for Core Web Vitals (design D1, E2-T1a): ratings, CLS session windows, INP percentile,
// INP phases and the top long animation frames. No DOM and no observers here (those live in vitals.js),
// so every rule is checked with plain entry vectors. Definitions follow web.dev (as of E2); review them
// in every epic that touches metrics.

// [good, poor] upper bounds: value <= good → good, value <= poor → needs-improvement, above → poor.
export const THRESHOLDS = Object.freeze({
  LCP: Object.freeze([2500, 4000]),
  CLS: Object.freeze([0.1, 0.25]),
  INP: Object.freeze([200, 500]),
  FCP: Object.freeze([1800, 3000]),
  TTFB: Object.freeze([800, 1800]),
});

export const LONG_TASKS_MAX = 20;

// CLS session window: a shift starts a new window after a gap of 1 s or once the window would span 5 s.
const VITALS_CLS_GAP_MS = 1000;
const VITALS_CLS_WINDOW_MS = 5000;
// INP: interactions kept as candidates for the ~p98 pick, and one candidate skipped per 50 interactions.
const VITALS_INP_CANDIDATES = 10;
const VITALS_INP_PER_SKIP = 50;
// Limits for long-animation-frame script attribution (strings come from the page).
const VITALS_SCRIPTS_MAX = 10;
const VITALS_URL_MAX = 4000;
const VITALS_NAME_MAX = 500;

/** `items.map(fn)` as a loop: Array.prototype.map belongs to the page, which may replace it (AC-3.6). */
// Array copy of an array-like (entry lists, `sources`, `scripts`) by index: spread and for…of use the array iterator,
// which the page may replace (E4-IN2b).
export function vitalsList(items) {
  const out = [];
  const n = items ? items.length >>> 0 : 0;
  for (let i = 0; i < n; i++) out.push(items[i]);
  return out;
}

export function vitalsMap(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push(fn(items[i], i));
  return out;
}

export function rate(name, value) {
  const bounds = Object.prototype.hasOwnProperty.call(THRESHOLDS, name) ? THRESHOLDS[name] : null;
  if (!bounds || typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= bounds[0]) return 'good';
  if (value <= bounds[1]) return 'needs-improvement';
  return 'poor';
}

export function unavailable(reason) {
  return { available: false, reason };
}

// Largest session window of layout shifts without recent input. `t` is the start time of the window's
// last shift (when the value was reached); `value` is rounded to 3 places.
export function clsFromShifts(entries) {
  const shifts = (entries || []).filter((e) => e && !e.hadRecentInput).slice().sort((a, b) => a.startTime - b.startTime);
  let best = [];
  let bestValue = 0;
  let current = [];
  let currentValue = 0;
  for (let i = 0; i < shifts.length; i++) {
    const entry = shifts[i];
    const first = current[0];
    const last = current[current.length - 1];
    if (current.length && entry.startTime - last.startTime < VITALS_CLS_GAP_MS
      && entry.startTime - first.startTime < VITALS_CLS_WINDOW_MS) {
      current.push(entry);
      currentValue += entry.value;
    } else {
      current = [entry];
      currentValue = entry.value;
    }
    if (currentValue > bestValue) {
      bestValue = currentValue;
      best = current.slice();
    }
  }
  return {
    value: Math.round(bestValue * 1000) / 1000,
    t: best.length ? best[best.length - 1].startTime : null,
    windowEntries: best,
  };
}

// INP from `event` entries: one interaction per interactionId > 0 (its longest entry). Fewer than 50
// interactions → the longest; otherwise skip one of the longest per 50 interactions (~p98).
export function inpFromEvents(entries) {
  const longest = new Map();
  const list = vitalsList(entries);
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || !(entry.interactionId > 0)) continue;
    const seen = longest.get(entry.interactionId);
    if (!seen || entry.duration > seen.duration) longest.set(entry.interactionId, entry);
  }
  const count = longest.size;
  if (count === 0) return null;
  const values = [];
  longest.forEach((value) => { values.push(value); });
  const candidates = values.sort((a, b) => b.duration - a.duration).slice(0, VITALS_INP_CANDIDATES);
  const entry = candidates[Math.min(candidates.length - 1, Math.floor(count / VITALS_INP_PER_SKIP))];
  return { value: entry.duration, entry, count };
}

export function inpPhases(entry) {
  const clamp = (value) => (value > 0 ? value : 0);
  return {
    inputDelay: clamp(entry.processingStart - entry.startTime),
    processing: clamp(entry.processingEnd - entry.processingStart),
    presentation: clamp(entry.startTime + entry.duration - entry.processingEnd),
  };
}

function vitalsCap(value, max) {
  if (typeof value !== 'string') return value === undefined ? null : value;
  return value.length > max ? value.slice(0, max) : value;
}

// The `max` long animation frames with the highest blockingDuration, with script attribution.
export function topLongTasks(loafs, max = LONG_TASKS_MAX) {
  const top = (loafs || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => b.blockingDuration - a.blockingDuration)
    .slice(0, max);
  return vitalsMap(top, (loaf) => ({
    t: loaf.startTime,
    duration: loaf.duration,
    blockingDuration: loaf.blockingDuration,
    scripts: vitalsMap(vitalsList(loaf.scripts).slice(0, VITALS_SCRIPTS_MAX), (script) => ({
      url: vitalsCap(script.sourceURL, VITALS_URL_MAX),
      function: vitalsCap(script.sourceFunctionName, VITALS_NAME_MAX),
      invoker: vitalsCap(script.invoker, VITALS_NAME_MAX),
      duration: script.duration,
    })),
  }));
}
