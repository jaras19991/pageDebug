// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installStepsHook, captureStepsIntrinsics, STEP_TEXT_MAX_CHARS } from '../../src/page/hooks-steps.js';
import { createSelectorOf, captureSelectorIntrinsics } from '../../src/page/selector.js';

// E2-T5b (D4, AC-3.1, AC-3.3–3.5, AC-3.7): user steps recorder in MAIN.
// jsdom marks every dispatched event `isTrusted: false` (own, non-configurable), so the tests inject a trust
// predicate: events are trusted unless flagged with `pdsUntrusted`.

const { window, document, history, History } = globalThis;

let records;
let restore;
let clock;

const trusted = (event) => !event.pdsUntrusted;

function install({ isTrusted = trusted, extra = {} } = {}) {
  records = [];
  clock = 1000;
  const intrinsics = {
    ...captureSelectorIntrinsics(window),
    ...captureStepsIntrinsics(window),
    isTrusted,
    ...extra,
  };
  restore = installStepsHook({
    win: window,
    doc: document,
    now: () => (clock += 100),
    record: (section, entry) => records.push({ section, entry }),
    selectorOf: createSelectorOf({ doc: document, intrinsics }),
    intrinsics,
  });
  return restore;
}

const steps = () => records.map((r) => r.entry);
const nonNavigate = () => steps().filter((s) => s.type !== 'navigate');

function fire(el, type, init = {}, Ctor = window.Event) {
  const event = new Ctor(type, { bubbles: true, cancelable: true, ...init });
  return el.dispatchEvent(event);
}

function typeInto(el, text) {
  for (const ch of text) {
    if (el.isContentEditable || el.getAttribute('contenteditable') !== null) el.textContent += ch;
    else el.value += ch;
    fire(el, 'input', {}, window.InputEvent);
  }
}

beforeEach(() => {
  document.body.innerHTML = `
    <form id="loginForm">
      <input type="email" id="email">
      <input type="password" id="pass">
      <input type="checkbox" data-testid="terms">
      <input type="radio" name="r" id="r1">
      <select id="sel"><option value="a">a</option><option value="long-value">b</option></select>
      <textarea id="ta"></textarea>
      <input type="submit" id="go" value="Wyślij formularz">
      <input type="file" id="file">
    </form>
    <button id="login" aria-label="Zaloguj">  <span id="inner">ikonka</span> </button>
    <button id="long">${'x'.repeat(200)}</button>
    <a href="#anchor" id="link">  Pomoc\n   i   kontakt </a>
    <div role="button" id="rb">Rola przycisku</div>
    <div id="plain">Zwykły div z tekstem</div>
    <div contenteditable="true" id="ce"></div>
  `;
});

afterEach(() => {
  if (restore) restore();
  restore = null;
  document.body.innerHTML = '';
});

