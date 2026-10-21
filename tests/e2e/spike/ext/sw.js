// Spike T17: collect popup results so the test can read them even if the popup closes.
globalThis.spikeResults = [];
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.spikeResult) globalThis.spikeResults.push(msg.spikeResult);
});
