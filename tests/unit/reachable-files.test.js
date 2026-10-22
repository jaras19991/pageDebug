import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { collectReachable } from '../../scripts/lib/reachability.mjs';
import { mergeManifest } from '../../scripts/lib/manifest.mjs';

let dir;

// Writes a fixture tree: { 'rel/path': content }. Objects are written as JSON.
function writeTree(files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const popupManifest = {
  manifest_version: 3,
  name: 'Fixture',
  version: '1.0.0',
  icons: { 16: 'icons/icon16.png', 128: 'icons/icon128.png' },
  action: {
    default_popup: 'popup/popup.html',
    default_icon: { 16: 'icons/icon16.png', 48: 'icons/icon48.png' },
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pds-reach-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('collectReachable', () => {
  it('collectReachable follows icons, popup html, module imports, executeScript files', async () => {
    writeTree({
      'manifest.json': popupManifest,
      'icons/icon16.png': 'x',
      'icons/icon48.png': 'x',
      'icons/icon128.png': 'x',
      'popup/popup.html': [
        '<!doctype html><html><head>',
        "<link rel='stylesheet' href='popup.css'>",
        '<link rel="icon" href="https://example.org/favicon.ico">',
        '<!-- <script src="old.js"></script> -->',
        '<!--',
        '  <link href="also-old.css">',
        '-->',
        '</head><body>',
        '<script type="module" src="popup.js?v=1"></script>',
        '<script src="chrome-extension://abc/x.js"></script>',
        '</body></html>',
      ].join('\n'),
      'popup/popup.css': 'body{}',
      'popup/popup.js': [
        "import { a } from './messages.js';",
        'import {',
        '  b,',
        "} from \"../shared/target.js\";",
        "import './side-effect.js';",
        "export { c } from './reexport.js';",
        'chrome.scripting.executeScript({',
        "  target: { tabId: 1 }, world: 'MAIN',",
        "  files: ['page/page-debug-snapshot.js', \"/page/helper.js\"],",
        '});',
      ].join('\n'),
      'popup/messages.js': "import { t } from './nested/deep.js';\nexport const a = t;",
      'popup/nested/deep.js': 'export const t = 1;',
      'popup/side-effect.js': '',
      'popup/reexport.js': 'export const c = 1;',
      'shared/target.js': "import { a } from '../popup/messages.js';\nexport const b = a;",
      'page/page-debug-snapshot.js': '(() => {})();',
      'page/helper.js': '',
    });

    expect(await collectReachable(dir)).toEqual([
      'icons/icon128.png',
      'icons/icon16.png',
      'icons/icon48.png',
      'page/helper.js',
      'page/page-debug-snapshot.js',
      'popup/messages.js',
      'popup/nested/deep.js',
      'popup/popup.css',
      'popup/popup.html',
      'popup/popup.js',
      'popup/reexport.js',
      'popup/side-effect.js',
      'shared/target.js',
    ]);
  });

  it('collectReachable ignores unreferenced files', async () => {
    writeTree({
      'manifest.json': { ...popupManifest, icons: undefined, action: { default_popup: 'popup/popup.html' } },
      'popup/popup.html': '<script src="popup.js"></script>',
      'popup/popup.js': '',
      'standalone/console-snapshot.js': '',
      'manifest.chrome.json': {},
      'key.pem': 'secret',
    });
    expect(await collectReachable(dir)).toEqual(['popup/popup.html', 'popup/popup.js']);
  });

  it('collectReachable throws on missing referenced file', async () => {
    writeTree({
      'manifest.json': { ...popupManifest, icons: undefined, action: { default_popup: 'popup/popup.html' } },
      'popup/popup.html': '<script type="module" src="popup.js"></script>',
      'popup/popup.js': "import './gone.js';",
    });
    await expect(collectReachable(dir)).rejects.toThrow('Missing referenced file: popup/gone.js');
  });

  it('throws on missing file referenced directly by the manifest', async () => {
    writeTree({ 'manifest.json': { ...popupManifest, action: undefined } });
    await expect(collectReachable(dir)).rejects.toThrow(/^Missing referenced file: icons\/icon(16|128)\.png$/);
  });

  it('rejects references that escape the extension directory', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, action: { default_popup: 'popup.html' } },
      'popup.html': '<script src="../outside.js"></script>',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/outside/);
  });

  // Firefox needs a leading '/' in executeScript files (QA E0 F1); it means the extension root.
  it('resolves a leading / in files: [...] against the extension root, not the JS file', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, action: { default_popup: 'popup/popup.html' } },
      'popup/popup.html': '<script type="module" src="popup.js"></script>',
      'popup/popup.js': "executeScript({ files: ['/page/page-debug-snapshot.js'] });",
      'page/page-debug-snapshot.js': '',
    });
    expect(await collectReachable(dir)).toEqual(['page/page-debug-snapshot.js', 'popup/popup.html', 'popup/popup.js']);
  });

  it('rejects a leading / path in files: [...] that escapes the root', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, action: { default_popup: 'popup.html' } },
      'popup.html': '<script src="popup.js"></script>',
      'popup.js': "executeScript({ files: ['/../outside.js'] });",
    });
    await expect(collectReachable(dir)).rejects.toThrow(/escapes extension directory/);
  });

  it('collectReachable handles background.service_worker/scripts and content_scripts', async () => {
    writeTree({
      'manifest.json': {
        manifest_version: 3,
        background: { service_worker: 'background.js', scripts: ['background.js'], type: 'module' },
        content_scripts: [
          { matches: ['<all_urls>'], js: ['content/a.js', 'content/b.js'], css: ['content/c.css'] },
          { matches: ['https://x/*'], js: ['content/a.js'] },
        ],
        web_accessible_resources: [{ resources: ['war/page.js'], matches: ['<all_urls>'] }],
      },
      'background.js': "import { x } from './lib/bg-util.js';\nchrome.scripting.registerContentScripts([{ id: 'p', files: ['content/main.js'] }]);",
      'lib/bg-util.js': 'export const x = 1;',
      'content/a.js': '',
      'content/b.js': '',
      'content/c.css': '',
      'content/main.js': '',
      'war/page.js': '',
    });
    expect(await collectReachable(dir)).toEqual([
      'background.js',
      'content/a.js',
      'content/b.js',
      'content/c.css',
      'content/main.js',
      'lib/bg-util.js',
      'war/page.js',
    ]);
  });

  it('accepts a virtual manifest object instead of manifest.json on disk', async () => {
    writeTree({ 'popup.html': '<p>no scripts</p>' });
    const manifest = { manifest_version: 3, action: { default_popup: 'popup.html' } };
    expect(await collectReachable(dir, { manifest })).toEqual(['popup.html']);
  });

  it('rejects wildcard web_accessible_resources (cannot be walked)', async () => {
    const manifest = { manifest_version: 3, web_accessible_resources: [{ resources: ['war/*'], matches: ['<all_urls>'] }] };
    await expect(collectReachable(dir, { manifest })).rejects.toThrow(/war\/\*/);
  });

  // E1-T11: registerContentScripts uses js: [...] (root-relative, like files: [...]).
  it('follows js: [...] in registerContentScripts as root-relative', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg/background.js', type: 'module' } },
      'bg/background.js': "chrome.scripting.registerContentScripts([{ id: 'a', js: ['/page/a.js', 'page/b.js'], world: 'MAIN' }]);",
      'page/a.js': '',
      'page/b.js': '',
    });
    expect(await collectReachable(dir)).toEqual(['bg/background.js', 'page/a.js', 'page/b.js']);
  });

  it('rejects non-literal entry in js: [...]', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg.js' } },
      'bg.js': "registerContentScripts([{ id: 'a', js: [PAGE_FILE] }]);",
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: js: \[PAGE_FILE\]/);
  });

  it('rejects files: given as a variable instead of an array literal', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg.js' } },
      'bg.js': 'executeScript({ files: list });',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: files: list/);
  });

  it('follows module imports from a module background script', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { scripts: ['bg.js'], type: 'module' } },
      'bg.js': "import { s } from './lib/store.js';",
      'lib/store.js': "export * from './origin.js';",
      'lib/origin.js': '',
    });
    expect(await collectReachable(dir)).toEqual(['bg.js', 'lib/origin.js', 'lib/store.js']);
  });

  it('resolves literal url(...) in css and html relative to the file and requires it to exist', async () => {
    writeTree({
      'manifest.json': {
        manifest_version: 3,
        action: { default_popup: 'popup/popup.html' },
        content_scripts: [{ matches: ['<all_urls>'], css: ['content/c.css'] }],
      },
      'popup/popup.html': '<style>body { background: url("./bg.png") }</style><div style="x: url(img/a.svg)"></div>',
      'popup/bg.png': 'x',
      'popup/img/a.svg': 'x',
      'content/c.css': "@import 'base.css';\n.a { background: url('../icons/i.png'), url(data:image/png;base64,AA==); }",
      'content/base.css': '.b { mask: url( "/icons/m.svg" ) }',
      'icons/i.png': 'x',
      'icons/m.svg': 'x',
    });
    expect(await collectReachable(dir)).toEqual([
      'content/base.css',
      'content/c.css',
      'icons/i.png',
      'icons/m.svg',
      'popup/bg.png',
      'popup/img/a.svg',
      'popup/popup.html',
    ]);
  });

  it('throws on missing file referenced by css url(...)', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, content_scripts: [{ matches: ['<all_urls>'], css: ['c.css'] }] },
      'c.css': '.a { background: url("./gone.png") }',
    });
    await expect(collectReachable(dir)).rejects.toThrow('Missing referenced file: gone.png');
  });

  it('throws on url( in html style / css / js that cannot be resolved', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, content_scripts: [{ matches: ['<all_urls>'], css: ['c.css'] }] },
      'c.css': '.a { background: url(var(--img)) }',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in c\.css: url\(var\(--img/);

    writeTree({
      'manifest.json': { manifest_version: 3, action: { default_popup: 'p.html' } },
      'p.html': '<style>.a { background: url(${img}) }</style>',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in p\.html: url\(\$\{img\}/);

    writeTree({
      'p.html': '<script src="p.js"></script>',
      'p.js': "el.style.background = 'url(./a.png)';",
      'a.png': 'x',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in p\.js: url\(/);
  });

  it('resolves literal chrome.runtime.getURL(...) against the root and requires the file', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg/bg.js' } },
      'bg/bg.js': "const u = chrome.runtime.getURL('page/x.js');\nconst v = browser.runtime.getURL(\"/page/y.js\");",
      'page/x.js': '',
      'page/y.js': '',
    });
    expect(await collectReachable(dir)).toEqual(['bg/bg.js', 'page/x.js', 'page/y.js']);

    writeTree({ 'bg/bg.js': "chrome.runtime.getURL('page/gone.js');" });
    await expect(collectReachable(dir)).rejects.toThrow('Missing referenced file: page/gone.js');
  });

  it('throws on chrome.runtime.getURL( with a non-literal argument', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg.js' } },
      'bg.js': 'chrome.runtime.getURL(`page/${name}.js`);',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: runtime\.getURL\(/);
  });

  it('throws on import() with template literal or variable', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg.js', type: 'module' } },
      'bg.js': 'await import(`./lib/${name}.js`);',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: import\(`/);

    writeTree({ 'bg.js': 'await import(path);' });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: import\(path/);
  });

  it('throws on importScripts(', async () => {
    writeTree({
      'manifest.json': { manifest_version: 3, background: { service_worker: 'bg.js' } },
      'bg.js': "importScripts('lib.js');",
      'lib.js': '',
    });
    await expect(collectReachable(dir)).rejects.toThrow(/Unresolvable reference in bg\.js: importScripts\(/);
  });

  it('existing src/ still builds', async () => {
    const srcDir = resolve(import.meta.dirname, '../../src');
    const read = (name) => JSON.parse(readFileSync(join(srcDir, name), 'utf8'));
    for (const target of ['chrome', 'firefox']) {
      const manifest = mergeManifest(read('manifest.base.json'), read(`manifest.${target}.json`));
      const files = await collectReachable(srcDir, { manifest });
      for (const file of ['background.js', 'content/main-world.js', 'popup/controller.js']) {
        expect(files, `${target}: ${file}`).toContain(file);
      }
      expect(files).not.toContain('page/page-debug-snapshot.js');
    }
  });
});
