import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, formatClock, messageFor } from '../../src/popup/messages.js';
import { DEFAULT_RULES } from '../../src/lib/redact-rules.js';

const FORBIDDEN = ['executeScript', 'inject', 'undefined', 'Error:', 'stack', 'PageDebugSnapshot'];
// E2 AC-1.2: jargon of the new categories. Checked case-insensitively in the disclosure and
// case-sensitively elsewhere, so the plain "http://" scheme in fileUnsupportedFirefox stays allowed.
const FORBIDDEN_E2 = ['CWV', 'LCP', 'webRequest', 'HTTP', 'base64', 'selector'];
const SAMPLE_FILE = 'page-debug-snapshot-1700000000000.json';
const SAMPLE_ARGS = { saved: SAMPLE_FILE, savedFile: SAMPLE_FILE, recordingSince: '2026-10-22T14:03:21.000Z' };
// AC-1.8 (E4-IN8, decision Q-5), verbatim.
const CONSENT_AC_1_8 =
  'Mimo automatycznego usuwania haseł i tokenów plik może zawierać Twoje dane osobowe (np. adresy stron, treść logów) — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.';
// AC-1.1 (decision Q-2), verbatim.
const INSTRUCTION_Q2 = 'Wyślij ten plik osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.';
// Texts of the E4 saved screen and the developer-configuration disclosure (AC-1.7).
const E4_KEYS = ['savedTitle', 'savedFile', 'savedInstruction', 'showFile', 'newRecording', 'fileMissing', 'disclosureDevExtra', 'otherTabRecordingSaved'];

// Flattens strings, arrays and functions (called with a sample argument) into [path, text].
function collectTexts(value, path) {
  if (typeof value === 'function') {
    return collectTexts(value(SAMPLE_ARGS[path] ?? SAMPLE_FILE), path);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectTexts(item, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => collectTexts(item, `${path}.${key}`));
  }
  return [[path, value]];
}

function allTexts() {
  return Object.entries(MESSAGES).flatMap(([key, value]) => collectTexts(value, key));
}

const OUTCOMES = [
  'saveCancelled',
  'downloadFailed',
  'pageBusy',
  'permissionDenied',
  'recordFailed',
  'restricted',
  'fileAccess',
  'noTab',
  'failed',
];

