---
name: extension-testing
description: Jak testować Page Debug Snapshot — vitest+jsdom dla logiki recordera/redakcji/summary, Playwright z załadowanym rozszerzeniem MV3 dla e2e (service worker, popup, pobrany plik), strony fixture, stabilność. Czytaj przed pisaniem lub uruchamianiem testów.
---

# Testowanie rozszerzenia

## Dwa poziomy, jasny podział

| Poziom | Narzędzie | Co testuje | Czego nie |
|---|---|---|---|
| **Unit** | vitest + jsdom (`npm test`) | `recorder.js` (hooki na fake fetch/XHR), `redact.js`, `summarize.js`, `collector.js` na syntetycznym DOM, `vitals` mapowanie | niczego, co wymaga `chrome.*` lub prawdziwego renderowania |
| **E2E** | Playwright + Chromium z `--load-extension` (`npm run test:e2e`) | popup, service worker, `registerContentScripts`, prawdziwe `document_start`, pobranie paczki, zawartość zipa | wydajności (osobne testy syntetyczne), wizualnej poprawności (zrzuty tylko jako dowód QA) |

## Układ

```
tests/
  unit/            *.test.js — jeden plik na moduł
  e2e/
    helpers/launch.js   uruchamia Chromium z rozszerzeniem, zwraca { context, extensionId, serviceWorker }
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

## E2E — uruchomienie rozszerzenia MV3

```js
// tests/e2e/helpers/launch.js
import { chromium } from '@playwright/test';
import path from 'node:path';

export async function launchWithExtension(extPath = path.resolve('page-debug-extension')) {
  const context = await chromium.launchPersistentContext('', {
    headless: false,                      // MV3 SW w headless wymaga '--headless=new'; headed jest stabilniejsze
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    acceptDownloads: true,
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];
  return { context, extensionId, serviceWorker: sw };
}
```

- **Popup**: `await context.newPage()` → `page.goto(`chrome-extension://${extensionId}/popup.html`)`.
  Popup otwarty jako karta nie ma „aktywnej karty” w sensie `tabs.query({active: true, currentWindow})`
  tak samo jak prawdziwy popup — w testach wysyłaj komendy do SW bezpośrednio
  (`serviceWorker.evaluate(() => globalThis.startRecording(tabId))`) **albo** przekazuj `tabId` jawnie.
  Rozważ wystawienie w SW `chrome.runtime.onMessage` z komendami, a test używa `page.evaluate` w popupie.
- **Pobranie paczki**: `const dl = await page.waitForEvent('download'); const file = await dl.path();`
  Następnie `unzip`/`JSZip` lub `DecompressionStream` w Node ≥ 18 → parsuj `snapshot.json` → asercje na polach.
- **`document_start`**: strona fixture rzuca `throw new Error('early')` w pierwszym `<script>` w `<head>`
  i robi `fetch('/api/fail')` → 500 przed DCL. Test: oba w paczce. To jest **test akceptacyjny E1**.
- **Stabilność**: `context.waitForEvent('serviceworker')` może nie wystrzelić, jeśli SW już działa —
  stąd sprawdzenie `context.serviceWorkers()` najpierw. SW bywa ubijany — przed `evaluate` wybudź go
  przez `chrome.runtime.sendMessage` z popupu lub `serviceWorker.evaluate(() => 1)`.
- **Headless**: jeśli CI wymaga, `headless: true` + `args: ['--headless=new']`; przetestuj lokalnie,
  bo zachowanie `captureVisibleTab` w headless bywa różne.

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
