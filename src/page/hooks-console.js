// console.* hooks for the MAIN-world recorder (design D5, E1-T5).
// Each level gets a wrapper that records { t, level, args, stack? } and then calls the original exactly once
// via Reflect.apply with the page's arguments. Recorder failures are swallowed; page exceptions propagate.
// restore() puts back only the levels that still hold our wrapper; a wrapper the page installed on top of ours
// (Sentry, Datadog, …) stays, and ours becomes a plain passthrough to the original.

export const STACK_MAX_CHARS = 16000;

// win -> true while hooks are installed; a second install in the same window is a no-op.
const consoleHookActive = new WeakMap();

function isStackFrame(line) {
  // Chrome/V8: "    at fn (url:l:c)"; Firefox: "fn@url:l:c" (fn may be empty).
  return /^\s*at\s/.test(line) || line.includes('@');
}

// Drops the "Error[: msg]" header (Chrome) and the first `skip` frames; caps the result.
// Returns undefined when nothing is left (e.g. Error.stackTraceLimit = 0).
export function parseStack(raw, skip = 0) {
  if (typeof raw !== 'string' || raw === '') return undefined;
  let lines = raw.split('\n').filter((line) => line.trim() !== '');
  if (lines.length && !isStackFrame(lines[0])) lines = lines.slice(1);
  lines = lines.slice(skip);
  if (!lines.length) return undefined;
  const stack = lines.join('\n');
  return stack.length > STACK_MAX_CHARS ? stack.slice(0, STACK_MAX_CHARS) : stack;
}

// Stack of the code that called the function calling stackFromHere() (its own frame and the caller's are dropped).
export function stackFromHere(ErrorCtor = Error) {
  let raw;
  try {
    raw = new ErrorCtor().stack;
  } catch {
    return undefined;
  }
  return parseStack(raw, 2);
}

function serializeArgs(json, args) {
  try {
    return json(args);
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

export function installConsoleHook({ win, now, record, json, levels, intrinsics = {} }) {
  const target = win.console;
  if (!target || consoleHookActive.get(win)) return () => {};

  const ReflectRef = intrinsics.Reflect || Reflect;
  const ErrorCtor = intrinsics.Error || Error;
  const originals = new Map();
  const wrappers = new Map();
  let busy = false;
  let active = true;

  for (const level of levels) {
    const orig = target[level];
    if (typeof orig !== 'function') continue;
    originals.set(level, orig);

    const wrapper = function (...args) {
      if (active && !busy) {
        busy = true;
        try {
          const entry = { t: now(), level, args: serializeArgs(json, args) };
          const stack = stackFromHere(ErrorCtor);
          if (stack !== undefined) entry.stack = stack;
          record('consoleLogs', entry);
        } catch {
          // recorder failure never affects the page call
        } finally {
          busy = false;
        }
      }
      return ReflectRef.apply(orig, target, args);
    };
    wrappers.set(level, wrapper);
    target[level] = wrapper;
  }

  consoleHookActive.set(win, true);

  let restored = false;
  return function restore() {
    if (restored) return;
    restored = true;
    active = false;
    for (const [level, orig] of originals) {
      if (target[level] === wrappers.get(level)) target[level] = orig;
    }
    originals.clear();
    wrappers.clear();
    consoleHookActive.delete(win);
  };
}
