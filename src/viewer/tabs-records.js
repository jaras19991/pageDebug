// Record tabs of the viewer (design E4-T3c): Kroki (timeline), Błędy, Sieć, Konsola.
// Contract with app.js (E4-T3b): renderSteps|renderErrors|renderNetwork|renderConsole(snapshot) → HTMLElement, where `snapshot`
// is the normalized (v4-shaped) snapshot from the package reader. Package data is untrusted: it reaches the DOM only as
// text through h() from dom.js (AC-4.5); addresses are never links. Every string from the package is capped.
import { h, textBlock } from './dom.js';
import { absTime, consoleText, errorGroups, filterNetwork, recordingStartMs, timeline } from '../lib/snapshot-query.js';

/** Network rows rendered per page ("Pokaż kolejne 200"); the count always counts all matches (AC-4.4). */
export const NETWORK_PAGE = 200;
/** Console rows rendered per page. */
export const CONSOLE_PAGE = 500;

const LIMITS = Object.freeze({
  // Characters of a one-line value (URL, label, header, message) in a row.
  lineChars: 2000,
  // Characters of a multi-line block (stack, body preview, console argument).
  blockChars: 50_000,
  // Distinct request types offered in the type filter.
  typeOptions: 50,
  // Headers listed per request.
  headers: 200,
});

const STATUS_OPTIONS = [
  ['', 'Wszystkie statusy'], ['2xx', '2xx'], ['3xx', '3xx'], ['4xx', '4xx'], ['5xx', '5xx'], ['error', 'błąd'], ['unknown', 'nieznany'],
];
const KIND_PL = { step: 'Krok', error: 'Błąd', request: 'Zapytanie' };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(s, key) {
  return isObject(s) && Array.isArray(s[key]) ? s[key] : [];
}

function clip(value, max = LIMITS.lineChars) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

