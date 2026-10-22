# E1 — Model nagrywania: dane od startu strony

## Problem
W E0 hooki na `console`/`fetch`/XHR/`error` instalują się w `src/page/page-debug-snapshot.js` w tej samej chwili,
w której `runInPage` (`src/popup/run-in-page.js`) robi zrzut — dlatego `consoleLogs`, `runtimeErrors` i `network`
są w trybie rozszerzenia prawie zawsze puste (QA E0: „pierwszy błąd… pusta tablica”), a jedynym wpisem w konsoli
jest własny log „PageDebugSnapshot initialized.”. Zapis idzie przez `<a download>` w stronie, więc popup nie zna
wyniku pobrania (re-QA E0, F3: 3× „Gotowe”, plik tylko z 1. kliknięcia). Hook XHR (`function DebugXHR`) łamie
`instanceof`, a pełna paczka zostaje w `window.__PAGE_DEBUG_SNAPSHOT__` dostępna skryptom strony. Popup nie ujawnia,
co trafia do pliku (blocker CWS ze store review E0).

## Non-goals
- CWV, kody HTTP z warstwy przeglądarki (`webRequest`), treść odpowiedzi, zrzut ekranu, kroki użytkownika,
  iframe'y — E2. E1 nie zmienia zakresu zbieranych kategorii danych poza oknem czasowym.
- Redakcja danych wrażliwych (cookies, storage, nagłówki `Authorization`, wartości pól, `outerHTML`), format `.zip`,
  zmniejszanie paczki — E3. Wyjątek przeniesiony do E1: usunięcie globala `__PAGE_DEBUG_SNAPSHOT__` (E3-T6).
- `summary.md`, viewer, MCP, przycisk *Wyślij* i adresat zgłoszenia — E4.
- Podpisy `.crx`/`.xpi`, publikacja w sklepach, polityka prywatności, listing, ikony — E5 (ikony bez zmian).
- Automatyczny e2e w Firefoksie — E5; w E1 Firefox = `web-ext lint` + QA ręczne wg listy z planu testów.
- Nagrywanie wielu kart jednocześnie i nagrywanie innej domeny niż ta z chwili kliknięcia *Nagrywaj*.
- Zmiana nazwy pliku paczki (`page-debug-snapshot-<timestamp>.json` zostaje do E3-T4).

## User stories

### US-1 (Zgłaszający) Jako zgłaszający chcę przed nagraniem wiedzieć, co trafi do pliku, i jednym kliknięciem zacząć nagrywanie, żeby nie bać się, że coś wyślę lub zepsuję
- **AC-1.1** Given popup otwarty na zwykłej stronie bez trwającego nagrania (stan *Gotowy*), Then nad przyciskiem
  *Nagrywaj* widoczna jest polska lista tego, co trafi do pliku: adres strony i dane przeglądarki; logi konsoli
  i błędy; zapytania sieciowe (adresy i nagłówki); treść i struktura strony, w tym wartości wpisane w formularze;
  ciasteczka i dane zapisane przez stronę — oraz zdanie „Plik zostaje na Twoim dysku, rozszerzenie niczego nie
  wysyła.” i informacja, że strona zostanie odświeżona (unit na słowniku/HTML popupu + e2e na widoczny tekst).
- **AC-1.2** Zanim zgłaszający kliknie *Nagrywaj*, rozszerzenie nie zbiera niczego: brak recordera na stronie,
  brak próśb o uprawnienia (e2e: `console.log('pre')` na stronie przed kliknięciem nie trafia do żadnej paczki).
- **AC-1.3** When klik *Nagrywaj* i zgoda na dostęp do strony (jeśli przeglądarka o nią pyta), Then karta
  przeładowuje się dokładnie raz, a popup (otwarty ponownie) pokazuje „Nagrywam od HH:MM:SS” z lokalnym czasem
  startu (e2e: jedno zdarzenie `load` po kliknięciu; tekst zgodny z regex `^Nagrywam od \d{2}:\d{2}:\d{2}`).
