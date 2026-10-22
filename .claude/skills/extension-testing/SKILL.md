---
name: extension-testing
description: Jak testować Page Debug Snapshot — vitest+jsdom dla logiki recordera/redakcji/summary, Playwright z załadowanym rozszerzeniem MV3 dla e2e (service worker, popup, pobrany plik), strony fixture, stabilność. Czytaj przed pisaniem lub uruchamianiem testów.
---

# Testowanie rozszerzenia

## Dwa poziomy, jasny podział

| Poziom | Narzędzie | Co testuje | Czego nie |
|---|---|---|---|
| **Unit** | vitest + jsdom (`npm test`) | `recorder.js` (hooki na fake fetch/XHR), `redact.js`, `summarize.js`, `collector.js` na syntetycznym DOM, `vitals` mapowanie | niczego, co wymaga `chrome.*` lub prawdziwego renderowania |
| **E2E** | Playwright + Chromium z `dist/chrome` (`npm run test:e2e`) | popup, service worker, `registerContentScripts`, prawdziwe `document_start`, pobranie paczki, zawartość zipa | wydajności (osobne testy syntetyczne), wizualnej poprawności (zrzuty tylko jako dowód QA) |

## Układ

```
tests/
  unit/            *.test.js — jeden plik na moduł
  e2e/
    helpers/launch.js   launchWithExtension, openPopupFor, expectDownload (patrz niżej)
    helpers/fixtures-server.js   serwuje tests/fixtures/pages na localhost:0
    *.spec.js
  fixtures/
    pages/            statyczne strony testowe (patrz niżej)
    snapshots/        v1.json, v2.json — do testów summary/viewer/MCP
    redaction/        sensitive.json, benign.json
```

## Unit — wzorce

- **Hooki**: nie mockuj `fetch` przez `vi.fn()` jako zamiennik; testuj, że po `install()` wywołanie
  `window.fetch('/x')` (1) woła oryginał z tymi samymi argumentami, (2) dopisuje rekord, (3) zwraca
  tę samą odpowiedź, (4) po `destroy()` `window.fetch === original`. Dla XHR: `new XMLHttpRequest()
  instanceof XMLHttpRequest`, `XMLHttpRequest.DONE === 4`, `xhr.open/send/setRequestHeader` działa,
  `loadend` rejestruje status.
- **`console` hook**: po instalacji `console.error('x')` woła oryginał (szpieg na *oryginale*, nie na
  `console.error`) i dopisuje rekord ze `stack`.
- **Redakcja**: tabela przypadków `[input, expectedOutputOrPattern, ruleName]`; test idempotencji;
  test kształtu (`Object.keys` i typy przed/po identyczne).
- **Summary**: snapshot testy (`toMatchFileSnapshot`) na fixture'ach; przy zmianie uważnie czytaj diff —
  nie aktualizuj odruchowo.
- jsdom nie ma `PerformanceObserver`, `CompressionStream`, `crypto.subtle` w starszych wersjach —
  dla tych modułów używaj `// @vitest-environment node` z polyfillem lub testuj przez e2e.

## E2E — uruchomienie rozszerzenia MV3 (stan po E0)

Harness: `tests/e2e/helpers/launch.js`. Rozszerzenie jest ładowane z `dist/chrome` (wynik `npm run build`,
nigdy z `src/`); `globalSetup` buduje projekt.

- `launchWithExtension({ distDir?, headless? })` — `chromium.launchPersistentContext('', { channel: 'chromium', ... })`:
  pełny Chromium w nowym headless (domyślnie headless; `PDS_E2E_HEADED=1` pokazuje okno). Argumenty:
  `--disable-extensions-except`, `--load-extension` oraz `--enable-unsafe-extension-debugging` (odsłania domenę CDP
  `Extensions`). Zwraca `{ context, extensionId, extensionInfo, browserCdp, close }`. ID rozszerzenia z
  `chrome.developerPrivate.getExtensionsInfo()` na `chrome://extensions` (E0 nie ma service workera, więc nie ma `serviceWorker`).
- `openPopupFor(page)` — otwiera prawdziwy popup jak klik ikony: CDP `Extensions.triggerAction` na celu `tab` danej strony.
  Zwraca `{ evaluate, click, textOf, waitForText, close }`.
  - **Popup nie jest `Page` w Playwright** — nie ma `page.goto('chrome-extension://…/popup.html')` z aktywną kartą;
    popupem steruje się przez CDP (`Target.sendMessageToTarget` + `Runtime.evaluate`), stąd API powyżej.
  - **`activeTab` działa do nawigacji**: po `page.goto` trzeba wywołać `openPopupFor` ponownie.
