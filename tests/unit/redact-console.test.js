// @vitest-environment node
// E4-IN4, E4-IN5 (D9; AC-2.6, AC-2.7): console arguments — the token-wise preview of a long entry `{ truncated, preview }`,
// a container after a key, a sentence ending with a key word. Every row of console-args.json is redacted twice: as the
// full arguments and as the entry that serializeCapped (the real MAIN cut) makes of them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redact } from '../../src/lib/redact.js';
import { exportAssembled } from '../../src/lib/export.js';
import { serializeCapped } from '../../src/page/serialize.js';
import { LIMITS } from '../../src/page/constants.js';
import { validateSnapshot } from '../helpers/snapshot-validator.js';
import { leaks, countOccurrences } from './helpers/redaction-traps.js';

const load = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));
const corpus = load('../fixtures/redaction/console-args.json').items;
const MARKER = '[redacted:';

const argsOf = (row) => {
  if (!row.repeat) return row.args;
  const out = [];
  for (let i = 0; i < row.repeat; i++) out.push(...row.args);
  return out;
};
// The entry MAIN records: the arguments, or `{ truncated, preview }` past `entryChars`; a short row is cut the same way.
const truncatedOf = (args) => {
  const capped = serializeCapped(args, LIMITS.entryChars);
  return capped.truncated ? capped.value : { truncated: true, preview: JSON.stringify(args) };
};
const packageWith = (args) => ({ redaction: { rulesVersion: 1, disabledRules: [], masked: {} }, consoleLogs: [{ t: 1, doc: 0, level: 'log', args }] });
const run = (args) => {
  const { snapshot, applied } = redact(packageWith(args));
  return { args: snapshot.consoleLogs[0].args, applied, snapshot };
};

