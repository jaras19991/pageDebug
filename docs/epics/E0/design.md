# E0 — Design

## Pytania do bramki

**PB-1 (warunkowe, dotyczy D10): co, jeśli w Playwright nie da się „kliknąć ikony rozszerzenia”?**
Bez `host_permissions` jedynym źródłem dostępu do karty jest `activeTab`, a ten Chrome nadaje dopiero
po geście użytkownika na ikonie, skrócie albo w menu kontekstowym. Popup otwarty w teście jako zwykła karta
(`chrome-extension://<id>/popup/popup.html`) **nie dostaje** `activeTab`, więc `executeScript` na fixture
zostanie odrzucony. AC-1.1, 1.2, 1.5, 2.3, 2.4 i 4.5 (e2e) zakładają, że to działa.
Plan główny: spike E0-T17 sprawdza CDP `Extensions.triggerAction` (Chrome uruchamia akcję rozszerzenia
tak, jakby kliknął użytkownik, więc nadaje `activeTab`). Ta metoda jest dostępna przy `--remote-debugging-pipe`
(Playwright używa go domyślnie) i `--enable-unsafe-extension-debugging`.
**Jeśli spike się nie powiedzie**, proszę o zgodę na plan awaryjny: e2e ładuje **kopię** `dist/chrome`
w katalogu tymczasowym, do której harness dopisuje do manifestu wyłącznie
`"host_permissions": ["http://127.0.0.1/*"]`, a popup przyjmuje `?tabId=<n>`. `dist/chrome` i zipy pozostają
bez zmian, więc AC-2.1 obowiązuje dalej. AC-3.3 byłoby wtedy spełnione „co do kodu, nie co do bajtu manifestu”.
Brak zgody oznacza, że te AC przechodzą do QA ręcznego w Chrome.

Pozostałe punkty spec są wykonalne w MV3 i nie są ze sobą sprzeczne.

## Kontekst
Mamy jeden katalog `page-debug-extension/`, który jest jednocześnie źródłem i paczką. Rozszerzenie wstrzykuje
`inject.js`, a ten dokleja `<script src=chrome-extension://…>` (stąd `web_accessible_resources` + `<all_urls>`).
Popup zgłasza sukces na ślepo. Nie ma testów, lintera ani buildu.
Po E0 kod leży w `src/`. `npm run build` składa `dist/chrome` i `dist/firefox` ze wspólnej bazy i dwóch nakładek
manifestu. Popup wstrzykuje skrypt przez `scripting.executeScript({ world: 'MAIN' })` i pokazuje rzeczywisty wynik
po polsku. Logikę pokrywają vitest i Playwright (Chromium), a Firefox sprawdzają `web-ext lint` i QA ręczne.

## Decyzje

### D1 Układ repo: `src/` zamiast `page-debug-extension/`
Opcje:
(a) zostawić `page-debug-extension/` jako źródło i dodać obok manifesty per target;
(b) `git mv` do `src/` z podkatalogami `popup/`, `page/`, `icons/`, `standalone/`.
**Wybór: (b).**
Uzasadnienie: CLAUDE.md i skill `mv3-extension-rules` już zakładają `src/manifest.*.json`, a E1 dołoży
`background.js`, `recorder.js`, `collector.js` i most ISOLATED. Płaski katalog z nazwą produktu zachęcałby
do „ładowania źródeł” zamiast `dist/`. Koszt jest mały: 9 śledzonych plików przenoszonych przez `git mv`
(historia zostaje dostępna przez `--follow`), jedna linia w `.gitignore`, fallback w `dev-browser.ps1`
(i tak usuwany w D11) oraz wzmianki w CLAUDE.md i skillach (faza Docs). Refaktor
`page-debug-snapshot.js` w E1 i tak przeniesie logikę, więc teraz przenosimy pliki bez zmiany treści.
Docelowy układ:
```
src/
  manifest.base.json  manifest.chrome.json  manifest.firefox.json
  popup/   popup.html  popup.js  snapshot-tab.js  target.js  messages.js  run-in-page.js
  page/    page-debug-snapshot.js            (treść bez zmian w E0)
  icons/   icon16.png icon48.png icon128.png
  standalone/console-snapshot.js             (bez zmian, decyzja 6; nie trafia do dist)
scripts/   build.mjs  pack.mjs  dev-browser.mjs  dev-browser.ps1  check-repo.mjs  lib/{manifest,reachability}.mjs
tests/     unit/  e2e/  fixtures/pages/
```
Konsekwencje: AC-5.6 dostaje równoważny wpis `src/icons/logo*.png`. `package.json` i lockfile trafiają do roota.
Lokalne, ignorowane pozostałości (`page-debug-extension/node_modules`, `page-debug-extension/page-debug-extension.zip`)
można usunąć z dysku, bo nie mają wpływu na AC czystego klonu. Faza Docs musi poprawić sekcję „Struktura” w CLAUDE.md,
tabelę w skillu `pds-browser` i domyślną ścieżkę w przykładzie `launch.js` w `extension-testing`.

### D2 Narzędzia deweloperskie
Opcje:
(a) vitest + jsdom, @playwright/test (Chromium), eslint 9 flat config, web-ext;
(b) jest + puppeteer;
(c) Selenium dla obu przeglądarek.
**Wybór: (a).**
Uzasadnienie: zgodność z CLAUDE.md i skillem `extension-testing`. vitest działa natywnie z ESM, bez transpilacji.
Playwright ma bundlowany Chromium z obsługą `--load-extension` i nowym trybem headless, którego Chrome stable
już nie oferuje dla rozszerzeń z linii komend. Selenium/geckodriver dla Firefoksa to E5.
`devDependencies`: `vitest`, `jsdom`, `@playwright/test`, `eslint`, `@eslint/js`, `globals`, `web-ext`, `fflate` (D5).
**Zero `dependencies`** (AC-4.6). `"type": "module"`, `"private": true`. `engines.node` = najwyższe minimum
deklarowane przez te devDependencies (sprawdzić `npm view <pkg> engines`), nie mniej niż `>=20`.
Na maszynie dev jest Node 26.12, a `npm ci` nie może wypisać `EBADENGINE`.
Konfiguracje:
- `vitest.config.js`: `include: ['tests/unit/**/*.test.js']`, środowisko `node`; jsdom per plik przez `// @vitest-environment jsdom`.
- `eslint.config.js`: `@eslint/js` recommended i `globals`:
  - `src/popup/**`: browser + webextensions, `sourceType: module`;
  - `src/page/**` i `src/standalone/**`: browser, `sourceType: script`;
  - `scripts/**` i `tests/**`: node.
  Reguły: `no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-globals: ['importScripts']`,
  `no-unused-vars` z `argsIgnorePattern: '^_'`. Ignorowane: `dist/`, `coverage/`, `test-results/`, `playwright-report/`.
  Jeśli `src/standalone/console-snapshot.js` łamie reguły, dodajemy go do `ignores` z komentarzem „decyzja 6”
  i nie poprawiamy treści.
- `playwright.config.js`: `testDir: tests/e2e`, `workers: 1`, `retries: 0`, `globalSetup` (build) i `globalTeardown` (`git status`).
Konsekwencje: `npx playwright install chromium` to jedyny krok ręczny (README). `npm pack` to wbudowana
komenda npm, a nasz skrypt to `npm run pack` — README musi o tym ostrzec.

### D3 Build: skrypt Node, kopiowanie sterowane osiągalnością z manifestu
Opcje:
(a) kopiować cały `src/` z listą wykluczeń;
(b) jawna lista plików w konfiguracji;
(c) kopiować dokładnie zbiór plików osiągalnych z manifestu: `icons`, `action.default_icon`/`default_popup`,
`background.service_worker`/`scripts`, `content_scripts[].js/css`, w HTML `<script src>`/`<link href>`,
w JS statyczne `import … from './x.js'` oraz literały `files: ['…']` w wywołaniach `executeScript`/`registerContentScripts`.
**Wybór: (c).**
Uzasadnienie: AC-4.2 wymaga, żeby każdy plik w `dist` był osiągalny, a każdy referencjonowany istniał. Jeśli build
i test korzystają z tej samej funkcji `collectReachable(dir)` (`scripts/lib/reachability.mjs`), plik „przypadkiem
skopiowany” nie może się pojawić, a `console-snapshot.js` (AC-4.3) jest wykluczony z konstrukcji. Denylista (a)
zawodzi po cichu przy nowym typie śmiecia. Lista (b) rozjeżdża się z kodem.
Determinizm (AC-4.1): build najpierw usuwa `dist/chrome` i `dist/firefox` (`fs.rm({recursive, force})`). Pliki
kopiuje bajt w bajt, posortowane. `manifest.json` zapisuje jako `JSON.stringify(merged, null, 2) + '\n'`,
z kolejnością kluczy: najpierw base, potem nakładka. Sumy SHA-256 nie zależą od mtime, bo hashujemy treść.
Żeby wynik był taki sam na Windows i Linux, `.gitattributes` wymusza `eol=lf` dla tekstu i `binary` dla PNG.
API: `build({ srcDir, outDir, targets })` zwraca listę plików (testy budują do `os.tmpdir()`). CLI `scripts/build.mjs`
buduje do `dist/`.
Konsekwencje: E1 doda `background.*`/`content_scripts` i walker obsłuży je bez zmian. Dynamiczne ścieżki w `files:`
(np. ze zmiennej) są zakazane, bo walker ich nie zobaczy. Test AC-4.2 to wykryje (brak pliku w dist → e2e/walker czerwony).

