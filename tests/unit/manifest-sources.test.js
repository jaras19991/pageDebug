import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(root + rel, 'utf8'));

const base = readJson('src/manifest.base.json');
const chrome = readJson('src/manifest.chrome.json');
const firefox = readJson('src/manifest.firefox.json');
const sources = {
  'src/manifest.base.json': base,
  'src/manifest.chrome.json': chrome,
  'src/manifest.firefox.json': firefox,
};

const BROAD_HOSTS = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'];
const ALLOWED_PERMISSIONS = ['activeTab', 'scripting'];
// AMO accepts an e-mail-like ID or a GUID in braces (AC-ST.4).
const GECKO_ID_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$|^\{[0-9a-f-]{36}\}$/i;

describe('manifest sources', () => {
  it('sources have no broad host permissions', () => {
    for (const [file, manifest] of Object.entries(sources)) {
      for (const key of ['host_permissions', 'optional_host_permissions']) {
        const hosts = manifest[key] ?? [];
        for (const host of BROAD_HOSTS) {
          expect(hosts, `${file} ${key}`).not.toContain(host);
        }
      }
    }
  });

  it('sources have no web_accessible_resources', () => {
    for (const [file, manifest] of Object.entries(sources)) {
      expect(manifest, file).not.toHaveProperty('web_accessible_resources');
    }
  });

  it('permissions subset of activeTab, scripting', () => {
    for (const [file, manifest] of Object.entries(sources)) {
      for (const permission of manifest.permissions ?? []) {
        expect(ALLOWED_PERMISSIONS, `${file}: ${permission}`).toContain(permission);
      }
    }
  });

  it('overlays only use allowed target keys', () => {
    // D4: overlays may only add target-specific keys; everything shared lives in the base.
    for (const key of Object.keys(chrome)) {
      expect(['minimum_chrome_version'], `chrome overlay: ${key}`).toContain(key);
    }
    for (const key of Object.keys(firefox)) {
      expect(['browser_specific_settings'], `firefox overlay: ${key}`).toContain(key);
    }
  });

  it('description is a single sentence', () => {
    const { description } = base;
    expect(typeof description).toBe('string');
    expect(description.length).toBeLessThanOrEqual(132);
    expect(description).not.toContain(';');
    const enders = description.match(/[.!?]/g) ?? [];
    expect(enders).toHaveLength(1);
    expect(description).toMatch(/[.!?]$/);
  });

  it('gecko id is email-like or braced GUID', () => {
    const id = firefox.browser_specific_settings?.gecko?.id;
    expect(id).toMatch(GECKO_ID_RE);
  });

  it('firefox strict_min_version is 128.0', () => {
    expect(firefox.browser_specific_settings?.gecko?.strict_min_version).toBe('128.0');
  });

  it('README Uprawnienia section mentions every permission', () => {
    const readme = readFileSync(root + 'README.md', 'utf8').replace(/\r\n/g, '\n');
    const match = readme.match(/^## Uprawnienia\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    expect(match, 'README has a "## Uprawnienia" section').not.toBeNull();
    const section = match[1];
    expect(base.permissions.length).toBeGreaterThan(0);
    for (const permission of base.permissions) {
      expect(section, permission).toContain(`\`${permission}\``);
    }
  });
});
