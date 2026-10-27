// Popup entry: wires popup.html to the controller. DOM only; every decision lives in
// controller.js and view.js. Technical details go to console.error for developers.
import { createController } from './controller.js';
import { applyModel, wasTouched } from './view.js';

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
// The checkbox is read at the click and never stored: its default is set again on every popup open (E3 D6, N6).
// Whether the reporter clicked it tells the background why an unticked box left the screenshot out (E4 D8).
document.getElementById('save').addEventListener('click', () => {
  const box = document.getElementById('includeScreenshot');
  controller.onSave({ includeScreenshot: box.checked, screenshotTouched: wasTouched(box) });
});
// Saved screen (E4 D7): no sending from the popup — the reporter sends the file on their own.
document.getElementById('showFile').addEventListener('click', () => {
  controller.onShowFile();
});
document.getElementById('newRecording').addEventListener('click', () => {
  controller.onNewRecording();
});
window.addEventListener('pagehide', () => controller.destroy());

controller.init();
