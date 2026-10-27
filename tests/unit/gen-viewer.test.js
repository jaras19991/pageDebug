// E4-T3a (D3): one-file viewer generated from src/viewer — the bundle as the only inline script,
// CSP with hashes of that script and of the style, release artefact written by `npm run pack`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLES, HTML_BUNDLES, MAX_HTML_BYTES, bundleHtml, generateAll } from '../../scripts/gen-content.mjs';
import { pack } from '../../scripts/pack.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256b64 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

const TEMPLATE = [
  '<!DOCTYPE html>',
  '<html lang="pl">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta http-equiv="Content-Security-Policy" content="{{CSP}}">',
  '<style>body { margin: 0; }</style>',
  '</head>',
  '<body><main id="app"></main><script>{{SCRIPT}}</script></body>',
  '</html>',
  '',
].join('\n');

// Parts of a generated page: inline scripts, styles and the CSP directives.
function parse(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? null;
  const directives = Object.fromEntries((csp ?? '').split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));
  return { scripts, styles, csp, directives };
}

let tmp;
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'pds-viewer-')); });
afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

// src/ with a viewer template and entry (plus a helper module) under `name`.
async function viewerSrc(name, { template = TEMPLATE, entry = "import { text } from './text.js';\n\nglobalThis.__out = text;\n" } = {}) {
  const src = join(tmp, name, 'src');
  await mkdir(join(src, 'viewer'), { recursive: true });
  await writeFile(join(src, 'viewer', 'viewer.html'), template);
  await writeFile(join(src, 'viewer', 'viewer-entry.js'), entry);
  await writeFile(join(src, 'viewer', 'text.js'), "export const text = 'Przeciągnij plik';\n");
  return src;
}

const html = (srcDir) => bundleHtml({ template: 'viewer/viewer.html', entry: 'viewer/viewer-entry.js', srcDir });

