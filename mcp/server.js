#!/usr/bin/env node
// Local MCP server for Page Debug Snapshot packages (E4 D6). Own minimal transport instead of the SDK
// (decision PB-1): JSON-RPC 2.0 over stdio, one message per UTF-8 line, stdout carries protocol
// messages only, logs go to stderr. Read-only: no network, no writes (AC-5.8). A failing tool or a
// broken request is answered with an error and never ends the process.
//
// Methods: initialize, ping, tools/list, tools/call; notifications are never answered.
// CLI: `node mcp/server.js <snapshots-directory>` (or PDS_SNAPSHOTS_DIR).

import { readFile, realpath, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTools } from './tools.js';

/** Supported MCP protocol versions, newest first; an unknown client version gets the newest. */
export const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);

/** Longest accepted request line (characters). */
export const MAX_LINE_CHARS = 1024 * 1024;

const SERVER_NAME = 'page-debug-mcp';
const MAX_MESSAGE_CHARS = 2000; // error texts and echoed names
const USAGE = 'Usage: node mcp/server.js <snapshots-directory>  (or set PDS_SNAPSHOTS_DIR)\n';

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || v === null;
const cut = (text) => String(text).slice(0, MAX_MESSAGE_CHARS);

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const errorReply = (id, code, message) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: cut(message) } });
const toolFailure = (text) => ({ isError: true, content: [{ type: 'text', text: cut(text) }] });

/**
 * JSON-RPC 2.0 request handler for the MCP tool subset.
 * Tool handlers get the `arguments` object and return a string (sent as is, e.g. markdown) or a value
 * sent as compact JSON. A thrown error becomes a tool result with `isError: true`.
 * @param {{
 *   tools?: Array<{ name: string, description: string, inputSchema: object, handler: (args: object) => unknown }>,
 *   name?: string, version: string, log?: (message: string) => void,
 * }} options
 * @returns {{ handle(line: string): Promise<string | null> }} `handle` answers one input line; null = no reply
 */
export function createServer({ tools = [], name = SERVER_NAME, version, log = () => {} }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const methods = new Map([
    ['initialize', (params) => ({
      protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name, version },
    })],
    ['ping', () => ({})],
    ['tools/list', () => ({ tools: tools.map(({ name: n, description, inputSchema }) => ({ name: n, description, inputSchema })) })],
    ['tools/call', async (params) => {
      if (!isObject(params) || typeof params.name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call requires params.name (string)');
      const args = params.arguments ?? {};
      if (!isObject(args)) throw new RpcError(INVALID_PARAMS, 'tools/call params.arguments must be an object');
      const tool = byName.get(params.name);
      if (!tool) return toolFailure(`Unknown tool: ${params.name}`);
      try {
        const value = await tool.handler(args);
        const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return toolFailure((error instanceof Error ? error.message : String(error)) || 'Error');
      }
    }],
  ]);

  async function handle(line) {
    const raw = String(line);
    if (raw.trim() === '') return null;
    if (raw.length > MAX_LINE_CHARS) return errorReply(null, INVALID_REQUEST, `Request too large (over ${MAX_LINE_CHARS} characters)`);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return errorReply(null, PARSE_ERROR, 'Parse error');
    }
    if (Array.isArray(msg)) return errorReply(null, INVALID_REQUEST, 'Batch requests are not supported');
    if (!isObject(msg) || msg.jsonrpc !== '2.0') return errorReply(isId(msg?.id) ? msg.id : null, INVALID_REQUEST, 'Invalid Request');
    const hasId = Object.hasOwn(msg, 'id');
    if (!Object.hasOwn(msg, 'method') && (Object.hasOwn(msg, 'result') || Object.hasOwn(msg, 'error'))) return null; // a client response
    if (hasId && !isId(msg.id)) return errorReply(null, INVALID_REQUEST, 'Invalid Request: id must be a string or a number');
    if (typeof msg.method !== 'string') return errorReply(hasId ? msg.id : null, INVALID_REQUEST, 'Invalid Request: method must be a string');
    if (!hasId) return null; // notification (notifications/initialized, cancelled, …): never answered

    const method = methods.get(msg.method);
    if (!method) return errorReply(msg.id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
    try {
      return JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: await method(msg.params) });
    } catch (error) {
      if (error instanceof RpcError) return errorReply(msg.id, error.code, error.message);
      log(`page-debug-mcp: ${msg.method} failed: ${error?.stack ?? error}`);
      return errorReply(msg.id, INTERNAL_ERROR, 'Internal error');
    }
  }

  return { handle };
}

/**
 * Runs the server on line streams until stdin ends. Requests are answered one at a time, in order.
 * @param {string[]} argv  arguments after the script: `[snapshotsDir]`
 * @param {{ stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream,
 *   env?: Record<string, string | undefined>,
 *   tools?: Array<object> | ((dir: string) => Array<object> | Promise<Array<object>>) }} [io]
 *   `tools`: the registry, or a factory given the absolute snapshots directory
 * @returns {Promise<number>} exit code: 0 after stdin ends, 2 on a missing or invalid directory
 */
export async function main(argv, {
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env,
  tools = createTools, // the seven tools of mcp/tools.js on the snapshots directory
} = {}) {
  const arg = argv[0] || env.PDS_SNAPSHOTS_DIR;
  if (!arg) {
    stderr.write(`page-debug-mcp: missing snapshots directory.\n${USAGE}`);
    return 2;
  }
  const dir = resolve(arg);
  let isDirectory = false;
  try {
    isDirectory = (await stat(dir)).isDirectory();
  } catch {
    // reported below
  }
  if (!isDirectory) {
    stderr.write(`page-debug-mcp: not a directory: ${cut(dir)}\n${USAGE}`);
    return 2;
  }

  const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const registry = typeof tools === 'function' ? await tools(dir) : tools;
  const server = createServer({ tools: registry, name: SERVER_NAME, version, log: (m) => stderr.write(`${m}\n`) });
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const reply = await server.handle(line);
    if (reply !== null) stdout.write(`${reply}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1]).catch(() => resolve(process.argv[1]))).href) {
  // stdout is the protocol channel: anything else printed by mistake goes to stderr.
  for (const level of ['log', 'info', 'debug']) console[level] = (...args) => console.error(...args);
  const report = (kind) => (error) => process.stderr.write(`page-debug-mcp: ${kind}: ${error?.stack ?? error}\n`);
  process.on('uncaughtException', report('uncaught exception'));
  process.on('unhandledRejection', report('unhandled rejection'));
  process.stdout.on('error', report('stdout'));
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    report('fatal')(error);
    process.exitCode = 1;
  });
}
