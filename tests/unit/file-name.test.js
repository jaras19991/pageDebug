import { describe, it, expect } from 'vitest';
import { snapshotFileName } from '../../src/lib/file-name.js';

const date = new Date(2026, 9, 6, 9, 5, 7); // local time: 2026-10-06 09:05:07

describe('snapshotFileName (D7, AC-1.1)', () => {
  it('file name: host without port, [a-z0-9.-] only, local time, file: → local, IPv6 sanitized', () => {
    expect(snapshotFileName({ origin: 'https://Example.COM:8443', date })).toBe('snapshot-example.com-20261006-090507.zip');
    expect(snapshotFileName({ origin: 'http://127.0.0.1:8080', date })).toBe('snapshot-127.0.0.1-20261006-090507.zip');
    expect(snapshotFileName({ origin: 'file://', date })).toBe('snapshot-local-20261006-090507.zip');
    expect(snapshotFileName({ origin: 'null', date })).toBe('snapshot-local-20261006-090507.zip');
    const v6 = snapshotFileName({ origin: 'http://[::1]:3000', date });
    expect(v6).toMatch(/^snapshot-[a-z0-9.-]+-20261006-090507\.zip$/);
    expect(v6).toBe('snapshot----1--20261006-090507.zip');
    // IDN hostnames are punycode in URL; anything else outside the set becomes '-'.
    expect(snapshotFileName({ origin: 'https://zażółć.pl', date })).toMatch(/^snapshot-xn--[a-z0-9.-]+-20261006-090507\.zip$/);
  });

  it('accepts a full URL and ignores path, query and credentials', () => {
    expect(snapshotFileName({ origin: 'https://user:pw@shop.example.com/a/b?token=x#y', date })).toBe('snapshot-shop.example.com-20261006-090507.zip');
  });

  it('garbage or missing origin → local; default date is now', () => {
    expect(snapshotFileName({ origin: 'not a url', date })).toBe('snapshot-local-20261006-090507.zip');
    expect(snapshotFileName({ date })).toBe('snapshot-local-20261006-090507.zip');
    expect(snapshotFileName({ origin: 'https://a.pl' })).toMatch(/^snapshot-a\.pl-\d{8}-\d{6}\.zip$/);
  });

  it('host is capped in length', () => {
    const long = `https://${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.pl`;
    const name = snapshotFileName({ origin: long, date });
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name).toMatch(/^snapshot-[a-z0-9.-]+-20261006-090507\.zip$/);
  });
});
