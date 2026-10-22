# E1 — Model nagrywania: dane od startu strony — stan

faza: implement
rozpoczęto: 2026-10-22
ostatnia aktualizacja: 2026-10-22

## Zadania (z backlogu; design doprecyzuje)
- [x] E1-S1..S3 spec.md (pds-analyst): 7 US, 42 AC, schema v2 — bramka zatwierdzona
- [x] E1-D1..D13 design.md (pds-architect): 27 zadań / 7 grup, 44 AC, 18 scenariuszy QA Firefox — bramka zatwierdzona
- [~] E1-T1 tło (SW / event page)
  - [x] T1a src/lib/origin.js (originPatternFor → {origin,pattern}|null, originOf, isSameOrigin), src/lib/session-store.js (createStore(area,{docBudgetBytes,totalBudgetBytes}):
    getRec/updateRec(fn)/clearRec, putDoc→{stored}, listDocs, pending, last(tabId), getTestLimit [1000,600000]; klucze pds:rec/pending/doc:<id>/last:<tabId>/test:recordingLimitMs),
    tests/unit/helpers/fake-chrome.js (createFakeChrome → {chrome,calls,fake}; fake.completeDownload/interruptDownload) — 50 testów ✓
    Dla T1b: idempotencja `updateRec(rec => rec?.requestId===id ? undefined : nowy)`; updateRec fn nie może wołać store'a.
  - [x] T1b src/lib/recording.js — createRecordingHandlers({chrome,store?,now?}) → {armStart, disarm, start, onPermissionAdded, hello, flush, bridgeError, getStatus, onTabRemoved, onStartup, onInstalled};
    src/lib/content-scripts.js — SCRIPT_IDS {bridge:'pds-bridge', recorder:'pds-recorder'}, scriptsFor(pattern) (/content/{isolated,main}-world.js), registerFor, unregisterAll, setBadge — 38 testów ✓
    pds:rec = {v:1, requestId, tabId, origin, pattern, startedAt, limitMs, deadline, status, stopReason, docSeq, docs[{id,url,flushed,recorded?,bridgeError?}], save, lastError}
    hello → {record:true|false, docId, deadline, limitMs} (nie {config}/{destroy}); start → {ok,startedAt}|{ok:false,reason}; getStatus → {state:'idle'|'recording'|'stopped'|'saving', startedAt, stopReason, isRecordingTab, otherTabRecording, otherOrigin, lastSaved, lastError}
    T1c: jeden store dla recording+save; router sprawdza nadawcę; recording.js importuje ../popup/target.js. T6b: getStatus z ownRequestId. T12: RECORDING_LIMIT_MS → resolveLimitMs(getTestLimit()), leniwe wygaszanie, handler `stopped`.
  - [x] T1c background.js + manifesty (grupa E) ✓
- [ ] E1-T2 registerContentScripts dla origin karty; auto-reload (w T1b)
- [~] E1-T3 refaktor page-debug-snapshot.js → moduły ES
  - [x] T3a src/page/serialize.js (deepMerge głęboka kopia, safeSlice(value,max), safeJson bez fałszywego [Circular], serializeCapped → {value,chars,truncated}),
    src/page/buffer.js (createBuffer({maxItems,maxChars}) → push(entry,chars)/items()/truncated/clear), eslint bloki — 27 testów ✓
    Dla T3c: buf.push(record, res.chars); stop() nie woła clear(). Dla T14: helpery z prefiksem serialize*, bez importów.
  - [x] T3b src/page/collector.js — collectPageState({win,doc,safeSlice,limits}) → {environment,dom,performance,storage,errors}; sekcje z własnym try; COLLECTOR_LIMITS v1 — 10 testów ✓
    Decyzja orkiestratora dla T8a/T15: wpisy `errors` collectora trafiają do `notes` paczki jako „collector: <section> failed (<error>)”.
  - [x] T3c src/page/recorder.js + constants.js (RECORDER_VERSION, PROTOCOL=1, LIMITS, MARKER_KEY, CONFIG_TIMEOUT_MS) — isInstalled(win), createRecorder({win,options}) → {install, setConfig({record,docId,deadline}), stop(reason), destroy, exportBuffers, snapshot, …} — 19 testów ✓
    Dla T15: install() → setConfig(config) z kanału; record:false → destroy(); collect = {...collectPageState(), ...rec.snapshot()}; flush przy pagehide = {docId, buffers: exportBuffers()}; onStopped → `stopped`.
    Dla T7: setConfig({record:true}) bez deadline; stop('user'). Dla T12: deadline miniony przy config → stop od razu.
    Uwaga: `reachable-files.test.js › existing src/ still builds` czerwony (oczekuje page/page-debug-snapshot.js) — naprawia T17 przy usuwaniu przepływu E0.
