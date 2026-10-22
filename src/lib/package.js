// Assembles the v2 snapshot package (docs/snapshot-schema.md, design E1 D12) from the current document's
// `collect` result and the per-document snapshots flushed on `pagehide` (D4). Pure: no chrome.*, no DOM, no clock.

export const SCHEMA_VERSION = 2;

export const RECORD_KEYS = ['consoleLogs', 'runtimeErrors', 'network'];

export const DEFAULT_LIMITS = Object.freeze({ consoleLogs: 5000, runtimeErrors: 1000, network: 5000, entryChars: 10000 });

const PAGE_SECTIONS = ['environment', 'dom', 'performance', 'storage'];
const NOTE_URL_MAX = 300;
const NOTE_TEXT_MAX = 200;

const LABELS = { consoleLogs: 'console logs', runtimeErrors: 'runtime errors', network: 'network requests' };

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
  return { consoleLogs: 0, runtimeErrors: 0, network: 0 };
}

// A snapshot is either flat (`collect` result) or `{ docId, buffers }` (flush payload); dropped ones only carry counts.
function normalizeDoc(raw, isCurrent) {
  const buffers = raw.buffers && typeof raw.buffers === 'object' ? raw.buffers : raw;
  const records = {};
  const counts = zeroCounts();
  const truncated = { consoleLogs: false, runtimeErrors: false, network: false };
  for (const key of RECORD_KEYS) {
    records[key] = raw.dropped ? [] : (Array.isArray(buffers[key]) ? buffers[key] : []).filter((r) => r && finite(r.t) !== null);
    const counted = finite(buffers.counts?.[key] ?? raw.counts?.[key]);
    counts[key] = Math.max(counted ?? 0, records[key].length);
    truncated[key] = Boolean(buffers.truncated?.[key] ?? raw.truncated?.[key]) || (raw.dropped === true && counts[key] > 0);
  }
  const url = raw.url ?? (isCurrent ? raw.environment?.location?.href : undefined);
  return {
    id: raw.docId ?? raw.id,
    url: typeof url === 'string' ? url : null,
    timeOrigin: finite(raw.timeOrigin),
    navigationType: typeof raw.navigationType === 'string' ? raw.navigationType : null,
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
    recorded: known.recorded !== false && bridgeErrorOf(known) === null,
    bridgeError: bridgeErrorOf(known),
    flushed: false,
    dropped: false,
    current: false,
    records: { consoleLogs: [], runtimeErrors: [], network: [] },
    counts: zeroCounts(),
    truncated: { consoleLogs: false, runtimeErrors: false, network: false },
  };
}

function describeCounts(counts) {
  return RECORD_KEYS.map((key) => `${counts[key]} ${LABELS[key]}`).join(', ');
}

/**
 * @param {object} input
 * @param {{ extensionVersion: string, source: 'extension'|'console', startedAt: number|string, collectedAt: number|string,
 *           stopReason?: string|null, limits?: object, deadline?: number,
 *           currentMissingReason?: 'loadedAfterStop' }} input.meta  `currentMissingReason`: why `current` is null, when known
 *           (`loadedAfterStop`: the tab has no recorder because it was loaded after the time limit stopped the recording)
 * @param {object|null} input.current  parsed `collect` result of the current document, or null when unavailable
 * @param {object[]} [input.priorDocs] snapshots from `pds:doc:*` (without the current docId)
 * @param {{ id, url?, flushed?, recorded?, bridgeError? }[]} [input.docs] documents known to the background (`pds:rec.docs`), in opening order
 */
export function assemblePackage({ meta, current, priorDocs = [], docs = [] }) {
  const limits = { ...DEFAULT_LIMITS, ...(meta.limits ?? {}) };
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
      for (const r of sorted) all.push(Object.assign({ t: r.t, doc: index }, r, { doc: index }));
    });
    const max = limits[key];
    const cut = Number.isInteger(max) && max >= 0 && all.length > max;
    out[key] = cut ? all.slice(all.length - max) : all;
    truncated[key] = cut || ordered.some((d) => d.truncated[key]);
    if (cut) notes.push(`Oldest ${key} entries were dropped to fit the limit of ${max}.`);
  }

  const documents = ordered.map((doc, index) => {
    const kept = zeroCounts();
    for (const key of RECORD_KEYS) kept[key] = out[key].filter((r) => r.doc === index).length;
    return {
      id: index,
      url: doc.url,
      timeOrigin: doc.timeOrigin,
      navigationType: doc.navigationType,
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

  const stopped = meta.stopReason === 'time-limit' || current?.stopReason === 'time-limit';
  if (stopped) notes.push('Recording stopped automatically at the time limit; later activity is not included.');

  const lastWithOrigin = [...documents].reverse().find((d) => d.timeOrigin !== null);
  const pkg = {
    schemaVersion: SCHEMA_VERSION,
    extensionVersion: String(meta.extensionVersion ?? ''),
    source,
    collectedAt: toIso(meta.collectedAt),
    recordingStartedAt: startedIso,
    recordingStoppedReason: stopped ? 'time-limit' : null,
    timeOrigin: finite(current?.timeOrigin) ?? lastWithOrigin?.timeOrigin ?? null,
    documents,
    limits,
    truncated,
    notes,
  };
  for (const section of PAGE_SECTIONS) pkg[section] = current ? (current[section] ?? null) : null;
  for (const key of RECORD_KEYS) pkg[key] = out[key];
  return pkg;
}
