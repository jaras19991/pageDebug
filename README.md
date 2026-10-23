# Page Debug Snapshot

Rozszerzenie przeglądarkowe (MV3, Chrome i Firefox z jednej bazy kodu). Zgłaszający klika „Nagrywaj”, strona odświeża się,
a rozszerzenie od początku jej ładowania zapisuje konsolę, błędy, zapytania sieciowe i zasoby strony, kroki zgłaszającego
oraz metryki wydajności, a przy zapisie także stan strony (środowisko, DOM, storage) i zrzut widocznej części karty. Po „Zapisz paczkę” powstaje jeden plik `.json` w pobranych, który zgłaszający przekazuje
developerowi; rozszerzenie niczego nie wysyła do sieci.
Instrukcja dla osoby zgłaszającej: [docs/INSTRUKCJA-ZGLASZAJACEGO.md](docs/INSTRUKCJA-ZGLASZAJACEGO.md).

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
| `npm run pack` | build + po jednym `dist/page-debug-snapshot-<target>-<wersja>.zip` na target |
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
(`page-debug-snapshot-*.json`) też nie commitujemy.

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
   i składa paczkę (`assemblePackage`, schemat v3). Popup robi `Blob` i woła `downloads.download`, a potem `saveStarted` z `downloadId`.
5. Tło śledzi `downloads.onChanged`. Dopiero `complete` daje komunikat „Zapisano plik …”; wtedy tło wyrejestrowuje skrypty,
   zdejmuje hooki i czyści `storage.session`. Przerwane lub nieudane pobranie zostawia nagrywanie włączone.

Limit nagrywania to 10 minut (auto-stop; zapis nadal możliwy). Uzasadnienia decyzji: `docs/epics/E1/design.md`.

## Co trafia do paczki (schemat v3)

Pełny opis pól: [docs/snapshot-schema.md](docs/snapshot-schema.md). Plik czyta się od góry: `overview` (same liczby: błędy,
nieudane zapytania, kroki, metryki `poor`, czy jest zrzut) → `notes` → `steps` → `runtimeErrors` → `network` → `vitals` →
`screenshots` → `consoleLogs` → sekcje strony → `attachments` (obraz w base64, zawsze na końcu).

| Dane | Gdzie | Co zawiera |
|---|---|---|
| Kroki zgłaszającego | `steps[]` | klik (selektor CSS, etykieta ≤ 80 znaków), `input`/`change` (typ pola i **długość**, nigdy wartość; bez długości dla `password`, checkboxów i radio), `submit`, `key` (tylko Enter/Escape/Tab/strzałki), `navigate` (adres z zamaskowanymi tokenami; kolejne `replaceState` scalane) |
| Metryki wydajności | `vitals[]` (jeden wpis na dokument) | TTFB, FCP, LCP, CLS, INP z oceną `good`/`needs-improvement`/`poor` i atrybucją (LCP: selektor i `url`; CLS: do 5 źródeł; INP: cel, typ zdarzenia, fazy), do 20 najdłuższych long tasks ze skryptem. Niedostępna metryka to `{available:false, reason}`, nigdy `0` |
| Zasoby i statusy | `network[]` | oprócz `fetch`/XHR także `img`/`script`/`css`/`font`/`other` z `status`, `sizeBytes`; status dokumentu w `documents[].status`. Brak statusu zawsze ma `statusUnavailable` |
| Podglądy odpowiedzi z błędem | `network[].responseBodyPreview` | tylko `fetch`/XHR ze statusem ≥ 400 i treścią tekstową, ≤ 4096 znaków na wpis, ≤ 256 KB łącznie (zostają najnowsze); tokeny zamaskowane (`[redacted:…]`) |
| Zrzut ekranu | `screenshots[]` + `attachments` | jeden JPEG widocznej części karty (≤ 300 KB) przy *Zapisz paczkę*, tylko gdy karta jest widoczna i pokazuje nagrywaną witrynę; bez zrzutu: `screenshots: []` + notatka |
| iframe'y | `runtimeErrors[].frame`, `consoleLogs[].frame` | tylko błędy z ramek tego samego originu (do 20 naraz, zagnieżdżenie do 2); kroki, sieć i metryki tylko z dokumentu głównego |
| Stosy błędów | `stack`, `args` | do 16 000 znaków, `Error.cause` do 5 poziomów |

