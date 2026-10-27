import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSummary, SUMMARY_LIMITS } from '../../src/lib/summary.js';
import { failedRequests } from '../../src/lib/snapshot-query.js';
import { SCREENSHOT_NOTES } from '../../src/lib/screenshot-notes.js';
import { redact } from '../../src/lib/redact.js';
import { heavyPackage } from './helpers/heavy-package.js';
import { TRAPS, leaks, trapPackage } from './helpers/redaction-traps.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/snapshots/${name}.json`, import.meta.url), 'utf8'));
const v4 = () => fixture('v4');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLXVzZXItMSJ9.ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz';
const SECTIONS = ['Środowisko', 'Kroki', 'Błędy', 'Nieudane zapytania', 'CWV', 'Najwolniejsze zasoby', 'Ciasteczka i rozmiar', 'Prywatność', 'Uwagi'];
// Line starts the summary may have; anything else could be a value of the page at the start of a line.
const PREFIXES = ['# Paczka diagnostyczna — ', 'Zapisano ', '## ', '- ', 'Ostatnie ', 'brak — ', '(skrócono)', 'Pełne dane: '];
const bytes = (text) => Buffer.byteLength(text, 'utf8');

// The console fallback package (design E4-T1b): v4.json saved by the pasted script — no screenshot, its note.
function consolePackage() {
  const s = v4();
  s.source = 'console';
  s.screenshots = [];
  s.overview.screenshot = false;
  s.notes.push('Screenshots are not available without the extension.', 'INP covers only interactions after the script was pasted.');
  return s;
}

// A light ~15 MB package (strings shared between entries, so the object itself stays small).
// heavyPackage starts the recording a day before its document and writes vitals without `available`; here the recording
// starts with the document and measured vitals are marked available, as the recorder writes them.
function heavy() {
  const s = heavyPackage({ logChars: 1000 });
  s.recordingStartedAt = new Date(s.documents[0].timeOrigin).toISOString();
  for (const m of Object.values(s.vitals[0])) if (m && typeof m.value === 'number') m.available = true;
  return s;
}

// Non-empty lines per `## ` section, by title without the count in brackets.
function sections(md) {
  const out = {};
  let current = null;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      current = line.slice(3).replace(/ \(\d+\)$/, '');
      out[current] = [];
    } else if (current && line !== '' && !line.startsWith('Pełne dane: ')) {
      out[current].push(line);
    }
  }
  return out;
}

// The text of a line outside CommonMark code spans (a backtick run closes only at a run of the same length).
function outsideCode(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      out += line[i++];
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    let close = -1;
    for (let j = i + n; j < line.length;) {
      if (line[j] !== '`') { j++; continue; }
      let m = 0;
      while (line[j + m] === '`') m++;
      if (m === n) { close = j; break; }
      j += m;
    }
    if (close === -1) {
      out += line.slice(i, i + n);
      i += n;
    } else {
      out += '⟨code⟩';
      i = close + n;
    }
  }
  return out;
}

