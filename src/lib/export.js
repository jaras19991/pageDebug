// Export pipeline of the package (design E3 D1, D7, D8): one module for the background and the console fallback.
//   assemble (package.js) → first cut to ≤ 10 MB of JSON (budget.js, whole entries only) → redact (redact.js)
//   → size budget with real compression (budget.js) → `redaction` block from the markers present → snapshot.json
//   → summary.md (summary.js, from the redacted object) → zip (zip.js): snapshot.json, summary.md, screenshot.jpg?
// The first cut bounds the cost of redaction (~65 ms per MB): data past the 10 MB unpacked limit would be cut anyway.
// It must not shorten strings: a value cut before redaction may keep half of a secret the rules no longer recognise
// (`{"password":"correct hor`, `jan@`). Strings it shortened get their full value back and are cut after redaction.
// Pure: no chrome.*, no DOM, no clock except the default `date`. No top-level await (bundled into src/page).

import { assembleParts, SCREENSHOT_FILE } from './package.js';
import { redact, countMarkers, resolveDisabledRules } from './redact.js';
import { RULES_VERSION } from './redact-rules.js';
import { fitBudget, cutHtml, cutText, BUDGET_LIMITS } from './budget.js';
import { buildSummary } from './summary.js';
import { createZip, deflateRaw, fromBase64 } from './zip.js';
import { snapshotFileName } from './file-name.js';

export const EXPORT_LIMITS = Object.freeze({
  // Unpacked JSON the redaction pass gets at most (the NFR limit of snapshot.json).
  redactJsonChars: BUDGET_LIMITS.jsonChars,
  // Added to every measurement of snapshot.json: summary.md and the zip headers (the JPEG is added on top).
  summaryReserveBytes: 16384,
});

export const EXPORT_NOTES = Object.freeze({
  notCompressed: 'The package is not compressed (this browser cannot compress).',
  structureAfterRedaction: (limit) => `dom.structure was cut to ${limit} characters after redaction.`,
  // QA F-2: each cut note counts one cut; this one gives the whole loss of a record section.
  recordLoss: (key, recorded, kept) => `${key}: ${recorded} recorded, ${kept} in the package; ${recorded - kept} were not included `
    + '(recording limits, time limit or package size limit).',
});
const RECORD_KEYS = ['consoleLogs', 'runtimeErrors', 'network', 'steps'];

// Local header + central directory entry + end record of a one-entry zip named snapshot.json.
const NOTE_NO_IMAGE = 'No screenshot: the image could not be included.';
const ZIP_OVERHEAD = 30 + 46 + 22 + 2 * 'snapshot.json'.length;
// Budget steps that shorten strings instead of removing entries (budget.js STEPS).
const STRING_STEPS = new Set(['fullHtml', 'html', 'storage', 'stacks']);
const STRING_FLAGS = { fullHtml: 'html', html: 'html', storage: 'storage', stacks: 'stacks' };
const encoder = new TextEncoder();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const encodeJson = (pkg) => encoder.encode(JSON.stringify(pkg, null, 2));

async function canCompress() {
  return (await deflateRaw(new Uint8Array([0]))) !== null;
}

// Compressed size of snapshot.json as a zip entry (stored size when the browser cannot compress).
async function measureJson(pkg) {
  const data = encodeJson(pkg);
  const deflated = await deflateRaw(data);
  return (deflated === null ? data.length : Math.min(deflated.length, data.length)) + ZIP_OVERHEAD;
}

// Notes of both budget passes: one note per kind of cut, counts added (`1500 oldest …` + `40 oldest …` → `1540 oldest …`).
function mergeCutNotes(notes, from) {
  const out = notes.slice(0, from);
  const seen = new Map();
  for (const note of notes.slice(from)) {
    const m = /^(\d+) ([^]*)$/.exec(note);
    const kind = m ? m[2] : note;
    if (!seen.has(kind)) {
      seen.set(kind, out.length);
      out.push(note);
    } else if (m) {
      const at = seen.get(kind);
      out[at] = `${Number(/^\d+/.exec(out[at])[0]) + Number(m[1])} ${kind}`;
    }
  }
  return out;
}

// Sections with fewer entries in the package than the documents recorded (`documents[].counts`), whatever removed them.
function recordLossNotes(pkg) {
  const documents = Array.isArray(pkg.documents) ? pkg.documents : [];
  const notes = [];
  for (const key of RECORD_KEYS) {
    let recorded = 0;
    for (const doc of documents) if (Number.isFinite(doc?.counts?.[key])) recorded += doc.counts[key];
    const kept = Array.isArray(pkg[key]) ? pkg[key].length : 0;
    if (recorded > kept) notes.push(EXPORT_NOTES.recordLoss(key, recorded, kept));
  }
  return notes;
}