### D4 Manifesty: baza + nakładka per target, zamknięta lista różnic
Opcje:
(a) dwa pełne manifesty;
(b) baza i płytka nakładka, w której nakładka może tylko **dodawać** klucze z listy dozwolonych;
(c) deep-merge z nadpisywaniem.
**Wybór: (b).**
Uzasadnienie: (a) to ryzyko 6 ze spec. Przy (c) nakładka może po cichu nadpisać `permissions`. W (b) `mergeManifest(base, overlay)`
rzuca błąd, gdy klucz nakładki jest już w bazie albo spoza listy `TARGET_KEYS = ['browser_specific_settings',
'minimum_chrome_version', 'background']`. Daje to gwarancję AC-4.8 już w buildzie, a test porównawczy na `dist` (E0-T10) ją potwierdza.
Wartości:
- `minimum_chrome_version: "121"`. Kod E0 potrzebuje minimum **95**: `scripting.executeScript` z `world` (95), `func` (92), MV3 (88).
  E1 według skilla `mv3-extension-rules` doda do manifestu jednocześnie `background.service_worker` i `background.scripts`.
  Chrome < 121 odrzuca taki manifest, a ≥ 121 ignoruje `scripts`. Ustawiamy 121 już teraz, żeby nie zmieniać
  semantyki w połowie drogi. Chrome 121 to styczeń 2024, a Chrome aktualizuje się automatycznie, więc praktycznie
  nikogo nie odcinamy. Ostateczna polityka należy do E5-S2.
- `gecko.id: "{799eb178-df9a-41bb-9775-8fc8aff45926}"` (GUID, AC-ST.4; decyzja użytkownika 2026-10-22: plugin niezależny, bez domeny organizacji). **Do potwierdzenia przez użytkownika
  przy bramce Design:** po pierwszej publikacji w AMO (E5) zmiana ID oznacza nowy dodatek. Do tego czasu zmiana nic nie kosztuje.
- `strict_min_version: "128.0"`, czyli pierwsza wersja z `world: "MAIN"` w `scripting`.
- `data_collection_permissions: { "required": ["none"] }`. AMO wymaga tego klucza od nowych rozszerzeń, a rozszerzenie
  nic nie wysyła do sieci (spec, prywatność). Firefox < 140 zignoruje klucz z ostrzeżeniem. `web-ext lint` może zgłosić
  warning o wersji, a warnings są dopuszczalne (AC-3.1).
- `description` zmieniony na jedno zdanie opisujące jeden cel (AC-ST.1), ≤ 132 znaki (limit CWS).
- `action.default_icon` dodany w bazie, czyli identyczny w obu targetach, żeby przycisk na pasku Firefoksa miał ikonę (AC-7.2).
Konsekwencje: E1 dopisze `background` w obu nakładkach (`service_worker` + `scripts` albo tylko w bazie, jeśli identyczne).
Wtedy `permissions` w bazie rozszerzy się o `storage`/`tabs`. Test AC-2.1 trzeba będzie świadomie poluzować (E1 spec).

### D5 `npm run pack`: zip w Node przez `fflate`
Opcje:
(a) `Compress-Archive`/`zip` z OS;
(b) `web-ext build` dla obu katalogów;
(c) własny writer ZIP na `node:zlib` i `zlib.crc32`;
(d) `fflate` (devDependency).
**Wybór: (d).**
Uzasadnienie: (a) działa inaczej na Windows i Linux, a `Compress-Archive` zapisuje ścieżki z `\`. (b) nie daje
kontroli nad nazwą per target i nie rozpakowuje. Test AC-4.5 i tak potrzebuje unzipa. (c) to około 150 linii
własnego formatu do utrzymania. `fflate` to czysty JS bez zależności i bez binarek natywnych, robi zip i unzip
synchronicznie, ma kilkadziesiąt KB i jest stabilnie utrzymywany. Jest tylko w `devDependencies`, więc nie łamie zasady
„zero zależności runtime”.
Wynik: `dist/page-debug-snapshot-<target>-<version>.zip`, gdzie `version` pochodzi z `dist/<target>/manifest.json`.
`manifest.json` leży w korzeniu zipa, wpisy są posortowane, mtime stały (`1980-01-01`), `level: 9`.
`pack` najpierw woła `build()`, a zip zawiera dokładnie pliki z `dist/<target>`.
Konsekwencje: zip Firefoksa nie jest podpisany i działa tylko jako dodatek tymczasowy, `.xpi` i podpis to E5.
Zipy leżą w ignorowanym `dist/`.

### D6 Wstrzyknięcie: dwa wywołania `executeScript` w MAIN, wynik z wartości zwróconej
Opcje:
(a) `executeScript({ files: ['page/page-debug-snapshot.js'], world: 'MAIN' })` i odczyt wyniku ostatniego wyrażenia pliku;
(b) `files` (definicja) + `func: runInPage` (uruchomienie i zwrot wyniku), oba w `world: 'MAIN'`;
(c) content script ISOLATED + `postMessage` z nonce do MAIN.
**Wybór: (b) z sondą:** popup najpierw wywołuje `func: runInPage`. Jeśli wynik to `{ok:false, reason:'not-loaded'}`,
wstrzykuje `files` i jeszcze raz wywołuje `runInPage`.
Uzasadnienie: (a) wymagałoby zmiany IIFE w `page-debug-snapshot.js`, żeby zwracał wynik, a treść pliku ma zostać
bez zmian aż do E1-T3. Poza tym wynik pliku przy drugim wstrzyknięciu to `undefined`, bo wcześniej działa guard
`return`. (c) to architektura E1. Teraz dodałaby ISOLATED, nonce i komunikację bez potrzeby, bo E0 nie ma tła ani
nagrywania. W (b) `executeScript` zwraca `InjectionResult[]` z `result` = wartością zwróconą przez `func`
(structured clone). MAIN **nie potrzebuje `chrome.*`**, bo jedynym kanałem powrotnym jest wartość zwracana.
Sonda daje dwa efekty: przy drugim kliknięciu plik nie jest ponownie wykonywany, więc nie ma `console.warn('already exists')`
w `consoleLogs` (AC-1.5), a typowe kliknięcie to 1 wywołanie zamiast 2.
Kontrakt `runInPage()` (`src/popup/run-in-page.js`) jest samowystarczalny, bo `func` jest serializowany przez
`toString()`. Nie może używać importów ani domknięć:
```js
// returns plain JSON only
{ ok: true, fileName: 'page-debug-snapshot-<Date.now()>.json' }
{ ok: false, reason: 'not-loaded' }
{ ok: false, reason: 'snapshot-failed', errorName: 'TypeError' }   // try/catch around init+download
```
`runInPage` wywołuje `init({ createFloatingButton: false })` tylko gdy `!initialized`, liczy `fileName` z
`config.fileNamePrefix` i przekazuje go do `download(fileName)`, więc nazwa pliku ma ten sam format co dziś.
Po stronie strony nic nie zostaje: `download()` dodaje i usuwa `<a>`, przycisk pływający jest wyłączony (AC-2.3).
Konsekwencje: znika `inject.js`, `web_accessible_resources` i `host_permissions` (AC-2.1, 2.5). CSP strony nie
blokuje skryptów wstrzykiwanych przez `executeScript` (AC-2.4). W Firefoksie trzeba to potwierdzić w QA (ryzyko R6).
**E1 zastąpi** `runInPage` komendą `stopAndCollect` przez SW i most ISOLATED. `snapshot-tab.js` (orkiestracja)
i sonda znikną. `messages.js`, `target.js` i walker builda zostają.

### D7 Wynik w popupie: słownik komunikatów i zamknięty zbiór wyników
Opcje:
(a) wyświetlać `error.message` jak dziś;
(b) orkiestrator zwraca jeden z wyników `success | restricted | fileAccess | noTab | failed`, a popup mapuje go
na komunikat ze słownika `MESSAGES`.
**Wybór: (b).**
Uzasadnienie: AC-1.4 zakazuje żargonu, a komunikat wyjątku przeglądarki jest po angielsku i techniczny. Słownik
pozwala przetestować wszystkie teksty jednym testem. Szczegóły błędu idą tylko do `console.error` popupu, dla developera.
`src/popup/messages.js`:
| klucz | tekst (PL) |
|---|---|
| `working` | „Zapisuję paczkę…” |
| `success(fileName)` | „Gotowe. Zapisano plik ${fileName} — znajdziesz go w pobranych plikach.” |
| `restricted` | „Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.” |
| `fileAccess` | „To jest plik z dysku. Żeby zapisać paczkę, wpisz w pasku adresu chrome://extensions, kliknij „Szczegóły” przy Page Debug Snapshot i włącz „Zezwalaj na dostęp do adresów URL plików”. Potem odśwież stronę i kliknij ponownie.” |
| `noTab` | „Nie widzę otwartej strony. Kliknij kartę ze stroną i spróbuj ponownie.” |
| `failed` | „Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki.” |
Konsekwencje: E1-T6 rozszerzy słownik o stany nagrywania, a test AC-1.4 obejmie je automatycznie.

### D8 Strony specjalne i `file://`
Opcje:
(a) tylko mapowanie wyjątku z `executeScript`;
(b) tylko wstępna klasyfikacja URL;
(c) obie: klasyfikacja `tab.url` (jeśli znany) i mapowanie wyjątku jako siatka bezpieczeństwa.
**Wybór: (c).**
Uzasadnienie: `tab.url` bywa nieznany (bez `tabs` URL widać tylko przy nadanym `activeTab`), a teksty wyjątków
zmieniają się między wersjami przeglądarek. Wstępna klasyfikacja daje natychmiastową odpowiedź (AC-1.3 ≤ 2 s).
Mapowanie łapie resztę. Nierozpoznany wyjątek daje `failed`, czyli zawsze polski komunikat i nigdy sukces.
`src/popup/target.js`:
- `classifyUrl(url)` → `'web' | 'file' | 'restricted' | 'unknown'`.
  - `restricted`: schematy `chrome:`, `chrome-extension:`, `chrome-search:`, `devtools:`, `edge:`, `about:`,
    `moz-extension:`, `resource:`, `view-source:`, `data:`, `javascript:` oraz hosty sklepów `chromewebstore.google.com`,
    `chrome.google.com/webstore*`, `addons.mozilla.org`, `microsoftedge.microsoft.com/addons*`.
  - `unknown`: brak URL.
