// Page tabs of the viewer (design E4-T3e): CWV, DOM, Storage.
// Contract with app.js (E4-T3b): renderVitals|renderDom|renderStorage(snapshot) → HTMLElement, where `snapshot` is the
// normalized (v4-shaped) snapshot from the package reader (a migrated v3 may still carry dom.html.outerHTML).
// Package data is untrusted: text only through h()/textBlock() from dom.js (AC-4.5). Every string from the package is capped.
import { h, textBlock } from './dom.js';
import { METRIC_NAMES, RATING_PL, REASON_PL, vitalsByDoc } from '../lib/snapshot-metrics.js';

const LIMITS = Object.freeze({
  // Characters of a table cell or one-line value.
  cellChars: 2000,
  // Characters of a storage value (the collector keeps ≤ 5000).
  valueChars: 5000,
  // Characters of dom.structure / fullHtml / v3 outerHTML shown (D3: 1 MB).
  htmlChars: 1_000_000,
  // Rows of one table (DOM lists are ≤ 100 in the package; storage and attribution lists capped here).
  rows: 1000,
  // Columns of a generic object table.
  columns: 20,
});

const DOM_LISTS = [
  ['meta', 'Meta'], ['hreflangs', 'Hreflang'], ['scripts', 'Skrypty'], ['stylesheets', 'Arkusze stylów'],
  ['images', 'Obrazy'], ['iframes', 'Ramki (iframe)'],
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clip(value, max = LIMITS.cellChars) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Any package value as cell text: dash for none, yes/no for booleans, JSON for objects.
function cell(value, max = LIMITS.cellChars) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  if (typeof value === 'string') return clip(value, max);
  if (typeof value === 'number') return String(value);
  try {
    return clip(JSON.stringify(value) ?? '', max);
  } catch {
    return '—';
  }
}

function plNumber(value, digits) {
  return value.toFixed(digits).replace('.', ',');
}

function empty(text) {
  return h('p', { class: 'empty' }, text);
}

function tab(name, ...children) {
  return h('section', { class: `tab tab-${name}`, 'data-tab-panel': name }, ...children);
}

function table(headers, rows, attrs = null) {
  const shown = rows.slice(0, LIMITS.rows);
  return [
    h('table', attrs,
      h('thead', null, h('tr', null, headers.map((title) => h('th', null, title)))),
      h('tbody', null, shown.map((cells) => h('tr', null, cells.map((c) => h('td', null, c)))))),
    rows.length > shown.length ? h('p', null, `… i ${rows.length - shown.length} wierszy więcej`) : null,
  ];
}