- **AC-1.4** Given zgłaszający odmawia zgody w oknie przeglądarki, Then popup pokazuje polski komunikat, że bez
  zgody nie da się nagrać tej strony, karta nie jest przeładowana i stan wraca do *Gotowy* (unit z odmową
  `permissions.request`; QA ręczne Chrome i Firefox).
- **AC-1.5** Given nagrywanie trwa, When zgłaszający zamyka i otwiera popup (także po wyładowaniu tła
  rozszerzenia), Then popup pokazuje ten sam czas startu i przycisk *Zapisz paczkę* (e2e Chromium z wymuszonym
  zatrzymaniem service workera; Firefox: QA ręczne po wyładowaniu event page w `about:debugging`).
- **AC-1.6** Given nagrywanie trwa, Then ikona rozszerzenia na tej karcie ma widoczne oznaczenie nagrywania,
  a na innych kartach — nie (e2e + QA ręczne w obu przeglądarkach).
- **AC-1.7** Strony specjalne i `file://` bez zgody: *Nagrywaj* na `chrome://version`, `about:addons`, sklepie
  CWS/AMO i `about:blank` daje komunikat `restricted` w ≤ 2 s, bez przeładowania; `file://` — patrz pytanie 2
  (e2e dla `chrome://version`; reszta QA ręczne). Regresja E0 AC-1.3/1.6 zielona.
- **AC-1.8** Wszystkie nowe teksty popupu są w `src/popup/messages.js` i przechodzą test słownika E0 AC-1.4
  (bez `executeScript`, `inject`, `undefined`, `Error:`, `stack`, `PageDebugSnapshot`); żaden przycisk nie ma
  angielskiej etykiety (unit na `popup.html`).
- **AC-1.9** Given nagrywanie trwa od 10 min (limit), Then rozszerzenie samo kończy nagrywanie: hooki zdjęte,
  bufory zachowane, kolejne dokumenty (przeładowanie) nie są nagrywane, a popup pokazuje
  „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.” z przyciskiem *Zapisz paczkę*. Limit da się skrócić tylko
  w testach (klucz w `storage.session`, niedostępny dla stron i content scriptów; wartość przycinana do ≤ 10 min);
  w UI zgłaszającego nie ma takiego ustawienia (unit z fałszywym zegarem; e2e z limitem 3 s; QA Firefox).

### US-2 (Zgłaszający) Jako zgłaszający chcę po odtworzeniu problemu kliknąć *Zapisz paczkę* i zobaczyć „Zapisano” tylko wtedy, gdy plik naprawdę jest na dysku, żeby nikt mnie potem nie dopytywał
- **AC-2.1** Given nagrywanie trwa, When klik *Zapisz paczkę*, Then popup pokazuje stan *Zapisano* z nazwą pliku
  dopiero, gdy przeglądarka zgłosi pobranie jako zakończone; e2e: nazwa w komunikacie = nazwa pobranego pliku,
  plik istnieje i jest poprawnym JSON.
- **AC-2.2** Given pobranie zostaje przerwane, zablokowane lub anulowane przez zgłaszającego (np. okno „Zapisz
  jako” zamknięte), Then popup **nie** pokazuje sukcesu, pokazuje polski komunikat z podpowiedzią, a nagranie
  trwa dalej — ponowne *Zapisz paczkę* zapisuje plik z tymi samymi wcześniejszymi wpisami (unit z symulowanym
  `interrupted`/anulowaniem; QA ręczne).
- **AC-2.3** Regresja F3 z re-QA E0: Chrome stable, „Automatyczne pobieranie” = Blokuj, 3 nagrania i zapisy
  bez interakcji ze stroną → liczba komunikatów *Zapisano* = liczba nowych plików w katalogu pobrań (QA ręczne
  z logiem jak `requa-chrome-f3.log`; Firefox analogicznie).
- **AC-2.4** Given zapis nie kończy się w 15 s (strona zawieszona, tło nie odpowiada, pobranie nie startuje),
  Then popup pokazuje komunikat `failed` (lub wariant „strona jeszcze się ładuje”), nigdy sukces (unit z
  fałszywym zegarem; e2e z fixture blokującą wątek strony).