function median(fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

// v4.json with `n` steps on document 1 every 100 ms, and an error at `errorT` (ms of document 1).
function withSteps(n, errorT = 1e9) {
  const s = v4();
  s.steps = Array.from({ length: n }, (_, i) => ({ t: 100 * i, doc: 1, type: 'click', selector: `#b${i}`, text: `Przycisk ${i}` }));
  s.runtimeErrors = [{ t: errorT, doc: 1, type: 'error', message: 'Boom', stack: 'Error: Boom\n    at go (https://app.example/a.js:1:2)' }];
  s.consoleLogs = [];
  return s;
}

describe('structure (D2, AC-3.1)', () => {
  it('section order fixed; empty section shows one "brak — <reason>" line', () => {
    const md = buildSummary(v4());
    const titles = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).replace(/ \(\d+\)$/, ''));
    expect(titles).toEqual(SECTIONS);
    const lines = md.split('\n');
    expect(lines[0]).toBe('# Paczka diagnostyczna — 127.0.0.1');
    expect(lines[1]).toBe('Zapisano 2026-01-15T10:01:05.000Z · rozszerzenie 0.5.0 · schemat 4 · źródło: rozszerzenie · błędy JS 2 · '
      + 'błędy konsoli 1 · nieudane zapytania 3 · kroki 10 · słabe metryki 1 · zrzut: tak');
    expect(md.endsWith('Pełne dane: snapshot.json; obraz: screenshot.jpg.\n')).toBe(true);

    const empty = buildSummary({});
    expect(empty.split('\n')[0]).toBe('# Paczka diagnostyczna — nieznana strona');
    const parts = sections(empty);
    expect(Object.keys(parts)).toEqual(SECTIONS);
    for (const title of SECTIONS) {
      if (title === 'Prywatność') continue;
      expect(parts[title], title).toHaveLength(1);
      expect(parts[title][0], title).toMatch(/^brak — \S/);
    }
    expect(parts['Prywatność']).toEqual(['- Brak informacji o maskowaniu.', '- Zrzut ekranu: brak — powód w Uwagach']);
    expect(empty.endsWith('Pełne dane: snapshot.json.\n')).toBe(true);
  });

  it('every line starts with an allowed prefix (v4, console, heavy, empty)', () => {
    for (const s of [v4(), consolePackage(), heavy(), {}]) {
      for (const line of buildSummary(s).split('\n')) {
        if (line === '') continue;
        expect(PREFIXES.some((p) => line.startsWith(p)), line).toBe(true);
      }
    }
  });

  it('console source is named in the header', () => {
    expect(buildSummary(consolePackage()).split('\n')[1]).toContain(' · źródło: skrypt w konsoli · ');
    expect(buildSummary(consolePackage()).split('\n')[1]).toMatch(/ · zrzut: nie$/);
  });

  it('snapshot: v4 package (E4-TEST1)', async () => {
    await expect(buildSummary(v4())).toMatchFileSnapshot('./__snapshots__/summary-v4.md');
  });

  it('snapshot: heavy package (E4-TEST1)', async () => {
    await expect(buildSummary(heavy())).toMatchFileSnapshot('./__snapshots__/summary-heavy.md');
  });

  it('snapshot: console fallback package (E4-TEST1)', async () => {
    await expect(buildSummary(consolePackage())).toMatchFileSnapshot('./__snapshots__/summary-console.md');
  });
});

describe('environment', () => {
  it('address, browser, window × DPR, language', () => {
    const env = sections(buildSummary(v4()))['Środowisko'];
    expect(env).toEqual([
      '- Adres: `http://127.0.0.1:8080/result.html?access_token=[redacted:key-token]`',
      '- Przeglądarka: `Mozilla/5.0 (Synthetic) Test/1.0`',
      '- Okno: 1280×720, DPR 1',
      '- Język: `pl-PL`',
    ]);
    const s = v4();
    s.environment.viewport.devicePixelRatio = 1.25;
    expect(sections(buildSummary(s))['Środowisko']).toContain('- Okno: 1280×720, DPR 1,25');
  });
});

describe('steps (AC-3.2)', () => {
  it('steps: ≤ 20, seconds with one decimal (comma), navigate with URL, step before first error marked', () => {
    const steps = sections(buildSummary(v4()))['Kroki'];
    expect(steps[0]).toBe('Ostatnie 10 z 10:');
    expect(steps[1]).toBe('- 0,1 s · navigate · `http://127.0.0.1:8080/form.html`');
    expect(steps[2]).toBe('- 0,9 s · click · `Zacznij`');
    expect(steps[3]).toBe('- 1,1 s · input · `form > input:nth-of-type(1)`');
    expect(steps[9]).toBe('- 4,2 s · navigate · `http://127.0.0.1:8080/result.html` ← ostatni krok przed pierwszym błędem');
    expect(steps[10]).toBe('- 6,3 s · click · `Zapisz`');
    expect(steps.filter((l) => l.includes('ostatni krok przed pierwszym błędem'))).toHaveLength(1);

    const many = sections(buildSummary(withSteps(25, 2450)))['Kroki'];
    expect(many[0]).toBe('Ostatnie 20 z 25:');
    expect(many.filter((l) => l.startsWith('- ') && / s · click · /.test(l))).toHaveLength(20);
    expect(many[1]).toBe('- 4,7 s · click · `Przycisk 5`');
    expect(many.find((l) => l.includes('Przycisk 24'))).toBe('- 6,6 s · click · `Przycisk 24` ← ostatni krok przed pierwszym błędem');
  });

  it('step before the first error outside the last 20 gets its own line', () => {
    const steps = sections(buildSummary(withSteps(25, 250)))['Kroki'];
    expect(steps.filter((l) => l.includes('Przycisk 2`'))).toEqual([
      '- Ostatni krok przed pierwszym błędem (wcześniej niż lista): 4,4 s · click · `Przycisk 2`',
    ]);
    expect(steps.filter((l) => l.startsWith('- ') && / s · click · /.test(l) && !l.startsWith('- Ostatni'))).toHaveLength(20);
  });

  it('no steps → one "brak" line', () => {
    expect(sections(buildSummary(withSteps(0)))['Kroki']).toEqual(['brak — nie zarejestrowano kroków']);
  });
});

