// @vitest-environment node
// E4-TEST3 (D6): `node mcp/server.js <dir>` spawned as a child process and driven over stdio like an MCP client —
// handshake and tools/list (AC-5.1), list over v2/v3/v4/damaged (AC-5.2), get_summary byte-identical with summary.md
// (AC-5.3), every tool ≤ 25 000 characters on the heavy package (AC-5.7), bad ids and broken requests answered while the
// process keeps serving, directory untouched, no network code, no trap value of the sensitive corpus in any answer (AC-5.8).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackage } from '../../src/lib/package-reader.js';
import { createSnapshotDir, listing, FILES, TRAP_HOST } from './helpers/snapshot-dir.js';
import { leaks } from './helpers/redaction-traps.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(root, 'mcp', 'server.js');
const MAX = 25_000;
const CALL_MS = 20_000; // one request, including decoding the heavy zip
const TOOL_NAMES = ['list_snapshots', 'get_summary', 'get_errors', 'get_network', 'get_vitals', 'get_steps', 'diff_snapshots'];

// Minimal line-based MCP client on a spawned server.
function startServer(dir) {
  const child = spawn(process.execPath, [SERVER, dir], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const stray = []; // replies without a waiting request (e.g. an answered notification)
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-20_000); });
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    const msg = JSON.parse(line); // stdout must carry protocol messages only
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      waiter(msg);
    } else {
      stray.push(msg);
    }
  });
  let nextId = 1;
  const sendLine = (line) => child.stdin.write(`${line}\n`);
  const request = (method, params, raw) => {
    const id = nextId++;
    const started = Date.now();
    return new Promise((resolveReply, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no reply to ${method} in ${CALL_MS} ms; stderr: ${stderr}`));
      }, CALL_MS);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolveReply({ ...msg, ms: Date.now() - started });
      });
      sendLine(raw ?? JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }));
    });
  };
  // A reply to a line that has no usable id comes back with id null.
  const rawLine = (line) => new Promise((resolveReply, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply to raw line; stderr: ${stderr}`)), CALL_MS);
    pending.set(null, (msg) => {
      clearTimeout(timer);
      resolveReply(msg);
    });
    sendLine(line);
  });
  return {
    child, request, rawLine, stray,
    notify: (method) => sendLine(JSON.stringify({ jsonrpc: '2.0', method })),
    stderr: () => stderr,
    stop: () => new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.stdin.end();
      setTimeout(() => { if (child.exitCode === null) child.kill(); }, 5000);
    }),
  };
}

let fixture;
let server;
let before;

async function callTool(name, args = {}) {
  const reply = await server.request('tools/call', { name, arguments: args });
  expect(reply.error, `${name} ${JSON.stringify(args)}`).toBeUndefined();
  const { content, isError } = reply.result;
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('text');
  return { text: content[0].text, isError: isError === true, ms: reply.ms };
}
const toolJson = async (name, args) => JSON.parse((await callTool(name, args)).text);

beforeAll(async () => {
  fixture = await createSnapshotDir();
  before = await listing(fixture.dir);
  server = startServer(fixture.dir);
}, 120_000);

afterAll(async () => {
  if (server) await server.stop();
  if (fixture) await fixture.cleanup();
});

describe('handshake (AC-5.1)', () => {
  it('initialize → notifications/initialized → tools/list returns the 7 tools', async () => {
    const init = await server.request('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pds-test', version: '1.0.0' },
    });
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'page-debug-mcp', version: expect.any(String) },
    });
    server.notify('notifications/initialized');
    const list = await server.request('tools/list', {});
    expect(list.result.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const t of list.result.tools) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema.type, t.name).toBe('object');
    }
    expect((await server.request('ping')).result).toEqual({});
    expect(server.stray).toEqual([]); // the notification got no answer
  });

  it('an unknown protocol version gets the newest supported one', async () => {
    const init = await server.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
    expect(init.result.protocolVersion).toBe('2025-06-18');
  });
});

describe('list_snapshots over v2 / v3 / v4 / damaged (AC-5.2)', () => {
  it('every file listed with id, host, collectedAt, schemaVersion, overview; damaged one has an error', async () => {
    const res = await toolJson('list_snapshots');
    const names = [fixture.exported.fileName, ...Object.values(FILES)];
    expect(res.total).toBe(names.length);
    expect(res.items.map((e) => e.id).sort()).toEqual([...names].sort());
    const byId = Object.fromEntries(res.items.map((e) => [e.id, e]));
    expect(byId[FILES.v2]).toMatchObject({ file: FILES.v2, format: 'json', schemaVersion: 2, host: '127.0.0.1', collectedAt: '2026-01-15T10:01:05.000Z' });
    expect(byId[FILES.v3]).toMatchObject({ format: 'json', schemaVersion: 3 });
    expect(byId[fixture.exported.fileName]).toMatchObject({ format: 'zip', schemaVersion: 4, host: 'app.example.test' });
    expect(byId[fixture.exported.fileName].overview).toMatchObject({ runtimeErrors: 1, failedRequests: 1 });
    expect(byId[FILES.heavy]).toMatchObject({ format: 'zip', schemaVersion: 4, host: 'heavy.example.com' });
    expect(byId[FILES.broken].error).toMatch(/uszkodzony|paczki/);
    expect(byId[FILES.broken].schemaVersion).toBeUndefined();
    const times = res.items.map((e) => Date.parse(e.collectedAt ?? e.modifiedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a)); // newest first
  });
});

