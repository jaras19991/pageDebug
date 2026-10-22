# E1 — Pokrycie AC testami (faza Testy, 2026-10-22)

Przebieg na wyłączność: lint 0 errors (web-ext 0 errors / 2 warnings `strict_min_version` — dopuszczone jak w E0) · `npm test` 593/593 w 37 plikach, 2,6–3,0 s (3 przebiegi) · `npm run test:e2e` 39/39 (3 przebiegi po 65–67 s, zero porażek) + `--repeat-each 3` 111/111 (3,0 min) · `gen --check` 0 · dist 186 KB / target (150 KB plików).
Skróty: U = vitest (`tests/unit/<plik>::<nazwa>`), E = Playwright (`tests/e2e/<plik>::<nazwa>`), QA-C / QA-F = QA ręczne Chrome / Firefox (F1–F18 z design.md „Plan testów”), R = review, WL = `web-ext lint`.
Nazwy testów w design.md częściowo się rozjechały z kodem; poniżej nazwy rzeczywiste (skrócone do rozpoznawalnego fragmentu).

| AC | Pokrycie |
|---|---|
| 1.1 | U popup-html::popup.html static disclosure text equals MESSAGES, disclosure sits above the record button; U messages::disclosure lists the five categories…; U popup-view::ready model shows disclosure section; E recording.spec::ready popup shows disclosure, no-upload sentence and reload notice; QA-F F1 |
| 1.2 | U popup-controller::opening popup sends only getStatus; E recording.spec::nothing is collected before Nagrywaj; QA-F F1 |
| 1.3 | U background-recording::start registers both scripts…reloads tab exactly once, start twice with same requestId reloads once; U messages::recordingSince matches; E recording.spec::Nagrywaj reloads the tab exactly once, start→reload ≤ 2 s; QA-F F3 |
| 1.4 | U background-recording::start without granted permission returns permissionDenied, stale pending…; U popup-controller::denied permission → disarm; E restricted.spec::consent prompt closed without allowing: permissionDenied; QA-C + QA-F F2 (jawne „Odrzuć” w bąblu) |
| 1.5 | U background-recording::fresh handler instance reads the same status after restart; E recording.spec::status survives popup reopen and service worker stop; E navigation.spec::service worker stop during recording; QA-F F7 |
| 1.6 | U background-recording::hello from recording tab… badge set; E recording.spec::badge is set on recording tab only; QA-F F13 |
| 1.7 | U popup-controller::it.each restricted/fileAccess/noTab; U popup-view::%s hides both sections; E restricted.spec::chrome://version, about:blank (≤ 2 s, bez przeładowania i permissions.request); QA-C: strona CWS (Playwright traci kartę), `file://`; QA-F F10 |
| 1.8 | U messages::messages contain no forbidden words; U popup-html::every <button> has a Polish label |
| 1.9 | U recorder::stop('time-limit')…, deadline already passed at config; U background-recording::resolveLimitMs…, getStatus after deadline, hello after deadline, stopped message; U popup-view::stopped view; U save::stopped by the limit and the tab reloaded since; E time-limit.spec (limit 3 s); QA-F F15 |
| 2.1 | U save::happy path, success is reported only after onChanged complete; U popup-controller::Zapisano shown only after status saved; E recording.spec::save: Zapisano names the file that exists in download dir; E recording.spec::NFR save→Zapisano (mediana 122 ms z 5); QA-F F8 |
| 2.2 | U save::saveFailed…downloadFailed, USER_CANCELED → saveCancelled; U popup-controller::interrupted download…; E failure.spec::download blocked by the browser: saveCancelled…; QA-C „Pytaj, gdzie zapisać” + Anuluj; QA-F F9 |
| 2.3 | QA-C (Automatyczne pobieranie = Blokuj, log jak requa-chrome-f3.log); QA-F F8b |
| 2.4 | U save::no collect answer within 15 s → pageBusy, download not complete within 60 s; U popup-controller::onSave: collect not answered in 15 s; E failure.spec::page main thread blocked during save (pageBusy po ≥ 14,5 s) + verdict stays on screen |
| 2.5 | U save::happy path (clearRec, destroy); E recording.spec::after save: reload has no recorder and after-log not in next package; QA-F F8 |
| 2.6 | U background-recording::onTabRemoved…, onStartup/onInstalled unregisters scripts and clears state; E recording.spec::closing the recording tab drops it; QA-C restart; QA-F F11 |
| 3.1 | U manifest-sources::permissions subset…, no host_permissions or empty, optional_host_permissions exactly http/https/file; U build::dist manifests: same permission rules; WL; QA-F (about:addons) |
| 3.2 | U origin/session-store (T1a, originPatternFor tabela); U popup-controller::onRecord calls permissions.request… exactly [pattern]; QA-F F1 (treść okna zgody) |
| 3.3 | U background-recording::hello from another tab → record:false; U recorder::setConfig({record:false}); U isolated/main entry (content-scripts.test); E navigation.spec::second tab of the same origin; QA-F F14 |
| 3.4 | U background-recording::getStatus marks otherOrigin; U save::tab on other origin → package from stored docs; U package::current null; E navigation.spec::navigation to localhost; QA-F F14 |
| 3.5 | U manifest-sources::README Uprawnienia mentions every permission… PL and EN |
| 4.1 | E recording.spec::head error, early fetch 500, console.error and rejection… t < domContentLoadedEventStart; QA-F F4 |
| 4.2 | ta sama fixture (early-error.html), E recording.spec jw.; QA-F F4 |
| 4.3 | E navigation.spec::pushState/replaceState/popstate; QA-F F5 |
| 4.4 | U background-recording::flush stores document; U session-store (budżet putDoc); U package::prior and current documents merged, dropped prior document… note; E navigation.spec::full reload within origin; QA-F F6 |
| 4.5 | U package::header has schemaVersion 2…, every record has numeric t and doc; E recording.spec::save: … header fields; QA-F F8 |
| 4.6 | U hooks-console::console record has level, serialized args, t and stack containing the calling function name; `console.error calls the original once` |
| 4.7 | U recorder::recorder never writes to console; E recording.spec::package has no extension-generated console entries; QA-F F4 |
| 4.8 | U buffer::6000 pushes with max 5000…; U recorder::6000 console.log keep 5000 newest; U package::global limit keeps newest; E perf.spec::flood (3 testy: 5000 + truncated, 20 000×1 KB → 4,2 MB) |
| 4.9 | U recorder::records after deadline are dropped; U package::recordingStoppedReason is time-limit or null; U save::auto-stopped recording → time-limit; E time-limit.spec; QA-F F15 |
| 5.1 | U hooks-network (XHR: instanceof, DONE, prototype, axios-like, subclass); E isolation.spec::axios-like XHR client works and is recorded; QA-F F18 |
| 5.2 | U hooks-network::fetch(new Request…), fetch(new URL…), same response object / bodyUsed false, rejection rethrown |
| 5.3 | U hooks-network/hooks-console/hooks-errors::restore(); U recorder::destroy restores … (===); E isolation.spec::after save fetch/XHR/console differ from recording-time wrappers |
| 5.4 | U recorder::install defines non-enumerable frozen marker, window own property names/symbols…; U no-e0-flow::no __PAGE_DEBUG_SNAPSHOT__; E isolation.spec::no own window property… holds the console marker |
| 5.5 | U recorder::second install in same window is a no-op; E isolation.spec::second injection of main-world.js does not duplicate entries |
| 5.6 | U channel::page listener sees no message, forged pds:isolated-ready, wrong nonce, no chrome.* and no postMessage; U save::content result cannot set file name or success; E isolation.spec::hostile page…; QA-F F18 (opcjonalnie) |
| 6.1 | U background-router::importing background.js registers all listeners synchronously, … use no importScripts, window…; U manifest-parity::chrome has service_worker, firefox background.scripts; WL; QA-F F7 |
| 6.2 | U content-scripts::scriptsFor … js root-relative; U reachable-files::follows js: […] as root-relative; U build::registered content files exist in both dist targets |
| 6.3 | U reachable-files::throws on url( / getURL( non-literal / import() with template literal / importScripts( |
| 6.4 | R + QA-F F1–F18 (każdy osobno w qa-report.md; 18 ≥ 10) |
| 6.5 | U serialize::deepMerge does not share references with source |
| 7.1 | U console-entry::equals the generator output, without a hand-copied hook; U gen-content::real bundles pass eslint, check mode; `npm run gen -- --check` |
| 7.2 | U console-entry::pasting … prints the exact Polish hint; E console-fallback.spec; QA-F F12 |
| 7.3 | U console-entry::snapshot has schemaVersion 2, source console…; E console-fallback.spec; QA-F F12 |
| 7.4 | U build::dist contains no forbidden files |

NFR: rozmiar `dist/*` < 500 KB — U build::each target is under 500 KB (150 KB) + zipy 53 KB; narzut hooków — E perf.spec (przebieg na wyłączność, `test-results/hooks-overhead.json`: fetch mediana −0,1…0 ms, p95 −0,2…0 ms; console p95 narzut 0,01–0,03 ms; spec ≤ 2 / ≤ 0,5 ms); flood 20 000×1 KB → 4,2 MB ≤ 10 MB; save → Zapisano mediana z 5 = 122 ms ≤ 5 s (recording.spec); `npm test` 3 s ≤ 30 s, e2e 66 s ≤ 5 min; prywatność: U save::state lives only in storage.session, background-router::use no … localStorage…; stabilność: 111/111 `--repeat-each 3`, bez `retries`.

## Regresje E0 — AC zastąpione przez E1
- AC-2.1 (E0): `manifest-sources` zaktualizowany (permissions ⊆ activeTab/scripting/storage/downloads, `optional_host_permissions` dokładnie http/https/file) — nie usunięty.
- AC-6.5 (E0, klucze v1): `package.test::matches assemblePackage output shape` + `fixtures/snapshots/v2.json` (v2); smoke E0 zastąpiony `recording.spec` (nagłówek v2).
- AC-6.1–6.4 (E0): `page-debug-snapshot.test` usunięty z modułem → `serialize.test` (deepMerge, safeSlice, safeJson, serializeCapped) + `buffer.test` (pushLimited → createBuffer).
- AC-1.1/1.2/1.3/2.4 (E0): `smoke/failure/restricted/csp.spec` → `recording/failure/restricted/isolation(csp-strict).spec`.
- AC-3.3 i AC-2.3 (E0) nie miały następcy w E1 → **dopisane** w `harness-e1.spec.js`: `e2e loads the extension from dist/chrome`, `recording and saving leave no extension nodes in the page`.

## AC E0 bez pokrycia po E1
- AC-1.5 (E0, „dwa kliknięcia = dwa pliki”): przepływ zniesiony (decyzja 4 bramki Spec: jeden przepływ Nagrywaj → Zapisz). Następcy: popup-controller::a second click while saving is ignored; recording.spec::after save… (drugi zapis po nagraniu daje drugi plik); QA-F F8b. Uznane za zastąpione, nie za lukę.
- AC-1.2 (E0, „zrzut kończy się wyjątkiem” + throw-on-snapshot.html): fixture usunięty z przepływem; następca failure.spec (pageBusy/saveCancelled) — inny scenariusz, ten sam cel (brak fałszywego sukcesu).
- Pozostałe AC E0: bez zmian w pokryciu (testy nietknięte, 593/593 zielone); do QA ręcznego jak w `docs/epics/E0/test-coverage.md` (1.6 Chrome, 2.2, 7.1–7.4, Q1; 5.2/ST.1 review; 5.5 Docs).

## Do QA ręcznego (pds-qa)
Firefox F1–F18 (brak e2e na Firefoksie: bąbel zgody, `about:debugging`, restart przeglądarki, `file://`, katalog tylko do odczytu); Chrome: 1.4 jawne „Odrzuć”, 1.7 strona CWS, 2.2 „Pytaj, gdzie zapisać”, 2.3 blokada pobrań z logiem, 2.6 restart, `file://` PB-1, scenariusz E1-Q1.
