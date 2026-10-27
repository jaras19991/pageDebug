// E4 QA: MCP over stdio + privacy greps over the three consumers. Run: node docs/epics/E4/qa/run-mcp.mjs
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { heavyZip, networkSnapshot, zipOfSnapshot } from '../../../../tests/e2e/helpers/packages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const PK = join(HERE, 'pkgs');
const DIR = join(HERE, 'mcp-dir');
await rm(DIR, { recursive: true, force: true });
await mkdir(DIR, { recursive: true });
for (const f of ['iterator.zip', 'privacy.zip', 'iterator-keep.zip', 'basic.zip', 'network.zip', 'corrupt.zip']) await copyFile(join(PK, f), join(DIR, f));
for (const f of ['v1', 'v2', 'v3', 'v4', 'diff-a', 'diff-b']) await copyFile(join(ROOT, `tests/fixtures/snapshots/${f}.json`), join(DIR, `${f}.json`));
const heavy = await heavyZip();
await writeFile(join(DIR, 'heavy.zip'), heavy.bytes);
await writeFile(join(DIR, 'net5000.zip'), await zipOfSnapshot(networkSnapshot(5000)));
await writeFile(join(DIR, 'notapackage.txt'), 'x');

const child = spawn(process.execPath, [join(ROOT, 'mcp/server.js'), DIR], { stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let stderr = '';
child.stderr.on('data', (c) => { stderr += c; });
createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); });
let n = 1;
const rpc = (method, params) => new Promise((res, rej) => { const id = n++; const t = setTimeout(() => rej(new Error('timeout ' + method)), 30000); pending.set(id, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); return { isError: !!m.result?.isError, error: m.error, text: m.result?.content?.map((c) => c.text).join('') ?? '' }; };

const out = {};
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '1' } });
out.initialize = init.result?.serverInfo;
out.tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
const list = await call('list_snapshots', { limit: 100 });
out.list = list.text;
const ids = JSON.parse(list.text);
const rows = Array.isArray(ids) ? ids : ids.snapshots ?? ids.items ?? [];
out.listRows = rows.map((r) => `${r.id} v${r.schemaVersion} ${r.collectedAt ?? ''} ${r.error ? 'ERR ' + r.error : ''}`);
const idOf = (frag) => rows.find((r) => r.id.includes(frag))?.id;
const iterId = rows.find((r) => r.id.startsWith('snapshot-') && r.host === '127.0.0.1')?.id;

out.get_summary_v4 = (await call('get_summary', { id: 'v4.json' })).text.slice(0, 300);
// AC-5.3: identical to summary.md of the zip
const zipIter = unzipSync(new Uint8Array(await readFile(join(DIR, 'iterator.zip'))));
const sumMd = new TextDecoder().decode(zipIter['summary.md']);
const sumMcp = (await call('get_summary', { id: 'iterator.zip' })).text;
out.summaryIdentical = sumMd === sumMcp;
if (!out.summaryIdentical) out.summaryDiff = { md: sumMd.length, mcp: sumMcp.length, mcpStart: sumMcp.slice(0, 120) };
out.get_errors = (await call('get_errors', { id: 'iterator.zip' })).text;
out.get_steps = (await call('get_steps', { id: 'iterator.zip' })).text.slice(0, 800);
out.get_vitals = (await call('get_vitals', { id: 'iterator.zip' })).text.slice(0, 800);
out.get_network_default_iter = (await call('get_network', { id: 'iterator.zip' })).text.slice(0, 1200);
out.diff = await call('diff_snapshots', { a: 'diff-a.json', b: 'diff-b.json' });
out.diffLen = out.diff.text.length;
for (const id of ['heavy.zip', 'net5000.zip']) {
  const r = await call('get_network', { id });
  out[`get_network_default_${id}`] = { len: r.text.length, isError: r.isError, head: r.text.slice(0, 300), tail: r.text.slice(-400) };
  const e = await call('get_errors', { id });
  out[`get_errors_${id}`] = { len: e.text.length, tail: e.text.slice(-200) };
  const s = await call('get_summary', { id });
  out[`get_summary_${id}`] = { len: s.text.length };
  const full = await call('get_network', { id, failedOnly: false, includeHeaders: true, includeBody: true, limit: 500 });
  out[`get_network_max_${id}`] = { len: full.text.length, tail: full.text.slice(-300) };
}
// negative
out.badId = [await call('get_summary', { id: '../README.md' }), await call('get_summary', { id: '/etc/passwd' }), await call('get_summary', { id: 'corrupt.zip' }), await call('get_summary', { id: 'notapackage.txt' }), await call('get_summary', { id: 'nope.zip' })].map((r) => ({ isError: r.isError, text: r.text.slice(0, 200), error: r.error }));
out.stillAlive = (await call('list_snapshots', {})).text.length > 10;
// v1/v2/v3
out.v3_summary = (await call('get_summary', { id: 'v3.json' })).text.slice(0, 200);
out.v1_summary = (await call('get_summary', { id: 'v1.json' })).text.slice(0, 200);

