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
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) out.push(serializeCloneSourceValue(value[i]));
    return out;
  }
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

// Intrinsics captured when the module loads (bundle on document_start, E3-T0a, AC-3.6): a page that later swaps
// JSON, Object.keys or a prototype method (polyfills, hostile pages) does not change what we serialize.
const serializeJson = JSON;
const serializeStringify = JSON.stringify;
const serializeKeys = Object.keys;
const serializeIsArray = Array.isArray;
const serializeApply = Reflect.apply;
const serializeDefine = Object.defineProperty;
const serializeObjectToString = Object.prototype.toString;
const serializeStringSlice = String.prototype.slice;

// Stack limits for Error values (AC-4.8): the error itself keeps up to 16 000 chars, each cause up to 4000.
// Causes are followed up to SERIALIZE_CAUSE_DEPTH levels; a deeper one becomes a marker.
const SERIALIZE_STACK_MAX = 16000;
const SERIALIZE_CAUSE_STACK_MAX = 4000;
const SERIALIZE_CAUSE_DEPTH = 5;
// Element summaries get a structure of at most this many chars (E3-T3a provides the function).
const SERIALIZE_STRUCTURE_MAX = 2000;
// Returned by the walker for values JSON drops from objects (undefined, symbols).
const SERIALIZE_OMIT = {};

function serializeSlice(str, from, to) {
  return serializeApply(serializeStringSlice, str, [from, to]);
}

function serializeToJson(value) {
  return serializeApply(serializeStringify, serializeJson, [value]);
}

// Errors of same-origin frames come from another realm and fail `instanceof Error`; the built-in brand
// (`[object Error]`, captured at load) recognises them too (E2-D6).
function serializeIsError(value) {
  if (value instanceof Error) return true;
  if (value === null || typeof value !== 'object') return false;
  try {
    return serializeApply(serializeObjectToString, value, []) === '[object Error]';
  } catch {
    return false;
  }
}

function serializeCapStack(stack, max) {
  return typeof stack === 'string' && stack.length > max ? serializeSlice(stack, 0, max) : stack;
}

// { name, message, stack, cause? } of an Error. Error causes are expanded here (depth and cycles
// tracked on `chain`); a non-Error cause stays a value and goes through the walker like any other.
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

function serializeElement(el, elementStructure) {
  let structure = null;
  if (typeof elementStructure === 'function') {
    try {
      structure = elementStructure(el, SERIALIZE_STRUCTURE_MAX);
    } catch {
      structure = null;
    }
  }
  return { tagName: el.tagName, id: el.id, className: el.className, structure };
}

