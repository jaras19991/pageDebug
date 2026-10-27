# Page Debug Snapshot

Rozszerzenie przeglądarkowe (MV3, Chrome i Firefox z jednej bazy kodu). Zgłaszający klika „Nagrywaj”, strona odświeża się,
a rozszerzenie od początku jej ładowania zapisuje konsolę, błędy, zapytania sieciowe i zasoby strony, kroki zgłaszającego
oraz metryki wydajności, a przy zapisie także stan strony (środowisko, struktura DOM, storage) i zrzut widocznej części karty.
Po „Zapisz paczkę” powstaje jeden plik `.zip` w pobranych (`snapshot.json`, `summary.md`, `screenshot.jpg`), z którego tło usunęło hasła,
tokeny i wartości ciasteczek, a który zgłaszający przekazuje developerowi; rozszerzenie niczego nie wysyła do sieci.
Instrukcja dla osoby zgłaszającej: [docs/INSTRUKCJA-ZGLASZAJACEGO.md](docs/INSTRUKCJA-ZGLASZAJACEGO.md).
Instrukcja dla developera, jak czytać paczkę (viewer, `summary.md`, agent AI przez MCP, porównanie dwóch paczek):
[docs/JAK-CZYTAC-PACZKE.md](docs/JAK-CZYTAC-PACZKE.md).

## Szybki start

Wymagany Node: `^22.22.2 || ^24.15.0 || >=26.0.0` (pole `engines` w `package.json`; rozwijane na Node 26).

```
git clone <repo-url> && cd <repo>
npm ci
npx playwright install chromium     # jednorazowo, dla testów e2e
npm run lint && npm test && npm run test:e2e
npm run build
npm run gen -- --check              # bundle z src/page są aktualne
```

Wszystkie komendy z katalogu głównego repo:

| Komenda | Co robi |
|---|---|
| `npm run build` | składa `dist/chrome/` i `dist/firefox/` od zera (manifesty z `src/manifest.*.json`) |
| `npm run gen` | generuje bundle z modułów `src/page` (`src/content/*.js`, `src/standalone/console-snapshot.js`); `npm run gen -- --check` tylko sprawdza, że są aktualne (kod ≠ 0, gdy nie) |
| `npm run pack` | build + po jednym `dist/page-debug-snapshot-<target>-<wersja>.zip` na target oraz viewer `dist/page-debug-viewer-<wersja>.html`; z `--config` patrz „Konfiguracja developerska” |
| `npm run icons` | generuje `src/icons/icon{16,48,128}.png` (patrz „Ikony”) |
| `npm run lint` | build + `eslint` + `web-ext lint` na `dist/firefox` (2 warnings o `data_collection_permissions` są znane) |
| `npm test` | vitest + jsdom; bez przeglądarki i sieci |
| `npm run test:e2e` | Playwright, Chromium z `dist/chrome`, headless; `PDS_E2E_HEADED=1` pokazuje okno; `PDS_E2E_NO_BUILD=1` pomija budowanie `dist/` (patrz „Konfiguracja developerska”) |
| `npm run dev:chrome` / `npm run dev:firefox` | build + przeglądarka na tymczasowym profilu z załadowanym rozszerzeniem (przez `web-ext`) |
| `npm run check:history` | sprawdza, że w historii gita nie ma `*.pem`, `*.crx`, `*.xpi`, `*.zip`, logo ani prawdziwych snapshotów |
| `npm run fixtures` | lokalny serwer stron testowych z `tests/fixtures/pages` |

`npm run dev:chrome` używa domyślnie Chrome znalezionego przez `web-ext` (bywa to Canary). Konkretną binarkę
wskaż zmienną `PDS_CHROMIUM_BINARY`:

```
PDS_CHROMIUM_BINARY="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run dev:chrome   # Git Bash
$env:PDS_CHROMIUM_BINARY = "C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run dev:chrome   # PowerShell
```

Adres startowy: `npm run dev:chrome -- --url http://127.0.0.1:8080/basic.html`. Na Windows jest też nakładka
`scripts/dev-browser.ps1 -Browser chrome|firefox [-Url ...]`; `-Pack` robi to samo co `npm run pack`.

### Ręczne ładowanie rozszerzenia

- **Chrome:** `npm run build`, potem `chrome://extensions` → włącz „Tryb programisty” → „Załaduj rozpakowane” → wskaż `dist/chrome`.
  Po zmianie kodu: `npm run build` i przycisk odświeżania przy rozszerzeniu.
- **Firefox:** `npm run build`, potem `about:debugging` → „Ten Firefox” → „Załaduj tymczasowy dodatek” → wskaż
  `dist/firefox/manifest.json` (albo zip z `npm run pack`, nierozpakowany). Dodatek tymczasowy **znika po restarcie przeglądarki**
  — to normalne; trwała instalacja wymaga podpisu AMO (E5).

Potem otwórz zwykłą stronę `http(s)://` i kliknij ikonę: popup pokazuje listę danych, które trafią do pliku, i przycisk „Nagrywaj”.

Dla testera: `npm run pack` i wysłać zip właściwego targetu (Chrome: rozpakować i „Załaduj rozpakowane”; Firefox: nie rozpakowywać).

Klucz `.pem` trzymamy poza repo (jest w `.gitignore`; nie kopiujemy go, nie commitujemy). Prawdziwych snapshotów
(`snapshot-*.zip`, `page-debug-snapshot-*.json`) też nie commitujemy.

## Jak to działa

```
popup (src/popup)  <-- runtime.sendMessage -->  tło (src/background.js + src/lib)  <-- tabs / runtime -->  ISOLATED most
  getStatus, armStart, start,                    Chrome: service worker                                      (content/isolated-world.js)
  collect, saveStarted, disarm                   Firefox: event page                                              |
  Blob + downloads.download                      stan: storage.session                                            | prywatny kanał: odłączony węzeł DOM,
                                                                                                                  | CustomEvent ze stringiem (bez postMessage)
                                                                                                                  v
                                                                                                         MAIN recorder (content/main-world.js)
                                                                                                         hooki fetch / XHR / console / błędy
```

