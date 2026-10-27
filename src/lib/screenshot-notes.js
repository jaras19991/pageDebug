// Notes about the screenshot (E3 D6, E4 D8): the English texts that go to `notes`, and the one Polish line of the
// summary computed back from the same texts (IN6, IN11). No new package field: the reason lives only in `notes`.
// Pure: no chrome.*, no DOM, no clock. Bundled into the console fallback and the viewer through package.js / summary.js.

const NOTE_TEXT_MAX = 200;
// Frame counts come from the popup (`crossOriginFrames`) and ISOLATED (`crossOriginVisible`), both capped at 999.
export const FRAMES_MAX = 999;

const cap = (value, max) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const frames = (n) => `${n} frame${n === 1 ? '' : 's'} of other sites`;

/** A whole number of frames that may appear in a note: 1..FRAMES_MAX, else null. */
export function frameCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= FRAMES_MAX ? value : null;
}

/** Notes about the screenshot that the background knows the reason of. */
export const SCREENSHOT_NOTES = Object.freeze({
  // The reporter unticked the box (or the popup did not say why).
  off: 'Screenshot not included (turned off by the reporter).',
  // The popup turned it off by default and the reporter left it off (D8).
  offFrames: (n) =>
    `Screenshot not included: the page showed ${frames(n)}, so it was off by default and the reporter did not turn it on.`,
  offCheckFailed:
    'Screenshot not included: the page could not be checked for frames of other sites, so it was off by default and the reporter did not turn it on.',
  // The image is in the package; frames of other origins are never masked (PB-1 = B).
  framesVisible: (n) => `The screenshot shows ${frames(n)}; ${n === 1 ? 'it is' : 'they are'} not covered.`,
  notHidden: (reason) => `No screenshot: form fields could not be hidden (${cap(reason, NOTE_TEXT_MAX)}).`,
});

// Only the digits of a note are read back; any other text of a note never reaches the Polish line.
const OFF_FRAMES = /^Screenshot not included: the page showed (\d{1,3}) frames? of other sites, so it was off by default/;
const FRAMES_VISIBLE = /^The screenshot shows (\d{1,3}) frames? of other sites; (?:it is|they are) not covered\.$/;
const NOT_HIDDEN = 'No screenshot: form fields could not be hidden (';

// Polish plural of „okienko innego serwisu”: 1 / 2–4 (not 12–14) / the rest.
function windowsOfOtherSites(n) {
  if (n === 1) return '1 okienko innego serwisu, nie jest zakryte';
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return `${n} ${few ? 'okienka' : 'okienek'} innych serwisów, nie są zakryte`;
}

const LINE = 'Zrzut ekranu: ';

/**
 * The screenshot line of the summary's privacy section, in Polish (D2, D8). Reads `screenshots` and `notes` only.
 * @param {{ screenshots?: unknown[], notes?: unknown[] }} snapshot
 * @returns {string}
 */
export function describeScreenshot(snapshot) {
  const notes = Array.isArray(snapshot?.notes) ? snapshot.notes.filter((n) => typeof n === 'string') : [];
  const included = Array.isArray(snapshot?.screenshots) && snapshot.screenshots.length > 0;
  if (included) {
    for (const note of notes) {
      const count = frameCount(Number(FRAMES_VISIBLE.exec(note)?.[1]));
      if (count !== null) return `${LINE}jest; widać na nim ${windowsOfOtherSites(count)}`;
    }
    return `${LINE}jest`;
  }
  for (const note of notes) {
    if (note === SCREENSHOT_NOTES.off) return `${LINE}wyłączony przez zgłaszającego`;
    if (note === SCREENSHOT_NOTES.offCheckFailed) return `${LINE}wyłączony automatycznie — nie udało się sprawdzić strony`;
    const count = frameCount(Number(OFF_FRAMES.exec(note)?.[1]));
    if (count !== null) return `${LINE}wyłączony automatycznie — na stronie były okienka innych serwisów (${count})`;
    if (note.startsWith(NOT_HIDDEN)) return `${LINE}brak — nie udało się zakryć pól formularzy`;
  }
  return `${LINE}brak — powód w Uwagach`;
}