- `mapInjectionError(err, url)` → `'restricted' | 'fileAccess' | 'failed'`. Wzorce: `Cannot access a chrome`,
  `extensions gallery cannot be scripted`, `Cannot access contents of`/`Missing host permission`/`must request permission`
  → `restricted`. Wyjątek dla URL `file:` w Chrome → `fileAccess`. Pozostałe → `failed`.
- `file://`: w Chrome przed wstrzyknięciem `await chrome.extension.isAllowedFileSchemeAccess()`. Gdy zwraca `false`,
  wynik to `fileAccess` (AC-1.6) bez próby wstrzyknięcia. W Firefoksie, wykrywanym przez
  `typeof chrome.runtime.getBrowserInfo === 'function'` (API tylko Firefoksa, bez UA sniffingu), tej sondy nie ma.
  Ewentualny wyjątek daje `restricted`, bo tekst o ustawieniu Chrome byłby tam nieprawdziwy.
Konsekwencje: listę hostów sklepów utrzymujemy ręcznie. Sygnałem pominięcia będzie zgłoszenie „failed” na stronie
sklepu, które nadal jest polskie i nie jest sukcesem.

### D9 Brak podwójnej instalacji hooków (AC-1.5)
Opcje:
(a) nowy marker `Symbol.for('pds.installed')`;
(b) istniejące guardy `if (window.PageDebugSnapshot) return` i `if (this.initialized)` + sonda z D6.
**Wybór: (b).**
Uzasadnienie: guardy już są i działają. Sonda sprawia, że plik nie wykona się drugi raz, a `runInPage` woła `init`
tylko przy `!initialized`. Marker z (a) to element refaktoru `recorder.js` w E1-T3/E1-T5. Dodany teraz zmieniłby treść
`page-debug-snapshot.js` bez zysku. Test e2e AC-1.5 pilnuje zachowania.
Konsekwencje: strona, która sama zdefiniuje `window.PageDebugSnapshot` (np. wklejony `console-snapshot.js`), zostanie
użyta przez `runInPage`. Ma ona to samo API, więc zrzut powstanie. Zachowanie jest akceptowalne, opisane w README (DOC1).

### D10 Jak e2e „klika” popup przy samym `activeTab`
Opcje:
(a) CDP `Extensions.triggerAction`, czyli prawdziwe uruchomienie akcji z nadaniem `activeTab`; popup otwiera się jako cel Playwright;
(b) popup otwarty jako karta z `?tabId=` + kopia `dist/chrome` z `host_permissions: ["http://127.0.0.1/*"]` (tylko w teście);
(c) tylko QA ręczne.
**Wybór: (a), weryfikowane spike'iem E0-T17 przed resztą e2e. (b) wyłącznie po zgodzie z PB-1.**
Uzasadnienie: (a) testuje dokładnie ścieżkę zgłaszającego, bez szwów testowych w kodzie produkcyjnym, i spełnia AC-3.3
literalnie. (b) jest pewne technicznie, ale modyfikuje manifest kopii. (c) odbiera E1 bazę e2e.
ID rozszerzenia w E0 (bez service workera) harness odczytuje przez `chrome://extensions` →
`chrome.developerPrivate.getExtensionsInfo()` (szukanie po `name`) albo z wyniku `Extensions.loadUnpacked`, jeśli spike
użyje CDP do ładowania. Nie liczymy ID z hasha ścieżki, bo normalizacja ścieżek na Windows bywa krucha.
Konsekwencje: przy (b) `popup.js` czyta `tabId` z `location.search` tylko gdy parametr istnieje. Szew jest nieszkodliwy,
bo strony nie mogą otworzyć `popup.html` bez `web_accessible_resources`.

### D11 Uruchamianie w przeglądarce (AC-7.x): `scripts/dev-browser.mjs` na web-ext, `.ps1` jako nakładka
Opcje:
(a) zostawić logikę uruchamiania w `.ps1` (`chrome.exe --load-extension`);
(b) wspólny skrypt Node `scripts/dev-browser.mjs <chrome|firefox> [--url <u>]`, który woła `build()`, a potem
programowe API `web-ext` (`cmd.run({ sourceDir: 'dist/<t>', target: 'chromium' | 'firefox-desktop', startUrl })`);
`.ps1` buduje i deleguje do niego.
**Wybór: (b).**
Uzasadnienie: Chrome stable od wersji 137 ignoruje `--load-extension` w buildach z marką Google, więc obecna ścieżka
Chrome w `.ps1` może otwierać przeglądarkę bez rozszerzenia. `web-ext` ładuje rozszerzenie przez CDP, zawsze na
**tymczasowym** profilu (AC-7.1), i działa na Linux (AC-7.3). Jedna implementacja zamiast dwóch.
Fallback dla Chrome: zmienna `PDS_CHROMIUM_BINARY` albo, gdy web-ext nie załaduje rozszerzenia do Chrome stable,
Chromium z Playwright (`chromium.executablePath()`) przez `chromiumBinary`.
Npm scripts (AC-7.3): `dev:chrome`, `dev:firefox`.
Minimalne zmiany w istniejącym `scripts/dev-browser.ps1`:
1. Blok `param` z `ValidateSet("chrome","firefox")` zostaje. Przy `-File` nieznana wartość kończy się kodem 1 i komunikatem
   z listą dozwolonych wartości (AC-7.4).
2. Na początku `npm run build` (`& npm run build; if ($LASTEXITCODE) { exit $LASTEXITCODE }`).
3. `$extDir = dist\$Browser`. **Usunąć fallback na `page-debug-extension/`** (katalog znika w D1). Brak manifestu po buildzie oznacza `throw`.
4. Gałęzie uruchamiania Chrome i Firefox zastąpić jednym wywołaniem `& node scripts/dev-browser.mjs $Browser --url $Url`
   z propagacją `$LASTEXITCODE`.
5. Tryb `-Pack` bez zmian logiki. Działa na `dist\$Browser` po buildzie (zip testera; `npm run pack` to zip wydania). (nieaktualne po F1: `-Pack` deleguje do `npm run pack`)
`dev-browser.mjs` przy nieznanym argumencie wypisuje `Unknown browser "<x>". Allowed: chrome, firefox` i kończy się kodem 2.
Konsekwencje: profil `%LOCALAPPDATA%\pds-dev-profile-*` przestaje być używany, co trzeba odnotować w skillu `pds-browser` (Docs).

### D12 Popup jako ES module podzielony na moduły testowalne
Opcje:
(a) jeden klasyczny `popup.js`;
(b) `<script type="module">` + moduły `messages.js`, `target.js`, `run-in-page.js`, `snapshot-tab.js` (czysta logika z
wstrzykniętym `api`), `popup.js` (tylko DOM).
**Wybór: (b).**
Uzasadnienie: moduły w popupie działają w Chrome i Firefoksie bez bundlera (CLAUDE.md: „ESM tam, gdzie Chrome pozwala”).
vitest importuje je bezpośrednio. `snapshotTab(tab, api)` testujemy fałszywym `api.scripting`, bez przeglądarki.
Walker z D3 śledzi `import`.
Konsekwencje: E1-T6 przebuduje `popup.js` (stany) i zachowa `messages.js`. Logika E1 trafi do tła.

### D13 Końce linii
Opcje: (a) nic nie robić; (b) `.gitattributes`: `* text=auto eol=lf`, `*.png binary`.
**Wybór: (b).**
Uzasadnienie: bez tego klon na Windows z `core.autocrlf=true` daje inne bajty w `dist` niż klon na Linux. AC-4.1
dotyczy tej samej maszyny, ale testy hashy i porównania zipów między platformami byłyby mylące. Koszt to jednorazowe
`git add --renormalize .`.
Konsekwencje: jeden commit normalizacyjny (zwykle pusty, jeśli pliki już mają LF).

## Architektura

```
E0 (bez tła, bez ISOLATED, bez postMessage)

 Zgłaszający ──klik ikony──▶ Chrome/Firefox nadaje activeTab dla bieżącej karty
                                   │
                            ┌──────▼───────────────────────────────┐
                            │ popup (moduły ES, ma chrome.*)       │
                            │ popup.js → snapshotTab(tab, api)     │
                            │  1. classifyUrl(tab.url)             │──restricted/fileAccess──▶ komunikat PL (≤2 s)
                            │  2. executeScript(func: runInPage,   │
                            │       world: MAIN)  ── sonda ──┐     │
                            │  3. jeśli not-loaded:          │     │
                            │     executeScript(files:       │     │
                            │       page/page-debug-snapshot.js,   │
                            │       world: MAIN) + krok 2    │     │
                            │  4. wynik → MESSAGES[kind]     │     │
                            └────────────────────────────────┼─────┘
                                       ▲ InjectionResult[0].result (structured clone)
                                       │ {ok, fileName} | {ok:false, reason}
                            ┌──────────┴──────────────────────▼────┐
                            │ MAIN world strony (brak chrome.*)    │
                            │ window.PageDebugSnapshot (IIFE)      │
                            │ runInPage(): init(no button) →       │
                            │   download(fileName) → <a download>  │──▶ plik .json w Pobranych
                            └──────────────────────────────────────┘
 Wyjątek executeScript (chrome://, sklep, file:// bez zgody) ──▶ mapInjectionError ──▶ komunikat PL
```
Kanał MAIN → popup to **wyłącznie wartość zwracana przez `func`**. MAIN nie ma `chrome.*`. W E0 nie ma `postMessage`,
bo nie ma ISOLATED.

