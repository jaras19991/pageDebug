/* global chrome, document, location */
// E1-T0 spike popup. #request calls permissions.request synchronously in the click handler
// (D9); #download saves a Blob through downloads.download (D7). `?auto=1&target=<url>` runs the
// Firefox sequence (S8) from an extension tab, because Marionette cannot drive the action popup.
const out = document.getElementById('out');
const show = (value) => {
  out.textContent = typeof value === 'string' ? value : JSON.stringify(value);
};
const params = new URLSearchParams(location.search);
let pattern = params.get('pattern');

async function init() {
  if (pattern) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url ?? 'about:blank');
  pattern = `${url.protocol}//${url.hostname}/*`;
  document.body.dataset.pattern = pattern;
}
const ready = init().catch((e) => show(`init error: ${e.message}`));

document.getElementById('request').addEventListener('click', () => {
  // No await before the request: Chrome loses the gesture, Firefox rejects (D9).
  chrome.permissions.request({ origins: [pattern] }).then(
    (granted) => show(`granted:${granted}`),
    (error) => show(`error:${error.message}`),
  );
});

async function saveBlob(size) {
  const body = JSON.stringify({ spike: 'E1-T0', pad: 'x'.repeat(size) });
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const downloadId = await chrome.downloads.download({
    url,
    filename: 'pds-spike-e1.json',
    saveAs: false,
    conflictAction: 'uniquify',
  });
  await chrome.runtime.sendMessage({ type: 'saveStarted', downloadId });
  return { downloadId, bytes: body.length };
}

document.getElementById('download').addEventListener('click', () => {
  const size = Number(document.body.dataset.size || 2_500_000);
  saveBlob(size).then(
    (r) => show({ download: r }),
    (error) => show(`download error: ${error.message}`),
  );
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads what MAIN, ISOLATED and the page published as attributes on <html>.
async function readMarks(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const el = document.documentElement;
      return {
        readyState: document.readyState,
        main: el.getAttribute('data-spike-main'),
        iso: el.getAttribute('data-spike-iso'),
        page: el.getAttribute('data-spike-page'),
      };
    },
  });
  return res.result;
}

async function waitMarks(tabId, previousT0) {
  for (let i = 0; i < 100; i++) {
    await delay(100);
    let marks;
    try {
      marks = await readMarks(tabId);
    } catch {
      continue;
    }
    if (marks.readyState !== 'complete' || !marks.page) continue;
    const main = marks.main ? JSON.parse(marks.main) : null;
    if (main && main.timeOrigin === previousT0) continue;
    if (main && !main.sent) continue;
    return { main, iso: marks.iso && JSON.parse(marks.iso), page: JSON.parse(marks.page) };
  }
  return { timeout: true };
}

async function firefoxSequence(target) {
  const result = {};
  const send = (msg) => chrome.runtime.sendMessage(msg);
  result.ping1 = await send({ type: 'ping' });
  await chrome.storage.session.set({ ffKey: 'ff-value' });
  result.sessionRead = (await chrome.storage.session.get('ffKey')).ffKey;
  result.contains = await chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] });
  result.register = await send({ type: 'register', pattern: 'http://127.0.0.1/*', order: 'main-first', slash: true });
  const tab = await chrome.tabs.create({ url: target, active: false });
  let marks = await waitMarks(tab.id, null);
  result.firstLoad = marks;
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const prev = marks.main?.timeOrigin ?? null;
    await chrome.tabs.reload(tab.id);
    marks = await waitMarks(tab.id, prev);
    runs.push(marks);
  }
  result.reloads = runs.map((m) => ({
    caught: !!m.main?.errors?.some((e) => e.includes('head-boom')),
    mainBeforePage: m.main && m.page ? m.main.t0 < m.page.t0 : null,
    bound: m.main?.bound ?? null,
    isoBound: m.iso?.bound ?? null,
    pageEvents: m.page?.events?.length ?? null,
    pageLeaks: m.page?.leaks?.map((l) => `${l.via}:${l.type}`) ?? null,
    received: m.main?.received ?? null,
    objDetail: m.main?.objDetail ?? null,
    order: m.main && m.iso ? (m.main.t0 < m.iso.t0 ? 'main-first' : 'iso-first') : null,
    nodeConnected: m.main?.nodeConnected ?? null,
  }));
  result.sample = marks;
  for (const mode of ['fallback']) {
    await chrome.tabs.update(tab.id, { url: `${target}${target.includes('?') ? '&' : '?'}mode=${mode}` });
    const m = await waitMarks(tab.id, marks.main?.timeOrigin ?? null);
    result[mode] = { bound: m.main?.bound, isoBound: m.iso?.bound, received: m.main?.received, leaks: m.page?.leaks };
  }
  result.isoReports = await send({ type: 'isoReportCount' });
  const dl = await saveBlob(2_500_000);
  result.download = dl;
  for (let i = 0; i < 100; i++) {
    await delay(100);
    const state = (await chrome.storage.session.get(`dl:${dl.downloadId}`))[`dl:${dl.downloadId}`];
    if (state?.state === 'complete' || state?.state === 'interrupted') {
      result.downloadState = state;
      break;
    }
  }
  result.ping2 = await send({ type: 'ping' });
  await chrome.tabs.remove(tab.id);
  await send({ type: 'unregister' });
  return result;
}

if (params.get('auto')) {
  firefoxSequence(params.get('target')).then(
    (r) => show({ done: true, ...r }),
    (e) => show({ done: true, error: String(e?.message ?? e) }),
  );
} else {
  ready.then(() => {
    document.body.dataset.ready = '1';
  });
}
