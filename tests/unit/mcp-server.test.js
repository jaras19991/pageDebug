// @vitest-environment node
// E4-T4a (D6, PB-1): MCP server transport without the SDK — JSON-RPC 2.0, one message per line on
// stdin/stdout, logs on stderr only, a failing tool never takes the process down (AC-5.8).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSIONS, createServer, main } from '../../mcp/server.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = join(root, 'mcp', 'server.js');
const PROCESS_TIMEOUT_MS = 20000;

const TOOLS = [
  {
    name: 'echo',
    description: 'Returns its arguments.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    handler: async (args) => ({ got: args }),
  },
  {
    name: 'markdown',
    description: 'Returns text as is.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => '# Paczka\n`x`',
  },
  {
    name: 'boom',
    description: 'Always throws.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => { throw new Error('nie można odczytać paczki'); },
  },
];

const server = () => createServer({ tools: TOOLS, name: 'page-debug-mcp', version: '9.9.9' });
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const call = async (srv, id, method, params) => JSON.parse(await srv.handle(rpc(id, method, params)));

describe('createServer', () => {
  it('initialize negotiates protocolVersion (known → echo, unknown → latest) and declares tools capability', async () => {
    expect(PROTOCOL_VERSIONS).toEqual(['2025-06-18', '2025-03-26', '2024-11-05']);
    const srv = server();
    for (const version of PROTOCOL_VERSIONS) {
      const res = await call(srv, 1, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 't', version: '1' } });
      expect(res).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'page-debug-mcp', version: '9.9.9' },
        },
      });
    }
    for (const version of ['2099-01-01', undefined, 42]) {
      const res = await call(srv, 'a', 'initialize', { protocolVersion: version });
      expect(res.id).toBe('a');
      expect(res.result.protocolVersion).toBe('2025-06-18');
    }
  });

  it('tools/list returns registry; tools/call routes args; unknown tool → isError; bad JSON → -32700; unknown method → -32601', async () => {
    const srv = server();
    const list = await call(srv, 2, 'tools/list', {});
    expect(list.result.tools).toEqual(TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));

    const echo = await call(srv, 3, 'tools/call', { name: 'echo', arguments: { text: 'błąd 500' } });
    expect(echo.result).toEqual({ content: [{ type: 'text', text: '{"got":{"text":"błąd 500"}}' }] });
    const noArgs = await call(srv, 4, 'tools/call', { name: 'echo' });
    expect(noArgs.result.content[0].text).toBe('{"got":{}}');
    const md = await call(srv, 5, 'tools/call', { name: 'markdown', arguments: {} });
    expect(md.result.content).toEqual([{ type: 'text', text: '# Paczka\n`x`' }]);

    const unknownTool = await call(srv, 6, 'tools/call', { name: 'rm_rf', arguments: {} });
    expect(unknownTool.result.isError).toBe(true);
    expect(unknownTool.result.content[0].text).toContain('rm_rf');

    expect(JSON.parse(await srv.handle('{"jsonrpc":"2.0","id":7,'))).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: expect.any(String) } });
    const unknown = await call(srv, 8, 'resources/list', {});
    expect(unknown.error.code).toBe(-32601);
    expect(unknown.id).toBe(8);
  });

  it('bad params → -32602; invalid request → -32600', async () => {
    const srv = server();
    for (const params of [undefined, null, [], { name: 1 }, { name: 'echo', arguments: 'x' }, { name: 'echo', arguments: [] }]) {
      const res = await call(srv, 9, 'tools/call', params);
      expect(res.error?.code, JSON.stringify(params)).toBe(-32602);
    }
    for (const line of ['[]', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '{"id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":1,"method":5}', '"x"', '{"jsonrpc":"2.0","id":{},"method":"ping"}']) {
      const res = JSON.parse(await srv.handle(line));
      expect(res.error?.code, line).toBe(-32600);
    }
    const huge = rpc(10, 'ping', { pad: 'x'.repeat(2 * 1024 * 1024) });
    expect(JSON.parse(await srv.handle(huge)).error.code).toBe(-32600);
  });

  it('ping answers {}; notifications and client responses get no reply', async () => {
    const srv = server();
    expect(await call(srv, 11, 'ping')).toEqual({ jsonrpc: '2.0', id: 11, result: {} });
    expect(await srv.handle('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
    expect(await srv.handle('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}')).toBeNull();
    expect(await srv.handle('{"jsonrpc":"2.0","method":"no/such/notification"}')).toBeNull();
    expect(await srv.handle('{"jsonrpc":"2.0","id":5,"result":{}}')).toBeNull();
    expect(await srv.handle('   ')).toBeNull();
  });

  it('handler throwing → isError result, next request still answered', async () => {
    const srv = server();
    const res = await call(srv, 12, 'tools/call', { name: 'boom', arguments: {} });
    expect(res.result).toEqual({ isError: true, content: [{ type: 'text', text: 'nie można odczytać paczki' }] });
    expect(res.error).toBeUndefined();
    expect((await call(srv, 13, 'ping')).result).toEqual({});
  });
});

