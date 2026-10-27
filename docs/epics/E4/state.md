# E4 — Wyjście: podsumowanie, przeglądarka paczki, przekazanie, dostęp dla agenta — stan

faza: done
rozpoczęto: 2026-10-26
ostatnia aktualizacja: 2026-10-27

## Zadania
Fala A (równolegle):
- [~] E4-S0 Spike: downloads.show/exists, CSP viewera z file://, storage.managed w FF
- [x] E4-T1a Zapytania o rekordy (snapshot-query.js)
- [x] E4-T1c Metryki: CWV, zasoby, ciasteczka (snapshot-metrics.js)
- [x] E4-T6 Czytnik ZIP (unzip.js)
- [x] E4-T7 Migracja v1–v3 (migrate.js)
- [x] E4-T3a Generator viewera, CSP, artefakt wydania
- [x] E4-T3d Bezpieczny DOM viewera + lint
- [x] E4-T4a MCP: transport stdio
- [x] E4-T2a Teksty popupu (Zapisano, zgoda IN8)
- [x] E4-D4a Opcje developerskie (dev-config, storage.managed)
- [x] E4-D4b managed_schema w manifeście Chrome
- [x] E4-D4c Wstrzyknięcie konfiguracji przy buildzie
- [x] E4-IN1 Redakcja tekstu (IN1+IN3, wyjątek „proza” PB-2)
- [x] E4-IN4 Redakcja argumentów konsoli (IN4+IN5)
- [x] E4-IN6 Notatki o zrzucie (IN6+IN11)
- [x] E4-IN7 Margines maski 2 px
Fala B:
- [x] E4-T1b summary.md pełny (+TEST1)
- [x] E4-T5 diff paczek
- [x] E4-T8 Czytnik paczki
- [x] E4-IN2 Pętle indeksowe w MAIN
- [x] E4-T2b Popup: ekran Zapisano, Pokaż plik
- [x] E4-D4d Tło: opcje, czyszczenie lastSaved
Fala C:
- [x] E4-T3b Viewer: wczytywanie, Podsumowanie
- [x] E4-T3c Viewer: zakładki rekordów
- [x] E4-T3e Viewer: zakładki strony
- [x] E4-T4b MCP: katalog paczek
- [x] E4-T10 rulesVersion 2, walidator, snapshot-schema.md
Fala D:
- [x] E4-T4c MCP: 7 narzędzi + README
- [x] E4-T9 Regeneracja bundli i viewera, budżet rozmiaru
Fala E:
- [x] E4-TEST3 MCP integracja stdio
- [x] E4-TEST0 helper e2e + regresje (e2e 106/106; S1 PASS — show() nie sygnalizuje braku pliku, search przed show wystarcza)
- [x] E4-IN1b Poprawka: maskText nie maskuje pary klucz–wartość po innym kluczu („Error: password: …”) — wyciek wykryty w TEST3
- [x] E4-FIX1 Viewer: pasek zakładek widoczny przed wczytaniem (nav[hidden]) — z TEST2
- [x] E4-IN2b Pętle indeksowe w pozostałych plikach MAIN (recorder, hooks-console, serialize) — pod podmienionym iteratorem nagranie było puste, AC-2.5 e2e przechodziło próżno
- [x] E4-TEST4a e2e Zapisano/konfiguracja
- [x] E4-TEST4b e2e notatki/maska zrzutu
- [x] E4-TEST4c e2e prywatność, trzech konsumentów
- [x] E4-TEST2 e2e viewer
Pominięte: [-] E4-S2 (wysyłka — decyzja użytkownika), [-] E4-IN9 (→ E5), [-] E4-IN10 (obserwacja).

Uwaga: pełny `npm test` może być czerwony na teście gen-content w falach A–C (bundle regenerowane dopiero w T9) — to oczekiwane.

## Przekazane do kolejnych fal
- T2b/D4d: `build -- --config` kończy się błędem, dopóki dev-options.js nie jest importowany w tle/popupie (zamierzone).
- T3a/pack: pack.mjs i dev-browser.mjs nie przekazują `devConfigPath` — do decyzji przy T9.
- TEST0: tests/e2e/screenshot.spec.js:112 liczy `#disclosure li` — ukryty `#disclosureDev` doda element; filtrować `:not(#disclosureDev)`.
- T1b: przejrzeć polskie teksty REASON_PL (hidden-at-start, no-data, cross-origin); krok przed błędem poza ostatnimi 20 nieoznaczony na liście.
- T10: D5 w design.md — założenie „web-ext lint ostrzega o managed_schema” jest fałszywe (spike S0); brak klucza w FF pilnuje manifest-parity.
- Faza testów: pełny Chromium z rozszerzeniem nie startuje w sandboksie WSL (unix sockets).

- lint: scripts/build.mjs (no-control-regex, preserve-caught-error) i tests/e2e/spike-e4 czerwone w `npm run lint` — naprawić przed fazą testów (spike-e4 dodać do ignorów jak spike-e3?).
- mcp/package.json: private, wersja 0.6.0 — potwierdzić przy release.

