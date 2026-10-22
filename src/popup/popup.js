// Popup entry: wires popup.html to the controller. DOM only; every decision lives in
// controller.js and view.js. Technical details go to console.error for developers.
import { createController } from './controller.js';
import { applyModel } from './view.js';

const controller = createController({
  runtime: chrome.runtime,
  permissions: chrome.permissions,
  downloads: chrome.downloads,
  storage: chrome.storage,
  tabs: chrome.tabs,
  extension: chrome.extension,
  URL,
  Blob,
  render: (model) => applyModel(document, model),
  logError: (...details) => console.error('[Page Debug Snapshot]', ...details),
});

// No async work before onRecord(): permissions.request must run in the click's tick (D9).
document.getElementById('record').addEventListener('click', () => {
  controller.onRecord();
});
document.getElementById('save').addEventListener('click', () => {
  controller.onSave();
});
window.addEventListener('pagehide', () => controller.destroy());

controller.init();
