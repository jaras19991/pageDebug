# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/). Wpisy per epik pod `[Unreleased]` do czasu release.

## [Unreleased]

### E1 — Model nagrywania: dane od startu strony (schemat paczki v2; wersję 0.3.0 nada release)

#### Dodano
- Przepływ **Nagrywaj → Zapisz paczkę**: po „Nagrywaj” rozszerzenie prosi o dostęp do witryny aktywnej karty (`permissions.request`), rejestruje skrypty (`scripting.registerContentScripts`, `document_start`) i przeładowuje kartę; nagrywanie obejmuje konsolę, błędy i sieć od początku ładowania strony, także po przeładowaniach i nawigacjach w obrębie witryny.
- Tło: `src/background.js` jako service worker (Chrome) i event page (Firefox), stan w `storage.session` (`src/lib/session-store.js`, `src/lib/recording.js`), znaczek ● / ■ na ikonie.
- Limit nagrywania 10 minut (auto-stop, zapis nadal możliwy; `recordingStoppedReason: "time-limit"`).
- Zapis przez `downloads.download`; sukces („Zapisano plik …”) dopiero po `complete`, z nazwą faktycznego pliku; limity 15 s (zrzut) i 60 s (pobranie).
- Popup w trzech stanach (gotowy / nagrywam / zapis) z listą „Do pliku trafią:” i zgodą (`disclosureItems`, `consentNotice` w `src/popup/messages.js`); nowe komunikaty: `permissionDenied`, `pageBusy`, `saveCancelled`, `downloadFailed`, `recordFailed`, `stoppedByLimit`, `otherTabRecording`, `otherOrigin`.
- Schemat paczki **v2** (`schemaVersion: 2`): `documents[]`, `limits`, `truncated`, `source`, `recordingStartedAt`, `recordingStoppedReason`, `timeOrigin`, czas `t` względem `timeOrigin` dokumentu, `stack` w logach konsoli, `method`/`statusText`/`redirected`/`requestBody` w `network`; fixture `tests/fixtures/snapshots/v2.json`; migracja v1 → v2 w `docs/snapshot-schema.md`.
- Uprawnienia: `storage`, `downloads`, `optional_host_permissions` (`http://*/*`, `https://*/*`, `file:///*`); uzasadnienia PL/EN i akapit o cofaniu dostępu do witryny w `README.md`.
- Kod strony jako moduły ES w `src/page` + generator `scripts/gen-content.mjs` (`npm run gen`, `npm run gen -- --check`) → `src/content/{isolated,main}-world.js` i `src/standalone/console-snapshot.js`.
- Fallback konsolowy `console-snapshot.js` (`PageDebugSnapshot.start/stop/download/snapshot`) na tym samym kodzie i schemacie (`source: "console"`).
- Harness e2e dla tła: `serviceWorker()`, `stopServiceWorker()`, `grantOrigin()`, `sessionStorage`, `downloadDir`, `startRecording`, `saveRecording`, `setRecordingLimit`, `popupState`; flaga `PDS_E2E_NO_BUILD=1`; testy izolacji, nawigacji, limitu czasu, wydajności i fallbacku.

#### Zmieniono
- **Schemat paczki v1 → v2 jest łamiący** (`initializedAt` → `recordingStartedAt`, `timestamp`/`startedAt` → `t`, `network[].input/init/headers/body` → `method`/`url`/`requestHeaders`/`responseHeaders`/`requestBody`, usunięte `version`); konsumenci rozpoznają v1 po braku `schemaVersion`.
- Hooki: `fetch` i `XMLHttpRequest` przez `Proxy` (zachowane `instanceof` i stałe), `console` ze `stack`, bufory pierścieniowe z limitami (5000 / 1000 / 5000 wpisów); po zapisie hooki są zdejmowane, a wrapper założony przez stronę nie jest nadpisywany.
- Termin nagrywania liczony z `Date.now()` (a nie `performance.now()`), więc uśpienie komputera nie przedłuża limitu.
- Budżet `storage.session` (≤ 3 MB na dokument, ≤ 8 MB razem) egzekwowany przed zapisem; przy braku miejsca najstarsze dokumenty zostają tylko z licznikami.
- `documents[].recorded` jest `false` także dla dokumentu, do którego recorder się nie podłączył; `notes` wyjaśnia, gdy bieżąca strona załadowała się po auto-stopie.