/** Epoch ms as local `HH:MM:SS.mmm`; `—` when unknown. */
export function formatClock(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—';
  const d = new Date(at);
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`;
}

/** Seconds from the recording start as `12,4 s` (Polish decimal comma); empty when unknown. */
export function formatRel(rel) {
  if (typeof rel !== 'number' || !Number.isFinite(rel)) return '';
  return `${rel.toFixed(1).replace('.', ',')} s`;
}

function relOf(start, at) {
  return start === null || at === null ? null : (at - start) / 1000;
}

function time(at, rel) {
  const relText = formatRel(rel);
  return h('span', { class: 'time' }, formatClock(at), relText ? ` (${relText})` : '');
}

function empty(text) {
  return h('p', { class: 'empty' }, text);
}

function tab(name, ...children) {
  return h('section', { class: `tab tab-${name}`, 'data-tab-panel': name }, ...children);
}

function dataAttrs(item, kind) {
  return { 'data-kind': kind, 'data-at': Number.isFinite(item.at) ? item.at : null, 'data-doc': Number.isInteger(item.doc) ? item.doc : null };
}

function requestLine(entry) {
  const status = typeof entry.status === 'number' ? String(entry.status) : entry.error ? `błąd: ${clip(entry.error, 200)}` : 'brak statusu';
  const duration = typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) ? ` (${Math.round(entry.durationMs)} ms)` : '';
  return `${clip(entry.method ?? '', 20)} ${clip(entry.url ?? '')} → ${status}${duration}`;
}

function timelineItem(item) {
  if (item.kind === 'document') {
    return h('li', { class: 'boundary', ...dataAttrs(item, 'document') },
      h('h3', null, `Dokument ${Number.isInteger(item.doc) ? item.doc + 1 : '?'}: ${clip(item.url ?? 'adres nieznany')}`),
      time(item.at, item.rel));
  }
  let text;
  if (item.kind === 'step') {
    text = [clip(item.type ?? 'krok', 40), item.label ? ` · ${clip(item.label)}` : '', item.url ? ` · ${clip(item.url)}` : ''].join('');
  } else if (item.kind === 'error') {
    text = `${clip(item.message)}${item.frame ? ` · ${clip(item.frame)}` : ''}`;
  } else {
    text = requestLine(isObject(item.entry) ? item.entry : {});
  }
  return h('li', { class: `item item-${item.kind}`, ...dataAttrs(item, item.kind) },
    time(item.at, item.rel), ' ', h('span', { class: 'kind' }, KIND_PL[item.kind] ?? item.kind), ' ', h('span', { class: 'text' }, text));
}

/** Kroki: steps, errors and failed requests of all documents in one chronological list with document boundaries (AC-4.3). */
export function renderSteps(s) {
  const items = timeline(s);
  if (!items.some((item) => item.kind !== 'document')) return tab('steps', empty('Brak kroków, błędów i nieudanych zapytań w paczce.'));
  return tab('steps', h('ol', { class: 'timeline' }, items.map(timelineItem)));
}

/** Błędy: error groups (runtime + console) with count, first occurrence, frame and an expandable stack. */
export function renderErrors(s) {
  const { groups } = errorGroups(s, { limit: Infinity });
  if (!groups.length) return tab('errors', empty('Brak błędów w paczce.'));
  return tab('errors', groups.map((g) => {
    const step = g.stepBefore;
    return h('details', { class: 'error-group' },
      h('summary', null, `${g.count}× `, time(g.firstAt, g.firstRel), ` · ${clip(g.message)}`, g.frame ? ` · ${clip(g.frame)}` : ''),
      step ? h('p', { class: 'step-before' }, `Ostatni krok przed: ${formatRel(step.rel)} · ${clip(step.type ?? '', 40)}${step.label ? ` · ${clip(step.label)}` : ''}`) : null,
      g.stack ? textBlock(g.stack, LIMITS.blockChars) : h('p', { class: 'empty' }, 'Brak stosu wywołań.'));
  }));
}

function headersTable(title, headers) {
  if (!isObject(headers)) return null;
  const keys = Object.keys(headers);
  if (!keys.length) return null;
  const shown = keys.slice(0, LIMITS.headers);
  return h('div', { class: 'headers' },
    h('h3', null, title),
    h('table', null, h('tbody', null, shown.map((k) => h('tr', null, h('th', null, clip(k, 200)), h('td', null, clip(headers[k])))))),
    keys.length > shown.length ? h('p', null, `… i ${keys.length - shown.length} więcej`) : null);
}

function bodyBlock(title, body) {
  if (body === null || body === undefined || body === '') return null;
  return h('div', { class: 'body' }, h('h3', null, title), textBlock(typeof body === 'string' ? body : JSON.stringify(body), LIMITS.blockChars));
}

function networkRow(s, start, index, entry) {
  const at = absTime(s, entry);
  const facts = [
    ['Typ', entry.type], ['Status', entry.status], ['Tekst statusu', entry.statusText], ['Brak statusu', entry.statusUnavailable],
    ['Błąd', entry.error], ['Czas', typeof entry.durationMs === 'number' ? `${entry.durationMs} ms` : null],
    ['Rozmiar', typeof entry.sizeBytes === 'number' ? `${entry.sizeBytes} B` : null], ['Inicjator', entry.initiatorType],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return h('details', { class: 'net-row', 'data-index': index },
    h('summary', null, `#${index} `, time(at, relOf(start, at)), ` · ${clip(entry.type ?? '?', 40)} · ${requestLine(entry)}`),
    h('table', { class: 'facts' }, h('tbody', null, facts.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, clip(v)))))),
    headersTable('Nagłówki zapytania', entry.requestHeaders),
    headersTable('Nagłówki odpowiedzi', entry.responseHeaders),
    bodyBlock('Treść zapytania', entry.requestBody),
    bodyBlock(entry.responseBodyTruncated ? 'Podgląd treści odpowiedzi (ucięty)' : 'Podgląd treści odpowiedzi', entry.responseBodyPreview));
}

function select(filter, options) {
  return h('select', { 'data-filter': filter }, options.map(([value, text]) => h('option', { value }, text)));
}

/**
 * Sieć: filters by status class, type and URL fragment, "N z M" count, pages of 200 rows, row details
 * (headers, request body, response preview — all as text) (AC-4.4).
 */