- **AC-2.5** Po *Zapisano* rozszerzenie wraca do *Gotowy* dla tej karty: kolejne przeładowanie strony nie
  uruchamia recordera, a `console.log('after')` nie trafia do następnej paczki (e2e).
- **AC-2.6** Given karta nagrywana zostaje zamknięta albo przeglądarka zrestartowana, Then nagranie znika bez
  pliku, a ponowne otwarcie tej domeny nie uruchamia recordera (e2e dla zamknięcia karty; restart — QA ręczne).

### US-3 (Zgłaszający) Jako zgłaszający chcę, żeby rozszerzenie prosiło tylko o dostęp do strony, którą nagrywam, i nie zostawiało po sobie śladów, żeby zainstalować je bez obaw
- **AC-3.1** `permissions` w obu manifestach ⊆ {`activeTab`, `scripting`, `storage`, `downloads`}; brak `tabs`,
  `webRequest`, `cookies`; `host_permissions` brak lub puste; `optional_host_permissions` = dokładnie {`http://*/*`, `https://*/*`, `file:///*`} (decyzje 1 i PB-1 A)
  (unit; zastępuje E0 AC-2.1 w części `permissions`). Brak `<all_urls>` i `web_accessible_resources` — bez zmian.
- **AC-3.2** Prośba o dostęp przy *Nagrywaj* dotyczy wyłącznie origin bieżącej karty (unit: argument
  `permissions.request` = dokładnie jeden wzorzec `<scheme>://<host>[:port]/*` z URL karty).
- **AC-3.3** Dane z innych kart tego samego origin otwartych w czasie nagrywania nie trafiają do paczki (e2e: dwie
  karty, marker w karcie B nieobecny w paczce z karty A).
- **AC-3.4** Strona przechodząca w trakcie nagrywania na inny origin nie jest nagrywana; popup po powrocie na
  kartę mówi po polsku, że nagranie obejmuje tylko pierwotną stronę (e2e z dwoma originami 127.0.0.1/localhost).
- **AC-3.5** Każde nowe uprawnienie ma w README sekcji „Uprawnienia” jednolinijkowe uzasadnienie PL i EN
  (test E0 AC-ST.3 obejmuje nowe klucze; teksty bazowe z `docs/epics/E0/store-review.md`).

### US-4 (Developer) Jako developer chcę w paczce widzieć błędy, logi i zapytania z całego życia strony z czasem względem `timeOrigin`, żeby w ≤ 60 s wiedzieć, co się zepsuło i kiedy
- **AC-4.1** Fixture rzuca błąd w inline `<script>` w `<head>` i robi `fetch` z odpowiedzią 500 przed
  `DOMContentLoaded` → paczka ma oba wpisy w `runtimeErrors` i `network`, z `t` < `performance.navigation`
  `domContentLoadedEventStart` tego dokumentu (e2e).
- **AC-4.2** `unhandledrejection` z `<head>` i `console.error` z `<head>` są w paczce (e2e, ta sama fixture).
- **AC-4.3** SPA: po `history.pushState`/`replaceState`/`popstate` nagranie trwa; `console.log('spa-marker')`
  po `pushState` jest w paczce dokładnie raz (e2e).
- **AC-4.4** Pełne przeładowanie w obrębie origin w trakcie nagrywania: błąd i marker z nowego dokumentu są
  w paczce; wpisy z poprzedniego dokumentu są w paczce **albo** `notes` jawnie mówi, że zostały pominięte i ile
  ich było (e2e; wybór — Design E1-D4).
- **AC-4.5** Każdy rekord w `consoleLogs`, `runtimeErrors`, `network` ma `t` (number, ms od `timeOrigin` swojego
  dokumentu); nagłówek ma `collectedAt`, `recordingStartedAt` (ISO), `timeOrigin`, `source: "extension"`
  (unit na schemacie + e2e).
- **AC-4.6** Wpisy `consoleLogs` mają `stack` wskazujący wywołanie na stronie (nie tylko recorder); oryginalna
  metoda `console` jest wywoływana raz z tymi samymi argumentami (unit).
