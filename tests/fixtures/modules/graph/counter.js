import { log } from './log.js';

export const STEP = 2;

export default function makeCounter() {
  let n = 0;
  return {
    add(k) { n += k; log(`add ${k}`); },
    value: () => n,
  };
}
