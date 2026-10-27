// Viewer shell (design E4 D3, E4-T3b): loading a package (file input, drag and drop anywhere on the page), Polish read errors,
// the newer-version banner, the package header, lazy tabs with a node cache (AC-4.2), Podsumowanie as summary.md text 1:1
// (AC-5.3) and the screenshot through a blob: URL. Package data is untrusted: DOM only through h()/textBlock()/setImageBytes().
// Works on the template slots of viewer.html: #loader and #package-info in the header, nav[role="tablist"], main#app.
import { h, revokeAll, setImageBytes, textBlock } from './dom.js';
import { renderConsole, renderErrors, renderNetwork, renderSteps } from './tabs-records.js';
import { renderDom, renderStorage, renderVitals } from './tabs-page.js';
import { readPackage, readErrorMessage, READ_ERRORS_PL } from '../lib/package-reader.js';
import { buildSummary } from '../lib/summary.js';

/** Tabs in bar order; ids match `data-tab` in viewer.html and `data-tab-panel` of the rendered sections. */
export const TABS = Object.freeze([
  { id: 'summary', label: 'Podsumowanie' },
  { id: 'steps', label: 'Kroki' },
  { id: 'errors', label: 'Błędy' },
  { id: 'network', label: 'Sieć' },
  { id: 'console', label: 'Konsola' },
  { id: 'vitals', label: 'CWV' },
  { id: 'dom', label: 'DOM' },
  { id: 'storage', label: 'Storage' },
]);

export const NEWER_BANNER = 'Nowsza wersja paczki — część danych może być niewidoczna.';
/** Largest file read into memory (= the zip total limit of unzip.js); bigger files are refused before reading. */
export const MAX_FILE_BYTES = 128 * 1024 * 1024;

const TEXT = Object.freeze({
  start: 'Przeciągnij plik paczki tutaj albo wybierz go z dysku.',
  another: 'Inna paczka? Przeciągnij ją tutaj albo wybierz z dysku.',
  choose: 'Plik paczki (.zip albo .json): ',
  loading: 'Wczytuję plik…',
  noFile: 'Upuść plik paczki (.zip albo .json).',
  tabFailed: 'Nie udało się pokazać tej zakładki.',
  summaryFailed: 'Nie udało się przygotować podsumowania.',
  screenshotTitle: 'Zrzut ekranu z paczki',
  screenshotFailed: 'Nie udało się pokazać zrzutu ekranu.',
  unknownHost: 'nieznana strona',
});

// Characters of a header value from the package (host, version, date).
const HEADER_CHARS = 200;
// Warnings listed under the header.
const MAX_WARNINGS = 20;

