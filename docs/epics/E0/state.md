# E0 — Fundament: repo, build, testy, higiena MV3 — stan

faza: implement
rozpoczęto: 2026-10-21
ostatnia aktualizacja: 2026-10-21 23:50

## Zadania
- [x] E0-S1 Definicja „gotowe” dla repo (spec.md, US-5)
- [ ] E0-D1 Układ repo (src/, scripts/, tests/)
- [ ] E0-D2 Wybór narzędzi (vitest+jsdom, Playwright, eslint)
- [ ] E0-D3 Build (dist/, pack)
- [ ] E0-T1 git init + .gitignore, pem poza repo
- [x] E0-T2 root package.json (bez sharp, bez dependencies), vitest/eslint/web-ext/fflate, 4 testy ✓ (2026-10-21)
- [ ] E0-T3 inject.js → executeScript world MAIN, usunięcie web_accessible_resources
- [ ] E0-T4 Usunięcie host_permissions <all_urls>
- [ ] E0-T5 popup.js: status odzwierciedla faktyczny wynik
- [~] E0-T6 Ikony: logo usunięte (zrobione); zostaje test wymiarów ikon w dist
- [ ] E0-T7 Smoke test e2e
- [ ] E0-T8 Unit testy istniejącej logiki
- [ ] E0-Q1 npm test + test:e2e zielone na czystym klonie
- [ ] E0-R1 Review: brak sekretów, brak <all_urls>, dist < 500 KB
- [ ] E0-DOC1 README developera

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
