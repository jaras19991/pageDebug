// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { installErrorHooks, TEXT_MAX_CHARS } from '../../src/page/hooks-errors.js';

const win = globalThis.window;

let records;
let restore;

function install({ json = (v) => ({ json: v }), record } = {}) {
  records = [];
  let clock = 100;
  restore = installErrorHooks({
    win,
    now: () => ++clock,
    record: record || ((kind, entry) => records.push({ kind, entry })),
    json,
  });
  return restore;
}

function rejection(reason) {
  const ev = new win.Event('unhandledrejection', { cancelable: true });
  Object.defineProperty(ev, 'reason', { value: reason });
  return ev;
}

afterEach(() => {
  if (restore) restore();
  restore = null;
});

describe('installErrorHooks', () => {
  it('ErrorEvent dispatched on window is recorded with message/filename/lineno/colno/stack', () => {
    install();
    const error = new Error('kaboom');
    win.dispatchEvent(
      new win.ErrorEvent('error', { message: 'Uncaught Error: kaboom', filename: 'https://e.x/app.js', lineno: 3, colno: 9, error }),
    );
    expect(records).toHaveLength(1);
    const { kind, entry } = records[0];
    expect(kind).toBe('runtimeErrors');
    expect(entry).toMatchObject({
      t: 101,
      type: 'error',
      message: 'Uncaught Error: kaboom',
      filename: 'https://e.x/app.js',
      lineno: 3,
      colno: 9,
    });
    expect(entry.stack).toBe(error.stack);
  });

  it('ErrorEvent without error object has no stack', () => {
    install();
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'Script error.' }));
    expect(records[0].entry.message).toBe('Script error.');
    expect(records[0].entry).not.toHaveProperty('stack');
  });

  it('unhandledrejection with Error is recorded with message, stack and serialized reason', () => {
    install();
    const err = new TypeError('bad');
    win.dispatchEvent(rejection(err));
    const { kind, entry } = records[0];
    expect(kind).toBe('runtimeErrors');
    expect(entry).toMatchObject({ t: 101, type: 'unhandledrejection', message: 'bad', stack: err.stack });
    expect(entry.reason).toEqual({ json: err });
  });

  it('unhandledrejection with plain value is recorded', () => {
    install();
    win.dispatchEvent(rejection({ code: 7 }));
    win.dispatchEvent(rejection('plain'));
    expect(records).toHaveLength(2);
    expect(records[0].entry.type).toBe('unhandledrejection');
    expect(records[0].entry.reason).toEqual({ json: { code: 7 } });
    expect(records[0].entry).not.toHaveProperty('stack');
    expect(records[1].entry.message).toBe('plain');
  });

  it('reason with throwing toString and throwing serializer still yields a record', () => {
    install({
      json: () => {
        throw new RangeError('x');
      },
    });
    const evil = {
      toString() {
        throw new Error('no');
      },
    };
    expect(() => win.dispatchEvent(rejection(evil))).not.toThrow();
    expect(records).toHaveLength(1);
    expect(records[0].entry.reason).toEqual({ serializationError: 'RangeError' });
    expect(typeof records[0].entry.message).toBe('string');
  });

  it('record() exception is swallowed', () => {
    install({
      record: () => {
        throw new Error('buffer');
      },
    });
    expect(() => win.dispatchEvent(new win.ErrorEvent('error', { message: 'm' }))).not.toThrow();
  });

  it('long message, filename and stack are capped', () => {
    install();
    const error = new Error('e');
    error.stack = 's'.repeat(TEXT_MAX_CHARS * 3);
    win.dispatchEvent(
      new win.ErrorEvent('error', { message: 'm'.repeat(TEXT_MAX_CHARS * 3), filename: 'f'.repeat(TEXT_MAX_CHARS * 3), error }),
    );
    const { entry } = records[0];
    expect(TEXT_MAX_CHARS).toBe(4000);
    expect(entry.message.length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
    expect(entry.filename.length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
    expect(entry.stack.length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
  });

  it('restore() removes both listeners (no record after)', () => {
    install();
    restore();
    restore = null;
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'after' }));
    win.dispatchEvent(rejection(new Error('after')));
    expect(records).toHaveLength(0);
  });

  it('second install while active is a no-op and does not double records', () => {
    install();
    const restore2 = installErrorHooks({ win, now: () => 0, record: (k, e) => records.push({ k, e }), json: (v) => v });
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'once' }));
    expect(records).toHaveLength(1);
    restore2();
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'still' }));
    expect(records).toHaveLength(2);
  });

  it('uses add/removeEventListener captured at install even if the page patches them later', () => {
    install();
    const desc = Object.getOwnPropertyDescriptor(win, 'removeEventListener');
    win.removeEventListener = () => {};
    try {
      restore();
      restore = null;
    } finally {
      if (desc) Object.defineProperty(win, 'removeEventListener', desc);
      else delete win.removeEventListener;
    }
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'after' }));
    expect(records).toHaveLength(0);
  });
});