- **AC-4.7** `consoleLogs` nie zawiera wpisów wygenerowanych przez samo rozszerzenie (np. „initialized”) (e2e).
- **AC-4.8** Przekroczenie limitu bufora (fixture z 6000× `console.log`) → długość tablicy = `limits.consoleLogs`,
  `truncated.consoleLogs === true`, zachowane są najnowsze wpisy; bez przekroczenia `truncated.* === false` (unit).
- **AC-4.9** Paczka zapisana po auto-stopie ma `recordingStoppedReason: "time-limit"`, a w pozostałych przypadkach `null`;
  zawiera wpisy sprzed limitu i żadnego wpisu z `t` po limicie (unit + e2e).

### US-5 (Developer) Jako developer chcę, żeby nagrywanie nie zmieniało zachowania strony i znikało bez śladu po zapisie, żeby paczka nie była artefaktem samego narzędzia
- **AC-5.1** W czasie nagrywania: `new XMLHttpRequest() instanceof XMLHttpRequest`, `XMLHttpRequest.DONE === 4`
  (i pozostałe stałe), `XMLHttpRequest.prototype` bez zmian, `withCredentials`, `responseType`, `onreadystatechange`
  i użycie w stylu axios działają jak bez recordera (unit; e2e na fixture z axios-like klientem).
- **AC-5.2** `fetch(new Request(url, { method: 'POST' }))` i `fetch(URL)` są zapisane z poprawnym `method` i `url`;
  wynik i wyjątki `fetch` dla strony są identyczne jak bez recordera, body odpowiedzi nie jest konsumowane (unit).
- **AC-5.3** Po *Zapisz paczkę* `window.fetch`, `window.XMLHttpRequest`, metody `console` są tożsame (`===`)
  z oryginałami sprzed instalacji, a listenery `error`/`unhandledrejection` zdjęte (unit `destroy()` + e2e).
- **AC-5.4** Zero globali z danymi: w trakcie i po nagraniu skrypt strony iterujący po własnych właściwościach
  `window` (stringi i symbole) nie znajduje markera z `console.log`; `__PAGE_DEBUG_SNAPSHOT__` nie istnieje
  (e2e; przeniesione z E3-T6). Dozwolony jedynie marker instalacji bez danych.
- **AC-5.5** Podwójne uruchomienie recordera w tym samym dokumencie nie dubluje wpisów (marker 1× w paczce; unit + e2e).
- **AC-5.6** Skrypt strony nie może zakończyć ani zapisać nagrania, odczytać bufora ani podszyć się pod odpowiedź
  recordera (e2e: fixture wysyłająca sfałszowane komunikaty i definiująca własny `window.PageDebugSnapshot`
  z `download()` → brak sukcesu z fałszywą nazwą pliku, paczka z prawdziwego recordera).

### US-6 (Developer) Jako developer chcę, żeby nowy model działał tak samo w Chrome i Firefoksie i był pokryty testami, żeby błąd jak F7 z E0 nie wyszedł dopiero w ręcznym QA
- **AC-6.1** Jedno tło działa jako service worker (Chrome) i event page (Firefox); manifesty różnią się tylko
  kluczami dozwolonymi testem E0 AC-4.8 (`background` dopuszczony) (unit).
- **AC-6.2** Wszystkie ścieżki do plików wstrzykiwanych/rejestrowanych są root-relative i istnieją w `dist/*`
  (unit na walkerze/manifestach).
- **AC-6.3** Walker builda kończy się błędem (kod ≠ 0), gdy napotka `url(`, `chrome.runtime.getURL(` lub import
  z template literal, którego nie umie rozwiązać (unit z fixture; E1-T11).
- **AC-6.4** Plan testów E1 (dokument QA/Design) zawiera listę ≥ 10 scenariuszy QA Firefox odpowiadających AC
  z dopiskiem „QA ręczne” (min.: zgoda/odmowa, przeładowanie, błąd w `<head>`, `pushState`, wyładowanie event page,
  zapis z sukcesem, zapis anulowany, strona specjalna, zamknięcie karty, fallback konsolowy); `qa-report.md`
  raportuje każdy osobno (review).
