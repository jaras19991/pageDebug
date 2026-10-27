// @vitest-environment node
// E3-T2b: redaction of the page sections — storage, cookies, DOM, environment, performance (D2, D4; AC-3.2, 3.3, 4.2, 4.4).
import { describe, it, expect } from 'vitest';
import { redactPageSections } from '../../src/lib/redact-page.js';
import { createRedactionContext, redact } from '../../src/lib/redact.js';
import { sha256Hex } from '../../src/lib/sha256.js';
import { JWT, TOKEN, EMAIL, PHONE, PASSWORD, COOKIE_SID, TRAPS, leaks, trapPackage } from './helpers/redaction-traps.js';

const noLeak = (value, secrets = TRAPS) => {
  const text = JSON.stringify(value);
  for (const secret of secrets) expect(leaks(secret, text), secret).toEqual([]);
};
const MASKED_URL = 'https://app.example.test/cb;jsessionid=[redacted:key-session]?access_token=[redacted:key-token]&page=2#[redacted:url-fragment]';

function page(options) {
  const pkg = trapPackage();
  const ctx = createRedactionContext(options);
  redactPageSections(pkg, ctx);
  return { pkg, ctx };
}

describe('storage (AC-3.2, question 7)', () => {
  const { pkg } = page();

  it('localStorage: secret key, JWT at a plain key, e-mail and phone inside a value; keys kept', () => {
    const local = pkg.storage.localStorage;
    noLeak(local);
    expect(Object.keys(local)).toEqual(['token', 'x', 'profile', 'theme']);
    expect(local.token).toBe('[redacted:key-token]');
    expect(local.x).toBe('[redacted:jwt]');
    expect(JSON.parse(local.profile)).toEqual({ mail: '[redacted:email]', tel: '[redacted:phone]' });
    expect(local.theme).toBe('dark');
  });

  it('sessionStorage', () => {
    const session = pkg.storage.sessionStorage;
    noLeak(session);
    expect(session['auth.state']).toBe('[redacted:key-auth]');
    expect(session.note).toBe('zadzwoń [redacted:phone]');
    expect(session.step).toBe('3');
  });

  it('__error stays as it is', () => {
    const p = { storage: { cookies: '', localStorage: { __error: 'The operation is insecure. token=abc' }, sessionStorage: {} } };
    redactPageSections(p, createRedactionContext());
    expect(p.storage.localStorage.__error).toBe('The operation is insecure. token=abc');
  });

  it('storage null stays null', () => {
    const p = { storage: null, dom: null, environment: null, performance: null };
    redactPageSections(p, createRedactionContext());
    expect(p).toEqual({ storage: null, dom: null, environment: null, performance: null });
  });
});

describe('cookies (AC-4.4, D4)', () => {
  it('cookies: [{name,sizeBytes,valueHash}] + cookiesTotalBytes right after cookies', () => {
    const { pkg } = page();
    noLeak(pkg.storage.cookies, [COOKIE_SID]);
    expect(Object.keys(pkg.storage)).toEqual(['cookies', 'cookiesTotalBytes', 'localStorage', 'sessionStorage']);
    expect(pkg.storage.cookies).toEqual([
      { name: 'sid', sizeBytes: 4 + COOKIE_SID.length, valueHash: sha256Hex(COOKIE_SID).slice(0, 8) },
      { name: 'theme', sizeBytes: 10, valueHash: sha256Hex('dark').slice(0, 8) },
      { name: 'consent', sizeBytes: 9, valueHash: sha256Hex('1').slice(0, 8) },
    ]);
    expect(pkg.storage.cookiesTotalBytes).toBe(`sid=${COOKIE_SID}; theme=dark; consent=1`.length);
  });

  it('vector "abc": valueHash = ba7816bf', () => {
    const p = { storage: { cookies: 'k=abc', localStorage: {}, sessionStorage: {} } };
    redactPageSections(p, createRedactionContext());
    expect(p.storage.cookies).toEqual([{ name: 'k', sizeBytes: 5, valueHash: 'ba7816bf' }]);
  });

  it('same value → same hash across packages; different → different', () => {
    const run = (cookies) => {
      const p = { storage: { cookies, localStorage: {}, sessionStorage: {} } };
      redactPageSections(p, createRedactionContext());
      return p.storage.cookies;
    };
    expect(run('sid=AAA111; a=1')[0].valueHash).toBe(run('b=2; sid=AAA111')[1].valueHash);
    expect(run('sid=AAA111')[0].valueHash).not.toBe(run('sid=AAA112')[0].valueHash);
  });

  it('UTF-8 sizes, value with "=", cookie without a name, empty string', () => {
    const p = { storage: { cookies: 'ł=źó; data=a=b==; bare', localStorage: {}, sessionStorage: {} } };
    redactPageSections(p, createRedactionContext());
    expect(p.storage.cookies).toEqual([
      { name: 'ł', sizeBytes: 2 + 1 + 4, valueHash: sha256Hex('źó').slice(0, 8) },
      { name: 'data', sizeBytes: 10, valueHash: sha256Hex('a=b==').slice(0, 8) },
      { name: '', sizeBytes: 4, valueHash: sha256Hex('bare').slice(0, 8) },
    ]);
    expect(p.storage.cookiesTotalBytes).toBe(7 + 2 + 10 + 2 + 4);
    const empty = { storage: { cookies: '', localStorage: {}, sessionStorage: {} } };
    redactPageSections(empty, createRedactionContext());
    expect(empty.storage).toEqual({ cookies: [], cookiesTotalBytes: 0, localStorage: {}, sessionStorage: {} });
  });
});

