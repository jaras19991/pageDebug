// Popup UI only: find the active tab, run snapshotTab and show a Polish message.
// All decisions live in snapshot-tab.js; technical details go to console.error.
import { snapshotTab } from './snapshot-tab.js';
import { MESSAGES, messageFor } from './messages.js';
import { isFirefoxRuntime, isFileAccessAllowed } from './target.js';

const runButton = document.getElementById('runSnapshot');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', !!isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const api = {
  scripting: chrome.scripting,
  isAllowedFileSchemeAccess: () => isFileAccessAllowed(chrome),
  isFirefox: isFirefoxRuntime(chrome),
};

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  setStatus(MESSAGES.working);

  let outcome;
  try {
    outcome = await snapshotTab(await getActiveTab(), api);
  } catch (error) {
    console.error('[Page Debug Snapshot]', error);
    outcome = { kind: 'failed' };
  }

  setStatus(messageFor(outcome), outcome.kind !== 'success');
  runButton.disabled = false;
});