**Co zmienia E1** (żeby nie inwestować w rzeczy do wyrzucenia):
```
popup ──runtime.sendMessage──▶ tło (SW Chrome / event page Firefox, stan w storage.session)
tło ──registerContentScripts(MAIN recorder + ISOLATED bridge, document_start)──▶ strona
MAIN ──window.postMessage({__pds: nonce, payload})──▶ ISOLATED (sprawdza e.source===window i nonce) ──runtime.sendMessage──▶ tło
```
Znikają: `run-in-page.js`, `snapshot-tab.js` (sonda) i dzisiejszy `popup.js`.
Zostają: `messages.js`, `target.js` (używane też przez tło), build, walker, manifesty z nakładkami, harness e2e i fixture.

## Zmiany w manifeście

| Klucz | Zmiana | Uzasadnienie |
|---|---|---|
| `permissions: activeTab` | bez zmian | dostęp do bieżącej karty tylko po kliknięciu ikony; daje `tab.url` i prawo do `executeScript` |
| `permissions: scripting` | bez zmian | `scripting.executeScript` z `world: 'MAIN'` |
| `host_permissions: ["<all_urls>"]` | **usunięte** | `activeTab` wystarcza dla flow „klik → zrzut” (AC-2.1, 2.2) |
| `web_accessible_resources` | **usunięte** | brak `<script src=chrome-extension://>`, ID rozszerzenia niewidoczne dla stron (AC-2.1, 2.3) |
| `action.default_popup` | `popup.html` → `popup/popup.html` | układ D1 |
| `action.default_icon` | dodane (16, 48) | ikona przycisku na pasku w obu przeglądarkach |
| `description` | nowe, jedno zdanie | AC-ST.1 |
| `minimum_chrome_version` | dodane, tylko Chrome | D4 |
| `browser_specific_settings.gecko` | dodane, tylko Firefox | D4, AC-4.8, AC-ST.4 |

`src/manifest.base.json`:
```json
{
  "manifest_version": 3,
  "name": "Page Debug Snapshot",
  "version": "1.0.0",
  "description": "Zapisuje do jednego pliku dane diagnostyczne bieżącej strony, aby przekazać je developerowi przy zgłoszeniu błędu.",
  "permissions": ["activeTab", "scripting"],
  "action": {
    "default_title": "Page Debug Snapshot",
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

`src/manifest.chrome.json`:
```json
{
  "minimum_chrome_version": "121"
}
```

`src/manifest.firefox.json`:
```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "{799eb178-df9a-41bb-9775-8fc8aff45926}",
      "strict_min_version": "128.0",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```
Wynik `dist/<target>/manifest.json` to klucze bazy w tej kolejności, a po nich klucze nakładki.

## Schema paczki
Bez zmian. Pole `version: "1.0.0"`, bez `schemaVersion`, klucze najwyższego poziomu jak dziś (AC-6.5).
Nazwa pliku `page-debug-snapshot-<Date.now()>.json` bez zmian, teraz liczona w `runInPage` i przekazywana do `download()`.

## Zadania

Numeracja z backlogu zachowana. Nowe zadania: T13–T17. Wszystkie ścieżki są względne do roota repo.

### E0-T2 Root `package.json` i konfiguracja narzędzi  [niezależne: tak]  [zależy od: —]
Pliki: `package.json`, `package-lock.json` (generowany), `vitest.config.js`, `eslint.config.js`, `tests/unit/package-json.test.js`;
usunięcie `page-debug-extension/package.json` i `page-debug-extension/package-lock.json`.
Co zrobić:
- `npm init` w roocie: `private: true`, `type: module`, `engines.node` według D2.
- `devDependencies` z D2 (aktualne majory, lockfile commitowany), **brak** `dependencies`, brak `sharp`.
- Skrypty: `build: node scripts/build.mjs`, `pack: node scripts/pack.mjs`, `test: vitest run`,
  `test:e2e: playwright test`, `lint: npm run build && eslint . && web-ext lint --source-dir dist/firefox`,
  `dev:chrome: node scripts/dev-browser.mjs chrome`, `dev:firefox: node scripts/dev-browser.mjs firefox`,
  `check:history: node scripts/check-repo.mjs --history`, `fixtures: node tests/e2e/helpers/fixtures-server.js`.
- `vitest.config.js` i `eslint.config.js` według D2.
Testy do napisania najpierw (`package-json.test.js`):
- `has no dependencies section`: AC-4.6.
- `has web-ext in devDependencies and no sharp anywhere`: AC-4.6, w tym w lockfile.
- `defines required scripts`: `build`, `pack`, `test`, `test:e2e`, `lint`, `dev:chrome`, `dev:firefox`.
- `lint script runs eslint and web-ext lint on dist/firefox`: AC-3.1.
Definicja ukończenia: `npm ci && npm test` zielone (tylko ten test), `npm ci` bez `EBADENGINE` na Node 26.

### E0-T13 Przeniesienie kodu do `src/`  [niezależne: nie]  [zależy od: E0-T2]
Pliki (tylko `git mv`, bez zmian treści): `popup.html`, `popup.js`, `inject.js` → `src/popup/`;
`page-debug-snapshot.js` → `src/page/`; `icons/*` → `src/icons/`; `console-snapshot.js` → `src/standalone/`;
`manifest.json` → `src/manifest.base.json` (treść poprawia T4); nowy `tests/unit/layout.test.js`.
Co zrobić:
- `git mv` jak wyżej. Katalog `page-debug-extension/` nie może mieć śledzonych plików.
- Usunąć lokalne ignorowane pozostałości `page-debug-extension/node_modules` i `page-debug-extension/page-debug-extension.zip`.
  Jeśli brak zgody na kasowanie, zostawić i odnotować w state.md.
- Nie zmieniać treści `page-debug-snapshot.js` ani `console-snapshot.js`.
Testy do napisania najpierw (`layout.test.js`):
- `extension sources live in src/`: istnieją `src/page/page-debug-snapshot.js`, `src/popup/popup.html`, `src/icons/icon{16,48,128}.png`.
- `no tracked files under page-debug-extension/`: `git ls-files page-debug-extension` jest puste (AC-5.3).
- `console-snapshot.js unchanged`: SHA-256 `src/standalone/console-snapshot.js` równe zapisanemu w teście (decyzja 6, ryzyko 5).
Definicja ukończenia: testy zielone, `git log --follow src/page/page-debug-snapshot.js` pokazuje historię.

### E0-T4 Manifesty: baza + nakładki, bez `<all_urls>` i WAR (+ stub README „Uprawnienia”)  [niezależne: tak]  [zależy od: E0-T13]
Pliki: `src/manifest.base.json`, `src/manifest.chrome.json`, `src/manifest.firefox.json`, `README.md` (dodanie sekcji
„Uprawnienia”; resztę pisze DOC1), `tests/unit/manifest-sources.test.js`.
Co zrobić:
- Treść trzech plików dokładnie jak w sekcji „Zmiany w manifeście”.
- README: sekcja `## Uprawnienia` z jedną linią na `activeTab` i `scripting` (teksty z tabeli wyżej).
Testy do napisania najpierw:
- `sources have no broad host permissions`: brak `host_permissions` z `<all_urls>`, `*://*/*`, `http://*/*`, `https://*/*` w każdym `src/manifest.*.json` (AC-2.1).
- `sources have no web_accessible_resources` (AC-2.1).
- `permissions subset of activeTab, scripting` (AC-2.1).
- `overlays only use allowed target keys`: chrome ⊆ {`minimum_chrome_version`}, firefox ⊆ {`browser_specific_settings`} (AC-4.8).
- `description is a single sentence`: brak `;`, dokładnie jedno `.`/`!`/`?` i to na końcu, długość ≤ 132 (AC-ST.1).
- `gecko id is email-like or braced GUID`: regex `^[\w.+-]+@[\w-]+(\.[\w-]+)+$|^\{[0-9a-f-]{36}\}$`i (AC-ST.4).
- `firefox strict_min_version is 128.0` (AC-4.8).
- `README Uprawnienia section mentions every permission` (AC-ST.3).
Definicja ukończenia: testy zielone. Backlog E0-T4 i część „usunięcie WAR” z E0-T3 zamknięte.

### E0-T8 Unit testy istniejącej logiki `page-debug-snapshot.js`  [niezależne: tak]  [zależy od: E0-T13]
Pliki: `tests/unit/helpers/load-page-script.js`, `tests/unit/page-debug-snapshot.test.js`.
Co zrobić:
- Helper w środowisku jsdom czyta `src/page/page-debug-snapshot.js`, czyści `window.PageDebugSnapshot` i wykonuje
  plik w globalnym zakresie jsdom (indirect eval `(0, eval)(src)`; jeśli `window !== globalThis` w danej wersji vitest,
  to `window.eval`). Zwraca `window.PageDebugSnapshot`. Test samego helpera musi to potwierdzić.