Przepływ:

1. **Nagrywaj** — popup wysyła `armStart` i w tym samym geście wywołuje `permissions.request` o dostęp do witryny aktywnej karty
   (jeden wzorzec); okno zgody pokazuje przeglądarka. Po zgodzie popup woła `start`.
2. Tło przez `scripting.registerContentScripts` rejestruje dwa skrypty tylko dla tej witryny (`document_start`, bez `persistAcrossSessions`):
   ISOLATED (most) i MAIN (recorder). Zapisuje stan w `storage.session` (`pds:rec`) i przeładowuje kartę. Ikona dostaje znaczek ●.
3. Po przeładowaniu most i recorder łączą się prywatnym kanałem, a recorder pyta tło (`hello`) o konfigurację: czy nagrywać, `docId`
   i termin (limit 10 min). Od tej chwili hooki zbierają wpisy w buforach pierścieniowych. Przy opuszczaniu strony (`pagehide`)
   bufor trafia do tła (`flush`), więc dane przeżywają przeładowania i nawigacje w obrębie witryny.
4. **Zapisz paczkę** — popup wysyła `collect`; tło robi zrzut karty (`captureVisibleTab`, limit 3 s; tylko gdy karta jest aktywna i na origin nagrania), prosi bieżący dokument o resztę danych (limit 15 s), dołącza dane wcześniejszych dokumentów
   i składa paczkę (`assemblePackage`, schemat v4). Jeśli zgłaszający zostawił włączony przełącznik „Dołącz zrzut ekranu”, tło najpierw ustala
   prostokąty pól formularzy (most ISOLATED) i zamalowuje je na obrazie; gdy się nie da, zrzutu nie ma (fail-closed). Potem `exportPackage`
   przycina, redaguje, mieści w budżecie 2 MB i pakuje do zipa (patrz „Co trafia do paczki”). Popup robi `Blob` i woła `downloads.download`,
   a potem `saveStarted` z `downloadId`.
5. Tło śledzi `downloads.onChanged`. Dopiero `complete` daje komunikat „Zapisano plik …”; wtedy tło wyrejestrowuje skrypty,
   zdejmuje hooki i czyści `storage.session`. Przerwane lub nieudane pobranie zostawia nagrywanie włączone.
   Popup pokazuje wtedy ekran „Zapisano” (nazwa pliku, „Pokaż plik”, „Nowe nagranie”); tło trzyma w `storage.session` ostatni zapis karty
   (`lastSaved`) do kolejnego „Nagrywaj”. „Pokaż plik” sprawdza najpierw `downloads.search`, czy plik nadal istnieje, i dopiero potem woła `downloads.show`.
   Rozszerzenie niczego nie wysyła — plik zgłaszający przekazuje sam (e-mail, komunikator).

Limit nagrywania to 10 minut (auto-stop; zapis nadal możliwy). Uzasadnienia decyzji: `docs/epics/E1/design.md`, `docs/epics/E3/design.md`.

## Co trafia do paczki (schemat v4)

Pełny opis pól: [docs/snapshot-schema.md](docs/snapshot-schema.md).

### Format pliku

`snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` (host bez portu, czas lokalny zgłaszającego; dokładny czas UTC jest w `collectedAt`).
Wpisy zipa w stałej kolejności:

| Wpis | Co to |
|---|---|
| `snapshot.json` | paczka: `schemaVersion: 4`, wszystkie sekcje, JSON z wcięciem |
| `summary.md` | pełne podsumowanie po polsku (≤ 16 KB, ≤ 200 linii), budowane ze **zredagowanego** `snapshot.json`: środowisko, kroki, grupy błędów, nieudane zapytania, CWV, najwolniejsze zasoby, ciasteczka, prywatność (reguły v2, zrzut), pierwsze notatki; ten sam tekst w viewerze i w MCP (`get_summary`) |
| `screenshot.jpg` | tylko gdy jest zrzut: JPEG ≤ 300 KB z zamalowanymi polami formularzy |

`unzip -t` powinno dać „No errors detected”; zip otwiera się Eksploratorem Windows i Archiwizatorem macOS bez dodatkowych programów.
Plik `snapshot.json` czyta się od góry: `overview` (same liczby) → `redaction` (co zamaskowano) → `limits`/`truncated` → `notes` → `steps` →
`runtimeErrors` → `network` → `vitals` → `screenshots` → `consoleLogs` → sekcje strony; `dom.structure` jest na końcu.

| Dane | Gdzie | Co zawiera |
|---|---|---|
| Kroki zgłaszającego | `steps[]` | klik (selektor CSS, etykieta ≤ 80 znaków), `input`/`change` (typ pola i **długość**, nigdy wartość; bez długości dla `password`, checkboxów i radio; pole pliku: tylko `fileCount`), `submit`, `key` (tylko Enter/Escape/Tab/strzałki), `navigate` |
| Metryki wydajności | `vitals[]` | TTFB, FCP, LCP, CLS, INP z oceną i atrybucją, do 20 najdłuższych long tasks; niedostępna metryka to `{available:false, reason}` |
| Zasoby i statusy | `network[]` | `fetch`/XHR i zasoby strony z `status`, `sizeBytes`; brak statusu zawsze ma `statusUnavailable` |
| Podglądy odpowiedzi z błędem | `network[].responseBodyPreview` | tylko `fetch`/XHR ze statusem ≥ 400 i treścią tekstową, ≤ 4096 znaków na wpis, ≤ 256 KB łącznie |
| Ciasteczka | `storage.cookies[]` | `name`, `sizeBytes`, `valueHash` (8 znaków hex SHA-256 wartości, bez soli); wartości nie ma w paczce |
| Struktura DOM | `dom.structure` | tagi i atrybuty `id`, `class`, `role`, `data-*`, `aria-*`, `type`; bez tekstów, `value`, `href`, `src`; ≤ 300 000 znaków. **Nie ma `outerHTML`** |
| Formularze | `dom.forms[]` | typ, nazwa, `valueLength` (nie wartość), `fileCount` dla pola pliku |
| Obrazki i ramki | `dom.images[]`, `dom.iframes[]` | `altLength` / `titleLength` zamiast tekstów |
| Zrzut ekranu | `screenshots[]` + `screenshot.jpg` | jeden JPEG widocznej części karty, tylko gdy karta jest widoczna i pokazuje nagrywaną witrynę; `maskedFields` = liczba zamalowanych pól; bez zrzutu: `screenshots: []` + notatka z powodem |
| iframe'y | `runtimeErrors[].frame`, `consoleLogs[].frame` | tylko błędy z ramek tego samego originu; kroki, sieć i metryki tylko z dokumentu głównego |

