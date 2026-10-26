// @vitest-environment node
// E3-TEST2 (in E3-T2a): property-based checks of the redaction engine on mutations of the v3 fixture (AC-4.2).
// 200 mutations with a fixed seed: idempotence (second pass equal, applied 0), key paths and container types kept
// (the only allowed changes: number/boolean → marker string, `storage.cookies` string → list, form `value` → `valueLength`),
// and no injected secret survives.
import { describe, it, expect } from 'vitest';
import { redact } from '../../src/lib/redact.js';
import { loadV3 } from './helpers/redaction-traps.js';

// mulberry32: small deterministic PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NOT_USER_DATA = new Set(['schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt',
  'recordingStoppedReason', 'timeOrigin', 'overview', 'redaction', 'limits', 'truncated', 'screenshots', 'attachments']);

function generator(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const word = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += ALNUM[Math.floor(rand() * ALNUM.length)];
    return s;
  };
  const b64url = (n) => word(n).replace(/[0-9]/g, '-');
  const luhnCard = () => {
    const digits = [4];
    while (digits.length < 15) digits.push(Math.floor(rand() * 10));
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      let d = digits[14 - i];
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    digits.push((10 - (sum % 10)) % 10);
    return digits.join('');
  };
  // Each secret: the text injected and the parts that must not survive.
  const secret = () => {
    const kind = pick(['jwt', 'bearer', 'pair', 'email', 'card', 'json']);
    const value = `Q${word(15)}`;
    switch (kind) {
      case 'jwt': {
        const jwt = `eyJ${b64url(14)}.eyJ${b64url(18)}.${b64url(24)}`;
        return { text: jwt, secrets: [jwt] };
      }
      case 'bearer': return { text: `Bearer ${value}x${word(8)}`, secrets: [value] };
      case 'pair': return { text: `${pick(['token', 'password', 'api_key', 'sid'])}=${value}`, secrets: [value] };
      case 'email': {
        const email = `u${word(6).toLowerCase()}@example.com`;
        return { text: email, secrets: [email] };
      }
      case 'card': {
        const card = luhnCard();
        return { text: card, secrets: [card] };
      }
      default: return { text: JSON.stringify({ password: value, pin: 1234 }), secrets: [value] };
    }
  };
  return { pick, word, secret };
}

// String leaves of user-data sections: [container, key].
function stringLeaves(value, out = [], top = true) {
  if (Array.isArray(value)) value.forEach((v, i) => (typeof v === 'string' ? out.push([value, i]) : stringLeaves(v, out, false)));
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (top && NOT_USER_DATA.has(key)) continue;
      if (typeof value[key] === 'string') out.push([value, key]);
      else stringLeaves(value[key], out, false);
    }
  }
  return out;
}

function mutate(base, rand) {
  const g = generator(rand);
  const pkg = JSON.parse(JSON.stringify(base));
  const injected = [];
  const count = 1 + Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    const s = g.secret();
    injected.push(...s.secrets);
    const op = g.pick(['replace', 'append', 'append', 'console', 'header', 'storage', 'duplicate']);
    if (op === 'replace' || op === 'append') {
      const [container, key] = g.pick(stringLeaves(pkg));
      container[key] = op === 'replace' ? s.text : `${container[key]} ${s.text}`;
    } else if (op === 'console') {
      pkg.consoleLogs.push({
        t: Math.round(rand() * 1000), doc: 1, level: g.pick(['log', 'error']),
        args: [s.text, { [g.pick(['pin', 'otp', 'token', 'sid'])]: g.pick([1234, true, `Z${g.word(12)}`]), nested: { password: g.word(10), n: 3 } }],
      });
    } else if (op === 'header') {
      const entry = g.pick(pkg.network);
      entry.requestHeaders[g.pick(['authorization', 'x-api-key', 'cookie', 'x-trace'])] = s.text;
    } else if (op === 'storage') {
      pkg.storage.localStorage[g.pick(['token', 'profile', 'settings', 'auth_state'])] = s.text;
    } else {
      const list = g.pick([pkg.consoleLogs, pkg.network, pkg.steps, pkg.runtimeErrors]);
      list.push({ ...JSON.parse(JSON.stringify(g.pick(list))), note: s.text });
    }
  }
  return { pkg, injected };
}

const EXEMPT = [/^\$\.storage\.cookies/, /^\$\.redaction\.masked$/, /\.elements\[\d+\]\.(value|valueLength)$/];
const exempt = (path) => EXEMPT.some((re) => re.test(path));
const MARKER = /^\[redacted:[a-z0-9_*-]+\]$/;

// Same key paths (in order) and container types; scalars keep their type except number/boolean → marker.
function sameShape(before, after, path = '$') {
  if (exempt(path)) return [];
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || after.length !== before.length) return [`${path}: array`];
    return before.flatMap((v, i) => sameShape(v, after[i], `${path}[${i}]`));
  }
  if (before && typeof before === 'object') {
    if (!after || typeof after !== 'object' || Array.isArray(after)) return [`${path}: object`];
    const a = Object.keys(before).filter((k) => !exempt(`${path}.${k}`));
    const b = Object.keys(after).filter((k) => !exempt(`${path}.${k}`));
    if (a.join('\n') !== b.join('\n')) return [`${path}: keys ${a} vs ${b}`];
    return a.flatMap((k) => sameShape(before[k], after[k], `${path}.${k}`));
  }
  if (typeof before === typeof after) return [];
  if ((typeof before === 'number' || typeof before === 'boolean') && typeof after === 'string' && MARKER.test(after)) return [];
  return [`${path}: ${typeof before} → ${typeof after}`];
}

describe('redaction properties on 200 mutations of v3 (AC-4.2, E3-TEST2)', () => {
  const base = loadV3();
  base.redaction = { rulesVersion: 1, disabledRules: [], masked: {} };
  const rand = prng(0x5eed2026);
  const cases = Array.from({ length: 200 }, () => mutate(base, rand));

  it('redact(redact(x)) deep-equals redact(x); the second pass reports 0', () => {
    for (const { pkg } of cases) {
      const first = redact(pkg);
      const second = redact(first.snapshot);
      expect(second.applied).toBe(0);
      expect(second.snapshot).toEqual(first.snapshot);
    }
  });

  it('container types and keys unchanged except number→marker (and the cookie/form fields named in the schema)', () => {
    for (const { pkg } of cases) {
      expect(sameShape(pkg, redact(pkg).snapshot)).toEqual([]);
    }
  });

  it('no injected secret survives', () => {
    let checked = 0;
    for (const { pkg, injected } of cases) {
      const text = JSON.stringify(redact(pkg).snapshot);
      for (const secret of injected) {
        expect(text.includes(secret), secret).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it('the input is never mutated', () => {
    for (const { pkg } of cases.slice(0, 20)) {
      const copy = JSON.parse(JSON.stringify(pkg));
      redact(pkg);
      expect(pkg).toEqual(copy);
    }
  });
});
