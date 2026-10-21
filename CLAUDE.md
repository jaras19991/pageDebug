# Page Debug Snapshot

Rozszerzenie Chrome (MV3), które pozwala osobie zgłaszającej problem na stronie nagrać
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
docs/BACKLOG.md            epiki E0–E5 i zadania; źródło prawdy o zakresie
docs/epics/E*/             spec.md, design.md, state.md, qa-report.md per epik
.claude/agents/            subagenci pds-* (analyst, architect, implementer, tester, reviewer, qa, docs, release)
.claude/skills/            /pds-deliver (orkiestrator), /pds-status, skille wiedzy (mv3, schema, redaction, cwv, testing)
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

## Rzeczy, których nie ruszamy bez decyzji użytkownika

- `page-debug-extension.pem` — klucz prywatny. Nie kopiować, nie commitować, nie czytać do kontekstu.
- Dystrybucja (Web Store / polityka enterprise / .crx) — decyzja biznesowa, epik E5.

## Praca z agentami

Rozwój idzie epikami z `docs/BACKLOG.md`. Każdy epik przechodzi pełny cykl przez
`/pds-deliver E<n>` (spec → design → implementacja → testy → review+QA → docs → release).
Stan epiku żyje w `docs/epics/E<n>/state.md` — orkiestrator wznawia od ostatniej fazy.
`/pds-status` pokazuje, gdzie jesteśmy.
