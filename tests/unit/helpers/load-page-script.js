import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from the file path, not `new URL(...)`: under jsdom the global URL is jsdom's.
const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/page/page-debug-snapshot.js');

// Runs the MAIN-world IIFE the same way the browser does: as a classic script in the
// global scope of the (jsdom) window. Requires `// @vitest-environment jsdom`.
// Returns the fresh `window.PageDebugSnapshot`; never calls `init()`.
export function loadPageScript() {
  if (typeof window === 'undefined') {
    throw new Error('loadPageScript needs the jsdom environment');
  }
  const src = readFileSync(SCRIPT_PATH, 'utf8');
  delete window.PageDebugSnapshot;
  // Indirect eval executes in the global scope. If vitest keeps the jsdom window
  // separate from globalThis, fall back to the window's own eval.
  const globalEval = window === globalThis ? (0, eval) : window.eval;
  globalEval(src);
  return window.PageDebugSnapshot;
}
