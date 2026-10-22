# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/). Wpisy per epik pod `[Unreleased]` do czasu release.

## [Unreleased]

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
