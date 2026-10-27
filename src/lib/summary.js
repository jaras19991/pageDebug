// `summary.md` of the package (design E3 D11, E4 D2): a Polish overview for the developer with a fixed section order,
// built ONLY from the already redacted snapshot object (never from raw data). The same text is shown by the viewer and
// returned by the MCP server (AC-5.3), so it reads only JSON-able fields and treats `undefined`/`NaN` as missing.
// Markdown safety (AC-3.8): every value that comes from the page sits in an inline code span with an adaptive fence,
// on one line, cut to its field limit, never at the start of a line.
// Pure: no chrome.*, no DOM, no clock. Bundled into the console fallback through export.js and into the viewer.
import { stepList, errorGroups, failedRequests } from './snapshot-query.js';
import { METRIC_NAMES, RATING_PL, REASON_PL, vitalsByDoc, slowestResources, cookieInfo } from './snapshot-metrics.js';
import { describeScreenshot } from './screenshot-notes.js';

export const SUMMARY_LIMITS = Object.freeze({
  // The whole text (fitSummary): UTF-8 bytes and lines.
  maxBytes: 16384,
  maxLines: 200,
  // Items per section.
  steps: 20,
  errorGroups: 10,
  failedRequests: 20,
  documents: 5,
  slowest: 5,
  notes: 10,
  disabledRules: 20,
  // Characters per value (before the code span fence).
  url: 160,
  message: 160,
  selector: 80,
  stepText: 40,
  note: 160,
  userAgent: 160,
  short: 40,
});

const UNKNOWN_HOST = 'nieznana strona';
const STEP_BEFORE_ERROR = ' ← ostatni krok przed pierwszym błędem';
const CUT = '(skrócono)';
// Sections trimmed by fitSummary, in this order; `start` drops the oldest items first.
const TRIM_ORDER = ['Uwagi', 'Najwolniejsze zasoby', 'Środowisko', 'Kroki', 'Nieudane zapytania'];

// Values matching these patterns are shown as they are; anything else goes into a code span.
const HOST_RE = /^[A-Za-z0-9.:[\]-]{1,253}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;
const WORD_RE = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,64}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// Polish plural: 1 → one, 2–4 (but not 12–14) → few, otherwise many.
function plural(n, one, few, many) {
  if (n === 1) return one;
  const tens = n % 100;
  const units = n % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

// The one number formatter (D2): decimal comma, no "-0".
function num(value, digits = 0) {
  const fixed = value.toFixed(digits);
  return (/^-0(?:\.0*)?$/.test(fixed) ? fixed.slice(1) : fixed).replace('.', ',');
}

const ms = (value) => `${num(value)} ms`;
const seconds = (rel) => (finite(rel) ? `${num(rel, 1)} s` : '? s');

function size(bytes) {
  if (bytes < 1024) return `${num(bytes)} B`;
  if (bytes < 1024 * 1024) return `${num(bytes / 1024)} KB`;
  return `${num(bytes / (1024 * 1024), 1)} MB`;
}

// Line breaks (also U+2028/2029), other control characters and bidi overrides.
function unsafe(c) {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
}

// One line (a run of unsafe characters becomes one space), cut to `max` characters (never inside a surrogate pair).
function oneLine(value, max) {
  const raw = String(value ?? '');
  let line = '';
  let from = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i < raw.length && !unsafe(raw.charCodeAt(i))) continue;
    if (i > from) line += `${line === '' ? '' : ' '}${raw.slice(from, i)}`;
    from = i + 1;
  }
  const text = line.trim();
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return `${text.slice(0, end)}…`;
}

