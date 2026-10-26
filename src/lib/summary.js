// `summary.md` of the package (design E3 D11): a short Polish overview for the developer, built ONLY from the already
// redacted snapshot object (never from raw data) and only from the fields read below. Minimal in E3; E4 extends it.
// Pure: no chrome.*, no DOM. Bundled into the console fallback through export.js.

export const SUMMARY_LIMITS = Object.freeze({
  notes: 10,
  // Every value is put on one line and cut to this many characters.
  lineChars: 500,
  disabledRules: 20,
});

const UNKNOWN_HOST = 'nieznana strona';
const MAX_SECTIONS_SHOWN = 1000;

// Polish plural: 1 → one, 2–4 (but not 12–14) → few, otherwise many.
function plural(n, one, few, many) {
  if (n === 1) return one;
  const tens = n % 100;
  const units = n % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// One line, capped: a value can never start a heading or a new list item.
function text(value) {
  const s = String(value ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
  return s.length > SUMMARY_LIMITS.lineChars ? `${s.slice(0, SUMMARY_LIMITS.lineChars)}…` : s;
}

function hostOf(snapshot) {
  const hostname = snapshot.environment?.location?.hostname;
  if (typeof hostname === 'string' && hostname !== '') return text(hostname);
  const docs = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  for (let i = docs.length - 1; i >= 0; i--) {
    try {
      const host = new URL(docs[i]?.url).hostname;
      if (host) return text(host);
    } catch {
      // not a URL; try the previous document
    }
  }
  return UNKNOWN_HOST;
}

function environmentLines(env) {
  if (!isObject(env)) return [];
  const lines = [];
  const href = env.location?.href;
  if (typeof href === 'string' && href !== '') lines.push(`- Adres: ${text(href)}`);
  const ua = env.navigator?.userAgent;
  if (typeof ua === 'string' && ua !== '') lines.push(`- Przeglądarka: ${text(ua)}`);
  const vp = env.viewport;
  if (isObject(vp) && Number.isFinite(vp.innerWidth) && Number.isFinite(vp.innerHeight)) {
    const dpr = Number.isFinite(vp.devicePixelRatio) ? `, DPR ${vp.devicePixelRatio}` : '';
    lines.push(`- Okno: ${vp.innerWidth}×${vp.innerHeight}${dpr}`);
  }
  const lang = env.navigator?.language;
  if (typeof lang === 'string' && lang !== '') lines.push(`- Język: ${text(lang)}`);
  return lines;
}

function overviewLines(overview) {
  if (!isObject(overview)) return [];
  return [
    `- Błędy JavaScript: ${count(overview.runtimeErrors)}`,
    `- Błędy w konsoli: ${count(overview.consoleErrors)}`,
    `- Nieudane zapytania: ${count(overview.failedRequests)}`,
    `- Kroki: ${count(overview.steps)}`,
    `- Słabe metryki (poor): ${count(overview.poorVitals)}`,
    `- Zrzut ekranu: ${overview.screenshot === true ? 'tak' : 'nie'}`,
  ];
}

function privacyLines(redaction) {
  if (!isObject(redaction)) return ['Brak informacji o maskowaniu.'];
  const masked = isObject(redaction.masked) ? redaction.masked : {};
  const values = Object.values(masked).map(count).filter((n) => n > 0);
  const total = values.reduce((sum, n) => sum + n, 0);
  const sections = Math.min(values.length, MAX_SECTIONS_SHOWN);
  const rules = Number.isInteger(redaction.rulesVersion) ? redaction.rulesVersion : '?';
  const lines = [
    `Zamaskowano ${total} ${plural(total, 'wartość', 'wartości', 'wartości')} w ${sections} ${plural(sections, 'sekcji', 'sekcjach', 'sekcjach')} (reguły v${rules}). Hasła, tokeny i dane logowania nie są w tym pliku.`,
  ];
  const disabled = Array.isArray(redaction.disabledRules)
    ? redaction.disabledRules.filter((r) => typeof r === 'string' && r !== '').slice(0, SUMMARY_LIMITS.disabledRules)
    : [];
  if (disabled.length) lines.push(`Wyłączone przez developera: ${text(disabled.join(', '))}.`);
  return lines;
}

/**
 * @param {object} snapshot  the REDACTED package object (after budget and `redaction` were set)
 * @returns {string} Markdown, Polish, ends with a newline
 */
export function buildSummary(snapshot) {
  const s = isObject(snapshot) ? snapshot : {};
  const out = [`# Paczka diagnostyczna — ${hostOf(s)}`, ''];
  const head = [];
  if (typeof s.collectedAt === 'string' && s.collectedAt !== '') head.push(`- Zapisano: ${text(s.collectedAt)}`);
  const version = typeof s.extensionVersion === 'string' && s.extensionVersion !== '' ? text(s.extensionVersion) : '?';
  head.push(`- Wersja rozszerzenia: ${version}, schemat paczki: ${Number.isInteger(s.schemaVersion) ? s.schemaVersion : '?'}`);
  head.push(`- Źródło: ${s.source === 'console' ? 'skrypt w konsoli' : 'rozszerzenie'}`);
  out.push(...head, '');

  const sections = [
    ['Środowisko', environmentLines(s.environment)],
    ['Przegląd', overviewLines(s.overview)],
    ['Prywatność', privacyLines(s.redaction)],
    ['Uwagi', (Array.isArray(s.notes) ? s.notes : []).slice(0, SUMMARY_LIMITS.notes).map((n) => `- ${text(n)}`)],
  ];
  for (const [title, lines] of sections) {
    if (!lines.length) continue;
    out.push(`## ${title}`, '', ...lines, '');
  }

  const shot = (Array.isArray(s.screenshots) ? s.screenshots : []).find((x) => typeof x?.file === 'string' && x.file !== '');
  out.push(shot ? `Pełne dane: snapshot.json; obraz: ${text(shot.file)}.` : 'Pełne dane: snapshot.json.');
  return `${out.join('\n')}\n`;
}
