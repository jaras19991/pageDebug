import { readA } from './a.js';
import { readB } from './b.js';

globalThis.__out?.push(readA(), readB());