const DEFAULT_RENDERERS = Object.freeze({
  steps: renderSteps,
  errors: renderErrors,
  network: renderNetwork,
  console: renderConsole,
  vitals: renderVitals,
  dom: renderDom,
  storage: renderStorage,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clip(value, max = HEADER_CHARS) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function panel(id, ...children) {
  return h('section', { class: `tab tab-${id}`, 'data-tab-panel': id }, ...children);
}

function hostOf(s) {
  const hostname = s.environment?.location?.hostname;
  if (typeof hostname === 'string' && hostname !== '') return clip(hostname);
  const docs = Array.isArray(s.documents) ? s.documents : [];
  for (let i = docs.length - 1; i >= 0; i--) {
    if (typeof docs[i]?.url !== 'string') continue;
    try {
      const host = new URL(docs[i].url).hostname;
      if (host) return clip(host);
    } catch {
      // not an address; try the previous document
    }
  }
  return TEXT.unknownHost;
}

function collectedText(value) {
  if (typeof value !== 'string' || value === '') return 'czas nieznany';
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('pl-PL') : clip(value);
}

function packageInfo(result) {
  const s = isObject(result.snapshot) ? result.snapshot : {};
  const o = isObject(s.overview) ? s.overview : {};
  const shot = result.screenshot !== null || o.screenshot === true;
  const schema = Number.isInteger(s.schemaVersion) ? s.schemaVersion : '?';
  const version = typeof s.extensionVersion === 'string' && s.extensionVersion !== '' ? clip(s.extensionVersion) : '?';
  const migrated = result.sourceVersion !== s.schemaVersion ? ` (plik w wersji ${result.sourceVersion}, odczytany jako ${schema})` : '';
  const unredacted = result.warnings.find((w) => w?.code === 'unredacted');
  const warnings = result.warnings.filter((w) => w?.code !== 'newer' && w?.code !== 'unredacted').slice(0, MAX_WARNINGS);
  return [
    h('h2', null, hostOf(s)),
    h('p', null, `Zapisano: ${collectedText(s.collectedAt)} · rozszerzenie ${version} · schemat ${schema}${migrated}`),
    h('p', { class: 'overview' }, [
      `Błędy JS: ${count(o.runtimeErrors)}`, `Błędy konsoli: ${count(o.consoleErrors)}`, `Nieudane zapytania: ${count(o.failedRequests)}`,
      `Kroki: ${count(o.steps)}`, `Słabe metryki: ${count(o.poorVitals)}`, `Zrzut: ${shot ? 'tak' : 'nie'}`,
    ].join(' · ')),
    result.newer ? h('p', { id: 'banner-newer', class: 'banner', role: 'status' }, NEWER_BANNER) : null,
    // Before automatic redaction (schemaVersion < 4, E4-FIX2): the file may hold passwords and tokens.
    unredacted ? h('p', { id: 'banner-unredacted', class: 'banner', role: 'status' }, clip(unredacted.message, 500)) : null,
    warnings.length ? h('ul', { class: 'warnings' }, warnings.map((w) => h('li', null, clip(w?.message, 500)))) : null,
  ];
}

function summaryPanel(result) {
  let text;
  try {
    text = buildSummary(result.snapshot);
  } catch {
    return panel('summary', h('p', { class: 'empty' }, TEXT.summaryFailed));
  }
  const pre = textBlock(text);
  pre.id = 'summary-text';
  return panel('summary', pre, screenshotBlock(result.screenshot));
}

function screenshotBlock(screenshot) {
  if (!screenshot) return null;
  const img = h('img', { id: 'screenshot', 'aria-label': TEXT.screenshotTitle, title: TEXT.screenshotTitle });
  try {
    setImageBytes(img, screenshot.bytes, screenshot.mime);
  } catch {
    return h('div', { class: 'screenshot' }, h('h3', null, TEXT.screenshotTitle), h('p', { class: 'empty' }, TEXT.screenshotFailed));
  }
  return h('div', { class: 'screenshot' }, h('h3', null, TEXT.screenshotTitle), img);
}

/**
 * @param {{ doc?: Document, read?: typeof readPackage, renderers?: Record<string, (snapshot: object) => Element> }} [options]
 *   `renderers`: tab id → renderer for every tab but Podsumowanie (tests pass stubs)
 * @returns {{ loadBytes: (bytes: Uint8Array|ArrayBuffer) => Promise<boolean>, loadFile: (file: File) => Promise<boolean>,
 *   select: (id: string) => void, current: () => object|null, idle: () => Promise<unknown> }}
 *   `loadBytes`/`loadFile` resolve true when the package is shown; false on a read error or when a newer load replaced it
 */
export function createApp({ doc = document, read = readPackage, renderers = DEFAULT_RENDERERS } = {}) {
  const root = doc.getElementById('app');
  const loader = doc.getElementById('loader');
  const info = doc.getElementById('package-info');
  const nav = doc.querySelector('nav[role="tablist"]');
  const buttons = new Map([...nav.querySelectorAll('button[data-tab]')].map((b) => [b.dataset.tab, b]));

  const input = h('input', { type: 'file', id: 'file' });
  input.accept = '.zip,.json';
  const hint = h('p', { class: 'hint' }, TEXT.start);
  const status = h('p', { class: 'load-status', 'aria-live': 'polite' });
  const error = h('p', { id: 'load-error', class: 'load-error', role: 'alert', hidden: true });
  const drop = h('div', { class: 'drop', id: 'drop' }, hint, h('p', null, h('label', { for: 'file' }, TEXT.choose), input), status, error);
  loader.replaceChildren(drop);
  info.classList.add('package-info');

  let shown = null; // the read result on screen
  let cache = new Map(); // tab id → rendered panel of `shown`
  let selected = null;
  let seq = 0; // the latest load wins
  let pending = Promise.resolve();

  function showError(message) {
    status.textContent = '';
    error.textContent = message;
    error.hidden = false;
  }

  function renderTab(id) {
    if (id === 'summary') return summaryPanel(shown);
    let node;
    try {
      node = renderers[id](shown.snapshot);
    } catch {
      node = null;
    }
    return node instanceof Element ? node : panel(id, h('p', { class: 'empty' }, TEXT.tabFailed));
  }

  function select(id) {
    if (!shown || !buttons.has(id) || id === selected) return;
    let node = cache.get(id);
    if (!node) {
      node = renderTab(id);
      cache.set(id, node);
      root.append(node);
    }
    for (const [tabId, el] of cache) el.hidden = tabId !== id;
    for (const [tabId, button] of buttons) {
      button.ariaSelected = tabId === id ? 'true' : 'false';
      button.tabIndex = tabId === id ? 0 : -1;
    }
    selected = id;
  }

  function show(result) {
    revokeAll();
    shown = result;
    cache = new Map();
    selected = null;
    root.replaceChildren();
    info.replaceChildren(...packageInfo(result).filter(Boolean));
    status.textContent = '';
    error.hidden = true;
    error.textContent = '';
    hint.textContent = TEXT.another;
    drop.classList.add('loaded');
    nav.hidden = false;
    select('summary');
  }

  async function readAndShow(bytes, mine) {
    let result;
    try {
      result = await read(bytes);
    } catch (err) {
      if (mine === seq) showError(readErrorMessage(err));
      return false;
    }
    if (mine !== seq) return false;
    show(result);
    return true;
  }

  function track(promise) {
    pending = promise;
    return promise;
  }

  function loadBytes(bytes) {
    const mine = ++seq;
    status.textContent = TEXT.loading;
    return track(readAndShow(bytes, mine));
  }

  async function loadFileNow(file, mine) {
    if (typeof file?.size === 'number' && file.size > MAX_FILE_BYTES) {
      showError(READ_ERRORS_PL['too-large']);
      return false;
    }
    status.textContent = TEXT.loading;
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer()); // a view also accepts a buffer from another realm
    } catch (err) {
      if (mine === seq) showError(readErrorMessage(err));
      return false;
    }
    if (mine !== seq) return false;
    return readAndShow(bytes, mine);
  }

  function loadFile(file) {
    return track(loadFileNow(file, ++seq));
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) loadFile(file);
    input.value = ''; // the same file can be chosen again
  });

  // Drops anywhere on the page: without preventDefault the browser would open the dropped file instead.
  doc.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    drop.classList.add('dragging');
  });
  doc.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) drop.classList.remove('dragging');
  });
  doc.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
    else showError(TEXT.noFile);
  });

  nav.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-tab]') : null;
    if (button) select(button.dataset.tab);
  });
  nav.addEventListener('keydown', (event) => {
    const ids = TABS.map((t) => t.id).filter((id) => buttons.has(id));
    const at = ids.indexOf(selected);
    if (at < 0) return;
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1 + ids.length, Home: 0, End: ids.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(ids[next % ids.length]);
    buttons.get(selected).focus();
  });

  return {
    loadBytes,
    loadFile,
    select,
    current: () => shown,
    idle: () => pending,
  };
}
