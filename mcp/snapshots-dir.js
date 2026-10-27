// The snapshots directory of the MCP server (E4 D6, E4-T4b). A package id is the name of a `*.zip` or `*.json`
// file lying directly in the directory. Ids with a path, `..`, a drive, NUL or a leading dot are refused before
// the file system is touched; a file whose realpath is not exactly `<realpath(dir)>/<id>` (a symlink, anything
// outside) is treated as missing, and symlinks never show up in the list (AC-5.8).
// Read-only: only readdir, stat, realpath and readFile are called on `fs`. Parsed packages are cached by
// (mtimeMs, size), so an unchanged file is decoded once.

import * as nodeFs from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { readErrorMessage } from '../src/lib/package-reader.js';
import { PackageError } from '../src/lib/migrate.js';

export const DIR_LIMITS = Object.freeze({
  // Largest package file read, bytes (= READER_LIMITS.maxJsonBytes).
  maxFileBytes: 64 * 1024 * 1024,
  // Entries returned by list(), newest first.
  maxListed: 200,
  // Package files considered by list() (newest by mtime); bounds the work on a huge directory.
  maxScanned: 2000,
  // Longest accepted id, characters.
  maxIdChars: 255,
  // Fully parsed packages kept in memory for open() (light list entries are kept for every file).
  maxCachedPackages: 8,
});

/** Polish message per directory error code (package errors use READ_ERRORS_PL from package-reader.js). */
export const DIR_ERRORS_PL = Object.freeze({
  'bad-id': 'Nieprawidłowy identyfikator paczki: podaj samą nazwę pliku .zip lub .json z listy list_snapshots (bez ścieżki).',
  'not-found': 'Nie ma takiej paczki w katalogu (dowiązania symboliczne są pomijane). Sprawdź list_snapshots.',
  'too-large': 'Plik jest za duży (limit 64 MB).',
  'no-dir': 'Nie można odczytać katalogu paczek. Sprawdź ścieżkę podaną przy uruchomieniu serwera.',
});

export class SnapshotDirError extends Error {
  /** @param {string} code  bad-id | not-found | too-large | no-dir | a PackageError code */
  constructor(code, message = DIR_ERRORS_PL[code]) {
    super(message);
    this.name = 'SnapshotDirError';
    this.code = code;
  }
}

const PACKAGE_EXT = /\.(?:zip|json)$/i;
const isWindows = process.platform === 'win32';

/** True for a bare package file name; anything that could address another place is refused. */
export function isValidId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id.length <= DIR_LIMITS.maxIdChars
    && !id.startsWith('.') // `.`, `..`, hidden files
    && !/[/\\:\0]/.test(id) // separators, drive letters / ADS, NUL
    && !id.includes('..')
    && PACKAGE_EXT.test(id);
}

const sameName = (a, b) => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b);

function hostOf(snapshot) {
  const hostname = snapshot?.environment?.location?.hostname;
  if (typeof hostname === 'string' && hostname !== '') return hostname.slice(0, 255);
  const docs = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  for (let i = docs.length - 1; i >= 0; i--) {
    try {
      const host = new URL(docs[i]?.url).hostname;
      if (host) return host;
    } catch {
      // not a URL; try the previous document
    }
  }
  return null;
}

// PackageError → its code and Polish text; anything else (an I/O error mid-read) reads as a damaged file.
function toError(err) {
  if (err instanceof SnapshotDirError) return err;
  return new SnapshotDirError(err instanceof PackageError ? err.code : 'corrupt', readErrorMessage(err));
}

/**
 * @param {string} root  the snapshots directory (as given on the command line)
 * @param {{ readPackage: (bytes: Uint8Array) => Promise<object>, fs?: object }} deps
 *        `fs`: `node:fs/promises`-like; only readdir/stat/realpath/readFile are used
 * @returns {{ list: () => Promise<{ items: object[], total: number, shown: number }>,
 *             open: (id: string) => Promise<object> }}
 *   list(): newest first (collectedAt, fallback mtime), ≤ maxListed; an entry is
 *     `{ id, file, format, host, collectedAt, schemaVersion, newer, overview, warnings, sizeBytes, modifiedAt }` or, for a file
 *     that cannot be read, `{ id, file, error, modifiedAt }` (Polish text). `total` = all package files found.
 *   open(id): readPackage() result plus `id`; throws SnapshotDirError (`message` is Polish, ready for a tool error).
 */
