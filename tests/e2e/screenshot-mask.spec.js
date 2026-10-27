// E3-TEST4: form fields hidden on the screenshot and the reporter's switch (AC-2.1–2.4, spec question 2, gate PB-1 = B).
// The mask is checked on the decoded screenshot.jpg: every field rectangle (getBoundingClientRect × image scale) must be
// uniform (luma stddev ≤ 2% of 255), while a region outside the fields must still show its text. DPR 2 is a real one
// (`--force-device-scale-factor=2`): captureVisibleTab reads the real surface, an emulated deviceScaleFactor would not
// change the image (spike E2-T0, S0). Cross-origin frames are NOT masked by design (PB-1 = B); the test pins that down.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { SCREENSHOT_NOTES } from '../../src/lib/screenshot-notes.js';
import { SCREENSHOT_FILE } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { readZipPackage } from './helpers/download.js';
import { lumaDiff, regionLuma } from './helpers/image.js';
import { launchWithExtension, openPopupFor, waitForDownloadFile } from './helpers/launch.js';
import { popupState, readSaveOutcome, saveRecording, setRecordingLimit, startRecording } from './helpers/recording.js';

const UNIFORM_MAX_STDDEV = 0.02 * 255; // AC-2.2: luma deviation ≤ 2%
const MASK_LUMA = 158; // #9e9e9e
const FIELD_RED_LUMA = 0.299 * 230 + 0.587 * 20 + 0.114 * 20; // rgb(230, 20, 20) of screenshot-mask.html
const NOTE_OFF = 'Screenshot not included (turned off by the reporter).';
const NOTE_NOT_HIDDEN_RE = /^No screenshot: form fields could not be hidden \(.+\)\.$/;
const LIMIT_MS = 3000;

let server;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
});

test.afterAll(async () => {
  await server?.close();
});

