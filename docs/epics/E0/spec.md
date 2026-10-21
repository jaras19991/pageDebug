# E0 — Fundament: repo, build, testy, higiena MV3 (Chrome + Firefox)

## Problem
Rozszerzenie nie ma testów, lintera ani buildu: katalog `page-debug-extension/` jest jednocześnie
źródłem, paczką i miejscem na `node_modules/` (sharp z natywnymi binarkami), `logo.png` (~4,4 MB)
i stare `page-debug-extension.zip` — stąd `.crx` ~13 MB. `popup.js` pokazuje „Snapshot został
uruchomiony i pobrany.” zaraz po wstrzyknięciu `inject.js`, a błąd wewnątrz `inject.js` trafia tylko
do konsoli strony, więc zgłaszający widzi sukces, którego nie było. `inject.js` dokleja do strony
`<script src="chrome-extension://…">`, co wymaga `web_accessible_resources` i `host_permissions: <all_urls>`.
Celem E0 jest też jedna baza kodu budowana do dwóch targetów MV3: Chrome i Firefox.

### Stan faktyczny repo (aktualizacja 2026-10-21, po bramce Spec)
- Git: `origin` = GitHub. Historia przepisana lokalnie (amend): HEAD `411f60e` nie zawiera `logo.png`
  ani `logo-640.png`. **Force push wykonuje użytkownik** (`git push --force-with-lease origin main`) —
  do tego czasu `origin/main` = `f139411` z logo. AC-5.2 weryfikuje stan po pushu w E0-R1.
- `.gitignore` ignoruje: `*.pem`, `*.crx`, `*.zip`, `dist/`, `node_modules/`,
  `page-debug-snapshot-*.json|zip`, `test-results/`, `playwright-report/`, `coverage/`,
  `.claude/settings.local.json`, `page-debug-extension/icons/logo*.png`.
- Śledzone: `CLAUDE.md`, `README.md` (1 linia), `docs/`, `.claude/agents|skills`, `.gitignore`,
  w `page-debug-extension/`: `manifest.json`, `popup.html`, `popup.js`, `inject.js`,
  `page-debug-snapshot.js`, `console-snapshot.js`, `package.json`, `package-lock.json`, `icons/icon16|48|128.png`.
- Nowe w drzewie roboczym, nieśledzone (powstają równolegle): `.claude/skills/pds-browser/`,
  `scripts/dev-browser.ps1` (zastąpił `dev-chrome.ps1`), `.claude/agents/pds-store-reviewer.md`.
- Na dysku, ignorowane: `page-debug-extension/node_modules/`, `page-debug-extension/page-debug-extension.zip`,
  w root `page-debug-extension.zip`, `page-debug-extension.crx`, `page-debug-snapshot-1792487181606.json`
  (prawdziwe dane z gazeta.pl: cookies, storage) oraz `page-debug-extension.pem` (nigdy nie commitowany;
  użytkownik przenosi go sam poza repo — decyzja 7).
- `package.json` ma `sharp` w `dependencies` i zero skryptów. `console-snapshot.js` to kopia
  logiki `page-debug-snapshot.js` (te same `deepMerge`, `safeSlice`, `pushLimited`, `safeJson`).

## Non-goals
- Model nagrywania od startu strony, tło rozszerzenia (service worker / event page), stany popupu
  *Gotowy/Nagrywam/Zapisano* — E1. Build ma jedynie przewidywać różne klucze `background.*` per target.
- Redakcja danych wrażliwych i zmniejszanie paczki snapshotu (`outerHTML`, cookies, storage) — E3.
- Zmiana zawartości/struktury paczki snapshotu, `schemaVersion`, format `.zip` paczki — E2/E3.
- Przeprojektowanie UI popupu i tekstów poza komunikatami wyniku (US-1) — E1-T6.
- CI w chmurze, podpisany `.crx`, publikacja w Chrome Web Store, polityka min. wersji Chrome — E5.
- Podpis przez AMO i plik `.xpi` (wymagany w Firefoksie nawet przy self-hostingu) — E5.
- Automatyczny e2e w Firefoksie (Selenium + geckodriver, tymczasowa instalacja `.xpi`) — E5;
  w E0 Firefox = `web-ext lint` + ręczne QA.
