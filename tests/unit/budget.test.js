import { describe, it, expect } from 'vitest';
import { fitBudget, recount, cutHtml, BUDGET_LIMITS } from '../../src/lib/budget.js';
import { heavyPackage } from './helpers/heavy-package.js';

const MB2 = 2097152;
const MB10 = 10485760;
const RATIO = 6; // synthetic compression ratio of the measure double

// Measure double (design T6): JSON length / a fixed ratio; counts its calls.
function fakeMeasure(ratio = RATIO) {
  const fn = async (pkg) => {
    fn.calls++;
    return Math.ceil(JSON.stringify(pkg, null, 2).length / ratio);
  };
  fn.calls = 0;
  return fn;
}

const failed = (r) => (typeof r.status === 'number' && r.status >= 400) || (r.error !== null && r.error !== undefined);
const isApi = (r) => r.type === 'fetch' || r.type === 'xhr';

// Every category present and above its floor: resources > 200, dom lists > 100, structure > 100 000, storage values
// > 1000, stacks > 4000.
function mediumPackage(overrides = {}) {
  return heavyPackage({ logs: 60, logChars: 300, requests: 60, errors: 5, structureChars: 120000, resources: 2000, ...overrides });
}

describe('fitBudget (D8, AC-6.1)', () => {
  it('heavy page fits ≤ 2 097 152 with default config (measure double)', async () => {
    const pkg = heavyPackage();
    const measure = fakeMeasure();
    const res = await fitBudget(pkg, { measure });
    expect(res.packageBytes).toBeLessThanOrEqual(MB2);
    expect(Math.ceil(JSON.stringify(res.pkg, null, 2).length / RATIO)).toBeLessThanOrEqual(MB2);
    expect(JSON.stringify(res.pkg, null, 2).length).toBeLessThanOrEqual(MB10);
    expect(measure.calls).toBeLessThanOrEqual(BUDGET_LIMITS.maxMeasures);
    expect(BUDGET_LIMITS.maxMeasures).toBe(4);
    // Input not mutated (fitBudget works on a copy).
    expect(pkg.consoleLogs.length).toBe(5000);
    expect(pkg.truncated.consoleLogs).toBe(false);
  }, 120000);

  it('fits with the reserve for screenshot and summary', async () => {
    const res = await fitBudget(heavyPackage({ logs: 1000 }), { measure: fakeMeasure(), reserveBytes: 300000 });
    expect(res.packageBytes).toBeLessThanOrEqual(MB2);
    expect(res.packageBytes).toBe(Math.ceil(JSON.stringify(res.pkg, null, 2).length / RATIO) + 300000);
  }, 60000);

  it('over 10 MB unpacked (default config): cut before the first, costly measurement', async () => {
    const sizes = [];
    const measure = async (p) => {
      const n = JSON.stringify(p, null, 2).length;
      sizes.push(n);
      return Math.ceil(n / RATIO);
    };
    await fitBudget(heavyPackage(), { measure });
    expect(sizes[0]).toBeLessThanOrEqual(MB10);
  }, 120000);

  it('small package: one measure, nothing cut, pkg equal', async () => {
    const pkg = mediumPackage();
    const measure = fakeMeasure();
    const res = await fitBudget(pkg, { measure });
    expect(measure.calls).toBe(1);
    expect(res.cuts).toEqual([]);
    expect(res.pkg).toEqual(pkg);
  });
});