- `expectDownload(page, action)` — `waitForEvent('download')` + akcja; zwraca `{ suggestedFilename, path }`.
  Pliki zostają w katalogu tymczasowym Playwright (bez `downloadsPath`, nic w Pobranych).
- `globalTeardown` porównuje `git status` ze stanem z `globalSetup` i failuje, gdy e2e zmieniło drzewo robocze (AC-3.4).
- Inne helpery: `helpers/download.js`, `helpers/unzip.js` (test zipa z `npm run pack`), `helpers/fixtures-server.js`.
- Stabilność: `retries: 0`, `workers: 2`; nie dodawaj `retries` bez komentarza z przyczyną.
- Gdy dojdzie tło (E1): `context.serviceWorkers()` najpierw, potem `waitForEvent('serviceworker')`; SW bywa ubijany — wybudź go przed `evaluate`.
- Pobranie paczki: `const { suggestedFilename, path } = await expectDownload(page, () => popup.click('#runSnapshot'))`,
  potem `JSON.parse(readFileSync(path))` (JSON w E0; zip od E3).
- `document_start` (E1): fixture rzuca błąd w pierwszym `<script>` w `<head>` i robi `fetch('/api/fail')` przed DCL —
  test akceptacyjny E1.

## Firefox — czego Playwright nie zrobi i co zamiast tego

**Playwright nie ładuje rozszerzeń w Firefoksie.** Nie ma API, `--load-extension` jest ignorowane,
background page nie jest dostępny jako Page/Worker. Narzędzia społecznościowe (`playwright-webext`,
`playwright-webextext`) nie wspierają w pełni MV3 na Firefoksie. Nie próbuj tego obchodzić w testach.

Podział:
| Poziom | Chrome | Firefox |
|---|---|---|
| unit (vitest) | wspólne | wspólne |
| statyczny lint manifestu/kodu | eslint | eslint + `npx web-ext lint --source-dir dist/firefox` (0 errors) |
| e2e pełne | Playwright | — |
| smoke | Playwright | **E0:** ręczne QA przez `npx web-ext run --source-dir dist/firefox --start-url <fixture>`; **E5:** Selenium + geckodriver, `driver.installAddon(pathToZipOrXpi, true)` — przekazuj **ścieżkę do pliku .zip/.xpi**, nie katalog (znany błąd w bindingach JS) |

Każde kryterium akceptacyjne e2e ma w planie testów kolumnę „Firefox: auto / QA ręczne / n.d.”.

## Strony fixture (`tests/fixtures/pages/`)

| Plik | Po co |
|---|---|
| `basic.html` | zwykła strona, happy path |
| `early-error.html` | błąd w `<head>`, fetch 500 przed DCL, `console.error` z obiektem |
| `spa.html` | `history.pushState`, dynamiczne fetch, brak przeładowań |
| `cwv-bad.html` | obraz hero bez wymiarów (CLS), duży obraz ładowany późno (LCP), `onclick` z pętlą 400 ms (INP) |
| `sensitive.html` | localStorage `token=eyJ…`, cookie `sid=…`, formularz z e-mailem i hasłem, URL `?access_token=…` |
| `csp-strict.html` | nagłówek CSP przez `<meta>` — upewnia, że hooki nie wymagają `unsafe-inline` |
| `xhr-lib.html` | mini „axios-like” wrapper na XHR, sprawdza `instanceof` i stałe po hooku |

Serwer fixture: `node:http` na porcie 0, mapuje `/api/fail` → 500 z JSON body, `/api/slow` → 3 s,
`/img/404.png` → 404. Nie polegaj na internecie w testach.

## Czego nie robić

- Nie testuj przez `page.evaluate(() => window.PageDebugSnapshot.snapshot())` jako jedynej drogi —
  to omija popup, SW i `document_start`. Taki test jest OK jako unit-like pomocniczy, nie jako akceptacyjny.
- Nie `sleep(3000)` — czekaj na zdarzenie (`download`, `response`, `waitForFunction`).
- Nie zostawiaj pobranych plików w `~/Downloads` — Playwright trzyma je w temp; nie zmieniaj `downloadsPath`
  na katalog użytkownika.
- Nie wyciszaj flaky testu `retries` bez komentarza z przyczyną.