describe('errors (AC-3.3)', () => {
  it('errors grouped with counts, ≤ 10, first frame', () => {
    const errors = sections(buildSummary(v4()))['Błędy'];
    expect(errors).toEqual([
      '- 1× od 4,2 s · `Uncaught TypeError: x is undefined` · `result.html:3:9`',
      '- 1× od 4,2 s · `Uncaught Error: frame failed` · `inner.html:1:1`',
      '- 1× od 4,2 s · `TypeError: x is undefined` · `result.js:12:9`',
    ]);
    const s = v4();
    s.runtimeErrors = [];
    for (let g = 0; g < 15; g++) {
      for (let k = 0; k < (g === 0 ? 3 : 1); k++) {
        s.runtimeErrors.push({ t: 100 + g * 10 + k, doc: 1, type: 'error', message: `Error ${g}`, stack: `Error: ${g}\n    at f (https://a.example/app.js:${g + 1}:5)` });
      }
    }
    s.consoleLogs = [];
    const grouped = sections(buildSummary(s))['Błędy'];
    expect(grouped).toHaveLength(11);
    expect(grouped[0]).toBe('- 3× od 4,3 s · `Error 0` · `app.js:1:5`');
    expect(grouped[10]).toBe('- i 5 grup więcej');
  });

  it('console errors with args {truncated, preview}: the preview is the message, two groups (E4-FIX2)', () => {
    const s = v4();
    s.runtimeErrors = [];
    s.consoleLogs = [
      { t: 100, doc: 1, level: 'error', args: { truncated: true, preview: '["first long failure",' } },
      { t: 110, doc: 1, level: 'error', args: { truncated: true, preview: '["second long failure",' } },
    ];
    const errors = sections(buildSummary(s))['Błędy'];
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('first long failure');
    expect(errors[1]).toContain('second long failure');
  });

  it('no errors → one "brak" line', () => {
    const s = v4();
    s.runtimeErrors = [];
    s.consoleLogs = [];
    expect(sections(buildSummary(s))['Błędy']).toEqual(['brak — nie zarejestrowano błędów']);
  });
});

describe('failed requests (AC-3.4, IN11)', () => {
  it('v4: method URL → status (ms), header count = overview.failedRequests', () => {
    const md = buildSummary(v4());
    expect(md).toContain('\n## Nieudane zapytania (3)\n');
    expect(sections(md)['Nieudane zapytania']).toEqual([
      '- `GET` `http://127.0.0.1:8080/img/missing.png` → 404 (2 ms)',
      '- `POST` `http://127.0.0.1:8080/api/fail` → 500 (3 ms)',
      '- `GET` `http://127.0.0.1:8080/missing.js` → 404 (2 ms)',
    ]);
  });

  it('failed requests ≤ 20 + "i N więcej", total == overview.failedRequests', () => {
    const s = v4();
    s.network = Array.from({ length: 30 }, (_, i) => ({
      t: i, doc: 1, type: 'fetch', method: 'GET', url: `https://api.example/item/${i}`,
      status: i % 6 === 5 ? 200 : i % 5 === 0 ? null : 503, error: i % 6 !== 5 && i % 5 === 0 ? 'net::ERR_FAILED' : null, durationMs: 312,
    }));
    s.overview.failedRequests = failedRequests(s).total;
    expect(s.overview.failedRequests).toBe(25);
    const md = buildSummary(s);
    expect(md).toContain('\n## Nieudane zapytania (25)\n');
    const lines = sections(md)['Nieudane zapytania'];
    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe('- `GET` `https://api.example/item/0` → błąd: `net::ERR_FAILED` (312 ms)');
    expect(lines[1]).toBe('- `GET` `https://api.example/item/1` → 503 (312 ms)');
    expect(lines[20]).toBe('- i 5 więcej');
  });

  it('no failed requests → one "brak" line', () => {
    const s = v4();
    s.network = [s.network[4]];
    s.overview.failedRequests = 0;
    const md = buildSummary(s);
    expect(md).toContain('\n## Nieudane zapytania (0)\n');
    expect(sections(md)['Nieudane zapytania']).toEqual(['brak — wszystkie zapytania się udały']);
    s.network = [];
    expect(sections(buildSummary(s))['Nieudane zapytania']).toEqual(['brak — nie zarejestrowano zapytań']);
  });
});