// Bounded walker (D9): builds a copy made of plain objects and arrays with JSON semantics (toJSON,
// undefined/symbols dropped or null, non-finite numbers → null, BigInt throws) plus the summaries of
// functions, errors and DOM nodes. `chars` is a lower bound of the JSON length of the copy (escapes are
// not counted); once it passes `maxChars` nothing more is read, and a long string is sliced before it
// is copied. Cycles are detected on the ancestor path; a shared reference that is not its own ancestor
// is copied every time (D13).
function serializeWalk(value, maxChars, elementStructure) {
  const ancestors = [];
  const ElementCtor = globalThis.Element;
  const NodeCtor = globalThis.Node;
  let chars = 0;
  let exhausted = false;

  const charge = (n) => {
    chars += n;
    if (chars > maxChars) exhausted = true;
  };

  const copyString = (str) => {
    // Chars left after the opening quote; a cut string runs one char past the budget, so the first
    // `maxChars` chars of the copy's JSON match the full JSON.
    const room = maxChars - chars - 1;
    if (str.length + 1 > room) {
      const cut = serializeSlice(str, 0, room > 0 ? room + 1 : 1);
      charge(cut.length + 2);
      exhausted = true;
      return cut;
    }
    charge(str.length + 2);
    return str;
  };

  const copyObject = (val, source) => {
    const out = {};
    charge(2);
    const keys = serializeKeys(source);
    let count = 0;
    for (let i = 0; i < keys.length && !exhausted; i++) {
      const key = keys[i];
      const item = walk(source[key], key);
      if (item === SERIALIZE_OMIT) continue;
      charge(key.length + 3 + (count > 0 ? 1 : 0));
      count++;
      if (key === '__proto__') {
        serializeDefine(out, key, { value: item, enumerable: true, writable: true, configurable: true });
      } else {
        out[key] = item;
      }
    }
    return out;
  };

  const copyArray = (val) => {
    const out = [];
    charge(2);
    const length = val.length;
    for (let i = 0; i < length && !exhausted; i++) {
      if (i > 0) charge(1);
      const item = walk(val[i], '' + i);
      if (item === SERIALIZE_OMIT) {
        charge(4);
        out.push(null);
      } else {
        out.push(item);
      }
    }
    return out;
  };

  function walk(input, key) {
    let val = input;
    if (val !== null && (typeof val === 'object' || typeof val === 'bigint')) {
      const toJSON = val.toJSON;
      if (typeof toJSON === 'function') val = serializeApply(toJSON, val, [key]);
    }

    switch (typeof val) {
      case 'string':
        return copyString(val);
      case 'number':
        if (val !== val || val === Infinity || val === -Infinity) {
          charge(4);
          return null;
        }
        charge(('' + val).length);
        return val;
      case 'boolean':
        charge(val ? 4 : 5);
        return val;
      case 'undefined':
      case 'symbol':
        return SERIALIZE_OMIT;
      case 'bigint':
        throw new TypeError('Do not know how to serialize a BigInt');
      case 'function':
        return copyString(`[Function: ${val.name || 'anonymous'}]`);
      default:
        break;
    }
    if (val === null) {
      charge(4);
      return null;
    }

    if (ancestors.includes(val)) return copyString('[Circular]');
    let source = val;
    if (serializeIsError(val)) {
      source = serializeError(val, 0, [val]);
    } else if (typeof ElementCtor === 'function' && val instanceof ElementCtor) {
      source = serializeElement(val, elementStructure);
    } else if (typeof NodeCtor === 'function' && val instanceof NodeCtor) {
      return copyString(`[Node: ${val.nodeName}]`);
    }

    ancestors.push(val);
    try {
      return source === val && serializeIsArray(val) ? copyArray(val) : copyObject(val, source);
    } finally {
      ancestors.pop();
    }
  }

  let copy = walk(value, '');
  if (copy === SERIALIZE_OMIT) {
    copy = null;
    charge(4);
  }
  return { value: copy, exhausted };
}

function serializeFailure(value, err) {
  let fallback;
  try {
    fallback = String(value);
  } catch {
    fallback = serializeApply(serializeObjectToString, value, []);
  }
  return {
    serializationError: err?.message || 'Unknown serialization error',
    fallback,
  };
}

// Plain copy of `value` under the safeJson rules, read only up to about `maxChars` JSON chars.
// Returns `{ value, exhausted }`; `exhausted` means the JSON of `value` is longer than `maxChars`
// and the copy is partial. Throws like JSON.stringify (BigInt).
export function toPlain(value, { maxChars = Infinity, elementStructure = null } = {}) {
  return serializeWalk(value, maxChars, elementStructure);
}

export function safeJson(value, { elementStructure = null } = {}) {
  try {
    return serializeWalk(value, Infinity, elementStructure).value;
  } catch (err) {
    return serializeFailure(value, err);
  }
}

// Serializes `value` (safeJson rules) for a buffer entry. Within `maxChars`
// the plain copy is returned; above it, `{ truncated: true, preview }` with the
// first `maxChars` characters of the JSON. `chars` is the JSON length of `value`
// (of the capped object when truncated). The cost depends on `maxChars`, not on
// the size of `value` (D9, AC-6.5).
export function serializeCapped(value, maxChars, { elementStructure = null } = {}) {
  let copy;
  let exhausted = false;
  try {
    ({ value: copy, exhausted } = serializeWalk(value, maxChars, elementStructure));
  } catch (err) {
    copy = serializeFailure(value, err);
  }
  const json = serializeToJson(copy);

  if (!exhausted && json.length <= maxChars) {
    return { value: copy, chars: json.length, truncated: false };
  }
  const capped = { truncated: true, preview: serializeSlice(json, 0, maxChars) };
  return { value: capped, chars: serializeToJson(capped).length, truncated: true };
}
