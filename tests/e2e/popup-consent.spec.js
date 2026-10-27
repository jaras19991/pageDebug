// E4-FIX2 / QA F-1: the consent sentence (#consentNotice) and "Nagrywaj" stay in view without scrolling in the
// "ready" state at popup heights 510 (headless default) and 600 (real popup). Measured with getBoundingClientRect
// against the viewport, not from DOM order.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';

let server;
let ext;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
});

const GEOMETRY = `(() => {
  const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; };
  return { innerH: window.innerHeight, innerW: window.innerWidth, scrollH: document.body.scrollHeight, scrollY: document.body.scrollTop,
    consent: box('consentNotice'), record: box('record'), reload: box('reloadNotice'), readyHidden: document.getElementById('ready').hidden,
    consentText: document.getElementById('consentNotice').textContent };
})()`;

for (const height of [510, 600]) {
  test(`ready: consent and "Nagrywaj" fully in the viewport without scrolling at 360×${height} (QA F-1, AC-1.3/1.8)`, async () => {
    const page = await ext.context.newPage();
    try {
      await page.goto(`${server.url}/basic.html`);
      const popup = await openPopupFor(page);
      try {
        await popup.waitFor(`!document.getElementById('ready').hidden`);
        // The popup target rejects Emulation.setDeviceMetricsOverride, so the viewport is simulated: the document is
        // pinned to `height` px and the body becomes the scroll container (a real popup scrolls the document itself).
        await popup.evaluate(`(() => { const s = document.createElement('style');
          s.textContent = 'html{height:${height}px;overflow:hidden}body{height:${height}px;box-sizing:border-box;overflow-y:auto}';
          document.head.append(s); })()`);
        const g = await popup.evaluate(GEOMETRY.replace('innerH: window.innerHeight', 'innerH: ' + height));
        expect(g.readyHidden).toBe(false);
        expect(g.scrollY).toBe(0);
        // The disclosure is long enough to overflow (otherwise this would not test the sticky footer).
        expect(g.scrollH).toBeGreaterThan(g.innerH);
        for (const [name, b] of [['consentNotice', g.consent], ['reloadNotice', g.reload], ['record', g.record]]) {
          expect(b.height, `${name} has a box`).toBeGreaterThan(0);
          expect(b.top, `${name} top >= 0`).toBeGreaterThanOrEqual(0);
          expect(b.bottom, `${name} bottom <= ${height}`).toBeLessThanOrEqual(g.innerH);
          expect(b.left, `${name} left`).toBeGreaterThanOrEqual(0);
          expect(b.right, `${name} right`).toBeLessThanOrEqual(g.innerW);
        }
        // Consent is above the button (read before the click).
        expect(g.consent.bottom).toBeLessThanOrEqual(g.record.top);
        expect(g.consentText).toBe(MESSAGES.consentNotice);
      } finally {
        await popup.close();
      }
    } finally {
      await page.close();
    }
  });
}