// ---- privacy: trap values vs the three consumers ----
const traps = {};
for (const f of ['iterator', 'privacy', 'iterator-keep']) {
  const t = JSON.parse(await readFile(join(PK, `${f}.traps.json`), 'utf8'));
  for (const [k, v] of Object.entries(t)) if (typeof v === 'string' && v.length >= 6) traps[`${f}.${k}`] = v;
}
// jwt of privacy.html: read from the zip's page? not saved (traps.jwt dropped for iterator only); privacy keeps it.
const tools = ['get_summary', 'get_errors', 'get_steps', 'get_vitals'];
const zipIds = ['iterator.zip', 'privacy.zip', 'iterator-keep.zip', 'basic.zip', 'network.zip'];
const leaks = { zip: {}, summary_md: {}, mcp: {}, viewer: {} };
const viewer = JSON.parse(await readFile(join(HERE, 'viewer-results.json'), 'utf8'));
for (const id of zipIds) {
  const files = unzipSync(new Uint8Array(await readFile(join(DIR, id))));
  const mcpTexts = [];
  for (const t of tools) mcpTexts.push((await call(t, { id })).text);
  for (const f of [false, true]) mcpTexts.push((await call('get_network', { id, failedOnly: f, includeHeaders: true, includeBody: true, limit: 500 })).text);
  mcpTexts.push((await call('list_snapshots', {})).text);
  const viewerText = Object.entries(viewer[id]?.tabsTexts ?? {}).map(([, v]) => v).join('\n') + viewer[id]?.header;
  const sumText = new TextDecoder().decode(files['summary.md']);
  for (const [name, val] of Object.entries(traps)) {
    for (const [fname, bytes] of Object.entries(files)) if (Buffer.from(bytes).includes(Buffer.from(val))) (leaks.zip[`${id}:${fname}`] ??= []).push(name);
    if (sumText.includes(val)) (leaks.summary_md[id] ??= []).push(name);
    if (mcpTexts.some((x) => x.includes(val))) (leaks.mcp[id] ??= []).push(name);
    if (viewerText.includes(val)) (leaks.viewer[id] ??= []).push(name);
  }
}
out.leaks = leaks;
out.trapCount = Object.keys(traps).length;
out.stderr = stderr.slice(0, 500);
child.stdin.end();
await writeFile(join(HERE, 'mcp-results.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ tools: out.tools, listRows: out.listRows, summaryIdentical: out.summaryIdentical, diffLen: out.diffLen, leaks, trapCount: out.trapCount, badId: out.badId, stillAlive: out.stillAlive }, null, 1));
for (const k of Object.keys(out).filter((k) => k.startsWith('get_network_') || k.startsWith('get_errors_') || k.startsWith('get_summary_'))) if (typeof out[k] === 'object') console.log(k, out[k].len);