// Inline code span: the fence is one backtick longer than the longest run in the value; a value that starts or ends with
// a backtick is padded with a space. Inside a code span CommonMark renders no HTML, links or emphasis.
function code(value, max) {
  const text = oneLine(value, max);
  if (text === '') return '(pusto)';
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    run = text[i] === '`' ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  const fence = '`'.repeat(longest + 1);
  const pad = text[0] === '`' || text[text.length - 1] === '`' ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function plain(value, pattern, max) {
  return typeof value === 'string' && pattern.test(value) ? value : code(value, max);
}

function hostOf(s) {
  const hostname = s.environment?.location?.hostname;
  if (typeof hostname === 'string' && hostname !== '') return plain(hostname, HOST_RE, SUMMARY_LIMITS.url);
  const docs = Array.isArray(s.documents) ? s.documents : [];
  for (let i = docs.length - 1; i >= 0; i--) {
    if (typeof docs[i]?.url !== 'string') continue;
    try {
      const host = new URL(docs[i].url).hostname;
      if (host) return plain(host, HOST_RE, SUMMARY_LIMITS.url);
    } catch {
      // not an address; try the previous document
    }
  }
  return UNKNOWN_HOST;
}

function headerLines(s, failedTotal) {
  const o = isObject(s.overview) ? s.overview : {};
  const shot = o.screenshot === true || (Array.isArray(s.screenshots) && s.screenshots.length > 0);
  const collected = typeof s.collectedAt === 'string' && s.collectedAt !== '' ? plain(s.collectedAt, ISO_RE, SUMMARY_LIMITS.short) : '(czas nieznany)';
  const version = typeof s.extensionVersion === 'string' && s.extensionVersion !== '' ? plain(s.extensionVersion, VERSION_RE, SUMMARY_LIMITS.short) : '?';
  const schema = Number.isInteger(s.schemaVersion) ? s.schemaVersion : '?';
  return [
    `# Paczka diagnostyczna — ${hostOf(s)}`,
    [
      `Zapisano ${collected}`, `rozszerzenie ${version}`, `schemat ${schema}`,
      `źródło: ${s.source === 'console' ? 'skrypt w konsoli' : 'rozszerzenie'}`,
      `błędy JS ${count(o.runtimeErrors)}`, `błędy konsoli ${count(o.consoleErrors)}`, `nieudane zapytania ${failedTotal}`,
      `kroki ${count(o.steps)}`, `słabe metryki ${count(o.poorVitals)}`, `zrzut: ${shot ? 'tak' : 'nie'}`,
    ].join(' · '),
  ];
}

// A section: fixed `head` and `tail` lines around `items`, which fitSummary may drop (from `trim`: 'start' | 'end').
function section(title, { head = [], items = [], tail = [], trim = null } = {}) {
  return { title, head, items, tail, trim, cut: false };
}

function empty(title, reason) {
  return section(title, { head: [`brak — ${reason}`] });
}

function environmentSection(env) {
  const title = 'Środowisko';
  if (!isObject(env)) return empty(title, 'paczka nie ma danych o środowisku');
  const items = [];
  const href = env.location?.href;
  if (typeof href === 'string' && href !== '') items.push(`- Adres: ${code(href, SUMMARY_LIMITS.url)}`);
  const ua = env.navigator?.userAgent;
  if (typeof ua === 'string' && ua !== '') items.push(`- Przeglądarka: ${code(ua, SUMMARY_LIMITS.userAgent)}`);
  const vp = env.viewport;
  if (isObject(vp) && finite(vp.innerWidth) && finite(vp.innerHeight)) {
    const dpr = finite(vp.devicePixelRatio) ? `, DPR ${String(Number(vp.devicePixelRatio.toFixed(2))).replace('.', ',')}` : '';
    items.push(`- Okno: ${num(vp.innerWidth)}×${num(vp.innerHeight)}${dpr}`);
  }
  const lang = env.navigator?.language;
  if (typeof lang === 'string' && lang !== '') items.push(`- Język: ${code(lang, SUMMARY_LIMITS.short)}`);
  return items.length ? section(title, { items, trim: 'end' }) : empty(title, 'paczka nie ma danych o środowisku');
}

function stepBody(step, textLabels) {
  const parts = [seconds(step.rel), step.type === null ? '?' : plain(step.type, WORD_RE, SUMMARY_LIMITS.short)];
  if (step.label !== null) parts.push(code(step.label, textLabels.has(step.label) ? SUMMARY_LIMITS.stepText : SUMMARY_LIMITS.selector));
  else if (typeof step.url === 'string') parts.push(code(step.url, SUMMARY_LIMITS.url));
  return parts.join(' · ');
}

function stepsSection(s, stepBeforeError) {
  const title = 'Kroki';
  const { items, total } = stepList(s, { last: SUMMARY_LIMITS.steps });
  if (!total) return empty(title, 'nie zarejestrowano kroków');
  // A step label is cut as a text (40) when it is the text of some step, else as a selector (80).
  const textLabels = new Set();
  for (const step of s.steps) if (typeof step?.text === 'string' && step.text !== '') textLabels.add(step.text);
  const lines = items.map((step) => `- ${stepBody(step, textLabels)}${step.beforeFirstError ? STEP_BEFORE_ERROR : ''}`);
  const tail = [];
  if (stepBeforeError && !items.some((step) => step.beforeFirstError)) {
    tail.push(`- Ostatni krok przed pierwszym błędem (wcześniej niż lista): ${stepBody(stepBeforeError, textLabels)}`);
  }
  return section(title, { head: [`Ostatnie ${items.length} z ${total}:`], items: lines, tail, trim: 'start' });
}

function errorsSection(groups, more) {
  const title = 'Błędy';
  if (!groups.length) return empty(title, 'nie zarejestrowano błędów');
  const head = groups.map((g) => {
    const since = finite(g.firstRel) ? `od ${seconds(g.firstRel)} · ` : '';
    const frame = typeof g.frame === 'string' ? ` · ${code(g.frame, SUMMARY_LIMITS.message)}` : '';
    return `- ${g.count}× ${since}${code(g.message, SUMMARY_LIMITS.message)}${frame}`;
  });
  if (more > 0) head.push(`- i ${more} ${plural(more, 'grupa', 'grupy', 'grup')} więcej`);
  return section(title, { head });
}

function requestLine({ entry }) {
  const method = typeof entry.method === 'string' && entry.method !== '' ? code(entry.method, SUMMARY_LIMITS.short) : '?';
  const address = typeof entry.url === 'string' && entry.url !== '' ? code(entry.url, SUMMARY_LIMITS.url) : '(brak adresu)';
  let result;
  if (finite(entry.status) && entry.status >= 400) result = num(entry.status);
  else result = typeof entry.error === 'string' && entry.error !== '' ? `błąd: ${code(entry.error, SUMMARY_LIMITS.message)}` : 'błąd';
  const duration = finite(entry.durationMs) ? ` (${ms(entry.durationMs)})` : '';
  return `- ${method} ${address} → ${result}${duration}`;
}

function failedSection(s, failed, total) {
  const title = `Nieudane zapytania (${total})`;
  if (!failed.items.length) {
    const any = Array.isArray(s.network) && s.network.length > 0;
    return empty(title, any ? 'wszystkie zapytania się udały' : 'nie zarejestrowano zapytań');
  }
  const tail = failed.more > 0 ? [`- i ${failed.more} więcej`] : [];
  return section(title, { items: failed.items.map(requestLine), tail, trim: 'end' });
}

function metricText(name, m) {
  if (!m.available) {
    const reason = Object.hasOwn(REASON_PL, m.reason) ? REASON_PL[m.reason] : code(m.reason, SUMMARY_LIMITS.short);
    return `${name} niedostępne — ${reason}`;
  }
  const value = name === 'CLS' ? num(m.value, 2) : ms(m.value);
  return `${name} ${value}${m.rating ? ` (${RATING_PL[m.rating]})` : ''}`;
}

function vitalsSection(s) {
  const title = 'CWV';
  const { docs, more } = vitalsByDoc(s, { last: SUMMARY_LIMITS.documents });
  if (!docs.length) return empty(title, 'nie zmierzono metryk');
  const head = docs.map((d) => {
    const label = typeof d.url === 'string' && d.url !== '' ? code(d.url, SUMMARY_LIMITS.url) : `dokument ${Number.isInteger(d.doc) ? d.doc : '?'}`;
    return `- ${label}: ${METRIC_NAMES.map((name) => metricText(name, d.metrics[name])).join(' · ')}`;
  });
  if (more > 0) head.push(`- i ${more} ${plural(more, 'dokument', 'dokumenty', 'dokumentów')} wcześniej`);
  return section(title, { head });
}

function slowestSection(s) {
  const title = 'Najwolniejsze zasoby';
  const top = slowestResources(s, SUMMARY_LIMITS.slowest);
  if (!top.length) return empty(title, 'nie zarejestrowano zapytań');
  const items = top.map((r) => {
    const type = r.type === null ? '?' : plain(r.type, WORD_RE, SUMMARY_LIMITS.short);
    const bytes = r.sizeBytes === null ? 'rozmiar nieznany' : size(r.sizeBytes);
    const address = r.url === null || r.url === '' ? '(brak adresu)' : code(r.url, SUMMARY_LIMITS.url);
    return `- ${ms(r.durationMs)} · ${type} · ${bytes} · ${address}`;
  });
  return section(title, { items, trim: 'end' });
}

function cookiesSection(s) {
  const title = 'Ciasteczka i rozmiar';
  const info = cookieInfo(s);
  const hasStorage = isObject(s.storage);
  if (!hasStorage && !info.truncatedKeys.length) return empty(title, 'paczka nie ma danych o ciasteczkach');
  const head = [];
  if (hasStorage) head.push(`- Ciasteczka: ${info.count}${info.totalBytes === null ? '' : `, razem ${size(info.totalBytes)}`}`);
  const cut = info.truncatedKeys.map((key) => plain(key, WORD_RE, SUMMARY_LIMITS.short)).join(', ');
  head.push(`- Ucięte przez limity: ${cut || 'nic'}`);
  return section(title, { head });
}

function privacySection(s) {
  const head = [];
  const redaction = s.redaction;
  if (isObject(redaction)) {
    const masked = isObject(redaction.masked) ? redaction.masked : {};
    const values = Object.values(masked).map(count).filter((n) => n > 0);
    const total = values.reduce((sum, n) => sum + n, 0);
    const sections = values.length;
    const rules = Number.isInteger(redaction.rulesVersion) ? redaction.rulesVersion : '?';
    head.push(`- Zamaskowano ${total} ${plural(total, 'wartość', 'wartości', 'wartości')} w ${sections} `
      + `${plural(sections, 'sekcji', 'sekcjach', 'sekcjach')} (reguły v${rules}). Hasła, tokeny i dane logowania nie są w tym pliku.`);
    const disabled = Array.isArray(redaction.disabledRules)
      ? redaction.disabledRules.filter((r) => typeof r === 'string' && r !== '').slice(0, SUMMARY_LIMITS.disabledRules)
      : [];
    if (disabled.length) {
      head.push(`- Wyłączone przez developera: ${disabled.map((r) => plain(r, WORD_RE, SUMMARY_LIMITS.short)).join(', ')}.`);
    }
  } else {
    head.push('- Brak informacji o maskowaniu.');
  }
  head.push(`- ${describeScreenshot(s)}`);
  return section('Prywatność', { head });
}

function notesSection(s) {
  const notes = (Array.isArray(s.notes) ? s.notes : []).filter((n) => typeof n === 'string' && n !== '').slice(0, SUMMARY_LIMITS.notes);
  if (!notes.length) return empty('Uwagi', 'paczka nie ma uwag');
  return section('Uwagi', { items: notes.map((n) => `- ${code(n, SUMMARY_LIMITS.note)}`), trim: 'end' });
}

function footerLine(s) {
  const shot = (Array.isArray(s.screenshots) ? s.screenshots : []).find((x) => typeof x?.file === 'string' && x.file !== '');
  return shot ? `Pełne dane: snapshot.json; obraz: ${plain(shot.file, FILE_RE, SUMMARY_LIMITS.short)}.` : 'Pełne dane: snapshot.json.';
}

function render(header, sections, footer) {
  const out = [...header, ''];
  for (const sec of sections) {
    out.push(`## ${sec.title}`, '', ...sec.head);
    if (sec.cut && sec.trim === 'start') out.push(CUT);
    out.push(...sec.items);
    if (sec.cut && sec.trim === 'end') out.push(CUT);
    out.push(...sec.tail, '');
  }
  out.push(footer);
  return `${out.join('\n')}\n`;
}

function utf8Bytes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function fits(text) {
  return text.split('\n').length <= SUMMARY_LIMITS.maxLines && utf8Bytes(text) <= SUMMARY_LIMITS.maxBytes;
}

// Guard (D2): over the byte or line limit, drop items of the trimmable sections in TRIM_ORDER, marking each cut section
// with "(skrócono)". The header, Błędy, CWV and Prywatność are never touched.
function fitSummary(header, sections, footer) {
  let text = render(header, sections, footer);
  for (const title of TRIM_ORDER) {
    if (fits(text)) break;
    const sec = sections.find((x) => x.title === title || x.title.startsWith(`${title} (`));
    while (sec && sec.items.length && !fits(text)) {
      if (sec.trim === 'start') sec.items.shift();
      else sec.items.pop();
      sec.cut = true;
      text = render(header, sections, footer);
    }
  }
  return text;
}

/**
 * @param {object} snapshot  the REDACTED package object (after budget and `redaction` were set), or the parsed snapshot.json
 * @returns {string} Markdown, Polish, ends with a newline; ≤ 16 KB and ≤ 200 lines; the same for the object and its JSON copy
 */
export function buildSummary(snapshot) {
  const s = isObject(snapshot) ? snapshot : {};
  const failed = failedRequests(s, { limit: SUMMARY_LIMITS.failedRequests });
  const failedTotal = isObject(s.overview) && Number.isInteger(s.overview.failedRequests) && s.overview.failedRequests >= 0
    ? s.overview.failedRequests
    : failed.total;
  const errors = errorGroups(s, { limit: SUMMARY_LIMITS.errorGroups });
  const stepBeforeError = errors.groups.length ? errors.groups[0].stepBefore : null;
  const sections = [
    environmentSection(s.environment),
    stepsSection(s, stepBeforeError),
    errorsSection(errors.groups, errors.more),
    failedSection(s, failed, failedTotal),
    vitalsSection(s),
    slowestSection(s),
    cookiesSection(s),
    privacySection(s),
    notesSection(s),
  ];
  return fitSummary(headerLines(s, failedTotal), sections, footerLine(s));
}