describe('get_summary (AC-5.3)', () => {
  it('byte-identical with summary.md of the exported zip', async () => {
    const { summaryMd } = await readPackage(fixture.exported.bytes);
    expect(summaryMd).toBeTruthy();
    const { text, isError } = await callTool('get_summary', { id: fixture.exported.fileName });
    expect(isError).toBe(false);
    expect(Buffer.from(text, 'utf8').equals(Buffer.from(summaryMd, 'utf8'))).toBe(true);
  });

  it('byte-identical with summary.md of the trap zip', async () => {
    const { summaryMd } = await readPackage(fixture.traps);
    const { text } = await callTool('get_summary', { id: FILES.traps });
    expect(Buffer.from(text, 'utf8').equals(Buffer.from(summaryMd, 'utf8'))).toBe(true);
  });

  it('v2 and v3 JSON files get a summary too', async () => {
    for (const id of [FILES.v2, FILES.v3]) {
      const { text, isError } = await callTool('get_summary', { id });
      expect(isError, id).toBe(false);
      expect(text.length, id).toBeGreaterThan(100);
    }
  });
});

describe('heavy package: every tool ≤ 25 000 characters (AC-5.7)', () => {
  const calls = [
    ['list_snapshots', {}],
    ['get_summary', { id: FILES.heavy }],
    ['get_errors', { id: FILES.heavy }],
    ['get_errors', { id: FILES.heavy, limit: 200 }],
    ['get_network', { id: FILES.heavy }],
    ['get_network', { id: FILES.heavy, failedOnly: false, limit: 500, includeHeaders: true, includeBody: true }],
    ['get_vitals', { id: FILES.heavy }],
    ['get_steps', { id: FILES.heavy }],
    ['get_steps', { id: FILES.heavy, limit: 2000 }],
    ['diff_snapshots', null], // b = the exported zip (name known after beforeAll)
  ];

  it('each answer fits, the cut ones say how to narrow the query', async () => {
    const hinted = [];
    for (const [name, args0] of calls) {
      const args = name === 'diff_snapshots' ? { a: FILES.heavy, b: fixture.exported.fileName } : args0;
      const { text, isError, ms } = await callTool(name, args);
      const label = `${name} ${JSON.stringify(args)}`;
      expect(isError, label).toBe(false);
      expect(text.length, label).toBeLessThanOrEqual(MAX);
      expect(ms, label).toBeLessThan(CALL_MS);
      if (/zawęź zapytanie/.test(text)) hinted.push(label);
    }
    // Default get_errors (10 groups × 6000-character stacks cut to 4000) and the wide get_network are over the cap.
    expect(hinted.some((l) => l.startsWith('get_errors'))).toBe(true);
    expect(hinted.some((l) => l.startsWith('get_network') && l.includes('includeBody'))).toBe(true);
  });

  it('default get_network on the heavy package: only failed requests, first page of 50, no headers or bodies', async () => {
    const { text } = await callTool('get_network', { id: FILES.heavy });
    const res = JSON.parse(text);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.length).toBeLessThanOrEqual(50);
    expect(res.items.every((r) => r.status === null || r.status >= 400)).toBe(true);
    expect(res.items.some((r) => 'requestHeaders' in r || 'responseBodyPreview' in r)).toBe(false);
    expect(text.length).toBeLessThanOrEqual(MAX);
  });
});

describe('tools on v4 / diff pair', () => {
  it('get_errors, get_network, get_vitals, get_steps on the exported zip; diff_snapshots on the pair', async () => {
    const id = fixture.exported.fileName;
    const errors = await toolJson('get_errors', { id });
    expect(errors.groups.map((g) => g.message)).toContain('TypeError: x is undefined');
    expect(errors.groups[0].firstAt).toMatch(/^2026-10-26T08:00:30\.\d{3}Z$/);
    const network = await toolJson('get_network', { id });
    expect(network.items).toHaveLength(1);
    expect(network.items[0]).toMatchObject({ method: 'POST', status: 500, url: 'https://app.example.test/api' });
    const vitals = await toolJson('get_vitals', { id });
    expect(Array.isArray(vitals.docs)).toBe(true);
    const steps = await toolJson('get_steps', { id });
    expect(steps.items[0]).toMatchObject({ type: 'click' });
    const diff = await toolJson('diff_snapshots', { a: FILES.diffA, b: FILES.diffB });
    expect(diff).toMatchObject({ a: { id: FILES.diffA }, b: { id: FILES.diffB } });
    expect(JSON.stringify(diff).length).toBeLessThanOrEqual(MAX);
  });
});

