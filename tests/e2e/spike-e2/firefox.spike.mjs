/* global process, console, setTimeout, Buffer */
// E2-T0 spike, S4 (Firefox): feature detection and S3/S6 pages in content, then captureVisibleTab
// from the module event page before/after the toolbar action is triggered (activeTab), plus the
// OffscreenCanvas/createImageBitmap codec probe. web-ext (temporary add-on) + Marionette, as E1 S8.
// Usage: node tests/e2e/spike-e2/firefox.spike.mjs [--headed]
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';
import { startServer } from './server.spike.mjs';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), 'ext');
const GECKO_ID = 'pds-spike-e2@example.invalid';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} spike: ${name}`);
  if (detail !== undefined) console.log(`  evidence: ${JSON.stringify(detail)}`);
}

const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

// Minimal Marionette client: frames are "<length>:<json>", commands [0, id, name, params].
async function marionette(port) {
  let socket;
  for (let i = 0; i < 100 && !socket; i++) {
    socket = await new Promise((res) => {
      const s = connect(port, '127.0.0.1', () => res(s));
      s.on('error', () => res(null));
    });
    if (!socket) await delay(200);
  }
  if (!socket) throw new Error('Marionette did not start');
  let buf = Buffer.alloc(0);
  const frames = [];
  let wake = null;
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const colon = buf.indexOf(':');
      if (colon < 0) break;
      const len = Number(buf.subarray(0, colon).toString());
      if (buf.length < colon + 1 + len) break;
      frames.push(JSON.parse(buf.subarray(colon + 1, colon + 1 + len).toString()));
      buf = buf.subarray(colon + 1 + len);
    }
    wake?.();
  });
  const next = async () => {
    while (!frames.length) await new Promise((r) => (wake = r));
    return frames.shift();
  };
  await next(); // hello
  let id = 0;
  const send = async (name, params = {}) => {
    const msgId = ++id;
    const body = Buffer.from(JSON.stringify([0, msgId, name, params]));
    socket.write(`${body.length}:`);
    socket.write(body);
    for (;;) {
      const [, rid, error, result] = await next();
      if (rid !== msgId) continue;
      if (error) throw new Error(`${name}: ${error.error}: ${error.message}`);
      return result;
    }
  };
  return { send, close: () => socket.destroy() };
}

async function main() {
  const headed = process.argv.includes('--headed');
  const work = mkdtempSync(join(tmpdir(), 'pds-spike-e2-ff-'));
  const extDir = join(work, 'ext');
  cpSync(EXT, extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.background = { scripts: ['sw.js'], type: 'module' };
  manifest.browser_specific_settings = { gecko: { id: GECKO_ID, strict_min_version: '128.0' } };
  manifest.action.default_area = 'navbar';
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const server = await startServer();
  const closedPort = await freePort();
  const port = await freePort();
  const runner = await webExt.cmd.run(
    {
      sourceDir: extDir,
      target: ['firefox-desktop'],
      args: ['--marionette', '-remote-allow-system-access', ...(headed ? [] : ['--headless'])],
      noReload: true,
      noInput: true,
      pref: { 'marionette.port': port },
    },
    { shouldExitProgram: false },
  );
  let client;
  try {
    client = await marionette(port);
    const session = await client.send('WebDriver:NewSession', { capabilities: {} });
    console.log(`Firefox ${session.capabilities.browserVersion}, headless=${!headed}`);
    const exec = async (script) => (await client.send('WebDriver:ExecuteScript', { script, args: [] })).value;
    const attr = async (name, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const v = await exec(`return document.documentElement.getAttribute(${JSON.stringify(name)});`).catch(() => null);
        if (v) return JSON.parse(v);
        await delay(150);
      }
      return null;
    };

    await client.send('Marionette:SetContext', { value: 'chrome' });
    const grant = await exec(`return (async () => {
      const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
      let policy = null;
      for (let i = 0; i < 50 && !policy; i++) {
        policy = WebExtensionPolicy.getByID(${JSON.stringify(GECKO_ID)});
        if (!policy) await new Promise((r) => setTimeout(r, 100));
      }
      if (!policy) return { error: 'no policy' };
      await ExtensionPermissions.add(${JSON.stringify(GECKO_ID)}, { permissions: [], origins: ['http://127.0.0.1/*'] }, policy.extension);
      return { host: policy.mozExtensionHostname };
    })();`);
    console.log(`grant: ${JSON.stringify(grant)}`);

    // Page-side checks (S3/S6 equivalents in Firefox).
    await client.send('Marionette:SetContext', { value: 'content' });
    await client.send('WebDriver:Navigate', { url: `${server.origin}/s3?closed=${encodeURIComponent(`http://127.0.0.1:${closedPort}`)}` });
    const s3 = await attr('data-spike-s3');
    await client.send('WebDriver:Navigate', { url: `${server.origin}/missing` });
    const nav = await attr('data-spike-nav');
    report('S4 features (responseStatus, entry types, interactionId)', !!s3, { ua: s3?.ua, features: s3?.features, navStatus: s3?.navStatus, nav404: nav });
    console.log(`  rt: ${JSON.stringify(s3?.rt)}`);
    console.log(`  errors: ${JSON.stringify(s3?.errors)}`);
    await client.send('WebDriver:Navigate', { url: `${server.origin}/s6` });
    const s6 = await attr('data-spike-s6');
    report('S4/S6 clone reader cancel keeps page branch (Firefox)', !!(s6 && s6.cloneTimedOut && s6.pageChunks >= 3 && !s6.bodyUsedAfterCloneCancel && s6.jsonPageParsed), s6);

    // captureVisibleTab from the event page.
    await client.send('WebDriver:Navigate', {
      url: `moz-extension://${grant.host}/popup.html?ff=1&target=${encodeURIComponent(`${server.origin}/shot`)}`,
    });
    let stage = null;
    for (let i = 0; i < 100 && stage !== 'trigger'; i++) {
      await delay(100);
      stage = await exec('return document.body.dataset.stage ?? null;');
    }
    await client.send('Marionette:SetContext', { value: 'chrome' });
    const trig = await exec(`return (async () => {
      const id = ${JSON.stringify(GECKO_ID)};
      const policy = WebExtensionPolicy.getByID(id);
      const win = Services.wm.getMostRecentWindow('navigator:browser');
      const out = { url: win.gBrowser.selectedBrowser.currentURI.spec };
      const nativeTab = win.gBrowser.selectedTab;
      const tm = policy.extension.tabManager;
      out.activeTabBefore = tm.hasActiveTabPermission(nativeTab);
      try {
        const { ExtensionParent } = ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
        const ba = ExtensionParent.apiManager.global.browserActionFor?.(policy.extension);
        out.via = ba ? 'browserActionFor.triggerAction' : 'none';
        if (ba) await ba.triggerAction(win);
      } catch (e) { out.triggerError = String(e); }
      await new Promise((r) => setTimeout(r, 300));
      out.activeTabAfter = tm.hasActiveTabPermission(nativeTab);
      return out;
    })();`);
    console.log(`trigger: ${JSON.stringify(trig)}`);
    await client.send('Marionette:SetContext', { value: 'content' });
    await exec('document.body.dataset.go = "trigger"; return true;');
    let out = '';
    for (let i = 0; i < 300 && !out.includes('"done":true'); i++) {
      await delay(200);
      out = await exec('return document.getElementById("out").textContent;');
    }
    const r = JSON.parse(out || '{}');
    report('S4 codec probe in event page (OffscreenCanvas jpeg + createImageBitmap)', r.codec?.type === 'image/jpeg' && r.codec?.dims?.[0] === 64, r.codec);
    console.log(`  beforeAction (origin granted, no activeTab): ${JSON.stringify(r.beforeAction)}`);
    const a = r.afterAction ?? {};
    const v = r.view ?? {};
    const dimsOk = a.width === Math.round(v.w * v.dpr) && a.height === Math.round(v.h * v.dpr);
    const cornersOk = a.corners?.every((c) => Math.abs(c[0]) <= 12 && Math.abs(c[1] - 128) <= 12 && Math.abs(c[2] - 255) <= 12);
    report('S4 captureVisibleTab from event page after toolbar action', a.ok === true && a.prefix === 'data:image/jpeg;base64,' && dimsOk && cornersOk, { view: v, ...a });
    console.log(`  burst: ${JSON.stringify(r.burst)}`);
    console.log(`  afterReload: ${JSON.stringify(r.afterReload)}`);
    console.log(`  afterCrossOriginAndBack: ${JSON.stringify(r.afterCrossOriginAndBack)}`);
    if (r.error) console.log(`  sequence error: ${r.error}`);
  } finally {
    client?.close();
    await runner.exit();
    await server.close();
    await delay(500);
    rmSync(work, { recursive: true, force: true });
  }
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
