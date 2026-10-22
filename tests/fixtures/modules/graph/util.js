import { log } from './log.js';

function double(x) {
  return x * 2;
}
const triple = (x) => x * 3;

log('util loaded');
export { double, triple };