### Redakcja

Całą paczkę redaguje tło (`src/lib/redact.js`, `redact-rules.js`, `redact-page.js`) na kopii złożonej paczki, przed budżetem i zipem.
Ochrona u źródła w MAIN (nagłówki, adresy i podglądy w hookach sieci, kroki) to tylko obrona w głąb. Reguły: skill `privacy-redaction`,
`rulesVersion: 2` (od 0.6.0; reguły v2 maskują dodatkowo m.in. klucz na początku stringu JSON, `code`/`ticket` w tekście,
podgląd konsoli i zdania w argumentach konsoli; atrybut `srcdoc` ramek zastępuje `[redacted:html-structure]`).

- **Zawsze** (nie do wyłączenia): wartości przy kluczach wrażliwych (`token`, `password`, `auth`, `session`, `key`, `cvv`, `cvc`, `pass`, `pw`, …;
  `code`/`ticket` tylko jako parametr adresu URL), JWT, `Bearer`/`Basic`, karta (Luhn), IBAN, PESEL, długie sekrety, `user:hasło@`, fragment `#…` z tokenem,
  wartości pól formularzy.
- **Domyślnie** (developer może wyłączyć, zgłaszający nie): `email`, `phone`, `html-structure` (pełny HTML w `dom.fullHtml`).
- Zamaskowana wartość to string `[redacted:<reguła>]` (np. `[redacted:key-token]`, `[redacted:jwt]`), nigdy `null`. Liczby i booleany
  przy kluczu wrażliwym w danych użytkownika też stają się stringiem znacznika — to jedyna zmiana typu.
- Raport: `redaction.masked` (liczba znaczników per sekcja, bez wartości; suma = liczba `[redacted:` w pliku) oraz linia w `summary.md`.
  Redakcja jest idempotentna i nie zmienia struktury obiektu.

### Budżet rozmiaru i notatki

Cel: zip ≤ 2 MB (`limits.packageBytes`; 10 MB z pełnym HTML). Przed redakcją paczka jest przycinana do 10 MB JSON-u (tylko całe wpisy), potem budżet
usuwa dane w stałej kolejności: pełny HTML → zasoby wydajności → udane zapytania sieciowe → logi konsoli `debug`…`warn` → listy `dom.*` →
`dom.structure` do 100 000 znaków → długie wartości storage → logi `error` → stosy do 4000 znaków. Każdy krok ustawia flagę w `truncated`
i dodaje notatkę z liczbą. **Nigdy nie są cięte:** `overview`, `redaction`, `documents`, `notes`, `steps`, `runtimeErrors`, nieudane zapytania (status ≥ 400
lub `error`), `vitals`, zrzut. Rozmiar nie blokuje zapisu — gdy po wszystkich cięciach jest za duża, paczka powstaje z notatką.
`notes` zawiera też, dla `consoleLogs`, `runtimeErrors`, `network` i `steps`, jedną notatkę o całkowitej różnicy między nagranym a zapisanym
(`<sekcja>: N recorded, M in the package; …`, tzw. `recordLoss`) — liczby z samych notatek o cięciach budżetu byłyby zaniżone.

### Opcje developerskie

Jedyna opcja to lista `disabledRules`: reguły poziomu *Domyślnie*, które developer chce wyłączyć. Dopuszczalne tylko `email`, `phone` i `html-structure`
(ta ostatnia włącza `dom.fullHtml`); reguł poziomu *Zawsze* nie da się wyłączyć żadną drogą, a nieznane nazwy i klucze są ignorowane
(`ignored` w buildzie wypisuje ostrzeżenie). Zgłaszający nie ma tej opcji i nie może jej zmienić. Szczegóły: „Konfiguracja developerska”.

### Chrome i Firefox

- **Firefox 158** (jedyna sprawdzona wersja): nie ma `layout-shift` ani long animation frames, więc `CLS` i `longTasks` to
  `available:false`, `reason:"unsupported-browser"`; `INP`, `TTFB`, `FCP`, `LCP` i `responseStatus` zasobów działają jak w Chrome.
  Dostępność metryk ustala wykrywanie funkcji, nie User-Agent.
- **Zrzut w Firefoksie:** `activeTab` jest tam cofany przy każdym przeładowaniu karty. Jeśli strona przeładuje się po otwarciu popupu,
  zapis nie zrobi zrzutu (`screenshots: []` + notatka); zamknij popup, otwórz go ponownie i zapisz. Chrome cofa `activeTab` dopiero
  przy zmianie originu.
- Fallback konsolowy (`console-snapshot.js`) ma te same klucze i ten sam potok eksportu (`PageDebugSnapshot.download()` daje zip v4), ale bez zrzutu, a `INP` obejmuje tylko interakcje po wklejeniu skryptu.
  Działa w realmie strony, więc wroga strona może osłabić jego redakcję (tło rozszerzenia nie ma tego problemu).

## Struktura repo