describe('dom (AC-3.2, spec "Dane")', () => {
  const { pkg } = page();
  const { dom } = pkg;

  it('forms: valueLength integer, none for password, no value key; action as URL', () => {
    const [email, password, terms] = dom.forms[0].elements;
    expect(email).toEqual({ tagName: 'INPUT', type: 'email', name: 'email', id: 'email', valueLength: EMAIL.length });
    expect(password).toEqual({ tagName: 'INPUT', type: 'password', name: 'password', id: 'pass' });
    expect(terms).toEqual({ tagName: 'INPUT', type: 'checkbox', name: 'terms', id: 'terms', valueLength: 2, checked: true });
    for (const el of dom.forms[0].elements) expect(el).not.toHaveProperty('value');
    expect(dom.forms[0].action).toBe(MASKED_URL);
  });

  it('forms: an old "[redacted]" value gives no length', () => {
    const p = { dom: { forms: [{ elements: [{ type: 'hidden', name: 'csrf', value: '[redacted]' }] }] } };
    redactPageSections(p, createRedactionContext());
    expect(p.dom.forms[0].elements[0]).toEqual({ type: 'hidden', name: 'csrf' });
  });

  it('meta: content of csrf-token masked by its name; other content by patterns', () => {
    expect(dom.meta[0].attributes).toEqual({ name: 'csrf-token', content: '[redacted:key-token]' });
    expect(dom.meta[1].attributes.content).toBe('Kontakt: [redacted:email]');
  });

  it('meta: property and http-equiv names count too', () => {
    const p = { dom: { meta: [
      { attributes: { property: 'app_session', content: 'abc123' } },
      { attributes: { 'http-equiv': 'X-Auth-Token', content: 'abc123' } },
      { attributes: { name: 'viewport', content: 'width=device-width' } },
    ] } };
    redactPageSections(p, createRedactionContext());
    expect(p.dom.meta.map((m) => m.attributes.content)).toEqual(['[redacted:key-session]', '[redacted:key-token]', 'width=device-width']);
  });

  it('data-* attributes and root markers by key; src/href attributes as URLs', () => {
    expect(dom.rootMarkers.dataAttributesOnBody).toEqual({ 'data-token': '[redacted:key-token]', 'data-pin': '[redacted:key-pin]', class: 'logged-in' });
    expect(dom.rootMarkers.dataAttributesOnHtml).toEqual({ lang: 'pl', 'data-user-email': '[redacted:email]' });
    expect(dom.scripts[0].attributes).toEqual({ src: MASKED_URL, 'data-token': '[redacted:key-token]' });
    expect(dom.iframes[0].attributes).toEqual({ src: MASKED_URL, 'data-session-id': '[redacted:key-session]' });
    expect(dom.stylesheets[0].attributes.href).toBe(MASKED_URL);
  });

  it('src/href/canonical/hreflangs as URLs; altLength (v4, F7) stays a number', () => {
    for (const url of [dom.images[0].src, dom.scripts[0].src, dom.stylesheets[0].href, dom.iframes[0].src, dom.canonical, dom.hreflangs[0].href]) {
      expect(url).toBe(MASKED_URL);
    }
    expect(dom.images[0].altLength).toBe(`Avatar ${EMAIL}`.length);
    expect(dom.images[0]).not.toHaveProperty('alt');
  });

  it('structure attribute form k="v"', () => {
    expect(dom.structure).toBe('<html lang="pl"><body data-token="[redacted:key-token]" data-user="[redacted:email]"><form id="loginForm"><input type="email" name="email"></form></body></html>');
    expect(dom.structureTruncated).toBe(false);
    expect(dom.omittedElements).toBe(0);
  });

  it('fullHtml: field values and textarea content → form-value', () => {
    expect(dom.fullHtml).toBe('<html><body><form><input name="q" value="[redacted:form-value]"><input type="text" name="nick" value="[redacted:form-value]"><textarea name="msg">[redacted:form-value]</textarea></form></body></html>');
  });

  it('a v3 outerHTML gets the same treatment as fullHtml', () => {
    const p = { dom: { html: { lang: 'pl', outerHTML: `<html><body data-token="${TOKEN}"><input value="${PASSWORD}"></body></html>` } } };
    redactPageSections(p, createRedactionContext());
    expect(p.dom.html).toEqual({ lang: 'pl', outerHTML: '<html><body data-token="[redacted:key-token]"><input value="[redacted:form-value]"></body></html>' });
  });

  // QA E4 F-2: `srcdoc` is the whole HTML of the frame, texts and field values included (tests/fixtures/pages/privacy.html).
  const SRCDOC = "<!doctype html><body><label>Kod rabatowy <input type='text' id='in-frame' value='RABAT-2026'></label></body>";
  const frameDom = () => ({ dom: { iframes: [{ src: null, id: 'frame', name: null, titleLength: 13, attributes: { id: 'frame', srcdoc: SRCDOC } }] } });

  it('iframe srcdoc → [redacted:html-structure]: no text, no field value (QA E4 F-2)', () => {
    const p = frameDom();
    const ctx = createRedactionContext();
    redactPageSections(p, ctx);
    expect(p.dom.iframes[0].attributes).toEqual({ id: 'frame', srcdoc: '[redacted:html-structure]' });
    expect(ctx.applied).toBe(1);
    const again = createRedactionContext();
    redactPageSections(p, again);
    expect(again.applied).toBe(0);
    const empty = { dom: { iframes: [{ attributes: { srcdoc: '' } }] } };
    redactPageSections(empty, createRedactionContext());
    expect(empty.dom.iframes[0].attributes.srcdoc).toBe('');
  });

  it('iframe srcdoc with html-structure off (developer option): like fullHtml, field values masked, texts kept', () => {
    const p = frameDom();
    redactPageSections(p, createRedactionContext({ disabledRules: ['html-structure'] }));
    const out = p.dom.iframes[0].attributes.srcdoc;
    expect(out).toContain('Kod rabatowy');
    expect(out).toContain('value="[redacted:form-value]"');
    expect(out).not.toContain('RABAT-2026');
  });

  // E4-REREVIEW: `>` inside a quoted attribute does not end the tag; a tag inside textarea does not end its content.
  const fullHtmlOf = (html) => {
    const p = { dom: { html: { outerHTML: html } } };
    redactPageSections(p, createRedactionContext({ disabledRules: ['html-structure'] }));
    return p.dom.html.outerHTML;
  };

  it('fullHtml: input with `>` in a quoted attribute, textarea with a tag inside (E4-FIX3)', () => {
    expect(fullHtmlOf('<input data-x="a>b" value="S1">')).toBe('<input data-x="a>b" value="[redacted:form-value]">');
    expect(fullHtmlOf("<input data-x='a>b' value='S2' >")).toBe("<input data-x='a>b' value=\"[redacted:form-value]\" >");
    expect(fullHtmlOf('<INPUT title="x>y>z" VALUE=S4>')).toBe('<INPUT title="x>y>z" VALUE="[redacted:form-value]">');
    expect(fullHtmlOf('<textarea>S3 <b></textarea><p>t</p>')).toBe('<textarea>[redacted:form-value]</textarea><p>t</p>');
    expect(fullHtmlOf('<TEXTAREA name="m>n">S5 <i>x</i>\n</TextArea ><textarea>S6</textarea>'))
      .toBe('<TEXTAREA name="m>n">[redacted:form-value]</TextArea ><textarea>[redacted:form-value]</textarea>');
    // An unclosed textarea runs to the end of the document (as in the browser).
    expect(fullHtmlOf('<textarea>S7 <b>')).toBe('<textarea>[redacted:form-value]');
    for (const s of ['S1', 'S3', 'S5', 'S6']) expect(fullHtmlOf(`<input data-x="a>b" value="${s}"><textarea>${s} <b></textarea>`)).not.toContain(s);
  });

  it('iframe srcdoc with html-structure off: the same quoted `>` and textarea cases (E4-FIX3)', () => {
    const p = { dom: { iframes: [{ attributes: { srcdoc: '<input data-x="a>b" value="S1"><textarea>S3 <b></textarea>' } }] } };
    redactPageSections(p, createRedactionContext({ disabledRules: ['html-structure'] }));
    expect(p.dom.iframes[0].attributes.srcdoc).toBe('<input data-x="a>b" value="[redacted:form-value]"><textarea>[redacted:form-value]</textarea>');
  });

  it('fullHtml: many <input / <textarea with unclosed quotes stays linear (E4-FIX3)', () => {
    for (const html of ['<input "'.repeat(25000), "<input a='".repeat(20000), '<input value="x'.repeat(15000),
      '<textarea "'.repeat(20000), '<textarea>'.repeat(20000), '</textarea'.repeat(20000), '<input '.repeat(30000)]) {
      const start = performance.now();
      fullHtmlOf(html);
      expect([html.slice(0, 12), performance.now() - start < 300]).toEqual([html.slice(0, 12), true]);
    }
  });

  it('nothing from the trap list in dom', () => {
    noLeak(dom);
    expect(dom.counts).toEqual({ totalElements: 40, forms: 1 });
    expect(dom.html).toEqual({ doctype: { name: 'html', publicId: '', systemId: '' }, lang: 'pl', charset: 'UTF-8', compatMode: 'CSS1Compat' });
  });
});