- Refaktor `page-debug-snapshot.js` na moduły i ujednolicenie z `console-snapshot.js` — E1-T3/E1-T7.

## User stories

### US-1 (Zgłaszający) Jako zgłaszający chcę widzieć w okienku rozszerzenia prawdziwy wynik, żeby nie wysłać developerowi „niczego”, myśląc, że plik się zapisał
- **AC-1.1** Given strona fixture `basic.html`, When zgłaszający klika przycisk w popupie, Then
  pobrany zostaje dokładnie 1 plik `.json`, a popup pokazuje komunikat sukcesu po polsku, który zawiera
  nazwę tego pliku (e2e: tekst statusu zawiera `download.suggestedFilename()`).
- **AC-1.2** Given strona, na której zrzut kończy się wyjątkiem (wymuszonym w fixture), When klik,
  Then popup **nie** pokazuje sukcesu, pokazuje komunikat błędu po polsku i nie zostaje pobrany żaden plik (e2e).
- **AC-1.3** Given karta `chrome://…` lub strona Chrome Web Store, When klik, Then popup pokazuje
  „Na tej stronie nie da się zapisać paczki.” (lub tekst zatwierdzony w design) w ≤ 2 s (e2e dla
  `chrome://version`; Firefox: `about:addons`, QA ręczne).
- **AC-1.4** Komunikaty widoczne dla zgłaszającego nie zawierają słów: `executeScript`, `inject`,
  `undefined`, `Error:`, `stack`, `PageDebugSnapshot` (unit test na słowniku komunikatów popupu).
- **AC-1.5** Given ta sama karta, When zgłaszający klika dwa razy, Then powstają 2 pliki, oba
  komunikaty są sukcesem, a `console.log('marker')` wywołany na stronie między kliknięciami występuje
  w `consoleLogs` drugiego pliku **dokładnie raz** (brak podwójnej instalacji hooków; e2e).
- **AC-1.6** Given strona `file://` i wyłączona zgoda „Zezwalaj na dostęp do adresów URL plików”,
  When klik, Then popup pokazuje polski komunikat, jak tę zgodę włączyć, i nie pokazuje sukcesu
  (QA ręczne w Chrome; z włączoną zgodą zrzut działa jak na zwykłej stronie).

### US-2 (Zgłaszający) Jako zgłaszający chcę zainstalować rozszerzenie, które nie prosi o dostęp do wszystkich moich stron i nie zostawia śladów na stronie, żeby nie bać się, że coś „zepsuję” albo wyślę za dużo
- **AC-2.1** Oba manifesty, `dist/chrome/manifest.json` i `dist/firefox/manifest.json` (oraz pliki
  źródłowe manifestu), nie zawierają `host_permissions` z `<all_urls>`, `*://*/*`, `http://*/*` ani
  `https://*/*` i nie zawierają klucza `web_accessible_resources`; `permissions` ⊆ {`activeTab`, `scripting`} (unit test).
- **AC-2.2** QA ręczne: po załadowaniu `dist/chrome` na czystym profilu `chrome://extensions` → Szczegóły
  → „Dostęp do witryn” nie pokazuje dostępu do wszystkich witryn; po załadowaniu `dist/firefox`
  `about:addons` → Uprawnienia nie pokazuje dostępu do danych na wszystkich stronach.
- **AC-2.3** Given `basic.html` z `MutationObserver` zapisującym dodane węzły, When klik, Then
  żaden dodany węzeł nie jest `<script>` z `src` zaczynającym się od `chrome-extension://`, a po
  zakończeniu w DOM nie ma elementów dodanych przez rozszerzenie (brak pływającego przycisku; e2e).
- **AC-2.4** Given strona fixture z nagłówkiem `Content-Security-Policy: script-src 'self'`, When klik,
  Then plik zostaje pobrany i popup pokazuje sukces (e2e).
- **AC-2.5** Plik `inject.js` nie istnieje w `dist/chrome`, `dist/firefox` ani w źródłach rozszerzenia.