```
src/
  manifest.base.json, manifest.chrome.json, manifest.firefox.json   wspólna baza + różnice targetów
  background.js    tło: router wiadomości, top-level listenery, bez stanu w pamięci
  lib/             logika tła: recording.js, save.js, package.js (schemat v4), session-store.js, content-scripts.js, origin.js;
                   eksport: export.js (potok: przycięcie → redakcja → budżet → zip), redact.js / redact-rules.js / redact-page.js (redakcja),
                   budget.js (cięcia do 2 MB), zip.js, sha256.js, summary.js (summary.md), file-name.js, screenshot.js (zrzut + maska), mask-secrets.js
                   E4: summary.js (pełne summary.md), snapshot-query.js / snapshot-metrics.js (zapytania i metryki dla viewera, MCP i summary), unzip.js,
                   migrate.js (v1–v3 → v4 przy odczycie), package-reader.js (zip/JSON → znormalizowana paczka), screenshot-notes.js, dev-config.js
                   (wbudowana konfiguracja, podmieniana przez `--config`), dev-options.js (konfiguracja + `storage.managed`)
  managed-schema.json   schemat polityki Chrome (`storage.managed_schema`)
  popup/           popup.html, popup.js, controller.js, view.js, target.js, messages.js
  viewer/          źródło viewera (app.js, dom.js, tabs-*.js, viewer.html) — generowany do src/standalone/viewer.html
  page/            moduły ES kodu działającego na stronie (recorder, hooki, kanał, collector, dom-structure.js, field-rects.js, *-entry.js)
  content/         isolated-world.js, main-world.js — GENEROWANE z src/page (npm run gen); nie edytuj ręcznie
  standalone/      console-snapshot.js, viewer.html — GENEROWANE; konsola: wersja do wklejenia; viewer: kopiowany do dist/ przez pack (artefakt wydania)
  icons/           icon16/48/128.png        generowane przez npm run icons
mcp/               serwer MCP dla agentów AI (server.js, tools.js, snapshots-dir.js; README w katalogu)
scripts/           build.mjs, pack.mjs, gen-content.mjs, icons.mjs, dev-browser.mjs/.ps1, check-repo.mjs, lib/
tests/             unit/ (vitest), e2e/ (Playwright + helpers/), fixtures/ (pages, snapshots, modules)
dist/              wynik build/pack (ignorowany)
docs/              BACKLOG.md, snapshot-schema.md, INSTRUKCJA-ZGLASZAJACEGO.md, JAK-CZYTAC-PACZKE.md, epics/E*/
```

Bundle w `src/content` i `src/standalone` są w repo; test `gen-content` pada, gdy są nieaktualne. Po zmianie czegokolwiek w `src/page`
(lub w `src/lib/package.js`, którego używa fallback konsolowy) uruchom `npm run gen`. Moduły `src/page` mają ograniczoną składnię
(importy jednolinijkowe od kolumny 0, bez cykli, bez `import(`/`import.meta`/`require(` nawet w komentarzach) — reguły w `CLAUDE.md`.

## Konfiguracja developerska

### Konfiguracja reguł redakcji (`pds.config.json`)

Plik konfiguracyjny ma jeden klucz: `{ "disabledRules": ["email", "phone"] }` (wzór: `pds.config.example.json`, domyślnie `[]`).
Lokalny `pds.config.json` nie jest czytany niejawnie — trzeba go wskazać:

```
npm run build -- --config pds.config.json        # albo: PDS_CONFIG=pds.config.json npm run build
npm run dev:chrome -- --config pds.config.json   # dev:firefox tak samo; PDS_CONFIG też działa
npm run pack -- --config pds.config.json         # tylko jawny --config; zmiennej PDS_CONFIG pack NIE czyta
```

- Build wstawia konfigurację do `dist/<target>/lib/dev-config.js` (Chrome i Firefox dostają tę samą). Bez `--config` plik jest kopiowany bez zmian
  (`disabledRules: []`). Nieczytelny albo niepoprawny plik przerywa build z nazwą pliku.
- **`pack --config`** dopisuje do nazw zipów sufiks `-devconfig` (`page-debug-snapshot-chrome-<wersja>-devconfig.zip`) i wypisuje ostrzeżenie.
  Taki zip jest tylko do rozdania wewnątrz zespołu.
- **Do sklepu (Chrome Web Store, AMO) idzie zawsze build bez `--config`.** Nie wysyłaj zipa z sufiksem `-devconfig`.
- **Polityka zamiast buildu** (nadpisuje wbudowaną konfigurację w całości; `[]` włącza reguły z powrotem). Rozszerzenie czyta ją przez `storage.managed`
  (limit 1 s; brak polityki lub błąd = konfiguracja wbudowana):
  - Chrome: polityka `3rdparty.extensions.<id rozszerzenia>.disabledRules` (rejestr/GPO na Windows, `/etc/opt/chrome/policies/managed/*.json` na Linuksie);
    schemat polityki to `src/managed-schema.json` (`storage.managed_schema` w `manifest.chrome.json`).
  - Firefox: `policies.json` → `3rdparty` → `Extensions` → `{799eb178-df9a-41bb-9775-8fc8aff45926}` → `disabledRules`. Firefox bez polityki odrzuca
    `storage.managed.get` — rozszerzenie wtedy używa wbudowanej konfiguracji.
- Popup (przed „Nagrywaj”) i `summary.md` („Wyłączone przez developera: …”) ujawniają wyłączone reguły; w paczce są w `redaction.disabledRules`.
  Fallback konsolowy (`console-snapshot.js`) nie czyta konfiguracji — zawsze domyślne reguły.

### Środowisko i testy

- Zmienne: `PDS_CHROMIUM_BINARY` (binarka Chrome/Chromium dla `dev:chrome`), `PDS_E2E_HEADED=1` (e2e z widocznym oknem),
  `PDS_E2E_NO_BUILD=1` (e2e bez przebudowy `dist/`).
- **Nie uruchamiaj dwóch przebiegów e2e naraz bez `PDS_E2E_NO_BUILD=1`** — każdy przebieg domyślnie buduje `dist/chrome`,
  a drugi psuje pliki rozszerzenia działającej przeglądarce (losowe porażki). Zbuduj raz (`npm run build`), potem uruchamiaj z flagą.
