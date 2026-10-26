// E3 AC-3.6 (unit): the recorder and the text masking bundled the way the generator bundles MAIN, so a test can
// load them into a separate realm (node:vm) before that realm's built-ins are replaced.
import { createRecorder } from '../../../../src/page/recorder.js';
import { maskText, maskUrl, maskSecrets, cutPreview, secretKeyRule } from '../../../../src/lib/mask-secrets.js';

globalThis.__pdsHostile = { createRecorder, maskText, maskUrl, maskSecrets, cutPreview, secretKeyRule };