describe('bundleHtml', () => {
  it('maps the viewer template and entry to src/standalone/viewer.html', () => {
    expect(HTML_BUNDLES).toEqual([{ out: 'standalone/viewer.html', template: 'viewer/viewer.html', entry: 'viewer/viewer-entry.js' }]);
    expect(MAX_HTML_BYTES).toBe(300 * 1024);
  });

  it('viewer.html: one inline script, CSP script-src hash equals sha256 of the script, style hash equals sha256 of the style', () => {
    // The real template and stub entry from src/viewer.
    const page = html(join(root, 'src'));
    const { scripts, styles, directives } = parse(page);
    expect(scripts).toHaveLength(1);
    expect(styles).toHaveLength(1);
    expect(page.match(/<script\b/gi)).toHaveLength(1);
    expect(directives['script-src']).toEqual([`'sha256-${sha256b64(scripts[0])}'`]);
    expect(directives['style-src']).toEqual([`'sha256-${sha256b64(styles[0])}'`]);
    // placeholders replaced (the bundled src/lib JSDoc has `{{ … }}` types, so only the placeholders are checked)
    expect(page).not.toMatch(/\{\{(?:SCRIPT|CSP)\}\}/);
    expect(Buffer.byteLength(page, 'utf8')).toBeLessThanOrEqual(MAX_HTML_BYTES);
  });

  it('viewer style: the hidden attribute wins over display rules such as nav[role="tablist"] { display: flex } (E4-FIX1, AC-4.2)', () => {
    const [style] = parse(html(join(root, 'src'))).styles;
    expect(style).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it("CSP has default-src 'none', img-src blob:, no connect-src/unsafe-inline/unsafe-eval", () => {
    const { csp, directives } = parse(html(join(root, 'src')));
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['img-src']).toEqual(['blob:']);
    expect(directives['base-uri']).toEqual(["'none'"]);
    expect(directives['form-action']).toEqual(["'none'"]);
    expect(Object.keys(directives).sort()).toEqual(['base-uri', 'default-src', 'form-action', 'img-src', 'script-src', 'style-src']);
    expect(csp).not.toMatch(/connect-src|unsafe-inline|unsafe-eval|unsafe-hashes|\*|https?:|data:/);
  });

  it('inlines the bundle verbatim, also code with $ replacement patterns', async () => {
    const src = await viewerSrc('dollar', { entry: "globalThis.__out = '$& $1 $$ $`';\n" });
    const { scripts } = parse(html(src));
    expect(scripts[0]).toContain("globalThis.__out = '$& $1 $$ $`';");
    expect(scripts[0]).toContain("'use strict'");
  });

  it('bundle containing </script or <!-- fails; missing placeholder fails; > 300 KB fails', async () => {
    for (const [name, entry] of [
      ['close-tag', "globalThis.__out = '</script>';\n"],
      ['close-tag-case', "globalThis.__out = '</SCRIPT >';\n"],
      ['comment-open', "globalThis.__out = '<!--';\n"],
    ]) {
      const src = await viewerSrc(name, { entry });
      expect(() => html(src), name).toThrow(/viewer-entry\.js: bundle contains/);
    }
    for (const [name, template] of [
      ['no-script', TEMPLATE.replace('{{SCRIPT}}', '')],
      ['two-scripts', TEMPLATE.replace('</body>', '<script>{{SCRIPT}}</script></body>')],
      ['no-csp', TEMPLATE.replace('{{CSP}}', '')],
      ['two-csp', TEMPLATE.replace('</head>', '<meta name="x" content="{{CSP}}"></head>')],
      ['no-style', TEMPLATE.replace('<style>body { margin: 0; }</style>', '')],
      ['extra-script', TEMPLATE.replace('</head>', '<script src="x.js"></script></head>')],
    ]) {
      const src = await viewerSrc(name, { template });
      expect(() => html(src), name).toThrow(/viewer\.html/);
    }
    const big = await viewerSrc('big', { entry: `globalThis.__out = '${'a'.repeat(MAX_HTML_BYTES)}';\n` });
    expect(() => html(big)).toThrow(/300 KB|bytes/);
  });

  it('is deterministic and LF only', async () => {
    const src = await viewerSrc('determ', { template: TEMPLATE.replace(/\n/g, '\r\n') });
    const page = html(src);
    expect(page).toBe(html(src));
    expect(page).not.toContain('\r');
  });
});

// Minimal releasable project: manifests, recorder version, page entries and the viewer.
async function project(name) {
  const dir = join(tmp, name);
  const src = await viewerSrc(name);
  await mkdir(join(src, 'page'), { recursive: true });
  await writeFile(join(src, 'manifest.base.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '1.2.3' }));
  await writeFile(join(src, 'manifest.chrome.json'), '{}');
  await writeFile(join(src, 'manifest.firefox.json'), '{}');
  await writeFile(join(src, 'page', 'constants.js'), "export const RECORDER_VERSION = '1.2.3';\n");
  for (const { entry } of BUNDLES) await writeFile(join(src, entry), "import { RECORDER_VERSION } from './constants.js';\n\nglobalThis.__v = RECORDER_VERSION;\n");
  return dir;
}

describe('generateAll with the viewer', () => {
  it('writes standalone/viewer.html next to the script bundles', async () => {
    const dir = await project('gen-all');
    const { written } = await generateAll({ root: dir });
    expect(written).toEqual([...BUNDLES.map((b) => b.out), 'standalone/viewer.html']);
    const page = await readFile(join(dir, 'src', 'standalone', 'viewer.html'), 'utf8');
    expect(page).toBe(html(join(dir, 'src')));
    expect(await generateAll({ root: dir, check: true })).toEqual({ written: [], stale: [] });
  });

  it('generateAll --check reports stale viewer.html', async () => {
    const dir = await project('gen-stale');
    await generateAll({ root: dir });
    const file = join(dir, 'src', 'standalone', 'viewer.html');
    await writeFile(join(dir, 'src', 'viewer', 'text.js'), "export const text = 'Nowy tekst';\n");
    expect(await generateAll({ root: dir, check: true })).toEqual({ written: [], stale: ['standalone/viewer.html'] });
    expect(await readFile(file, 'utf8')).not.toContain('Nowy tekst');
    await rm(file);
    expect((await generateAll({ root: dir, check: true })).stale).toEqual(['standalone/viewer.html']);
  });

  it('fails with the file name when the viewer template is missing', async () => {
    const dir = await project('gen-missing');
    await rm(join(dir, 'src', 'viewer', 'viewer.html'));
    await expect(generateAll({ root: dir })).rejects.toThrow(/src\/viewer\/viewer\.html/);
  });
});

describe('pack: viewer artefact', () => {
  it('pack writes dist/page-debug-viewer-<version>.html equal to src/standalone/viewer.html', async () => {
    const dir = await project('pack-ok');
    await generateAll({ root: dir });
    const distDir = join(dir, 'dist');
    const zips = await pack({ root: dir, distDir });
    expect(zips).toHaveLength(2); // the return value stays the list of extension zips
    const artefact = join(distDir, 'page-debug-viewer-1.2.3.html');
    expect(await readFile(artefact, 'utf8')).toBe(await readFile(join(dir, 'src', 'standalone', 'viewer.html'), 'utf8'));
  });

  it('pack refuses a stale viewer before writing anything', async () => {
    const dir = await project('pack-stale');
    await generateAll({ root: dir });
    await writeFile(join(dir, 'src', 'standalone', 'viewer.html'), '<!-- hand edit -->\n');
    const distDir = join(dir, 'dist');
    await expect(pack({ root: dir, distDir })).rejects.toThrow(/src\/standalone\/viewer\.html/);
    expect(existsSync(distDir)).toBe(false);
  });
});
