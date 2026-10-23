// Serialization helpers shared by the recorder and the collector (ES module, D6).
// No DOM access beyond `Element`/`Node` looked up on `globalThis`, so the module
// also runs in node. The generator only allows one-line imports and
// `export function|const|class`, and every top-level name ends up in one IIFE,
// so internal helpers carry a distinctive prefix.

function serializeIsPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Deep copy of a value taken from a merge source: plain objects and arrays are
// rebuilt, so the result never shares references with the source (AC-6.5).
function serializeCloneSourceValue(value) {
  if (Array.isArray(value)) return value.map(serializeCloneSourceValue);
  if (serializeIsPlainObject(value)) return deepMerge({}, value);
  return value;
}

export function deepMerge(target, source) {
  const output = { ...target };

  if (!source || typeof source !== 'object') {
    return output;
  }

  Object.keys(source).forEach((key) => {
    if (serializeIsPlainObject(source[key]) && typeof output[key] === 'object' && output[key] !== null) {
      output[key] = deepMerge(output[key], source[key]);
    } else {
      output[key] = serializeCloneSourceValue(source[key]);
    }
  });

  return output;
}

export function safeSlice(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) + `... [truncated ${value.length - max} chars]` : value;
}

// Stack limits for Error values (AC-4.8): the error itself keeps up to 16 000 chars, each cause up to 4000.
// Causes are followed up to SERIALIZE_CAUSE_DEPTH levels; a deeper one becomes a marker.
const SERIALIZE_STACK_MAX = 16000;
const SERIALIZE_CAUSE_STACK_MAX = 4000;
const SERIALIZE_CAUSE_DEPTH = 5;

// Errors of same-origin frames come from another realm and fail `instanceof Error`; the built-in brand
// (`[object Error]`, captured at load) recognises them too (E2-D6).
const serializeObjectToString = Object.prototype.toString;

function serializeIsError(value) {
  if (value instanceof Error) return true;
  if (value === null || typeof value !== 'object') return false;
  try {
    return Reflect.apply(serializeObjectToString, value, []) === '[object Error]';
  } catch {
    return false;
  }
}

function serializeCapStack(stack, max) {
  return typeof stack === 'string' && stack.length > max ? stack.slice(0, max) : stack;
}

// { name, message, stack, cause? } of an Error. Error causes are expanded here (depth and cycles
// tracked on `chain`); a non-Error cause stays a value and goes through the replacer like any other.
function serializeError(err, depth, chain) {
  const out = { name: err.name, message: err.message, stack: undefined };
  out.stack = serializeCapStack(err.stack, depth === 0 ? SERIALIZE_STACK_MAX : SERIALIZE_CAUSE_STACK_MAX);
  let cause;
  try {
    if (!('cause' in err)) return out;
    cause = err.cause;
  } catch {
    return out;
  }
  if (!serializeIsError(cause)) {
    out.cause = cause;
  } else if (chain.includes(cause)) {
    out.cause = '[Circular]';
  } else if (depth + 1 > SERIALIZE_CAUSE_DEPTH) {
    out.cause = '[cause depth limit]';
  } else {
    chain.push(cause);
    out.cause = serializeError(cause, depth + 1, chain);
  }
  return out;
}

// JSON.stringify with a replacer that summarises functions, errors and DOM nodes.
// Cycles are detected on the ancestor stack: the replacer's `this` is the holder,
// so everything above it on the stack is a finished sibling subtree and is popped.
// A shared reference that is not its own ancestor is serialized every time (D13).
// Returns the JSON string, or throws (BigInt and friends) like JSON.stringify.
function serializeToJsonString(value, outerHtmlMax) {
  const ancestors = [];
  const ElementCtor = globalThis.Element;
  const NodeCtor = globalThis.Node;

  const replacer = function (_key, val) {
    let out = val;

    if (typeof val === 'function') {
      return `[Function: ${val.name || 'anonymous'}]`;
    }

    if (serializeIsError(val)) {
      out = serializeError(val, 0, [val]);
    } else if (typeof ElementCtor === 'function' && val instanceof ElementCtor) {
      out = {
        tagName: val.tagName,
        id: val.id,
        className: val.className,
        outerHTML: safeSlice(val.outerHTML, outerHtmlMax),
      };
    } else if (typeof NodeCtor === 'function' && val instanceof NodeCtor) {
      return `[Node: ${val.nodeName}]`;
    }

    if (typeof out === 'object' && out !== null) {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(out)) return '[Circular]';
      ancestors.push(out);
    }

    return out;
  };

  return JSON.stringify(value, replacer);
}

function serializeFailure(value, err) {
  let fallback;
  try {
    fallback = String(value);
  } catch {
    fallback = Object.prototype.toString.call(value);
  }
  return {
    serializationError: err?.message || 'Unknown serialization error',
    fallback,
  };
}

export function safeJson(value, { outerHtmlMax = 2000 } = {}) {
  try {
    return JSON.parse(serializeToJsonString(value, outerHtmlMax));
  } catch (err) {
    return serializeFailure(value, err);
  }
}

// Serializes `value` (safeJson rules) for a buffer entry. Within `maxChars`
// the parsed value is returned; above it, `{ truncated: true, preview }` with the
// first `maxChars` characters of the JSON. `chars` is the JSON length of `value`.
export function serializeCapped(value, maxChars, { outerHtmlMax = 2000 } = {}) {
  let json;
  try {
    json = serializeToJsonString(value, outerHtmlMax);
  } catch (err) {
    json = JSON.stringify(serializeFailure(value, err));
  }
  if (json === undefined) json = 'null';

  if (json.length <= maxChars) {
    return { value: JSON.parse(json), chars: json.length, truncated: false };
  }
  const capped = { truncated: true, preview: json.slice(0, maxChars) };
  return { value: capped, chars: JSON.stringify(capped).length, truncated: true };
}
