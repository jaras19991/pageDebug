# Page Debug Snapshot

Rozszerzenie przeglądarkowe (MV3, **Chrome i Firefox** z jednej bazy kodu), które pozwala osobie zgłaszającej problem na stronie nagrać
to, co się działo (konsola, błędy, sieć, kroki, CWV, DOM, storage), zapisać jedną paczkę
i wysłać ją developerowi. Developer otwiera paczkę i w minutę rozumie kontekst błędu.

## Dwie persony — zawsze projektuj dla obu

- **Zgłaszający** — nietechniczny. Zna trzy przyciski: *Nagrywaj*, *Zapisz paczkę*, *Wyślij*.
  Nie zna DevTools. Nie może wysłać nam swoich haseł i tokenów, nawet przez przypadek.
- **Developer** — otwiera paczkę lokalnie lub podaje ją agentowi AI. Potrzebuje podsumowania
  na górze i pełnych danych pod spodem.

## Struktura

```
src/                       kod rozszerzenia
  manifest.base.json, manifest.chrome.json, manifest.firefox.json
  background.js            tło (SW w Chrome, event page w Firefoksie): router, top-level listenery, bez stanu w pamięci
  lib/                     logika tła: recording.js, save.js, package.js (schemat paczki), session-store.js, content-scripts.js, origin.js
  popup/                   popup.html, popup.js, controller.js, view.js, target.js, messages.js
  page/                    moduły ES kodu działającego na stronie (recorder, hooki, kanał, collector, *-entry.js) — ŹRÓDŁO
  content/                 isolated-world.js, main-world.js — GENEROWANE z src/page (`npm run gen`), nie edytuj ręcznie
  icons/                   icon16/48/128.png (generuje `npm run icons`)
  standalone/              console-snapshot.js — GENEROWANY, wersja jednoplikowa do wklejenia w konsolę (poza dist)
scripts/                   build.mjs, pack.mjs, gen-content.mjs, icons.mjs, dev-browser.mjs/.ps1, check-repo.mjs, lib/
tests/                     unit/ (vitest), e2e/ (Playwright), fixtures/pages/
dist/chrome, dist/firefox  wynik `npm run build` (ignorowany); zipy z `npm run pack` w dist/
docs/BACKLOG.md            epiki E0–E5 i zadania; źródło prawdy o zakresie
docs/epics/E*/             spec.md, design.md, state.md, qa-report.md per epik
.claude/agents/            subagenci pds-* (analyst, architect, implementer, tester, reviewer, qa, store-reviewer, docs, release)
.claude/skills/            /pds-deliver (orkiestrator), /pds-status, /pds-browser (pętla dev w Chrome/Firefox),
                           skille wiedzy (mv3, schema, redaction, cwv, testing)
```

Komendy: `npm ci`, `npm run lint`, `npm test`, `npm run test:e2e` (`PDS_E2E_NO_BUILD=1` pomija build dist),
`npm run build`, `npm run gen` (`-- --check` tylko sprawdza), `npm run pack`, `npm run icons`, `npm run dev:chrome|dev:firefox`, `npm run check:history`.

## Konwencje

- Kod, identyfikatory, komentarze: **angielski**. Teksty UI dla zgłaszającego: **polski**.
  Dokumentacja w `docs/`: polski.
- Brak frameworka i bundlera w runtime rozszerzenia — czysty JS, ESM tam, gdzie Chrome pozwala.
- Testy: `vitest` + `jsdom` dla logiki (`npm test`), Playwright z załadowanym rozszerzeniem dla e2e
  (`npm run test:e2e`). Nowa logika = test najpierw.
- Każda zmiana w strukturze paczki snapshotu = podbicie `schemaVersion` i wpis w
  `docs/snapshot-schema.md` (patrz skill `snapshot-schema`).
- Dane wrażliwe nigdy nie trafiają do paczki w jawnej postaci — patrz skill `privacy-redaction`.
- Nie monkey-patchuj konstruktorów przez podmianę na zwykłą funkcję — używaj `Proxy`
  lub subclass, zachowaj `instanceof` i stałe statyczne.
- Dwa targety od E0: Chrome i Firefox. API tylko z promisami (`await chrome.*`), bez callbacków,
  bez `importScripts`. Tło pisane tak, by działało jako service worker i jako event page.
  Różnice między przeglądarkami tylko w `manifest.chrome.json` / `manifest.firefox.json` — patrz skill
  `mv3-extension-rules`, sekcja Firefox.

- **Bundle generowane — nie edytuj ręcznie.** `src/content/*.js` i `src/standalone/console-snapshot.js` powstają z `src/page`
  przez `npm run gen`; po każdej zmianie w `src/page` (lub `src/lib/package.js`) uruchom `npm run gen` i zatwierdź wynik.
  Test `gen-content` i `npm run gen -- --check` padają, gdy bundle są nieaktualne.
- **Składnia modułów `src/page`** (generator jej pilnuje): importy jednolinijkowe od kolumny 0; eksporty tylko
  `export function|class|const|let|var <jedna nazwa>`, `export default`, `export {a, b as c};`, `export * from`, `export * as ns from`;
  ścieżki względne z `.js` w `src/page/`; bez cykli; bez `import(`, `import.meta`, `require(` nawet w komentarzach
  (fraza `getURL(`/`url(` w komentarzu też wyzwala fail-safe walkera osiągalności plików); eksporty to snapshot (brak live bindings).
- Terminy (limit nagrywania) liczymy z `Date.now()`, nie z `performance.now()` (uśpienie komputera).
- Nie uruchamiaj dwóch przebiegów e2e naraz bez `PDS_E2E_NO_BUILD=1` (przebudowa `dist/` psuje działającą przeglądarkę).

## Rzeczy, których nie ruszamy bez decyzji użytkownika

- `page-debug-extension.pem` — klucz prywatny. Nie kopiować, nie commitować, nie czytać do kontekstu.
- Dystrybucja (Web Store / polityka enterprise / .crx) — decyzja biznesowa, epik E5.

## Praca z agentami

Rozwój idzie epikami z `docs/BACKLOG.md`. Każdy epik przechodzi pełny cykl przez
`/pds-deliver E<n>` (spec → design → implementacja → testy → review+QA → docs → release).
Stan epiku żyje w `docs/epics/E<n>/state.md` — orkiestrator wznawia od ostatniej fazy.
`/pds-status` pokazuje, gdzie jesteśmy.