- **AC-6.5** `deepMerge` nie współdzieli referencji z obiektem źródłowym (unit; dług z E0).

### US-7 (Developer) Jako developer chcę fallbacku bez instalacji opartego na tym samym recorderze, żeby paczka z konsoli miała ten sam format
- **AC-7.1** `src/standalone/console-snapshot.js` używa tego samego kodu hooków co rozszerzenie (test: brak
  zduplikowanej implementacji hooków; plik generowany lub weryfikowany z tego samego źródła).
- **AC-7.2** Po wklejeniu w konsolę wypisuje po polsku: „Zbieram od teraz. Odtwórz problem i wywołaj
  `PageDebugSnapshot.download()`.” (unit).
- **AC-7.3** Paczka z fallbacku ma `schemaVersion: 2`, `source: "console"`, `recordingStartedAt` = chwila
  wklejenia, a `notes` mówi, że dane sprzed wklejenia nie są zebrane (unit/e2e).
- **AC-7.4** `console-snapshot.js` nadal nie trafia do `dist/*` (regresja E0 AC-4.3).

## Wymagania niefunkcjonalne
- **Rozmiar:** każdy target `dist/*` < 500 KB (bez zmian).
- **Wydajność hooków:** ≤ 2 ms narzutu na pojedynczy `fetch`/XHR i ≤ 0,5 ms na wywołanie `console.*` (p95,
  test syntetyczny 1000 wywołań w Chromium vs. strona bez recordera).
- **Czas:** od kliknięcia *Nagrywaj* (po zgodzie) do rozpoczęcia przeładowania ≤ 2 s; od *Zapisz paczkę* do
  *Zapisano* na `basic.html` ≤ 5 s (e2e, mediana z 5); twardy limit 15 s → `failed` (AC-2.4).
- **Pamięć/paczka:** bufory ograniczone (`limits` w paczce); fixture „flood” (20 000 logów po 1 KB) daje
  paczkę ≤ 10 MB i nie zawiesza karty (e2e).
- **Prywatność:** E1 wydłuża okno zbierania (więcej logów, URL-i i nagłówków), nie dodaje redakcji — dane
  wrażliwe nadal jawne do E3, świadomie zaakceptowane. Wymagania: ujawnienie i zgoda kliknięciem (AC-1.1/1.2);
  dostęp tylko do origin karty (AC-3.2); brak danych innych kart i originów (AC-3.3/3.4); brak globali z danymi
  i pełne `destroy()` (AC-5.3/5.4); nagrane dane nie trafiają do trwałego magazynu przeglądarki ani strony
  (`storage.local`, IndexedDB, `localStorage`) — tylko do pliku (review + unit); rozszerzenie nic nie wysyła
  do sieci (grep `dist/*` jak E0 AC-ST.2). `data_collection_permissions: ["none"]` pozostaje prawdziwe.
- **Przeglądarki:** Chrome ≥ `minimum_chrome_version` z E0 (121), Firefox ≥ 128; e2e tylko Chromium (Playwright,
  headless); Firefox: `web-ext lint` 0 errors + QA ręczne wg AC-6.4.
- **Testy:** `npm test` ≤ 30 s, `npm run test:e2e` ≤ 5 min; e2e stabilne 10/10 bez `retries`.

## Dane — zmiany w schemacie paczki
Zmiana łamiąca → **`schemaVersion: 2`** + sekcja „Wersja 2” i tabela migracji v1→v2 w `docs/snapshot-schema.md`
oraz fixture `tests/fixtures/snapshots/v2.json`. Szczegółowy kształt (np. przypisanie wpisów do dokumentów przy
przeładowaniu) — Design.