describe('CWV, slowest resources, cookies (AC-3.5, AC-3.6)', () => {
  it('CWV per document, unavailable with Polish reason, never 0', () => {
    expect(sections(buildSummary(v4()))['CWV']).toEqual([
      '- `http://127.0.0.1:8080/form.html`: TTFB 47 ms (dobrze) · FCP 820 ms (dobrze) · LCP 1712 ms (dobrze) · '
        + 'CLS niedostępne — przeglądarka tego nie mierzy · INP niedostępne — przeglądarka tego nie mierzy',
      '- `http://127.0.0.1:8080/result.html`: TTFB 52 ms (dobrze) · FCP 910 ms (dobrze) · LCP 4300 ms (słabo) · '
        + 'CLS 0,18 (do poprawy) · INP 336 ms (do poprawy)',
    ]);
    const s = v4();
    s.vitals = [{ doc: 1, TTFB: { available: true, value: 'x' }, LCP: { available: true }, CLS: { available: false, reason: 'weird-code' }, INP: null }];
    const line = sections(buildSummary(s))['CWV'][0];
    expect(line).toBe('- `http://127.0.0.1:8080/result.html`: TTFB niedostępne — nieznany powód · FCP niedostępne — nieznany powód · '
      + 'LCP niedostępne — nieznany powód · CLS niedostępne — `weird-code` · INP niedostępne — nieznany powód');
    expect(line).not.toMatch(/\b0 ms|CLS 0\b/);
  });

  it('only the last 5 documents + "i N dokumentów wcześniej"', () => {
    const s = v4();
    s.vitals = Array.from({ length: 7 }, (_, i) => ({ doc: i, TTFB: { available: true, value: 10 * (i + 1), rating: 'good' } }));
    const cwv = sections(buildSummary(s))['CWV'];
    expect(cwv).toHaveLength(6);
    expect(cwv[0]).toMatch(/^- dokument 2: TTFB 30 ms \(dobrze\)/);
    expect(cwv[5]).toBe('- i 2 dokumenty wcześniej');
    s.vitals = [];
    expect(sections(buildSummary(s))['CWV']).toEqual(['brak — nie zmierzono metryk']);
  });

  it('slowest 5 with type and size; cookies count/bytes/truncated', () => {
    const md = buildSummary(v4());
    expect(sections(md)['Najwolniejsze zasoby']).toEqual([
      '- 3 ms · fetch · 23 B · `http://127.0.0.1:8080/api/fail`',
      '- 2 ms · img · 9 B · `http://127.0.0.1:8080/img/missing.png`',
      '- 2 ms · img · rozmiar nieznany · `https://cdn.example/logo.png`',
      '- 2 ms · script · 9 B · `http://127.0.0.1:8080/missing.js`',
      '- 2 ms · css · 9 B · `http://127.0.0.1:8080/style.css`',
    ]);
    expect(sections(md)['Ciasteczka i rozmiar']).toEqual(['- Ciasteczka: 3, razem 45 B', '- Ucięte przez limity: nic']);
    const s = v4();
    s.truncated.consoleLogs = true;
    s.truncated.network = true;
    s.truncated.html = 'yes';
    s.network[0].durationMs = 812;
    s.network[0].sizeBytes = 48 * 1024 + 100;
    s.network[1].sizeBytes = 3.5 * 1024 * 1024;
    s.network[1].durationMs = 700;
    const out = sections(buildSummary(s));
    expect(out['Ciasteczka i rozmiar']).toEqual(['- Ciasteczka: 3, razem 45 B', '- Ucięte przez limity: consoleLogs, network']);
    expect(out['Najwolniejsze zasoby'].slice(0, 2)).toEqual([
      '- 812 ms · img · 48 KB · `http://127.0.0.1:8080/img/missing.png`',
      '- 700 ms · img · 3,5 MB · `https://cdn.example/logo.png`',
    ]);
    s.network = [];
    delete s.storage;
    s.truncated = {};
    const none = sections(buildSummary(s));
    expect(none['Najwolniejsze zasoby']).toEqual(['brak — nie zarejestrowano zapytań']);
    expect(none['Ciasteczka i rozmiar']).toEqual(['brak — paczka nie ma danych o ciasteczkach']);
  });
});