describe('main', () => {
  // Runs main on in-memory streams; resolves when stdin ends and every answer is written.
  async function runMain(argv, lines, { env = {}, tools = TOOLS } = {}) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let out = '';
    let err = '';
    stdout.on('data', (c) => { out += c; });
    stderr.on('data', (c) => { err += c; });
    const done = main(argv, { stdin, stdout, stderr, env, tools });
    for (const line of lines) stdin.write(`${line}\n`);
    stdin.end();
    const code = await done;
    return { code, out, err };
  }

  it('answers sequentially, one JSON line per request', async () => {
    const { code, out, err } = await runMain([tmpdir()], [
      rpc(1, 'initialize', { protocolVersion: '2025-03-26' }),
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      rpc(2, 'tools/call', { name: 'boom', arguments: {} }),
      rpc(3, 'tools/list'),
    ]);
    expect(code).toBe(0);
    expect(err).toBe('');
    const replies = out.trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(replies[1].result.isError).toBe(true);
  });

  it('takes the directory from PDS_SNAPSHOTS_DIR and passes it to a tools factory', async () => {
    let seen = null;
    const factory = (dir) => { seen = dir; return TOOLS; };
    const { code } = await runMain([], [rpc(1, 'ping')], { env: { PDS_SNAPSHOTS_DIR: tmpdir() }, tools: factory });
    expect(code).toBe(0);
    expect(seen).toBe(tmpdir());
  });

  it('missing or non-directory argument → message on stderr, exit code 2, nothing on stdout', async () => {
    for (const argv of [[], [join(tmpdir(), 'pds-no-such-dir-e4')], [SERVER]]) {
      const { code, out, err } = await runMain(argv, [rpc(1, 'ping')]);
      expect(code, String(argv)).toBe(2);
      expect(out).toBe('');
      expect(err).toMatch(/director/i);
    }
  });
});

describe('mcp/package.json', () => {
  it('declares a module with bin and Node ≥ 20, without dependencies', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'mcp', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('page-debug-mcp');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'page-debug-mcp': 'server.js' });
    expect(pkg.engines).toEqual({ node: '>=20' });
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });
});

describe('spawned server', () => {
  let dir;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pds-mcp-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  // Spawns `node mcp/server.js …args`, writes `input`, closes stdin; kills the child on timeout.
  function runProcess(args, input) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SERVER, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PDS_SNAPSHOTS_DIR: '' } });
      let out = '';
      let err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error(`server did not exit; stderr: ${err}`)); }, PROCESS_TIMEOUT_MS - 2000);
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', reject);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
      child.stdin.end(input);
    });
  }

  it('stdout carries only JSON lines (spawned process, notifications/initialized has no reply)', async () => {
    const input = [
      rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }),
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      rpc(2, 'ping'),
      rpc(3, 'tools/list'),
      'not json',
      rpc(4, 'tools/call', { name: 'nope', arguments: {} }),
      '',
    ].join('\n');
    const { code, out } = await runProcess([dir], input);
    expect(code).toBe(0);
    expect(out.endsWith('\n')).toBe(true);
    const replies = out.slice(0, -1).split('\n').map((line) => JSON.parse(line));
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, null, 4]);
    expect(replies.every((r) => r.jsonrpc === '2.0')).toBe(true);
    expect(replies[0].result.protocolVersion).toBe('2024-11-05');
    expect(replies[0].result.serverInfo.name).toBe('page-debug-mcp');
    expect(replies[3].error.code).toBe(-32700);
    expect(replies[4].result.isError).toBe(true);
  }, PROCESS_TIMEOUT_MS);

  it('without a directory exits with code 2 and a message on stderr', async () => {
    const { code, out, err } = await runProcess([], '');
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toMatch(/node mcp\/server\.js <.+>/);
  }, PROCESS_TIMEOUT_MS);
});