- T5: klucz diffu statusów = metoda + pathname (bez hosta) — decyzja orkiestratora: zostaje (porównanie staging vs produkcja), opisać w README MCP.
- repo-hygiene „no production domains” czerwony w pełnym przebiegu — sprawdzić w fazie testów, czy to timeout czy nowe fixture z domenami.

- T2b: FILE_RECHECK_MS (500 ms) w popup/controller.js — dostroić po wyniku S1; QA: ekran saved pokazuje też otherTabRecording w linii statusu (ocena UX).
- build.test „removes stale files” przekracza 5 s na /mnt/c — rozważyć timeout w fazie testów.

- T4c: hostOf skopiowany w mcp/snapshots-dir.js — przy T4c rozważyć eksport z summary.js zamiast duplikatu.

- (ZROBIONE w IN2b, 2026-10-27) for…of w recorder.js (install/snapshot/stop/clear), hooks-console.js, serialize.js; .some/.every/.join w redact-rules — podmieniony iterator strony = brak danych (nie wyciek).

- TEST0: tests/e2e/helpers/recording.js:150 — `assertValidSnapshot(pkg.json, { expectRulesVersion: 2 })`.
- T1b: export.test „screenshot off” oczekuje starej linii „- Zrzut ekranu: nie” — zaktualizować w T1b.
- T9: build.test „each target under 500 KB” czerwony — budżet rozmiaru.

- T9: test `entries` zgłasza „Invalid regular expression” w bundlu (src/page lub src/lib, nie viewer) — sprawdzić przy regeneracji (np. \p{L} z flagą u po IN1).
- T3b: renderery zakładek wołać raz i cache’ować węzeł (stan filtrów w węźle).

- T9: dist/chrome = 536 861 B > 500 KB (build.test) po T1b (summary + query + metrics trafiają do dist przez export.js). Decyzja orkiestratora: T9 najpierw sprawdza, czy do dist nie trafia nic zbędnego; jeśli nie — podnosi próg nieskompresowany do 600 KB z uzasadnieniem, wiążący pozostaje budżet zipa z design (≤ 162 413 + 30 720 B).

- TEST3: get_network domyślnie na ciężkiej paczce = 12 975 znaków (cel ≤ 10 000 z ryzyka 3; AC-5.7 ≤ 25 000 spełnione) — ocena w review.
- TEST3: telefony w steps.text niemaskowane — zgodne ze skillem privacy-redaction.
- repo-hygiene / build „removes stale files” czerwone w pełnym biegu przy równoległej pracy — sprawdzić w fazie testów.

- TEST4: zwykły unlink pliku nie zmienia downloads.search().exists w 3 s (e2e używa downloads.removeFile) — QA ręczne: usunięcie z menedżera plików na Windows.
- 2026-10-27 orkiestrator: for…of w recorder/hooks-console/serialize włączone do E4 jako IN2b (wcześniej kandydat do backlogu), bo bez tego AC-2.5 nie jest weryfikowalne.

- IN2b: nieutwardzone — iteratory Map/Set/String, %ArrayIteratorPrototype%.next, podmienione metody tablic (filter/sort/slice/reduce) — do Znanych ograniczeń (docs) / backlog.
- docs: komentarz w tests/fixtures/pages/privacy-iterator.html nieaktualny.

