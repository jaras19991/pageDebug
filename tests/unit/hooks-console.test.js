import { describe, it, expect, vi, afterEach } from 'vitest';
import { installConsoleHook, stackFromHere, parseStack, STACK_MAX_CHARS } from '../../src/page/hooks-console.js';
import { serializeCapped } from '../../src/page/serialize.js';
import { LIMITS } from '../../src/page/constants.js';

// Hooks are tested against a fake `win` with its own `console`, so the test runner's console is never touched.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

function setup({ json = (v) => v, record } = {}) {
  const originals = Object.fromEntries(LEVELS.map((l) => [l, vi.fn(function () { return 'ret-' + l; })]));
  const win = { console: { ...originals } };
  const records = [];
  let clock = 0;
  const restore = installConsoleHook({
    win,
    now: () => ++clock,
    record: record || ((kind, entry) => records.push({ kind, entry })),
    json,
    levels: LEVELS,
  });
  return { win, originals, records, restore };
}

let savedLimit;
afterEach(() => {
  if (savedLimit !== undefined) {
    Error.stackTraceLimit = savedLimit;
    savedLimit = undefined;
  }
});

describe('installConsoleHook', () => {
  it('console.error calls the original once with same args and console as this', () => {
    const { win, originals } = setup();
    const obj = { a: 1 };
    const ret = win.console.error('boom', obj, 42);
    expect(originals.error).toHaveBeenCalledTimes(1);
    expect(originals.error.mock.calls[0]).toEqual(['boom', obj, 42]);
    expect(originals.error.mock.calls[0][1]).toBe(obj);
    expect(originals.error.mock.contexts[0]).toBe(win.console);
    expect(ret).toBe('ret-error');
  });

  it('console record has level, serialized args, t and stack containing the calling function name', () => {
    const { win, records } = setup({ json: (v) => ({ serialized: v }) });
    function callerMarker() {
      win.console.warn('x', 1);
    }
    callerMarker();
    expect(records).toHaveLength(1);
    const { kind, entry } = records[0];
    expect(kind).toBe('consoleLogs');
    expect(entry.level).toBe('warn');
    expect(entry.t).toBe(1);
    expect(entry.args).toEqual({ serialized: ['x', 1] });
    expect(entry.stack).toContain('callerMarker');
  });

  it('stack strips recorder frame and Error header', () => {
    const { win, records } = setup();
    function callerMarker() {
      win.console.log('x');
    }
    callerMarker();
    const { stack } = records[0].entry;
    expect(stack.startsWith('Error')).toBe(false);
    expect(stack.split('\n')[0]).toContain('callerMarker');
    expect(stack).not.toContain('stackFromHere');
  });

  it('stack omitted when Error.stackTraceLimit is 0', () => {
    const { win, records } = setup();
    savedLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 0;
    win.console.log('x');
    expect(records[0].entry).not.toHaveProperty('stack');
  });

  it('serializer exception does not break logging: original called and record has fallback', () => {
    const { win, originals, records } = setup({
      json: () => {
        throw new TypeError('nope');
      },
    });
    win.console.error('a');
    expect(originals.error).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0].entry.args).toEqual({ serializationError: 'TypeError' });
  });

  it('record() exception does not break logging and original is still called once', () => {
    const { win, originals } = setup({
      record: () => {
        throw new Error('buffer broke');
      },
    });
    expect(() => win.console.info('a')).not.toThrow();
    expect(originals.info).toHaveBeenCalledTimes(1);
  });

  it('exception thrown by the original propagates unchanged', () => {
    const { win, originals } = setup();
    const err = new Error('page');
    originals.log.mockImplementation(() => {
      throw err;
    });
    expect(() => win.console.log('x')).toThrow(err);
  });

  it('re-entrant console call from serializer is passed through without recording', () => {
    let win;
    const { win: w, originals, records } = setup({
      json: (v) => {
        win.console.log('inner');
        return v;
      },
    });
    win = w;
    win.console.log('outer');
    expect(records).toHaveLength(1);
    expect(originals.log).toHaveBeenCalledTimes(2);
  });

  it('restore() restores identical console methods and stops recording', () => {
    const { win, originals, records, restore } = setup();
    expect(win.console.log).not.toBe(originals.log);
    restore();
    for (const l of LEVELS) expect(win.console[l]).toBe(originals[l]);
    win.console.log('after');
    expect(records).toHaveLength(0);
  });

  it('page wrapped console after us → restore keeps page wrapper, our wrapper is passthrough', () => {
    const originals = Object.fromEntries(LEVELS.map((l) => [l, vi.fn(function () { return 'ret-' + l; })]));
    const win = { console: { ...originals } };
    const records = [];
    const json = vi.fn((v) => v);
    let errorsCreated = 0;
    const CountingError = function () {
      errorsCreated += 1;
      return new Error();
    };
    const restore = installConsoleHook({
      win,
      now: () => 1,
      record: (kind, entry) => records.push({ kind, entry }),
      json,
      levels: LEVELS,
      intrinsics: { Error: CountingError },
    });
    const ours = win.console.error;
    const pageCalls = [];
    const pageWrapper = function (...args) {
      pageCalls.push(args);
      return ours.apply(this, args);
    };
    win.console.error = pageWrapper;
    restore();
    expect(win.console.error).toBe(pageWrapper);
    expect(win.console.log).toBe(originals.log);

    json.mockClear();
    errorsCreated = 0;
    const ret = win.console.error('after', 1);
    expect(ret).toBe('ret-error');
    expect(pageCalls).toEqual([['after', 1]]);
    expect(originals.error).toHaveBeenCalledTimes(1);
    expect(originals.error.mock.calls[0]).toEqual(['after', 1]);
    expect(originals.error.mock.contexts[0]).toBe(win.console);
    expect(records).toHaveLength(0);
    expect(json).not.toHaveBeenCalled();
    expect(errorsCreated).toBe(0);
  });

  it('second install while active is a no-op and does not double records', () => {
    const { win, originals, records, restore } = setup();
    const wrapped = win.console.log;
    const restore2 = installConsoleHook({
      win,
      now: () => 0,
      record: (kind, entry) => records.push({ kind, entry }),
      json: (v) => v,
      levels: LEVELS,
    });
    expect(win.console.log).toBe(wrapped);
    win.console.log('x');
    expect(records).toHaveLength(1);
    expect(originals.log).toHaveBeenCalledTimes(1);
    restore2();
    expect(win.console.log).toBe(wrapped);
    restore();
    expect(win.console.log).toBe(originals.log);
  });

  it('install works again after restore', () => {
    const { win, records, restore } = setup();
    restore();
    const restore2 = installConsoleHook({
      win,
      now: () => 0,
      record: (kind, entry) => records.push({ kind, entry }),
      json: (v) => v,
      levels: LEVELS,
    });
    win.console.debug('x');
    expect(records).toHaveLength(1);
    restore2();
  });

  it('skips levels missing on console', () => {
    const win = { console: { log: vi.fn() } };
    const restore = installConsoleHook({ win, now: () => 0, record: () => {}, json: (v) => v, levels: LEVELS });
    expect(win.console).not.toHaveProperty('error');
    restore();
  });
});

