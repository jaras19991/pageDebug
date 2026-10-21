# E0-T17 — spike: akcja rozszerzenia z `activeTab` w Playwright

**Wynik: ścieżka (a) z D10 działa, headless i headed. PB-1 nie jest potrzebne.**
Data: 2026-10-22, Windows 11. Playwright 1.64.1, Chromium **156.0.8078.4** (`channel: 'chromium'`, nowy headless).
Pobranie `npx playwright install chromium`: 39 s, ok. 437 MB na dysku dla Chromium i 278 MB dla headless shell
(archiwum headless shell to 118 MiB, a do tego ffmpeg 1,6 MiB). Przy `channel: 'chromium'` headless shell nie jest używany.

Skrypt: `tests/e2e/spike/run.spike.mjs` (`node tests/e2e/spike/run.spike.mjs [--headed]`).
Rozszerzenie testowe: `tests/e2e/spike/ext/`. Manifest ma tylko `activeTab` i `scripting`, bez `host_permissions`.
Popup woła `tabs.query({active, currentWindow})` → `executeScript(world: 'MAIN', func: () => document.title)`.
Fixture: serwer `http` na `127.0.0.1:0`. Uruchomienie:
`launchPersistentContext('', { channel: 'chromium', headless, args: [--disable-extensions-except, --load-extension, --enable-unsafe-extension-debugging] })`.

## Wyniki

| # | Metoda | Działa? | Dowód (log) |
|---|---|---|---|
| ID | `chrome://extensions` → `chrome.developerPrivate.getExtensionsInfo()` | tak | `id via developerPrivate ["njbb…aglo"]`, zgodne z URL SW |
| (a) | Domena CDP `Extensions` na sesji browser-level (`browser.newBrowserCDPSession()`) | tak | `triggerAction`, `loadUnpacked`, `uninstall`, `getStorageItems` → `Invalid parameters` (istnieją); `getExtensions` → ok; `openPopup` → `wasn't found` |
| (b) | `Extensions.triggerAction({ id, targetId })`, gdzie `targetId` jest celem typu **page** | nie | `Action can only be triggered on a tab target.` |
| (b) | to samo, ale `targetId` wskazuje cel typu **`tab`** | **tak** | `triggerAction returned {}` → `{"ok":true,"tabUrl":"http://127.0.0.1:…/trigger","title":"Fixture T17 /trigger"}` |
| (c1) | `chrome.action.openPopup()` z SW (`serviceWorker.evaluate`) | otwiera popup, ale nie daje `activeTab` | 1. przebieg: `resolved`, popup: `Cannot access contents of the page…`; po wcześniejszym `triggerAction`: `rejected: Failed to open popup.` |
| (c2) | Skrót `_execute_action` (`Alt+Shift+Y`) przez `page.keyboard` (CDP `Input.dispatchKeyEvent`) | nie | `no popup result within 3000ms` (zdarzenie trafia do renderera, a nie do akceleratorów przeglądarki) |
| kontrola | popup jako karta `popup.html?tabId=` bez host permission | nie (oczekiwane) | `Cannot access contents of the page. Extension manifest must request permission…` |
| (d) | kopia z `host_permissions: ["http://127.0.0.1/*"]` + `popup.html?tabId=`, headless | tak | `{"ok":true,"title":"Fixture T17 /fallback"}` |

Headed (`--headed`) daje identyczne wyniki we wszystkich wierszach.

## Jak znaleźć cel `tab`
`Target.getTargets` domyślnie ukrywa cele typu `tab`, więc trzeba wołać z `filter: [{}]`.
Następnie `find(t => t.type === 'tab' && t.url === page.url())`. Przy kilku kartach z tym samym URL potrzebny jest unikalny URL
(np. `?run=<n>`) albo dopasowanie przez `Target.getTargetInfo` strony i relację rodzic–dziecko.

## Ograniczenia, które ma rozwiązać T16b
- **Popup nie staje się `Page` w Playwright.** `context.pages()` się nie zmienia, zdarzenie `page` nie przychodzi.
  Popup jest widoczny tylko jako cel CDP `page` z URL `chrome-extension://<id>/popup.html`.
  Do sterowania nim (kliknięcie przycisku, odczyt statusu) działa `Target.attachToTarget({ flatten: false })`
  i `Target.sendMessageToTarget` z `Runtime.evaluate`. Dowód: odczytany `#out` popupu = `{"ok":true,…}`.
  `CDPSession` Playwrighta nie przyjmuje `sessionId`, więc z `flatten: true` nie skorzystamy.
- Pobranie pliku odbywa się na stronie fixture (`<a download>` z `runInPage`), więc `page.waitForEvent('download')`
  na karcie fixture powinno działać. Spike tego **nie sprawdzał**, bo nie było jeszcze kodu produkcyjnego.
- `--enable-unsafe-extension-debugging` jest wymagane. Bez tej flagi domena `Extensions` jest niedostępna (wg design.md;
  w spike'u flaga była zawsze włączona).
- Baseline wydajności z `411f60e` (mediana klik → download) **nie został zmierzony**, bo spike odpowiadał tylko na pytanie o wykonalność.
  Do zrobienia w T16b, tą samą techniką.
- `activeTab` obowiązuje dla danej karty do nawigacji. Każdy test musi wołać `triggerAction` na świeżej karcie
  albo po `goto`.

## Rekomendacja dla T16b
Ścieżka (a): `openPopupFor(page)` działa w kolejnych krokach:
1. ID z `developerPrivate.getExtensionsInfo()` (szukanie po `name`).
2. `newBrowserCDPSession()`.
3. Cel `tab` dla `page` (`Target.getTargets({ filter: [{}] })`).
4. `Extensions.triggerAction({ id, targetId })`.
5. Oczekiwanie na cel `popup.html` (`Target.getTargets` w pętli z timeoutem).
6. Attach w trybie non-flatten i helper `popupEval(expr)` do kliknięcia i odczytu statusu.

Ścieżka (d) też działa i zostaje jako zapas (zgoda z PB-1), ale nie jest potrzebna.