#### Usunięto
- Przepływ E0 (jednorazowy zrzut przez `scripting.executeScript`): `src/page/page-debug-snapshot.js`, `src/popup/snapshot-tab.js`, `src/popup/run-in-page.js`, przycisk „Debug snapshot”, globalne `window.__PAGE_DEBUG_SNAPSHOT__` oraz testy i specyfikacje e2e E0.

#### Naprawiono
- Fałszywy sukces przy zablokowanych pobraniach (F3 z E0): komunikat dopiero po potwierdzeniu `downloads.onChanged`.
- Błędy i zapytania sprzed kliknięcia nie giną już — recorder działa od `document_start`.
- Popup nie gubi wyniku `pageBusy` / `failed` / `saveCancelled` przy zmianie stanu tła (komunikat zostaje na ekranie).
- E2E: `popup.close()` czeka na zamknięcie celu, `openPopupFor` na gotowy dokument; równoległe przebiegi nie przebudowują `dist/` z `PDS_E2E_NO_BUILD=1`.

#### Bezpieczeństwo
- Ujawnienie danych i zgoda w UI: lista „Do pliku trafią:” (w tym treść żądań sieciowych, ciasteczka i dane strony, „mogą zawierać dane logowania”) oraz zgoda przy „Nagrywaj”.
- Dostęp do witryn tylko opcjonalny i tylko dla witryny aktywnej karty; brak `host_permissions`, `tabs`, `webRequest`, `cookies`, zdalnego kodu.
- Brak globali w trybie rozszerzenia (`window.PageDebugSnapshot`, `__PAGE_DEBUG_SNAPSHOT__`); bufor tylko w domknięciu; po zapisie hooki zdjęte, skrypty wyrejestrowane.
- Prywatny kanał MAIN ↔ ISOLATED (odłączony węzeł DOM, `CustomEvent` ze stringiem, intrinsics przechwycone na `document_start`) zamiast `postMessage`: skrypty strony nie czytają bufora ani nie podszywają się pod rozszerzenie.
- Router tła przyjmuje polecenia tylko od popupu rozszerzenia, a wiadomości mostu tylko z ramki głównej karty; wynik zapisu ustala wyłącznie tło.
- Strażnik przywracania `console`: wrapper założony przez stronę (np. Sentry) zostaje, nasz staje się przelotowy.
- Znane ograniczenie: **dane nadal niezredagowane** (maskowanie w E3) — ciasteczka, storage, nagłówki i treść żądań, wartości pól formularzy (poza `password`/`hidden`) i `dom.html.outerHTML` trafiają do pliku wprost.
- Znane ograniczenia: `xhr.constructor === XMLHttpRequest` daje `false`; `fetch.toString()` w trakcie nagrywania nie ma nazwy; auto-stop po uśpieniu komputera zapada przy odpaleniu timera; Firefox bez automatycznego e2e (ręczne QA).

## [0.2.0] - 2026-10-22

### E0 — Fundament: repo, build, testy, higiena MV3 (Chrome + Firefox)

