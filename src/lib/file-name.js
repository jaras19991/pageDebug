// Package file name (design E3 D7, AC-1.1): `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`.
// `host` = hostname of the recorded origin (no port, lower case, characters outside [a-z0-9.-] → '-', none → 'local');
// the time is the reporter's local clock (the same fields as the DOS time in the zip). Pure: no chrome.*, no DOM.

const HOST_MAX = 80;
const FALLBACK_HOST = 'local';

function hostOf(origin) {
  if (typeof origin !== 'string' || origin === '') return FALLBACK_HOST;
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return FALLBACK_HOST;
  }
  const host = hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, HOST_MAX);
  return host === '' ? FALLBACK_HOST : host;
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

/**
 * @param {{ origin?: string, date?: Date }} input  `origin` of the recording (a full URL is accepted too)
 * @returns {string}
 */
export function snapshotFileName({ origin, date } = {}) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const stamp = `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `snapshot-${hostOf(origin)}-${stamp}.zip`;
}
