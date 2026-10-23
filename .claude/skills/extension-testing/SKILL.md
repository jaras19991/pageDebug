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
    helpers/launch.js   launchWithExtension, openPopupFor, listDownloads/expectDownload (patrz niżej)
    helpers/recording.js   startRecording, saveRecording, setRecordingLimit, popupState
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

## E2E — rozszerzenie MV3 z tłem (stan po E1)

Harness: `tests/e2e/helpers/launch.js` + `helpers/recording.js` + `helpers/download.js`. Rozszerzenie jest ładowane z `dist/chrome`
(wynik `npm run build`, nigdy z `src/`); `globalSetup` buduje projekt, chyba że `PDS_E2E_NO_BUILD=1`.

**Nie uruchamiaj dwóch przebiegów e2e naraz bez `PDS_E2E_NO_BUILD=1`** — drugi przebieg przebudowuje `dist/chrome` pod działającą
przeglądarką pierwszego (losowe porażki, ~50% w takim scenariuszu). Zbuduj raz, potem uruchamiaj z flagą.

**WSL:** linuksowy Chromium z Playwrighta wymaga `libnss3`, `libnspr4`, `libasound2` (apt w sandboxie bywa zablokowany). Wtedy e2e
uruchamia się Node'em z Windows przez `cmd.exe /c "npm run test:e2e"` (poza sandboxem). Unit/lint działają linuksowym node, jeśli w
`node_modules` są linuksowe binarki `rolldown`/`lightningcss` — nie rób `npm ci` z WSL (usunie windowsowe). Zrzut ekranu: nie porównuj
wymiarów z `devicePixelRatio` przy emulowanym `deviceScaleFactor` (spike E2-T0). Firefox: spike w `tests/e2e/spike-e2/firefox.spike.mjs`,
reszta — ręczne QA (FQ-*).

### `launchWithExtension({ distDir?, headless?, downloadDir? })`
`chromium.launchPersistentContext` z `channel: 'chromium'` (nowy headless; `PDS_E2E_HEADED=1` pokazuje okno), argumenty
`--disable-extensions-except`, `--load-extension`, `--enable-unsafe-extension-debugging` (CDP `Extensions`). Zwraca
`{ context, extensionId, extensionInfo, browserCdp, downloadDir, serviceWorker, stopServiceWorker, grantOrigin, sessionStorage, close }`:

- `grantOrigin(pattern)` — nadaje dostęp do witryny bez okna zgody: `chrome.developerPrivate.addHostPermission` (spike E1-T0).
  Wzorzec jak w `originPatternFor` (np. `http://127.0.0.1/*`).
- `serviceWorker()` — uchwyt SW (wybudza go kartą `manifest.json` + `sendMessage`, jeśli został ubity); `stopServiceWorker()` —
  `Target.closeTarget` na celu `service_worker` + polling `Target.getTargets` (test „stan przeżywa uśpienie SW”).
- `sessionStorage.get(key)` / `.set(key, value)` — odczyt/zapis `chrome.storage.session` rozszerzenia przez SW (np. `pds:rec`,
  `pds:test:recordingLimitMs`).
- `downloadDir` — katalog pobrań. Pobrania idą przez `Browser.setDownloadBehavior { behavior: 'default' }` + `download.default_directory`
  w `Preferences` tymczasowego profilu (przy `allow` Chrome ignoruje `filename` i zapisuje `<uuid>.json`; Playwrightowe `allowAndName` też psuje
  nazwę). Nic nie ląduje w Pobranych użytkownika.

### Popup i przepływ użytkownika
- `openPopupFor(page)` — prawdziwy popup jak klik ikony: CDP `Extensions.triggerAction` na celu `tab` strony. Zwraca
  `{ evaluate, click, textOf, waitForText, waitFor, close }`. **Popup nie jest `Page`** — steruje się nim przez CDP
  (`Runtime.evaluate`; klik ma `userGesture: true`, bez tego `permissions.request` odrzuca). **Tylko jeden popup naraz.**
  `popup.close()` czeka na zniknięcie celu; `openPopupFor` czeka na gotowy dokument `popup.html`.
- `startRecording(page, { grant = true })` — klik „Nagrywaj” (z `grantOrigin`, więc bez okna zgody), czeka na przeładowanie karty
  i „Nagrywam od HH:MM:SS”. `saveRecording(page)` — klik „Zapisz paczkę”, czeka (≥ 16 s, dłużej niż 15 s timeout kontrolera, żeby zgubiona
  odpowiedź była widoczna jako `pageBusy`) na „Zapisano plik …” i czyta plik z `downloadDir` po nazwie z komunikatu →
  `{ fileName, path, json, statusText, savedAfterMs }`. `setRecordingLimit(page|ext, ms|null)` — limit testowy (tło ogranicza do 1000–600000).
  `popupState(page)` — stan popupu (sekcja, tekst, aktywność przycisków).
- `activeTab` działa do nawigacji: po `page.goto` wywołaj `openPopupFor` ponownie.
- `listDownloads`, `waitForDownloadFile`, `expectDownload(pageOrExt, action)` — pliki z `downloadDir` (pobranie inicjuje popup, więc nie ma
  zdarzenia `download` Playwrighta).
- Inne helpery: `helpers/unzip.js` (zip z `npm run pack`), `helpers/fixtures-server.js`, `helpers/git-status.js`.
- `globalTeardown` porównuje `git status` ze stanem z `globalSetup` i failuje, gdy e2e zmieniło drzewo robocze.
- Stabilność: `retries: 0`, `workers: 2`; nie dodawaj `retries` bez komentarza z przyczyną.
- Zgoda w oknie przeglądarki (bąbel `permissions.request`) zamyka popup — scenariusz odmowy testuje `failure.spec.js` (`permissionDenied`).

### Pliki specyfikacji
`recording.spec.js` (przepływ, `document_start`), `navigation.spec.js` (nawigacje, SPA, restart SW), `time-limit.spec.js`,
`isolation.spec.js` (wroga strona, CSP, AC-5.x), `perf.spec.js`, `console-fallback.spec.js`, `restricted.spec.js`, `failure.spec.js`,
`packed-zip.spec.js`, `harness-e1.spec.js` (smoke harnessu). Strony: `tests/fixtures/pages/`.

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
| `hostile.html`, `flood.html` | wroga strona (podmienia `JSON`, `dispatchEvent`, nasłuchuje zdarzeń) / zalew logów i zapytań (limity buforów) |
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