export function createSnapshotDir(root, { readPackage, fs = nodeFs } = {}) {
  let rootReal = null;
  const entries = new Map(); // id → { mtimeMs, size, entry }
  const packages = new Map(); // id → { mtimeMs, size, result }; insertion order = LRU

  async function realRoot() {
    if (rootReal === null) {
      try {
        rootReal = await fs.realpath(root);
      } catch {
        throw new SnapshotDirError('no-dir');
      }
    }
    return rootReal;
  }

  // id → { path, st } of a regular file directly in the directory, reached without a symlink.
  async function locate(id) {
    const dir = await realRoot();
    let real;
    try {
      real = await fs.realpath(join(dir, id));
    } catch {
      throw new SnapshotDirError('not-found');
    }
    if (dirname(real) !== dir || !sameName(basename(real), id)) throw new SnapshotDirError('not-found');
    let st;
    try {
      st = await fs.stat(real);
    } catch {
      throw new SnapshotDirError('not-found');
    }
    if (!st.isFile()) throw new SnapshotDirError('not-found');
    return { path: real, st };
  }

  async function load(id, path, st) {
    const hit = packages.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      packages.delete(id);
      packages.set(id, hit);
      if (hit.error) throw hit.error;
      return hit.result;
    }
    if (st.size > DIR_LIMITS.maxFileBytes) throw new SnapshotDirError('too-large');
    let result;
    let error = null;
    try {
      const bytes = await fs.readFile(path);
      if (bytes.length > DIR_LIMITS.maxFileBytes) throw new SnapshotDirError('too-large');
      result = await readPackage(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    } catch (err) {
      error = toError(err);
    }
    packages.delete(id);
    packages.set(id, { mtimeMs: st.mtimeMs, size: st.size, result, error });
    while (packages.size > DIR_LIMITS.maxCachedPackages) packages.delete(packages.keys().next().value);
    if (error) throw error;
    return result;
  }

  function describe(id, st, result) {
    const s = result.snapshot;
    return {
      id,
      file: id,
      format: result.format,
      host: hostOf(s),
      collectedAt: s.collectedAt ?? null,
      schemaVersion: result.sourceVersion,
      newer: result.newer,
      overview: s.overview ?? null,
      // Polish notes of the reader, e.g. a package from before automatic redaction (E4-FIX2).
      warnings: result.warnings.slice(0, 5).map((w) => String(w?.message ?? '').slice(0, 500)),
      sizeBytes: st.size,
      modifiedAt: new Date(st.mtimeMs).toISOString(),
    };
  }

  async function entryFor(id, path, st) {
    const hit = entries.get(id);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entry;
    let entry;
    try {
      entry = describe(id, st, await load(id, path, st));
    } catch (err) {
      entry = { id, file: id, error: toError(err).message, modifiedAt: new Date(st.mtimeMs).toISOString() };
    }
    entries.set(id, { mtimeMs: st.mtimeMs, size: st.size, entry });
    return entry;
  }

  async function list() {
    const dir = await realRoot();
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      throw new SnapshotDirError('no-dir');
    }
    // Dirent of a symlink reports isSymbolicLink(), not isFile(): symlinks are skipped here, and again by locate() —
    // the same realpath check as open() (review E4), in case the type changed after readdir or is not reported.
    const names = dirents.filter((d) => d.isFile() && isValidId(d.name)).map((d) => d.name);
    const files = [];
    for (const id of names) {
      try {
        files.push({ id, ...(await locate(id)) });
      } catch {
        // removed meanwhile, or not a regular file reached without a symlink
      }
    }
    for (const id of entries.keys()) if (!names.includes(id)) entries.delete(id);
    files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);

    const items = [];
    for (const { id, path, st } of files.slice(0, DIR_LIMITS.maxScanned)) items.push(await entryFor(id, path, st));
    const time = (e) => {
      const ms = typeof e.collectedAt === 'string' ? Date.parse(e.collectedAt) : NaN;
      return Number.isFinite(ms) ? ms : Date.parse(e.modifiedAt);
    };
    items.sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const shown = items.slice(0, DIR_LIMITS.maxListed);
    return { items: shown, total: files.length, shown: shown.length };
  }

  async function open(id) {
    if (!isValidId(id)) throw new SnapshotDirError('bad-id');
    const { path, st } = await locate(id);
    return { id, ...(await load(id, path, st)) };
  }

  return { list, open };
}
