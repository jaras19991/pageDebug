# E0 — Fundament: repo, build, testy, higiena MV3 — stan

faza: implement
rozpoczęto: 2026-10-21
ostatnia aktualizacja: 2026-10-21 23:50

## Zadania (wg design.md — 20; D1–D13 i S1 zamknięte w Spec/Design)

Grupa A (sekwencyjna)
- [x] E0-T2  root package.json (bez dependencies), vitest/jsdom, Playwright, eslint 10, web-ext, fflate — 4 testy ✓
- [x] E0-T13 git mv → src/{popup,page,icons,standalone}, manifest.base.json; commit 8a13cc2 — 3 testy ✓

Grupa B (równolegle)
- [x] E0-T4  manifest.base/chrome/firefox; permissions [activeTab, scripting]; README „Uprawnienia” — 8 testów ✓; gecko.id = PLACEHOLDER
- [x] E0-T8  testy charakteryzacyjne page-debug-snapshot.js (deepMerge 4, safeSlice 3, pushLimited 1, safeJson 7) + helper — 17 testów ✓; AC-3.5 sprawdzone ręcznie; npm test 153/153
- [x] E0-T5  src/popup/{run-in-page,messages}.js — 16 testów ✓
- [x] E0-T12 src/popup/target.js (classifyUrl, mapInjectionError, isFirefoxRuntime, isFileAccessAllowed) — 52 testy ✓
- [x] E0-T1  .gitattributes, scripts/check-repo.mjs (--history, --include-remotes) — 9 testów ✓; check:history kod 0
- [x] E0-T14a scripts/lib/{manifest,reachability}.mjs — 16 testów ✓
- [x] E0-T16a tests/e2e/helpers/fixtures-server.js + pages (basic, throw-on-snapshot, csp-strict) — 7 testów ✓
- [x] E0-T17 SPIKE: CDP Extensions.triggerAction działa (headless/headed) → PB-1 niepotrzebny; docs/epics/E0/spike-T17.md

Grupa C
- [x] E0-T3  popup: snapshot-tab.js + popup.js (executeScript MAIN ×2), inject.js usunięty — 22 testy ✓; walker OK na src/
- [~] E0-T14b scripts/build.mjs → dist/chrome, dist/firefox + testy AC-4.1/4.2/4.3/4.4/4.8/ST.2 — W TOKU

