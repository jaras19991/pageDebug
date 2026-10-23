// E2-TEST5 (part 2): the open popup follows navigation of its tab (AC-2.1). 127.0.0.1 → localhost is another origin
// for the recording: the popup note appears within 1 s of the page load and disappears on return.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { startRecording } from './helpers/recording.js';

const LIVE_MS = 1000;

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

const noteText = (popup) => popup.textOf('#note');

test('popup open during navigation 127.0.0.1 → localhost shows otherOrigin within 1 s; disappears on return (AC-2.1)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);

    const popup = await openPopupFor(page);
    try {
      await popup.waitFor(`!document.getElementById('recording').hidden`);
      expect(await noteText(popup)).toBe('');

      await page.goto(`${server.otherOrigin}/basic.html`);
      const shownAfter = Date.now();
      await popup.waitForText('#note', MESSAGES.otherOrigin, LIVE_MS);
      const shownMs = Date.now() - shownAfter;

      await page.goto(`${server.url}/basic.html`);
      const goneAfter = Date.now();
      await popup.waitForText('#note', (text) => text === '', LIVE_MS);
      const goneMs = Date.now() - goneAfter;
      console.log(`[E2-TEST5] popup live: otherOrigin shown ${shownMs} ms, gone ${goneMs} ms after load`);
    } finally {
      await popup.close();
    }
  } finally {
    await page.close();
  }
});