async function withTab(ext, fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// CSS rectangles (top viewport) of every `.mask` field and of the field inside each iframe (frame rect + border +
// padding + field rect, the content box offset of spike S0), plus the control heading and the window size.
// Cross-origin frames: the field rect comes from Playwright's frame handle (the page itself cannot read it).
async function measure(page) {
  const top = await page.evaluate(() => {
    const w = globalThis;
    const doc = w.document;
    const box = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
    const frames = [...doc.querySelectorAll('iframe')].map((frame) => {
      const r = frame.getBoundingClientRect();
      const style = w.getComputedStyle(frame);
      const origin = {
        x: r.left + frame.clientLeft + parseFloat(style.paddingLeft),
        y: r.top + frame.clientTop + parseFloat(style.paddingTop),
      };
      let inner = null;
      try {
        const field = frame.contentDocument?.querySelector('input');
        if (field) inner = box(field.getBoundingClientRect());
      } catch {
        inner = null; // cross-origin
      }
      return { id: frame.id, src: frame.src, origin, inner };
    });
    return {
      fields: [...doc.querySelectorAll('.mask')].map((el) => ({ id: el.id, ...box(el.getBoundingClientRect()) })),
      frames,
      control: box(doc.querySelector('h1').getBoundingClientRect()),
      innerWidth: w.innerWidth,
      innerHeight: w.innerHeight,
      dpr: w.devicePixelRatio,
    };
  });
  for (const frame of top.frames) {
    if (frame.inner) continue;
    const handle = page.frames().find((f) => f !== page.mainFrame() && f.url() === frame.src);
    if (!handle) continue;
    frame.inner = await handle.evaluate(() => {
      const r = globalThis.document.querySelector('input').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
  }
  const frameFields = top.frames
    .filter((f) => f.inner)
    .map((f) => ({ id: `${f.id}>input`, x: f.origin.x + f.inner.x, y: f.origin.y + f.inner.y, width: f.inner.width, height: f.inner.height }));
  return { ...top, frameFields };
}

// Visible part of a CSS rect, in image pixels; null when it is outside the viewport.
function toImage(rect, m, scale) {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(m.innerWidth, rect.x + rect.width);
  const y1 = Math.min(m.innerHeight, rect.y + rect.height);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  return { x: x0 * scale, y: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale };
}

const describe = (stats) => JSON.stringify({ ...stats, mean: Math.round(stats.mean), stddev: Number(stats.stddev.toFixed(2)) });

// Same flow as saveRecording, with the "Dołącz zrzut ekranu" checkbox set first (saveRecording keeps the default).
// `frames: true` = the page has a visible cross-origin frame (screenshot-mask.html): after the popup's frameCheck the
// switch starts OFF with the note in #screenshotNote (store review S1), so `checked` is a manual change of it.
async function saveWithCheckbox(page, checked, { frames = false } = {}) {
  const popup = await openPopupFor(page);
  let outcome;
  try {
    await popup.waitFor(`!document.getElementById('recording').hidden && !document.getElementById('save').disabled`);
    if (frames) {
      // Exact texts only: the frames note, or (after the time limit, the page has no bridge) the failed-check note.
      const notes = frames === 'any' ? [MESSAGES.screenshotFramesNote, MESSAGES.screenshotCheckFailedNote] : [MESSAGES.screenshotFramesNote];
      await popup.waitFor(`${JSON.stringify(notes)}.includes(document.getElementById('screenshotNote').textContent)`, 8000);
      expect(await popup.evaluate(`document.getElementById('includeScreenshot').checked`), 'off by default: visible cross-origin frame').toBe(false);
    } else {
      // Fail-closed (review N6): the switch turns on only after frameCheck answers 0.
      await popup.waitFor(`document.getElementById('includeScreenshot').checked === true`, 8000);
      expect(await popup.evaluate(`document.getElementById('screenshotNote').textContent`)).toBe('');
    }
    const current = !frames;
    if (current !== checked) await popup.click('#includeScreenshot'); // a real click: toggles and fires change
    expect(await popup.evaluate(`document.getElementById('includeScreenshot').checked`)).toBe(checked);
    await popup.click('#save');
    // The saved screen (file name) or an error status, not a progress text.
    outcome = await readSaveOutcome(popup);
  } finally {
    await popup.close();
  }
  if ('error' in outcome) throw new Error(`Save failed: ${outcome.error}`);
  const { path } = await waitForDownloadFile(page, { fileName: outcome.fileName });
  return { ...(await readZipPackage(path)), statusText: outcome.savedShot };
}

// AC-2.2 on privacy.html: every visible field rect uniform, the heading outside the fields not.
async function checkPrivacyMask(ext, expectedDpr) {
  return withTab(ext, async (page) => {
    await page.goto(`${server.url}/privacy.html`);
    await startRecording(page);
    const m = await measure(page);
    expect(m.dpr).toBe(expectedDpr);
    const { json, files } = await saveRecording(page);

    expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);
    const [shot] = json.screenshots;
    expect(shot.file).toBe(SCREENSHOT_FILE);
    const scale = shot.width / m.innerWidth;
    expect(Math.abs(scale - expectedDpr)).toBeLessThan(0.02);

    const fields = [...m.fields, ...m.frameFields]
      .map((f) => ({ id: f.id, rect: toImage(f, m, scale) }))
      .filter((f) => f.rect);
    // All 9 top-level fields of privacy.html are in the first screen (the iframe field may be below the fold).
    expect(fields.filter((f) => !f.id.includes('>')).map((f) => f.id)).toEqual(m.fields.map((f) => f.id));
    expect(shot.maskedFields).toBeGreaterThanOrEqual(fields.length);

    const control = toImage(m.control, m, scale);
    const stats = await regionLuma(ext.context, files[shot.file], [...fields.map((f) => f.rect), control]);
    const controlStats = stats.pop();
    const measured = fields.map((f, i) => ({ id: f.id, ...stats[i] }));
    for (const s of measured) {
      expect(s.pixels, s.id).toBeGreaterThan(0);
      expect(s.stddev, `${s.id} ${describe(s)}`).toBeLessThanOrEqual(UNIFORM_MAX_STDDEV);
      expect(Math.abs(s.mean - MASK_LUMA), `${s.id} ${describe(s)}`).toBeLessThanOrEqual(6);
    }
    expect(controlStats.stddev, `control ${describe(controlStats)}`).toBeGreaterThan(UNIFORM_MAX_STDDEV);
    const worst = Math.max(...measured.map((s) => s.stddev));
    console.log(`[E3-TEST4] dpr ${expectedDpr}: ${measured.length} fields, max stddev ${worst.toFixed(3)}, control stddev ${controlStats.stddev.toFixed(1)}`);
  });
}

// E4 AC-3.11 (IN7): the mask covers the whole field (E3 AC-2.2) and the label 4 CSS px above it is not touched. The reference
// is Playwright's own capture of the unmasked page taken just before the save; the label is dark text on white, so any
// grey from the mask would raise the mean luma difference far above the JPEG residue.
const LABEL_MAX_DIFF = 6; // of 255
async function checkLabelAboveField(ext, expectedDpr) {
  return withTab(ext, async (page) => {
    await page.goto(`${server.url}/mask-label.html`);
    await startRecording(page);
    const m = await page.evaluate(() => {
      const w = globalThis;
      const rect = (id) => {
        const r = w.document.getElementById(id).getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      };
      return {
        fields: [rect('f-card'), rect('f-mail')], labels: [rect('l-card'), rect('l-mail')],
        innerWidth: w.innerWidth, innerHeight: w.innerHeight, dpr: w.devicePixelRatio,
      };
    });
    expect(m.dpr).toBe(expectedDpr);
    // The label ends 4 CSS px above the field.
    m.labels.forEach((l, i) => expect(Math.round(m.fields[i].y - (l.y + l.height))).toBe(4));
    const reference = await page.screenshot({ type: 'png' });
    const { json, files } = await saveRecording(page);
    expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);
    const [shot] = json.screenshots;
    const scale = shot.width / m.innerWidth;
    expect(Math.abs(scale - expectedDpr)).toBeLessThan(0.02);
    const image = files[shot.file];

    const fieldRects = m.fields.map((f) => toImage(f, m, scale));
    const stats = await regionLuma(ext.context, image, fieldRects);
    stats.forEach((s, i) => {
      expect(s.stddev, `field ${i} ${describe(s)}`).toBeLessThanOrEqual(UNIFORM_MAX_STDDEV);
      expect(Math.abs(s.mean - MASK_LUMA), `field ${i} ${describe(s)}`).toBeLessThanOrEqual(6);
    });
    for (const [i, label] of m.labels.entries()) {
      const rect = toImage(label, m, scale);
      const diff = await lumaDiff(ext.context, image, reference, rect);
      expect([diff.widthA, diff.heightA], 'reference and screenshot differ in size').toEqual([diff.widthB, diff.heightB]);
      expect(diff.pixels).toBeGreaterThan(0);
      expect(diff.meanDiff, `label ${i} at dpr ${expectedDpr}`).toBeLessThanOrEqual(LABEL_MAX_DIFF);
      // And the label is really there: dark text on white, not uniform.
      const [label$] = await regionLuma(ext.context, image, [rect]);
      expect(label$.stddev, `label ${i} ${describe(label$)}`).toBeGreaterThan(UNIFORM_MAX_STDDEV);
    }
  });
}

test.describe('DPR 1', () => {
  let ext;

  test.beforeAll(async () => {
    ext = await launchWithExtension();
  });

  test.afterAll(async () => {
    await ext?.close();
  });

  test('dpr 1: every field rect (getBoundingClientRect × dpr) uniform (luma stddev ≤ 2%); a control region outside fields not uniform (AC-2.2)', async () => {
    await checkPrivacyMask(ext, 1);
  });

  test('label 4 px above a field stays intact (mean luma diff vs unmasked capture ≤ 6/255), field fully covered, dpr 1 (AC-3.11)', async () => {
    await checkLabelAboveField(ext, 1);
  });

  test('values, activeElement and scrollY identical before and after save; no DOM mutation during the save (AC-2.3)', async () => {
    await withTab(ext, async (page) => {
      await page.goto(`${server.url}/screenshot-mask.html`);
      await startRecording(page);
      // Dirty values (typed, not attributes), a selection, a focused field and a scrolled page.
      await page.fill('#f-email', 'nowy.adres@example.com');
      await page.fill('#f-textarea', 'Wpisane przez zgłaszającego');
      await page.selectOption('#f-select', 'de');
      await page.frameLocator('#same').locator('#in-frame').fill('WPISANY-KOD');
      await page.evaluate(() => globalThis.scrollTo(0, 37));
      await page.focus('#f-tel');
      await page.keyboard.type('9');
      const read = () =>
        page.evaluate(() => {
          const doc = globalThis.document;
          const values = Object.fromEntries([...doc.querySelectorAll('.mask')].map((el) => [el.id, 'value' in el ? el.value : el.textContent]));
          values.frame = doc.getElementById('same').contentDocument.getElementById('in-frame').value;
          const tel = doc.getElementById('f-tel');
          return {
            values,
            active: doc.activeElement?.id ?? null,
            selection: [tel.selectionStart, tel.selectionEnd],
            scrollX: globalThis.scrollX,
            scrollY: globalThis.scrollY,
            style: doc.documentElement.getAttribute('style'),
          };
        });
      const before = await read();
      expect(before.scrollY).toBe(37);
      expect(before.active).toBe('f-tel');
      await page.evaluate(() => {
        const w = globalThis;
        w.__pdsMutations = 0;
        w.__pdsObserver = new w.MutationObserver((list) => {
          w.__pdsMutations += list.length;
        });
        w.__pdsObserver.observe(w.document, { subtree: true, childList: true, attributes: true, characterData: true });
      });

      const { json } = await saveWithCheckbox(page, true, { frames: true });
      expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);

      const after = await read();
      expect(after).toEqual(before);
      const mutations = await page.evaluate(() => {
        globalThis.__pdsObserver.disconnect();
        return globalThis.__pdsMutations;
      });
      expect(mutations, 'the mask must not touch the page').toBe(0);
    });
  });

  test('checkbox off → screenshots [], note "turned off by the reporter", no screenshot.jpg in zip (AC-2.1)', async () => {
    await withTab(ext, async (page) => {
      await page.goto(`${server.url}/privacy.html`);
      await startRecording(page);
      const { json, entries } = await saveWithCheckbox(page, false);
      expect(json.screenshots).toEqual([]);
      expect(json.overview.screenshot).toBe(false);
      expect(json.notes).toContain(NOTE_OFF);
      expect(entries).not.toContain(SCREENSHOT_FILE);
      expect(entries.some((e) => /\.(jpe?g|png)$/i.test(e)), entries.join(', ')).toBe(false);

      // The switch is not remembered: the next popup has it on again (question 1), and that save has the image.
      // A save ends the recording, so record once more.
      await startRecording(page);
      const again = await saveWithCheckbox(page, true);
      expect(again.json.screenshots).toHaveLength(1);
      expect(again.entries).toContain(SCREENSHOT_FILE);
      expect(again.json.notes).not.toContain(NOTE_OFF);
    });
  });

  test('bridge gone (document loaded after time limit) → no screenshot, note, save ok (AC-2.4)', async () => {
    await withTab(ext, async (page) => {
      try {
        await setRecordingLimit(ext, LIMIT_MS);
        await page.goto(`${server.url}/screenshot-mask.html`);
        await startRecording(page);
        await expect.poll(async () => (await popupState(page)).since, { timeout: LIMIT_MS + 8000, intervals: [500] }).toBe(MESSAGES.stoppedByLimit);
        await page.reload(); // scripts are unregistered after the limit: this document has no bridge
        // screenshot-mask.html has a visible cross-origin frame: the switch is off (S1), so the reporter turns it on.
        const { json, entries } = await saveWithCheckbox(page, true, { frames: 'any' });
        expect(json.screenshots).toEqual([]);
        expect(entries).not.toContain(SCREENSHOT_FILE);
        expect(json.overview.screenshot).toBe(false);
        const notes = json.notes.filter((n) => NOTE_NOT_HIDDEN_RE.test(n));
        expect(notes, JSON.stringify(json.notes)).toHaveLength(1);
        expect(json.recordingStoppedReason).toBe('time-limit');
      } finally {
        await setRecordingLimit(ext, null);
      }
    });
  });

  test('same-origin iframe field masked; cross-origin iframe not masked (question 2, PB-1 B)', async () => {
    await withTab(ext, async (page) => {
      await page.goto(`${server.url}/screenshot-mask.html`);
      await startRecording(page);
      const m = await measure(page);
      const same = m.frameFields.find((f) => f.id === 'same>input');
      const cross = m.frameFields.find((f) => f.id === 'cross>input');
      expect(same && cross, JSON.stringify(m.frames)).toBeTruthy();
      const { json, files } = await saveWithCheckbox(page, true, { frames: true });
      expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);
      const [shot] = json.screenshots;
      const scale = shot.width / m.innerWidth;
      // 6 top-level fields + the one in the same-origin frame; the cross-origin frame adds nothing.
      expect(shot.maskedFields).toBe(m.fields.length + 1);
      // E4 AC-3.10: a visible cross-origin frame in a package with the image gets the "not covered" note; no "turned off" one.
      expect(json.notes, JSON.stringify(json.notes)).toContain(SCREENSHOT_NOTES.framesVisible(1));
      expect(json.notes.some((n) => /^Screenshot not included/i.test(n)), JSON.stringify(json.notes)).toBe(false);

      const rects = [...m.fields, same, cross].map((f) => toImage(f, m, scale));
      expect(rects.every(Boolean)).toBe(true);
      const stats = await regionLuma(ext.context, files[shot.file], rects);
      const crossStats = stats.pop();
      const sameStats = stats.pop();
      stats.forEach((s, i) => expect(s.stddev, `${m.fields[i].id} ${describe(s)}`).toBeLessThanOrEqual(UNIFORM_MAX_STDDEV));
      expect(sameStats.stddev, `same ${describe(sameStats)}`).toBeLessThanOrEqual(UNIFORM_MAX_STDDEV);
      expect(Math.abs(sameStats.mean - MASK_LUMA), `same ${describe(sameStats)}`).toBeLessThanOrEqual(6);
      // PB-1 = B: the red field with its black text is still on the image.
      expect(crossStats.stddev, `cross ${describe(crossStats)}`).toBeGreaterThan(UNIFORM_MAX_STDDEV);
      expect(crossStats.min, `cross ${describe(crossStats)}`).toBeLessThan(60); // black text ink
      expect(Math.abs(crossStats.mean - FIELD_RED_LUMA), `cross ${describe(crossStats)}`).toBeLessThan(Math.abs(crossStats.mean - MASK_LUMA));
    });
  });
});

test.describe('DPR 2', () => {
  let ext;

  test.beforeAll(async () => {
    ext = await launchWithExtension({ args: ['--force-device-scale-factor=2', '--window-size=1280,800'], viewport: null });
  });

  test.afterAll(async () => {
    await ext?.close();
  });

  test('dpr 2: every field rect (getBoundingClientRect × dpr) uniform (luma stddev ≤ 2%); a control region outside fields not uniform (AC-2.2)', async () => {
    await checkPrivacyMask(ext, 2);
  });

  test('label 4 px above a field stays intact (mean luma diff vs unmasked capture ≤ 6/255), field fully covered, dpr 2 (AC-3.11)', async () => {
    await checkLabelAboveField(ext, 2);
  });
});
