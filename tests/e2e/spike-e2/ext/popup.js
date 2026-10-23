/* global chrome, document, location, window */
// E2-T0 spike popup. #request asks for the tab origin in the click (as E1). `?ff=1&target=<url>`
// runs the Firefox S4 sequence from an extension tab: the target opens in a new window, the
// Marionette driver triggers the toolbar action there (activeTab) and sets data-go on <body>.
const out = document.getElementById('out');
const show = (v) => { out.textContent = typeof v === 'string' ? v : JSON.stringify(v); };
const params = new URLSearchParams(location.search);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let pattern = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url ?? 'about:blank');
  pattern = `${url.protocol}//${url.hostname}/*`;
}
const ready = init().catch((e) => show(`init error: ${e.message}`));

document.getElementById('request').addEventListener('click', () => {
  chrome.permissions.request({ origins: [pattern] }).then(
    (granted) => show(`granted:${granted}`),
    (error) => show(`error:${error.message}`),
  );
});

async function waitGo(stage) {
  document.body.dataset.stage = stage;
  while (document.body.dataset.go !== stage) await delay(100);
}

async function firefoxSequence(target) {
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const r = { contains: await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] }) };
  const win = await chrome.windows.create({ url: target, focused: true });
  const tabId = win.tabs[0].id;
  for (let i = 0; i < 50 && (await chrome.tabs.get(tabId)).status !== 'complete'; i++) await delay(100);
  r.windowId = win.id;
  const [view] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }),
  });
  r.view = view.result;
  r.codec = await send({ type: 'codecProbe' });
  r.beforeAction = await send({ type: 'capture', windowId: win.id });
  await waitGo('trigger');
  await delay(500);
  r.afterAction = await send({ type: 'capture', windowId: win.id });
  await delay(600);
  r.burst = await Promise.all([1, 2, 3].map(() => send({ type: 'capture', windowId: win.id, summary: true })));
  await chrome.tabs.reload(tabId);
  for (let i = 0; i < 50 && (await chrome.tabs.get(tabId)).status !== 'complete'; i++) await delay(100);
  await delay(600);
  r.afterReload = await send({ type: 'capture', windowId: win.id, summary: true });
  await chrome.tabs.update(tabId, { url: target.replace('127.0.0.1', 'localhost') });
  await delay(1000);
  await chrome.tabs.update(tabId, { url: target });
  await delay(1000);
  r.afterCrossOriginAndBack = await send({ type: 'capture', windowId: win.id, summary: true });
  await chrome.windows.remove(win.id);
  return r;
}

if (params.get('ff')) {
  firefoxSequence(params.get('target')).then(
    (r) => show({ done: true, ...r }),
    (e) => show({ done: true, error: String(e?.message ?? e) }),
  );
} else {
  ready.then(() => { document.body.dataset.ready = '1'; });
}