- [x] E1-T4 src/page/hooks-network.js — installFetchHook/installXhrHook({win,now,record,json,intrinsics?,enabled?}) → restore(); NETWORK_LIMITS; record('network', entry) wg D12 — 30 testów ✓
  Uwaga D5: `fetch.toString()` na Proxy w V8 daje `function () { [native code] }` bez nazwy — design do korekty w Docs. Nagłówki (Authorization) jawne → E3.
- [x] E1-T5 src/page/hooks-console.js (installConsoleHook({win,now,record,json,levels,intrinsics?}) → restore(), stack bez wrappera, V8+Firefox, ≤4000 zn.)
  + hooks-errors.js (installErrorHooks(...) → restore()) — 27 testów ✓. Kontrakt dla T3c: record('consoleLogs'|'runtimeErrors', entry); json = v => serializeCapped(v, n).value; `doc` dokłada recorder.
- [~] E1-T6 popup 3 stany + **ujawnienie w UI** (blocker CWS ze store review E0)
  - [x] T6a messages.js (zbiór zamknięty: disclosure*, noUpload, reloadNotice, starting, recordingSince, stoppedByLimit, saving, saved…), popup.html
    (#ready/#recording hidden, #record, #save, #status) — 24 testy ✓. UWAGA: popup.js i e2e E0 czerwone do T6b/T17/T19 (brak #runSnapshot, MESSAGES.working/success usunięte).
  - [x] T6b src/popup/view.js (renderModel/applyModel), controller.js (createController(api) → {init,onRecord,onSave,refresh,destroy}), popup.js 28 linii — 53 testy ✓
    Protokół wg popupu: getStatus{tabId,url} → {state:'idle'|'starting'|'recording'|'stopped'|'saving', …, lastSaved:{fileName,downloadId}|null, lastError}; armStart{requestId,tabId,origin,pattern} (bez await) → permissions.request w tym samym ticku → start{requestId,tabId}; disarm; collect{tabId}; saveStarted{tabId,downloadId,fileName}; saveFailed{tabId,reason}.
    **ROZJAZDY do uzgodnienia w T12:** (1) T8b zapisuje pds:last {fileName, at} bez downloadId → popup nigdy nie pokaże `saved` — dodać downloadId; (2) popup nie wysyła ownRequestId w getStatus, a T1b tego wymaga, by nie skasować pending przy otwartym oknie zgody; (3) stan 'starting' z popupu vs T1b (idle/recording/stopped/saving); (4) brak klucza `downloadFailed` w messages.js (popup pokazuje failed/saveCancelled — akceptowalne, ale ujednolicić).
- grupa C zamknięta 2026-10-22; `reachable-files › existing src/ still builds` czerwony do T17 (asercja o page-debug-snapshot.js).
- [x] E1-T13 src/page/channel.js — connectMain/connectIsolated({doc,onMessage,onUnbound?,bindTimeoutMs?,...}) → {send,whenBound,isBound(),close()}; typy I2M: config/collect/destroy, M2I: result/flush/stopped; wariant D3 — 19 testów ✓ (AC-5.6)
  Dla T15: destroy() recordera przez onUnbound; ISOLATED bindTimeoutMs 2000 → bridgeError 'unbound'. Decyzja orkiestratora: zostaje CHANNEL_PROTOCOL (nie scalać z constants.js).
- [x] E1-T14 scripts/gen-content.mjs — bundle({entry,srcDir,banner,outFile}), generateAll({root,check}), `npm run gen [--check]`; każdy moduł we własnej funkcji w IIFE (brak kolizji nazw) — 20 testów ✓
  **Dozwolona składnia modułów src/page/ (dla T3c/T15/T7):** importy jednolinijkowe od kolumny 0; `export function|class|const|let|var <jedna nazwa>`; `export default`, `export {a, b as c};`, `export * from`, `export * as ns from`; ścieżki względne `.js` w src/page/; bez cykli, bez `import(`/`import.meta`/`require(` nawet w komentarzach; eksporty to snapshot (brak live bindings).
  T15 tworzy src/page/{main,isolated,console}-entry.js i uruchamia `npm run gen`.
- [x] E1-T7 src/page/console-entry.js → src/standalone/console-snapshot.js (55 KB, generowany; global PageDebugSnapshot {version,start,stop,download,snapshot}; komunikat z AC-7.2) — 9 testów ✓; layout.test: hash E0 → „wygenerowany i aktualny”
  Zmiana w gen-content.mjs: srcDir = src/ (import ../lib/package.js) — komentarze modułów `// module: page/x.js`. Uwaga T15/T1c: `collectPageState` zwraca errors {section,error}, assemblePackage czyta err.name → „(undefined)” w notes — poprawić w T1c (mała zmiana w package.js).
  `save.test.js` 4 czerwone w trakcie (T12 zmienia protokół równolegle) — T12 ma je uzgodnić.
- [x] E1-T15 src/page/{main,isolated}-entry.js → src/content/{main-world (57 KB), isolated-world (15 KB)}.js — 14 testów ✓; content/*.js trafia do dist przez literał js:[…] w content-scripts.js osiągalny z background.js (T1c)
  Odstępstwa: flush = {docId, data:{...snapshot(), docId}}; nonce z crypto.getRandomValues (randomUUID wymaga secure context); hello z 1 retry po 500 ms.
  **Bloker lintu → F-gen:** `no-unused-vars` na `const __pds_mN` modułu wejściowego w 3 bundlach. Decyzja orkiestratora: generator emituje moduł wejściowy bez przypisania; regeneracja bundli.
- [x] E1-F-gen gen-content: moduł wejściowy bez `const __pds_mN`; 3 bundle regenerowane; test ESLint API na prawdziwych bundlach — eslint 0, `gen --check` 0 — 2 testy ✓
  Backlog (nice-to-have): import tylko dla efektu ubocznego nadal dostaje nieużywaną stałą — generator mógłby pomijać przypisanie dla modułów bez użyć.
- [~] E1-T8 zapis
  - [x] T8a src/lib/package.js — assemblePackage({meta,current,priorDocs,docs}) → v2; packageFileName(now), SCHEMA_VERSION=2, DEFAULT_LIMITS; fixtures/snapshots/v2.json; docs/snapshot-schema.md v2+migracja — 18 testów ✓
    Dla T8b: docs = rec.docs; priorDocs = listDocs() z id; meta.stopReason/deadline z rec; JSON.stringify(pkg,null,2) w tle.
  - [x] T8b src/lib/save.js — createSaveHandlers(api) → {collect, saveStarted, saveFailed, onDownloadChanged, expireSave}; stan w pds:rec.save {phase,downloadId,fileName}, lastError; sukces → clearRec + pds:last:<tabId> — 27 testów ✓
    **Protokół (wiążący dla T1c/T6b/T15/T12):** popup→tło `collect{tabId}` → {ok,json,fileName}|{ok:false,reason:'pageBusy'|'failed'}; `saveStarted{downloadId}`; `saveFailed{reason}`.
    tło→ISOLATED `tabs.sendMessage(tabId,{type:'collect'},{frameId:0})` → odpowiedź = surowy string JSON z MAIN (`{protocol:1, recorderVersion===manifest.version, docId,…}`); po sukcesie `{type:'destroy'}`.
    T1c: top-level downloads.onChanged → onDownloadChanged; T1b/T12: getStatus woła expireSave() i zwraca lastSaved z getLast; T6b: collect → Blob → downloads.download → saveStarted/saveFailed; sukces gdy rec zniknął i lastSaved ustawione.
- [x] E1-T0 SPIKE (docs/epics/E1/spike-T0.md): S1–S8 działa. **PB-2 niepotrzebne.** Origin w e2e: `developerPrivate.addHostPermission` + klik `Runtime.evaluate({userGesture:true})` → granted bez okna. SW stop: `Target.closeTarget` + polling getTargets. MAIN łapie błąd w <head> 10/10 (FF 109/110). Handshake relatedTarget odporny na podmienione dispatchEvent/detail (intrinsics na document_start). Firefox 158: event page moduł, storage.session, registerContentScripts MAIN, pobranie z nazwą — OK.
  **Korekta D11 (zaakceptowana przez orkiestratora):** pobrania w e2e przez `Browser.setDownloadBehavior default` + `download.default_directory` w Preferences tymczasowego profilu (przy `allow` Chrome ignoruje `filename`). T18 wdraża. Tylko jeden popup naraz.
- grupa B zamknięta w całości (commit cb43b24 + T0)
- [ ] E1-T9 runInPage weryfikuje pds.version; marker Symbol.for
- [ ] E1-T10 timeout executeScript (~15 s)
- [x] E1-T11 walker: CSS url()/@import, HTML <style>/style="", js:[…], literalne getURL — rozwiązywane i wymagane; nie-literalne url(/getURL(/import(/files:/js: i każde importScripts( → „Unresolvable reference in <file>: <snippet>” — 12 testów ✓
  Uwaga (T14/T15): dopasowanie regexowe — `getURL(`/`url(` w komentarzu lub stringu JS też wyzwala fail-safe; bundle nie mogą mieć takich fraz w komentarzach.
- [x] E1-T12 resolveLimitMs, deadline w rec, leniwe wygaszanie (getStatus/hello/stopped), badge ■; protokół uzgodniony (tabela w raporcie: ownRequestId, stan 'starting', pds:last z downloadId, downloadFailed vs saveCancelled, save po auto-stopie bez odbiorcy → paczka z dokumentów) — 24 testy + tests/unit/popup-background-integration.test.js (6, **kontrakt dla T1c**)
  Router T1c: polecenia popupu tylko od stron rozszerzenia bez sender.tab; wiadomości mostu tylko z sender.tab i frameId 0; permissions.onAdded → onPermissionAdded; downloads.onChanged → onDownloadChanged; jeden store; createRecordingHandlers({chrome, store, expireSave}).
  Edge (T1c/QA): popup zamknięty między armStart a start przy już nadanym uprawnieniu → 'starting' do TTL 120 s.
- grupa D zamknięta; checkpoint commit
- [x] E1-T1c src/background.js (createRouter({chrome,store}) — acceptsMessage: popup tylko z sender.url == getURL('popup/popup.html'); most tylko sender.tab+frameId 0; top-level listenery), manifesty background (chrome service_worker/type module, firefox scripts/type module), package.js err.error — 10 testów ✓; edge 'starting' naprawiony (auto-start przy pending + permissions.contains)
  dist/chrome = dist/firefox: 19 plików ~150 KB (background 4,4 KB, content 72 KB, lib 47 KB, popup 28 KB); web-ext 0 errors; npm test 637/637 poza T17
- [x] E1-T17 usunięte 14 plików (page-debug-snapshot.js, snapshot-tab.js, run-in-page.js, ich testy, 6 speców e2e E0, throw-on-snapshot.html); reachable-files/layout/eslint poprawione; tests/unit/no-e0-flow.test.js — **npm test 588/588, lint 0, build OK, gen --check 0**
  csp-strict.html zostaje (T19c użyje w teście izolacji/CSP). harness.spec.js z E0 → T18 zastępuje.
- [x] E1-T18 launch.js (serviceWorker(), stopServiceWorker, grantOrigin, sessionStorage.get/set, downloadDir), recording.js (startRecording, saveRecording, setRecordingLimit, popupState), download.js na katalogu; harness-e1.spec.js smoke 5/5 (~1 s) — ✓
  Odstępstwa: uchwyt SW po restarcie przez stary Worker; wybudzanie SW kartą manifest.json + sendMessage; pobrania wg S7. Stary harness.spec.js (E0) usunięty przez orkiestratora.
  Docs: tekst „zatrzymane po 10 minutach” stały (przy teście 3 s też) — OK; extension-testing skill do aktualizacji.
- grupa F zamknięta; checkpoint commit
- [~] E1-T19a..e e2e (grupa G, równolegle, start)
  - [x] T19e tests/e2e/perf.spec.js + console-fallback.spec.js + fixtures/flood.html — 5 e2e ✓ (6 przebiegów). Narzut hooków: fetch mediana −0,5…+0,6 ms, p95 ≤ 0,7 ms (spec ≤ 2 ms); console p95 ≤ 0,07 ms (spec ≤ 0,5 ms). Flood 6000 → 5000 + truncated; 20 000×1 KB → 4,2 MB, documentChars tnie do 3046. Fallback konsolowy OK (AC-7.2/7.3).
  - [x] T19c tests/e2e/isolation.spec.js + fixtures/hostile.html — 6 e2e ✓ (4/4 solo; w pełnym przebiegu 4/5 — raz padł w saveRecording przy równoległych agentach, przyczyna nieustalona → tester sprawdza stabilność). AC-5.1, 5.3, 5.4, 5.5, 5.6 + CSP. `fetch.toString()` w trakcie: `function () { [native code] }`, po zapisie `function fetch() { [native code] }`.
    Review (do rozważenia E1 lub E3): serialize.js używa żywych JSON.stringify/parse strony (hostile naliczyła 4 wywołania; nonce nie wycieka, ale podmieniony JSON może zepsuć zapis args) → przechwycić JSON na document_start; destroy() przywraca oryginalny fetch i nadpisze wrapper założony przez stronę w trakcie (np. Sentry).
  - [x] T19d tests/e2e/{restricted,failure,packed-zip}.spec.js — 7 e2e ✓ + 1 fixme (3× stabilne; pełny zestaw 34–35/35). AC-1.7, 1.4 (odmowa: bąbel zamyka popup → `permissionDenied` 9/9), 2.4 (pageBusy ≥14,5 s), 2.2 (deny → `saveCancelled` z USER_CANCELED), zip E0 AC-4.5 + Firefox zip.
    QA ręczne: strona CWS (Playwright traci kartę), jawne „Odrzuć” w bąblu.
    **Poprawki po grupie G (F-e1-1):** (a) BUG src/popup/controller.js applyStatus — po timeoucie 15 s tło robi failSave bez lastError, stan saving→recording zeruje `outcome` → pusty status zamiast `pageBusy` (zależne od kolejności zdarzeń; test „verdict stays on screen” fixme → zdjąć po naprawie); (b) helper openPopupFor wraca zanim dokument to popup.html (getElementById null) → `waitFor` dokumentu w helperze.
  - [x] T19a tests/e2e/recording.spec.js + fixtures/early-error.html + /api/ok — 10 e2e ✓ (600/600 z --repeat-each). AC-1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.5, 2.6, 4.1, 4.2, 4.5, 4.7, 4.8.
    **F-e1-1 (c):** `popup.close()` w launch.js wraca natychmiast po `Target.closeTarget`; kolejny `openPopupFor` trafia w zamykany cel (2/250) → przenieść oczekiwanie „popup zniknął z Target.getTargets” do `popup.close()` (adapter `settled()` w recording.spec do usunięcia po poprawce).
  - [x] T19b tests/e2e/navigation.spec.js + time-limit.spec.js + fixtures/spa.html — 5 e2e ✓ (50/50 repeat) + 1 fixme. AC-4.3, 4.4, 3.3, 3.4, 1.9, 4.9.
    **F-e1-2 (HIGH):** po `stopServiceWorker()` ~1/8 zapisów wisi na „Zapisuję paczkę…” (pds:rec.save null, collect nie dociera lub odpowiedź ginie); bez stopu 24/24 OK. Nie wiadomo: tło czy artefakt Target.closeTarget. Realny scenariusz: Chrome ubija SW po bezczynności, zgłaszający nagrywa minutami.
    Uwaga: w karcie B *Nagrywaj* jest aktywny (klik kończy nagranie w A bez zapisu — D1); brief mówił „wyłączony” — kod/design wygrywa.
- **Implementacja E1: 27/27 (commit grupy G). 589 unit, 47 e2e (2 fixme → F-e1-1, F-e1-2).**
- [x] F-e1-1: controller STICKY_OUTCOMES (pageBusy/failed/downloadFailed/saveCancelled nie kasowane zmianą stanu tła) + 4 testy; popup.close() czeka na zniknięcie targetId, openPopupFor na gotowy dokument; fixme w failure.spec zdjęty; adapter w recording.spec usunięty — 593/593, lint 0; e2e recording 150/150 repeat
  Tester: 1/330 „after save: reload has no recorder” — startRecording nie doczekał reloadu w 10 s przy równoległym Chromium; sprawdzić na przebiegu na wyłączność (może wiązać się z F-e1-2).
- [~] F-e1-2: zawieszony zapis po restarcie SW — diagnoza + naprawa (start)
    Tester: NFR „save→Zapisano mediana z 5 ≤ 5 s” brak w T19e — dopisać w fazie Testy; `hooks-overhead.json` kasowany przez równoległe przebiegi — QA bierze z przebiegu na wyłączność.
- [ ] E1-TEST1..3, R1, Q1, DOC1

## Wejście z E0 (obowiązkowe dla analityka i architekta)
- docs/epics/E0/store-review.md — ujawnienie w UI (blocker), bez `tabs`, `optional_host_permissions` tylko dla origin karty, uzasadnienia EN per uprawnienie.
- docs/epics/E0/qa-report.md — F3: fałszywy sukces przy zablokowanych pobraniach (dowód); Firefox rozwiązuje `files` względem popupu; `file://` bez zgody → `tab.url` undefined.
- docs/epics/E0/state.md „Findings R1” i „Retro” — Proxy na XHR, `__PAGE_DEBUG_SNAPSHOT__` do usunięcia (E3-T6, ale hooki/destroy to E1-T3), luka testów Firefox (brak e2e) → QA ręczne obowiązkowe w planie testów.
- Firefox: tło jako event page (oba klucze `background`), `strict_min_version` 128; Performance API bez CLS/INP (E2).

## Blokery
- (brak)

## Decyzje użytkownika
- 2026-10-22: `downloads` permission — TAK.
- 2026-10-22 (bramka Spec): (1) optional_host_permissions http/https opcjonalne, request tylko o origin karty; (2) file:// jak E0;
  (3) dostęp po zapisie zostaje; (4) jeden przepływ Nagrywaj → Zapisz, bez szybkiego zrzutu; (5) **limit nagrywania 10 min**
  (auto-stop, zapis możliwy, `recordingStoppedReason`).
- 2026-10-22 (bramka Design): PB-1 → A (`file:///*` opcjonalne); PB-2 → zgoda z góry (kopia dist dla e2e, jeśli T0 padnie);
  D3 most bez postMessage — zaakceptowany przez orkiestratora z warunkiem testu AC-5.6.

## Historia faz
- 2026-10-22 init → spec (po zamknięciu E0 v0.2.0)
- 2026-10-22 spec zatwierdzony (5 decyzji) → design
- 2026-10-22 design zatwierdzony (PB-1 A, PB-2 tak, D3 ok) → implement. Grupa A: T0 ∥ grupa B (11 zadań) — start równoległy.

## Retro
- (po zamknięciu)
