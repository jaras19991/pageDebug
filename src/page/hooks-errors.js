// window `error` / `unhandledrejection` listeners for the MAIN-world recorder (design D5, E1-T5).
// Bubble-phase listeners on window (resource load errors are out of scope, E2). Handler references are kept
// so restore() removes exactly what was added. Recorder failures are swallowed.

export const TEXT_MAX_CHARS = 4000;

// Stacks are kept much longer than message/filename (AC-4.8).
export const STACK_MAX_CHARS = 16000;

// win -> true while listeners are installed; a second install in the same window is a no-op.
const errorHooksActive = new WeakMap();

function capText(value) {
  if (value === undefined || value === null) return value;
  let text;
  try {
    text = typeof value === 'string' ? value : String(value);
  } catch {
    return '[unprintable]';
  }
  return text.length > TEXT_MAX_CHARS ? text.slice(0, TEXT_MAX_CHARS) : text;
}

function stackOf(value) {
  try {
    const stack = value && value.stack;
    if (typeof stack !== 'string' || stack === '') return undefined;
    return stack.length > STACK_MAX_CHARS ? stack.slice(0, STACK_MAX_CHARS) : stack;
  } catch {
    return undefined;
  }
}

function messageOf(reason) {
  try {
    if (reason && typeof reason === 'object' && typeof reason.message === 'string') return capText(reason.message);
  } catch {
    // fall through to String()
  }
  return capText(reason) ?? String(reason);
}

function serialize(json, value) {
  try {
    return json(value);
  } catch (error) {
    let name = 'Error';
    try {
      name = String(error && error.name);
    } catch {
      // keep the default name
    }
    return { serializationError: name.slice(0, 100) };
  }
}

export function installErrorHooks({ win, now, record, json, intrinsics = {} }) {
  if (errorHooksActive.get(win)) return () => {};

  const add = intrinsics.addEventListener || win.addEventListener;
  const remove = intrinsics.removeEventListener || win.removeEventListener;

  function onError(event) {
    try {
      const entry = {
        t: now(),
        type: 'error',
        message: capText(event.message),
        filename: capText(event.filename),
        lineno: event.lineno,
        colno: event.colno,
      };
      const stack = stackOf(event.error);
      if (stack !== undefined) entry.stack = stack;
      record('runtimeErrors', entry);
    } catch {
      // never break the page's error dispatch
    }
  }

  function onRejection(event) {
    try {
      const reason = event.reason;
      const entry = { t: now(), type: 'unhandledrejection', message: messageOf(reason) };
      const stack = stackOf(reason);
      if (stack !== undefined) entry.stack = stack;
      entry.reason = serialize(json, reason);
      record('runtimeErrors', entry);
    } catch {
      // never break the page's rejection dispatch
    }
  }

  add.call(win, 'error', onError);
  add.call(win, 'unhandledrejection', onRejection);
  errorHooksActive.set(win, true);

  let restored = false;
  return function restore() {
    if (restored) return;
    restored = true;
    try {
      remove.call(win, 'error', onError);
      remove.call(win, 'unhandledrejection', onRejection);
    } finally {
      errorHooksActive.delete(win);
    }
  };
}