// Table of objects: columns = keys of the listed objects in first-seen order.
function objectTable(items) {
  const objects = items.filter(isObject).slice(0, LIMITS.rows);
  const columns = [];
  for (const item of objects) {
    for (const key of Object.keys(item)) {
      if (columns.length >= LIMITS.columns) break;
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return table(columns.map((c) => clip(c, 100)), objects.map((item) => columns.map((c) => cell(item[c]))));
}

function keyValueTable(object, max = LIMITS.cellChars) {
  return table(['Klucz', 'Wartość'], Object.keys(object).map((key) => [clip(key, LIMITS.cellChars), cell(object[key], max)]));
}

function reasonText(reason) {
  return Object.hasOwn(REASON_PL, reason) ? REASON_PL[reason] : clip(reason, 200);
}

function metricValue(name, m) {
  if (!m.available) return `niedostępne — ${reasonText(m.reason)}`;
  return name === 'CLS' ? plNumber(m.value, 3) : `${Math.round(m.value)} ms`;
}

// Attribution of one metric as text: LCP/INP element, INP phases, CLS sources.
function attribution(name, entry) {
  if (!isObject(entry)) return '';
  const parts = [];
  if (typeof entry.selector === 'string') parts.push(`element: ${clip(entry.selector)}`);
  if (name === 'LCP' && typeof entry.url === 'string') parts.push(`zasób: ${clip(entry.url)}`);
  if (name === 'INP') {
    if (typeof entry.eventType === 'string') parts.push(`zdarzenie: ${clip(entry.eventType, 40)}`);
    const phases = [['opóźnienie', entry.inputDelay], ['obsługa', entry.processing], ['rysowanie', entry.presentation]]
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
    if (phases.length) parts.push(phases.map(([k, v]) => `${k} ${Math.round(v)} ms`).join(', '));
  }
  if (name === 'CLS' && Array.isArray(entry.sources)) {
    for (const src of entry.sources.slice(0, 20)) {
      if (!isObject(src)) continue;
      parts.push(`przesunięcie ${typeof src.value === 'number' ? plNumber(src.value, 3) : '?'}: ${clip(src.selector ?? '?')}`);
    }
  }
  return parts.join(' · ');
}

function longTasksBlock(longTasks) {
  if (!isObject(longTasks)) return null;
  if (longTasks.available !== true) {
    const reason = typeof longTasks.reason === 'string' && longTasks.reason !== '' ? longTasks.reason : 'unknown';
    return h('p', { class: 'long-tasks' }, `Długie zadania: niedostępne — ${reasonText(reason)}`);
  }
  const items = Array.isArray(longTasks.items) ? longTasks.items.filter(isObject) : [];
  if (!items.length) return h('p', { class: 'long-tasks' }, 'Długie zadania: brak.');
  const rows = items.map((task) => [
    typeof task.duration === 'number' ? `${Math.round(task.duration)} ms` : '—',
    typeof task.blockingDuration === 'number' ? `${Math.round(task.blockingDuration)} ms` : '—',
    (Array.isArray(task.scripts) ? task.scripts.filter(isObject).slice(0, 20) : [])
      .map((sc) => [sc.function, sc.invoker, sc.url].filter((v) => typeof v === 'string' && v !== '').map((v) => clip(v)).join(' · '))
      .join('\n') || '—',
  ]);
  return h('div', { class: 'long-tasks' }, h('h3', null, 'Długie zadania'), table(['Czas', 'Blokowanie', 'Skrypty'], rows));
}

/** CWV: per document (all documents) a table TTFB/FCP/LCP/CLS/INP with value, rating, attribution; unavailable with reason, never 0. */
export function renderVitals(s) {
  const { docs } = vitalsByDoc(s, { last: Infinity });
  if (!docs.length) return tab('vitals', empty('Brak pomiarów CWV w paczce.'));
  return tab('vitals', docs.map((d) => h('div', { class: 'vitals-doc' },
    h('h3', null, `Dokument ${Number.isInteger(d.doc) ? d.doc + 1 : '?'}: ${clip(d.url ?? 'adres nieznany')}`),
    table(['Metryka', 'Wartość', 'Ocena', 'Szczegóły'], METRIC_NAMES.map((name) => {
      const m = d.metrics[name];
      return [name, metricValue(name, m), m.available && m.rating ? RATING_PL[m.rating] : '—', m.available ? attribution(name, m.entry) || '—' : '—'];
    }), { 'data-doc': Number.isInteger(d.doc) ? d.doc : '' }),
    longTasksBlock(d.longTasks))));
}

function formsBlock(forms) {
  const list = forms.filter(isObject);
  if (!list.length) return null;
  return h('div', { class: 'dom-forms' }, h('h3', null, 'Formularze'),
    list.slice(0, LIMITS.rows).map((form) => {
      const { elements, ...rest } = form;
      return h('div', { class: 'dom-form' },
        objectTable([rest]),
        Array.isArray(elements) && elements.length ? objectTable(elements) : h('p', null, 'Bez pól.'));
    }));
}

function htmlBlock(title, text) {
  if (typeof text !== 'string' || text === '') return null;
  return h('div', { class: 'dom-html' }, h('h3', null, title), textBlock(text, LIMITS.htmlChars));
}

/** DOM: counts, document facts, lists as text tables, `structure` / `fullHtml` / v3 `outerHTML` as text (≤ 1 MB). */
export function renderDom(s) {
  const dom = isObject(s) && isObject(s.dom) ? s.dom : null;
  if (!dom) return tab('dom', empty('Brak danych o DOM w paczce.'));
  const html = isObject(dom.html) ? dom.html : {};
  const facts = {};
  for (const key of ['doctype', 'lang', 'charset', 'compatMode']) if (html[key] !== undefined) facts[key] = html[key];
  if (dom.canonical !== undefined) facts.canonical = dom.canonical;
  return tab('dom',
    isObject(dom.counts) ? h('div', { class: 'dom-counts' }, h('h3', null, 'Liczby elementów'), keyValueTable(dom.counts)) : null,
    Object.keys(facts).length ? h('div', { class: 'dom-facts' }, h('h3', null, 'Dokument'), keyValueTable(facts)) : null,
    DOM_LISTS.map(([key, title]) => (Array.isArray(dom[key]) && dom[key].length
      ? h('div', { class: `dom-list dom-${key}` }, h('h3', null, `${title} (${dom[key].length})`), objectTable(dom[key]))
      : null)),
    Array.isArray(dom.forms) ? formsBlock(dom.forms) : null,
    isObject(dom.rootMarkers) ? h('div', { class: 'dom-markers' }, h('h3', null, 'Znaczniki html i body'), keyValueTable(dom.rootMarkers)) : null,
    htmlBlock('Struktura (bez tekstów)', dom.structure),
    htmlBlock('Pełny HTML', dom.fullHtml),
    // eslint-disable-next-line no-restricted-properties -- reads the v3 package field dom.html.outerHTML (shown as text), no DOM write
    htmlBlock('Pełny HTML (paczka w starszej wersji)', html.outerHTML));
}

/** Storage: cookies (name, size, hash) with the total size, localStorage and sessionStorage as key–value text. */
export function renderStorage(s) {
  const storage = isObject(s) && isObject(s.storage) ? s.storage : null;
  if (!storage) return tab('storage', empty('Brak danych o ciasteczkach i pamięci strony w paczce.'));
  const cookies = storage.cookies;
  let cookieBlock;
  if (Array.isArray(cookies)) {
    const total = typeof storage.cookiesTotalBytes === 'number' ? `, łącznie ${storage.cookiesTotalBytes} B` : '';
    cookieBlock = [
      h('p', null, `Liczba: ${cookies.length}${total}`),
      cookies.length ? table(['Nazwa', 'Rozmiar (B)', 'Skrót wartości'],
        cookies.filter(isObject).map((c) => [cell(c.name), cell(c.sizeBytes), cell(c.valueHash)])) : null,
    ];
  } else if (typeof cookies === 'string') {
    cookieBlock = textBlock(cookies, LIMITS.valueChars);
  } else {
    cookieBlock = empty('Brak.');
  }
  const area = (title, value) => h('div', { class: 'storage-area' }, h('h3', null, title),
    isObject(value) && Object.keys(value).length ? keyValueTable(value, LIMITS.valueChars) : empty('Pusto.'));
  return tab('storage',
    h('div', { class: 'storage-cookies' }, h('h3', null, 'Ciasteczka'), cookieBlock),
    area('localStorage', storage.localStorage),
    area('sessionStorage', storage.sessionStorage));
}
