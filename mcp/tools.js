// The seven tools of the MCP server (E4 D6, E4-T4c, AC-5.1–5.8). Every answer is built by the shared modules in
// src/lib (summary, query, metrics, diff), so `get_summary` is byte-identical with summary.md of the package (AC-5.3).
// Answers are compact JSON (get_summary: markdown) with absolute (ISO) and relative (seconds from the recording start)
// times. Size: list answers drop their last items until the JSON fits MAX_RESPONSE_CHARS (valid JSON with a `hint`);
// capResponse() is the final guard for any text (AC-5.7). Read-only: packages come from snapshots-dir.js only.
// Argument errors are thrown with a Polish message; the server turns them into a tool result with `isError: true`.

import { createSnapshotDir } from './snapshots-dir.js';
import { readPackage } from '../src/lib/package-reader.js';
import { buildSummary } from '../src/lib/summary.js';
import { errorGroups, stepList, filterNetwork, absTime, recordingStartMs } from '../src/lib/snapshot-query.js';
import { METRIC_NAMES, RATING_PL, REASON_PL, vitalsByDoc } from '../src/lib/snapshot-metrics.js';
import { diffSnapshots } from '../src/lib/snapshot-diff.js';
import { UNREDACTED_WARNING } from '../src/lib/migrate.js';

/** Longest text of one tool answer, characters (AC-5.7). */
export const MAX_RESPONSE_CHARS = 25_000;

export const TOOL_LIMITS = Object.freeze({
  // Characters kept of a stack in get_errors (AC-5.4).
  stackChars: 4000,
  // Characters kept of a URL, a step label, a request body.
  urlChars: 2000,
  labelChars: 300,
  bodyChars: 4096,
  // Documents shown by get_vitals (newest).
  vitalsDocs: 20,
});

export const TOOL_NAMES = Object.freeze([
  'list_snapshots', 'get_summary', 'get_errors', 'get_network', 'get_vitals', 'get_steps', 'diff_snapshots',
]);

const STATUS_KEY_NOTE = 'Statusy porównywane po metodzie i ścieżce URL bez hosta, query i fragmentu (staging i produkcja dają te same klucze).';

/**
 * Cuts `text` to MAX_RESPONSE_CHARS, ending with „… ucięto N znaków; zawęź zapytanie: <hint>”.
 * @param {string} text
 * @param {string} hint  how to narrow the query (Polish)
 */
export function capResponse(text, hint) {
  if (text.length <= MAX_RESPONSE_CHARS) return text;
  const note = (n) => `\n… ucięto ${n} znaków; zawęź zapytanie: ${hint}`;
  let keep = Math.max(0, MAX_RESPONSE_CHARS - note(text.length).length);
  const last = text.charCodeAt(keep - 1);
  if (keep > 0 && last >= 0xd800 && last <= 0xdbff) keep--; // never split a surrogate pair
  return text.slice(0, keep) + note(text.length - keep);
}

