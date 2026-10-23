// Assembles the v3 snapshot package (docs/snapshot-schema.md, design E1 D12, E2 D9) from the current document's
// `collect` result, the per-document snapshots flushed on `pagehide` (D4) and the background's screenshot (E2 D5).
// Pure: no chrome.*, no DOM, no clock. Bundled into the console fallback too, so it imports only mask-secrets.js.

import { maskSecrets, cutPreview } from './mask-secrets.js';

export const SCHEMA_VERSION = 3;

export const RECORD_KEYS = ['consoleLogs', 'runtimeErrors', 'network', 'steps'];

// Key order is the order in the package (`limits` in the header).
export const DEFAULT_LIMITS = Object.freeze({
  consoleLogs: 5000,
  runtimeErrors: 1000,
  network: 5000,
  steps: 2000,
  entryChars: 40000,
  stackChars: 16000,
  responseBodyChars: 4096,
  responseBodyTotalChars: 262144,
  screenshotBytes: 307200,
  longTasks: 20,
});

const PAGE_SECTIONS = ['environment', 'performance', 'storage', 'dom'];
const NOTE_URL_MAX = 300;
const NOTE_TEXT_MAX = 200;

const LABELS = { consoleLogs: 'console logs', runtimeErrors: 'runtime errors', network: 'network requests', steps: 'steps' };

const METRICS = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'longTasks'];
const RATED_METRICS = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP'];
const GROWING_METRICS = ['LCP', 'CLS', 'INP'];
const CLS_SOURCES_MAX = 5;
const STATUS_UNAVAILABLE = ['unsupported-browser', 'unknown', 'cross-origin'];
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const SCREENSHOT_REASONS = ['save'];

const NOTE_NOT_FINAL = 'LCP, CLS and INP are values at the time of saving; they could still grow.';
const NOTE_NO_STATUS = 'HTTP statuses of the page and its files are not available in this browser.';