/**
 * First cut before redaction: whole entries only, towards `redactJsonChars` of JSON. Values that the budget shortened
 * (structure, storage values, stacks) get their full value back; full HTML is set aside (the second pass cuts it).
 * @returns {Promise<{ pkg: object, baseNotes: number }>} `baseNotes`: notes of the package before any cut
 */
async function cutBeforeRedaction(pkg) {
  const baseNotes = Array.isArray(pkg.notes) ? pkg.notes.length : 0;
  const fullHtml = isObject(pkg.dom) && typeof pkg.dom.fullHtml === 'string' ? pkg.dom.fullHtml : null;
  const input = fullHtml === null ? pkg : { ...pkg, dom: { ...pkg.dom, fullHtml: null } };
  const { pkg: cut, cuts } = await fitBudget(input, { measure: async () => 0, maxJsonChars: EXPORT_LIMITS.redactJsonChars });
  if (fullHtml !== null) cut.dom.fullHtml = fullHtml;
  if (!cuts.length) return { pkg: cut, baseNotes };

  const restored = new Set(cuts.filter((c) => STRING_STEPS.has(c.step)).map((c) => c.step));
  if (restored.has('html')) cut.dom.structure = pkg.dom.structure;
  if (restored.has('storage')) cut.storage = pkg.storage;
  if (restored.has('stacks')) {
    // Runtime errors are never removed, so the lists match by index; a console entry with a shortened stack is dropped.
    if (Array.isArray(pkg.runtimeErrors)) cut.runtimeErrors = pkg.runtimeErrors;
    if (Array.isArray(pkg.consoleLogs) && Array.isArray(cut.consoleLogs)) {
      const original = new Set(pkg.consoleLogs);
      cut.consoleLogs = cut.consoleLogs.filter((entry) => original.has(entry));
    }
  }
  for (const step of restored) cut.truncated[STRING_FLAGS[step]] = pkg.truncated?.[STRING_FLAGS[step]] === true;
  // budget.js writes one note per step, in the order of `cuts`, right after the package's own notes.
  const cutNotes = cut.notes.slice(baseNotes, baseNotes + cuts.length).filter((_, i) => !restored.has(cuts[i].step));
  cut.notes = [...cut.notes.slice(0, baseNotes), ...cutNotes];
  return { pkg: cut, baseNotes };
}

// A marker can be longer than the value it replaced (`a@b.pl` → `[redacted:email]`), so a structure the collector kept
// under `limits.html` may grow past it: cut again at an element boundary with open tags closed (mutates the redacted copy).
function capStructure(pkg) {
  const limit = pkg.limits?.html;
  const structure = pkg.dom?.structure;
  if (!Number.isInteger(limit) || limit <= 0 || typeof structure !== 'string' || structure.length <= limit) return;
  pkg.dom = { ...pkg.dom, structure: cutHtml(structure, limit) };
  if (isObject(pkg.truncated) && pkg.truncated.html !== true) {
    pkg.truncated = { ...pkg.truncated, html: true };
    if (Array.isArray(pkg.notes)) pkg.notes.push(EXPORT_NOTES.structureAfterRedaction(limit));
  }
}

// The same for the other strings with a limit in the schema (E3-PD1): a console entry capped to `{ truncated, preview }`
// (entryChars), stacks (stackChars) and response previews (responseBodyChars each, responseBodyTotalChars together).
// Cut at a word boundary, never inside a marker (budget.js cutText); mutates the redacted copy.
function capStrings(pkg) {
  const limits = isObject(pkg.limits) ? pkg.limits : {};
  const cap = (text, max) => (typeof text === 'string' && Number.isInteger(max) && max >= 0 && text.length > max ? cutText(text, max) : text);
  const capStack = (entry) => {
    if (isObject(entry) && typeof entry.stack === 'string') entry.stack = cap(entry.stack, limits.stackChars);
  };
  if (Array.isArray(pkg.runtimeErrors)) pkg.runtimeErrors.forEach(capStack);
  if (Array.isArray(pkg.consoleLogs)) {
    for (const entry of pkg.consoleLogs) {
      capStack(entry);
      if (isObject(entry?.args) && typeof entry.args.preview === 'string') entry.args.preview = cap(entry.args.preview, limits.entryChars);
    }
  }
  if (!Array.isArray(pkg.network)) return;
  const previews = pkg.network.filter((entry) => isObject(entry) && typeof entry.responseBodyPreview === 'string');
  const shorten = (entry, max) => {
    const cut = cap(entry.responseBodyPreview, max);
    if (cut === entry.responseBodyPreview) return;
    entry.responseBodyPreview = cut;
    entry.responseBodyTruncated = true;
  };
  for (const entry of previews) shorten(entry, limits.responseBodyChars);
  const total = limits.responseBodyTotalChars;
  if (!Number.isInteger(total) || total < 0) return;
  // Over the total: the oldest previews give the excess back, like the package and recorder budgets (package.js
  // limitResponseBodies, recorder.js) — the newest ones, usually the failing response, stay whole (review E3 N11).
  let excess = previews.reduce((sum, entry) => sum + entry.responseBodyPreview.length, 0) - total;
  for (let i = 0; i < previews.length && excess > 0; i++) {
    const before = previews[i].responseBodyPreview.length;
    shorten(previews[i], Math.max(0, before - excess));
    excess -= before - previews[i].responseBodyPreview.length;
  }
}

