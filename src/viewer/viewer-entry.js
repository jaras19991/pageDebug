// Viewer entry (E4 D3), bundled by scripts/gen-content.mjs into src/standalone/viewer.html.
// Starts the viewer shell (app.js) on the template slots: #loader, #package-info, nav[role="tablist"], main#app.
import { createApp } from './app.js';

createApp({ doc: document });
