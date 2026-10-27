// User steps recorder for the MAIN-world recorder (design D4, E2-T5b, AC-3.1, AC-3.3–3.5, AC-3.7).
// Capture-phase, passive listeners on window (added at document_start, so they run before page handlers and
// never change propagation or defaultPrevented); a Proxy `apply` on History.prototype.pushState/replaceState.
// Privacy at the source: no field value is ever read into a record — only `inputType`, `valueLength`, `checked`,
// a whitelisted `key` and a short label of clicked buttons/links. Only trusted events are recorded.
// File inputs (E3-IN4, AC-3.4): their `value` (`C:\fakepath\…`) is never read; `input` adds no step and `change`
// records only `fileCount`.
// Navigate URLs are masked (maskSecrets) before they reach a record; consecutive replaceState calls with no
// other step in between are one step (search-as-you-type, AC-3.3).
// Top-level helpers carry the `steps` prefix (D6: all page modules end up in one IIFE).
// Index loops only, no for…of or array destructuring (E4-IN2): the page may replace Array.prototype[Symbol.iterator].

import { maskSecrets, redactRegExp, redactReplace } from '../lib/mask-secrets.js';

export const STEP_TEXT_MAX_CHARS = 80;
export const STEP_URL_MAX_CHARS = 4000;

// Same URL navigated again within this window is one step (popstate + hashchange of one jump, D4).
const STEPS_NAVIGATE_DEDUP_MS = 50;
// textContent read before whitespace normalization (labels of huge elements).
const STEPS_TEXT_SCAN_CHARS = 2000;
// Whitespace runs of a label; replaced through the captured RegExp functions (page patches, AC-3.6).
const STEPS_WHITESPACE = redactRegExp(/\s+/g);

const STEPS_CLICKABLE = 'a, button, [role=button], input, select, textarea, label, summary, [onclick]';
const STEPS_LABELLED_INPUTS = ['submit', 'button', 'reset'];
const STEPS_CHANGE_INPUTS = ['checkbox', 'radio', 'file'];
const STEPS_KEYS = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const STEPS_LISTENER_OPTIONS = { capture: true, passive: true };
const STEPS_NAVIGATION_TYPES = ['navigate', 'reload', 'back_forward'];

// win -> true while installed; a second install in the same window is a no-op.
const stepsActive = new WeakMap();

function stepsGetter(ctor, name) {
  try {
    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, name);
    return desc && typeof desc.get === 'function' ? desc.get : undefined;
  } catch {
    return undefined;
  }
}

function stepsTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// Everything the handlers touch on events and elements, captured before page scripts run.
export function captureStepsIntrinsics(win) {
  const element = stepsTry(() => win.Element.prototype, {});
  const perf = stepsTry(() => win.performance, null);
  return {
    apply: Reflect.apply,
    Proxy,
    // Looked up on the window (at document_start: the EventTarget.prototype methods).
    addEventListener: stepsTry(() => win.addEventListener, undefined),
    removeEventListener: stepsTry(() => win.removeEventListener, undefined),
    closest: element.closest,
    getAttribute: element.getAttribute,
    getTagName: stepsGetter(win.Element, 'tagName'),
    getEventTarget: stepsGetter(win.Event, 'target'),
    getKey: stepsGetter(win.KeyboardEvent, 'key'),
    getRepeat: stepsGetter(win.KeyboardEvent, 'repeat'),
    getInputType: stepsGetter(win.HTMLInputElement, 'type'),
    getInputValue: stepsGetter(win.HTMLInputElement, 'value'),
    getChecked: stepsGetter(win.HTMLInputElement, 'checked'),
    getFiles: stepsGetter(win.HTMLInputElement, 'files'),
    getTextareaValue: stepsGetter(win.HTMLTextAreaElement, 'value'),
    getSelectValue: stepsGetter(win.HTMLSelectElement, 'value'),
    getTextContent: stepsGetter(win.Node, 'textContent'),
    getIsContentEditable: stepsGetter(win.HTMLElement, 'isContentEditable'),
    Element: win.Element,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLSelectElement: win.HTMLSelectElement,
    HTMLFormElement: win.HTMLFormElement,
    History: win.History,
    navigationType: stepsTry(() => perf.getEntriesByType('navigation')[0].type, undefined),
  };
}

