// Entry: uses named, default, namespace and re-exported bindings.
import { log } from './log.js';
import makeCounter, { STEP } from './counter.js';
import * as util from './util.js';
import { double as twice, VERSION } from './reexport.js';
import './side-effect.js';

const counter = makeCounter();
counter.add(STEP);
log(`count=${counter.value()} twice=${twice(STEP)} triple=${util.triple(1)} v=${VERSION}`);