### Chrome i Firefox

- **Firefox 158** (jedyna sprawdzona wersja): nie ma `layout-shift` ani long animation frames, więc `CLS` i `longTasks` to
  `available:false`, `reason:"unsupported-browser"`; `INP`, `TTFB`, `FCP`, `LCP` i `responseStatus` zasobów działają jak w Chrome.
  Dostępność metryk ustala wykrywanie funkcji, nie User-Agent.
- **Zrzut w Firefoksie:** `activeTab` jest tam cofany przy każdym przeładowaniu karty. Jeśli strona przeładuje się po otwarciu popupu,
  zapis nie zrobi zrzutu (`screenshots: []` + notatka); zamknij popup, otwórz go ponownie i zapisz. Chrome cofa `activeTab` dopiero
  przy zmianie originu.
- Fallback konsolowy (`console-snapshot.js`) ma te same klucze, ale bez zrzutu, a `INP` obejmuje tylko interakcje po wklejeniu skryptu.

## Struktura repo

```
src/
  manifest.base.json, manifest.chrome.json, manifest.firefox.json   wspólna baza + różnice targetów
  background.js    tło: router wiadomości, top-level listenery, bez stanu w pamięci
  lib/             logika tła: recording.js, save.js, package.js (schemat v3), session-store.js, content-scripts.js, origin.js
  popup/           popup.html, popup.js, controller.js, view.js, target.js, messages.js
  page/            moduły ES kodu działającego na stronie (recorder, hooki, kanał, collector, *-entry.js)
  content/         isolated-world.js, main-world.js — GENEROWANE z src/page (npm run gen); nie edytuj ręcznie
  standalone/      console-snapshot.js — GENEROWANY; wersja do wklejenia w konsolę; nie trafia do dist
  icons/           icon16/48/128.png        generowane przez npm run icons
scripts/           build.mjs, pack.mjs, gen-content.mjs, icons.mjs, dev-browser.mjs/.ps1, check-repo.mjs, lib/
tests/             unit/ (vitest), e2e/ (Playwright + helpers/), fixtures/ (pages, snapshots, modules)
dist/              wynik build/pack (ignorowany)
docs/              BACKLOG.md, snapshot-schema.md, INSTRUKCJA-ZGLASZAJACEGO.md, epics/E*/
```

Bundle w `src/content` i `src/standalone` są w repo; test `gen-content` pada, gdy są nieaktualne. Po zmianie czegokolwiek w `src/page`
(lub w `src/lib/package.js`, którego używa fallback konsolowy) uruchom `npm run gen`. Moduły `src/page` mają ograniczoną składnię
(importy jednolinijkowe od kolumny 0, bez cykli, bez `import(`/`import.meta`/`require(` nawet w komentarzach) — reguły w `CLAUDE.md`.

## Konfiguracja developerska

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

Nie istnieją jeszcze (planowane w kolejnych epikach, patrz `docs/BACKLOG.md`).

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
- `storage` — stan nagrania oraz dane zebrane z podstron przeładowanych w trakcie nagrania, w pamięci sesji (`storage.session`) czyszczonej przez przeglądarkę przy zamknięciu i niedostępnej dla stron; usuwane po zapisaniu pliku, nic nie trafia do pamięci trwałej.
- `downloads` — zapis pliku raportu do folderu pobranych i sprawdzenie, że plik naprawdę powstał.
- `optional_host_permissions` (`http://*/*`, `https://*/*`, `file:///*`) — nie są przyznawane przy instalacji; rozszerzenie prosi w trakcie działania wyłącznie o dostęp do witryny z bieżącej karty (jeden wzorzec), gdy użytkownik wybierze jej nagranie.

Rozszerzenie nie dostaje przy instalacji dostępu do wszystkich witryn i niczego nie wysyła do sieci.