### US-3 (Developer) Jako developer chcę na czystym klonie jedną komendą uruchomić testy i lint, żeby każdy kolejny epik miał gdzie dopisać test najpierw
- **AC-3.1** Given świeży `git clone` i wersja Node z README, When z katalogu głównego
  `npm ci && npm run lint && npm test && npm run test:e2e`, Then wszystkie kończą się kodem 0 bez
  ręcznych kroków (poza jednorazową instalacją przeglądarki Playwright, opisaną w README).
  `npm run lint` obejmuje eslint **oraz** `web-ext lint` na `dist/firefox`: kod 0, zero errors;
  warnings dopuszczalne, ale wypisane na wyjściu.
- **AC-3.2** `npm test` nie wymaga przeglądarki ani sieci i trwa ≤ 30 s; `npm run test:e2e` nie
  wymaga internetu (fixture serwowane lokalnie), działa w trybie headless i trwa ≤ 3 min.
- **AC-3.3** e2e (Chromium, Playwright) ładuje rozszerzenie z `dist/chrome` (wynik `npm run build`), nie ze źródeł.
- **AC-3.4** Testy e2e nie zapisują plików w katalogu Pobrane użytkownika ani w śledzonych katalogach repo
  (`git status` po `npm run test:e2e` jest czysty).
- **AC-3.5** Celowo zepsuty test (np. odwrócona asercja w `safeSlice`) powoduje kod wyjścia ≠ 0 `npm test` (QA ręczne, jednorazowo).

### US-4 (Developer) Jako developer chcę zbudować minimalną paczkę rozszerzenia jedną komendą, żeby zgłaszający dostał mały, czysty plik bez naszych narzędzi
- **AC-4.1** `npm run build` tworzy `dist/chrome/` i `dist/firefox/` od zera (usuwa poprzednią
  zawartość); dwa kolejne buildy dają dla obu targetów identyczną listę plików i identyczne sumy SHA-256.
- **AC-4.2** Każdy plik w `dist/chrome/` i `dist/firefox/` jest osiągalny z manifestu danego targetu
  (bezpośrednio, przez `popup.html` lub jako plik wstrzykiwany) i każdy referencjonowany plik istnieje (test automatyczny).
- **AC-4.3** Żaden target w `dist/` nie zawiera: `node_modules/`, `*.pem`, `*.crx`, `*.zip`, `package*.json`,
  `logo*.png`, `console-snapshot.js`, katalogów testów ani skryptów narzędziowych.
- **AC-4.4** Rozmiar każdego targetu (`dist/chrome/`, `dist/firefox/`) < 500 KB (test automatyczny).
- **AC-4.5** `npm run pack` tworzy **dwa** `.zip` (po jednym na target, manifest w korzeniu zipa);
  nazwa każdego zawiera target i wersję z manifestu; zip Chrome po rozpakowaniu i „Load unpacked”
  przechodzi smoke e2e; zip Firefox przechodzi `web-ext lint` bez errors.
- **AC-4.6** `package.json` nie ma sekcji `dependencies`; `web-ext` jest w `devDependencies`; `sharp`
  usunięty całkowicie (brak skryptu ikon — decyzja 2).
- **AC-4.7** Ikony 16/48/128 w repo są jedynym źródłem (bez pliku logo i bez generowania). Test na
  `dist/*/icons`: dokładnie 16×16, 48×48, 128×128 px, PNG, łącznie ≤ 50 KB (dziś 37 KB).
- **AC-4.8** Oba manifesty mają identyczne `version`, `name`, `description`, `permissions`, `action`,
  `icons`; różnią się wyłącznie kluczami specyficznymi dla targetu (`browser_specific_settings`,
  `minimum_chrome_version`, w przyszłości `background.*`). Test automatyczny porównuje manifesty
  i failuje przy każdej innej różnicy. `dist/firefox/manifest.json` ma
  `browser_specific_settings.gecko.strict_min_version` = `"128.0"`.

### US-5 (Developer) Jako developer chcę jasnej definicji, co jest w repo, co w paczce, a co nigdy nigdzie, żeby nikt przypadkiem nie wysłał klucza ani danych z prawdziwej strony (E0-S1)