- Limit nagrywania do testów: klucz `pds:test:recordingLimitMs` w `storage.session` rozszerzenia (ms; tło ogranicza do 1000–600000).
  W e2e ustawia go `setRecordingLimit`. Bez klucza obowiązuje 10 minut.
- e2e ładuje rozszerzenie z `dist/chrome`, nie ze źródeł. Popup nie jest w Playwright zwykłą stroną — steruje nim `openPopupFor`
  z `tests/e2e/helpers/launch.js`; przepływ zgłaszającego: `startRecording` / `saveRecording` z `helpers/recording.js`
  (więcej: skill `extension-testing`). Pobrania lądują w katalogu z `Preferences` tymczasowego profilu, nie w Pobranych.
  `globalTeardown` failuje, gdy testy zmieniły `git status`.
- Firefox nie ma automatycznego e2e (patrz „Firefox”).
- Nowa logika = test najpierw. Konwencje: `CLAUDE.md`.

## Viewer / MCP

Jak czytać paczkę krok po kroku: [docs/JAK-CZYTAC-PACZKE.md](docs/JAK-CZYTAC-PACZKE.md).

- **Viewer** to jeden plik `dist/page-debug-viewer-<wersja>.html` (powstaje w `npm run pack`; źródło `src/viewer`, generowany do
  `src/standalone/viewer.html` przez `npm run gen`). Otwierasz go z dysku (`file://`) w Chrome, Edge lub Firefoksie, działa offline, niczego nie wysyła
  (CSP z hashami, dane z paczki trafiają do DOM wyłącznie jako tekst). Przeciągnij na niego `.zip` z rozszerzenia albo `snapshot.json`. Czyta paczki
  v1–v4; dla v1–v3 (sprzed automatycznej redakcji) pokazuje baner ostrzegawczy „Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny”.
  Zakładki: Podsumowanie, Kroki/oś czasu, Błędy, Sieć, Konsola, CWV, DOM, Storage.
- **MCP** (`mcp/`): lokalny serwer stdio (bez zależności npm), który pozwala agentowi AI (Claude Code, Cursor) pytać o paczki z katalogu.
  Katalog podajesz argumentem (`node mcp/server.js <katalog>`) albo zmienną `PDS_SNAPSHOTS_DIR`; **jeden katalog na serwer**, bez podkatalogów
  (kilka katalogów = kilka wpisów serwera w konfiguracji klienta). Serwer tylko czyta. Siedem narzędzi: `list_snapshots`, `get_summary`, `get_errors`,
  `get_network`, `get_vitals`, `get_steps`, `diff_snapshots`. Konfiguracja klienta i opis narzędzi: [mcp/README.md](mcp/README.md).

## Firefox

- Tło to **event page** (`background.scripts` z `type: module` w `manifest.firefox.json`; w Chrome `service_worker`). Ten sam `src/background.js`
  jest pisany tak, jakby proces mógł zniknąć po każdym zdarzeniu: stan w `storage.session`, listenery na top-level.
- `strict_min_version` to `128.0` (twarde minimum: skrypty z `world: MAIN`). Chrome: `minimum_chrome_version` `121`.
- Dodatek ładowany tymczasowo przez `about:debugging` znika po restarcie przeglądarki. Dostęp do witryny jest w MV3 uprawnieniem
  opcjonalnym — Firefox pyta o niego przy „Nagrywaj”.
- Brak automatycznego e2e: Playwright nie ładuje rozszerzeń w Firefoksie. Zamiast tego `web-ext lint` (0 errors) i obowiązkowe ręczne QA
  przez `npm run dev:firefox`; scenariusze: `docs/epics/E1/design.md`.

## Uprawnienia

- `activeTab` — dostęp do bieżącej karty tylko po kliknięciu ikony rozszerzenia; daje adres strony, aby zaproponować nagranie tej witryny, a po kliknięciu „Zapisz paczkę” pozwala dołączyć do raportu zrzut widocznej części tej karty (tylko gdy pokazuje nagrywaną witrynę).
- `scripting` — rejestracja dołączonego skryptu nagrywania tylko dla jednej wybranej witryny (od początku ładowania strony); skrypt jest wyrejestrowywany po zapisie raportu.
- `storage` — stan nagrania oraz dane zebrane z podstron przeładowanych w trakcie nagrania, w pamięci sesji (`storage.session`) czyszczonej przez przeglądarkę przy zamknięciu i niedostępnej dla stron; usuwane po zapisaniu pliku, nic nie trafia do pamięci trwałej. W instalacjach zarządzanych rozszerzenie czyta też ustawienie maskowania nadane przez administratora (`storage.managed`, tylko odczyt).
- `downloads` — zapis pliku raportu (`.zip`) do folderu pobranych, sprawdzenie, że plik naprawdę powstał, i — na kliknięcie „Pokaż plik” — pokazanie go w folderze (`downloads.show`).
- `optional_host_permissions` (`http://*/*`, `https://*/*`, `file:///*`) — nie są przyznawane przy instalacji; rozszerzenie prosi w trakcie działania wyłącznie o dostęp do witryny z bieżącej karty (jeden wzorzec), gdy użytkownik wybierze jej nagranie.

Rozszerzenie nie dostaje przy instalacji dostępu do wszystkich witryn i niczego nie wysyła do sieci.

E2 (0.4.0), E3 (0.5.0) i E4 (0.6.0) **nie dodają żadnych uprawnień**: lista `permissions` jest taka sama jak w 0.3.0 (E4 dodaje do manifestu Chrome tylko klucz `storage.managed_schema`, który nie jest uprawnieniem). Statusy zasobów pochodzą z Resource Timing
(`responseStatus`), a nie z `webRequest`; zrzut korzysta z istniejącego `activeTab` (`tabs.captureVisibleTab`, po otwarciu popupu). Zip, redakcja, SHA-256
i maska zrzutu (`OffscreenCanvas`, `CompressionStream`) używają natywnych API lub czytelnego kodu w paczce — bez zdalnego kodu i bez uprawnień `offscreen`/`cookies`.
Ciasteczka czytamy przez `document.cookie` (bez `HttpOnly`), nie przez uprawnienie `cookies`.