describe('console-args corpus (AC-2.7)', () => {
  it('has the in4/in5/console rows of D9', () => {
    const ids = corpus.map((row) => row.id);
    for (const id of ['in5-container-obj', 'in5-container-arr', 'in5-nested', 'in5-sentence', 'in5-sentence-pl', 'in5-sentence-key',
      'in5-sentence-colon', 'in4-preview', 'in5-preview', 'console-benign-count', 'console-benign-status', 'console-benign-auth-flow',
      'console-fp']) expect(ids).toContain(id);
  });

  it('console-args corpus: 0 leaks, both as full args and as {truncated, preview}', () => {
    const problems = [];
    for (const row of corpus.filter((r) => r.secrets)) {
      const args = argsOf(row);
      for (const [form, input] of [['args', args], ['preview', truncatedOf(args)]]) {
        const { args: out, applied } = run(input);
        const text = JSON.stringify(out);
        for (const secret of row.secrets) for (const f of leaks(secret, text)) problems.push(`${row.id} (${form}): leaks "${f}" in ${text.slice(0, 200)}`);
        if (applied < 1) problems.push(`${row.id} (${form}): applied 0`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('console-benign unchanged; (\'Pressed key\',\'Enter\') masked as documented FP', () => {
    for (const row of corpus.filter((r) => r.expectUnchanged)) {
      expect([row.id, run(row.args).args]).toEqual([row.id, row.args]);
      const entry = truncatedOf(row.args);
      expect([row.id, run(entry).args]).toEqual([row.id, entry]);
    }
    const fp = corpus.find((row) => row.id === 'console-fp');
    expect(fp.falsePositive).toMatch(/\S/);
    expect(run(fp.args).args).toEqual(['Pressed key', '[redacted:key-key]']);
    expect(run(truncatedOf(fp.args)).args.preview).toBe('["Pressed key","[redacted:key-key]"]');
  });

  it('property: redact(redact(x)) deep-equals redact(x) with new forms', () => {
    for (const row of corpus) {
      const args = argsOf(row);
      for (const input of [args, truncatedOf(args)]) {
        const first = redact(packageWith(input));
        const second = redact(first.snapshot);
        expect([row.id, second.applied]).toEqual([row.id, 0]);
        expect(second.snapshot).toEqual(first.snapshot);
      }
    }
  });
});

describe('a container after a key, a sentence ending with a key (IN5, Q-4)', () => {
  it('the container is masked as a whole; its shape stays', () => {
    expect(run(['password:', { v: 'Pw1x', n: 2, ok: true, none: null }]).args)
      .toEqual(['password:', { v: '[redacted:key-password]', n: '[redacted:key-password]', ok: '[redacted:key-password]', none: null }]);
    expect(run(['password', ['Pw2x', ['Pw3x']]]).args).toEqual(['password', ['[redacted:key-password]', ['[redacted:key-password]']]]);
    expect(run(['token=', { a: { b: 'Tk1x' } }, 'next']).args).toEqual(['token=', { a: { b: '[redacted:key-token]' } }, 'next']);
    // A container ends the chain: the item after it is not masked.
    expect(run(['password', { v: 'Pw4x' }, 'theme']).args).toEqual(['password', { v: '[redacted:key-password]' }, 'theme']);
  });

  it('a sentence ending with a key word, with optional is/jest and :/=, masks the next argument', () => {
    expect(run(['Your password is', 'Pw5x']).args).toEqual(['Your password is', '[redacted:key-password]']);
    expect(run(['Twoje password jest', 'Pw6x']).args).toEqual(['Twoje password jest', '[redacted:key-password]']);
    expect(run(['API key is', 'K7x']).args).toEqual(['API key is', '[redacted:key-key]']);
    expect(run(['Your token is:', 'Tk8x']).args).toEqual(['Your token is:', '[redacted:key-token]']);
    expect(run(['Your token is =', 'Tk9x']).args).toEqual(['Your token is =', '[redacted:key-token]']);
    for (const args of [['status is', 'ok'], ['auth flow step', 2], ['token count', 5], ['auth ok', true], ['say "password"', 'x']]) {
      expect(run(args).args).toEqual(args);
    }
  });
});

describe('preview of a long entry, token-wise (IN4, AC-2.6)', () => {
  const row = corpus.find((r) => r.id === 'in4-preview');
  const entry = truncatedOf(argsOf(row));
  // The flat array of strings up to the last complete item of a cut preview.
  const upToCut = (preview) => JSON.parse(`${preview.slice(0, preview.lastIndexOf('",') + 1)}]`);

  it('["token=","x","more"] preview: x masked, structure equal to original up to the cut, masked count == markers in output', () => {
    expect(entry.truncated).toBe(true);
    const { args, applied } = run(entry);
    expect(Object.keys(args)).toEqual(Object.keys(entry));
    const before = upToCut(entry.preview);
    const after = upToCut(args.preview);
    expect(after.length).toBe(before.length);
    const expected = before.map((item, i) => (item === 'x' && before[i - 1] === 'token=' ? '[redacted:key-token]' : item));
    expect(after).toEqual(expected);
    expect(applied).toBe(countOccurrences(args.preview, MARKER));
    expect(applied).toBe(countOccurrences(entry.preview, '"token=","x'));
    expect(args.preview).not.toMatch(/token="\[redacted|"x"/);
  });

  it('snapshot with that entry passes validator v4 (sum of redaction.masked == occurrences of [redacted:)', async () => {
    // The export path: redact, then the preview grown by markers is cut back to entryChars (capStrings), then counted.
    const pkg = load('../fixtures/snapshots/v4.json');
    const at = pkg.consoleLogs.findIndex((e) => e.doc === 0 && Array.isArray(e.args));
    pkg.consoleLogs[at] = { ...pkg.consoleLogs[at], args: entry };
    const { snapshot } = await exportAssembled(pkg, { date: new Date(2026, 0, 15, 11, 1, 5) });
    expect(validateSnapshot(snapshot).errors).toEqual([]);
    const preview = snapshot.consoleLogs[at].args.preview;
    expect(preview.length).toBeLessThanOrEqual(LIMITS.entryChars);
    expect(preview).not.toContain('"x"');
    const total = countOccurrences(JSON.stringify(snapshot, null, 2), MARKER);
    expect(Object.values(snapshot.redaction.masked).reduce((a, b) => a + b, 0)).toBe(total);
    expect(snapshot.redaction.masked.consoleLogs).toBe(countOccurrences(JSON.stringify(snapshot.consoleLogs), MARKER));
  });

  it('objects in the preview: a secret key masks its value or the whole container; numbers get the text pass', () => {
    const preview = (text) => run({ truncated: true, preview: text }).args.preview;
    expect(preview('[{"password":{"a":"Pw1x","n":12},"user":"jan"},"ok"]'))
      .toBe('[{"password":{"a":"[redacted:key-password]","n":"[redacted:key-password]"},"user":"jan"},"ok"]');
    expect(preview('[{"pin":1234,"note":"token=Tk1abc"}]')).toBe('[{"pin":"[redacted:key-pin]","note":"token=[redacted:key-token]"}]');
    expect(preview('["nr",85011501232]')).toBe('["nr","[redacted:pesel]"]');
    expect(preview('["password:",{"v":"Pw2x"},"more","password:",{"v":"Pw3')).toBe(
      '["password:",{"v":"[redacted:key-password]"},"more","password:",{"v":"[redacted:key-password]');
    // Unchanged literals keep their escapes; a changed one is encoded again.
    expect(preview('["a\\u00e9\\"b","c"]')).toBe('["a\\u00e9\\"b","c"]');
    expect(JSON.parse(preview('["mail: \\u0041 jan@example.com"]'))).toEqual(['mail: A [redacted:email]']);
  });
});