| Pole | Zmiana |
|---|---|
| `schemaVersion` | nowe, integer `2` |
| `extensionVersion` | nowe, wersja z manifestu (np. `"0.3.0"`); zastępuje `version: "1.0.0"` |
| `recordingStartedAt` | nowe, ISO; zastępuje `initializedAt` |
| `timeOrigin` | nowe na górze (number); dotychczas tylko w `performance.timeOrigin` |
| `source` | nowe, `"extension"` \| `"console"` |
| `limits`, `truncated` | nowe, per tablica (`consoleLogs`, `runtimeErrors`, `network`) |
| `consoleLogs[].t`, `runtimeErrors[].t` | zastępują `timestamp` (ISO) — ms od `timeOrigin` |
| `network[].t` | zastępuje `startedAt` (ISO); `durationMs` bez zmian |
| `consoleLogs[].stack` | nowe, string (opcjonalne) |
| `notes` | bez zmiany typu; nowe treści (zakres nagrania, pominięte dane) |

Pozostałe sekcje (`environment`, `dom`, `performance`, `storage`) bez zmian treści. Nazwa pliku bez zmian.

## Decyzje z bramki Spec (użytkownik, 2026-10-22)
1. **`optional_host_permissions`:** `http://*/*` i `https://*/*` jako opcjonalne w manifeście; w runtime
   `permissions.request` wyłącznie o origin bieżącej karty; uzasadnienie EN ze store-review.
2. **`file://`:** Chrome — nagrywanie przy włączonej zgodzie, bez niej komunikat `fileAccess`; Firefox — jeśli
   niemożliwe, polski komunikat, nigdy fałszywy sukces; QA ręczne.
3. **Dostęp po zapisie:** uprawnienie do origin **zostaje**; README opisuje, jak je cofnąć w przeglądarce.
4. **Jeden przepływ:** *Nagrywaj* → *Zapisz paczkę*. Bez trybu „szybki zrzut” w popupie (E0 flow znika);
   `console-snapshot.js` zostaje jako fallback dla developerów.
5. **Limit czasu nagrywania: 10 minut** (AC-1.9, AC-4.9). Po 10 min od startu nagrywanie zatrzymuje się samo (hooki zdjęte,
   bufory zachowane), popup pokazuje stan „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę”, zapis nadal
   możliwy; paczka ma `recordingStoppedReason: "time-limit"`. Limit konfigurowalny tylko dla testów
   (e2e ze skróconym limitem), nie w UI zgłaszającego. → architekt dodaje AC i zadanie (E1-T12).

## Ryzyka
1. **Wyścig przy `document_start`** — inline skrypt strony wykona się przed recorderem w części przeładowań.
   Sygnał: AC-4.1 przechodzi < 10/10 uruchomień albo pojawia się `retries`.
2. **Wyładowanie tła (SW/event page) gubi stan lub zapis.** Sygnał: AC-1.5 lub AC-2.1 czerwone po wymuszonym
   zatrzymaniu tła; w Firefoksie zgłoszenia „popup pokazuje Gotowy w trakcie nagrania”.
3. **Hooki psują realne strony** (biblioteki XHR, `fetch` z `Request`, frameworki owijające `console`).
   Sygnał: różnica w zachowaniu fixture axios-like lub błąd zgłoszony z QA na realnej stronie.
4. **Store review odrzuca `optional_host_permissions` lub `downloads`.** Sygnał: uwaga store-reviewera E1 lub
   zapytanie CWS/AMO o uzasadnienie.
5. **Firefox bez e2e** — rozjazd zachowania wychodzi dopiero w QA. Sygnał: którykolwiek scenariusz z AC-6.4
   FAIL tylko w Firefoksie albo raport QA bez osobnego wyniku dla Firefoksa.

## Decyzje z bramki Design (użytkownik, 2026-10-22)
- **PB-1 → A:** `file:///*` w `optional_host_permissions`; nagrywanie `file://` jak w E0 (zgoda w Chrome).
- **PB-2 → zgoda z góry:** jeśli spike T0 nie nada origin przez `developerPrivate`, e2e używa kopii `dist/chrome`
  z `host_permissions` dla 127.0.0.1; `dist/` i zipy bez zmian.
- **D3 (orkiestrator):** most MAIN↔ISOLATED bez `postMessage` (odłączony węzeł DOM + `CustomEvent`) zaakceptowany;
  warunek: test, że strona nie może odczytać nonce ani bufora (AC-5.6). Skill `mv3-extension-rules` do aktualizacji w Docs.
