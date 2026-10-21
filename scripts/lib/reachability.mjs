// Reachability walker for the build (design D3). The build copies exactly the files
// returned here, and the AC-4.2 test checks dist against the same function, so a file
// that nothing references (e.g. standalone/console-snapshot.js) can never end up in dist.
//
// Parsing is regex-based on purpose: our HTML and JS are small and hand-written, and the
// build must not depend on npm packages. Supported references:
//   manifest  icons, action.default_icon/default_popup, background.*, content_scripts[].js/css,
//             web_accessible_resources, options/devtools/side panel pages   (relative to root)
//   HTML      <script src="…">, <link href="…">  (comments ignored)          (relative to the HTML file)
//   JS        import/export … from '…', import '…', import('…')             (relative to the JS file)
//             files: ['…'] in executeScript/registerContentScripts            (relative to root)
// Absolute URLs (http:, chrome-extension:, data:, //host) are ignored.

import { readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

// Guard against parsing something huge by accident (e.g. a vendored bundle).
const MAX_PARSE_BYTES = 5 * 1024 * 1024;
// Guard against a runaway walk; the extension has a few dozen files.
const MAX_FILES = 2000;

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const HTML_SCRIPT_SRC = /<script\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/gi;
const HTML_LINK_HREF = /<link\b[^>]*?\shref\s*=\s*(["'])(.*?)\1/gi;
const JS_STATIC_IMPORT = /\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?(["'])([^"'\r\n]+)\1/g;
const JS_DYNAMIC_IMPORT = /\bimport\s*\(\s*(["'])([^"'\r\n]+)\1\s*\)/g;
const JS_FILES_ARRAY = /\bfiles\s*:\s*\[([^\]]*)\]/g;
const STRING_LITERAL = /(["'])([^"'\r\n]*)\1/g;

/**
 * Collects every file reachable from the manifest.
 * @param {string} dir extension root (source or built)
 * @param {{ manifest?: object }} [options] manifest object to walk instead of `<dir>/manifest.json`
 * @returns {Promise<string[]>} sorted POSIX paths relative to `dir`; `manifest.json` itself is not listed
 */
export async function collectReachable(dir, { manifest } = {}) {
  if (manifest === undefined) {
    manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  }

  const found = new Set();
  const queue = [];
  const add = (rel) => {
    if (found.has(rel)) return;
    if (found.size >= MAX_FILES) throw new Error(`Too many reachable files (> ${MAX_FILES})`);
    found.add(rel);
    queue.push(rel);
  };

  for (const ref of manifestRefs(manifest)) {
    const rel = resolveRef(ref, '', 'manifest.json');
    if (rel) add(rel);
  }

  while (queue.length) {
    const rel = queue.shift();
    if (!(await existsExact(dir, rel))) throw new Error(`Missing referenced file: ${rel}`);
    const ext = posix.extname(rel).toLowerCase();
    if (ext !== '.html' && ext !== '.js' && ext !== '.mjs') continue;

    const buf = await readFile(join(dir, ...rel.split('/')));
    if (buf.length > MAX_PARSE_BYTES) throw new Error(`File too large to scan: ${rel}`);
    const text = buf.toString('utf8');
    const fromDir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);

    const refs = ext === '.html' ? htmlRefs(text) : jsRefs(text, rel);
    for (const { ref, rootRelative } of refs) {
      const target = resolveRef(ref, rootRelative ? '' : fromDir, rel);
      if (target) add(target);
    }
  }

  return [...found].sort();
}

function manifestRefs(m) {
  const refs = [];
  const push = (v) => { if (typeof v === 'string') refs.push(v); };
  const pushAll = (v) => { if (Array.isArray(v)) v.forEach(push); };
  const pushValues = (v) => {
    if (typeof v === 'string') push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(push);
  };

  pushValues(m.icons);
  pushValues(m.action?.default_icon);
  push(m.action?.default_popup);
  push(m.background?.service_worker);
  pushAll(m.background?.scripts);
  push(m.background?.page);
  for (const cs of m.content_scripts ?? []) {
    pushAll(cs.js);
    pushAll(cs.css);
  }
  for (const entry of m.web_accessible_resources ?? []) {
    // MV3: [{ resources: [...] }]; MV2: ['...'].
    const resources = typeof entry === 'string' ? [entry] : entry?.resources ?? [];
    for (const r of resources) {
      if (typeof r === 'string' && r.includes('*')) {
        throw new Error(`Wildcard in web_accessible_resources is not supported by the build: ${r}`);
      }
      push(r);
    }
  }
  push(m.options_page);
  push(m.options_ui?.page);
  push(m.devtools_page);
  push(m.side_panel?.default_path);
  return refs;
}

function htmlRefs(html) {
  const text = html.replace(HTML_COMMENT, '');
  const refs = [];
  for (const re of [HTML_SCRIPT_SRC, HTML_LINK_HREF]) {
    for (const m of text.matchAll(re)) refs.push({ ref: m[2], rootRelative: false });
  }
  return refs;
}

function jsRefs(js, file) {
  const refs = [];
  for (const re of [JS_STATIC_IMPORT, JS_DYNAMIC_IMPORT]) {
    for (const m of js.matchAll(re)) {
      const spec = m[2];
      if (!ABSOLUTE_URL.test(spec) && !/^\.{0,2}\//.test(spec)) {
        throw new Error(`Unsupported import specifier "${spec}" in ${file} (use a relative path)`);
      }
      refs.push({ ref: spec, rootRelative: false });
    }
  }
  // scripting.executeScript / registerContentScripts resolve `files` against the extension root.
  for (const m of js.matchAll(JS_FILES_ARRAY)) {
    const body = m[1];
    if (body.replace(STRING_LITERAL, '').replace(/[\s,]/g, '') !== '') {
      throw new Error(`Non-literal entry in files: [...] in ${file}; only string literals can be walked`);
    }
    for (const s of body.matchAll(STRING_LITERAL)) refs.push({ ref: s[2], rootRelative: true });
  }
  return refs;
}

// Returns a normalized root-relative POSIX path, or null for absolute URLs.
function resolveRef(ref, fromDir, fromFile) {
  const clean = ref.trim().replace(/[?#].*$/, '');
  if (!clean || ABSOLUTE_URL.test(clean)) return null;
  const joined = clean.startsWith('/') ? clean.slice(1) : posix.join(fromDir, clean);
  const rel = posix.normalize(joined);
  if (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel) || rel === '.') {
    throw new Error(`Reference escapes extension directory: ${ref} (from ${fromFile})`);
  }
  return rel;
}

// Case-sensitive existence check, so a build on Windows/macOS fails the same way Linux would.
async function existsExact(dir, rel) {
  let current = dir;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    const entry = entries.find((e) => e.name === parts[i]);
    if (!entry) return false;
    const last = i === parts.length - 1;
    if (last ? !entry.isFile() : !entry.isDirectory()) return false;
    current = join(current, parts[i]);
  }
  return true;
}