describe('stack parsing', () => {
  it('stackFromHere drops its own frame and its caller frame', () => {
    function outerMarker() {
      return innerMarker();
    }
    function innerMarker() {
      return stackFromHere();
    }
    const stack = outerMarker();
    expect(stack.split('\n')[0]).toContain('outerMarker');
    expect(stack).not.toContain('innerMarker');
  });

  it('stack parses Firefox format sample', () => {
    const raw =
      'wrapper@moz-extension://abc/main-world.js:10:5\n' +
      'callerMarker@https://example.com/app.js:3:9\n' +
      '@https://example.com/app.js:7:1\n';
    expect(parseStack(raw, 1)).toBe(
      'callerMarker@https://example.com/app.js:3:9\n@https://example.com/app.js:7:1',
    );
  });

  it('Chrome format: header line removed, frames kept', () => {
    const raw = 'Error\n    at wrapper (x.js:1:1)\n    at callerMarker (app.js:3:9)';
    expect(parseStack(raw, 1)).toBe('    at callerMarker (app.js:3:9)');
  });

  it('header-only stack (stackTraceLimit 0) gives undefined', () => {
    expect(parseStack('Error', 1)).toBeUndefined();
    expect(parseStack('', 0)).toBeUndefined();
    expect(parseStack(undefined, 0)).toBeUndefined();
  });

  it(`stack is capped at ${STACK_MAX_CHARS} chars`, () => {
    const frames = Array.from({ length: 2000 }, (_, i) => `    at f${i} (https://example.com/a.js:1:1)`);
    const out = parseStack('Error\n' + frames.join('\n'), 0);
    expect(STACK_MAX_CHARS).toBe(16000);
    expect(out.length).toBeLessThanOrEqual(16000);
    expect(out.startsWith('    at f0 ')).toBe(true);
  });
});

describe('installConsoleHook — full stacks and cause (E2-T7a, AC-4.8)', () => {
  const frames = (n, prefix = 'f') =>
    Array.from({ length: n }, (_, i) => `    at ${prefix}${i} (https://example.com/${'u'.repeat(300)}.js:${i + 1}:1)`);

  it('console stack equals call stack for stacks up to 16000 chars; longer is cut at 16000', () => {
    const fit = frames(45);
    expect(fit.join('\n').length).toBeGreaterThan(14000);
    expect(parseStack('Error\n    at wrapper (x.js:1:1)\n' + fit.join('\n'), 1)).toBe(fit.join('\n'));
    const long = frames(80).join('\n');
    expect(parseStack('Error\n' + long, 0)).toBe(long.slice(0, 16000));
  });

  it('console.error(err) args contain name, message, full stack and cause chain of 5 levels; 6th level marked', () => {
    const { win, records } = setup({ json: (v) => serializeCapped(v, LIMITS.entryChars).value });
    let err = new Error('level 6');
    for (let level = 5; level >= 0; level--) {
      err = new Error(`level ${level}`, { cause: err });
      err.stack = `Error: level ${level}\n` + frames(level === 0 ? 45 : 12, `l${level}_`).join('\n');
    }
    win.console.error(err);
    const [arg] = records[0].entry.args;
    expect(LIMITS.entryChars).toBe(40000);
    expect(arg).not.toHaveProperty('truncated');
    expect(arg.name).toBe('Error');
    expect(arg.message).toBe('level 0');
    expect(arg.stack).toBe(err.stack);
    let node = arg;
    let cause = err;
    for (let level = 1; level <= 5; level++) {
      node = node.cause;
      cause = cause.cause;
      expect(node.message).toBe(`level ${level}`);
      expect(node.stack).toBe(cause.stack.slice(0, 4000));
    }
    expect(node.cause).toBe('[cause depth limit]');
  });
});