describe('errors keep the server running (AC-5.8)', () => {
  it('bad id, path traversal, missing and damaged files → isError; the next call is answered', async () => {
    const bad = [
      ['get_summary', { id: '../v2.json' }],
      ['get_summary', { id: '..\\v2.json' }],
      ['get_summary', { id: '/etc/passwd' }],
      ['get_summary', { id: `${fixture.dir}/v2.json` }],
      ['get_summary', { id: 'v2.json\0.zip' }],
      ['get_summary', { id: 'missing.zip' }],
      ['get_summary', { id: 42 }],
      ['get_errors', { id: FILES.broken }],
      ['get_network', { id: FILES.v2, status: 'teapot' }],
      ['get_steps', { id: FILES.v2, limit: -1 }],
      ['diff_snapshots', { a: FILES.v2, b: '../../etc/passwd' }],
      ['no_such_tool', {}],
    ];
    for (const [name, args] of bad) {
      const { text, isError } = await callTool(name, args);
      expect(isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/root:|\bat .+\.js:\d+/); // no file contents, no stack trace
      const ok = await callTool('get_summary', { id: FILES.v3 });
      expect(ok.isError).toBe(false);
    }
  });

  it('broken JSON-RPC: parse error, unknown method, bad params; process still alive', async () => {
    const parse = await server.rawLine('{not json');
    expect(parse.error.code).toBe(-32700);
    const unknown = await server.request('resources/list', {});
    expect(unknown.error.code).toBe(-32601);
    const badParams = await server.request('tools/call', { arguments: {} });
    expect(badParams.error.code).toBe(-32602);
    expect((await server.request('ping')).result).toEqual({});
    expect(server.child.exitCode).toBeNull();
    expect(server.stderr()).not.toMatch(/uncaught|unhandled|fatal/i);
  });
});

describe('privacy: no trap value of the sensitive corpus in any answer (AC-5.8, privacy-redaction)', () => {
  // A short secret (`1234`, `918`) is looked for as a whole token: as a substring it matches times and counters.
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shortLeak = (secret, text) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(secret)}(?![\\p{L}\\p{N}])`, 'u').test(text);

  it('every tool on the trap zip, incl. headers and bodies, leaks no secret nor an 8-character fragment of one', async () => {
    const id = FILES.traps;
    const texts = [];
    for (const [name, args] of [
      ['get_summary', { id }],
      ['get_errors', { id, limit: 200 }],
      ['get_network', { id, failedOnly: false, limit: 500, includeHeaders: true, includeBody: true }],
      ['get_vitals', { id }],
      ['get_steps', { id, limit: 2000 }],
      ['diff_snapshots', { a: FILES.v3, b: id }],
      ['diff_snapshots', { a: id, b: FILES.v3 }],
    ]) {
      const { text, isError } = await callTool(name, args);
      expect(isError, name).toBe(false);
      texts.push(text);
    }
    // list_snapshots: the trap package's own entry (other entries carry other hosts).
    const list = await toolJson('list_snapshots');
    const entry = list.items.find((e) => e.id === id);
    expect(entry).toMatchObject({ host: TRAP_HOST, schemaVersion: 4 });
    texts.push(JSON.stringify(entry));

    const all = texts.join('\n');
    // The traps really reached the package and the answers: one marker per corpus item at least.
    expect(all.split('[redacted').length - 1).toBeGreaterThanOrEqual(fixture.items.length);
    // Fragments that the corpus itself shows outside any secret (`example.` of a host) are public text, not a leak.
    let background = fixture.items.map((item) => item.text).join('\n');
    for (const item of fixture.items) for (const secret of item.secrets) background = background.split(secret).join('\n');
    const found = [];
    for (const item of fixture.items) {
      for (const secret of item.secrets) {
        const hit = secret.length < 8
          ? (shortLeak(secret, all) ? [secret] : [])
          : leaks(secret, all).filter((fragment) => !background.includes(fragment));
        if (hit.length) found.push(`${item.id}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('read-only and offline (AC-5.8)', () => {
  it('directory unchanged (names, sizes, mtimes) after all calls', async () => {
    for (const name of TOOL_NAMES) {
      await callTool(name, name === 'diff_snapshots' ? { a: FILES.diffA, b: FILES.diffB } : { id: FILES.v2 });
    }
    expect(await listing(fixture.dir)).toEqual(before);
  });

  // mcp/*.js and every module reachable from them through relative imports (src/lib included).
  async function reachable() {
    const seen = new Set();
    const queue = (await fs.readdir(join(root, 'mcp'))).filter((n) => n.endsWith('.js')).map((n) => join(root, 'mcp', n));
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = await fs.readFile(file, 'utf8');
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) queue.push(resolve(dirname(file), m[1]));
    }
    return [...seen];
  }

  it('static: no net/http/https/dns/tls/dgram/child_process import and no fetch( in mcp/** and reachable src/lib', async () => {
    const files = await reachable();
    expect(files.some((f) => f.includes(join('src', 'lib')))).toBe(true);
    for (const file of files) {
      const code = (await fs.readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/['"](?:node:)?(?:net|http|https|http2|dns|tls|dgram|child_process|worker_threads|undici)(?:\/[^'"]*)?['"]/);
      expect(code, file).not.toMatch(/\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/);
    }
  });
});