export function installStepsHook({ win, doc: _doc, now, record, selectorOf, intrinsics = {} }) {
  if (stepsActive.get(win)) return () => {};
  const I = { ...captureStepsIntrinsics(win), ...intrinsics };
  const call = (fn, self, ...args) => I.apply(fn, self, args);
  // Getter through the captured intrinsic; plain property read when the intrinsic does not exist here.
  const read = (getter, self, name) => (getter ? call(getter, self) : self[name]);
  const isTrusted = typeof I.isTrusted === 'function' ? I.isTrusted : (event) => event.isTrusted === true;
  const add = I.addEventListener || win.addEventListener;
  const remove = I.removeEventListener || win.removeEventListener;

  let active = true;
  // Last recorded `input` step and its element (AC-3.3); any other step ends the coalescing.
  let lastInput = null;
  let lastNavigate = null;
  // Last recorded entry of any type: a replaceState right after a replaceState step updates that step.
  let lastEntry = null;

  const is = (value, Ctor) => !!Ctor && value instanceof Ctor;
  const attr = (el, name) => call(I.getAttribute, el, name);
  const tagOf = (el) => String(read(I.getTagName, el, 'tagName')).toLowerCase();

  function emit(entry, { keepInput = false } = {}) {
    if (!keepInput) lastInput = null;
    lastEntry = entry;
    record('steps', entry);
  }

  function withSelector(entry, el) {
    const selector = stepsTry(() => selectorOf(el), null);
    if (typeof selector === 'string') entry.selector = selector;
    return entry;
  }

  function normalizedText(value) {
    if (typeof value !== 'string') return '';
    const text = redactReplace(value.slice(0, STEPS_TEXT_SCAN_CHARS), STEPS_WHITESPACE, ' ').trim();
    return text.length > STEP_TEXT_MAX_CHARS ? text.slice(0, STEP_TEXT_MAX_CHARS) : text;
  }

  // Visible label of buttons and links only (AC-3.5); form fields never get `text`.
  function labelOf(el) {
    if (is(el, I.HTMLInputElement)) {
      const type = String(read(I.getInputType, el, 'type'));
      return STEPS_LABELLED_INPUTS.includes(type) ? normalizedText(attr(el, 'value')) : '';
    }
    const tag = tagOf(el);
    if (tag !== 'a' && tag !== 'button' && attr(el, 'role') !== 'button') return '';
    return normalizedText(attr(el, 'aria-label')) || normalizedText(read(I.getTextContent, el, 'textContent'));
  }

  function editableHost(el) {
    if (!is(el, I.Element)) return null;
    if (I.getIsContentEditable && call(I.getIsContentEditable, el) === true) return el;
    const host = call(I.closest, el, '[contenteditable]');
    if (!host) return null;
    const flag = String(attr(host, 'contenteditable')).toLowerCase();
    return flag === '' || flag === 'true' || flag === 'plaintext-only' ? host : null;
  }

  // { el, inputType, valueLength? } of an input target (null for none/checkbox/radio); never the value itself.
  function fieldOf(target) {
    if (is(target, I.HTMLInputElement)) {
      const inputType = String(read(I.getInputType, target, 'type'));
      if (inputType === 'password') return { el: target, inputType };
      // File: the change step carries `fileCount`; the value (a path) is never read (E3-IN4).
      if (inputType === 'file') return null;
      // Checkbox/radio: `value` is a fixed token ("on"), its length means nothing; the change step carries `checked` (QA F-5).
      if (inputType === 'checkbox' || inputType === 'radio') return null;
      return { el: target, inputType, valueLength: String(read(I.getInputValue, target, 'value')).length };
    }
    if (is(target, I.HTMLTextAreaElement)) {
      return { el: target, inputType: 'textarea', valueLength: String(read(I.getTextareaValue, target, 'value')).length };
    }
    if (is(target, I.HTMLSelectElement)) {
      return { el: target, inputType: 'select', valueLength: String(read(I.getSelectValue, target, 'value')).length };
    }
    const host = editableHost(target);
    if (!host) return null;
    const text = read(I.getTextContent, host, 'textContent');
    return { el: host, inputType: 'contenteditable', valueLength: typeof text === 'string' ? text.length : 0 };
  }

  const targetOf = (event) => read(I.getEventTarget, event, 'target');

  function onClick(event, t) {
    const target = targetOf(event);
    if (!is(target, I.Element)) return;
    const el = call(I.closest, target, STEPS_CLICKABLE) || target;
    const entry = withSelector({ t, type: 'click' }, el);
    const text = labelOf(el);
    if (text) entry.text = text;
    emit(entry);
  }

  function onInput(event, t) {
    const field = fieldOf(targetOf(event));
    if (!field) return;
    if (lastInput && lastInput.el === field.el) {
      if (field.valueLength !== undefined) lastInput.entry.valueLength = field.valueLength;
      return;
    }
    const entry = withSelector({ t, type: 'input' }, field.el);
    entry.inputType = field.inputType;
    if (field.valueLength !== undefined) entry.valueLength = field.valueLength;
    emit(entry);
    lastInput = { el: field.el, entry };
  }

  function onChange(event, t) {
    const target = targetOf(event);
    let entry = null;
    if (is(target, I.HTMLInputElement)) {
      const inputType = String(read(I.getInputType, target, 'type'));
      if (!STEPS_CHANGE_INPUTS.includes(inputType)) return;
      entry = withSelector({ t, type: 'change' }, target);
      entry.inputType = inputType;
      if (inputType === 'file') {
        const files = read(I.getFiles, target, 'files');
        const count = files ? files.length : 0;
        entry.fileCount = typeof count === 'number' && count >= 0 ? count : 0;
      } else {
        entry.checked = read(I.getChecked, target, 'checked') === true;
      }
    } else if (is(target, I.HTMLSelectElement)) {
      entry = withSelector({ t, type: 'change' }, target);
      entry.inputType = 'select';
      entry.valueLength = String(read(I.getSelectValue, target, 'value')).length;
    }
    if (entry) emit(entry);
  }

  function onSubmit(event, t) {
    const target = targetOf(event);
    if (is(target, I.HTMLFormElement)) emit(withSelector({ t, type: 'submit' }, target));
  }

  function onKeydown(event, t) {
    const key = read(I.getKey, event, 'key');
    if (!STEPS_KEYS.includes(key) || read(I.getRepeat, event, 'repeat') === true) return;
    const entry = withSelector({ t, type: 'key' }, targetOf(event));
    entry.key = key;
    emit(entry);
  }

  function navigate(via, t) {
    let url = maskSecrets(String(win.location.href).slice(0, STEP_URL_MAX_CHARS)).text;
    if (url.length > STEP_URL_MAX_CHARS) url = url.slice(0, STEP_URL_MAX_CHARS);
    if (lastNavigate && lastNavigate.url === url && t - lastNavigate.t <= STEPS_NAVIGATE_DEDUP_MS) return;
    lastNavigate = { url, t };
    const replace = via === 'replaceState';
    if (replace && lastEntry && lastEntry.type === 'navigate' && lastEntry.via === 'replaceState') {
      lastEntry.url = url;
      lastEntry.t = t;
      return;
    }
    // replaceState keeps the input coalescing: typing that rewrites `?q=` stays one input step.
    emit({ t, type: 'navigate', url, via }, { keepInput: replace });
  }

  const handlers = {
    click: onClick,
    input: onInput,
    change: onChange,
    submit: onSubmit,
    keydown: onKeydown,
    popstate: (_event, t) => navigate('popstate', t),
    hashchange: (_event, t) => navigate('hashchange', t),
  };
  const listeners = [];
  const types = Object.keys(handlers);
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const handler = handlers[type];
    const listener = function (event) {
      try {
        if (active && isTrusted(event)) handler(event, now());
      } catch {
        // never break the page's event dispatch
      }
    };
    listeners.push([type, listener]);
    call(add, win, type, listener, STEPS_LISTENER_OPTIONS);
  }

  // History methods: the original runs exactly once (its exception propagates), the step comes after.
  const historyProto = stepsTry(() => I.History.prototype, null);
  const patched = [];
  const historyMethods = ['pushState', 'replaceState'];
  for (let i = 0; i < historyMethods.length; i++) {
    const name = historyMethods[i];
    const original = stepsTry(() => historyProto[name], null);
    if (typeof original !== 'function') continue;
    const hook = new I.Proxy(original, {
      apply(target, self, args) {
        const result = I.apply(target, self, args);
        if (active) {
          try {
            navigate(name, now());
          } catch {
            // never break the page's navigation
          }
        }
        return result;
      },
    });
    const installed = stepsTry(() => {
      historyProto[name] = hook;
      return historyProto[name] === hook;
    }, false);
    if (installed) patched.push({ name, original, hook });
  }

  stepsActive.set(win, true);
  stepsTry(() => {
    const type = I.navigationType;
    navigate(STEPS_NAVIGATION_TYPES.includes(type) ? type : 'navigate', now());
  });

  return function restore() {
    if (!active) return;
    active = false;
    try {
      for (let i = 0; i < listeners.length; i++) {
        const type = listeners[i][0];
        const listener = listeners[i][1];
        stepsTry(() => call(remove, win, type, listener, STEPS_LISTENER_OPTIONS));
      }
      // Restore guard (E1 H2): only put the original back while our Proxy is still in place.
      for (let i = 0; i < patched.length; i++) {
        const { name, original, hook } = patched[i];
        stepsTry(() => {
          if (historyProto[name] === hook) historyProto[name] = original;
        });
      }
    } finally {
      stepsActive.delete(win);
      lastInput = null;
      lastEntry = null;
    }
  };
}