Wersje do formularzy sklepów (Chrome Web Store, AMO):

- `activeTab`
  - PL: Po kliknięciu ikony rozszerzenie odczytuje wyłącznie adres bieżącej karty, aby zaproponować nagranie tej witryny, a gdy użytkownik kliknie „Zapisz paczkę”, robi jeden zrzut widocznej części tej karty do raportu; bez kliknięcia nie ma dostępu do żadnej strony.
  - EN: When the user clicks the toolbar icon, the extension reads the address of the current tab only, to offer recording of that site, and when the user clicks "Save" it takes one screenshot of the visible part of that tab for the report; without the click it cannot access any website.
- `scripting`
  - PL: Rejestruje dołączony do rozszerzenia skrypt nagrywania tylko dla witryny wybranej przez użytkownika, aby działał od początku ładowania strony, i usuwa go po zapisaniu raportu.
  - EN: Registers the bundled recording script only for the site the user chose to record, so it runs from the start of the page load, and removes it after the report is saved.
- `storage`
  - PL: Przechowuje w pamięci sesji przeglądarki stan nagrania i dane z przeładowanych podstron do chwili zapisu pliku, a w instalacjach zarządzanych odczytuje ustawienie maskowania nadane przez administratora (storage.managed); nic nie trafia do pamięci trwałej.
  - EN: Keeps the recording state and data from pages reloaded during recording in session memory until the file is saved, and in managed installs reads the administrator's masking setting (storage.managed); nothing is written to persistent storage.
- `downloads`
  - PL: Zapisuje plik raportu do folderu pobranych, sprawdza, że powstał, i na żądanie użytkownika („Pokaż plik”) pokazuje go w folderze.
  - EN: Saves the report file to Downloads, checks that it exists and, when the user clicks "Show file", reveals it in its folder.
- `optional_host_permissions`
  - PL: Prośba w trakcie działania wyłącznie o witrynę, którą użytkownik wybrał do nagrania (albo o lokalny plik otwarty w przeglądarce), aby nagrywanie mogło zacząć się od załadowania strony; o dostęp do innych witryn rozszerzenie nigdy nie prosi.
  - EN: Requested at runtime only for the site the user chooses to record, so recording can start with the page load; access to other sites is never requested. The `file:///*` pattern is requested only if the user chooses to record a local file opened in the browser.
- Zdalny kod: nie. Cały JavaScript jest w paczce; nic nie jest pobierane ani wykonywane z sieci (EN: "No, I am not using remote code").

### Cofanie dostępu do witryny

Po zapisaniu paczki rozszerzenie zachowuje zgodę na dostęp do nagranej witryny, ale nic na niej nie uruchamia, dopóki ponownie nie klikniesz „Nagrywaj”. Zgodę cofniesz w Chrome: `chrome://extensions` → Szczegóły → Dostęp do witryn; w Firefoksie: `about:addons` → Page Debug Snapshot → Uprawnienia.

> Identyfikator dodatku Firefox (`browser_specific_settings.gecko.id` w `src/manifest.firefox.json`)
> to `{799eb178-df9a-41bb-9775-8fc8aff45926}` (GUID, bez domeny — projekt jest niezależny od organizacji). Można zmienić bez kosztu do pierwszego `web-ext sign` (E5); potem zmiana = nowy dodatek.

## Ikony

Ikony generuje `npm run icons` (skrypt `scripts/icons.mjs`, bez zależności natywnych); nie edytuj PNG ręcznie.
Test `tests/unit/icons-script.test.js` pilnuje, by `src/icons/*.png` były identyczne z wynikiem skryptu.

## Jak dodać nowe pole do paczki

1. Napisz test (np. `tests/unit/collector.test.js`, `recorder.test.js` albo `package.test.js`), potem zmień moduł w `src/page`
   (zbieranie na stronie) i/lub `src/lib/package.js` (składanie paczki w tle).
2. `npm run gen` — odświeża `src/content/*.js` i `src/standalone/console-snapshot.js`.
3. Zmiana łamiąca (usunięcie/zmiana nazwy lub typu pola, zmiana semantyki) = podbicie `schemaVersion` (`SCHEMA_VERSION` w `package.js`)
   i nowy fixture `tests/fixtures/snapshots/v<N>.json` (`PDS_UPDATE_FIXTURES=1 npx vitest run tests/unit/snapshot-validator.test.js`);
   pole opcjonalne = tylko wpis w dokumentacji. Walidator `tests/helpers/snapshot-validator.js` musi znać nowe pole. Reguły: skill `snapshot-schema`.
4. Opisz pole w [docs/snapshot-schema.md](docs/snapshot-schema.md) i dopisz wpis do [CHANGELOG.md](CHANGELOG.md).
5. Jeśli pole może zawierać dane użytkownika — sprawdź, że przechodzi przez redakcję (`src/lib/redact.js` obchodzi całą paczkę; nowa sekcja
   najwyższego poziomu musi być znana walidatorowi i `redaction.masked`), dodaj do korpusu w `tests/unit` przypadek-pułapkę (skill `privacy-redaction`)
   i zaktualizuj listę „Do pliku trafią” w `src/popup/messages.js` oraz jej kopię w `popup.html` (test pilnuje zgodności).
6. Pole z limitem rozmiaru: dopisz je do `limits` i do kolejności cięcia w `src/lib/budget.js` oraz do tabeli w `docs/snapshot-schema.md`.

## Troubleshooting

- **Popup: „Bez Twojej zgody na dostęp do tej strony nie da się jej nagrać…”** — okno zgody przeglądarki zamyka popup, a jego ponowne
  otwarcie pokazuje ten komunikat, jeśli zgody jeszcze nie ma. Kliknij „Nagrywaj” ponownie i w oknie wybierz „Zezwól”.
