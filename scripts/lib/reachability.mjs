// Reachability walker for the build (design D3). The build copies exactly the files
// returned here, and the AC-4.2 test checks dist against the same function, so a file
// that nothing references (e.g. standalone/console-snapshot.js) can never end up in dist.
//
// Parsing is regex-based on purpose: our HTML and JS are small and hand-written, and the
// build must not depend on npm packages. Supported references:
//   manifest  icons, action.default_icon/default_popup, background.*, content_scripts[].js/css,
//             web_accessible_resources, options/devtools/side panel pages   (relative to root)
//   HTML      <script src="…">, <link href="…">  (comments ignored)          (relative to the HTML file)
//             url(…) in <style> / style=""                                    (relative to the HTML file)
//   CSS       url(…), @import '…'  (comments ignored)                         (relative to the CSS file)
//   JS        import/export … from '…', import '…', import('…')             (relative to the JS file)
//             files: ['…'] / js: ['…'] in executeScript/registerContentScripts (relative to root)
//             runtime.getURL('…')                                             (relative to root)
//             JS comments are blanked first (review F11): a word in a comment is never a reference.
//             Method calls on other objects (`x.url(`, `x.getURL(`) are not references either.
// Absolute URLs (http:, chrome-extension:, data:, //host) are ignored.
// Fail-safe (AC-6.3): a reference the walker sees but cannot resolve — url(…) that is not a plain
// literal or sits in JS, runtime.getURL/import() with a non-literal, importScripts(, files:/js:
// without a literal array — throws `Unresolvable reference in <file>: <match>`.

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
const STRING_LITERAL = /(["'])([^"'\r\n]*)\1/g;
const JS_FILES_KEY = /(?<![\w$.])(?:files|js)\s*:/g;
const JS_LITERAL_ARRAY = /(?:files|js)\s*:\s*\[([^\]]*)\]/y;
const JS_ANY_DYNAMIC_IMPORT = /\bimport\s*\(/g;
const JS_DYNAMIC_IMPORT_AT = /import\s*\(\s*(["'])[^"'\r\n]+\1\s*\)/y;
const JS_GET_URL = /\bruntime\s*\.\s*getURL\s*\(/g;
const JS_GET_URL_ARG = /\s*(["'])([^"'\r\n]+)\1\s*\)/y;
const JS_IMPORT_SCRIPTS = /\bimportScripts\s*\(/;
const JS_CSS_URL = /(?<![\w$.])url\(/;
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const CSS_URL = /(?<![\w-])url\(/gi;
const CSS_URL_LITERAL = /url\(\s*(?:(["'])([^"'\r\n]*)\1|([^"'()\s\\$]+))\s*\)/iy;
const CSS_IMPORT_STRING = /@import\s+(["'])([^"'\r\n]+)\1/gi;
// Length of the source excerpt quoted in an "Unresolvable reference" error.
const SNIPPET_LENGTH = 60;

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
    if (ext !== '.html' && ext !== '.css' && ext !== '.js' && ext !== '.mjs') continue;

    const buf = await readFile(join(dir, ...rel.split('/')));
    if (buf.length > MAX_PARSE_BYTES) throw new Error(`File too large to scan: ${rel}`);
    const text = buf.toString('utf8');
    const fromDir = posix.dirname(rel) === '.' ? '' : posix.dirname(rel);

    const refs = ext === '.html' ? htmlRefs(text, rel) : ext === '.css' ? cssRefs(text, rel) : jsRefs(text, rel);
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

function htmlRefs(html, file) {
  const text = html.replace(HTML_COMMENT, '');
  const refs = [];
  for (const re of [HTML_SCRIPT_SRC, HTML_LINK_HREF]) {
    for (const m of text.matchAll(re)) refs.push({ ref: m[2], rootRelative: false });
  }
  // <style> blocks and style="" attributes.
  refs.push(...cssUrlRefs(text, file));
  return refs;
}

function cssRefs(css, file) {
  const text = css.replace(CSS_COMMENT, '');
  const refs = cssUrlRefs(text, file);
  for (const m of text.matchAll(CSS_IMPORT_STRING)) refs.push({ ref: m[2], rootRelative: false });
  return refs;
}

// url("…"), url('…') or url(plain/path); anything else (var(), ${…}, escapes) is unresolvable.
function cssUrlRefs(text, file) {
  const refs = [];
  for (const m of text.matchAll(CSS_URL)) {
    CSS_URL_LITERAL.lastIndex = m.index;
    const lit = CSS_URL_LITERAL.exec(text);
    if (!lit) throw unresolvable(file, text, m.index);
    refs.push({ ref: lit[2] ?? lit[3], rootRelative: false });
  }
  return refs;
}

// Keywords after which `/` starts a regex literal, not a division.
const REGEX_AFTER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const IDENT_CHAR = /[\w$]/;

/**
 * JS source with every comment replaced by spaces (newlines kept), so indices and line numbers stay the same.
 * A small scanner, not a parser: it follows strings, template literals (with nested `${…}`) and regex literals
 * (`/` after an operator, an opening bracket or a keyword), which is enough for our hand-written modules.
 */
export function blankJsComments(js) {
  const out = js.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const templates = []; // brace depth at each `${` of an open template literal
  let depth = 0;
  let regexAllowed = true;
  let i = 0;
  const n = js.length;
  const skipQuoted = (quote) => {
    i++;
    while (i < n && js[i] !== quote && js[i] !== '\n') i += js[i] === '\\' ? 2 : 1;
    i++;
  };
  // Template text from i (after ` or a closing `}` of `${`) up to its end or the next `${`.
  const scanTemplate = () => {
    while (i < n) {
      if (js[i] === '\\') i += 2;
      else if (js[i] === '`') {
        i++;
        return;
      } else if (js[i] === '$' && js[i + 1] === '{') {
        i += 2;
        templates.push(depth);
        depth++;
        return;
      } else i++;
    }
  };
  while (i < n) {
    const c = js[i];
    if (c === '/' && js[i + 1] === '/') {
      const end = js.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && js[i + 1] === '*') {
      const end = js.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      skipQuoted(c);
      regexAllowed = false;
    } else if (c === '`') {
      i++;
      scanTemplate();
      regexAllowed = false;
    } else if (c === '/' && regexAllowed) {
      // Regex literal: escapes and character classes may hold `/`.
      let inClass = false;
      i++;
      while (i < n && js[i] !== '\n') {
        if (js[i] === '\\') {
          i += 2;
          continue;
        }
        if (js[i] === '/' && !inClass) break;
        if (js[i] === '[') inClass = true;
        else if (js[i] === ']') inClass = false;
        i++;
      }
      i++;
      regexAllowed = false;
    } else if (IDENT_CHAR.test(c)) {
      const start = i;
      while (i < n && IDENT_CHAR.test(js[i])) i++;
      regexAllowed = REGEX_AFTER_WORDS.has(js.slice(start, i));
    } else if (c === '{') {
      depth++;
      i++;
      regexAllowed = true;
    } else if (c === '}') {
      depth--;
      i++;
      if (templates.length > 0 && templates.at(-1) === depth) {
        templates.pop();
        scanTemplate();
        regexAllowed = false;
      } else regexAllowed = true;
    } else {
      if (!/\s/.test(c)) regexAllowed = c !== ')' && c !== ']';
      i++;
    }
  }
  return out.join('');
}

function jsRefs(source, file) {
  const js = blankJsComments(source);
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
  for (const m of js.matchAll(JS_ANY_DYNAMIC_IMPORT)) {
    JS_DYNAMIC_IMPORT_AT.lastIndex = m.index;
    if (!JS_DYNAMIC_IMPORT_AT.test(js)) throw unresolvable(file, js, m.index);
  }
  // executeScript `files` and registerContentScripts `js` resolve against the extension root.
  for (const m of js.matchAll(JS_FILES_KEY)) {
    JS_LITERAL_ARRAY.lastIndex = m.index;
    const arr = JS_LITERAL_ARRAY.exec(js);
    if (!arr || arr[1].replace(STRING_LITERAL, '').replace(/[\s,]/g, '') !== '') {
      throw unresolvable(file, js, m.index);
    }
    for (const s of arr[1].matchAll(STRING_LITERAL)) refs.push({ ref: s[2], rootRelative: true });
  }
  for (const m of js.matchAll(JS_GET_URL)) {
    JS_GET_URL_ARG.lastIndex = m.index + m[0].length;
    const lit = JS_GET_URL_ARG.exec(js);
    if (!lit) throw unresolvable(file, js, m.index);
    refs.push({ ref: lit[2], rootRelative: true });
  }
  // Classic-worker importScripts() and CSS url() built in JS strings are not walked.
  for (const re of [JS_IMPORT_SCRIPTS, JS_CSS_URL]) {
    const m = re.exec(js);
    if (m) throw unresolvable(file, js, m.index);
  }
  return refs;
}

function unresolvable(file, text, index) {
  const snippet = text.slice(index, index + SNIPPET_LENGTH).split(/\r?\n/)[0];
  return new Error(`Unresolvable reference in ${file}: ${snippet}`);
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