| Kategoria | W repo (śledzone) | W `dist/*` / zipie | Ignorowane, nigdy w repo |
|---|---|---|---|
| Kod runtime rozszerzenia (manifesty, popup, skrypt zrzutu) | tak | tak | — |
| Ikony 16/48/128 | tak | tak | — |
| Źródłowe logo | **brak** — usunięte (decyzja 2); ikony 16/48/128 są jedynym źródłem | — | `page-debug-extension/icons/logo*.png` (blokada przed przypadkowym powrotem) |
| `console-snapshot.js` (fallback do konsoli) | tak | nie | — |
| Testy, fixture, skrypty narzędziowe, konfiguracja lint/test | tak | nie | — |
| `package.json`, `package-lock.json` | tak (root) | nie | — |
| `docs/`, `CLAUDE.md`, `.claude/agents`, `.claude/skills` | tak | nie | — |
| Klucz `*.pem` | nie | nie | tak (i poza katalogiem repo) |
| `dist/chrome/`, `dist/firefox/`, oba zipy z `npm run pack` | nie | — | tak |
| `*.crx`, `*.xpi`, `node_modules/` | nie | — | tak |
| Prawdziwe snapshoty (`page-debug-snapshot-*.json|zip`) | nie | nie | tak |
| Wyniki testów (`test-results/`, `playwright-report/`, `coverage/`) | nie | nie | tak |
| `.claude/settings.local.json` | nie | nie | tak |

- **AC-5.1** `git ls-files` nie zwraca żadnej ścieżki pasującej do kolumny „Ignorowane” (test/skrypt sprawdzający).
- **AC-5.2** `git log --all --name-only` nie zawiera żadnego pliku `*.pem`, `*.crx`, `*.xpi`, `*.zip`,
  `logo.png`, `logo-640.png`, `page-debug-snapshot-*.json` ani ścieżki z `node_modules/` (weryfikacja w E0-R1).
- **AC-5.3** Na czystym klonie katalog kodu rozszerzenia nie zawiera `logo.png`, `logo-640.png`, `node_modules/`, `*.zip`.
- **AC-5.4** Fixture zawierają wyłącznie dane syntetyczne; `rg` po `tests/` nie znajduje domen
  produkcyjnych z przykładowego snapshotu (np. `gazeta.pl`).
- **AC-5.5** README (E0-DOC1) zawiera: wymaganą wersję Node, komendy z AC-3.1, `build`, `pack`,
  ładowanie unpacked z `dist/chrome`, ładowanie tymczasowe w Firefoksie (`about:debugging` → „Ten
  Firefox” → „Załaduj tymczasowy dodatek” z `dist/firefox`) z informacją, że znika po restarcie
  przeglądarki, generowanie ikon, sekcję „Uprawnienia” (AC-ST.3) oraz zdanie „klucz `.pem` trzymamy
  poza repo”. QA: developer bez wiedzy o projekcie dochodzi od klonu do załadowanego rozszerzenia w ≤ 10 min, tylko z README.
- **AC-5.6** `.gitignore` zawiera wpis `page-debug-extension/icons/logo*.png` (lub równoważny po E0-D1).

### US-6 (Developer) Jako developer chcę, żeby istniejąca logika pomocnicza była przykryta testami, a paczka po E0 wyglądała tak samo jak przed, żeby refaktor w E1 nie zgubił niczego po cichu
Testy dotyczą tylko pliku rozszerzenia; `console-snapshot.js` bez zmian (decyzja 6).
- **AC-6.1** `deepMerge`: zagnieżdżone obiekty łączone, tablice zastępowane, `null`/nie-obiekt jako
  źródło zwraca kopię celu, cel nie jest mutowany.
- **AC-6.2** `safeSlice`: string ≤ limit bez zmian; dłuższy obcięty z sufiksem `... [truncated N chars]`
  z poprawnym N; nie-string zwrócony bez zmian.
