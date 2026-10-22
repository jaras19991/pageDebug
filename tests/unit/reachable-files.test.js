import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { collectReachable } from '../../scripts/lib/reachability.mjs';

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
});