describe('fitBudget cut order and protected data (AC-6.2)', () => {
  it('never removes overview, steps, runtimeErrors, network ≥400/error, vitals, screenshots', async () => {
    const pkg = heavyPackage();
    const { pkg: out } = await fitBudget(pkg, { measure: fakeMeasure() });
    expect(out.overview).toBeDefined();
    expect(out.redaction).toEqual(pkg.redaction);
    expect(out.steps).toEqual(pkg.steps);
    expect(out.runtimeErrors.length).toBe(pkg.runtimeErrors.length);
    expect(out.runtimeErrors.map((r) => r.message)).toEqual(pkg.runtimeErrors.map((r) => r.message));
    expect(out.network.filter(failed)).toEqual(pkg.network.filter(failed));
    expect(out.vitals).toEqual(pkg.vitals);
    expect(out.screenshots).toEqual(pkg.screenshots);
    expect(out.documents.length).toBe(pkg.documents.length);
    expect(out.notes.slice(0, pkg.notes.length)).toEqual(pkg.notes);
  }, 120000);

  it('cut order: resources → successful network → debug/log/info/warn → dom lists/structure → storage → error logs → stacks', async () => {
    const pkg = mediumPackage();
    const measure = fakeMeasure(1);
    const res = await fitBudget(pkg, { measure, limitBytes: 1000 });
    expect(res.cuts.map((c) => c.step)).toEqual(['resources', 'network', 'consoleLogs', 'dom', 'html', 'storage', 'errorLogs', 'stacks']);
    const out = res.pkg;
    expect(out.performance.resources.length).toBe(BUDGET_LIMITS.resourcesKeep);
    expect(out.network.every(failed)).toBe(true);
    expect(out.consoleLogs.length).toBe(0);
    for (const key of ['meta', 'scripts', 'stylesheets', 'images', 'iframes', 'hreflangs']) {
      expect(out.dom[key].length).toBeLessThanOrEqual(BUDGET_LIMITS.domListItems);
    }
    expect(out.dom.structure.length).toBeLessThanOrEqual(BUDGET_LIMITS.structureChars);
    for (const v of Object.values(out.storage.localStorage)) expect(v.length).toBeLessThanOrEqual(BUDGET_LIMITS.storageValueChars);
    for (const r of out.runtimeErrors) expect(r.stack.length).toBeLessThanOrEqual(BUDGET_LIMITS.stackChars);
    // Over the limit after all cuts: saved anyway, with a note.
    expect(out.notes.at(-1)).toMatch(/^Package is larger than 1000 bytes \(\d+ bytes\) after all cuts\.$/);
    expect(measure.calls).toBeLessThanOrEqual(4);
  });

  it('only as much as needed: a small excess is taken from performance.resources alone', async () => {
    const pkg = mediumPackage();
    const chars = JSON.stringify(pkg, null, 2).length;
    const res = await fitBudget(pkg, { measure: fakeMeasure(1), limitBytes: chars - 5000, maxJsonChars: Infinity });
    expect(res.cuts.map((c) => c.step)).toEqual(['resources']);
    expect(res.pkg.performance.resources.length).toBeLessThan(2000);
    expect(res.pkg.performance.resources.length).toBeGreaterThanOrEqual(BUDGET_LIMITS.resourcesKeep);
    // Oldest go first: the newest resource is still there.
    expect(res.pkg.performance.resources.at(-1)).toEqual(pkg.performance.resources.at(-1));
    expect(res.pkg.network).toEqual(pkg.network);
    expect(res.pkg.consoleLogs).toEqual(pkg.consoleLogs);
    expect(res.packageBytes).toBeLessThanOrEqual(chars - 5000);
  });

  it('inside a step: network resources before fetch/xhr, debug before log before info before warn, oldest first', async () => {
    const { pkg: out } = await fitBudget(heavyPackage(), { measure: fakeMeasure() });
    const ok = out.network.filter((r) => !failed(r));
    if (ok.some(isApi)) expect(ok.some((r) => !isApi(r))).toBe(false);
    const levels = new Set(out.consoleLogs.map((r) => r.level));
    const order = ['debug', 'log', 'info', 'warn'];
    const firstKept = order.findIndex((l) => levels.has(l));
    if (firstKept > 0) for (const l of order.slice(0, firstKept)) expect(levels.has(l)).toBe(false);
    // Kept entries of a partly cut level are the newest ones.
    const level = order[firstKept];
    if (level) {
      const kept = out.consoleLogs.filter((r) => r.level === level).map((r) => r.t);
      const all = heavyPackage({ logs: 5000 }).consoleLogs.filter((r) => r.level === level).map((r) => r.t);
      expect(kept).toEqual(all.slice(all.length - kept.length));
    }
  }, 120000);

  it('each cut sets truncated.<key> and a note with the number removed', async () => {
    const pkg = mediumPackage();
    const res = await fitBudget(pkg, { measure: fakeMeasure(1), limitBytes: 1000 });
    const t = res.pkg.truncated;
    expect(t).toMatchObject({ resources: true, network: true, consoleLogs: true, dom: true, html: true, storage: true, stacks: true });
    expect(pkg.truncated.resources).toBe(false);
    const byStep = Object.fromEntries(res.cuts.map((c) => [c.step, c.removed]));
    expect(byStep.resources).toBe(2000 - BUDGET_LIMITS.resourcesKeep);
    expect(byStep.network).toBe(pkg.network.filter((r) => !failed(r)).length);
    expect(byStep.consoleLogs + byStep.errorLogs).toBe(pkg.consoleLogs.length);
    for (const c of res.cuts) {
      expect(c.removed).toBeGreaterThan(0);
      expect(res.pkg.notes.some((n) => n.includes(String(c.removed)))).toBe(true);
    }
    expect(res.pkg.notes).toContain(`${byStep.resources} oldest performance.resources entries were removed to fit the package size limit.`);
    expect(res.pkg.notes).toContain(`${byStep.network} oldest successful network requests were removed to fit the package size limit.`);
  });

  it('cut strings never leave half a redaction marker', async () => {
    const pkg = mediumPackage();
    const stack = `${'a'.repeat(3990)} [redacted:key-token] ${'b'.repeat(2000)}`;
    pkg.runtimeErrors.forEach((r) => { r.stack = stack; });
    const res = await fitBudget(pkg, { measure: fakeMeasure(1), limitBytes: 1000 });
    for (const r of res.pkg.runtimeErrors) {
      expect(r.stack).not.toMatch(/\[redacted:[^\]]*$/);
      expect(r.stack.length).toBeLessThanOrEqual(BUDGET_LIMITS.stackChars);
    }
  });
});