- **AC-6.3** `pushLimited`: po przekroczeniu `max` usuwany jest najstarszy element, długość = `max`.
- **AC-6.4** `safeJson`: funkcja → `[Function: name]`/`anonymous`; `Error` → `{name, message, stack}`;
  element DOM → `{tagName, id, className, outerHTML}` z `outerHTML` ≤ 2000 znaków + sufiks;
  cykl → `[Circular]`; `BigInt` → obiekt z `serializationError` i `fallback`. Obecne dziwactwo
  (ten sam obiekt użyty dwa razy bez cyklu → `[Circular]`) utrwalone testem z komentarzem, nie poprawiane w E0.
- **AC-6.5** Regresja paczki: plik z smoke e2e ma dokładnie te klucze najwyższego poziomu co
  przykładowy snapshot: `version`, `collectedAt`, `initializedAt`, `notes`, `environment`, `dom`,
  `performance`, `storage`, `consoleLogs`, `runtimeErrors`, `network`; `version === "1.0.0"`.

### US-7 (Developer) Jako developer chcę jedną komendą uruchomić rozszerzenie w Chrome albo Firefoksie na osobnym profilu, żeby sprawdzić zmianę w obu w minutę
- **AC-7.1** Na Windows `scripts/dev-browser.ps1 -Browser chrome` buduje projekt i otwiera Chrome na
  osobnym, tymczasowym profilu z załadowanym `dist/chrome`; profil użytkownika nie jest modyfikowany (QA ręczne).
- **AC-7.2** `scripts/dev-browser.ps1 -Browser firefox` buduje projekt i uruchamia Firefox na
  osobnym profilu przez `web-ext run --source-dir dist/firefox`; rozszerzenie widoczne na pasku (QA ręczne).
- **AC-7.3** Istnieje odpowiednik npm script dla obu przeglądarek (działa też na Linux); od komendy
  do okna przeglądarki z rozszerzeniem ≤ 60 s na maszynie developerskiej (QA ręczne, pomiar stoperem).
- **AC-7.4** Nieznana wartość `-Browser` kończy skrypt kodem ≠ 0 z komunikatem o dozwolonych wartościach.

## Zgodność ze sklepami (Chrome Web Store, AMO) — zakres E0
Pełny audyt sklepowy robi agent `pds-store-reviewer` w fazie Review; tu tylko to, co sprawdzalne już w E0.
- **AC-ST.1** `description` w manifeście to jedno zdanie opisujące jeden cel (single purpose):
  bez średnika i bez drugiego zdania (unit test: jedno zakończenie zdania) + ocena w review.
- **AC-ST.2** Brak zdalnie ładowanego kodu: w `dist/*` żaden `<script src="http…">` ani import
  z URL `http(s)://`, brak `eval(` i `new Function(` (test grep po `dist/chrome` i `dist/firefox`).
- **AC-ST.3** Każde uprawnienie z `permissions` ma jednolinijkowe uzasadnienie w README w sekcji
  „Uprawnienia” (test: każdy klucz z manifestu występuje w tej sekcji).
- **AC-ST.4** `dist/firefox/manifest.json` ma `browser_specific_settings.gecko.id` w formacie
  e-mail-like (`nazwa@domena`) lub GUID w nawiasach klamrowych (unit test regex).

## Wymagania niefunkcjonalne
- **Rozmiar:** każdy target w `dist/` < 500 KB; każdy zip z `npm run pack` ≤ rozmiar swojego targetu.
- **Czas:** `npm test` ≤ 30 s, `npm run test:e2e` ≤ 3 min, `npm run build` (oba targety) ≤ 10 s.
  Czas wykonania zrzutu na `basic.html` nie rośnie o więcej niż 20% względem obecnego (e2e, mediana z 5).
- **Prywatność:** E0 nie zmienia zawartości paczki — dane wrażliwe (cookies, storage, wartości pól)
  nadal są w niej jawnie; redakcja to E3, świadomie zaakceptowane. E0 zmniejsza powierzchnię ryzyka:
  brak `<all_urls>`, brak ujawniania ID rozszerzenia stronom, brak zdalnego kodu, klucz `.pem`
  i prawdziwe snapshoty poza repo (AC-2.1, AC-2.3, AC-5.1–5.4, AC-ST.2). Rozszerzenie nie wysyła nic do sieci.
