# E0 — Fundament: repo, build, testy, higiena MV3 — stan

faza: review-qa
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
- [x] E0-T14b scripts/build.mjs (build({srcDir,outDir,targets})), tests/unit/helpers/build-to-tmp.js — 12 testów ✓; dist 70 KB/target, 11 plików;
  web-ext lint 0 errors / 2 warnings (data_collection_permissions vs min 128 — dopuszczone w D4); npm test 165/165

Grupa D (po T14b)
- [x] E0-T6  tests/unit/icons.test.js — PNG/IHDR bez zależności, 36 962 B/target, zgodność z manifestem — 9 testów ✓
- [x] E0-T10 tests/unit/manifest-parity.test.js — diff ścieżka po ścieżce, 5 negatywnych, min_chrome 121, gecko regex, brak background — 8 testów ✓
- [x] E0-T15 scripts/pack.mjs (fflate, mtime 1980-01-01 lokalny, level 9) → dist/page-debug-snapshot-{chrome,firefox}-1.0.0.zip
  (48 KB każdy, deterministyczne SHA-256) — 6 testów ✓; web-ext lint na zipie: 0 errors / 2 warnings (j.w.)
  **UWAGA dla fazy Testy:** `npm test` wydłużył się z ~1 s do ~46 s (97% to start środowisk jsdom/build w tmp) — AC-3.2 wymaga ≤ 30 s.
  Do zbadania: wspólny build w `globalSetup` zamiast `buildToTmp` per plik; `environment: node` tam, gdzie jsdom niepotrzebny.
- [x] E0-T9  `npm run lint` kod 0: eslint 0/0 (było 25 errors; bloki per katalog, spike w ignores), web-ext 0 errors / 2 warnings:
  KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION i …ANDROID… — `data_collection_permissions` (Firefox 140/142) vs `strict_min_version` 128.
  **Ocena orkiestratora (ryzyko R4):** dopuszczalne — Firefox < 140 ignoruje nieznany klucz, a AMO wymaga go dla nowych zgłoszeń;
  podniesienie min do 140 zawęziłoby zgłaszających bez korzyści. Decyzja do potwierdzenia w E0-R2 (store review) i E5.
- [x] E0-T16b playwright.config.js, tests/e2e/helpers/launch.js (launchWithExtension, openPopupFor → {evaluate,click,textOf,waitForText}, expectDownload),
  global-setup (build + git status) / global-teardown (AC-3.4 guard), harness.spec.js — 3 e2e ✓, 10/10 stabilnych, 2–6 s; `waitForEvent('download')` działa
- grupa E start (2026-10-22): T7a, T7b równolegle
- [x] E0-T11 scripts/dev-browser.mjs (web-ext 10 `cmd.run`, target chromium/firefox-desktop; Chrome ładowany przez CDP
  `Extensions.loadUnpacked`, więc blokada `--load-extension` ≥137 nie dotyczy) + dev-browser.ps1 jako wrapper — 7 testów ✓;
  czasy: chrome ~5–8 s, firefox ~16 s (AC-7.3 ✓); `PDS_CHROMIUM_BINARY` wybiera binarkę (domyślnie chrome-launcher wziął Canary)
  Docs: dopisać `PDS_CHROMIUM_BINARY` do pds-browser; profile `pds-dev-profile-*` nieużywane. Sprzątanie: `%TEMP%\firefox-profile*` po wymuszonym zamknięciu.

Grupa E (po T16b)
- [x] E0-T7a tests/e2e/{smoke,failure,restricted}.spec.js + helpers/download.js — 6 e2e ✓ (AC-1.1, 1.2, 1.3, 1.4e2e, 2.3, 6.5);
  mediana klik→download ≈ 48–67 ms (baseline 411f60e niezmierzony → QA porównuje); restricted w ~1,1 s
  Uwaga dla T7b/T9: `tests/e2e/csp.spec.js` ma `no-undef window` (l. 28) — lint czerwony do poprawki.
- [x] E0-T7b tests/e2e/{double-click,csp,packed-zip}.spec.js + helpers/unzip.js — 4 e2e ✓ (AC-1.5, 2.4, 4.5); pack() do tmp, nie do dist/
- **Implementacja zakończona 2026-10-22: 20/20, 195 unit, 13 e2e, lint zielony. Commity: 8a13cc2, 93c809b, 23f1a1b, +grupa E.**

