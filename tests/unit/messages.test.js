import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, formatClock, messageFor } from '../../src/popup/messages.js';

const FORBIDDEN = ['executeScript', 'inject', 'undefined', 'Error:', 'stack', 'PageDebugSnapshot'];
const SAMPLE_FILE = 'page-debug-snapshot-1700000000000.json';
const SAMPLE_ARGS = { saved: SAMPLE_FILE, recordingSince: '2026-10-22T14:03:21.000Z' };

// Flattens strings, arrays and functions (called with a sample argument) into [path, text].
function collectTexts(value, path) {
  if (typeof value === 'function') {
    return collectTexts(value(SAMPLE_ARGS[path] ?? SAMPLE_FILE), path);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectTexts(item, `${path}[${i}]`));
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
        ...OUTCOMES,
      ].sort(),
    );
    expect(Object.isFrozen(MESSAGES)).toBe(true);
    expect(Object.isFrozen(MESSAGES.disclosureItems)).toBe(true);
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

  it('disclosure lists the five categories from AC-1.1 and the no-upload sentence verbatim', () => {
    expect(MESSAGES.disclosureTitle).toBe('Do pliku trafią:');
    expect(MESSAGES.disclosureItems).toEqual([
      'adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu',
      'logi konsoli i błędy',
      'zapytania sieciowe strony: adresy, nagłówki i wysyłana treść (mogą zawierać dane logowania) oraz adresy wczytanych plików',
      'treść i struktura strony, w tym wartości wpisane w formularze (bez haseł i pól ukrytych)',
      'ciasteczka i dane zapisane przez stronę (mogą zawierać dane logowania)',
    ]);
    expect(MESSAGES.noUpload).toBe('Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła.');
  });

  it('consent notice (store review F2) warns about personal data and ties "Nagrywaj" to consent, verbatim', () => {
    expect(MESSAGES.consentNotice).toBe(
      'Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.',
    );
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