- **Chrome:** e2e na Chromium z Playwright (aktualny stable), headless. Polityka minimalnej wersji
  Chrome — E5-S2; ewentualna wartość `minimum_chrome_version` w E0 ustalana w Design.
- **Firefox:** ≥ 128 (`strict_min_version`), statyczny `web-ext lint` w `npm run lint`, QA ręczne
  na aktualnym Firefox stable. Kod tylko z API opartym na promisach, bez callbacków i bez `importScripts`
  (sprawdzalne lintem/grepem).
- **Platformy developerskie:** komendy z AC-3.1 i AC-7.3 działają na Windows 11 i Linux.

## Dane — zmiany w schemacie paczki
Bez zmian w schemacie. Paczka pozostaje `schemaVersion: 1` w rozumieniu skilla `snapshot-schema`
(pole `version: "1.0.0"`, bez `schemaVersion`); AC-6.5 pilnuje, że E0 jej nie zmienia.
Nazwa pobieranego pliku (`page-debug-snapshot-<timestamp>.json`) bez zmian, w obu przeglądarkach.

## Decyzje z bramki Spec (użytkownik, 2026-10-21)
1. **Historia gita:** przepisana — `logo.png` i `logo-640.png` usunięte z commita (amend + force push
   przez orkiestratora). `.gitignore` ignoruje `page-debug-extension/icons/logo*.png`. Weryfikacja: AC-5.2, AC-5.6.
2. **Źródłowe logo:** **usunięte z dysku** (2026-10-21, decyzja użytkownika: „żadnego nie potrzebuję”).
   Ikony 16/48/128 w `icons/` są jedynym źródłem; skrypt generowania ikon i `sharp` poza zakresem.
   Nowa ikona (np. do sklepu w E5) = nowy plik od użytkownika. Wpis w `.gitignore` zostaje jako blokada.
3. **`.crx`:** nie w E0, tylko `.zip`. Podpisy (`.crx`, `.xpi`) — E5.
4. **`file://`:** utrzymać, z polskim komunikatem przy braku zgody (AC-1.6).
5. **CI:** lokalnie w E0; e2e musi działać headless; CI w E5.
6. **`console-snapshot.js`:** bez zmian; testy tylko dla pliku rozszerzenia.
7. **`.pem`:** użytkownik przenosi sam poza repo; AC sprawdzają indeks i historię (AC-5.1, AC-5.2).

## Ryzyka
1. **Rozszerzenie MV3 niestabilne w Playwright (popup bez aktywnej karty).**
   Sygnał: smoke e2e przechodzi < 9/10 uruchomień z rzędu albo ktoś dodaje `retries` bez komentarza.
2. **Zmiana sposobu wstrzykiwania zmienia zachowanie zrzutu** (podwójne hooki, inna pora wykonania).
   Sygnał: AC-1.5 lub AC-6.5 czerwone, różnice kluczy/duplikaty w `consoleLogs`.
3. **Usunięcie `<all_urls>` odcina przypadek, którego nie znamy** (iframe'y, `file://`).
   Sygnał: QA lub zgłaszający widzi błąd uprawnień na stronie, gdzie wcześniej zrzut działał.
4. **Brak źródła ikon.** Zmiana wyglądu lub nowe rozmiary (np. grafiki promocyjne do sklepów w E5) wymagają
   nowego pliku od użytkownika. Sygnał: E5-T3 potrzebuje grafiki, której nie da się wyprodukować z 128 px.
5. **Rozjazd `console-snapshot.js` z `page-debug-snapshot.js`.** Sygnał: `diff` funkcji pomocniczych niepusty po E0.
6. **Rozjazd manifestów Chrome/Firefox po ręcznej edycji jednego z nich.** Sygnał: test porównawczy AC-4.8 czerwony.
7. **`web-ext lint` zgłasza errors dla konstrukcji, które Chrome akceptuje.** Sygnał: `npm run lint`
   czerwony tylko w kroku dla `dist/firefox`.