- **Popup: „Na tej stronie nie da się zapisać paczki.”** — karta to strona specjalna (`chrome://`, `about:`, sklep z rozszerzeniami, nowa karta).
  Otwórz zwykłą stronę `http(s)://`.
- **`file://` w Chrome** — oprócz zgody na witrynę wymaga „Zezwalaj na dostęp do adresów URL plików”: `chrome://extensions` → Szczegóły.
  Bez tego popup pokazuje instrukcję.
- **Popup: „Trwa nagrywanie w innej karcie…”** — nagrywa się jedna karta naraz. „Nagrywaj” w tej karcie kończy tamto nagranie
  **bez zapisu**; żeby je zapisać, wróć do tamtej karty.
- **Popup: „Nagrywanie zatrzymane po 10 minutach”** — limit; zapis nadal działa i obejmuje to, co zebrano do limitu.
- **„Zapisuję paczkę…” kończy się komunikatem „Strona jeszcze się ładuje albo nie odpowiada”** (`pageBusy`) — tło nie dostało zrzutu
  bieżącej strony w 15 s. Poczekaj, aż strona się załaduje, i kliknij „Zapisz paczkę” ponownie; nagrywanie trwa.
- **Popup: „Zapis został przerwany lub anulowany”** — pobranie przerwane (np. „Anuluj” w oknie przeglądarki); nagrywanie trwa.
- **Firefox: „W Firefoksie nagrywanie plików z dysku nie jest obsługiwane. Otwórz stronę przez http:// lub https://.”** — strona `file://`
  nie jest w Firefoksie nagrywana (popup nie prosi o zgodę). Otwórz ją przez `http(s)://` (np. lokalny serwer).
- **Firefox: dodatek zniknął** — tymczasowy dodatek znika po restarcie; załaduj ponownie (`npm run dev:firefox`).
  W Firefoksie ikona bywa pod „puzzlem” (panel rozszerzeń), nie na pasku.
- **Paczka bez zrzutu (`screenshots: []`)** — przeczytaj `notes`: zgłaszający wyłączył przełącznik (albo popup zostawił go wyłączonego: na stronie są
  okienka innych serwisów lub nie udało się sprawdzić strony — notatka jest ta sama), karta nie była aktywna, pokazywała inną witrynę, pól formularzy nie dało
  się zakryć (np. pinch-zoom), zrzut przekroczył 300 KB albo (Firefox) strona przeładowała się przy otwartym popupie. Otwórz popup ponownie na tej karcie i zapisz jeszcze raz.
- **Dwa zapisy w tej samej sekundzie** — nazwa pliku ma rozdzielczość sekundy; Chrome dopisuje „ (1)”, a komunikat w popupie podaje faktyczną nazwę.
- **W paczce widać za dużo `[redacted:…]`** — fałszywie dodatnie trafienia (np. `phone` na kwocie, `card` na UUID); sprawdź `redaction.masked`; `email`/`phone` można wyłączyć
  konfiguracją developerską (patrz „Konfiguracja developerska”).
- **Metryka `available:false`** — `reason` mówi dlaczego: `unsupported-browser` (np. CLS w Firefoksie), `no-interaction` (INP bez kliknięć), `hidden-at-start`, `no-data`.
- **e2e na WSL: chromium nie startuje** — linuksowy Chromium z Playwrighta wymaga bibliotek `libnss3`, `libnspr4`, `libasound2`. Bez nich uruchom e2e Node'em z Windows (`node_modules` są natywne dla jednego systemu).
- **Chrome: ikona niewidoczna** — jest pod „puzzlem”; przypnij ją.
- **`dev:chrome` otwiera zły Chrome (np. Canary)** — ustaw `PDS_CHROMIUM_BINARY`. Pasek „nieobsługiwana flaga `--disable-blink-features=AutomationControlled`” pochodzi z `web-ext` i jest nieszkodliwy.
- **Zmiana nie jest widoczna** — `dist/` jest nieprzebudowany: `npm run build` i odśwież rozszerzenie. Zmiana w `src/page` wymaga też `npm run gen`.
- **`npm run gen -- --check` albo test `gen-content` pada** — bundle są nieaktualne: `npm run gen` i zatwierdź zmiany.
- **Rozszerzenie się nie ładuje** — sprawdź, czy `dist/<target>/manifest.json` istnieje i `npx web-ext lint --source-dir dist/firefox` nie ma errors.
- **e2e: losowe porażki (np. brak rekordera po przeładowaniu)** — drugi przebieg przebudował `dist/chrome` pod działającą przeglądarką; uruchom z `PDS_E2E_NO_BUILD=1`.
- **`npm run test:e2e` nie startuje przeglądarki** — `npx playwright install chromium`. Po przerwanych `dev:firefox` mogą zostać profile `%TEMP%\firefox-profile*` — można usunąć.
- **Wersja Node** — komendy wymagają wersji z `engines`; w nvm-windows po `nvm use` sprawdź, czy `node -v` pokazuje właściwą.

## Znane ograniczenia

- `xhr.constructor === XMLHttpRequest` daje `false` (hook to `Proxy`, a `prototype.constructor` wskazuje oryginał); `instanceof`
  i stałe statyczne działają. Instancje XHR mają własne, nieenumerowalne `open`/`send`/`setRequestHeader`.
- `fetch.toString()` na stronie w trakcie nagrywania daje `function () { [native code] }` (bez nazwy); po zapisie wraca `function fetch() { [native code] }`.
- W DevTools logi konsoli wskazują jako źródło recorder, nie kod strony; stos wywołania jest w polu `stack` wpisu.
- Auto-stop po uśpieniu komputera zapada dopiero przy odpaleniu timera; wpisy po terminie są i tak odrzucane przy składaniu paczki.
- Firefox: wpisy logowane między `beforeunload` a `pagehide` przy przejściu na inną witrynę mogą zostać utracone (Firefox nie dostarcza wtedy `pagehide`).
- Nagranie obejmuje jedną witrynę (origin) w jednej karcie naraz; strony z innej witryny nie są nagrywane.
- **Zasoby z innego originu nie mają statusu** (np. CDN): przeglądarka ukrywa go przed stroną, więc wpis ma `status: null`
  i `statusUnavailable: "cross-origin"`, często też `sizeBytes: null` (bez `Timing-Allow-Origin`). Na portalu z wieloma CDN-ami
  może to być większość wpisów (wyborcza.pl: ok. 77%); 404 z CDN nie będzie widoczny. `webRequest` świadomie odrzucono (wymagałby
  szerszych uprawnień).