export function packageFileName(now) {
  return `page-debug-snapshot-${now}.json`;
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cap(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Reason the background stored when the ISOLATED bridge could not bind to MAIN (D3), or null.
function bridgeErrorOf(known) {
  return typeof known?.bridgeError === 'string' && known.bridgeError !== '' ? known.bridgeError : null;
}

function compareIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

function zeroCounts() {
  return { consoleLogs: 0, runtimeErrors: 0, network: 0, steps: 0 };
}

function zeroTruncated() {
  return { consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// `documentStatus` of the recorder: `{ status }` or `{ status: null, statusUnavailable }` (network-merge.js).
function statusOf(raw) {
  const status = typeof raw === 'number' ? raw : raw?.status;
  if (Number.isInteger(status) && status > 0) return { status, statusUnavailable: null };
  const reason = raw?.statusUnavailable;
  return { status: null, statusUnavailable: STATUS_UNAVAILABLE.includes(reason) ? reason : 'unknown' };
}

// One `vitals[]` entry: known metrics only, every metric present, lists capped.
function vitalsOf(raw, limits) {
  const out = {};
  for (const name of METRICS) {
    const metric = raw[name];
    if (!isObject(metric)) {
      out[name] = { available: false, reason: 'no-data' };
      continue;
    }
    const copy = { ...metric };
    if (name === 'CLS' && Array.isArray(copy.sources)) copy.sources = copy.sources.slice(0, CLS_SOURCES_MAX);
    if (name === 'longTasks' && Array.isArray(copy.items)) copy.items = copy.items.slice(0, limits.longTasks);
    out[name] = copy;
  }
  return out;
}

// A snapshot is either flat (`collect` result) or `{ docId, buffers }` (flush payload); dropped ones only carry counts.
function normalizeDoc(raw, isCurrent) {
  const buffers = raw.buffers && typeof raw.buffers === 'object' ? raw.buffers : raw;
  const records = {};
  const counts = zeroCounts();
  const truncated = zeroTruncated();
  for (const key of RECORD_KEYS) {
    records[key] = raw.dropped ? [] : (Array.isArray(buffers[key]) ? buffers[key] : []).filter((r) => r && finite(r.t) !== null);
    const counted = finite(buffers.counts?.[key] ?? raw.counts?.[key]);
    counts[key] = Math.max(counted ?? 0, records[key].length);
    truncated[key] = Boolean(buffers.truncated?.[key] ?? raw.truncated?.[key]) || (raw.dropped === true && counts[key] > 0);
  }
  truncated.responseBodies = Boolean(buffers.truncated?.responseBodies ?? raw.truncated?.responseBodies);
  const url = raw.url ?? (isCurrent ? raw.environment?.location?.href : undefined);
  const vitals = raw.dropped ? null : (buffers.vitals ?? raw.vitals);
  return {
    id: raw.docId ?? raw.id,
    url: typeof url === 'string' ? url : null,
    timeOrigin: finite(raw.timeOrigin),
    navigationType: typeof raw.navigationType === 'string' ? raw.navigationType : null,
    ...statusOf(buffers.documentStatus ?? raw.documentStatus),
    vitals: isObject(vitals) ? vitals : null,
    recorded: raw.recorded !== false,
    bridgeError: null,
    flushed: true,
    dropped: raw.dropped === true,
    current: isCurrent,
    records,
    counts,
    truncated,
  };
}

function placeholderDoc(known) {
  return {
    id: known.id,
    url: typeof known.url === 'string' ? known.url : null,
    timeOrigin: null,
    navigationType: null,
    status: null,
    statusUnavailable: 'unknown',
    vitals: null,
    recorded: known.recorded !== false && bridgeErrorOf(known) === null,
    bridgeError: bridgeErrorOf(known),
    flushed: false,
    dropped: false,
    current: false,
    records: { consoleLogs: [], runtimeErrors: [], network: [], steps: [] },
    counts: zeroCounts(),
    truncated: zeroTruncated(),
  };
}

// Second masking pass on response previews (MAIN may have been patched), cap per preview, then the package budget:
// the newest previews are kept; once the total would exceed it, older previews lose the field. Mutates the copies.
function limitResponseBodies(network, limits) {
  let total = 0;
  let over = false;
  for (let i = network.length - 1; i >= 0; i--) {
    const r = network[i];
    if (!('responseBodyPreview' in r) && !('responseBodyTruncated' in r)) continue;
    const raw = r.responseBodyPreview;
    delete r.responseBodyPreview;
    const wasTruncated = r.responseBodyTruncated === true;
    delete r.responseBodyTruncated;
    if (typeof raw !== 'string') continue;
    const { preview, truncated } = cutPreview(maskSecrets(raw).text, limits.responseBodyChars);
    if (over || total + preview.length > limits.responseBodyTotalChars) {
      over = true;
      continue;
    }
    total += preview.length;
    r.responseBodyPreview = preview;
    r.responseBodyTruncated = wasTruncated || truncated;
  }
  return over;
}

// Screenshots from the background (`captureScreenshot` shots): metadata in `screenshots[]`, bytes in `attachments`.
function screenshotsOf(shots, limits, doc, docIndex) {
  const screenshots = [];
  const attachments = {};
  if (!Array.isArray(shots) || doc === null) return { screenshots, attachments };
  for (const shot of shots) {
    const dataUrl = shot?.dataUrl;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(JPEG_PREFIX)) continue;
    const bytes = finite(shot.bytes);
    // base64 → bytes: 3/4 of the payload; a lying `bytes` cannot smuggle a larger image in.
    const decoded = Math.floor(((dataUrl.length - JPEG_PREFIX.length) * 3) / 4);
    if (bytes === null || bytes > limits.screenshotBytes || decoded > limits.screenshotBytes + 2) continue;
    const epochMs = finite(shot.epochMs);
    const id = `screenshot-${screenshots.length}`;
    screenshots.push({
      t: epochMs !== null && doc.timeOrigin !== null ? Math.round((epochMs - doc.timeOrigin) * 10) / 10 : null,
      doc: docIndex,
      reason: SCREENSHOT_REASONS.includes(shot.reason) ? shot.reason : 'save',
      mime: 'image/jpeg',
      width: finite(shot.width),
      height: finite(shot.height),
      bytes,
      attachment: id,
    });
    attachments[id] = dataUrl;
  }
  return { screenshots, attachments };
}

function describeCounts(counts) {
  return RECORD_KEYS.map((key) => `${counts[key]} ${LABELS[key]}`).join(', ');
}

/**
 * @param {object} input
 * @param {{ extensionVersion: string, source: 'extension'|'console', startedAt: number|string, collectedAt: number|string,
 *           stopReason?: string|null, limits?: object, deadline?: number,
 *           currentMissingReason?: 'loadedAfterStop',
 *           screenshots?: { epochMs: number, mime: string, width: number, height: number, bytes: number, dataUrl: string,
 *                           reason?: 'save' }[],
 *           screenshotNote?: string }} input.meta  `currentMissingReason`: why `current` is null, when known
 *           (`loadedAfterStop`: the tab has no recorder because it was loaded after the time limit stopped the recording).
 *           `screenshots`: `shot`s of `captureScreenshot` (epoch ms); `screenshotNote`: why there is none (goes to `notes`)
 * @param {object|null} input.current  parsed `collect` result of the current document, or null when unavailable;
 *           besides the v2 fields it may carry `steps`, `vitals`, `documentStatus`, `truncated.responseBodies`
 * @param {object[]} [input.priorDocs] snapshots from `pds:doc:*` (without the current docId); the same v3 fields
 *           flat or inside `buffers`
 * @param {{ id, url?, flushed?, recorded?, bridgeError? }[]} [input.docs] documents known to the background (`pds:rec.docs`), in opening order
 */
export function assemblePackage({ meta, current, priorDocs = [], docs = [] }) {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(isObject(meta.limits) ? meta.limits : {})) {
    if (key in DEFAULT_LIMITS && Number.isInteger(value) && value >= 0) limits[key] = value;
  }
  const deadline = finite(meta.deadline);
  const notes = [];

  const byId = new Map();
  for (const raw of Array.isArray(priorDocs) ? priorDocs : []) {
    if (!raw || typeof raw !== 'object') continue;
    const doc = normalizeDoc(raw, false);
    if (current && doc.id === current.docId) continue; // bfcache: older copy of the current document
    byId.set(doc.id, doc);
  }
  if (current) byId.set(current.docId, normalizeDoc(current, true));

  // Order: as opened (background list), then any remaining by id; the current document always last.
  const ordered = [];
  for (const known of Array.isArray(docs) ? docs : []) {
    if (!known || ordered.some((d) => d.id === known.id)) continue;
    const doc = byId.get(known.id);
    if (doc) {
      if (doc.url === null && typeof known.url === 'string') doc.url = known.url;
      doc.bridgeError = bridgeErrorOf(known);
      doc.recorded = doc.recorded && known.recorded !== false && doc.bridgeError === null;
      byId.delete(known.id);
      if (!doc.current) ordered.push(doc);
      else byId.set(known.id, doc);
    } else if (!current || known.id !== current.docId) {
      ordered.push(placeholderDoc(known));
    }
  }
  const rest = [...byId.values()].filter((d) => !d.current).sort((a, b) => compareIds(a.id, b.id));
  ordered.push(...rest);
  const currentDoc = [...byId.values()].find((d) => d.current);
  if (currentDoc) ordered.push(currentDoc);

  // Records: documents in order, by `t` inside a document; global limit keeps the newest.
  const out = {};
  const truncated = {};
  for (const key of RECORD_KEYS) {
    const all = [];
    ordered.forEach((doc, index) => {
      const sorted = doc.records[key]
        .filter((r) => deadline === null || doc.timeOrigin === null || doc.timeOrigin + r.t < deadline)
        .slice()
        .sort((a, b) => a.t - b.t);
      for (const r of sorted) {
        const copy = Object.assign({ t: r.t, doc: index }, r, { doc: index });
        // Input values never reach the package (AC-3.4); the recorder does not collect them, this is defence in depth.
        if (key === 'steps') delete copy.value;
        all.push(copy);
      }
    });
    const max = limits[key];
    const cut = Number.isInteger(max) && max >= 0 && all.length > max;
    out[key] = cut ? all.slice(all.length - max) : all;
    truncated[key] = cut || ordered.some((d) => d.truncated[key]);
    if (cut) notes.push(`Oldest ${key} entries were dropped to fit the limit of ${max}.`);
  }
  const bodiesOver = limitResponseBodies(out.network, limits);
  truncated.responseBodies = bodiesOver || ordered.some((d) => d.truncated.responseBodies);
  // One note whether the budget was applied here or already in the page (document buffer flag).
  if (truncated.responseBodies) {
    notes.push(`Older response previews were removed to fit the total limit of ${limits.responseBodyTotalChars} characters.`);
  }

  const documents = ordered.map((doc, index) => {
    const kept = zeroCounts();
    for (const key of RECORD_KEYS) kept[key] = out[key].filter((r) => r.doc === index).length;
    const status = doc.status === null ? { status: null, statusUnavailable: doc.statusUnavailable } : { status: doc.status };
    return {
      id: index,
      url: doc.url,
      timeOrigin: doc.timeOrigin,
      navigationType: doc.navigationType,
      ...status,
      recorded: doc.recorded,
      flushed: doc.flushed,
      current: doc.current,
      counts: doc.counts,
      kept,
    };
  });

  const startedIso = toIso(meta.startedAt);
  const source = meta.source === 'console' ? 'console' : 'extension';
  notes.unshift(source === 'console'
    ? `Recording started when the script was pasted at ${startedIso}; earlier data is not included.`
    : `Recording started at ${startedIso} (page reloaded); earlier data is not included.`);

  ordered.forEach((doc, index) => {
    const where = doc.url ? ` (${cap(doc.url, NOTE_URL_MAX)})` : '';
    if (doc.dropped) {
      notes.push(`Data of document ${index}${where} was dropped to fit the storage budget: ${describeCounts(doc.counts)} omitted.`);
    } else if (doc.bridgeError !== null) {
      notes.push(`Document ${index}${where} was not recorded: the recorder could not connect to the page (${cap(doc.bridgeError, NOTE_TEXT_MAX)}).`);
    } else if (!doc.flushed) {
      notes.push(`The data of document ${index} was not received${where}; its entries are missing.`);
    }
  });

  if (!current && meta.currentMissingReason === 'loadedAfterStop') {
    notes.push('The current page was not available: page was loaded after the recording stopped (time limit); package contains documents recorded before the limit. environment, dom, performance and storage are null.');
  } else if (!current) {
    notes.push('The current page was not available (it left the recorded origin or did not answer); environment, dom, performance and storage are null.');
  } else if (Array.isArray(current.errors)) {
    for (const err of current.errors.slice(0, PAGE_SECTIONS.length)) {
      notes.push(`Section ${cap(err?.section, NOTE_TEXT_MAX)} could not be collected (${cap(err?.error ?? err?.name, NOTE_TEXT_MAX)}).`);
    }
  }
  if (current) {
    // A section missing from `collect` without an entry in `errors[]` is still null in the package; say why.
    const failed = new Set((Array.isArray(current.errors) ? current.errors : []).map((err) => err?.section));
    for (const section of PAGE_SECTIONS) {
      if ((current[section] ?? null) === null && !failed.has(section)) notes.push(`Section ${section} was not received from the page.`);
    }
  }

  const stopped = meta.stopReason === 'time-limit' || current?.stopReason === 'time-limit';
  if (stopped) notes.push('Recording stopped automatically at the time limit; later activity is not included.');

  const vitals = [];
  ordered.forEach((doc, index) => {
    if (doc.vitals) vitals.push({ doc: index, ...vitalsOf(doc.vitals, limits) });
  });
  if (!vitals.length) notes.push('No page metrics were recorded.');
  else if (vitals.some((v) => GROWING_METRICS.some((name) => v[name].available !== false && v[name].finalized === false))) {
    notes.push(NOTE_NOT_FINAL);
  }
  if (!out.steps.length) notes.push('No user steps were recorded.');

  const unsupported = (r) => r.statusUnavailable === 'unsupported-browser';
  if (documents.some(unsupported) || out.network.some(unsupported)) notes.push(NOTE_NO_STATUS);

  // The screenshot belongs to the current document; without it, to the newest document with a time origin.
  let shotIndex = currentDoc ? ordered.length - 1 : -1;
  if (shotIndex < 0) shotIndex = ordered.findLastIndex((d) => d.timeOrigin !== null);
  const { screenshots, attachments } = screenshotsOf(meta.screenshots, limits, ordered[shotIndex] ?? null, shotIndex);
  if (!screenshots.length) {
    if (typeof meta.screenshotNote === 'string' && meta.screenshotNote !== '') notes.push(cap(meta.screenshotNote, NOTE_TEXT_MAX));
    else if (source === 'console') notes.push('Screenshots are not available without the extension.');
    else if (Array.isArray(meta.screenshots) && meta.screenshots.length) notes.push('No screenshot: the image could not be included.');
    else notes.push('No screenshot: none was taken.');
  }

  const failed = (r) => (typeof r.status === 'number' && r.status >= 400) || (r.error !== null && r.error !== undefined);
  const overview = {
    runtimeErrors: out.runtimeErrors.length,
    consoleErrors: out.consoleLogs.filter((r) => r.level === 'error').length,
    failedRequests: out.network.filter(failed).length,
    steps: out.steps.length,
    poorVitals: vitals.reduce((sum, v) => sum + RATED_METRICS.filter((name) => v[name].rating === 'poor').length, 0),
    screenshot: screenshots.length > 0,
  };

  const lastWithOrigin = [...documents].reverse().find((d) => d.timeOrigin !== null);
  // Built in the order of the package keys (AC-7.2): records before the page sections, `dom` the last text section,
  // `attachments` (binary data only) at the very end (PB-2 A).
  const pkg = {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: String(meta.extensionVersion ?? ''),
    source,
    collectedAt: toIso(meta.collectedAt),
    recordingStartedAt: startedIso,
    recordingStoppedReason: stopped ? 'time-limit' : null,
    timeOrigin: finite(current?.timeOrigin) ?? lastWithOrigin?.timeOrigin ?? null,
    overview,
    limits,
    truncated,
    documents,
    notes,
    steps: out.steps,
    runtimeErrors: out.runtimeErrors,
    network: out.network,
    vitals,
    screenshots,
    consoleLogs: out.consoleLogs,
  };
  for (const section of PAGE_SECTIONS) pkg[section] = current ? (current[section] ?? null) : null;
  pkg.attachments = attachments;
  return pkg;
}
