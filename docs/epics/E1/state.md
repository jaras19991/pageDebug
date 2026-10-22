# E1 — Model nagrywania: dane od startu strony — stan

faza: implement
rozpoczęto: 2026-10-22
ostatnia aktualizacja: 2026-10-22

## Zadania (z backlogu; design doprecyzuje)
- [x] E1-S1..S3 spec.md (pds-analyst): 7 US, 42 AC, schema v2 — bramka zatwierdzona
- [x] E1-D1..D13 design.md (pds-architect): 27 zadań / 7 grup, 44 AC, 18 scenariuszy QA Firefox — bramka zatwierdzona
- [ ] E1-T1 tło (SW / event page): startRecording, stopAndCollect, getStatus
- [ ] E1-T2 registerContentScripts dla origin karty; auto-reload
- [ ] E1-T3 refaktor page-debug-snapshot.js → recorder.js + collector.js
- [ ] E1-T4 Proxy-hooki XHR/fetch (instanceof, stałe statyczne)
- [ ] E1-T5 hooki error/unhandledrejection z destroy()
- [ ] E1-T6 popup 3 stany + **ujawnienie w UI** (blocker CWS ze store review E0)
- [ ] E1-T7 console-snapshot.js na wspólnym recorder.js
- [ ] E1-T8 `downloads` permission + sukces po state=complete (decyzja użytkownika 2026-10-22; HIGH z re-QA E0)
- [ ] E1-T9 runInPage weryfikuje pds.version; marker Symbol.for
- [ ] E1-T10 timeout executeScript (~15 s)
- [ ] E1-T11 walker fail-safe na url()/getURL()
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