- **Podglądy odpowiedzi** tylko dla statusu ≥ 400 i treści tekstowej; limity 4096 znaków na wpis i 256 KB łącznie (przy przekroczeniu
  zostają najnowsze). Podgląd odczytywany jest do 2 s po odpowiedzi — jeśli strona zostanie opuszczona albo nagranie zatrzymane wcześniej,
  tego podglądu nie będzie. Podgląd jest redagowany regułami tak jak reszta paczki (patrz „Redakcja”).
- Zasoby jeszcze ładowane w chwili zapisu nie mają wpisu; iframe'y z innego originu są niewidoczne.
- Metryki bieżącego dokumentu (LCP, CLS, INP) bywają niefinalne w chwili zapisu (`finalized: false` + notatka). Nie sprawdzano Firefoksa 128–157
  ani Chrome 121–122 na żywo (long tasks tylko unit).
- Firefox: bez automatycznego e2e (ręczne QA).

### Prywatność i redakcja (E3, E4)

Redakcja jest regułowa, więc nie jest wyczerpująca. Znane luki i fałszywe trafienia (reguły `rulesVersion: 2`; formy, które v1 przepuszczała, a E4 zamknął, są opisane w [docs/snapshot-schema.md](docs/snapshot-schema.md)):

- **Zrzut a ramki innych serwisów (decyzja PB-1 B):** pola formularzy tej strony i ramek tego samego originu są zamalowane (margines 2 px CSS wokół pola; etykiety nad polami zostają czytelne), ale **ramki cross-origin (płatność, logowanie SSO) nie są zakrywane** — numer karty wpisany w osadzony formularz może być
  widoczny na `screenshot.jpg`. Ujawnienie w popupie mówi to wprost. Gdy na stronie jest widoczna taka ramka, przełącznik „Dołącz zrzut ekranu” startuje wyłączony
  (zgłaszający może go włączyć); to samo przy nieudanym sprawdzeniu ramek (fail-closed). Przy ręcznym włączeniu ryzyko zostaje. Liczba ramek nie trafia do paczki.
- **PB-2, frazy-hasła:** wyjątek „proza” (żeby nie maskować komunikatów typu `auth: "Invalid credentials"`) obejmuje też hasło złożone z samych słów.
  Fraza-hasło pod kluczem `session:`, `key:` albo `auth:` w cudzysłowie (`session: "correct horse battery staple"`) **nie jest maskowana**.
  Z kolei `key: correct horse` bez cudzysłowu jest maskowane (fail-closed, część to fałszywe trafienia).
- **Podgląd JSON długiego wpisu konsoli** (wpis > 40 000 znaków, czytany strumieniowo): para `{"value":…,"name":"password"}` nie zostanie zamaskowana, gdy `value` stoi przed `name`.
- **Nieutwardzone przed wrogą stroną w MAIN:** podmienione iteratory `Map`/`Set`/`String` i `%ArrayIteratorPrototype%.next` oraz podmienione metody tablic
  (`filter`, `sort`, `slice`, `reduce`). Skutek to brak danych albo przekłamane dane (nie wyciek: tło redaguje ponownie), ale nagranie lub jego część bywa puste.
  Pętle indeksowe zamiast `for…of` w `recorder`, `hooks-console` i `serialize` chronią przed podmienionym `Array.prototype[Symbol.iterator]`.
- **Telefony w tekście kroków** (`steps[].text`) nie są maskowane — zgodnie z polityką (za dużo fałszywych trafień); `phone` działa w konsoli, błędach, treści zapytań, podglądach i storage.
- **Fałszywe trafienia** na słowach-kluczach w tekście, np. `console.log('Pressed key', 'Enter')` — argument kończący się słowem-kluczem sprawia, że następny argument dostaje znacznik `[redacted:…]`; sprawdź `redaction.masked`.
- **`downloads.show` nie sygnalizuje usunięcia pliku** (wywołanie kończy się bez błędu): popup sprawdza `downloads.search` przed `show` i przy braku pliku pisze
  „Nie znaleziono pliku. Zapisz paczkę ponownie.”; plik usunięty tuż po sprawdzeniu da po prostu brak efektu przycisku.
- **Kodowania:** `&amp;quot;` (podwójne encje), podwójne kodowanie procentowe i base64 krótsze niż 32 znaki nie są maskowane.
- **AWS `AKIA…`** to sam identyfikator klucza i nie jest maskowany; sekret (40 znaków) łapie reguła `long-secret`.
- **Skrót ciasteczka bez soli:** `valueHash` wartości o małej liczbie możliwości (`consent=yes`, krótki PIN) da się odgadnąć. Długie wartości sesji nie.
- **Fałszywie dodatnie:** np. „123 456 789 zł” jako `phone`; `card` na ciągu cyfr o poprawnej sumie Luhna w nietypowym kontekście.
- **Pełny HTML** nie jest osiągalny dla zgłaszającego; tylko konfiguracja developerska (`html-structure` w `disabledRules`).
- Fallback konsolowy działa w realmie strony — patrz „Chrome i Firefox”.
- Sekcje `dom` (`meta`, `scripts`, `iframes`, `rootMarkers`) czytają żywe gettery strony; wroga strona może je sfałszować lub wyzerować (bez przecieku, redaguje tło).
- Strony z `Object.prototype.toJSON` (Prototype.js) wpływają na serializację argumentów konsoli.