- Testy wołają metody na obiekcie, **bez** `init()` (bez hooków konsoli w testach logiki).
Testy do napisania najpierw:
- `loader exposes PageDebugSnapshot with version 1.0.0`.
- `deepMerge merges nested objects`, `deepMerge replaces arrays`, `deepMerge returns copy of target for null/non-object source`,
  `deepMerge does not mutate target` (AC-6.1).
- `safeSlice keeps short string`, `safeSlice truncates with exact N suffix`, `safeSlice returns non-string unchanged` (AC-6.2).
- `pushLimited drops oldest and keeps length max` (AC-6.3).
- `safeJson`:
  - `named and anonymous functions`;
  - `Error to {name,message,stack}`;
  - `Element to summary with outerHTML ≤ 2000 + suffix`;
  - `cycle to [Circular]`;
  - `BigInt to serializationError+fallback`;
  - `same object twice without cycle → [Circular] (known quirk, kept in E0)`, z komentarzem w teście (AC-6.4).
Definicja ukończenia: testy zielone, `npm test` ≤ 30 s. Ręcznie: odwrócona asercja w `safeSlice` daje kod ≠ 0 (AC-3.5).

### E0-T5 Kontrakt wyniku w MAIN + słownik komunikatów  [niezależne: tak]  [zależy od: E0-T13]
Pliki: `src/popup/run-in-page.js`, `src/popup/messages.js`, `tests/unit/run-in-page.test.js`, `tests/unit/messages.test.js`.
Co zrobić:
- `export function runInPage()` według kontraktu z D6: samowystarczalna, bez odwołań do zakresu modułu, try/catch na całości.
- `export const MESSAGES` według D7 (`success` jako funkcja `fileName → string`) i `export function messageFor(outcome)`.
Testy do napisania najpierw:
- `runInPage returns not-loaded when PageDebugSnapshot missing`.
- `runInPage inits once without floating button and returns fileName`: fake PDS z licznikiem `init`, `fileName` pasuje
  do `/^page-debug-snapshot-\d+\.json$/`, a `download` dostał tę samą nazwę.
- `runInPage does not re-init when initialized`.
- `runInPage returns snapshot-failed when download throws`: bez rzucania na zewnątrz.
- `runInPage is self-contained`: `new Function('return ' + runInPage.toString())()` w czystym kontekście daje ten sam wynik.
  Symuluje serializację `func`. Zakaz `new Function` dotyczy tylko `dist`.
- `messages contain no forbidden words`: dla każdej wartości (funkcje z przykładową nazwą pliku) brak `executeScript`,
  `inject`, `undefined`, `Error:`, `stack`, `PageDebugSnapshot` (AC-1.4).
- `success message contains the file name` (AC-1.1, część unit).
- `restricted message starts with "Na tej stronie nie da się zapisać paczki."` (AC-1.3).
- `fileAccess message names the Chrome setting` (AC-1.6).
Definicja ukończenia: testy zielone, eslint na nowych plikach czysty.

### E0-T12 Klasyfikacja stron specjalnych i `file://`  [niezależne: tak]  [zależy od: E0-T13]
Pliki: `src/popup/target.js`, `tests/unit/target.test.js`.
Co zrobić:
- `classifyUrl(url)` i `mapInjectionError(err, url, { isFirefox })` według D8.
- `isFirefoxRuntime(chromeApi)` → `typeof chromeApi?.runtime?.getBrowserInfo === 'function'`.
Testy do napisania najpierw (tabela przypadków):
- `classifyUrl` dla:
  - `chrome://version`, `chrome-extension://x/`, `about:addons`, `about:blank`, `moz-extension://x/`, `edge://settings`,
    `view-source:http://a`, `https://chromewebstore.google.com/detail/x`, `https://chrome.google.com/webstore/x`,
    `https://addons.mozilla.org/pl/firefox/` → `restricted`;
  - `file:///C:/a.html` → `file`;
  - `http://127.0.0.1:1234/basic.html`, `https://example.com` → `web`;
  - `undefined` → `unknown`.
- `mapInjectionError` dla:
  - `Cannot access a chrome:// URL` → `restricted`;
  - `The extensions gallery cannot be scripted.` → `restricted`;
  - `Cannot access contents of url "file:///…"` + url `file:` w Chrome → `fileAccess`; to samo w Firefoksie → `restricted`;
  - `Missing host permission for the tab` → `restricted`;
  - `boom` → `failed`;
  - `undefined` → `failed`.
- `isFirefoxRuntime` na fake API.
Definicja ukończenia: testy zielone. AC-1.3 i AC-1.6 mają pokrycie logiki.

### E0-T1 Higiena repo: `.gitattributes`, `.gitignore`, kontrola indeksu i historii  [niezależne: tak]  [zależy od: E0-T13]
(Reszta backlogu E0-T1. Git, `.gitignore` i usunięcie logo z historii zrobione wcześniej.)
Pliki: `.gitattributes`, `.gitignore`, `scripts/check-repo.mjs`, `tests/unit/repo-hygiene.test.js`.
Co zrobić:
- `.gitattributes` według D13 i `git add --renormalize .`.
- `.gitignore`: linię `page-debug-extension/icons/logo*.png` zastąpić `src/icons/logo*.png`. Reszta bez zmian.
- `scripts/check-repo.mjs` eksportuje `forbiddenTracked(paths)` i `forbiddenInHistory(nameOnlyLog)` (wzorce z tabeli US-5 i AC-5.2).
  CLI: bez flag sprawdza `git ls-files`, z `--history` sprawdza `git log --all --name-only --format=`. Kod 1 i lista trafień przy naruszeniu.
- Weryfikacja historii (AC-5.2) **po force pushu użytkownika**: w E0-R1 uruchomić `npm run check:history`
  i `git ls-remote origin main`, który ma wskazywać nowy HEAD, a nie `f139411`. Do tego czasu nie dodawać `check:history` do `npm test`.
Testy do napisania najpierw:
- `forbiddenTracked flags pem, crx, xpi, zip, node_modules, snapshots, test output, settings.local.json, logo pngs`:
  tabela ścieżek syntetycznych.
- `forbiddenInHistory flags logo.png in any path` itd.
- `current index has no forbidden paths`: `git ls-files` przez `execFileSync` (AC-5.1, 5.3).
- `.gitignore contains src/icons/logo*.png` (AC-5.6).
- `tests contain no production domains`: skan `tests/**` (z pominięciem tego pliku) po liście domen z przykładowego
  snapshotu (`gazeta.pl`, `agora.pl` itd.). Lista trzymana w teście (AC-5.4).
Definicja ukończenia: testy zielone. `node scripts/check-repo.mjs` daje kod 0.

### E0-T14a Biblioteka builda: scalanie manifestów i walker osiągalności  [niezależne: tak]  [zależy od: E0-T2]
Pliki: `scripts/lib/manifest.mjs`, `scripts/lib/reachability.mjs`, `tests/unit/build-lib.test.js`.
Co zrobić:
- `mergeManifest(base, overlay)` według D4 (rzuca przy kolizji i przy kluczu spoza `TARGET_KEYS`). Eksport `TARGET_KEYS`.
- `collectReachable(dir)` → posortowana lista ścieżek względnych (POSIX `/`) według D3.
  Rzuca `Missing referenced file: <path>`, gdy referencja nie istnieje.
- Parsowanie HTML i JS regexami: `<script[^>]+src="…"`, `<link[^>]+href="…"`, `import … from '…'`,
  `files:\s*\[([^\]]*)\]`. Ignoruje URL absolutne (`http`, `chrome-extension`).
Testy do napisania najpierw (fixture katalogi tworzone w `os.tmpdir()` w teście):
- `mergeManifest appends overlay keys after base keys`.
- `mergeManifest throws on overriding base key`.
- `mergeManifest throws on non-target key`.
- `collectReachable follows icons, popup html, module imports, executeScript files`.
- `collectReachable ignores unreferenced files` (np. `standalone/console-snapshot.js`).
- `collectReachable throws on missing referenced file`.
- `collectReachable handles background.service_worker/scripts and content_scripts`: test pod E1.
Definicja ukończenia: testy zielone, zero zależności poza `node:`.

### E0-T16a Serwer fixture i strona `basic.html`  [niezależne: tak]  [zależy od: E0-T2]
Pliki: `tests/e2e/helpers/fixtures-server.js`, `tests/fixtures/pages/basic.html`, `tests/unit/fixtures-server.test.js`.
Co zrobić:
- `startFixtureServer({ port = 0, root = 'tests/fixtures/pages' })` → `{ url, close }` na `node:http` i `127.0.0.1`, statycznie z `tests/fixtures/pages`.
- Trasy: `/api/fail` → 500 JSON, `/img/404.png` → 404. Dla `/csp-strict.html` nagłówek `Content-Security-Policy: script-src 'self'`.
- Uruchomienie jako CLI (`npm run fixtures`, port z `--port`, domyślnie 8080) dla QA ręcznego w Firefoksie.
- `basic.html`: syntetyczna treść, `<script src="basic.js">` jest zbędny. Inline'owy skrypt, który `console.log`uje,
  też jest dopuszczalny (CSP dotyczy tylko `csp-strict`).
Testy do napisania najpierw:
- `serves basic.html with 200`.
- `returns 404 for unknown path`.
- `adds CSP header for csp-strict.html`: test tworzy tymczasowy `csp-strict.html` w katalogu przekazanym do serwera (`root` jako opcja `startFixtureServer`) i sprawdza nagłówek.
- `binds to 127.0.0.1 only`.
Definicja ukończenia: testy zielone w `npm test` bez sieci zewnętrznej.

