import { describe, it, expect } from 'vitest';
import { buildSummary, SUMMARY_LIMITS } from '../../src/lib/summary.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLXVzZXItMSJ9.ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 4,
    extensionVersion: '0.5.0',
    source: 'extension',
    collectedAt: '2026-10-26T10:00:00.000Z',
    overview: { runtimeErrors: 2, consoleErrors: 1, failedRequests: 3, steps: 9, poorVitals: 1, screenshot: true },
    redaction: { rulesVersion: 1, disabledRules: [], masked: { network: 10, storage: 3, consoleLogs: 1 } },
    documents: [{ id: 0, url: 'https://shop.example.com/cart?token=[redacted:key-token]' }],
    notes: ['Recording started at 2026-10-26T09:59:00.000Z (page reloaded); earlier data is not included.'],
    screenshots: [{ file: 'screenshot.jpg', maskedFields: 2 }],
    consoleLogs: [{ level: 'log', args: [`token ${JWT}`] }],
    environment: {
      location: { href: 'https://shop.example.com/cart?token=[redacted:key-token]', hostname: 'shop.example.com' },
      navigator: { userAgent: 'Mozilla/5.0 Test', language: 'pl-PL' },
      viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 },
    },
    storage: { localStorage: { session: 'SECRET-STORAGE-VALUE-123' } },
    dom: { structure: '<div id="SECRET-DOM-ID"></div>' },
    ...overrides,
  };
}

describe('buildSummary (D11, AC-4.3)', () => {
  it('contains "Zamaskowano 14 wartości w 3 sekcjach (reguły v1)." for masked {network:10, storage:3, consoleLogs:1}', () => {
    const md = buildSummary(snapshot());
    expect(md).toContain('Zamaskowano 14 wartości w 3 sekcjach (reguły v1). Hasła, tokeny i dane logowania nie są w tym pliku.');
    expect(md.startsWith('# Paczka diagnostyczna — shop.example.com\n')).toBe(true);
    expect(md).toContain('2026-10-26T10:00:00.000Z');
    expect(md).toContain('0.5.0');
    expect(md).toMatch(/schemat[^\n]*4/);
    expect(md).toContain('https://shop.example.com/cart?token=[redacted:key-token]');
    expect(md).toContain('Mozilla/5.0 Test');
    expect(md).toContain('1280×720');
    expect(md).toContain('pl-PL');
    expect(md).toContain('Pełne dane: snapshot.json; obraz: screenshot.jpg.');
  });

  it('lists disabled rules when present', () => {
    expect(buildSummary(snapshot())).not.toContain('Wyłączone przez developera');
    const md = buildSummary(snapshot({ redaction: { rulesVersion: 1, disabledRules: ['email', 'html-structure'], masked: { network: 1 } } }));
    expect(md).toContain('Wyłączone przez developera: email, html-structure.');
  });

  it('overview counts and screenshot yes/no rendered', () => {
    const md = buildSummary(snapshot());
    expect(md).toContain('## Przegląd');
    expect(md).toMatch(/Błędy JavaScript: 2/);
    expect(md).toMatch(/Błędy w konsoli: 1/);
    expect(md).toMatch(/Nieudane zapytania: 3/);
    expect(md).toMatch(/Kroki: 9/);
    expect(md).toMatch(/Słabe metryki[^\n]*: 1/);
    expect(md).toMatch(/Zrzut ekranu: tak/);
    const noShot = buildSummary(snapshot({ overview: { ...snapshot().overview, screenshot: false }, screenshots: [] }));
    expect(noShot).toMatch(/Zrzut ekranu: nie/);
    expect(noShot).toContain('Pełne dane: snapshot.json.');
    expect(noShot).not.toContain('screenshot.jpg');
  });

  it('polish plural forms 1/2/5/22', () => {
    const line = (masked) => buildSummary(snapshot({ redaction: { rulesVersion: 1, disabledRules: [], masked } }));
    expect(line({ network: 1 })).toContain('Zamaskowano 1 wartość w 1 sekcji (reguły v1).');
    expect(line({ network: 1, storage: 1 })).toContain('Zamaskowano 2 wartości w 2 sekcjach (reguły v1).');
    expect(line({ network: 3, storage: 1, dom: 1 })).toContain('Zamaskowano 5 wartości w 3 sekcjach (reguły v1).');
    expect(line({ network: 20, storage: 1, dom: 1 })).toContain('Zamaskowano 22 wartości w 3 sekcjach (reguły v1).');
    expect(line({})).toContain('Zamaskowano 0 wartości w 0 sekcjach (reguły v1).');
  });

  it('missing redaction (v3 package) → "Brak informacji o maskowaniu."', () => {
    const v3 = snapshot({ schemaVersion: 3 });
    delete v3.redaction;
    const md = buildSummary(v3);
    expect(md).toContain('Brak informacji o maskowaniu.');
    expect(md).not.toContain('Zamaskowano');
  });

  it('built from redacted snapshot: no marker-free secret from fixture appears', () => {
    const md = buildSummary(snapshot());
    expect(md).not.toContain(JWT);
    expect(md).not.toContain('SECRET-STORAGE-VALUE-123');
    expect(md).not.toContain('SECRET-DOM-ID');
  });

  it('first 10 notes only', () => {
    const notes = Array.from({ length: 15 }, (_, i) => `Note number ${i + 1}.`);
    const md = buildSummary(snapshot({ notes }));
    expect(md).toContain('## Uwagi');
    expect(md).toContain('Note number 10.');
    expect(md).not.toContain('Note number 11.');
    expect(SUMMARY_LIMITS.notes).toBe(10);
  });

  it('sections without data are omitted; never throws on an empty object', () => {
    const md = buildSummary(snapshot({ notes: [], environment: null }));
    expect(md).not.toContain('## Uwagi');
    expect(md).not.toContain('## Środowisko');
    expect(md).toContain('# Paczka diagnostyczna — shop.example.com');
    expect(() => buildSummary({})).not.toThrow();
    expect(buildSummary({})).toContain('# Paczka diagnostyczna — nieznana strona');
  });

  it('values are one line and capped; markdown headings cannot be injected', () => {
    const long = `x${'a'.repeat(5000)}`;
    const md = buildSummary(snapshot({ notes: ['line one\n# Fake heading', long] }));
    expect(md).not.toMatch(/^# Fake heading/m);
    expect(md.split('\n').every((l) => l.length <= SUMMARY_LIMITS.lineChars + 20)).toBe(true);
  });

  it('console source is named', () => {
    expect(buildSummary(snapshot({ source: 'console' }))).toMatch(/Źródło: skrypt w konsoli/);
    expect(buildSummary(snapshot())).toMatch(/Źródło: rozszerzenie/);
  });
});
