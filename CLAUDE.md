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
page-debug-extension/      kod rozszerzenia (manifest.json, popup, page-debug-snapshot.js)
  console-snapshot.js      wersja jednoplikowa do wklejenia w konsolę (fallback bez instalacji)
scripts/dev-browser.ps1    Chrome/Firefox z rozszerzeniem na osobnym profilu / dev-zip dla testera
dist/chrome, dist/firefox  wynik `npm run build` (po E0); manifesty składane z src/manifest.*.json
docs/BACKLOG.md            epiki E0–E5 i zadania; źródło prawdy o zakresie
docs/epics/E*/             spec.md, design.md, state.md, qa-report.md per epik
.claude/agents/            subagenci pds-* (analyst, architect, implementer, tester, reviewer, qa, store-reviewer, docs, release)
.claude/skills/            /pds-deliver (orkiestrator), /pds-status, /pds-browser (pętla dev w Chrome),
                           skille wiedzy (mv3, schema, redaction, cwv, testing)
```

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

## Rzeczy, których nie ruszamy bez decyzji użytkownika

- `page-debug-extension.pem` — klucz prywatny. Nie kopiować, nie commitować, nie czytać do kontekstu.
- Dystrybucja (Web Store / polityka enterprise / .crx) — decyzja biznesowa, epik E5.

## Praca z agentami

Rozwój idzie epikami z `docs/BACKLOG.md`. Każdy epik przechodzi pełny cykl przez
`/pds-deliver E<n>` (spec → design → implementacja → testy → review+QA → docs → release).
Stan epiku żyje w `docs/epics/E<n>/state.md` — orkiestrator wznawia od ostatniej fazy.
`/pds-status` pokazuje, gdzie jesteśmy.