E2 (0.4.0) **nie dodaje żadnych uprawnień**: manifesty są takie same jak w 0.3.0. Statusy zasobów pochodzą z Resource Timing
(`responseStatus`), a nie z `webRequest`; zrzut korzysta z istniejącego `activeTab` (`tabs.captureVisibleTab`, po otwarciu popupu).

Wersje do formularzy sklepów (Chrome Web Store, AMO):

- `activeTab`
  - PL: Po kliknięciu ikony rozszerzenie odczytuje wyłącznie adres bieżącej karty, aby zaproponować nagranie tej witryny, a gdy użytkownik kliknie „Zapisz paczkę”, robi jeden zrzut widocznej części tej karty do raportu; bez kliknięcia nie ma dostępu do żadnej strony.
  - EN: When the user clicks the toolbar icon, the extension reads the address of the current tab only, to offer recording of that site, and when the user clicks "Save" it takes one screenshot of the visible part of that tab for the report; without the click it cannot access any website.
- `scripting`
  - PL: Rejestruje dołączony do rozszerzenia skrypt nagrywania tylko dla witryny wybranej przez użytkownika, aby działał od początku ładowania strony, i usuwa go po zapisaniu raportu.
  - EN: Registers the bundled recording script only for the site the user chose to record, so it runs from the start of the page load, and removes it after the report is saved.
- `storage`
  - PL: Przechowuje w pamięci sesji przeglądarki (czyszczonej przy jej zamknięciu, niedostępnej dla stron) stan nagrania oraz dane zebrane z podstron przeładowanych w trakcie nagrania, do chwili zapisania pliku; potem je usuwa; nic nie trafia do pamięci trwałej.
  - EN: Keeps the recording state and the data captured from pages reloaded during the recording in the browser's session memory (cleared on exit, not accessible to websites) until the user saves the file, then deletes it; nothing is written to persistent storage.
- `downloads`
  - PL: Zapisuje plik raportu w pobranych plikach użytkownika i sprawdza, że plik naprawdę powstał, zanim poinformuje o zapisie.
  - EN: Saves the report file to the user's downloads and confirms the file was actually written before telling the user it is saved.
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
5. Jeśli pole może zawierać dane użytkownika — redakcja (skill `privacy-redaction`, E3) i aktualizacja listy „Do pliku trafią” w
   `src/popup/messages.js` oraz jej kopii w `popup.html` (test pilnuje zgodności).

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
- **Paczka bez zrzutu (`screenshots: []`)** — przeczytaj `notes`: karta nie była aktywna, pokazywała inną witrynę, zrzut przekroczył 300 KB
  albo (Firefox) strona przeładowała się przy otwartym popupie. Otwórz popup ponownie na tej karcie i zapisz jeszcze raz.
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

- **Dane nie są redagowane** (do E3): w pliku są jawnie ciasteczka, storage, nagłówki i treść żądań sieciowych, wartości pól formularzy
  (poza `password`/`hidden` — te są maskowane w `dom.forms` i w `dom.html.outerHTML`) oraz reszta `dom.html.outerHTML`. Popup mówi to wprost przed „Nagrywaj”.
- **Zrzut ekranu nie jest maskowany** (do E3): pokazuje wszystko, co widać na karcie w chwili zapisu, także dane wpisane w pola
  (np. e-mail, numer karty); hasła są ukryte, bo przeglądarka pokazuje je jako kropki. Popup ostrzega o tym w liście „Do pliku trafią”.
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
  tego podglądu nie będzie. Maskowanie tokenów jest regułowe (nie łapie np. `klucz: wartość`, `sessid`, `Basic <b64>`) — do E3.
- Zasoby jeszcze ładowane w chwili zapisu nie mają wpisu; iframe'y z innego originu są niewidoczne.
- Metryki bieżącego dokumentu (LCP, CLS, INP) bywają niefinalne w chwili zapisu (`finalized: false` + notatka). Nie sprawdzano Firefoksa 128–157
  ani Chrome 121–122 na żywo (long tasks tylko unit).
- Firefox: bez automatycznego e2e (ręczne QA).