describe('privacy (AC-2.8, AC-3.9, AC-6.4, E3 D11)', () => {
  const pkg = (redaction, extra = {}) => ({ ...v4(), redaction, ...extra });

  it('masked count with Polish plurals and the rules version', () => {
    const line = (masked, rulesVersion = 1) => sections(buildSummary(pkg({ rulesVersion, disabledRules: [], masked })))['Prywatność'][0];
    expect(line({ network: 10, storage: 3, consoleLogs: 1 }))
      .toBe('- Zamaskowano 14 wartości w 3 sekcjach (reguły v1). Hasła, tokeny i dane logowania nie są w tym pliku.');
    expect(line({ network: 1 })).toContain('Zamaskowano 1 wartość w 1 sekcji (reguły v1).');
    expect(line({ network: 1, storage: 1 })).toContain('Zamaskowano 2 wartości w 2 sekcjach (reguły v1).');
    expect(line({ network: 20, storage: 1, dom: 1 })).toContain('Zamaskowano 22 wartości w 3 sekcjach (reguły v1).');
    expect(line({})).toContain('Zamaskowano 0 wartości w 0 sekcjach (reguły v1).');
  });

  it('"reguły v2" when rulesVersion 2; disabled rules line', () => {
    const md = buildSummary(pkg({ rulesVersion: 2, disabledRules: ['email', 'html-structure'], masked: { network: 1 } }));
    const privacy = sections(md)['Prywatność'];
    expect(privacy[0]).toContain('(reguły v2)');
    expect(privacy[1]).toBe('- Wyłączone przez developera: email, html-structure.');
    expect(buildSummary(v4())).not.toContain('Wyłączone przez developera');
    const odd = buildSummary(pkg({ rulesVersion: 2, disabledRules: ['phone', '# x](javascript:y)'], masked: {} }));
    expect(sections(odd)['Prywatność'][1]).toBe('- Wyłączone przez developera: phone, `# x](javascript:y)`.');
  });

  it('missing redaction (v3 package) → "Brak informacji o maskowaniu."', () => {
    const s = v4();
    delete s.redaction;
    expect(sections(buildSummary(s))['Prywatność'][0]).toBe('- Brak informacji o maskowaniu.');
  });

  it('screenshot line in Polish for each D8 note', () => {
    const shot = (notes, screenshots = []) => sections(buildSummary({ ...v4(), notes, screenshots }))['Prywatność'].at(-1);
    expect(shot([SCREENSHOT_NOTES.off])).toBe('- Zrzut ekranu: wyłączony przez zgłaszającego');
    expect(shot([SCREENSHOT_NOTES.offFrames(3)])).toBe('- Zrzut ekranu: wyłączony automatycznie — na stronie były okienka innych serwisów (3)');
    expect(shot([SCREENSHOT_NOTES.offCheckFailed])).toBe('- Zrzut ekranu: wyłączony automatycznie — nie udało się sprawdzić strony');
    expect(shot([SCREENSHOT_NOTES.notHidden('timeout')])).toBe('- Zrzut ekranu: brak — nie udało się zakryć pól formularzy');
    expect(shot([SCREENSHOT_NOTES.framesVisible(2)], v4().screenshots)).toBe('- Zrzut ekranu: jest; widać na nim 2 okienka innych serwisów, nie są zakryte');
    expect(shot([], v4().screenshots)).toBe('- Zrzut ekranu: jest');
    expect(shot([])).toBe('- Zrzut ekranu: brak — powód w Uwagach');
  });
});

describe('notes', () => {
  it('first 10 notes only, each in a code span', () => {
    const notes = Array.from({ length: 15 }, (_, i) => `Note number ${i + 1}.`);
    const lines = sections(buildSummary({ ...v4(), notes }))['Uwagi'];
    expect(lines).toHaveLength(10);
    expect(lines[9]).toBe('- `Note number 10.`');
    expect(SUMMARY_LIMITS.notes).toBe(10);
    expect(sections(buildSummary({ ...v4(), notes: [] }))['Uwagi']).toEqual(['brak — paczka nie ma uwag']);
  });
});