// The largest n (≤ count) for which `build(n)` fits, as JSON; `build(n)` must grow with n. Binary search: log2(count) stringifies.
function fitJson(count, build, hint) {
  const full = JSON.stringify(build(count, null));
  if (full.length <= MAX_RESPONSE_CHARS) return full;
  const noteOf = (n) => `Pominięto ${count - n} z ${count} pozycji (limit odpowiedzi ${MAX_RESPONSE_CHARS} znaków); zawęź zapytanie: ${hint}`;
  let lo = 0;
  let hi = count - 1;
  let best = JSON.stringify(build(0, noteOf(0)));
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const text = JSON.stringify(build(mid, noteOf(mid)));
    if (text.length <= MAX_RESPONSE_CHARS) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return capResponse(best, hint);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const capText = (v, max) => (typeof v === 'string' && v.length > max ? v.slice(0, max) : v);
const iso = (ms) => (typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null);
const seconds = (sec) => (typeof sec === 'number' && Number.isFinite(sec) ? Math.round(sec * 1000) / 1000 : null);
const relOf = (start, at) => (start === null || at === null ? null : seconds((at - start) / 1000));

function intArg(args, key, { def, min, max }) {
  const v = args[key];
  if (v === undefined || v === null) return def;
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Nieprawidłowy parametr ${key}: podaj liczbę całkowitą od ${min} do ${max}.`);
  return v;
}

function boolArg(args, key, def) {
  const v = args[key];
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') throw new Error(`Nieprawidłowy parametr ${key}: podaj true albo false.`);
  return v;
}

function strArg(args, key) {
  const v = args[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > 500) throw new Error(`Nieprawidłowy parametr ${key}: podaj tekst (do 500 znaków).`);
  return v;
}

const STATUS_HELP = 'Nieprawidłowy parametr status: podaj kod (404), klasę (4xx, 5xx, error) albo zakres (400-499).';

// status: 404 | "404" | "4xx" | "error" | "400-499" → filterNetwork options.
function statusFilter(value) {
  if (value === undefined || value === null || value === '') return {};
  if (Number.isInteger(value)) {
    if (value < 100 || value > 599) throw new Error(STATUS_HELP);
    return { statusRange: [value, value] };
  }
  if (typeof value !== 'string') throw new Error(STATUS_HELP);
  const text = value.trim().toLowerCase();
  if (/^[2-5]xx$/.test(text) || text === 'error') return { statusClass: text };
  const exact = /^(\d{3})$/.exec(text);
  if (exact) return { statusRange: [Number(exact[1]), Number(exact[1])] };
  const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(text);
  if (range && Number(range[1]) <= Number(range[2])) return { statusRange: [Number(range[1]), Number(range[2])] };
  throw new Error(STATUS_HELP);
}

function stepOut(step) {
  if (!step) return null;
  const out = { at: iso(step.at), rel: seconds(step.rel), doc: step.doc ?? null, type: step.type, label: capText(step.label, TOOL_LIMITS.labelChars) };
  if (typeof step.url === 'string') out.url = capText(step.url, TOOL_LIMITS.urlChars);
  return out;
}

function documentOrigin(s, docId) {
  const docs = Array.isArray(s.documents) ? s.documents : [];
  const doc = docs.find((d) => isObject(d) && d.id === docId);
  return doc && typeof doc.timeOrigin === 'number' ? doc.timeOrigin : null;
}

function metricOut(s, docId, m, start) {
  if (!m.available) return { available: false, reason: m.reason, reasonText: REASON_PL[m.reason] ?? m.reason };
  const details = { ...m.entry };
  for (const key of ['available', 'value', 'rating', 't']) delete details[key];
  const t = m.entry.t;
  const at = typeof t === 'number' ? absTime(s, { doc: docId, t }) : null;
  return {
    available: true, value: m.value, rating: m.rating, ratingText: m.rating ? RATING_PL[m.rating] : null,
    at: iso(at), rel: relOf(start, at), details,
  };
}

function requestOut(s, start, { index, entry }, { includeHeaders, includeBody }) {
  const at = absTime(s, entry);
  const out = {
    index, at: iso(at), rel: relOf(start, at), doc: entry.doc ?? null,
    type: entry.type ?? null, method: entry.method ?? null, url: capText(entry.url ?? null, TOOL_LIMITS.urlChars),
    status: entry.status ?? null, statusText: entry.statusText ?? null, ok: entry.ok ?? null,
    durationMs: entry.durationMs ?? null, sizeBytes: entry.sizeBytes ?? null, error: entry.error ?? null,
  };
  if (entry.statusUnavailable) out.statusUnavailable = entry.statusUnavailable;
  if (includeHeaders) {
    out.requestHeaders = isObject(entry.requestHeaders) ? entry.requestHeaders : {};
    out.responseHeaders = isObject(entry.responseHeaders) ? entry.responseHeaders : {};
  }
  if (includeBody) {
    const body = entry.requestBody ?? null;
    out.requestBody = capText(body, TOOL_LIMITS.bodyChars);
    if (typeof body === 'string' && body.length > TOOL_LIMITS.bodyChars) out.requestBodyTruncated = true;
    out.responseBodyPreview = capText(entry.responseBodyPreview ?? null, TOOL_LIMITS.bodyChars);
    out.responseBodyTruncated = entry.responseBodyTruncated === true
      || (typeof entry.responseBodyPreview === 'string' && entry.responseBodyPreview.length > TOOL_LIMITS.bodyChars);
  }
  return out;
}

const idSchema = { type: 'string', description: 'Nazwa pliku paczki z list_snapshots (np. „debug-….zip”), bez ścieżki.' };

/**
 * @param {string} dir  absolute snapshots directory
 * @param {{ readPackage?: Function, fs?: object }} [deps]  injected for tests
 * @returns {Array<{ name: string, description: string, inputSchema: object, handler: (args: object) => Promise<string> }>}
 */
export function createTools(dir, { readPackage: reader = readPackage, fs } = {}) {
  const snapshots = createSnapshotDir(dir, fs ? { readPackage: reader, fs } : { readPackage: reader });
  const snapshotOf = async (id) => (await snapshots.open(id)).snapshot;

  return [
    {
      name: 'list_snapshots',
      description: 'Lista paczek Page Debug Snapshot w katalogu, od najnowszej: id (nazwa pliku), host, collectedAt, schemaVersion, '
        + 'liczby z overview (błędy, nieudane zapytania, kroki), warnings (np. paczka sprzed automatycznej redakcji). '
        + 'Paczka, której nie da się odczytać, ma pole error. Zacznij od tego narzędzia.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Ile najnowszych paczek pokazać.' } },
        additionalProperties: false,
      },
      async handler(args) {
        const limit = intArg(args, 'limit', { def: 50, min: 1, max: 200 });
        const { items, total } = await snapshots.list();
        const shown = items.slice(0, limit);
        return fitJson(shown.length, (n, hint) => ({
          total, returned: n, more: total - n, items: shown.slice(0, n), ...(hint ? { hint } : {}),
        }), 'zmniejsz limit');
      },
    },
    {
      name: 'get_summary',
      description: 'Podsumowanie paczki po polsku (markdown, ten sam tekst co summary.md w zipie): środowisko, kroki, błędy, '
        + 'nieudane zapytania, Core Web Vitals, najwolniejsze zasoby, ciasteczka, prywatność, uwagi.',
      inputSchema: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      async handler(args) {
        const { snapshot, warnings } = await snapshots.open(args.id);
        // A package from before automatic redaction (E4-FIX2): the note above the summary, which stays as in summary.md.
        const note = warnings.some((w) => w?.code === 'unredacted') ? `Uwaga: ${UNREDACTED_WARNING}.\n\n` : '';
        return capResponse(note + buildSummary(snapshot), 'użyj get_errors, get_network lub get_steps');
      },
    },
    {
      name: 'get_errors',
      description: 'Błędy JS i console.error zgrupowane po komunikacie, w kolejności pierwszego wystąpienia: liczba, czas pierwszego '
        + '(ISO i sekundy od startu nagrania), pierwsza ramka, pełny stos (do 4000 znaków), ostatni krok użytkownika przed błędem.',
      inputSchema: {
        type: 'object',
        properties: { id: idSchema, limit: { type: 'integer', minimum: 1, maximum: 200, default: 10, description: 'Ile grup błędów pokazać.' } },
        required: ['id'],
        additionalProperties: false,
      },
      async handler(args) {
        const limit = intArg(args, 'limit', { def: 10, min: 1, max: 200 });
        const s = await snapshotOf(args.id);
        const { groups, more } = errorGroups(s, { limit });
        const o = isObject(s.overview) ? s.overview : {};
        const out = groups.map((g) => {
          const item = {
            message: g.message, count: g.count, firstAt: iso(g.firstAt), firstRel: seconds(g.firstRel), frame: g.frame,
            stack: capText(g.stack, TOOL_LIMITS.stackChars), stepBefore: stepOut(g.stepBefore),
          };
          if (typeof g.stack === 'string' && g.stack.length > TOOL_LIMITS.stackChars) item.stackTruncated = true;
          return item;
        });
        return fitJson(out.length, (n, hint) => ({
          id: args.id,
          overview: { runtimeErrors: o.runtimeErrors ?? null, consoleErrors: o.consoleErrors ?? null },
          total: groups.length + more, more: groups.length + more - n, groups: out.slice(0, n), ...(hint ? { hint } : {}),
        }), 'zmniejsz limit');
      },
    },
    {
      name: 'get_network',
      description: 'Zapytania sieciowe z filtrem. Domyślnie tylko nieudane (status ≥ 400 lub błąd sieci); podanie status wyłącza '
        + 'to domyślne zawężenie. Wynik: matched (pasujące), returned, remaining (do pobrania przez offset). Nagłówki i treść '
        + '(już zredagowane) tylko przy includeHeaders/includeBody.',
      inputSchema: {
        type: 'object',
        properties: {
          id: idSchema,
          status: {
            type: ['integer', 'string'],
            description: 'Kod (404), klasa (2xx, 3xx, 4xx, 5xx, error = bez odpowiedzi) albo zakres (400-499).',
          },
          failedOnly: { type: 'boolean', description: 'Tylko nieudane. Domyślnie true, gdy nie podano status.' },
          type: { type: 'string', description: 'Typ zapytania, np. fetch, xhr, script, img, css, font, other.' },
          method: { type: 'string', description: 'Metoda HTTP (bez rozróżniania wielkości liter).' },
          urlContains: { type: 'string', description: 'Fragment adresu (bez rozróżniania wielkości liter).' },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          includeHeaders: { type: 'boolean', default: false },
          includeBody: { type: 'boolean', default: false, description: 'Treść żądania i podgląd odpowiedzi (do 4096 znaków).' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      async handler(args) {
        const status = statusFilter(args.status);
        const filter = {
          ...status,
          failedOnly: boolArg(args, 'failedOnly', args.status === undefined || args.status === null || args.status === ''),
          type: strArg(args, 'type'),
          method: strArg(args, 'method'),
          urlContains: strArg(args, 'urlContains'),
        };
        const limit = intArg(args, 'limit', { def: 50, min: 1, max: 500 });
        const offset = intArg(args, 'offset', { def: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
        const options = { includeHeaders: boolArg(args, 'includeHeaders', false), includeBody: boolArg(args, 'includeBody', false) };
        const s = await snapshotOf(args.id);
        const { items, total } = filterNetwork(s.network, filter);
        const start = recordingStartMs(s);
        const page = items.slice(offset, offset + limit).map((item) => requestOut(s, start, item, options));
        return fitJson(page.length, (n, hint) => ({
          id: args.id, total, matched: items.length, offset, returned: n,
          remaining: Math.max(0, items.length - offset - n), items: page.slice(0, n), ...(hint ? { hint } : {}),
        }), 'zmniejsz limit, użyj offset, status, type, urlContains albo wyłącz includeHeaders/includeBody');
      },
    },
    {
      name: 'get_vitals',
      description: 'Core Web Vitals (TTFB, FCP, LCP, CLS, INP) per dokument: wartość, ocena (good / needs-improvement / poor), czas '
        + 'pomiaru (ISO i sekundy od startu), atrybucja; brak wartości ma powód (reason), nigdy zmyślone 0. Plus długie zadania.',
      inputSchema: { type: 'object', properties: { id: idSchema }, required: ['id'], additionalProperties: false },
      async handler(args) {
        const s = await snapshotOf(args.id);
        const start = recordingStartMs(s);
        const { docs, more } = vitalsByDoc(s, { last: TOOL_LIMITS.vitalsDocs });
        const out = docs.map((d) => {
          const metrics = {};
          for (const name of METRIC_NAMES) metrics[name] = metricOut(s, d.doc, d.metrics[name], start);
          return { doc: d.doc, url: capText(d.url, TOOL_LIMITS.urlChars), timeOrigin: iso(documentOrigin(s, d.doc)), metrics, longTasks: d.longTasks };
        });
        return capResponse(JSON.stringify({ id: args.id, docs: out, more }), 'użyj get_summary (sekcja CWV)');
      },
    },
    {
      name: 'get_steps',
      description: 'Ostatnie kroki użytkownika (kliknięcia, wpisywanie bez wartości, nawigacje) chronologicznie, z czasem ISO i '
        + 'sekundami od startu nagrania; beforeFirstError oznacza ostatni krok przed pierwszym błędem.',
      inputSchema: {
        type: 'object',
        properties: { id: idSchema, limit: { type: 'integer', minimum: 1, maximum: 2000, default: 50, description: 'Ile ostatnich kroków pokazać.' } },
        required: ['id'],
        additionalProperties: false,
      },
      async handler(args) {
        const limit = intArg(args, 'limit', { def: 50, min: 1, max: 2000 });
        const s = await snapshotOf(args.id);
        const { items, total } = stepList(s, { last: limit });
        const out = items.map((step) => ({ ...stepOut(step), beforeFirstError: step.beforeFirstError }));
        // Too long: the oldest steps go first, the ones closest to the end of the recording stay.
        return fitJson(out.length, (n, hint) => ({
          id: args.id, total, returned: n, items: out.slice(out.length - n), ...(hint ? { hint } : {}),
        }), 'zmniejsz limit');
      },
    },
    {
      name: 'diff_snapshots',
      description: 'Porównanie dwóch paczek (a = wcześniejsza, b = późniejsza): nowe i zniknięte błędy (po komunikacie), zmiany '
        + 'statusu tej samej metody i ścieżki URL (bez hosta), zmiany CWV z oceną, ciasteczka: liczba, rozmiar, nazwy z innym valueHash.',
      inputSchema: {
        type: 'object',
        properties: { a: { ...idSchema, description: 'Wcześniejsza paczka (id z list_snapshots).' }, b: { ...idSchema, description: 'Późniejsza paczka (id z list_snapshots).' } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      async handler(args) {
        const a = await snapshotOf(args.a);
        const b = await snapshotOf(args.b);
        const diff = diffSnapshots(a, b);
        return capResponse(JSON.stringify({
          a: { id: args.a, collectedAt: a.collectedAt ?? null },
          b: { id: args.b, collectedAt: b.collectedAt ?? null },
          statusKey: STATUS_KEY_NOTE,
          ...diff,
        }), 'porównaj błędy przez get_errors każdej paczki osobno');
      },
    },
  ];
}