export function renderNetwork(s) {
  const network = list(s, 'network');
  if (!network.length) return tab('network', empty('Brak zapytań sieciowych w paczce.'));
  const start = recordingStartMs(s);
  const types = [];
  for (const e of network) {
    if (types.length >= LIMITS.typeOptions) break;
    if (isObject(e) && typeof e.type === 'string' && e.type !== '' && !types.includes(e.type)) types.push(e.type);
  }
  const statusSelect = select('status', STATUS_OPTIONS);
  const typeSelect = select('type', [['', 'Wszystkie typy'], ...types.map((t) => [t, clip(t, 40)])]);
  const urlInput = h('input', { type: 'search', 'data-filter': 'url', placeholder: 'fragment adresu' });
  const count = h('p', { class: 'count', 'data-count': '', 'aria-live': 'polite' });
  const rows = h('div', { class: 'net-rows' });
  const more = h('button', { type: 'button', 'data-action': 'more', hidden: true }, `Pokaż kolejne ${NETWORK_PAGE}`);
  let matches = [];
  let shown = 0;

  function showMore() {
    const next = matches.slice(shown, shown + NETWORK_PAGE);
    rows.append(...next.map(({ index, entry }) => networkRow(s, start, index, entry)));
    shown += next.length;
    more.hidden = shown >= matches.length;
  }

  function apply() {
    const result = filterNetwork(network, {
      statusClass: statusSelect.value || undefined,
      type: typeSelect.value || undefined,
      urlContains: clip(urlInput.value, LIMITS.lineChars) || undefined,
    });
    matches = result.items;
    count.textContent = `Wyniki: ${matches.length} z ${result.total}`;
    rows.textContent = '';
    shown = 0;
    showMore();
  }

  statusSelect.addEventListener('change', apply);
  typeSelect.addEventListener('change', apply);
  urlInput.addEventListener('input', apply);
  more.addEventListener('click', showMore);
  apply();
  return tab('network', h('div', { class: 'filters' },
    h('label', null, 'Status: ', statusSelect), ' ', h('label', null, 'Typ: ', typeSelect), ' ', h('label', null, 'Adres: ', urlInput)), count, rows, more);
}

// A console argument as text: strings are already JSON text (v2+), anything else through JSON.stringify.
function argText(arg) {
  if (typeof arg === 'string') return clip(arg, LIMITS.blockChars);
  try {
    return clip(JSON.stringify(arg) ?? String(arg), LIMITS.blockChars);
  } catch {
    return '[nie da się pokazać]';
  }
}

// The arguments to show: the list, or the preview text of a long entry `{ truncated, preview }` (E4-FIX2).
function argsOf(entry) {
  if (Array.isArray(entry.args)) return entry.args;
  if (isObject(entry.args) && entry.args.truncated === true && typeof entry.args.preview === 'string') return [entry.args.preview];
  return [];
}

function consoleRow(s, start, entry) {
  const at = absTime(s, entry);
  const level = typeof entry.level === 'string' ? clip(entry.level, 20) : '?';
  return h('li', { class: 'console-row', 'data-level': level },
    time(at, relOf(start, at)), ' ', h('span', { class: 'level' }, level), ' ',
    h('span', { class: 'message' }, clip(consoleText(entry))),
    h('details', { class: 'args' }, h('summary', null, 'Argumenty i stos'),
      argsOf(entry).map((arg) => h('pre', { class: 'arg' }, argText(arg))),
      typeof entry.stack === 'string' ? textBlock(entry.stack, LIMITS.blockChars) : null));
}

/** Konsola: level, time, first-argument text and every argument as JSON text, in pages of 500. */
export function renderConsole(s) {
  const entries = list(s, 'consoleLogs').filter(isObject);
  if (!entries.length) return tab('console', empty('Brak wpisów konsoli w paczce.'));
  const start = recordingStartMs(s);
  const rows = h('ol', { class: 'console' });
  const more = h('button', { type: 'button', 'data-action': 'more', hidden: true }, `Pokaż kolejne ${CONSOLE_PAGE}`);
  let shown = 0;
  function showMore() {
    const next = entries.slice(shown, shown + CONSOLE_PAGE);
    rows.append(...next.map((entry) => consoleRow(s, start, entry)));
    shown += next.length;
    more.hidden = shown >= entries.length;
  }
  more.addEventListener('click', showMore);
  showMore();
  return tab('console', h('p', { class: 'count' }, `Wpisów: ${entries.length}`), rows, more);
}