### E0-T17 Spike: uruchomienie akcji z `activeTab` w Playwright  [niezależne: tak]  [zależy od: E0-T2]
Pliki: `tests/e2e/helpers/launch.js`, `tests/e2e/spike-action.spec.js` (po spike'u zmieniany na `harness.spec.js` w T16b),
`docs/epics/E0/state.md` (wynik spike'u w sekcji Historia).
Co zrobić (timebox: jeden przebieg implementera):
- Minimalne rozszerzenie testowe generowane w `os.tmpdir()`: manifest z `activeTab` + `scripting`, popup z przyciskiem
  wołającym `executeScript(func: () => document.title, world: 'MAIN')`.
- `launchWithExtension(dir)`: `chromium.launchPersistentContext('', { channel: 'chromium', headless: !process.env.PDS_E2E_HEADED,
  args: ['--disable-extensions-except=…', '--load-extension=…', '--enable-unsafe-extension-debugging'] })`.
- ID rozszerzenia: `chrome://extensions` + `chrome.developerPrivate.getExtensionsInfo()`. Alternatywnie CDP `Extensions.loadUnpacked`.
- Próba `Extensions.triggerAction({ id, targetId })` przez sesję CDP (browser-level, jeśli dostępna; jeśli nie, page-level).
  Sprawdzić, czy popup pojawia się jako strona w kontekście i czy `executeScript` na karcie fixture zwraca tytuł.
- Zmierzyć baseline wydajności (NFR): jeśli (a) działa, ta sama technika na rozszerzeniu z commita `411f60e`
  (`git archive` do temp; ma `<all_urls>`). Mediana klik → `download` z 5 prób.
Testy do napisania najpierw:
- `spike: extension id resolved without service worker`.
- `spike: triggered action grants activeTab (executeScript returns fixture title)`.
- `spike: works headless (new headless, channel chromium)`.
Definicja ukończenia: wynik (a) działa / nie działa zapisany w state.md, z wersją Chromium i Playwright. Przy porażce
orkiestrator uruchamia ścieżkę PB-1 przed T16b.

### E0-T14b Skrypt `npm run build` i testy na wyniku  [niezależne: nie]  [zależy od: E0-T4, E0-T14a, E0-T3]
(Zależy od T3, żeby walker widział docelowy `popup.html`/moduły. Testy pisane równolegle z T3 są dopuszczalne.)
Pliki: `scripts/build.mjs`, `tests/unit/build.test.js`, `tests/unit/helpers/build-to-tmp.js`.
Co zrobić:
- `export async function build({ srcDir = 'src', outDir = 'dist', targets = ['chrome','firefox'] })`.
- Dla każdego targetu: `rm -rf outDir/<t>`, scalenie manifestu, zapis do `outDir/<t>/manifest.json`. Potem
  `collectReachable` liczony na **źródle z wirtualnym manifestem** (walker przyjmuje obiekt manifestu i `baseDir`) i kopia tych plików.
- CLI: `node scripts/build.mjs` buduje do `dist/` i wypisuje rozmiar każdego targetu w KB.
- Helper testowy `buildToTmp()` buduje raz na plik testowy do `mkdtemp` i sprząta w `afterAll`.
Testy do napisania najpierw:
- `build is deterministic`: dwa buildy do dwóch katalogów dają identyczne listy plików i SHA-256 dla obu targetów (AC-4.1).
- `build removes stale files`: plik-śmieć w `outDir/chrome` znika po buildzie (AC-4.1).
- `every dist file is reachable and every reference exists` (AC-4.2).
- `dist contains no forbidden files`: `node_modules`, `*.pem`, `*.crx`, `*.zip`, `package*.json`, `logo*.png`,
  `console-snapshot.js`, `tests/`, `scripts/` (AC-4.3).
- `each target is under 500 KB` (AC-4.4).
- `inject.js absent in src and both targets` (AC-2.5).
- `no remote code`: brak `<script src="http`, `import … from 'http`, `eval(`, `new Function(` w `dist/*` (AC-ST.2).
- `dist manifests have no broad host permissions nor WAR` (AC-2.1 na dist).
- `no callbacks or importScripts in src`: grep `importScripts` oraz heurystyka `chrome\.\w+\.\w+\([^)]*\b(function|=>)` (NFR Firefox).
Definicja ukończenia: testy zielone, `npm run build` < 10 s, `dist/` zawiera oba targety.

### E0-T3 Popup: orkiestracja `executeScript` w MAIN, usunięcie `inject.js`  [niezależne: nie]  [zależy od: E0-T5, E0-T12]
Pliki: `src/popup/snapshot-tab.js`, `src/popup/popup.js`, `src/popup/popup.html`, `tests/unit/snapshot-tab.test.js`;
usunięcie `src/popup/inject.js`.
Co zrobić:
- `snapshotTab(tab, api)` → `{ kind, fileName? }` według D6/D8. `api` = `{ scripting, isAllowedFileSchemeAccess, isFirefox }`.
  Kroki: `noTab` gdy brak `tab?.id`. Potem `classifyUrl`. Dla `file` w Chrome sonda dostępu. Dalej `executeScript(func: runInPage, world: 'MAIN')`.
  Przy `not-loaded`: `executeScript(files: ['page/page-debug-snapshot.js'], world: 'MAIN')` i ponownie `runInPage`.
  Wynik `ok` daje `success`, a `snapshot-failed`, brak wyniku lub drugi `not-loaded` dają `failed`. Wyjątek idzie przez `mapInjectionError`.
- `target: { tabId: tab.id }` bez `allFrames` (zrzut ramki głównej jak dziś).
- `popup.js`: pobiera kartę (`chrome.tabs.query({active:true,currentWindow:true})`; przy PB-1 dodatkowo `?tabId=`).
  Blokuje przycisk, pokazuje `MESSAGES.working`, potem `messageFor(outcome)` z klasą `error` dla wszystkiego poza `success`.
  `console.error` z detalami tylko w popupie.
- `popup.html`: `<script type="module" src="popup.js">`. Teksty i style bez zmian (E1-T6).
- `git rm src/popup/inject.js`.
Testy do napisania najpierw (fake `api.scripting.executeScript` nagrywa wywołania):
- `returns noTab without tab id`.
- `returns restricted for chrome:// without calling executeScript` (AC-1.3).
- `returns fileAccess when file scheme access disallowed in Chrome, without executeScript` (AC-1.6).
- `skips file access probe in Firefox`.
- `every executeScript call uses world MAIN and target.tabId`.
- `injects page script only when runInPage reports not-loaded`: 1. wywołanie `func`, 2. `files`, 3. `func`.
- `second snapshot on same tab does not inject files again` (AC-1.5, logika).
- `maps rejection via mapInjectionError` (AC-1.3).
- `returns failed on snapshot-failed and on missing result` (AC-1.2).
- `returns success with fileName` (AC-1.1).
Definicja ukończenia: testy zielone, w `src/` nie ma `inject.js` ani `chrome.runtime.getURL`.

### E0-T6 Test ikon w `dist/*/icons`  [niezależne: tak]  [zależy od: E0-T14b]
(Logo usunięte wcześniej. Zostaje test.)
Pliki: `tests/unit/icons.test.js`.
Co zrobić: odczyt nagłówka PNG (sygnatura 8 bajtów, IHDR: szerokość i wysokość w bajtach 16–23) bez zależności.
Testy do napisania najpierw:
- `icons are PNG with exact sizes 16, 48, 128` w obu targetach.
- `icons total ≤ 50 KB` per target.
- `no logo*.png in dist` (AC-4.7).
Definicja ukończenia: testy zielone.

### E0-T10 Test porównawczy manifestów `dist/chrome` vs `dist/firefox`  [niezależne: tak]  [zależy od: E0-T14b]
Pliki: `tests/unit/manifest-parity.test.js`.
Co zrobić: zbudować do tmp i porównać manifesty po usunięciu `TARGET_KEYS` (import z `scripts/lib/manifest.mjs`).
Testy do napisania najpierw:
- `manifests identical except target keys`: deep-equal po wycięciu kluczy (AC-4.8).
- `version, name, description, permissions, action, icons identical`: jawna lista z AC-4.8.
- `fails on extra difference`: test negatywny na sztucznie zmienionej kopii obiektu, który dowodzi, że porównanie łapie różnicę.
- `firefox has gecko.strict_min_version 128.0 and valid id; chrome has minimum_chrome_version` (AC-4.8, AC-ST.4).
Definicja ukończenia: testy zielone.

### E0-T15 `npm run pack`: dwa zipy  [niezależne: tak]  [zależy od: E0-T14b]
Pliki: `scripts/pack.mjs`, `tests/unit/pack.test.js`.
Co zrobić:
- `export async function pack({ distDir = 'dist' })`: woła `build()`, potem dla każdego targetu `zipSync` z `fflate`
  (wpisy posortowane, `mtime` stały, `level: 9`). Zapis do `dist/page-debug-snapshot-<target>-<version>.zip`.
  Zwraca listę ścieżek i wypisuje rozmiary.
- Ścieżki w zipie z `/`, `manifest.json` w korzeniu.
Testy do napisania najpierw (pack do tmp):
- `creates exactly two zips named with target and version` (AC-4.5).
- `zip has manifest.json at root` (AC-4.5).
- `unzipped content equals dist/<target> byte for byte`: `unzipSync` + SHA-256. Dzięki temu lint `dist/firefox` pokrywa zip Firefoksa (AC-4.5).
- `zip size ≤ target dir size` (NFR rozmiar).
- `zip contains no forbidden files` (AC-4.3).
Definicja ukończenia: testy zielone, `npm run pack` działa na Windows i (deklaratywnie) Linux, bez binarek natywnych.

### E0-T9 `npm run lint` zielony (eslint + web-ext lint)  [niezależne: tak]  [zależy od: E0-T14b, E0-T3]
Pliki: poprawki w `src/popup/*.js` / `scripts/*.mjs` / `tests/**`, jeśli eslint coś zgłosi; ewentualnie `eslint.config.js` (ignores, globals).
Co zrobić:
- Uruchomić `npm run lint` i naprawić błędy eslint w nowym kodzie. W `page-debug-snapshot.js` i `console-snapshot.js`
  **nie zmieniać treści**. Przy błędach: per-plik `rules` override w `eslint.config.js` z komentarzem „treść bez zmian do E1-T3”.
- `web-ext lint --source-dir dist/firefox`: 0 errors. Warnings wypisane, wklejone do state.md z oceną (ryzyko R4).
Testy do napisania najpierw: lint jest testem samym w sobie. Brak sensownego testu unit poza tym, który już sprawdza
skrypt w T2. Kryterium: `npm run lint; echo $?` = 0.
Definicja ukończenia: `npm run lint` kod 0, lista warnings web-ext w state.md.

### E0-T16b Harness e2e na `dist/chrome`  [niezależne: nie]  [zależy od: E0-T17, E0-T14b, E0-T16a]
Pliki: `playwright.config.js`, `tests/e2e/global-setup.js`, `tests/e2e/global-teardown.js`, `tests/e2e/helpers/launch.js`
(dopracowanie po spike'u), `tests/e2e/harness.spec.js` (zamiast `spike-action.spec.js`).
Co zrobić:
- `globalSetup`: `build()` do `dist/` i zapis `git status --porcelain` do zmiennej środowiskowej lub pliku w `os.tmpdir()`.
- `globalTeardown`: ponowne `git status --porcelain` i błąd, jeśli różni się od stanu sprzed testów (AC-3.4).
- `launch.js`: zawsze `path.resolve('dist/chrome')` (AC-3.3), headless domyślnie, `PDS_E2E_HEADED=1` dla debugowania.
  Eksport `openPopupFor(page)`: ścieżka (a) z D10 albo (b) po zgodzie PB-1. Downloads w temp Playwright (bez `downloadsPath`).
- Fixture server startowany per worker (`test.beforeAll`).
Testy do napisania najpierw:
- `loads extension from dist/chrome`: ID rozwiązane, manifest wczytany z `dist/chrome` (AC-3.3).
- `popup opens for fixture tab and shows button`.
- `git status unchanged after run` (teardown, AC-3.4).
Definicja ukończenia: `npm run test:e2e` zielony (tylko harness) headless, 10/10 przebiegów z rzędu (ryzyko spec 1).

### E0-T11 Uruchamianie w Chrome/Firefox: `dev-browser.mjs` + zmiany w `.ps1`  [niezależne: tak]  [zależy od: E0-T14b]
Pliki: `scripts/dev-browser.mjs`, `scripts/dev-browser.ps1` (zmiany z D11), `tests/unit/dev-browser.test.js`.
Co zrobić:
- `parseArgs(argv)` → `{ browser, url }` lub rzuca `UsageError`. CLI: `build()` → `webExt.cmd.run(...)`
  (target `chromium` lub `firefox-desktop`, `sourceDir: dist/<t>`, `startUrl`). Fallback binarki Chromium według D11.
- `.ps1` według 5 punktów z D11. Bez innych zmian.
Testy do napisania najpierw:
- `parseArgs accepts chrome and firefox`.
- `parseArgs rejects unknown browser with allowed values in message`.
- `cli exits with code 2 for unknown browser`: `spawnSync(node, ['scripts/dev-browser.mjs','opera'])` bez uruchamiania przeglądarki (AC-7.4).
- `cli does not build when args invalid` (szybka porażka).
Definicja ukończenia: testy zielone. Ręcznie `npm run dev:chrome` i `npm run dev:firefox` otwierają przeglądarkę
z rozszerzeniem w ≤ 60 s (AC-7.1–7.3, QA). `.ps1 -Browser opera` daje kod ≠ 0 z listą wartości.

### E0-T7a e2e: smoke, błąd zrzutu, strona specjalna, pomiar czasu  [niezależne: nie]  [zależy od: E0-T16b, E0-T3]
Pliki: `tests/e2e/smoke.spec.js`, `tests/e2e/failure.spec.js`, `tests/e2e/restricted.spec.js`,
`tests/fixtures/pages/throw-on-snapshot.html`, `tests/e2e/helpers/download.js`.
Co zrobić:
- `basic.html` z inline `MutationObserver`, który zapisuje dodane węzły do `window.__added`.
- `throw-on-snapshot.html`: `Object.defineProperty(Document.prototype, 'title', { get() { throw new Error('forced') } })`.
  `collectEnvironment` rzuci wyjątek przed utworzeniem Bloba, więc nie powstanie żaden plik.
- `download.js`: `waitForDownloadJson(page, action)` → `{ suggestedFilename, json }`.
  Negatywny wariant `expectNoDownload(context, ms = 1000)` czeka na zdarzenie z timeoutem, bez `sleep`.
Testy do napisania najpierw:
- `smoke: one json downloaded and status contains its filename` (AC-1.1).
- `smoke: package top-level keys and version 1.0.0` (AC-6.5).
- `smoke: no chrome-extension script nodes added and no leftover nodes` (AC-2.3).
- `failure: error status in Polish, no success text, no download` (AC-1.2).
- `restricted: chrome://version shows restricted message within 2 s` (AC-1.3).
- `perf: median click→download of 5 runs logged and < 2000 ms` (NFR; porównanie z baseline z T17 w qa-report).
Definicja ukończenia: wszystkie zielone headless, 10/10 przebiegów z rzędu.

### E0-T7b e2e: podwójne kliknięcie, CSP, paczka z zipa  [niezależne: nie]  [zależy od: E0-T16b, E0-T15, E0-T3]
Pliki: `tests/e2e/double-click.spec.js`, `tests/e2e/csp.spec.js`, `tests/fixtures/pages/csp-strict.html`,
`tests/fixtures/pages/csp-strict.js`, `tests/e2e/packed-zip.spec.js`.
Co zrobić:
- `csp-strict.html` bez inline'ów (CSP `script-src 'self'` z serwera), skrypt zewnętrzny `csp-strict.js`.
- `packed-zip.spec`: `pack()` do tmp, `unzipSync` do tmp, `launchWithExtension(tmpDir)`, smoke (jeden plik, sukces).
Testy do napisania najpierw:
- `double click: two files, both success, marker logged between appears exactly once in second file consoleLogs` (AC-1.5).
- `csp strict page: download and success` (AC-2.4).
- `packed chrome zip loads and passes smoke` (AC-4.5).
Definicja ukończenia: zielone headless, 10/10, `npm run test:e2e` ≤ 3 min.

## Kolejność i równoległość

| Grupa | Zadania | Warunek startu | Równolegle |
|---|---|---|---|
| A | E0-T2 → E0-T13 | — | nie (sekwencja) |
| B | E0-T4, E0-T8, E0-T5, E0-T12, E0-T1, E0-T14a, E0-T16a, **E0-T17 (spike — zacząć pierwszy)** | po A; T14a, T16a, T17 już po T2 | tak, wszystkie |
| C | E0-T3, potem E0-T14b | T3: T5 + T12; T14b: T4 + T14a + T3 | T14b może pisać testy równolegle z T3 |
| D | E0-T6, E0-T10, E0-T15, E0-T9, E0-T11, E0-T16b | po T14b; T16b także po T17 i T16a | tak |
| E | E0-T7a, E0-T7b | po T16b (T7b także po T15) | tak |

5 grup. Ścieżka krytyczna: T2 → T13 → T5/T12 → T3 → T14b → T16b → T7a/T7b.
Wynik T17 musi być znany przed T16b. Przy porażce orkiestrator idzie z PB-1 do użytkownika, zanim zacznie się grupa D.

## Plan testów

Legenda: **U** unit (vitest, `npm test`), **E2E** Playwright Chromium (`npm run test:e2e`), **WL** `web-ext lint`
w `npm run lint`, **QA-C** / **QA-F** QA ręczne Chrome / Firefox, **R** review / skrypt w E0-R1.

| AC | Poziom | Test / zadanie |
|---|---|---|
| AC-1.1 | E2E + U + QA-F | `smoke: one json downloaded and status contains its filename` (T7a); `success message contains the file name`, `returns success with fileName` (T5, T3); QA-F na `basic.html` |
| AC-1.2 | E2E + U + QA-F | `failure: error status in Polish, no success text, no download` (T7a); `returns failed on snapshot-failed…` (T3); QA-F z `throw-on-snapshot.html` |
| AC-1.3 | E2E + U + QA-F | `restricted: chrome://version … within 2 s` (T7a); `classifyUrl` (T12); `returns restricted for chrome://` (T3); QA-F `about:addons` i addons.mozilla.org |
| AC-1.4 | U | `messages contain no forbidden words` (T5) |
| AC-1.5 | E2E + U + QA-F | `double click: … exactly once` (T7b); `second snapshot … does not inject files again` (T3) |
| AC-1.6 | QA-C + U | QA-C `file://` z wyłączoną i włączoną zgodą; `returns fileAccess …` (T3), `mapInjectionError` (T12), `fileAccess message names the Chrome setting` (T5) |
| AC-2.1 | U | `sources have no broad host permissions`, `…no web_accessible_resources`, `permissions subset` (T4); `dist manifests have no broad host permissions nor WAR` (T14b) |
| AC-2.2 | QA-C + QA-F | `chrome://extensions` → Szczegóły → Dostęp do witryn; `about:addons` → Uprawnienia |
| AC-2.3 | E2E | `smoke: no chrome-extension script nodes added and no leftover nodes` (T7a) |
| AC-2.4 | E2E + QA-F | `csp strict page: download and success` (T7b); QA-F na `csp-strict.html` (ryzyko R6) |
| AC-2.5 | U | `inject.js absent in src and both targets` (T14b) |
| AC-3.1 | QA (Q1) + U | Q1: świeży klon → `npm ci && npm run lint && npm test && npm run test:e2e` = 0; `lint script runs eslint and web-ext lint` (T2) |
| AC-3.2 | QA (Q1) + konfiguracja | czasy z wyjścia vitest/Playwright w Q1; vitest bez przeglądarki (środowisko node/jsdom), e2e z lokalnym serwerem i headless |
| AC-3.3 | E2E | `loads extension from dist/chrome` (T16b) |
| AC-3.4 | E2E | `globalTeardown` porównuje `git status --porcelain` (T16b) |
| AC-3.5 | QA (Q1) | odwrócona asercja w teście `safeSlice` (T8) → kod ≠ 0, cofnięcie zmiany |
| AC-4.1 | U | `build is deterministic`, `build removes stale files` (T14b) |
| AC-4.2 | U | `every dist file is reachable and every reference exists` (T14b), walker (T14a) |
| AC-4.3 | U | `dist contains no forbidden files` (T14b), `zip contains no forbidden files` (T15) |
| AC-4.4 | U | `each target is under 500 KB` (T14b) |
| AC-4.5 | U + E2E + WL | `creates exactly two zips…`, `zip has manifest.json at root`, `unzipped content equals dist` (T15); `packed chrome zip loads and passes smoke` (T7b); WL na `dist/firefox` ≡ zawartość zipa |
| AC-4.6 | U | `has no dependencies section`, `has web-ext … no sharp` (T2) |
| AC-4.7 | U | `icons are PNG with exact sizes`, `icons total ≤ 50 KB`, `no logo*.png in dist` (T6) |
| AC-4.8 | U | `overlays only use allowed target keys`, `firefox strict_min_version is 128.0` (T4); `manifests identical except target keys`, `fails on extra difference` (T10); `mergeManifest throws…` (T14a) |
| AC-5.1 | U | `current index has no forbidden paths` (T1) |
| AC-5.2 | R | `npm run check:history` + `git ls-remote origin main` po force pushu (E0-R1); logika `forbiddenInHistory` (T1, U) |
| AC-5.3 | U + QA (Q1) | `no tracked files under page-debug-extension/` (T13), `current index has no forbidden paths` (T1); Q1: `ls` katalogu po klonie |
| AC-5.4 | U | `tests contain no production domains` (T1) |
| AC-5.5 | QA (DOC1/Q1) + U | treść README według checklisty AC (Docs), pomiar „≤ 10 min z README” przez QA; sekcja Uprawnienia testowana (T4) |
| AC-5.6 | U | `.gitignore contains src/icons/logo*.png` (T1) |
| AC-6.1 | U | `deepMerge …` ×4 (T8) |
| AC-6.2 | U | `safeSlice …` ×3 (T8) |
| AC-6.3 | U | `pushLimited drops oldest…` (T8) |
| AC-6.4 | U | `safeJson …` ×6, w tym znane dziwactwo (T8) |
| AC-6.5 | E2E | `smoke: package top-level keys and version 1.0.0` (T7a) |
| AC-7.1 | QA-C + U | `.ps1 -Browser chrome` i `npm run dev:chrome`: tymczasowy profil, rozszerzenie z `dist/chrome`; profil użytkownika nietknięty |
| AC-7.2 | QA-F | `.ps1 -Browser firefox`: web-ext run z `dist/firefox`, ikona na pasku (ewentualnie przypięcie, ryzyko R7) |
| AC-7.3 | QA-C/QA-F + U | `npm run dev:chrome` / `dev:firefox` ≤ 60 s stoperem; Linux: deklaratywnie (brak `.ps1` w ścieżce) + `parseArgs` (T11) |
| AC-7.4 | U + QA | `cli exits with code 2 for unknown browser` (T11); `.ps1 -Browser opera` → kod ≠ 0 (QA) |
| AC-ST.1 | U + R | `description is a single sentence` (T4); ocena single purpose w E0-R2 |
| AC-ST.2 | U | `no remote code` (T14b) |
| AC-ST.3 | U | `README Uprawnienia section mentions every permission` (T4) |
| AC-ST.4 | U | `gecko id is email-like or braced GUID` (T4, T10) |

NFR: rozmiar zipów (`zip size ≤ target dir size`, T15); czas build < 10 s (wyjście CLI, Q1); `npm test` ≤ 30 s i e2e ≤ 3 min (Q1);
zrzut +≤ 20 % (T17 baseline, pomiar `perf` w T7a, porównanie w qa-report); Firefox promise-only i bez `importScripts`
(`no callbacks or importScripts in src`, T14b + reguła eslint).

QA ręczne w Firefoksie (E0-Q2): `npm run fixtures` w jednym terminalu, w drugim `npm run dev:firefox -- --url http://127.0.0.1:8080/basic.html`.
Scenariusze: AC-1.1, 1.2, 1.3 (`about:addons`), 1.5, 2.2, 2.4. Dodatkowo `file://` w Firefoksie (sprawdzić, który komunikat się pojawia; to nie jest AC, tylko wpis do qa-report).

## Odrzucone zadania z backlogu
- Brak odrzuconych. Zmiany zakresu względem treści backlogu:
  - **E0-T2**: „`sharp` → devDependencies” zastąpione „`sharp` usunięty” (decyzja 2 bramki Spec). Skrypt ikon poza zakresem.
  - **E0-D1**: `scripts/` nie zawiera narzędzia ikon (decyzja 2).
  - **E0-T4** scalone z podziałem manifestu (oba dotykają tych samych plików). Usunięcie `web_accessible_resources` z E0-T3 też trafia do T4.
  - **E0-T6** ograniczone do testu (logo usunięte wcześniej).
  - **E0-T1** ograniczone do `.gitattributes`, poprawki ścieżki w `.gitignore`, `check-repo.mjs` i weryfikacji historii po force pushu.

## Ryzyka techniczne i jak je wykryjemy wcześnie

| # | Ryzyko | Wczesny sygnał | Reakcja |
|---|---|---|---|
| R1 | `activeTab` nie da się nadać w Playwright (brak `Extensions.triggerAction` lub nie działa headless) | spike E0-T17 czerwony | PB-1: ścieżka (b) po zgodzie użytkownika; inaczej e2e AC-1.x → QA-C |
| R2 | Bez service workera brak łatwego ID rozszerzenia w e2e | T17 `extension id resolved without service worker` czerwony | CDP `Extensions.loadUnpacked` (zwraca ID); ostatecznie ID z hasha ścieżki z testem na Windows |
| R3 | Chrome stable ignoruje `--load-extension` (≥ 137), a web-ext nie ładuje do Chrome z marką | T11: okno Chrome bez ikony rozszerzenia | `PDS_CHROMIUM_BINARY` / Chromium z Playwright (D11); README opisuje ręczne „Załaduj rozpakowane” |
| R4 | `web-ext lint` daje errors na `data_collection_permissions` lub kombinacji z `strict_min_version` | T9: `npm run lint` czerwony tylko w kroku web-ext | zmiana kształtu klucza według komunikatu lintera. Klucz jest wymagany przez AMO dopiero przy publikacji (E5), więc w ostateczności przesuwamy go do E5 decyzją w state.md |
| R5 | Popup zamyka się, gdy Chrome pokazuje bańkę pobierania, i zgłaszający nie widzi wyniku | QA-C AC-1.1: brak komunikatu po kliknięciu, plik jest | odnotować w qa-report; trwałe rozwiązanie w E1 (stan w tle, popup pyta `getStatus`) |
| R6 | Firefox stosuje CSP strony do skryptów MAIN wstrzykiwanych przez `files` | QA-F AC-2.4 czerwony | `func` z kodem zamiast `files` nie pomoże (ten sam mechanizm). Zgłosić jako znane ograniczenie Firefoksa, decyzja użytkownika |
| R7 | Przycisk MV3 w Firefoksie domyślnie ukryty w menu rozszerzeń, a nie na pasku | QA-F AC-7.2 | README: „przypnij przez ikonę puzzla”. Ewentualnie `action.default_area` w bazie, jeśli Chrome go zignoruje bez ostrzeżenia (wymaga zmiany AC-4.8, bo ten klucz w `action` musi być wspólny) |
| R8 | Helper ładujący IIFE w jsdom: `window` ≠ `globalThis` w danej wersji vitest | T8 `loader exposes PageDebugSnapshot` czerwony | `window.eval(src)` lub `vm.runInContext` z kontekstem jsdom |
| R9 | Teksty wyjątków `executeScript` różnią się między wersjami | QA wyświetla `failed` zamiast `restricted` na stronie specjalnej | dopisać wzorzec w `target.js` + przypadek w tabeli testu. Fail-safe: zawsze komunikat PL, nigdy sukces |
| R10 | Node 26 poza zakresem `engines` którejś devDependency | T2: `EBADENGINE` przy `npm ci` | przypiąć wersję zgodną albo udokumentować Node LTS (22/24) w README jako wymaganą |
| R11 | Niedeterminizm buildu przez CRLF między platformami | test hashy różny między klonami Windows i Linux (CI w E5) | `.gitattributes` (D13) |
