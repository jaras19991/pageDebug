# E0 — Pokrycie AC testami (faza Testy, 2026-10-22)

Przebieg: lint kod 0 (web-ext 0 errors / 2 warnings, dopuszczone) · `npm test` 195/195 w 17 plikach, ~1,5 s (3 przebiegi) · `npm run test:e2e` 13/13 w ~8,5 s (3 przebiegi), zero flaky.
Skróty: U = vitest (`tests/unit/<plik>::<nazwa>`), E = Playwright (`tests/e2e/<plik>::<nazwa>`), QA-C / QA-F = QA ręczne Chrome / Firefox, R = review.

| AC | Pokrycie |
|---|---|
| 1.1 | E smoke.spec::smoke: one json downloaded and status contains its filename; U messages::success message contains the file name; U snapshot-tab::returns success with fileName; QA-F |
| 1.2 | E failure.spec::failure: error status in Polish, no success text, no download; U snapshot-tab::returns failed when files injection rejects with an unknown error + it.each snapshot-failed/brak wyniku; QA-F (throw-on-snapshot.html) |
| 1.3 | E restricted.spec::restricted: chrome://version shows restricted message within 2 s; U snapshot-tab::it.each chrome://, chromewebstore, about:blank; U target::classifyUrl, mapInjectionError; U messages::restricted message starts with…; QA-F (about:addons, AMO) |
| 1.4 | U messages::messages contain no forbidden words |
| 1.5 | E double-click.spec::double click: two files…; U snapshot-tab::second snapshot on same tab does not inject files again; U snapshot-tab::injects page script only when runInPage reports not-loaded; U run-in-page::does not re-init when initialized; QA-F |
| 1.6 | U snapshot-tab::returns fileAccess when file scheme access disallowed in Chrome…; U target::mapInjectionError; U messages::fileAccess message names the Chrome setting; QA-C (file:// ze zgodą i bez) |
| 2.1 | U manifest-sources::sources have no broad host permissions / no web_accessible_resources / permissions subset; U build::dist manifests have no broad host permissions nor WAR |
| 2.2 | QA-C + QA-F (Szczegóły / about:addons) |
| 2.3 | E smoke.spec::smoke: no chrome-extension script nodes added and no leftover nodes |
| 2.4 | E csp.spec::csp strict page: download and success; QA-F (R6) |
| 2.5 | U build::inject.js absent in src and both targets |
| 3.1 | U package-json::lint script runs eslint and web-ext lint on dist/firefox; pełny przebieg w świeżym klonie = QA Q1 (lokalnie: lint/test/e2e zielone) |
| 3.2 | Pomiar: npm test ~1,5 s, e2e ~8,5 s (Q1 potwierdza w czystym klonie); vitest environment node, bez sieci; e2e headless z lokalnym serwerem |
| 3.3 | E harness.spec::loads extension from dist/chrome |
| 3.4 | E global-teardown.js (porównanie `git status --porcelain`); przechodzi w 3/3 przebiegach |
| 3.5 | QA Q1 (odwrócona asercja safeSlice; wg state.md T8 sprawdzone ręcznie) |
| 4.1 | U build::build is deterministic; build::build removes stale files |
| 4.2 | U build::every dist file is reachable and every reference exists; U reachable-files::* (walker) |
| 4.3 | U build::dist contains no forbidden files; U pack::zip contains no forbidden files |
| 4.4 | U build::each target is under 500 KB |
| 4.5 | U pack::creates exactly two zips…, zip has manifest.json at root, unzipped content equals dist/<target> byte for byte; E packed-zip.spec::packed chrome zip loads and passes smoke; E packed-zip.spec::packed firefox zip exists with manifest.json at root; WL (`web-ext lint` dist/firefox) |
| 4.6 | U package-json::has no dependencies section; has web-ext in devDependencies and no sharp anywhere |
| 4.7 | U icons::icons are PNG with exact sizes 16…, icons total ≤ 50 KB, no logo*.png in dist |
| 4.8 | U manifest-parity::manifests identical except target keys, fails on extra difference, chrome has minimum_chrome_version 121…, firefox has gecko.strict_min_version…; U manifest-sources::overlays only use allowed target keys; U merge-manifest::throws on overriding base key / non-target key |
| 5.1 | U repo-hygiene::current index has no forbidden paths; U repo-hygiene::forbiddenTracked flags pem… |
| 5.2 | R (E0-R1: `npm run check:history` + `git ls-remote origin main` po force pushu); logika U repo-hygiene::forbiddenInHistory * |
| 5.3 | U layout::no tracked files under page-debug-extension/; U repo-hygiene::current index…; QA Q1 (ls po klonie) |
| 5.4 | U repo-hygiene::tests contain no production domains |
| 5.5 | QA/Docs (README jeszcze niepisane — DOC1); sekcja Uprawnienia: U manifest-sources::README Uprawnienia section mentions every permission |
| 5.6 | U repo-hygiene::.gitignore contains src/icons/logo*.png |
| 6.1 | U page-debug-snapshot::deepMerge merges nested objects / replaces arrays / returns copy of target… / does not mutate target |
| 6.2 | U page-debug-snapshot::safeSlice keeps short string / truncates with exact N suffix / returns non-string unchanged |
| 6.3 | U page-debug-snapshot::pushLimited drops oldest and keeps length max |
| 6.4 | U page-debug-snapshot::safeJson (funkcje, Error, Element, cykl, BigInt, znane dziwactwo) |
| 6.5 | E smoke.spec::smoke: package top-level keys and version 1.0.0 |
| 7.1 | QA-C (`npm run dev:chrome`, tymczasowy profil); U dev-browser::parseArgs/runOptions |
| 7.2 | QA-F (ikona na pasku) |
| 7.3 | QA-C/QA-F stoperem (state.md T11: chrome 5–8 s, firefox ~16 s); U dev-browser::parseArgs accepts chrome and firefox |
| 7.4 | U dev-browser::cli exits with code 2 for unknown browser; U dev-browser::parseArgs rejects unknown browser…; QA (`.ps1 -Browser opera` kod ≠ 0) |
| ST.1 | U manifest-sources::description is a single sentence; R (E0-R2 single purpose) |
| ST.2 | U build::no remote code |
| ST.3 | U manifest-sources::README Uprawnienia section mentions every permission |
| ST.4 | U manifest-sources::gecko id is email-like or braced GUID; U manifest-parity::gecko id regex…, firefox has gecko… |

Bez testu automatycznego i bez scenariusza QA/R: brak.
Do QA ręcznego (pds-qa): 1.6 (Chrome), 2.2, 7.1–7.4, 3.1/3.2/3.5/5.3 w czystym klonie (Q1), Firefox: 1.1, 1.2, 1.3, 1.5, 2.2, 2.4, 7.2. Do review: 5.2, ST.1. Do Docs: 5.5.
