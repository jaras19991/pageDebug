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
  - [~] T1b start/hello/flush/status (start po T1a)  · [ ] T1c background.js + manifesty
- [ ] E1-T2 registerContentScripts dla origin karty; auto-reload (w T1b)
- [~] E1-T3 refaktor page-debug-snapshot.js → moduły ES
  - [x] T3a src/page/serialize.js (deepMerge głęboka kopia, safeSlice(value,max), safeJson bez fałszywego [Circular], serializeCapped → {value,chars,truncated}),
    src/page/buffer.js (createBuffer({maxItems,maxChars}) → push(entry,chars)/items()/truncated/clear), eslint bloki — 27 testów ✓
    Dla T3c: buf.push(record, res.chars); stop() nie woła clear(). Dla T14: helpery z prefiksem serialize*, bez importów.
  - [x] T3b src/page/collector.js — collectPageState({win,doc,safeSlice,limits}) → {environment,dom,performance,storage,errors}; sekcje z własnym try; COLLECTOR_LIMITS v1 — 10 testów ✓
    Decyzja orkiestratora dla T8a/T15: wpisy `errors` collectora trafiają do `notes` paczki jako „collector: <section> failed (<error>)”.
  - [~] T3c recorder (start po T3a/T4/T5)
- [x] E1-T4 src/page/hooks-network.js — installFetchHook/installXhrHook({win,now,record,json,intrinsics?,enabled?}) → restore(); NETWORK_LIMITS; record('network', entry) wg D12 — 30 testów ✓
  Uwaga D5: `fetch.toString()` na Proxy w V8 daje `function () { [native code] }` bez nazwy — design do korekty w Docs. Nagłówki (Authorization) jawne → E3.
- [x] E1-T5 src/page/hooks-console.js (installConsoleHook({win,now,record,json,levels,intrinsics?}) → restore(), stack bez wrappera, V8+Firefox, ≤4000 zn.)
  + hooks-errors.js (installErrorHooks(...) → restore()) — 27 testów ✓. Kontrakt dla T3c: record('consoleLogs'|'runtimeErrors', entry); json = v => serializeCapped(v, n).value; `doc` dokłada recorder.
- [~] E1-T6 popup 3 stany + **ujawnienie w UI** (blocker CWS ze store review E0)
  - [x] T6a messages.js (zbiór zamknięty: disclosure*, noUpload, reloadNotice, starting, recordingSince, stoppedByLimit, saving, saved…), popup.html
    (#ready/#recording hidden, #record, #save, #status) — 24 testy ✓. UWAGA: popup.js i e2e E0 czerwone do T6b/T17/T19 (brak #runSnapshot, MESSAGES.working/success usunięte).
  - [~] T6b popup.js kontroler (start po T6a/T1a)
- [x] E1-T13 src/page/channel.js — connectMain/connectIsolated({doc,onMessage,onUnbound?,bindTimeoutMs?,...}) → {send,whenBound,isBound(),close()}; typy I2M: config/collect/destroy, M2I: result/flush/stopped; wariant D3 — 19 testów ✓ (AC-5.6)
  Dla T15: destroy() recordera przez onUnbound; ISOLATED bindTimeoutMs 2000 → bridgeError 'unbound'. Decyzja orkiestratora: zostaje CHANNEL_PROTOCOL (nie scalać z constants.js).
- [x] E1-T14 scripts/gen-content.mjs — bundle({entry,srcDir,banner,outFile}), generateAll({root,check}), `npm run gen [--check]`; każdy moduł we własnej funkcji w IIFE (brak kolizji nazw) — 20 testów ✓
  **Dozwolona składnia modułów src/page/ (dla T3c/T15/T7):** importy jednolinijkowe od kolumny 0; `export function|class|const|let|var <jedna nazwa>`; `export default`, `export {a, b as c};`, `export * from`, `export * as ns from`; ścieżki względne `.js` w src/page/; bez cykli, bez `import(`/`import.meta`/`require(` nawet w komentarzach; eksporty to snapshot (brak live bindings).
  T15 tworzy src/page/{main,isolated,console}-entry.js i uruchamia `npm run gen`.
- [ ] E1-T7 console-snapshot.js na wspólnym recorder.js
- [ ] E1-T8 `downloads` permission + sukces po state=complete (decyzja użytkownika 2026-10-22; HIGH z re-QA E0)
- [ ] E1-T9 runInPage weryfikuje pds.version; marker Symbol.for
- [ ] E1-T10 timeout executeScript (~15 s)
- [x] E1-T11 walker: CSS url()/@import, HTML <style>/style="", js:[…], literalne getURL — rozwiązywane i wymagane; nie-literalne url(/getURL(/import(/files:/js: i każde importScripts( → „Unresolvable reference in <file>: <snippet>” — 12 testów ✓
  Uwaga (T14/T15): dopasowanie regexowe — `getURL(`/`url(` w komentarzu lub stringu JS też wyzwala fail-safe; bundle nie mogą mieć takich fraz w komentarzach.
- [ ] E1-T12 limit nagrywania 10 min (auto-stop, stan popupu, recordingStoppedReason)
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