Grupa D (po T14b)
- [ ] E0-T6  test ikon w dist/*/icons (wymiary, łącznie ≤ 50 KB)
- [ ] E0-T10 test porównawczy manifestów dist/chrome vs dist/firefox
- [ ] E0-T15 npm run pack: dwa zipy (fflate, stały mtime)
- [ ] E0-T9  npm run lint zielony (eslint + web-ext lint)
- [ ] E0-T16b harness e2e na dist/chrome (CDP triggerAction wg spike-T17)
- [ ] E0-T11 dev-browser.mjs (web-ext dla obu) + zmiany w dev-browser.ps1

Grupa E (po T16b)
- [ ] E0-T7a e2e: smoke, błąd zrzutu, strona specjalna, pomiar czasu
- [ ] E0-T7b e2e: podwójne kliknięcie, CSP, paczka z zipa

Fazy po implementacji
- [ ] E0-TEST pds-tester: pełny przebieg + pokrycie planu testów
- [ ] E0-R1 pds-reviewer; E0-R2 pds-store-reviewer; E0-Q1/Q2 pds-qa (Chrome e2e, Firefox web-ext run)
- [ ] E0-DOC1 README, instrukcja, CHANGELOG; aktualizacja ścieżek w CLAUDE.md i skillach (page-debug-extension → src/)
- [ ] E0-REL release 0.2.0

### Notatki dla kolejnych zadań
- T16b: popup NIE jest Page w Playwright — sterowanie przez CDP (`Target.sendMessageToTarget` + `Runtime.evaluate`);
  `triggerAction` na świeżej karcie lub po `goto`; flaga `--enable-unsafe-extension-debugging`; `waitForEvent('download')` do potwierdzenia.
- T7a: throw-on-snapshot.html psuje też `page.title()` w Playwright.
- T9: sprawdzić, czy `tests/unit/helpers/load-page-script.js` nadal ma błędy eslint (no-undef window, no-eval) po finalnej wersji T8.
- jsdom: globalny `URL` z jsdom psuje `fileURLToPath(new URL(rel, import.meta.url))` — używać `path.resolve(dirname(fileURLToPath(import.meta.url)))`.
- E1 (do backlogu): `deepMerge` wkłada zagnieżdżone obiekty ze źródła przez referencję (brak kopii) — naprawić przy refaktorze.
- T14b: walker nie zwraca `manifest.json`; `files:` tylko literały.
- R1: `node scripts/check-repo.mjs --history --include-remotes` po `git fetch`; `npm audit` 3 high w web-ext (devDependency).

## Blokery
- (brak)

## Notatki z implementacji
- T2: eslint 9.39 oznaczony jako niewspierany → decyzja orkiestratora: eslint 10 (w T13). `npm audit`: 3 high
  w `web-ext` (node-forge, adbkit) — tylko devDependency, nie trafia do paczki; do odnotowania w E0-R1.
  Skill `extension-testing` ma `headless: false` w przykładzie — do poprawy w fazie Docs.

## Decyzje użytkownika
- 2026-10-21 (bramka Spec): (1) historia gita przepisana — logo poza commitami; (2) źródłowe logo **usunięte z dysku** — ikony 16/48/128
  jedynym źródłem, bez skryptu ikon i `sharp`; (3) tylko `.zip`, bez `.crx`; (4) `file://` zostaje z polskim
  komunikatem; (5) CI lokalnie, e2e headless-capable; (6) `console-snapshot.js` bez zmian; (7) `.pem` przenosi użytkownik.
- 2026-10-21: **dwa targety od E0 — Chrome i Firefox** (MV3, jedna baza, `dist/chrome` + `dist/firefox`).
- 2026-10-21: nowy agent `pds-store-reviewer` w fazie Review (zgodność z Chrome Web Store / AMO).
- 2026-10-21 (bramka Design): **PB-1 zatwierdzone z góry** — jeśli spike T17 (CDP `Extensions.triggerAction`) padnie,
  e2e używa kopii `dist/chrome` z `host_permissions: ["http://127.0.0.1/*"]` i popupu z `?tabId=`.
  `gecko.id`: użytkownik poda własną wartość (nie `page-debug-snapshot@agora.pl`) — **potrzebne przed E0-T4**.

## Historia faz
- 2026-10-21 init → spec
- 2026-10-21 spec.md gotowy (pds-analyst); poprawka orkiestratora: `.pem` leży w root (ignorowany, poza historią), repo wypchnięte na GitHub. Bramka Spec: 7 pytań.
- 2026-10-21 odpowiedzi użytkownika + wymaganie Firefox → spec.md zaktualizowany (pds-analyst, 221 linii, 7 US, 43 AC). **Bramka Spec: zatwierdzona.** spec → design.
  Po stronie użytkownika przed Release: `git push --force-with-lease`, przeniesienie `.pem`.
- 2026-10-21 design.md gotowy (pds-architect): 13 decyzji, 20 zadań w 5 grupach, `minimum_chrome_version` 121,
  `gecko.id` propozycja `page-debug-snapshot@agora.pl`. Bramka Design: PB-1 i gecko.id.
- 2026-10-21 **Bramka Design: zatwierdzona** (PB-1 tak; gecko.id — własna wartość, oczekiwana). design → implement.
  Grupa A: E0-T2 (start), potem E0-T13. Zadania wg design.md (20): T2, T13, T4, T8, T5, T12, T1, T14a, T16a, T17,
  T14b, T3, T6, T10, T15, T9, T16b, T11, T7a, T7b.

## Retro
- (po zamknięciu)