describe('installStepsHook', () => {
  it('records a navigate step at install', () => {
    install();
    expect(records[0].section).toBe('steps');
    expect(records[0].entry).toMatchObject({ type: 'navigate', url: window.location.href, via: 'navigate' });
    expect(typeof records[0].entry.t).toBe('number');
    expect(records[0].entry).not.toHaveProperty('selector');
  });

  it('click on button records selector and text ≤ 80; click on input has no text', () => {
    install();
    fire(document.getElementById('inner'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('long'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('link'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('rb'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('go'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('email'), 'click', {}, window.MouseEvent);
    fire(document.getElementById('plain'), 'click', {}, window.MouseEvent);
    // The submit button's activation also submits the form (a separate `submit` step).
    expect(nonNavigate().map((s) => s.type)).toEqual(['click', 'click', 'click', 'click', 'click', 'submit', 'click', 'click']);
    const clicks = nonNavigate().filter((s) => s.type === 'click');
    expect(clicks[0]).toMatchObject({ selector: '#login', text: 'Zaloguj' });
    expect(clicks[1].text).toHaveLength(STEP_TEXT_MAX_CHARS);
    expect(STEP_TEXT_MAX_CHARS).toBe(80);
    expect(clicks[2]).toMatchObject({ selector: '#link', text: 'Pomoc i kontakt' });
    expect(clicks[3]).toMatchObject({ selector: '#rb', text: 'Rola przycisku' });
    expect(clicks[4]).toMatchObject({ selector: '#go', text: 'Wyślij formularz' });
    expect(clicks[5]).toEqual({ t: expect.any(Number), type: 'click', selector: '#email' });
    expect(clicks[6]).toEqual({ t: expect.any(Number), type: 'click', selector: '#plain' });
  });

  it('typing 18 chars into email field gives one input step with valueLength 18', () => {
    install();
    const email = document.getElementById('email');
    const first = clock;
    typeInto(email, 'jan.kowal@mail.com');
    expect(email.value).toHaveLength(18);
    const inputs = nonNavigate();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({ t: first + 100, type: 'input', selector: '#email', inputType: 'email', valueLength: 18 });
  });

  it('another step between inputs starts a new input step', () => {
    install();
    const email = document.getElementById('email');
    typeInto(email, 'ab');
    fire(email, 'keydown', { key: 'Tab' }, window.KeyboardEvent);
    typeInto(email, 'c');
    typeInto(document.getElementById('ta'), 'xyz');
    expect(nonNavigate().map((s) => [s.type, s.valueLength])).toEqual([
      ['input', 2],
      ['key', undefined],
      ['input', 3],
      ['input', 3],
    ]);
    expect(nonNavigate()[3].inputType).toBe('textarea');
  });

  it('password input step has inputType only; no value or valueLength anywhere', () => {
    install();
    const pass = document.getElementById('pass');
    typeInto(pass, 'Sekret123!');
    fire(pass, 'change');
    const json = JSON.stringify(records);
    expect(json).not.toContain('Sekret123!');
    const inputs = nonNavigate();
    expect(inputs).toEqual([{ t: expect.any(Number), type: 'input', selector: '#pass', inputType: 'password' }]);
  });

  it('contenteditable step has no text content', () => {
    install();
    const ce = document.getElementById('ce');
    typeInto(ce, 'tajny tekst');
    const inputs = nonNavigate();
    expect(inputs).toEqual([{ t: expect.any(Number), type: 'input', selector: '#ce', inputType: 'contenteditable', valueLength: 11 }]);
    expect(JSON.stringify(records)).not.toContain('tajny');
  });

  it('no step ever carries a value field', () => {
    install();
    typeInto(document.getElementById('email'), 'jan@example.com');
    fire(document.getElementById('email'), 'change');
    const sel = document.getElementById('sel');
    sel.value = 'long-value';
    fire(sel, 'change');
    for (const step of steps()) expect(step).not.toHaveProperty('value');
    expect(JSON.stringify(records)).not.toContain('jan@example.com');
    expect(JSON.stringify(records)).not.toContain('long-value');
  });

  it('key steps only for Enter/Escape/Tab/arrows; letters never recorded', () => {
    install();
    const pass = document.getElementById('pass');
    for (const key of ['a', 'S', '1', '!', ' ', 'Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Shift']) {
      fire(pass, 'keydown', { key }, window.KeyboardEvent);
    }
    fire(pass, 'keydown', { key: 'Enter', repeat: true }, window.KeyboardEvent);
    const keys = nonNavigate();
    expect(keys.map((s) => s.key)).toEqual(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    expect(keys[0]).toEqual({ t: expect.any(Number), type: 'key', selector: '#pass', key: 'Enter' });
  });

  it('checkbox change records checked; select change records valueLength only', () => {
    install();
    const box = document.querySelector('[data-testid="terms"]');
    box.checked = true;
    fire(box, 'change');
    const radio = document.getElementById('r1');
    radio.checked = true;
    fire(radio, 'change');
    const sel = document.getElementById('sel');
    sel.value = 'long-value';
    fire(sel, 'change');
    fire(document.getElementById('email'), 'change');
    fire(document.getElementById('file'), 'change');
    expect(nonNavigate()).toEqual([
      { t: expect.any(Number), type: 'change', selector: 'input[data-testid="terms"]', inputType: 'checkbox', checked: true },
      { t: expect.any(Number), type: 'change', selector: '#r1', inputType: 'radio', checked: true },
      { t: expect.any(Number), type: 'change', selector: '#sel', inputType: 'select', valueLength: 10 },
      { t: expect.any(Number), type: 'change', selector: '#file', inputType: 'file', fileCount: 0 },
    ]);
  });

  it('file input event produces no step and never reads value (AC-3.4, E3-IN4)', () => {
    const file = document.getElementById('file');
    const reads = [];
    const valueGetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').get;
    install({
      extra: {
        getInputValue: function () {
          reads.push(this);
          return valueGetter.call(this);
        },
      },
    });
    fire(file, 'input', {}, window.InputEvent);
    fire(file, 'input', {}, window.InputEvent);
    expect(nonNavigate()).toEqual([]);
    expect(reads).not.toContain(file);
    // A text field typed right after still opens its own input step (coalescing untouched).
    typeInto(document.getElementById('email'), 'ab');
    expect(nonNavigate()).toEqual([
      { t: expect.any(Number), type: 'input', selector: '#email', inputType: 'email', valueLength: 2 },
    ]);
    expect(reads).not.toContain(file);
  });

  it('file change records fileCount 2 and no valueLength, no names (AC-3.4, E3-IN4)', () => {
    const file = document.getElementById('file');
    const reads = [];
    const fakeFiles = { length: 2, 0: { name: 'tajny-umowa.pdf' }, 1: { name: 'C:\\fakepath\\skan.png' } };
    install({
      extra: {
        getFiles: function () {
          return this === file ? fakeFiles : null;
        },
        getInputValue: function () {
          reads.push(this);
          return 'C:\\fakepath\\skan.png';
        },
      },
    });
    fire(file, 'change');
    const changes = nonNavigate();
    expect(changes).toEqual([{ t: expect.any(Number), type: 'change', selector: '#file', inputType: 'file', fileCount: 2 }]);
    expect('valueLength' in changes[0]).toBe(false);
    expect(reads).toEqual([]);
    const json = JSON.stringify(records);
    for (const trap of ['tajny', 'fakepath', 'skan', '.pdf']) expect(json).not.toContain(trap);
  });

  it('file change without a files list records fileCount 0', () => {
    install({ extra: { getFiles: () => undefined } });
    fire(document.getElementById('file'), 'change');
    expect(nonNavigate()).toEqual([{ t: expect.any(Number), type: 'change', selector: '#file', inputType: 'file', fileCount: 0 }]);
  });

  it('other input types unchanged by the file rules (regression E3-IN4)', () => {
    install();
    typeInto(document.getElementById('email'), 'abc');
    typeInto(document.getElementById('ta'), 'xy');
    const box = document.querySelector('[data-testid="terms"]');
    box.checked = true;
    fire(box, 'change');
    const sel = document.getElementById('sel');
    sel.value = 'long-value';
    fire(sel, 'change');
    expect(nonNavigate()).toEqual([
      { t: expect.any(Number), type: 'input', selector: '#email', inputType: 'email', valueLength: 3 },
      { t: expect.any(Number), type: 'input', selector: '#ta', inputType: 'textarea', valueLength: 2 },
      { t: expect.any(Number), type: 'change', selector: 'input[data-testid="terms"]', inputType: 'checkbox', checked: true },
      { t: expect.any(Number), type: 'change', selector: '#sel', inputType: 'select', valueLength: 10 },
    ]);
  });

  it('checkbox/radio: input event adds no step, change carries checked only, never valueLength (QA F-5)', () => {
    install();
    const box = document.querySelector('[data-testid="terms"]');
    box.checked = true;
    fire(box, 'input');
    fire(box, 'change');
    const radio = document.getElementById('r1');
    radio.checked = true;
    fire(radio, 'input');
    fire(radio, 'change');
    const steps = nonNavigate();
    expect(steps).toEqual([
      { t: expect.any(Number), type: 'change', selector: 'input[data-testid="terms"]', inputType: 'checkbox', checked: true },
      { t: expect.any(Number), type: 'change', selector: '#r1', inputType: 'radio', checked: true },
    ]);
    for (const s of steps) expect('valueLength' in s).toBe(false);
  });

  it('typing after a checkbox input still opens a new input step for the text field (QA F-5)', () => {
    install();
    const box = document.querySelector('[data-testid="terms"]');
    fire(box, 'input');
    const email = document.getElementById('email');
    email.value = 'ab';
    fire(email, 'input');
    expect(nonNavigate()).toEqual([
      { t: expect.any(Number), type: 'input', selector: expect.any(String), inputType: 'email', valueLength: 2 },
    ]);
  });

  it('submit records form selector', () => {
    install();
    const form = document.getElementById('loginForm');
    form.addEventListener('submit', (e) => e.preventDefault());
    fire(form, 'submit');
    expect(nonNavigate()).toEqual([{ t: expect.any(Number), type: 'submit', selector: '#loginForm' }]);
  });

  it('pushState/replaceState/popstate/hashchange record navigate with url and via', () => {
    install();
    const base = window.location.href;
    history.pushState({ a: 1 }, '', '/steps/one');
    history.replaceState(null, '', '/steps/two');
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
    clock += 1000;
    history.pushState(null, '', '#frag');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    const navs = steps().filter((s) => s.type === 'navigate').slice(1);
    const origin = window.location.origin;
    expect(navs.map((s) => [s.via, s.url])).toEqual([
      ['pushState', origin + '/steps/one'],
      ['replaceState', origin + '/steps/two'],
      ['popstate', origin + '/steps/two'],
      ['pushState', origin + '/steps/two#frag'],
      ['hashchange', origin + '/steps/two#frag'],
    ]);
    expect(history.state).toBe(null);
    history.replaceState(null, '', base);
  });

  it('search-as-you-type: 18 chars with replaceState ?q= give 1 input + 1 navigate (AC-3.3)', () => {
    install();
    const base = window.location.href;
    const email = document.getElementById('email');
    const text = 'jan.kowal@mail.com';
    for (const ch of text) {
      email.value += ch;
      fire(email, 'input', {}, window.InputEvent);
      history.replaceState(null, '', '/search?q=' + encodeURIComponent(email.value));
    }
    const after = nonNavigate();
    const navs = steps().filter((s) => s.type === 'navigate').slice(1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ type: 'input', valueLength: 18 });
    expect(navs).toHaveLength(1);
    expect(navs[0]).toMatchObject({ via: 'replaceState', url: window.location.origin + '/search?q=' + encodeURIComponent(text) });
    expect(navs[0].t).toBe(clock);
    history.replaceState(null, '', base);
  });

  it('replaceState after another step is a new navigate step; pushState is never merged', () => {
    install();
    const base = window.location.href;
    history.replaceState(null, '', '/a');
    history.replaceState(null, '', '/b');
    fire(document.getElementById('login'), 'click', {}, window.MouseEvent);
    history.replaceState(null, '', '/c');
    history.pushState(null, '', '/d');
    history.pushState(null, '', '/e');
    const origin = window.location.origin;
    expect(steps().slice(1).map((s) => [s.type, s.via, s.url])).toEqual([
      ['navigate', 'replaceState', origin + '/b'],
      ['click', undefined, undefined],
      ['navigate', 'replaceState', origin + '/c'],
      ['navigate', 'pushState', origin + '/d'],
      ['navigate', 'pushState', origin + '/e'],
    ]);
    history.replaceState(null, '', base);
  });

  it('navigate url is masked: access_token in the fragment and query never appears in plain text', () => {
    install();
    const base = window.location.href;
    history.pushState(null, '', '/cb?code=1&session=s3cr3tSess#access_token=SECRET123abc&state=x');
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    const navs = steps().filter((s) => s.type === 'navigate').slice(1);
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) {
      expect(nav.url).not.toContain('SECRET123abc');
      expect(nav.url).not.toContain('s3cr3tSess');
      expect(nav.url).toContain('access_token=[redacted:key-token]');
      expect(nav.url).toContain('code=[redacted:key-code]'); // E3-PD2: code is sensitive in any URL, also in MAIN
    }
    history.replaceState(null, '', base);
  });

  it('navigate with the same url within 50 ms is skipped', () => {
    records = [];
    let t = 0;
    const intrinsics = { ...captureSelectorIntrinsics(window), ...captureStepsIntrinsics(window), isTrusted: trusted };
    restore = installStepsHook({
      win: window,
      doc: document,
      now: () => (t += 10),
      record: (section, entry) => records.push({ section, entry }),
      selectorOf: createSelectorOf({ doc: document, intrinsics }),
      intrinsics,
    });
    const base = window.location.href;
    history.pushState(null, '', '/dup');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    expect(steps().filter((s) => s.type === 'navigate').map((s) => s.via)).toEqual(['navigate', 'pushState']);
    history.replaceState(null, '', base);
  });

  it('pushState calls the original exactly once with the same this and arguments', () => {
    const original = History.prototype.pushState;
    const calls = [];
    History.prototype.pushState = function (...args) {
      calls.push({ self: this, args });
      return original.apply(this, args);
    };
    try {
      install();
      const ret = history.pushState({ k: 1 }, 't', '/once');
      expect(ret).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(calls[0].self).toBe(history);
      expect(calls[0].args).toEqual([{ k: 1 }, 't', '/once']);
      restore();
      restore = null;
    } finally {
      History.prototype.pushState = original;
      history.replaceState(null, '', '/');
    }
  });

  it('pushState that throws propagates and records no step', () => {
    install();
    const before = records.length;
    expect(() => history.pushState(null, '', 'https://other.example/x')).toThrow();
    expect(records).toHaveLength(before);
  });

  it('untrusted events ignored', () => {
    install({ isTrusted: (e) => e.isTrusted === true });
    fire(document.getElementById('login'), 'click', {}, window.MouseEvent);
    typeInto(document.getElementById('email'), 'abc');
    fire(document.getElementById('pass'), 'keydown', { key: 'Enter' }, window.KeyboardEvent);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    expect(nonNavigate()).toEqual([]);
    expect(steps()).toHaveLength(1);
  });

  it('default trust predicate reads event.isTrusted (jsdom events are untrusted)', () => {
    records = [];
    const intrinsics = { ...captureSelectorIntrinsics(window), ...captureStepsIntrinsics(window) };
    restore = installStepsHook({
      win: window,
      doc: document,
      now: () => 1,
      record: (section, entry) => records.push({ section, entry }),
      selectorOf: createSelectorOf({ doc: document, intrinsics }),
      intrinsics,
    });
    fire(document.getElementById('login'), 'click', {}, window.MouseEvent);
    expect(nonNavigate()).toEqual([]);
  });

  it('page handler stopPropagation/preventDefault unaffected; defaultPrevented same with and without hook', () => {
    const run = () => {
      const order = [];
      const btn = document.getElementById('login');
      const onBtn = (e) => {
        order.push('target');
        e.preventDefault();
        e.stopPropagation();
      };
      const onWin = () => order.push('window-bubble');
      const onDocCapture = () => order.push('document-capture');
      btn.addEventListener('click', onBtn);
      window.addEventListener('click', onWin);
      document.addEventListener('click', onDocCapture, true);
      const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
      const notCancelled = btn.dispatchEvent(event);
      btn.removeEventListener('click', onBtn);
      window.removeEventListener('click', onWin);
      document.removeEventListener('click', onDocCapture, true);
      return { order, notCancelled, defaultPrevented: event.defaultPrevented, isTrusted: event.isTrusted };
    };
    const without = run();
    install();
    const withHook = run();
    expect(withHook).toEqual(without);
    expect(withHook.order).toEqual(['document-capture', 'target']);
    expect(withHook.defaultPrevented).toBe(true);
    expect(nonNavigate()).toHaveLength(1);
  });

  it('listeners are capture and passive on window', () => {
    const added = [];
    const add = window.addEventListener;
    install({
      extra: {
        addEventListener: function (type, fn, opts) {
          added.push({ self: this, type, opts });
          return add.call(this, type, fn, opts);
        },
      },
    });
    const types = added.map((a) => a.type).sort();
    expect(types).toEqual(['change', 'click', 'hashchange', 'input', 'keydown', 'popstate', 'submit']);
    for (const a of added) {
      expect(a.self).toBe(window);
      expect(a.opts).toEqual({ capture: true, passive: true });
    }
  });

  it('record failures and selector failures are swallowed', () => {
    const intrinsics = { ...captureSelectorIntrinsics(window), ...captureStepsIntrinsics(window), isTrusted: trusted };
    restore = installStepsHook({
      win: window,
      doc: document,
      now: () => 1,
      record: () => {
        throw new Error('boom');
      },
      selectorOf: () => {
        throw new Error('sel');
      },
      intrinsics,
    });
    expect(() => fire(document.getElementById('login'), 'click', {}, window.MouseEvent)).not.toThrow();
    expect(() => history.pushState(null, '', '/swallow')).not.toThrow();
    history.replaceState(null, '', '/');
  });

  it('second install in the same window is a no-op', () => {
    install();
    const r2 = installStepsHook({
      win: window,
      doc: document,
      now: () => 1,
      record: (section, entry) => records.push({ section, entry, second: true }),
      selectorOf: () => '#x',
      intrinsics: { isTrusted: trusted },
    });
    fire(document.getElementById('login'), 'click', {}, window.MouseEvent);
    expect(records.filter((r) => r.second)).toEqual([]);
    r2();
  });

  it('restore removes listeners and puts back History methods (===)', () => {
    const push = History.prototype.pushState;
    const replace = History.prototype.replaceState;
    install();
    expect(History.prototype.pushState).not.toBe(push);
    expect(History.prototype.replaceState).not.toBe(replace);
    restore();
    restore = null;
    expect(History.prototype.pushState).toBe(push);
    expect(History.prototype.replaceState).toBe(replace);
    const before = records.length;
    fire(document.getElementById('login'), 'click', {}, window.MouseEvent);
    history.pushState(null, '', '/after');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    expect(records).toHaveLength(before);
    history.replaceState(null, '', '/');
  });

  it('restore leaves a later page patch of History methods in place', () => {
    const push = History.prototype.pushState;
    install();
    const pagePatch = function () {};
    History.prototype.pushState = pagePatch;
    const ours = History.prototype.replaceState;
    restore();
    restore = null;
    expect(History.prototype.pushState).toBe(pagePatch);
    expect(History.prototype.replaceState).not.toBe(ours);
    History.prototype.pushState = push;
  });
});
