// Trap values and a v3-shaped package carrying them in every section (E3-T2a/T2b, AC-3.2, AC-3.3). The values are
// synthetic; a test greps the redacted JSON for them (or for any 8-character fragment of them).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJUUkFQLXVzZXItOTkifQ.VHJhcFNpZ25hdHVyZTAxMjM0NTY3ODk';
export const TOKEN = 'Trap7tokenVALUEq9';
export const EMAIL = 'jan.trap@example.com';
export const PHONE = '+48 601 234 567';
export const PASSWORD = 'Hunter2Trap!pw';
export const CARD = '4111 1111 1111 1111';
export const COOKIE_SID = 'sidTrapValue8812';
// One URL with a query token, a path parameter and an OAuth implicit fragment (AC-3.3).
export const URL_TRAP = `https://app.example.test/cb;jsessionid=JsTrapSess77?access_token=${TOKEN}&page=2#id_token=${JWT}&state=xyz`;

export function loadV3() {
  const path = fileURLToPath(new URL('../../fixtures/snapshots/v3.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Every 8-character fragment of a secret (or the whole secret when shorter) found in `text`.
export function leaks(secret, text) {
  if (secret.length <= 8) return text.includes(secret) ? [secret] : [];
  const found = [];
  for (let i = 0; i + 8 <= secret.length; i++) if (text.includes(secret.slice(i, i + 8))) found.push(secret.slice(i, i + 8));
  return found;
}

export const countOccurrences = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** v3 fixture with a trap in every section that can hold user data. */
export function trapPackage() {
  const pkg = loadV3();
  pkg.redaction = { rulesVersion: 1, disabledRules: [], masked: {} };
  pkg.documents[0].url = URL_TRAP;
  pkg.notes.push(`Request failed for ${URL_TRAP} (user ${EMAIL})`);
  pkg.steps.push(
    { t: 2100, doc: 1, type: 'navigate', url: URL_TRAP, via: 'pushState' },
    { t: 2200, doc: 1, type: 'click', selector: `[data-session="${JWT}"]`, text: `Wyślij do ${EMAIL}` },
  );
  pkg.runtimeErrors.push({
    t: 3000, doc: 1, type: 'unhandledrejection',
    message: `Uncaught Error: login failed for ${EMAIL} with token=${TOKEN}`,
    filename: URL_TRAP,
    lineno: 1, colno: 2,
    stack: `Error: login failed\n    at ${URL_TRAP}:1:2`,
    reason: { message: `card ${CARD}`, password: PASSWORD, pin: 1234, nested: { apiKey: TOKEN } },
    frame: URL_TRAP,
  });
  pkg.network.push({
    t: 50, doc: 1, type: 'fetch', method: 'POST', url: URL_TRAP, status: 401, statusText: 'Unauthorized', ok: false,
    redirected: false, durationMs: 12.5, sizeBytes: 120,
    requestHeaders: { authorization: `Bearer ${TOKEN}`, 'x-api-key': TOKEN, accept: 'application/json', cookie: `sid=${COOKIE_SID}` },
    responseHeaders: { 'set-cookie': `sid=${COOKIE_SID}; HttpOnly`, 'content-type': 'application/json' },
    requestBody: JSON.stringify({ email: EMAIL, password: PASSWORD, phone: PHONE, pin: 4321 }),
    error: null,
    responseBodyPreview: `{"error":"bad token","access_token":"${TOKEN}","contact":"${EMAIL}","tel":"${PHONE}"}`,
    responseBodyTruncated: false,
  });
  pkg.vitals[1].LCP.url = URL_TRAP;
  pkg.vitals[1].longTasks.items[0].scripts[0].url = URL_TRAP;
  pkg.vitals[1].longTasks.items[0].scripts[0].invoker = `IMG#hero.onload?token=${TOKEN}`;
  pkg.consoleLogs.push({
    t: 60, doc: 1, level: 'log',
    args: [
      JSON.stringify(`user ${EMAIL} called ${PHONE}`),
      JSON.stringify({ user: { token: TOKEN, pin: 1234, active: true }, card: CARD }),
      { name: 'Error', message: `auth ${JWT}`, stack: `Error: auth\n    at ${URL_TRAP}:3:4`,
        cause: { name: 'Error', message: `password=${PASSWORD}`, stack: 'Error' } },
      { password: PASSWORD, otp: 123456, remember: true, profile: { mail: EMAIL } },
    ],
    stack: `at login (${URL_TRAP}:9:9)`,
    frame: URL_TRAP,
  });
  pkg.environment = {
    timestamp: '2026-01-15T10:01:05.000Z',
    location: {
      href: URL_TRAP, origin: 'https://app.example.test', protocol: 'https:', host: 'app.example.test',
      hostname: 'app.example.test', port: '', pathname: '/cb;jsessionid=JsTrapSess77',
      search: `?access_token=${TOKEN}&page=2`, hash: `#id_token=${JWT}&state=xyz`,
    },
    document: { title: `Profil ${EMAIL}`, referrer: URL_TRAP, readyState: 'complete', visibilityState: 'visible', lastModified: '01/15/2026 10:00:00' },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0', language: 'pl-PL', languages: ['pl-PL', 'en'], cookieEnabled: true },
    viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
  };
  pkg.performance = {
    timeOrigin: 1768471204200.25,
    navigation: { name: URL_TRAP, entryType: 'navigation', startTime: 0, duration: 812.5, type: 'navigate', transferSize: 3000 },
    resources: [
      { name: URL_TRAP, entryType: 'resource', initiatorType: 'fetch', startTime: 10, duration: 20, transferSize: 300 },
      { name: 'https://app.example.test/static/app.js', entryType: 'resource', initiatorType: 'script', startTime: 5, duration: 9, transferSize: 900 },
    ],
  };
  pkg.storage = {
    cookies: `sid=${COOKIE_SID}; theme=dark; consent=1`,
    localStorage: { token: TOKEN, x: JWT, profile: `{"mail":"${EMAIL}","tel":"${PHONE}"}`, theme: 'dark' },
    sessionStorage: { 'auth.state': JSON.stringify({ refresh_token: TOKEN }), note: `zadzwoń ${PHONE}`, step: '3' },
  };
  pkg.dom = {
    counts: { totalElements: 40, forms: 1 },
    html: { doctype: { name: 'html', publicId: '', systemId: '' }, lang: 'pl', charset: 'UTF-8', compatMode: 'CSS1Compat' },
    meta: [
      { tagName: 'META', id: null, className: null, name: 'csrf-token', type: null, src: null, href: null, text: '',
        attributes: { name: 'csrf-token', content: TOKEN } },
      { tagName: 'META', id: null, className: null, name: 'description', type: null, src: null, href: null, text: '',
        attributes: { name: 'description', content: `Kontakt: ${EMAIL}` } },
    ],
    canonical: URL_TRAP,
    hreflangs: [{ hreflang: 'en', href: URL_TRAP }],
    scripts: [{ src: URL_TRAP, type: null, async: false, defer: true, textLength: 0, id: null, attributes: { src: URL_TRAP, 'data-token': TOKEN } }],
    stylesheets: [{ tagName: 'LINK', href: URL_TRAP, media: null, disabled: false, textLength: 0, attributes: { rel: 'stylesheet', href: URL_TRAP } }],
    images: [{ src: URL_TRAP, naturalWidth: 10, naturalHeight: 10, width: 10, height: 10, loading: null, altLength: `Avatar ${EMAIL}`.length }],
    iframes: [{ src: URL_TRAP, id: 'pay', name: null, title: null, attributes: { src: URL_TRAP, 'data-session-id': TOKEN } }],
    forms: [{
      id: 'loginForm', name: null, method: 'post', action: URL_TRAP, enctype: 'application/x-www-form-urlencoded',
      elements: [
        { tagName: 'INPUT', type: 'email', name: 'email', id: 'email', value: EMAIL },
        { tagName: 'INPUT', type: 'password', name: 'password', id: 'pass', value: PASSWORD },
        { tagName: 'INPUT', type: 'checkbox', name: 'terms', id: 'terms', value: 'on', checked: true },
      ],
    }],
    rootMarkers: {
      bodyClassName: 'logged-in', htmlClassName: null,
      dataAttributesOnHtml: { lang: 'pl', 'data-user-email': EMAIL },
      dataAttributesOnBody: { 'data-token': TOKEN, 'data-pin': '1234', class: 'logged-in' },
    },
    structure: `<html lang="pl"><body data-token="${TOKEN}" data-user="${EMAIL}"><form id="loginForm"><input type="email" name="email"></form></body></html>`,
    structureTruncated: false,
    omittedElements: 0,
    fullHtml: `<html><body><form><input name="q" value="${EMAIL}"><input type="text" name="nick" value="${PASSWORD}"><textarea name="msg">${TOKEN} pisze</textarea></form></body></html>`,
  };
  return pkg;
}

// The e-mail is checked by its local part and the start of the domain: `example.` also names harmless test hosts.
export const TRAPS = [JWT, TOKEN, 'jan.trap@exa', PASSWORD, CARD, COOKIE_SID, '601 234 567', 'JsTrapSess77'];