describe('MESSAGES', () => {
  it('is a closed set of keys', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(
      [
        'disclosureTitle',
        'disclosureItems',
        'noUpload',
        'consentNotice',
        'reloadNotice',
        'otherTabRecording',
        'starting',
        'recordingSince',
        'recordingHint',
        'otherOrigin',
        'stoppedByLimit',
        'saving',
        'saved',
        'fileUnsupportedFirefox',
        'privacyNote',
        'includeScreenshot',
        'screenshotFramesNote',
        'screenshotCheckFailedNote',
        'screenshotOffSaved',
        'screenshotFailedSaved',
        ...E4_KEYS,
        ...OUTCOMES,
      ].sort(),
    );
    expect(Object.isFrozen(MESSAGES)).toBe(true);
    expect(Object.isFrozen(MESSAGES.disclosureItems)).toBe(true);
    expect(Object.isFrozen(MESSAGES.disclosureDevExtra)).toBe(true);
  });

  it('messages contain no forbidden words', () => {
    const texts = allTexts();
    expect(texts.length).toBeGreaterThan(Object.keys(MESSAGES).length);
    for (const [key, text] of texts) {
      expect(typeof text, key).toBe('string');
      expect(text.length, key).toBeGreaterThan(0);
      for (const word of FORBIDDEN) {
        expect(text.toLowerCase(), `${key} contains ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it('messages contain no forbidden words incl. CWV, LCP, webRequest, HTTP, base64, selector', () => {
    for (const [key, text] of allTexts()) {
      for (const word of FORBIDDEN_E2) {
        expect(text, `${key} contains ${word}`).not.toContain(word);
      }
    }
    const disclosure = [MESSAGES.disclosureTitle, ...MESSAGES.disclosureItems];
    for (const text of disclosure) {
      for (const word of FORBIDDEN_E2) {
        expect(text.toLowerCase(), `disclosure contains ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });

  it('disclosure lists the eight categories after E3 (AC-1.3) and the no-upload sentence verbatim', () => {
    expect(MESSAGES.disclosureTitle).toBe('Do pliku trafią:');
    expect(MESSAGES.disclosureItems).toEqual([
      'adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu',
      'kroki: co klikasz i na jakich stronach — bez treści, które wpisujesz',
      'logi konsoli i błędy',
      'zapytania sieciowe strony: adresy, nagłówki i wysyłana treść oraz adresy wczytanych plików',
      'fragmenty odpowiedzi serwera, gdy coś się nie uda',
      'struktura strony bez tekstów i bez wartości wpisanych w formularze',
      'zrzut ekranu w chwili zapisu (możesz go wyłączyć) — pola formularzy tej strony są na nim zakryte, ale formularze osadzone z innych serwisów (np. płatność, logowanie) mogą być widoczne',
      'nazwy i rozmiary ciasteczek oraz dane zapisane przez stronę',
    ]);
    expect(MESSAGES.noUpload).toBe('Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła.');
  });

  it('disclosure has no "mogą zawierać dane logowania" for network and cookies; privacyNote present (AC-1.3)', () => {
    for (const item of MESSAGES.disclosureItems) {
      expect(item).not.toContain('mogą zawierać dane logowania');
    }
    const network = MESSAGES.disclosureItems.find((item) => item.startsWith('zapytania sieciowe'));
    const cookies = MESSAGES.disclosureItems.find((item) => item.includes('ciasteczek'));
    expect(network).toBeDefined();
    expect(cookies).toBeDefined();
    expect(MESSAGES.privacyNote).toBe(
      'Hasła i tokeny są usuwane z pliku automatycznie, a wartości ciasteczek zastępowane krótkim skrótem. Plik nadal może zawierać adresy odwiedzanych stron i treść logów.',
    );
    // Store review S4: cookie values leave a short digest, so the note must not say they are removed.
    expect(MESSAGES.privacyNote).not.toMatch(/ciasteczek są usuwane/);
    expect(MESSAGES.includeScreenshot).toBe('Dołącz zrzut ekranu');
    // QA F-5: appended to "Zapisano…" when the file has no screenshot.
    expect(MESSAGES.screenshotOffSaved).toBe('Plik nie zawiera zrzutu ekranu.');
    expect(MESSAGES.screenshotFailedSaved).toBe('Plik nie zawiera zrzutu ekranu — nie udało się go bezpiecznie wykonać.');
    expect(messageFor({ kind: 'saved', fileName: SAMPLE_FILE, screenshot: 'failed' })).toBe(
      `${MESSAGES.saved(SAMPLE_FILE)} ${MESSAGES.screenshotFailedSaved}`,
    );
    expect(messageFor({ kind: 'saved', fileName: SAMPLE_FILE, screenshot: 'off' })).toBe(
      `${MESSAGES.saved(SAMPLE_FILE)} ${MESSAGES.screenshotOffSaved}`,
    );
    expect(messageFor({ kind: 'saved', fileName: SAMPLE_FILE, screenshot: 'included' })).toBe(MESSAGES.saved(SAMPLE_FILE));
    // Review N6 (fail-closed): the frame check failed, so the screenshot starts off.
    expect(MESSAGES.screenshotCheckFailedNote).toBe('Nie udało się sprawdzić strony — zrzut wyłączony. Możesz go włączyć.');
    expect(MESSAGES.screenshotFramesNote).toBe(
      'Na stronie są okienka innych serwisów (np. płatność) — zrzut wyłączony. Możesz go włączyć.',
    );
  });

  it('forbidden words JSON, zip, hash, redakcja anywhere; "token" only inside privacyNote and consentNotice (AC-1.3, AC-1.8)', () => {
    for (const [key, text] of allTexts()) {
      // The file name passed into `saved` is the background's, not our wording.
      const own = text.replace(SAMPLE_FILE, '').toLowerCase();
      for (const word of ['json', 'zip', 'hash', 'redakcja', 'redakcji']) {
        expect(own, `${key} contains ${word}`).not.toContain(word);
      }
      if (key !== 'privacyNote' && key !== 'consentNotice') expect(own, `${key} contains token`).not.toContain('token');
    }
  });

  it('disclosure lists steps without typed text, screenshot and server responses on errors', () => {
    const items = MESSAGES.disclosureItems;
    const steps = items.find((item) => item.startsWith('kroki'));
    expect(steps).toContain('co klikasz');
    expect(steps).toContain('na jakich stronach');
    expect(steps).toMatch(/bez treści, które wpisujesz/);
    expect(items.some((item) => item.startsWith('zrzut ekranu w chwili zapisu'))).toBe(true);
    expect(items.some((item) => item.includes('odpowiedzi serwera') && item.includes('gdy coś się nie uda'))).toBe(true);
  });

  it('screenshot item says the fields of this page are covered, embedded forms of other services may show, and it can be turned off (E3 D6, review F4 / store S1)', () => {
    const shot = MESSAGES.disclosureItems.find((item) => item.startsWith('zrzut'));
    expect(shot).toContain('możesz go wyłączyć');
    expect(shot).toContain('pola formularzy tej strony są na nim zakryte');
    expect(shot).toContain('formularze osadzone z innych serwisów (np. płatność, logowanie) mogą być widoczne');
    expect(shot.length).toBeLessThanOrEqual(200);
    for (const word of ['screenshot', 'viewport', 'input', 'canvas', 'JPEG', 'pikseli']) {
      expect(shot.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
  });

  it('consentNotice is AC-1.8 verbatim in messages.js and popup.html (AC-1.8)', () => {
    // popup.html side: popup-html.test.js compares #consentNotice with MESSAGES.consentNotice.
    expect(MESSAGES.consentNotice).toBe(CONSENT_AC_1_8);
    expect(MESSAGES.consentNotice).not.toContain('dane logowania');
  });

  it('saved screen texts; instruction is Q-2 verbatim (AC-1.1, AC-1.2)', () => {
    expect(MESSAGES.savedTitle).toBe('Zapisano');
    expect(MESSAGES.savedFile(SAMPLE_FILE)).toBe(`Plik: ${SAMPLE_FILE}`);
    expect(MESSAGES.savedInstruction).toBe(INSTRUCTION_Q2);
    expect(MESSAGES.showFile).toBe('Pokaż plik');
    expect(MESSAGES.newRecording).toBe('Nowe nagranie');
    expect(MESSAGES.fileMissing).toBe('Nie znaleziono pliku. Zapisz paczkę ponownie.');
  });

  it('new texts (saved*, showFile, newRecording, fileMissing, disclosureDevExtra) contain none of JSON|zip|MCP|snapshot|hash|redakcja (case-insensitive) (AC-1.7)', () => {
    const texts = E4_KEYS.flatMap((key) => collectTexts(MESSAGES[key], key));
    expect(texts.length).toBeGreaterThanOrEqual(E4_KEYS.length + 2);
    for (const [key, text] of texts) {
      // The file name is data from the background, not our wording.
      const own = text.replace(SAMPLE_FILE, '');
      expect(own, key).not.toMatch(/json|zip|mcp|snapshot|hash|redakcj/i);
      expect(own.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('disclosureDevExtra has one text per DEFAULT_RULES rule, in plain Polish (AC-6.5)', () => {
    expect(Object.keys(MESSAGES.disclosureDevExtra).sort()).toEqual([...DEFAULT_RULES].sort());
    expect(MESSAGES.disclosureDevExtra.email).toContain('adresy e-mail');
    expect(MESSAGES.disclosureDevExtra.phone).toContain('numery telefonów');
    expect(MESSAGES.disclosureDevExtra['html-structure']).toContain('pełna treść strony');
    for (const text of Object.values(MESSAGES.disclosureDevExtra)) {
      expect(text).not.toMatch(/html|regu[łl]|developer|konfigurac/i);
    }
  });

  it('no text offers sending from the popup (decision 2026-10-26: no "Wyślij" button, mailto or link)', () => {
    for (const [key, text] of allTexts()) {
      expect(text, key).not.toMatch(/mailto:|https?:\/\/\w/i);
    }
  });

  it('reload notice mentions odświeży', () => {
    expect(MESSAGES.reloadNotice).toContain('odświeży');
    expect(MESSAGES.reloadNotice).toContain('„Nagrywaj”');
  });

  it('recordingSince matches ^Nagrywam od \\d{2}:\\d{2}:\\d{2}', () => {
    const re = /^Nagrywam od \d{2}:\d{2}:\d{2}$/;
    expect(MESSAGES.recordingSince('14:03:21')).toBe('Nagrywam od 14:03:21');
    expect(MESSAGES.recordingSince(Date.now())).toMatch(re);
    expect(MESSAGES.recordingSince(new Date().toISOString())).toMatch(re);
  });

  it('recordingSince formats the local time of an ISO or epoch start', () => {
    const local = new Date(2026, 9, 22, 14, 3, 21);
    expect(MESSAGES.recordingSince(local.getTime())).toBe('Nagrywam od 14:03:21');
    expect(MESSAGES.recordingSince(local.toISOString())).toBe('Nagrywam od 14:03:21');
  });

  it('stoppedByLimit text', () => {
    expect(MESSAGES.stoppedByLimit).toBe('Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.');
  });

  it('saved message contains the file name', () => {
    expect(MESSAGES.saved(SAMPLE_FILE)).toBe(
      `Zapisano plik ${SAMPLE_FILE} — znajdziesz go w pobranych plikach.`,
    );
  });

  it('restricted still starts with "Na tej stronie nie da się zapisać paczki."', () => {
    expect(MESSAGES.restricted.startsWith('Na tej stronie nie da się zapisać paczki.')).toBe(true);
  });

  it('fileAccess message names the Chrome setting', () => {
    expect(MESSAGES.fileAccess).toContain('chrome://extensions');
    expect(MESSAGES.fileAccess).toContain('Zezwalaj na dostęp do adresów URL plików');
  });

  it('fileUnsupportedFirefox tells to open the page over http(s), verbatim (QA F-4)', () => {
    expect(MESSAGES.fileUnsupportedFirefox).toBe(
      'W Firefoksie nagrywanie plików z dysku nie jest obsługiwane. Otwórz stronę przez http:// lub https://.',
    );
  });

  it('permissionDenied says recording needs consent', () => {
    expect(MESSAGES.permissionDenied).toContain('Bez Twojej zgody');
    expect(MESSAGES.permissionDenied).toContain('„Nagrywaj”');
  });
});

describe('formatClock', () => {
  afterEach(() => vi.useRealTimers());

  it('formatClock pads to two digits', () => {
    expect(formatClock(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe('03:04:05');
    expect(formatClock(new Date(2026, 0, 2, 0, 0, 0).getTime())).toBe('00:00:00');
    expect(formatClock(new Date(2026, 0, 2, 23, 59, 59).getTime())).toBe('23:59:59');
  });

  it('does not use toLocaleTimeString', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString');
    formatClock(Date.now());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns a neutral placeholder for invalid input, never "undefined" or NaN', () => {
    for (const bad of [undefined, null, 'nonsense', NaN, {}]) {
      expect(formatClock(bad)).toBe('--:--:--');
    }
    expect(MESSAGES.recordingSince(undefined)).toBe('Nagrywam od --:--:--');
  });
});

describe('messageFor', () => {
  it('maps saved with fileName', () => {
    expect(messageFor({ kind: 'saved', fileName: SAMPLE_FILE })).toBe(MESSAGES.saved(SAMPLE_FILE));
  });

  it('maps every non-success kind to its text', () => {
    for (const kind of OUTCOMES) {
      expect(messageFor({ kind })).toBe(MESSAGES[kind]);
    }
  });

  it('falls back to failed for unknown or missing outcome', () => {
    expect(messageFor({ kind: 'nonsense' })).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'saving' })).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'disclosureItems' })).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'success', fileName: SAMPLE_FILE })).toBe(MESSAGES.failed);
    expect(messageFor(undefined)).toBe(MESSAGES.failed);
    expect(messageFor({ kind: 'saved' })).toBe(MESSAGES.failed);
  });
});