#### Dodano
- Dwa targety MV3 z jednej bazy: `dist/chrome` i `dist/firefox` (`npm run build`), manifesty składane z `src/manifest.base.json`, `src/manifest.chrome.json`, `src/manifest.firefox.json`.
- `npm run pack` — po jednym zipie na target: `dist/page-debug-snapshot-<target>-<wersja>.zip` (deterministyczne).
- `npm run icons` — ikony 16/48/128 generowane skryptem `scripts/icons.mjs` (neutralne, bez tekstu i logo).
- `npm run dev:chrome` / `npm run dev:firefox` (`scripts/dev-browser.mjs`, przez `web-ext`) oraz zmienna `PDS_CHROMIUM_BINARY`.
- Testy: vitest + jsdom (jednostkowe, w tym charakteryzacyjne dla `page-debug-snapshot.js`), Playwright e2e na Chromium z `dist/chrome` (headless; `PDS_E2E_HEADED=1` — z oknem), `web-ext lint` w `npm run lint`.
- `npm run check:history` i `scripts/check-repo.mjs` — pilnują, by w repo i historii nie było `*.pem`, `*.crx`, `*.xpi`, `*.zip`, logo ani prawdziwych snapshotów.
- Dokumentacja: `README.md`, `docs/INSTRUKCJA-ZGLASZAJACEGO.md`, `docs/snapshot-schema.md`, sklepowe uzasadnienia uprawnień PL/EN w README.

#### Zmieniono
- Układ repo: `page-debug-extension/` → `src/{popup,page,icons,standalone}`; `console-snapshot.js` → `src/standalone/`; `package.json` w katalogu głównym, bez `dependencies` (usunięto `sharp`).
- Popup pokazuje prawdziwy wynik po polsku (komunikaty w `src/popup/messages.js`): sukces z nazwą pliku, strona niedostępna, brak zgody na pliki lokalne, brak karty, błąd.
- Wstrzykiwanie przez `scripting.executeScript` w świecie `MAIN` zamiast doklejania `<script src="chrome-extension://…">`; usunięto `inject.js`.
- `permissions`: tylko `activeTab` i `scripting`; `description` w manifeście to jedno zdanie.
- Identyfikator Firefoksa: GUID `{799eb178-df9a-41bb-9775-8fc8aff45926}`; ikony bez znaków towarowych (projekt niezależny).
- `scripts/dev-browser.ps1` deleguje do `npm run build` / `npm run pack` i `scripts/dev-browser.mjs`.

#### Naprawiono
- Fałszywy sukces: popup nie mówi już „pobrano”, gdy zrzut się nie udał (błąd wewnątrz skryptu strony jest raportowany).
- Firefox: zrzut nie działał na żadnej stronie (ścieżka pliku wstrzykiwanego rozwiązywana względem popupu) — ścieżka z wiodącym `/`.
- Chrome: strona `file://` bez zgody „Zezwalaj na dostęp do adresów URL plików” pokazuje instrukcję zamiast komunikatu o stronie niedostępnej.
- `scripts/dev-browser.ps1 -Pack` zawsze kończył się błędem (zepsuty filtr) — teraz `npm run pack`.

#### Bezpieczeństwo
- Brak `host_permissions` (w tym `<all_urls>`) i `web_accessible_resources`; rozszerzenie nie ujawnia swojego ID stronom i nie wysyła niczego do sieci.
- Brak zdalnego kodu, `eval` i `new Function` w `dist/*` (test).
- Klucz `.pem`, `*.crx`, `*.xpi`, `*.zip`, `dist/` i prawdziwe snapshoty są ignorowane; historia gita oczyszczona z plików logo.
- Znane ograniczenia (E3): paczka nadal zawiera jawnie ciasteczka, storage, treść strony i wartości pól (poza `password`/`hidden` w `dom.forms`); po zrzucie zostaje `window.__PAGE_DEBUG_SNAPSHOT__`.
- Znane ograniczenia (E1): w Chrome zablokowane automatyczne pobieranie wielu plików może dać komunikat sukcesu bez pliku.
- Znane ograniczenia (Firefox): dodatek ładowany tymczasowo znika po restarcie przeglądarki; trwała instalacja wymaga podpisu AMO (E5).
- Licencja: MIT (`LICENSE`, `package.json`).
