/* global process, console, setTimeout, Buffer */
// E1-T0 spike, S8 (Firefox): the same ext with a `background.scripts` + `type: module` overlay,
// run through web-ext (temporary add-on, headless) and driven by Marionette. The origin is granted
// from chrome context (ExtensionPermissions), then the extension tab runs the sequence in
// popup.js (`?auto=1`): storage.session, registerContentScripts + tabs.reload x10, handshake, download.
// Usage: node tests/e2e/spike-e1/firefox.spike.mjs [--headed]
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import webExt from 'web-ext';
import { startServer } from './server.spike.mjs';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), 'ext');
const GECKO_ID = 'pds-spike-e1@example.invalid';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const work = mkdtempSync(join(tmpdir(), 'pds-spike-e1-ff-'));
  const extDir = join(work, 'ext');
  const downloadDir = join(work, 'downloads');
  cpSync(EXT, extDir, { recursive: true });
  mkdirSync(downloadDir);
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.background = { scripts: ['sw.js'], type: 'module' };
  manifest.browser_specific_settings = { gecko: { id: GECKO_ID, strict_min_version: '128.0' } };
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const server = await startServer();
  const port = await freePort();
  const runner = await webExt.cmd.run(
    {
      sourceDir: extDir,
      target: ['firefox-desktop'],
      args: ['--marionette', '-remote-allow-system-access', ...(headed ? [] : ['--headless'])],
      noReload: true,
      noInput: true,
      pref: {
        'marionette.port': port,
        'browser.download.dir': downloadDir,
        'browser.download.folderList': 2,
        'browser.download.useDownloadDir': true,
        'browser.download.always_ask_before_handling_new_types': false,
      },
    },
    { shouldExitProgram: false },
  );
  let client;
  try {
    client = await marionette(port);
    const session = await client.send('WebDriver:NewSession', { capabilities: {} });
    console.log(`Firefox ${session.capabilities.browserVersion}, headless=${!headed}`);
    await client.send('Marionette:SetContext', { value: 'chrome' });
    const grant = await client.send('WebDriver:ExecuteScript', {
      script: `return (async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
        let policy = null;
        for (let i = 0; i < 50 && !policy; i++) {
          policy = WebExtensionPolicy.getByID(${JSON.stringify(GECKO_ID)});
          if (!policy) await new Promise((r) => setTimeout(r, 100));
        }
        if (!policy) return { error: 'no policy' };
        await ExtensionPermissions.add(${JSON.stringify(GECKO_ID)}, { permissions: [], origins: ['http://127.0.0.1/*'] }, policy.extension);
        // Prefs from web-ext did not reach the downloads directory in the first run: set them live.
        Services.prefs.setIntPref('browser.download.folderList', 2);
        Services.prefs.setStringPref('browser.download.dir', ${JSON.stringify(downloadDir)});
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const preferred = await Downloads.getPreferredDownloadsDirectory();
        return { preferred, host: policy.mozExtensionHostname, origins: [...policy.allowedOrigins.patterns].map((p) => p.pattern) };
      })();`,
      args: [],
    });
    console.log(`grant: ${JSON.stringify(grant.value)}`);
    if (resolve(grant.value.preferred ?? '') !== resolve(downloadDir)) throw new Error('download dir not redirected, abort');
    await client.send('Marionette:SetContext', { value: 'content' });
    const target = `${server.origin}/head`;
    await client.send('WebDriver:Navigate', {
      url: `moz-extension://${grant.value.host}/popup/popup.html?auto=1&target=${encodeURIComponent(target)}`,
    });
    let out = '';
    for (let i = 0; i < 600 && !out.includes('"done":true'); i++) {
      await delay(200);
      out = (await client.send('WebDriver:ExecuteScript', { script: 'return document.getElementById("out").textContent;', args: [] })).value;
    }
    const result = JSON.parse(out);
    const r = result.reloads ?? [];
    console.log(`SUMMARY S5 caught+mainBeforePage ${r.filter((x) => x.caught && x.mainBeforePage).length}/${r.length}; ` +
      `S6 bound both ${r.filter((x) => x.bound && x.isoBound && x.nodeConnected === false).length}/${r.length}, ` +
      `page events ${r.reduce((a, x) => a + (x.pageEvents ?? 0), 0)}, ` +
      `orders ${JSON.stringify(r.map((x) => x.order))}`);
    r.forEach((x, i) => !(x.caught && x.mainBeforePage) && console.log(`SUMMARY S5 miss #${i}: ${JSON.stringify(x)}`));
    const leakTypes = [result.sample?.page?.leaks, result.fallback?.leaks].flat().filter(Boolean).map((l) => JSON.parse(l.detail).type);
    console.log(`SUMMARY leaks only naive: ${leakTypes.every((t) => t.endsWith('-naive'))} ${JSON.stringify(leakTypes)}`);
    for (const [k, v] of Object.entries(result)) console.log(`${k}: ${JSON.stringify(v)}`);
    console.log(`downloads dir: ${JSON.stringify(readdirSync(downloadDir).map((f) => `${f}:${statSync(join(downloadDir, f)).size}`))}`);
  } finally {
    client?.close();
    await runner.exit();
    await server.close();
    await delay(500);
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