- Review (1. podejście, przerwane błędem I/O na /mnt/c/.../.claude): przejrzane OK — mcp, unzip, migrate, summary, viewer DOM/CSP. Finding [low] mcp/snapshots-dir.js:194,204 list() czyta przez join/stat/readFile bez locate()/realpath (TOCTOU symlink, AC-5.8) → poprawić.
- Review — propozycja: ostrzeżenie „Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny” dla sourceVersion < 4 (viewer + list_snapshots) — decyzja użytkownika.
- Store review: publishable-with-fixes. [high] README:227,246–248 uzasadnienie storage bez storage.managed; [medium] README:228 downloads bez „Pokaż plik” (teksty PL/EN w raporcie store → faza Docs). [medium] zipy dist/*-0.5.0.zip zawierają kod E4 — nie rozsyłać, release 0.6.0 + repack. [medium] do sklepu tylko build bez --config (zapisać w docs/store, E5). [high→E5] brak docs/store (polityka prywatności, Limited Use). [low] strict_min_version 140 (opcjonalnie), AMO source submission.
- QA (2. podejście): PASS z uwagami — 28 PASS / 0 FAIL / 3 BLOCKED (1.2 Eksplorator, 5.1 realny klient, 4.1 FF/Edge) / 12 z e2e/unit. Prywatność 12 pułapek × 5 paczek × 3 konsumentów: 0 trafień. Defekty: F-1 [medium] zgoda IN8 poniżej zgięcia w stanie gotowe; F-2 [medium] dom.iframes[].attributes.srcdoc niesie pełny HTML ramki z wartościami pól; F-3 [low] otherTabRecording na ekranie Zapisano wspomina „Nagrywaj”; F-4 [low] brak ostrzeżenia viewera dla v2/v3 (niezredagowane). Raport: qa-report.md.
- Środowisko: po wsl --shutdown /tmp/claude-1000/libs zniknęło — e2e z WSL wymaga ponownego rozpakowania bibliotek; QA uruchamiało Chromium przez Node z Windows.
- Review (2. podejście): approve-with-fixes, 0 critical/high. [medium] redact-rules.js:280 `'` przed kluczem blokuje COLON_PAIR („'token: abcd…'” jawne); [medium] redact.js:276 redactJsonPreview bez namedPairRule ({name:"password",value:…} w podglądzie >40k); [medium] snapshot-query.js:106 + viewer tabs-records.js:228 args {truncated, preview} → pusty tekst, errorGroups skleja w ""; [medium] pack.mjs:68 czyta PDS_CONFIG z env niejawnie; [low] lint czerwony przez docs/epics/E4/qa/run-*.mjs; [low] mcp list() bez locate(). PB-2 frazy-hasła → Znane ograniczenia.

## Poprawki po review/QA
- [x] E4-FIX2 grupa poprawek: review medium×4 + low×2, QA F-1 (zgoda nad zgięciem), F-3 (tekst otherTabRecording na Zapisano), F-2 (srcdoc), ostrzeżenie dla paczek v1–v3
- FIX2: znane ograniczenie — podgląd JSON nie zamaskuje {"value":…,"name":"password"} (value przed name, czytanie strumieniowe) → README. e2e: dopisać test widoczności zgody bez przewijania (510/600 px).
- [x] E4-RETEST: e2e 128/128 ×2, unit 1758/1758, lint/gen OK; nowe e2e popup-consent (F-1), srcdoc (F-2), banner v<4; [x] E4-REREVIEW: approve-with-fixes, wszystkie findings R1/R2 i QA F-1..F-4 zamknięte. Nowe [low]: TRAILING_BLANKS /[ \t]+$/ kwadratowy (redact-rules.js:289,471,479; 40k spacji = 3,9 s), redact-page.js:88–90 INPUT_TAG/TEXTAREA przepuszczają wartości przy wyłączonym html-structure → E4-FIX3 po RETEST

- [x] E4-FIX3 (1461 ms → 0,5 ms; INPUT_TAG też kwadratowy, naprawiony; unit 1762, e2e privacy 9/9) TRAILING_BLANKS liniowo + redact-page INPUT_TAG/TEXTAREA (low z REREVIEW)

## Blokery
- E4-S0: S1 wykonany 2026-10-27 (PASS; storage.managed.get bez polityki wisi >1 s w Chromium — chroni timeoutMs=1000). S3 (Firefox) do ręcznego uruchomienia przez użytkownika na Windows — `node tests\e2e\spike-e4\run.spike.mjs` (+ `--firefox`), checklista w docs/epics/E4/spike-S0.md. S1 potrzebne przed T2b, S3 przed D4b-QA.

## Decyzje użytkownika
- 2026-10-26: bramka Spec — przyjęte rekomendacje Q-1, Q-2, Q-4…Q-11.
- 2026-10-26: bez wysyłki z popupu (mailto i konfigurowalny link). Zgłaszający wysyła plik sam. Q-3 jest bezprzedmiotowe, a E4-D4 obejmuje tylko konfigurację reguł redakcji.
- 2026-10-26: bramka Design — PB-1: MCP z własnym transportem stdio, bez SDK; PB-2: wąski wyjątek „proza” (auth/session/key). Design zatwierdzony.
- 2026-10-27: zgoda na uruchamianie Playwright/Chromium (e2e, spike S1) poza sandboksem WSL na czas fali E i fazy testów.
- 2026-10-27: QA F-2 (srcdoc z wartościami pól) — naprawić w E4. Paczki v1–v3: ostrzeżenie „sprzed automatycznej redakcji” w viewerze i MCP.
- 2026-10-27: bramka Release — wydać 0.6.0; commit + tag v0.6.0 na main, bez push, bez atrap sandboksa z katalogu głównego.
- 2026-10-27: MCP — jeden katalog na serwer (argument lub PDS_SNAPSHOTS_DIR), bez podkatalogów; wiele katalogów = wiele wpisów serwera.

## Historia faz
- 2026-10-26 init → spec
- 2026-10-26 spec → design (bramka: zatwierdzono, bez wysyłki z popupu)
- 2026-10-26 design → implement (bramka: zatwierdzono, PB-1 A, PB-2 tak)

- 2026-10-27 implement → test (fala E + poprawki IN1b, FIX1, IN2b)
- 2026-10-27 test → review-qa (unit zielone poza timeoutem infra; e2e 126/126 ×2; zip Chrome 186 697 B; viewer 116 595 B)
- 2026-10-27 review-qa → docs (review approve, QA PASS, store publishable-with-fixes; poprawki FIX2, FIX3; e2e 128/128 ×2)
- 2026-10-27 docs → release (README, instrukcja zgłaszającego, JAK-CZYTAC-PACZKE.md, CHANGELOG [Unreleased], snapshot-schema, mcp/README) — czeka na bramkę

## Retro
- …

- 2026-10-27 release: v0.6.0, dist/page-debug-snapshot-chrome-0.6.0.zip (188 773 B), firefox 188 641 B, viewer 117 949 B; commit + tag v0.6.0, bez push