describe('fitBudget full HTML and failure modes (AC-6.3)', () => {
  it('fullHtml: limit 10 MB, fullHtml cut first, note "exceeds 2 MB" when over 2 MB', async () => {
    const pkg = mediumPackage({ fullHtmlChars: 12 * 1024 * 1024 });
    const res = await fitBudget(pkg, { measure: fakeMeasure(1) });
    expect(res.packageBytes).toBeLessThanOrEqual(MB10);
    expect(res.packageBytes).toBeGreaterThan(MB2);
    expect(res.cuts.map((c) => c.step)).toEqual(['fullHtml']);
    expect(res.pkg.dom.fullHtml.length).toBeLessThan(pkg.dom.fullHtml.length);
    expect(res.pkg.dom.fullHtml.endsWith('</body></html>')).toBe(true);
    expect(res.pkg.truncated.html).toBe(true);
    expect(res.pkg.notes).toContain('Full HTML was cut to fit 10 MB.');
    expect(res.pkg.notes).toContain('Package exceeds 2 MB: full HTML enabled by developer.');
    expect(res.pkg.performance.resources).toEqual(pkg.performance.resources);
  }, 60000);

  it('fullHtml under 2 MB: no notes, nothing cut', async () => {
    const pkg = mediumPackage({ fullHtmlChars: 200000 });
    const res = await fitBudget(pkg, { measure: fakeMeasure() });
    expect(res.cuts).toEqual([]);
    expect(res.pkg.notes).toEqual(pkg.notes);
  });

  it('never throws; over-limit after all cuts → note, pkg returned', async () => {
    const measure = async () => 50 * 1024 * 1024;
    const res = await fitBudget(mediumPackage(), { measure });
    expect(res.pkg).toBeTruthy();
    expect(res.packageBytes).toBe(50 * 1024 * 1024);
    expect(res.pkg.notes.at(-1)).toBe(`Package is larger than 2 MB (${50 * 1024 * 1024} bytes) after all cuts.`);
    // A failing measure falls back to the JSON length and still returns.
    const broken = await fitBudget(mediumPackage(), { measure: async () => { throw new Error('no zip'); } });
    expect(broken.pkg).toBeTruthy();
    expect(Number.isInteger(broken.packageBytes)).toBe(true);
  });

  it('missing sections (console package without dom/storage/performance) are fine', async () => {
    const pkg = mediumPackage();
    pkg.dom = null;
    pkg.storage = null;
    pkg.performance = null;
    const res = await fitBudget(pkg, { measure: fakeMeasure(1), limitBytes: 1000 });
    expect(res.cuts.map((c) => c.step)).toEqual(['network', 'consoleLogs', 'errorLogs', 'stacks']);
  });
});

describe('recount (overview after cuts)', () => {
  it('overview recounted after cuts', async () => {
    const pkg = heavyPackage();
    const { pkg: out } = await fitBudget(pkg, { measure: fakeMeasure() });
    expect(out.overview.consoleErrors).toBe(out.consoleLogs.filter((r) => r.level === 'error').length);
    expect(out.overview.failedRequests).toBe(out.network.filter(failed).length);
    expect(out.overview.runtimeErrors).toBe(out.runtimeErrors.length);
    expect(out.overview.steps).toBe(out.steps.length);
    expect(out.overview.poorVitals).toBe(1);
    expect(out.overview.screenshot).toBe(true);
    expect(out.documents[0].kept).toEqual({
      consoleLogs: out.consoleLogs.length, runtimeErrors: out.runtimeErrors.length, network: out.network.length, steps: out.steps.length,
    });
    expect(out.documents[0].counts).toEqual(pkg.documents[0].counts);
  }, 120000);

  it('recount on a plain object', () => {
    const pkg = {
      documents: [{ id: 0, kept: {} }, { id: 1, kept: {} }],
      consoleLogs: [{ doc: 0, level: 'error' }, { doc: 1, level: 'log' }],
      runtimeErrors: [],
      network: [{ doc: 1, status: 404, error: null }, { doc: 1, status: 200, error: null }],
      steps: [],
      vitals: [{ doc: 0, LCP: { rating: 'poor' }, CLS: { rating: 'poor' } }],
      screenshots: [],
    };
    recount(pkg);
    expect(pkg.overview).toEqual({ runtimeErrors: 0, consoleErrors: 1, failedRequests: 1, steps: 0, poorVitals: 2, screenshot: false });
    expect(pkg.documents[1].kept).toEqual({ consoleLogs: 1, runtimeErrors: 0, network: 2, steps: 0 });
  });
});

describe('cutHtml (element boundary)', () => {
  it('cuts after a complete tag and closes open elements within the limit', () => {
    const html = '<html><body><div id="a"><span class="x"></span><img src="y"><p></p></div></body></html>';
    const out = cutHtml(html, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.startsWith('<html><body>')).toBe(true);
    expect(out.endsWith('</body></html>')).toBe(true);
    expect(out).not.toMatch(/<[^>]*$/);
    expect(cutHtml(html, 1000)).toBe(html);
    expect(cutHtml(html, 5)).toBe('');
  });
});
