# E0 — Fundament: repo, build, testy, higiena MV3 — stan

faza: design
rozpoczęto: 2026-10-21
ostatnia aktualizacja: 2026-10-21 23:25

## Zadania
- [x] E0-S1 Definicja „gotowe” dla repo (spec.md, US-5)
- [ ] E0-D1 Układ repo (src/, scripts/, tests/)
- [ ] E0-D2 Wybór narzędzi (vitest+jsdom, Playwright, eslint)
- [ ] E0-D3 Build (dist/, pack)
- [ ] E0-T1 git init + .gitignore, pem poza repo
- [ ] E0-T2 package.json: sharp → devDependencies, skrypty
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

## Decyzje użytkownika
- 2026-10-21 (bramka Spec): (1) historia gita przepisana — logo poza commitami; (2) źródłowe logo **usunięte z dysku** — ikony 16/48/128
  jedynym źródłem, bez skryptu ikon i `sharp`; (3) tylko `.zip`, bez `.crx`; (4) `file://` zostaje z polskim
  komunikatem; (5) CI lokalnie, e2e headless-capable; (6) `console-snapshot.js` bez zmian; (7) `.pem` przenosi użytkownik.
- 2026-10-21: **dwa targety od E0 — Chrome i Firefox** (MV3, jedna baza, `dist/chrome` + `dist/firefox`).
- 2026-10-21: nowy agent `pds-store-reviewer` w fazie Review (zgodność z Chrome Web Store / AMO).

## Historia faz
- 2026-10-21 init → spec
- 2026-10-21 spec.md gotowy (pds-analyst); poprawka orkiestratora: `.pem` leży w root (ignorowany, poza historią), repo wypchnięte na GitHub. Bramka Spec: 7 pytań.
- 2026-10-21 odpowiedzi użytkownika + wymaganie Firefox → spec.md zaktualizowany (pds-analyst, 221 linii, 7 US, 43 AC). **Bramka Spec: zatwierdzona.** spec → design.
  Po stronie użytkownika przed Release: `git push --force-with-lease`, przeniesienie `.pem`.

## Retro
- (po zamknięciu)