describe('environment and performance (AC-3.3)', () => {
  const { pkg } = page();

  it('location.href as URL; search and hash computed from the masked href; pathname as URL', () => {
    const { location } = pkg.environment;
    noLeak(location);
    expect(location.href).toBe(MASKED_URL);
    expect(location.search).toBe('?access_token=[redacted:key-token]&page=2');
    expect(location.hash).toBe('#[redacted:url-fragment]');
    expect(location.pathname).toBe('/cb;jsessionid=[redacted:key-session]');
    expect(location.origin).toBe('https://app.example.test');
  });

  it('location without query or fragment: empty search and hash', () => {
    const p = { environment: { location: { href: 'http://127.0.0.1:8080/a.html', search: '', hash: '' } } };
    redactPageSections(p, createRedactionContext());
    expect(p.environment.location).toEqual({ href: 'http://127.0.0.1:8080/a.html', search: '', hash: '' });
  });

  it('document.referrer as URL, title as text; navigator and viewport unchanged', () => {
    const { environment } = pkg;
    expect(environment.document.referrer).toBe(MASKED_URL);
    expect(environment.document.title).toBe('Profil [redacted:email]');
    expect(environment.navigator).toEqual(trapPackage().environment.navigator);
    expect(environment.viewport).toEqual({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
    expect(environment.timestamp).toBe('2026-01-15T10:01:05.000Z');
  });

  it('performance: navigation.name and resources[].name as URLs; numbers unchanged', () => {
    const { performance } = pkg;
    expect(performance.navigation.name).toBe(MASKED_URL);
    expect(performance.resources[0].name).toBe(MASKED_URL);
    expect(performance.resources[1].name).toBe('https://app.example.test/static/app.js');
    expect(performance.navigation.duration).toBe(812.5);
    expect(performance.timeOrigin).toBe(1768471204200.25);
  });
});

describe('levels and idempotence (AC-4.2, AC-4.5)', () => {
  it('idempotent on already redacted page sections; second pass applies 0', () => {
    const { pkg } = page();
    const once = JSON.parse(JSON.stringify(pkg));
    const ctx = createRedactionContext();
    redactPageSections(pkg, ctx);
    expect(pkg).toEqual(once);
    expect(ctx.applied).toBe(0);
  });

  it('counts its replacements in ctx.applied', () => {
    const { ctx } = page();
    expect(ctx.applied).toBeGreaterThan(20);
  });

  it('email and phone off: storage keeps them, keys and patterns still masked', () => {
    const { pkg } = page({ disabledRules: ['email', 'phone'] });
    expect(JSON.parse(pkg.storage.localStorage.profile)).toEqual({ mail: EMAIL, tel: PHONE });
    expect(pkg.storage.localStorage.x).toBe('[redacted:jwt]');
    expect(pkg.dom.forms[0].elements[0].valueLength).toBe(EMAIL.length);
    expect(JSON.stringify([pkg.storage, pkg.dom, pkg.environment, pkg.performance])).not.toContain(JWT.slice(0, 20));
  });

  it('through redact(): page sections are redacted and no trap survives', () => {
    const { snapshot } = redact(trapPackage());
    noLeak({ storage: snapshot.storage, dom: snapshot.dom, environment: snapshot.environment, performance: snapshot.performance });
  });
});