describe('limits (AC-3.7)', () => {
  it('heavy: ≤ 200 lines, ≤ 16 KB; generation median of 5 ≤ 100 ms on 10 MB JSON', () => {
    const s = heavy();
    expect(JSON.stringify(s).length).toBeGreaterThan(10 * 1024 * 1024);
    const md = buildSummary(s);
    expect(md.split('\n').length).toBeLessThanOrEqual(200);
    expect(bytes(md)).toBeLessThanOrEqual(16384);
    buildSummary(s);
    expect(median(() => buildSummary(s))).toBeLessThanOrEqual(100);
  });

  it('field limits: values are cut to their field limit', () => {
    const s = v4();
    s.environment.location.href = `https://a.example/${'x'.repeat(5000)}`;
    s.notes = ['n'.repeat(5000)];
    s.steps[1].text = 't'.repeat(500);
    const md = buildSummary(s);
    const parts = sections(md);
    expect(parts['Środowisko'][0]).toBe(`- Adres: \`https://a.example/${'x'.repeat(SUMMARY_LIMITS.url - 18)}…\``);
    expect(parts['Uwagi'][0]).toBe(`- \`${'n'.repeat(SUMMARY_LIMITS.note)}…\``);
    expect(parts['Kroki'][2]).toBe(`- 0,9 s · click · \`${'t'.repeat(SUMMARY_LIMITS.stepText)}…\``);
  });

  it('fitSummary: over 16 KB → trims Uwagi, resources, environment, steps, requests; errors, CWV and privacy stay whole', () => {
    const wide = (tag, i) => `${tag}${i}-${'漢'.repeat(400)}`;
    const s = v4();
    s.environment.location.href = wide('https://e.example/', 0);
    s.environment.navigator.userAgent = wide('UA', 0);
    s.notes = Array.from({ length: 10 }, (_, i) => wide('note', i));
    s.steps = Array.from({ length: 20 }, (_, i) => ({ t: 100 * i, doc: 1, type: 'click', text: wide('step', i) }));
    s.network = Array.from({ length: 30 }, (_, i) => ({ t: i, doc: 1, method: 'GET', type: 'fetch', url: wide('https://n.example/', i), status: 500, durationMs: i, sizeBytes: 1 }));
    s.overview.failedRequests = 30;
    s.runtimeErrors = Array.from({ length: 10 }, (_, i) => ({ t: 3000 + i, doc: 1, message: wide('err', i), filename: 'https://e.example/app.js', lineno: 1, colno: 1 }));
    s.consoleLogs = [];
    s.documents[1].url = wide('https://d.example/', 1);
    s.documents[0].url = wide('https://d.example/', 0);
    s.redaction.disabledRules = ['email', 'phone', 'html-structure'];
    const md = buildSummary(s);
    expect(bytes(md)).toBeLessThanOrEqual(16384);
    expect(md.split('\n').length).toBeLessThanOrEqual(200);
    const parts = sections(md);
    expect(parts['Uwagi']).toContain('(skrócono)');
    expect(parts['Najwolniejsze zasoby']).toContain('(skrócono)');
    expect(parts['Błędy']).toHaveLength(10);
    expect(parts['CWV']).toHaveLength(2);
    expect(parts['Prywatność']).toHaveLength(3);
    expect(md.startsWith('# Paczka diagnostyczna — 127.0.0.1\nZapisano ')).toBe(true);
    expect(Object.keys(parts)).toEqual(SECTIONS);
    for (const title of SECTIONS) expect(parts[title].length, title).toBeGreaterThan(0);
  });

  it('a full package within the limits is not trimmed', () => {
    // With every section at its item limit the summary has < 200 lines, so the guard only ever acts on bytes.
    const md = buildSummary(withSteps(25, 2450));
    expect(md).not.toContain('(skrócono)');
  });
});

