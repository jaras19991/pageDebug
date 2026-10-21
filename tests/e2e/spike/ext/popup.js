// Spike T17: report whether executeScript on the active tab (or ?tabId=) succeeds.
async function run() {
  const out = document.getElementById('out');
  const result = { ok: false };
  try {
    const param = new URLSearchParams(location.search).get('tabId');
    let tabId;
    if (param) {
      tabId = Number(param);
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      result.tabUrl = tab && tab.url; // only visible when activeTab/host permission is granted
      tabId = tab && tab.id;
    }
    result.tabId = tabId;
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: () => document.title,
    });
    result.ok = true;
    result.title = res.result;
  } catch (e) {
    result.error = String(e && e.message || e);
  }
  out.textContent = JSON.stringify(result);
  globalThis.spikeResult = result;
  chrome.runtime.sendMessage({ spikeResult: result }).catch(() => {});
}
run();