/**
 * Redacts, fits and zips an assembled v4 package (the second half of `exportPackage`).
 * @param {object} assembled  assemblePackage() output (not redacted; not changed)
 * @param {{ screenshot?: Uint8Array|null, devOptions?: { disabledRules?: string[] }, date?: Date, origin?: string }} [options]
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, packageBytes: number, snapshot: object }>}
 */
export async function exportAssembled(assembled, { screenshot = null, devOptions = {}, date = new Date(), origin } = {}) {
  const disabledRules = resolveDisabledRules(devOptions?.disabledRules);
  const compress = await canCompress();

  const { pkg: trimmed, baseNotes } = await cutBeforeRedaction(assembled);
  const { snapshot: redacted } = redact(trimmed, { disabledRules });
  capStructure(redacted);
  capStrings(redacted);

  const shots = Array.isArray(redacted.screenshots) && redacted.screenshots.length > 0;
  const image = shots && screenshot instanceof Uint8Array && screenshot.length > 0 ? screenshot : null;
  if (shots && image === null) {
    // Metadata without bytes would name a missing zip entry.
    redacted.screenshots = [];
    if (isObject(redacted.overview)) redacted.overview.screenshot = false;
    if (Array.isArray(redacted.notes)) redacted.notes.push(NOTE_NO_IMAGE);
  }
  const reserveBytes = EXPORT_LIMITS.summaryReserveBytes + (image ? image.length : 0);
  const { pkg: snapshot } = await fitBudget(redacted, { measure: measureJson, reserveBytes });

  snapshot.notes = mergeCutNotes(snapshot.notes, baseNotes);
  if (Array.isArray(snapshot.notes)) snapshot.notes.push(...recordLossNotes(snapshot));
  if (!compress) snapshot.notes.push(EXPORT_NOTES.notCompressed);
  snapshot.redaction = { rulesVersion: RULES_VERSION, disabledRules, masked: countMarkers(snapshot).masked };

  const files = [
    { name: 'snapshot.json', data: encodeJson(snapshot), compress: true },
    { name: 'summary.md', data: encoder.encode(buildSummary(snapshot)), compress: true },
  ];
  if (image) files.push({ name: SCREENSHOT_FILE, data: image, compress: false });
  const { bytes } = await createZip(files, { date });

  const where = origin ?? [...(Array.isArray(assembled.documents) ? assembled.documents : [])].reverse().find((d) => typeof d?.url === 'string')?.url;
  return { bytes, fileName: snapshotFileName({ origin: where, date }), packageBytes: bytes.length, snapshot };
}

/**
 * The whole export (D8): assemble → redact → budget → summary → zip.
 * @param {{ input: object, devOptions?: { disabledRules?: string[] }, date?: Date, origin?: string }} options
 *        `input`: assemblePackage() input; `devOptions`: developer configuration (D12; `html-structure` turns on full
 *        HTML); `date`: local time of the file name and of the zip entries; `origin`: recorded origin for the file name
 *        (default: the URL of the last document)
 * @returns {Promise<{ bytes: Uint8Array, fileName: string, packageBytes: number, snapshot: object }>}
 */
export async function exportPackage({ input, devOptions = {}, date = new Date(), origin } = {}) {
  const fullHtml = resolveDisabledRules(devOptions?.disabledRules).includes('html-structure');
  const { pkg, screenshotDataUrl } = assembleParts({ ...input, meta: { ...input.meta, fullHtml } });
  let screenshot = null;
  if (screenshotDataUrl !== null) {
    try {
      screenshot = fromBase64(screenshotDataUrl.slice(screenshotDataUrl.indexOf(',') + 1));
    } catch {
      screenshot = null; // invalid base64: exportAssembled drops the metadata with a note
    }
  }
  return exportAssembled(pkg, { screenshot, devOptions, date, origin });
}