describe('Markdown safety (AC-3.8)', () => {
  const TRAP = 'x`y ``` z\n# Fake heading ](javascript:alert(1)) <img src=x onerror=alert(1)>\r\u2028\u202e`';

  function trapped() {
    const s = v4();
    s.environment.location.href = TRAP;
    s.environment.location.hostname = TRAP;
    s.environment.navigator.userAgent = TRAP;
    s.environment.navigator.language = TRAP;
    s.collectedAt = TRAP;
    s.extensionVersion = TRAP;
    s.documents[0].url = TRAP;
    s.steps[0].url = TRAP;
    s.steps[1].text = TRAP;
    s.steps[2].selector = TRAP;
    s.steps[3].type = TRAP;
    s.runtimeErrors[0].message = TRAP;
    s.runtimeErrors[1].stack = `Error\n    at f (${TRAP}:1:2)`;
    s.network[0].url = TRAP;
    s.network[0].method = TRAP;
    s.network[0].type = TRAP;
    s.network[2].error = TRAP;
    s.network[2].status = null;
    s.vitals[0].CLS.reason = TRAP;
    s.truncated[TRAP] = true;
    s.notes = [TRAP, `\`\`\`\n${TRAP}`];
    s.screenshots[0].file = TRAP;
    s.redaction.disabledRules = [TRAP];
    return s;
  }

  it('trap values (# heading, ](javascript:…), <img onerror>, \\n, ``` backticks) produce no heading/link/HTML/code block', () => {
    const md = buildSummary(trapped());
    const lines = md.split('\n');
    expect(lines.filter((l) => l.startsWith('# '))).toHaveLength(1);
    for (const line of lines) {
      if (line === '') continue;
      expect(PREFIXES.some((p) => line.startsWith(p)), line).toBe(true);
      expect(line.startsWith('```') || line.startsWith('~~~') || line.startsWith('    '), line).toBe(false);
      // every page value sits inside a balanced code span
      const outside = outsideCode(line);
      expect(outside, line).not.toMatch(/[`<]|\]\(|javascript|onerror|Fake|\u202e/);
    }
    expect(md).toContain('Fake heading'); // the values are there, only fenced
    expect(md).not.toMatch(/[\r\u2028\u2029\u202e]/);
  });

  it('adaptive fence: one backtick more than the longest run, padded when the value starts or ends with a backtick', () => {
    const s = v4();
    s.notes = ['a ``` b', '`start', 'plain'];
    const notes = sections(buildSummary(s))['Uwagi'];
    expect(notes).toEqual(['- ````a ``` b````', '- `` `start ``', '- `plain`']);
  });
});

describe('purity and privacy (AC-5.3, AC-2.9)', () => {
  it('buildSummary(x) === buildSummary(JSON.parse(JSON.stringify(x)))', () => {
    const s = v4();
    s.steps[1].text = undefined;
    s.vitals[1].LCP.value = NaN;
    s.network[0].durationMs = Infinity;
    s.extra = () => 1;
    s.overview.steps = undefined;
    for (const x of [s, v4(), consolePackage(), heavy(), {}]) {
      expect(buildSummary(x)).toBe(buildSummary(JSON.parse(JSON.stringify(x))));
    }
  });

  it('no trap value from redaction-traps.js appears (built from the redacted package)', () => {
    const { snapshot } = redact(trapPackage());
    const md = buildSummary(snapshot);
    for (const trap of TRAPS) expect(leaks(trap, md), trap).toEqual([]);
  });

  it('never throws on wrongly typed fields', () => {
    const odd = { environment: 1, steps: 'x', runtimeErrors: [null, 1], network: [null, { status: 'x' }], vitals: [null, 3], notes: [1, null],
      redaction: { masked: null, disabledRules: 'x' }, storage: { cookies: 'x' }, truncated: [], screenshots: [{ file: 3 }], overview: 'x' };
    expect(() => buildSummary(odd)).not.toThrow();
    expect(() => buildSummary(null)).not.toThrow();
    expect(buildSummary(null).split('\n')[0]).toBe('# Paczka diagnostyczna — nieznana strona');
  });

  it('a marker-free secret outside the read fields does not appear', () => {
    const s = v4();
    s.consoleLogs.push({ t: 1, doc: 1, level: 'log', args: [`token ${JWT}`] });
    s.storage.localStorage.session = 'SECRET-STORAGE-VALUE-123';
    s.dom.structure = '<div id="SECRET-DOM-ID"></div>';
    const md = buildSummary(s);
    expect(md).not.toContain(JWT);
    expect(md).not.toContain('SECRET-STORAGE-VALUE-123');
    expect(md).not.toContain('SECRET-DOM-ID');
  });
});
