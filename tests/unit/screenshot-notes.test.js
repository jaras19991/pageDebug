import { describe, it, expect } from 'vitest';
import { SCREENSHOT_NOTES, describeScreenshot } from '../../src/lib/screenshot-notes.js';

// E4 D8 (IN6, IN11): English notes in the package, one Polish line for the summary computed from the same constants.
describe('SCREENSHOT_NOTES texts', () => {
  it('reporter, frames, failed check and visible frames have fixed texts', () => {
    expect(SCREENSHOT_NOTES.off).toBe('Screenshot not included (turned off by the reporter).');
    expect(SCREENSHOT_NOTES.offFrames(3)).toBe(
      'Screenshot not included: the page showed 3 frames of other sites, so it was off by default and the reporter did not turn it on.',
    );
    expect(SCREENSHOT_NOTES.offFrames(1)).toBe(
      'Screenshot not included: the page showed 1 frame of other sites, so it was off by default and the reporter did not turn it on.',
    );
    expect(SCREENSHOT_NOTES.offCheckFailed).toBe(
      'Screenshot not included: the page could not be checked for frames of other sites, so it was off by default and the reporter did not turn it on.',
    );
    expect(SCREENSHOT_NOTES.framesVisible(2)).toBe('The screenshot shows 2 frames of other sites; they are not covered.');
    expect(SCREENSHOT_NOTES.framesVisible(1)).toBe('The screenshot shows 1 frame of other sites; it is not covered.');
    expect(SCREENSHOT_NOTES.notHidden('x')).toBe('No screenshot: form fields could not be hidden (x).');
    expect(SCREENSHOT_NOTES.notHidden('y'.repeat(500)).length).toBeLessThan(260);
  });
});

describe('describeScreenshot (AC-3.9, AC-3.10)', () => {
  const SHOT = { t: 1, file: 'screenshot.jpg', reason: 'save' };
  const snap = (notes, screenshots = []) => ({ notes, screenshots });

  it.each([
    ['reporter', snap([SCREENSHOT_NOTES.off]), 'Zrzut ekranu: wyłączony przez zgłaszającego'],
    ['frames', snap([SCREENSHOT_NOTES.offFrames(3)]), 'Zrzut ekranu: wyłączony automatycznie — na stronie były okienka innych serwisów (3)'],
    ['check failed', snap([SCREENSHOT_NOTES.offCheckFailed]), 'Zrzut ekranu: wyłączony automatycznie — nie udało się sprawdzić strony'],
    ['visible 2', snap([SCREENSHOT_NOTES.framesVisible(2)], [SHOT]), 'Zrzut ekranu: jest; widać na nim 2 okienka innych serwisów, nie są zakryte'],
    ['visible 1', snap([SCREENSHOT_NOTES.framesVisible(1)], [SHOT]), 'Zrzut ekranu: jest; widać na nim 1 okienko innego serwisu, nie jest zakryte'],
    ['visible 5', snap([SCREENSHOT_NOTES.framesVisible(5)], [SHOT]), 'Zrzut ekranu: jest; widać na nim 5 okienek innych serwisów, nie są zakryte'],
    ['visible 12', snap([SCREENSHOT_NOTES.framesVisible(12)], [SHOT]), 'Zrzut ekranu: jest; widać na nim 12 okienek innych serwisów, nie są zakryte'],
    ['visible 22', snap([SCREENSHOT_NOTES.framesVisible(22)], [SHOT]), 'Zrzut ekranu: jest; widać na nim 22 okienka innych serwisów, nie są zakryte'],
    ['included', snap([], [SHOT]), 'Zrzut ekranu: jest'],
    ['not hidden', snap([SCREENSHOT_NOTES.notHidden('the page did not answer')]), 'Zrzut ekranu: brak — nie udało się zakryć pól formularzy'],
    ['other reason', snap(['No screenshot: the tab was not visible.']), 'Zrzut ekranu: brak — powód w Uwagach'],
    ['console', snap(['Screenshots are not available without the extension.']), 'Zrzut ekranu: brak — powód w Uwagach'],
  ])('%s → Polish line', (_label, snapshot, line) => {
    expect(describeScreenshot(snapshot)).toBe(line);
  });

  it('maps every note kind to Polish; no note text in English leaks into it', () => {
    const notes = [
      SCREENSHOT_NOTES.off,
      SCREENSHOT_NOTES.offFrames(4),
      SCREENSHOT_NOTES.offCheckFailed,
      SCREENSHOT_NOTES.notHidden('invalid answer'),
      'No screenshot: the tab was not visible.',
    ];
    const lines = [...notes.map((n) => describeScreenshot(snap([n]))), describeScreenshot(snap([SCREENSHOT_NOTES.framesVisible(3)], [SHOT]))];
    for (const line of lines) {
      expect(line).toMatch(/^Zrzut ekranu: /);
      expect(line).not.toMatch(/screenshot|frame|reporter|site|page|invalid|answer|visible/i);
    }
  });

  it('a "frames visible" note is ignored when the package has no screenshot', () => {
    expect(describeScreenshot(snap([SCREENSHOT_NOTES.framesVisible(2)]))).toBe('Zrzut ekranu: brak — powód w Uwagach');
  });

  it('a page value that only looks like a note does not inject text (only the digits are read)', () => {
    const fake = 'Screenshot not included: the page showed `x` frames of other sites';
    expect(describeScreenshot(snap([fake]))).toBe('Zrzut ekranu: brak — powód w Uwagach');
  });

  it('malformed snapshot → no throw', () => {
    expect(describeScreenshot(null)).toBe('Zrzut ekranu: brak — powód w Uwagach');
    expect(describeScreenshot({ notes: 'x', screenshots: 'y' })).toBe('Zrzut ekranu: brak — powód w Uwagach');
    expect(describeScreenshot({ notes: [null, 5], screenshots: [SHOT] })).toBe('Zrzut ekranu: jest');
  });
});