Fazy po implementacji
- [x] E0-TEST pds-tester: lint ✓, unit 195/195 (1,5 s — AC-3.2 ✓; 46 s nieodtworzone, prawdopodobnie cold cache), e2e 13/13 ×3, 43/43 AC → docs/epics/E0/test-coverage.md. Werdykt: zielone.
- [~] E0-R1 pds-reviewer ✓ (approve-with-fixes) ∥ E0-R2 pds-store-reviewer ✓ (would-be-rejected dla dziś; E0 nie blokuje — blokery w E1/E3/E5, docs/epics/E0/store-review.md) ∥ E0-Q1/Q2 pds-qa ✓ **FAIL** (38 PASS / 4 FAIL / 1 BLOCKED) → poprawki F7, F8 → re-QA

### Findings R1 (pds-reviewer, 2026-10-22) — do poprawki w E0 (grupa F)
- [x] F1 [medium] ✓ (-Pack → npm run pack; 2 testy) scripts/dev-browser.ps1:44 — regex `'
ode_modules'` zepsuty w T11 → `-Pack` zawsze pada. Poprawka: `-Pack` deleguje do `npm run pack` (dist ma już tylko osiągalne pliki), usunąć własny filtr i Compress-Archive.
- [x] F2 [low] .gitignore — `*.xpi`, `web-ext-artifacts/` dodane.
- [ ] F4 [medium, store] README: dopisać sklepowe (PL+EN) wersje uzasadnień uprawnień z store-review.md — faza Docs.
- [ ] F5 [low, store] Release: manifest version = wersja release (0.2.0); nic nie było wysłane do sklepów.
- [x] F6 [high, store + decyzja użytkownika 2026-10-22] ✓ scripts/icons.mjs + icons-script.test.js (3), PNG 139/311/927 B, 200/200 — **Plugin niezależny, bez brandingu Agory**: `gecko.id` → GUID `{799eb178-df9a-41bb-9775-8fc8aff45926}`
  (zrobione), ikony 16/48/128 → generowane skryptem `scripts/icons.mjs` (neutralne, bez tekstu/logo, margines wg CWS), README/docs bez odniesień do organizacji.
- [~] F7 [critical, QA Firefox] `files: ['page/page-debug-snapshot.js']` — Firefox rozwiązuje względem popupu → zrzut nie działa na żadnej stronie.
  Poprawka: wiodący `/` + walker akceptuje root-relative. Luka testów: unit mockują executeScript, e2e tylko Chromium.
- [~] F8 [high, QA Chrome] `file://` bez zgody: `tab.url` undefined → `unknown` → sonda pominięta → `restricted` zamiast `fileAccess`.
  Poprawka: URL z treści błędu Chrome + sonda przy `unknown`.
- QA pozostałe: czysty klon zielony (200 unit, 13 e2e), dev:chrome ~1 s, dev:firefox ~2,7 s, AC-2.2 OK w obu, zrzut 9 ms;
  baseline 411f60e niemierzalny (stara wersja nie tworzy pliku — inject.js w ISOLATED; fałszywy sukces). AC-5.5 BLOCKED do DOC1.
  qa-evidence: 66 PNG (5 MB) lokalnie, ignorowane; logi/txt/json śledzone.
- [ ] F3 [medium→QA] fałszywy sukces przy zablokowanych automatycznych pobraniach w Chrome („Blokuj” w „Ta strona chce pobrać wiele plików”) — QA ręczne: dwa kliknięcia bez interakcji ze stroną w zwykłym Chrome; naprawa w E1 (patrz backlog).
Poza E0 (dopisane do backlogu): E1 — `downloads` permission + sukces po `onChanged state=complete`; sprawdzanie `pds.version` w `runInPage` (strona może podstawić obiekt → fałszywy sukces); timeout `executeScript` (~15 s) z komunikatem; walker fail-safe na `url(`/`getURL(`. E3 — usunąć global `window.__PAGE_DEBUG_SNAPSHOT__` (pełna paczka dostępna skryptom strony).
Do decyzji użytkownika: mechanizm pobierania w E1 (`downloads` permission = jedno uprawnienie więcej, ale prawdziwy wynik).
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
