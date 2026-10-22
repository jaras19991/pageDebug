# E1 — Design

## Pytania do bramki

**PB-1 (sprzeczność decyzji 1 i 2 z bramki Spec): `file://` w Chrome.**
Decyzja 1 ogranicza `optional_host_permissions` do `http://*/*` i `https://*/*` (AC-3.1). Decyzja 2 mówi:
„Chrome — nagrywanie `file://` przy włączonej zgodzie”. Te dwie decyzje nie dają się pogodzić. `registerContentScripts`
wymaga trwałego uprawnienia do hosta z `matches`, a `permissions.request({ origins: ['file:///*'] })` kończy się
błędem „Only permissions specified in the manifest may be requested”, jeśli wzorca nie ma w manifeście. Przełącznik
„Zezwalaj na dostęp do adresów URL plików” niczego tu nie zmienia, bo `activeTab` przestaje działać po przeładowaniu.
- **(A) — rekomendacja:** do `optional_host_permissions` dochodzi `"file:///*"` (AC-3.1 trzeba poprawić o ten jeden wpis).
  Uprawnienie jest opcjonalne, więc nie pojawia się ostrzeżenie przy instalacji. O `file:///*` rozszerzenie prosi tylko wtedy,
  gdy zgłaszający kliknie *Nagrywaj* na pliku z dysku. Bez przełącznika zostaje komunikat `fileAccess`, tak jak w E0.
  Firefox dostaje ten sam kod. Jeśli nagrywanie nie ruszy, pojawia się polski komunikat, nigdy fałszywy sukces (QA-F).
- **(B):** w E1 `file://` nie jest nagrywane i pojawia się nowy komunikat `fileUnsupported` (zmiana decyzji 2).

Zadania są opisane w wariancie (A). Przy (B) T16 nie dodaje wpisu, `originPatternFor` (T1a) zwraca dla `file:` wartość `null`,
a T6a dodaje klucz `fileUnsupported`. To różnica kilku linii.

**PB-2 (warunkowe, jak PB-1 w E0): uprawnienie do origin w e2e.** Okna zgody Chrome (`permissions.request`) Playwright
nie kliknie. To nie jest `page.on('dialog')`, tylko natywny bąbel przeglądarki. Plan główny (spike E1-T0): harness nadaje
origin przez `chrome.developerPrivate.addHostPermission` na `chrome://extensions` (tak samo działa „Automatycznie zezwól
na tych stronach” w Szczegółach), a potem prawdziwy popup woła `permissions.request`, które od razu zwraca `true`.
**Jeśli spike T0 tego nie potwierdzi**, potrzebna jest zgoda na plan awaryjny z E0 PB-1: e2e ładuje kopię `dist/chrome`
w katalogu tymczasowym, do której manifestu harness dopisuje wyłącznie `"host_permissions": ["http://127.0.0.1/*",
"http://localhost/*"]`. `dist/*` i zipy się nie zmieniają, a AC-3.1/3.2 sprawdzają testy unit na prawdziwych manifestach.

Odstępstwo od skilla `mv3-extension-rules` do akceptacji na bramce (nie jest niewykonalnością): **D3** — most
MAIN↔ISOLATED nie jedzie przez `window.postMessage`. Uzasadnienie w D3.

Nowe AC wynikające z decyzji 5 bramki Spec (limit 10 min): **AC-1.9** i **AC-4.9** poniżej. Trzeba je dopisać do spec.md
w US-1 i US-4 (robi to orkiestrator lub analityk). Łącznie jest teraz 44 AC.

- **AC-1.9** (US-1) Given nagrywanie trwa od 10 min (limit), Then rozszerzenie samo kończy nagrywanie: hooki zdjęte,
  bufory zachowane, kolejne dokumenty (przeładowanie) nie są nagrywane, oznaczenie ikony zmienia się na „zatrzymane”, a popup pokazuje
  „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.” z przyciskiem *Zapisz paczkę*. Limit da się skrócić tylko
  w testach (klucz w `storage.session`, niedostępny dla stron i content scriptów; wartość przycinana do ≤ 10 min).
  W UI zgłaszającego nie ma takiego ustawienia (unit z fałszywym zegarem; e2e z limitem 3 s; QA-F).
- **AC-4.9** (US-4) Paczka zapisana po auto-stopie ma `recordingStoppedReason: "time-limit"`, a w pozostałych przypadkach `null`.
  Zawiera wpisy sprzed limitu i żadnego wpisu z `t` po limicie (unit + e2e).

## Kontekst
Po E0 popup robi zrzut przez `executeScript` w MAIN, więc hooki startują w chwili zrzutu, a plik zapisuje `<a download>`
w stronie, bez informacji o wyniku. Kod strony to jedno IIFE z globalem `window.PageDebugSnapshot` i `__PAGE_DEBUG_SNAPSHOT__`.
E1 wprowadza jedno tło (service worker w Chrome, event page w Firefoksie), które po *Nagrywaj* rejestruje recorder
w MAIN i most w ISOLATED na `document_start` dla origin karty i przeładowuje kartę. *Zapisz paczkę* zbiera dane z bieżącego
i wcześniejszych dokumentów do paczki `schemaVersion: 2`, a sukces popup pokazuje dopiero po `downloads.onChanged → complete`.

## Decyzje

Zastępowane decyzje E0: **D6** (wstrzyknięcie `executeScript` + sonda) → D1, D3; **D7** (słownik) → rozszerzony w D9;
**D8** (strony specjalne) → `classifyUrl` zostaje, przepływ według D9; **D9** (guardy zamiast markera) → marker w D5;
**D12** (moduły popupu) → D9. Bez zmian zostają D1–D5, D10 (CDP `triggerAction`), D11 i D13. D4 rozszerzam o `background` w nakładkach (D2).

### D1 Mechanizm nagrywania: rejestracja per origin + przeładowanie + bramka per dokument
Opcje: (a) `executeScript` przy kliknięciu (E0): za późno, nie spełnia AC-4.1; (b) statyczne `content_scripts` z `<all_urls>`:
recorder na każdej stronie bez kliknięcia, łamie AC-1.2 i AC-3.1; (c) `scripting.registerContentScripts` dla wzorca origin
karty, `runAt: 'document_start'`, wpis ISOLATED (most) + wpis MAIN (recorder), `allFrames: false`, `persistAcrossSessions: false`,
potem `tabs.reload`.
**Wybór: (c)** plus **bramka per dokument**. Każdy dokument, w którym ruszył recorder, pyta tło (`hello`) i nagrywa dalej
tylko wtedy, gdy `sender.tab.id` = nagrywana karta, `origin(sender.url)` = origin nagrania (dokładnie, z portem), status
`recording` i nie minął termin limitu. Inaczej MAIN od razu robi `destroy()` i czyści bufor.
Uzasadnienie: to jedyny sposób w MV3, żeby dostać dane od pierwszego bajtu (skill). Wzorzec rejestracji obejmuje wszystkie karty
tego hosta, więc bez bramki nagrywałyby się też inne karty tego samego origin (AC-3.3) i inne porty. Bramka rozstrzyga to w tle,
na podstawie zaufanego `sender`. Wzorzec uprawnienia i rejestracji ma postać `<scheme>://<hostname>/*` **bez portu**:
Firefox nie obsługuje portów we wzorcach, a Chrome bez portu dopasowuje każdy port. Spełnia to AC-3.2 (port opcjonalny).
Precyzję do portu zapewnia bramka.
Konsekwencje: przez kilka milisekund (do odpowiedzi na `hello`) hooki działają także w innych kartach tego hosta. Dane
z tego okna nigdy nie opuszczają strony i są kasowane, a w karcie zostaje tylko marker bez danych (D5). Fail-safe: jeśli
w ciągu 10 s nie przyjdzie konfiguracja (most nie wstał), MAIN sam robi `destroy()` i czyści bufor. Jednocześnie trwa
co najwyżej jedno nagranie (non-goal: wiele kart). *Nagrywaj* w innej karcie kończy poprzednie bez zapisu, a popup uprzedza
o tym komunikatem `otherTabRecording`. Po zapisie, zamknięciu karty, `runtime.onStartup` i `onInstalled` tło wyrejestrowuje
oba skrypty (AC-2.5, AC-2.6). `tabs.reload`, `tabs.sendMessage` i `tabs.onRemoved` nie wymagają uprawnienia `tabs`.
`tab.url` popup dostaje dzięki `activeTab`, a tło przez uprawnienie do origin.

### D2 Tło cross-browser i stan
Opcje: (a) oba klucze `background` w bazie; (b) `background` w nakładkach: Chrome `{service_worker, type:'module'}`,
Firefox `{scripts:[…], type:'module'}`; (c) dwa różne pliki tła.
**Wybór: (b)**, świadome odstępstwo od tabeli w skillu („oba klucze w manifeście”).
Uzasadnienie: jeden plik `src/background.js` (ES module, bez `importScripts`, bez `window`/`document`/`URL.createObjectURL`)
działa w obu modelach. Każdy target dostaje wtedy wyłącznie klucz, którego używa: zero ostrzeżeń w `chrome://extensions`,
w `web-ext lint` i w walidatorze CWS. Wariant (a) zostawia klucz ignorowany przez każdą z przeglądarek, a walidatora sklepu
dziś nie umiemy sprawdzić. `background` jest już w `TARGET_KEYS`, a AC-6.1 dopuszcza różnicę. Typ `module` działa w Chrome SW
i w Firefox event page (≥ 112, mamy `strict_min_version` 128). Test parytetu wymusza ten sam plik i ten sam `type`.
Stan żyje **wyłącznie** w `chrome.storage.session` (pamięć przeglądarki, czyszczona przy zamknięciu, niedostępna dla content
scriptów przy domyślnym `TRUSTED_CONTEXTS`). Klucze:
- `pds:rec` — `{ v:1, requestId, tabId, origin, pattern, startedAt, limitMs, deadline, status:'recording'|'stopped', stopReason,
  docSeq, docs:[{ id, url, flushed }], save: null|{ phase:'collecting'|'downloading', downloadId, fileName, startedAt }, lastError }`;
- `pds:doc:<id>` — bufory dokumentów zapisane przy `pagehide` (D4);
- `pds:pending` — `{ requestId, tabId, origin, pattern, at }` (zgoda w toku, D9);
- `pds:last:<tabId>` — `{ fileName, at }` ostatniego zapisu (stan *Zapisano*);
- `pds:test:recordingLimitMs` — wyłącznie testy (D10).
Wszystkie listenery rejestruje top-level `background.js`: `runtime.onMessage`, `tabs.onRemoved`, `downloads.onChanged`,
`permissions.onAdded`, `runtime.onStartup`, `runtime.onInstalled`. Logika siedzi w `src/lib/*` z wstrzykiwanym `api`.
Zapisy idą przez kolejkę promisów w obrębie żywej instancji, która tylko porządkuje operacje i nie trzyma stanu.
Router sprawdza nadawcę: komendy popupu przyjmuje tylko wtedy, gdy `sender.url` zaczyna się od `runtime.getURL('popup/')`
i nie ma `sender.tab`, a komendy mostu tylko od `sender.tab` z `frameId === 0` i `sender.id === runtime.id`.
Konsekwencje: AC-1.5 wynika z konstrukcji. Test „świeża instancja handlerów czyta ten sam stan” pilnuje, żeby nie pojawiła się
zmienna modułowa ze stanem.

### D3 Most MAIN ↔ ISOLATED: prywatny kanał na odłączonym węźle DOM (odstępstwo od `postMessage`)
Opcje:
(a) `window.postMessage({__pds: nonce, …})` (skill). Każdy listener `message` strony widzi `e.data` z nonce i treścią.
Po pierwszym komunikacie strona zna nonce i może podrabiać odpowiedzi, a przy `flush`/`collect` czyta cały bufor.
Łamie to AC-5.6 („nie może odczytać bufora ani podszyć się”);
(b) `MessageChannel`, którego port przekazujemy przez `postMessage`. Zdarzenie jest asynchroniczne, więc inline'owy skrypt
z `<head>` może je przechwycić razem z portem, zanim dotrze do mostu;
(c) **synchroniczny handshake na `document_start`**. ISOLATED tworzy odłączony element (poza drzewem DOM) i nonce
(`crypto.randomUUID()`) i przekazuje węzeł do MAIN przez `MouseEvent('pds:isolated-ready', { relatedTarget: node })` wysłany
na `document`. Węzły DOM są wspólne dla światów, a `dispatchEvent` jest synchroniczny. Dalej oba światy rozmawiają
**wyłącznie** przez `CustomEvent` na tym węźle, a `detail` to string JSON `{ n: nonce, v: PROTOCOL, id?, type, payload }`.
Strona nie ma referencji do węzła, więc nie słyszy i nie nadaje.
**Wybór: (c).**
Uzasadnienie: handshake kończy się, zanim wykona się jakikolwiek skrypt strony, bo oba skrypty są na `document_start`.
Kolejność obu światów nie ma znaczenia: MAIN nasłuchuje `pds:isolated-ready` i wysyła `pds:main-ready`, a ISOLATED na
`pds:main-ready` odpowiada ponownie `pds:isolated-ready`. Po związaniu oba usuwają listenery z `document`. MAIN przyjmuje
wyłącznie pierwszy węzeł. Nonce jest drugą warstwą: każda wiadomość niesie `n`, odbiorca odrzuca inne. Przy odpowiedzi
`collect` sprawdzamy też zgodność `id`. `chrome.*` nie ma w MAIN; jedyną drogą do tła jest ISOLATED → `runtime.sendMessage`.
`detail` zawsze jest stringiem, bo obiekty przez granicę światów zawodzą (Firefox Xray, Chrome w niektórych wersjach).
Konsekwencje: AC-5.6 pokrywają test unit kanału i e2e z wrogą stroną. Jeśli w Firefoksie zdarzy się wyścig (ryzyko 1 spec)
i skrypt strony wyprzedzi most, strona może przejąć handshake. Wtedy most nie dostaje połączenia, tło dostaje
`bridgeError: 'unbound'`, a dokument jest oznaczony jako nienagrany. Wynik zapisu i nazwę pliku zawsze ustala tło (D7),
więc strona nie wymusi fałszywego sukcesu. Fallback, jeśli spike T0 wykaże, że `relatedTarget` nie przechodzi między
światami: ISOLATED na czas synchronicznego handshake'u dopina węzeł do `document.documentElement`, MAIN zabiera go
jako `lastChild` po zdarzeniu `pds:isolated-ready` i odpina (cały czas przed skryptami strony).

### D4 Dane między nawigacjami w karcie
Opcje: (a) każdy dokument ma bufor w MAIN, a wcześniejsze dokumenty przepadają (`notes` z liczbą pominiętych);
(b) ciągłe strumieniowanie każdego wpisu do tła (wybudzanie tła co sekundę, O(n) zapisów, ryzyko quota);
(c) bufor w MAIN + **jednorazowy zrzut przy `pagehide`** do `storage.session` w tle (`pds:doc:<id>`), z budżetem.
**Wybór: (c).**
Uzasadnienie: SPA (`pushState`/`replaceState`/`popstate`) nie zmienia dokumentu, więc nagranie trwa bez dodatkowej pracy
(AC-4.3). Przy pełnym przeładowaniu w obrębie origin (np. wysłanie formularza w MPA) błąd, który poprzedził nawigację,
jest najcenniejszy, więc go zachowujemy (AC-4.4, wariant „wpisy są w paczce”). Zrzut idzie raz na dokument: MAIN (listener
`pagehide` w fazie capture, dodany przed skryptami strony) → prywatny kanał → ISOLATED → `runtime.sendMessage({type:'flush'})`.
Wysyłka IPC startuje w chwili wywołania, nie po rozładowaniu. Ten sam mechanizm zachowuje dane pierwotnego dokumentu, gdy
karta przejdzie na inny origin (AC-3.4). Przy bfcache (`pagehide.persisted`) ponowny zrzut tego samego `docId` nadpisuje
klucz, a przy zbieraniu bieżący `docId` wyklucza swoją starszą kopię.
Budżet: pojedynczy zrzut ≤ 3 MB (dłuższy jest obcinany od najstarszych wpisów), wszystkie dokumenty razem ≤ 8 MB (quota
`storage.session` w Chrome to 10 MB). Najstarsze dokumenty ponad budżet są usuwane i zostaje po nich tylko liczba wpisów.
Błąd zapisu (quota, Firefox) daje to samo: liczby i notatkę. `notes` zawsze mówi, co i ile pominięto.
Konsekwencje: schemat v2 dostaje `documents[]` i pole `doc` w rekordach (D12). Zrzut w `pagehide` może się nie dostarczyć
(np. crash karty). Wtedy dokument ma `flushed: false` i notatkę „data of document N was not received”. Ryzyko R4.

### D5 Hooki recordera
Opcje dla XHR: (a) podmiana na funkcję (E0, łamie `instanceof`); (b) `class extends XMLHttpRequest` (zmienia
`XMLHttpRequest.prototype` i `name`); (c) `new Proxy(XMLHttpRequest, { construct })` zwracający **natywną** instancję z dopiętymi
listenerami i nieenumerowalnymi własnymi metodami `open`/`setRequestHeader`/`send`, które wołają
`Reflect.apply(XMLHttpRequest.prototype.<m>, xhr, args)` odczytane w chwili wywołania. **Wybór: (c).**
Dla `fetch`: `new Proxy(fetch, { apply })`, bo zachowuje `name`, `length` i `toString`. Dla `console`: funkcja-wrapper per poziom.
Uzasadnienie: (c) zostawia `XMLHttpRequest.prototype` nietknięty (AC-5.1), `instanceof` działa przez `get` trap
(`prototype`), stałe statyczne (`DONE`, …) przechodzą przez proxy, a późniejsze łatki strony na prototypie (Sentry, New Relic)
nadal są wołane. Zasady wspólne:
- **Intrinsics przechwycone przy instalacji**: `Reflect`, `Proxy`, `JSON`, `Error`, `performance.now`, `Date.now`,
  `EventTarget.prototype.addEventListener`/`removeEventListener`/`dispatchEvent`, `CustomEvent`, `MouseEvent`, `WeakMap`.
  Strona nie zdąży ich podmienić (`document_start`).
- `fetch`: `method` z `init.method` → `Request.method` → `'GET'` (wielkie litery). `url` z `Request.url` lub `String(input)`
  rozwiązanego względem `document.baseURI`. Nagłówki żądania z `init.headers`/`Request.headers`. Body tylko jako podgląd
  stringa ≤ 5000 znaków, inne typy jako `"[FormData]"` itp. Odpowiedź: status, nagłówki, bez czytania body (bez `clone()`).
  Wynik zwracamy przez `then(res => …res, err => {…; throw err})`, więc wyjątki strony są identyczne (AC-5.2).
- XHR: rekord przy `loadend` (status, `responseURL`, nagłówki z `getAllResponseHeaders()`, `error`:
  `'error'|'abort'|'timeout'|null` z listenerów). `t` liczone od `send()`, a gdy go nie było, od `open()`.
- `console` (`log`, `info`, `warn`, `error`, `debug`): `record({ t, level, args, stack })`, potem dokładnie raz
  `Reflect.apply(orig, console, args)`. `stack` = `new Error().stack` bez nagłówka `Error` i bez pierwszej ramki (wrapper),
  ≤ 4000 znaków. Gdy strona ustawi `Error.stackTraceLimit = 0`, pole jest pominięte. Znane ograniczenie (do docs):
  DevTools pokazuje recorder jako źródło logu.
- `error` / `unhandledrejection`: listenery na `window` (bubble, jak w E0, bez błędów zasobów, które są w E2) z referencjami
  trzymanymi do `destroy()`.
- Rekordy: `args`/`reason` serializowane przez `safeJson` do stringa z limitem `entryChars = 10000`; dłuższe trafiają jako
  `{ "truncated": true, "preview": "…" }`. Bufory pierścieniowe z limitami `consoleLogs 5000`, `runtimeErrors 1000`,
  `network 5000` i sumą znaków ≤ 4 000 000 na dokument; usuwane są najstarsze wpisy, a `truncated.<x>` przechodzi na `true`.
- Każdy błąd w kodzie recordera jest łapany i połykany. Recorder **nigdy** nie pisze do `console` (AC-4.7).
- `destroy()`: przywraca `window.fetch`, `window.XMLHttpRequest`, metody `console` (`===` oryginały) i zdejmuje listenery
  `error`/`unhandledrejection`/`pagehide`. Istniejące instancje XHR przechodzą w tryb przelotowy. `stop('time-limit')` robi
  to samo, ale **zachowuje** bufory (D10).
- Marker: `Object.defineProperty(window, Symbol.for('pds.installed'), { value: Object.freeze({ version }), enumerable: false,
  configurable: false })`. Gdy marker istnieje, druga instalacja w tym samym dokumencie jest no-opem (AC-5.5). Bufor żyje wyłącznie
  w domknięciu, `window.PageDebugSnapshot` i `__PAGE_DEBUG_SNAPSHOT__` w trybie rozszerzenia nie istnieją (AC-5.4).
Konsekwencje: `xhr.hasOwnProperty('open') === true` na instancjach (ukryte przed `Object.keys`), do opisania jako znane
ograniczenie. Wydajność: `new Error()` + `safeJson` na każdym `console.*` to główny koszt, mierzony w NFR (T19e).

### D6 Kod strony jako moduły ES + generator klasycznych bundli
Opcje: (a) każdy plik MAIN jako osobny klasyczny skrypt dzielący kod przez tymczasowy global; (b) jeden ręcznie utrzymywany
plik MAIN + osobna kopia w `console-snapshot.js` (duplikacja, łamie AC-7.1); (c) źródła jako moduły ES w `src/page/`
(testowalne bezpośrednio w vitest) + `scripts/gen-content.mjs`, który skleja je w kolejności zależności do klasycznych IIFE:
`src/content/main-world.js`, `src/content/isolated-world.js`, `src/standalone/console-snapshot.js`. Wyniki są commitowane
z nagłówkiem `// GENERATED by scripts/gen-content.mjs — do not edit`.
**Wybór: (c).**
Uzasadnienie: content scripty nie mogą być modułami, a każda top-level deklaracja klasycznego skryptu w MAIN staje się
globalem strony. IIFE z jednego pliku nie zostawia nic. Generator jest prosty i ostrożny: dopuszcza wyłącznie jednolinijkowe
`import { … } from './x.js'` i `export function|const|class`, a na wszystko inne rzuca błąd. Wynik sprawdza składniowo
`new vm.Script`, co łapie też kolizję nazw. Build zostaje bez zmian (kopiowanie bajt w bajt z D3 E0). Test „wygenerowane
pliki są aktualne” spełnia AC-7.1 („generowany i weryfikowany z tego samego źródła”).
Konsekwencje: `npm run gen` po każdej zmianie w `src/page/*`. Wersja recordera to stała w `src/page/constants.js`,
a test pilnuje, że jest równa `version` z `manifest.base.json`, więc release musi uruchomić `gen`. Moduły `src/page/*.js`
nie trafiają do `dist`, bo nic z manifestu ich nie osiąga. Walker dostaje obsługę `js: [...]` (T11). Test E0 z hashem
`console-snapshot.js` jest świadomie zastąpiony (US-7 zmienia ten plik).

### D7 Zapis pliku: Blob w popupie, `downloads.download`, wynik z `downloads.onChanged` w tle
Opcje: (a) data URL z tła: działa w SW, ale URL > 2 MB odpada (limit `url::kMaxURLChars` na granicy mojo), a realna paczka
z jednego dokumentu ma już 1,26 MB (`page-debug-snapshot-1792487181606.json`), więc z logami przekroczy limit; (b) dokument
offscreen: tylko Chrome i nowe uprawnienie `offscreen`, łamie AC-3.1; (c) blob URL utworzony w ISOLATED karty: origin strony,
zachowanie `downloads.download` dla cudzego bloba (partycjonowanie blob URL w Chrome, principal w Firefoksie) jest niepewne;
(d) blob w tle: działa tylko w Firefox event page (SW nie ma `URL.createObjectURL`); (e) **popup**: tło zbiera i składa paczkę
i zwraca string JSON, popup robi `new Blob` + `URL.createObjectURL` i woła `chrome.downloads.download({ url, filename, saveAs:
false, conflictAction: 'uniquify' })`, a potem od razu `saveStarted { downloadId, fileName }` do tła. Tło śledzi
`downloads.onChanged` (top-level) i jest źródłem prawdy o wyniku.
**Wybór: (e).**
Uzasadnienie: (e) to jedna ścieżka kodu w obu przeglądarkach, na standardowym API. Dokument, który jest właścicielem bloba,
sam inicjuje pobranie, więc nie ma wyszukiwania blob URL między kontekstami. Popup na pewno istnieje w chwili kliknięcia
*Zapisz paczkę*. Chrome zaczyna czytać blob przy starcie pobrania (przed ewentualnym oknem „Zapisz jako”), a w Firefoksie
`saveAs: false` nie otwiera okna. Sukces = `onChanged` z `state.current === 'complete'`. Nazwę w komunikacie bierzemy
z `downloads.search({ id })` (basename `filename`), więc przy `uniquify` jest to nazwa faktycznego pliku (AC-2.1).
`interrupted` (w tym `USER_CANCELED`) daje `lastError: 'saveCancelled'`, a nagranie trwa (AC-2.2). Zbieranie nie niszczy
buforów, więc ponowny zapis ma te same wcześniejsze wpisy.
Limity czasu (AC-2.4): **15 s** od kliknięcia do `downloads.download` → id (zbieranie z karty + start pobrania), egzekwowane
w popupie (`Promise.race`) i w tle (`tabs.sendMessage` z timeoutem). Przekroczenie daje `pageBusy` („strona jeszcze się
ładuje”) lub `failed`. **60 s** od startu do `complete`, potem tło robi `downloads.cancel(id)` i ustawia `failed`. Nigdy sukces.
Po sukcesie tło po kolei: wyrejestrowuje skrypty, wysyła `destroy` do karty (best-effort), czyści `pds:rec` i `pds:doc:*`,
zapisuje `pds:last:<tabId>` i czyści badge (AC-2.5).
Konsekwencje: jeśli popup zamknie się przed startem pobrania, zapis kończy się `failed` przy następnym otwarciu
(uczciwie, bez sukcesu). `downloads.download` z API rozszerzenia nie podlega blokadzie „Automatyczne pobieranie” (regresja F3,
AC-2.3 w QA). Paczka idzie przez `runtime.sendMessage` jako string (≤ 10 MB, limit Chrome to 64 MB). Fallback, jeśli T0 pokaże
problem z blobem z popupu przy oknie „Zapisz jako”: wariant (d) w Firefoksie + (a) dla paczek ≤ 1,5 MB w Chrome, a dla
większych bramka z `offscreen`.

### D8 Uprawnienia
Opcje: (a) `host_permissions` dla wzorców http/https (ostrzeżenie „wszystkie strony” przy instalacji); (b) `tabs` do odczytu URL;
(c) minimum: `activeTab`, `scripting`, `storage`, `downloads` + `optional_host_permissions` z prośbą w locie tylko o origin karty.
**Wybór: (c).**
Uzasadnienie: decyzje bramki i store review. `tabs` jest zbędne, bo `tab.url` daje `activeTab` (popup) i uprawnienie
do origin (tło), a `tabs.reload`/`sendMessage`/`onRemoved` go nie wymagają. Prośba zawsze dotyczy dokładnie jednego wzorca
(AC-3.2). Uprawnienie zostaje po zapisie (decyzja 3), a README opisuje, jak je cofnąć (DOC1). Nie używamy `alarms`
(limit przez termin w stanie, D10) ani `offscreen` (D7).
Konsekwencje: w Firefoksie MV3 host permissions i tak są opcjonalne, więc kod jest identyczny. `minimum_chrome_version`
zostaje 121.

### D9 Popup: widok stanu z tła, zgoda w geście, komunikaty
Opcje: (a) popup trzyma logikę i stan; (b) popup jako widok: `getStatus` przy otwarciu + `storage.session.onChanged`
→ ponowny `getStatus`, a logika sterująca w `controller.js` z wstrzykiwanym `api`.
**Wybór: (b).**
Uzasadnienie: popup żyje krótko (skill). Klik *Nagrywaj* ma twarde ograniczenie: `permissions.request` musi być wywołane
synchronicznie w handlerze kliknięcia (Firefox odrzuca wywołanie po `await`, a Chrome traci gest). Dlatego wzorzec origin,
klasyfikację URL (`classifyUrl`) i sondę `isAllowedFileSchemeAccess` popup liczy **przy otwarciu**. Sam handler robi
w jednym ticku: `runtime.sendMessage({ type:'armStart', requestId, tabId, origin, pattern })` bez `await`, potem
`permissions.request({ origins: [pattern] })`. Po `true` wysyła `start { requestId }`, po `false` wysyła `disarm` i pokazuje
`permissionDenied` (AC-1.4).
Jeśli przeglądarka zamknie popup przy oknie zgody (znane w Firefoksie), tło startuje samo z `permissions.onAdded` dla
uzbrojonego `pending` (≤ 120 s). Odmowa przy zamkniętym popupie jest pokazywana przy następnym otwarciu (`getStatus` widzi
stary `pending` bez uprawnienia). `start` jest idempotentny po `requestId`, więc przeładowanie jest dokładnie jedno (AC-1.3).
Stany widoku: *Gotowy* (lista ujawnienia, informacja o odświeżeniu, przycisk *Nagrywaj*, opcjonalnie *Zapisano: plik*
i `otherTabRecording`), *Uruchamiam…*, *Nagrywam od HH:MM:SS* (czas lokalny formatowany ręcznie, `padStart`, bez
`toLocaleTimeString`; przycisk *Zapisz paczkę*; opcjonalnie `otherOrigin`), *Zatrzymano po 10 min*, *Zapisuję…*. Strony
specjalne (`restricted`), `fileAccess` i `noTab` pojawiają się od razu, bez prośby o zgodę (AC-1.7 ≤ 2 s). Wszystkie teksty
siedzą w `messages.js`, etykiety przycisków w `popup.html` po polsku.
Konsekwencje: znikają `run-in-page.js` i `snapshot-tab.js` (decyzja 4: jeden przepływ). `target.js` zostaje
(`classifyUrl`, `isFileAccessAllowed`, `isFirefoxRuntime`; `mapInjectionError` mapuje błędy `registerContentScripts`).

### D10 Limit nagrywania 10 min
Opcje: (a) `chrome.alarms` (nowe uprawnienie); (b) timer w tle (SW umiera po 30 s bezczynności); (c) **termin `deadline`
w stanie** + timer w MAIN + leniwe sprawdzenie w tle.
**Wybór: (c).**
Uzasadnienie: bez nowego uprawnienia. `deadline = startedAt + limitMs` trafia do MAIN w konfiguracji `hello`. Recorder:
(1) odrzuca każdy rekord z `timeOrigin + now() >= deadline` (dokładne odcięcie, odporne na dławienie timerów w kartach
w tle); (2) `setTimeout` na termin wywołuje `stop('time-limit')` (zdejmuje hooki, zachowuje bufory) i wysyła `stopped`
do tła. Tło przy `stopped` oraz leniwie przy każdym `getStatus`/`hello`/`collect` po terminie ustawia `status: 'stopped'`,
`stopReason: 'time-limit'`, wyrejestrowuje skrypty i zmienia badge na „■”. Nowy dokument po terminie dostaje
`record: false` (bez nagrywania, ale z kanałem do `collect`). Paczka: `recordingStoppedReason`.
`limitMs` = `RECORDING_LIMIT_MS` (600 000), chyba że w `storage.session` jest `pds:test:recordingLimitMs`. Ta wartość jest
przycinana do [1000, 600 000], a content scripty nie mają dostępu do `storage.session`. Harness ustawia ją przez SW.
Konsekwencje: AC-1.9, AC-4.9. Zapis po auto-stopie działa jak zwykły zapis.

### D11 E2E dla przepływu z tłem
Opcje: (a) wyłącznie QA ręczne; (b) rozszerzenie harnessu E0 (CDP `triggerAction`) o: dostęp do SW
(`context.serviceWorkers()` / `waitForEvent('serviceworker')`), wymuszone zatrzymanie SW (CDP `Target.closeTarget` na celu
`service_worker`), nadanie origin (PB-2: `developerPrivate.addHostPermission`), kliknięcia w popupie jako gest
(`Runtime.evaluate({ userGesture: true })`, bez tego `permissions.request` odrzuca), pobrania z prawdziwą nazwą
(`Browser.setDownloadBehavior({ behavior:'allow', downloadPath: mkdtemp, eventsEnabled: true })` przez `browserCdp`,
bo Playwrightowe `allowAndName` zapisuje pod GUID i psuje AC-2.1), limit testowy przez SW.
**Wybór: (b), weryfikowane spike'iem E1-T0 przed T18.**
Uzasadnienie: AC-1.3, 1.5, 2.1, 4.1–4.4 wymagają prawdziwego `document_start`, tła i pobrania. Wszystkie elementy (b) mają
znany mechanizm, ale nie były sprawdzone na tej wersji Chromium. Popup dalej nie jest `Page` (E0 T17). Plik czytamy
z `downloadPath` po nazwie z komunikatu `Zapisano`, a nie z Playwrightowego zdarzenia `download` (pobranie inicjuje popup).
Konsekwencje: stare specy E0 (smoke, double-click, failure, csp, restricted, packed-zip, harness) testują usunięty przepływ.
T17 je usuwa, a T18/T19 piszą odpowiedniki.

### D12 Schemat paczki v2
Opcje: (a) tylko pola z tabeli spec; (b) tabela spec + przypisanie rekordów do dokumentów (`documents[]`, `doc`)
+ jednoznaczny kształt rekordów sieci i błędów.
**Wybór: (b).**
Uzasadnienie: spec zostawia przypisanie do dokumentów designowi. Bez `doc` wartości `t` z różnych dokumentów (każdy ma własny
`timeOrigin`, AC-4.5) byłyby nieporównywalne. Rekordy `fetch` z E0 miały `input`/`init` jako `{}` dla `Request` (błąd
AC-5.2), więc normalizujemy je do `method`/`url`/`requestHeaders`. Kategorie danych się nie zmieniają (non-goal).
Szczegóły w sekcji „Schema paczki”.

### D13 Testy charakteryzacyjne E0 (`page-debug-snapshot.test.js`): los per funkcja
Opcje: (a) uruchomić je na nowych modułach bez zmian; (b) przenieść per funkcja, a świadomie zmienione zachowania zmienić jawnie.
**Wybór: (b)** (T3a, T3b, T17):
| Funkcja E0 | Los | Uzasadnienie |
|---|---|---|
| `loadPageScript` (2 testy) | zastąpione | brak IIFE z globalem; moduły importowane wprost |
| `deepMerge` ×4 | przeniesione bez zmian asercji + nowy `does not share references with source` | AC-6.5 |
| `safeSlice` ×3 | przeniesione bez zmian | zachowanie bez zmian |
| `pushLimited` | zastąpione testami `createBuffer` (ta sama semantyka „usuwa najstarsze, długość = max”) + `truncated` | AC-4.8 |
| `safeJson` funkcje / Error / Element / cykl / BigInt | przeniesione bez zmian | zachowanie bez zmian |
| `safeJson` „ten sam obiekt dwa razy → [Circular]” | **zmienione**: oczekiwane `{ first:{v:1}, second:{v:1} }` | test sam opisywał to jako dziwactwo do naprawy w E1; detekcja cykli po stosie przodków |
| `collectEnvironment` / `collectDomSnapshot` / `getPerformanceSummary` / `getStorageSnapshot` | nowe testy kluczy (dotąd brak) | sekcje „bez zmian treści” w v2 |
Konsekwencje: `tests/unit/helpers/load-page-script.js` i `page-debug-snapshot.test.js` znikają w T17.

## Architektura

```
 Zgłaszający ──klik ikony──▶ przeglądarka nadaje activeTab (tab.url widoczny w popupie)
                                   │
 ┌─────────────────────────────────▼──────────────────────────────────────────────────────────────┐
 │ POPUP  popup/popup.html + popup.js (DOM) + controller.js + view.js + messages.js  (moduły ES)  │
 │  przy otwarciu: tabs.query → classifyUrl, originPatternFor, isAllowedFileSchemeAccess,        │
 │                 runtime.sendMessage(getStatus); subskrypcja storage.session.onChanged          │
 │  klik Nagrywaj (jeden tick): sendMessage(armStart) ─▶ permissions.request({origins:[pattern]})│
 │                              → true: sendMessage(start) / false: sendMessage(disarm)           │
 │  klik Zapisz: sendMessage(collect) ⇒ {json,fileName} → Blob → URL.createObjectURL →           │
 │               downloads.download(...) ⇒ id → sendMessage(saveStarted{id,fileName})            │
 └───────────────┬──────────────────────────────────────────────────▲─────────────────────────────┘
                 │ runtime.sendMessage (router sprawdza sender.url = popup/)│ storage.session.onChanged
 ┌───────────────▼──────────────────────────────────────────────────┴─────────────────────────────┐
 │ TŁO  background.js (Chrome: service_worker, Firefox: event page; type: module)                 │
 │  stan WYŁĄCZNIE w storage.session (pds:rec, pds:doc:*, pds:pending, pds:last:*)                │
 │  start: registerContentScripts([ISOLATED bridge, MAIN recorder], pattern, document_start)      │
 │         → storage.session → action.setBadgeText(tabId,'●') → tabs.reload(tabId)               │
 │  listenery top-level: runtime.onMessage, tabs.onRemoved, downloads.onChanged,                  │
 │                       permissions.onAdded, runtime.onStartup, runtime.onInstalled              │
 └───────▲──────────────────────────────────────────────────┬─────────────────────────────────────┘
         │ runtime.sendMessage: hello / flush / stopped /    │ tabs.sendMessage(tabId,{collect|destroy},
         │ bridgeError (router: sender.tab, frameId 0)       │                  {frameId:0}) + timeout 15 s
 ┌───────┴───────────────────────────────────────────────────▼────────────────────────────────────┐
 │ ISOLATED  content/isolated-world.js  (chrome.runtime; NIE widzi JS strony)                     │
 │  document_start: tworzy odłączony węzeł N + nonce; handshake (niżej); hello → config → MAIN    │
 └───────▲──────────────────────────────────────────────────┬─────────────────────────────────────┘
         │ N.dispatchEvent(CustomEvent('pds:m2i',            │ N.dispatchEvent(CustomEvent('pds:i2m',
         │   {detail: JSON{n:nonce,v,id,type,payload}}))     │   {detail: JSON{n:nonce,v,id,type,payload}}))
         │   typy: result, flush, stopped                    │   typy: config, collect, destroy
 ┌───────┴───────────────────────────────────────────────────▼────────────────────────────────────┐
 │ MAIN  content/main-world.js  (ZERO chrome.*; bufory w domknięciu; marker Symbol.for(           │
 │  'pds.installed') = frozen {version}); hooki: console, fetch(Proxy), XHR(Proxy), error,        │
 │  unhandledrejection; collector (env/dom/perf/storage); pagehide(capture) → flush               │
 └───────▲────────────────────────────────────────────────────────────────────────────────────────┘
         │ wywołania console/fetch/XHR, zdarzenia error  (strona NIE ma referencji do N)
 ┌───────┴──────────┐
 │ STRONA (skrypty) │
 └──────────────────┘
```

**Handshake (synchroniczny, na `document_start`, zanim wykona się skrypt strony; kolejność światów dowolna):**
```
MAIN start:     addEventListener(document, 'pds:isolated-ready', onReady, capture) ; dispatch(document, Event('pds:main-ready'))
ISOLATED start: N = createElement('div') (odłączony), nonce = randomUUID()
                addEventListener(document, 'pds:main-ready', () => dispatch(document, MouseEvent('pds:isolated-ready', {relatedTarget:N})))
                dispatch(document, MouseEvent('pds:isolated-ready', {relatedTarget:N}))      ← pierwsza próba
MAIN onReady(e): jeśli niezwiązany: N = e.relatedTarget; listen(N,'pds:i2m'); usuń listener z document;
                 send 'hello-main' {version} przez N
ISOLATED:       na 'hello-main' zapamiętuje version, usuwa listener z document; nonce idzie w każdej wiadomości
```
Pierwsza wiadomość ISOLATED → MAIN to `config { n: nonce, record, docId, deadline }`. MAIN przyjmuje nonce z pierwszego
`config` i od tej pory odrzuca wiadomości z innym `n`.

**Przepływy:**
1. *Start*: popup `armStart` + `permissions.request` → `start` → tło: walidacja (`permissions.contains`, `classifyUrl`),
   zakończenie innego nagrania, `unregister` + `registerContentScripts` → `pds:rec` → badge → `tabs.reload` → odpowiedź `{startedAt}`.
2. *Dokument*: ISOLATED `hello` → tło (bramka D1, `docSeq++`, badge) → `{ record, docId, deadline }` → ISOLATED → MAIN `config`.
   `record:false` → MAIN `destroy()` + czyszczenie, kanał zostaje (dla `collect` po limicie).
3. *Nawigacja*: MAIN `pagehide` → `flush { docId, buffers }` → ISOLATED → tło → `pds:doc:<docId>` (budżet D4).
4. *Zapis*: popup `collect` → tło `tabs.sendMessage(collect)` (tylko gdy `tabs.get(tabId).url` ma origin nagrania) →
   ISOLATED → MAIN (synchronicznie: collector + kopie buforów) → `result` → tło: `assemblePackage(current, pds:doc:*)`
   → `{ json, fileName }` → popup: Blob → `downloads.download` → `saveStarted` → tło: `downloads.search` + `onChanged`
   → `complete`: sprzątanie (D7) / `interrupted`: `lastError`, nagranie trwa.
5. *Limit*: MAIN timer → `stop('time-limit')` → `stopped` → tło: `status: 'stopped'`, `unregister`, badge „■”
   (+ leniwie przy `getStatus`/`hello`/`collect`).
6. *Zamknięcie karty / restart*: `tabs.onRemoved` → `unregister` + wyczyszczenie stanu. Restart: `storage.session` jest pusty,
   skrypty mają `persistAcrossSessions: false`, a `onStartup` dodatkowo wyrejestrowuje.

## Zmiany w manifeście

| Klucz | Zmiana | Uzasadnienie (PL) / EN do formularza sklepu |
|---|---|---|
| `permissions: activeTab` | bez zmian | popup zna URL karty po kliknięciu. EN: „When the user clicks the toolbar icon, the extension reads the address of the current tab only, to offer recording of that site; without the click it cannot access any website.” |
| `permissions: scripting` | bez zmian (inne użycie) | rejestracja dołączonego skryptu nagrywania dla jednej wybranej strony. EN: „Registers the bundled recording script only for the site the user chose to record, so it runs from the start of the page load, and removes it after the report is saved.” |
| `permissions: storage` | **nowe** | stan nagrania w pamięci sesji. EN: „Keeps the recording state of the current tab (start time, site, save progress) in session memory that the browser clears on exit; recorded data is never written to persistent storage.” |
| `permissions: downloads` | **nowe** | zapis pliku i potwierdzenie, że plik naprawdę powstał. EN: „Saves the report file to the user's downloads and confirms the file was actually written before telling the user it is saved.” |
| `optional_host_permissions: ["http://*/*","https://*/*"]` | **nowe** | prośba w locie wyłącznie o stronę bieżącej karty. EN: „Requested at runtime only for the site the user chooses to record, so recording can start with the page load; access to other sites is never requested.” |
| `optional_host_permissions: "file:///*"` | **nowe — tylko przy PB-1 (A)** | nagrywanie pliku z dysku (Chrome, z przełącznikiem dostępu do plików). EN: „Requested only if the user chooses to record a local file opened in the browser.” |
| `background` | **nowe, w nakładkach** (D2) | Chrome: service worker; Firefox: event page; ten sam `background.js` |
| `host_permissions`, `web_accessible_resources`, `tabs`, `webRequest`, `cookies`, `alarms`, `offscreen` | brak (bez zmian / nie dodajemy) | AC-3.1, D8 |
| `version` | bez zmian w designie | podbicie do 0.3.0 robi release (z `npm run gen`, D6) |

`src/manifest.base.json`:
```json
{
  "manifest_version": 3,
  "name": "Page Debug Snapshot",
  "version": "0.2.0",
  "description": "Zapisuje do jednego pliku dane diagnostyczne bieżącej strony, aby przekazać je developerowi przy zgłoszeniu błędu.",
  "permissions": ["activeTab", "scripting", "storage", "downloads"],
  "optional_host_permissions": ["http://*/*", "https://*/*", "file:///*"],
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
(Przy PB-1 (B) bez `"file:///*"`.)

`src/manifest.chrome.json`:
```json
{
  "minimum_chrome_version": "121",
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
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
  },
  "background": {
    "scripts": ["background.js"],
    "type": "module"
  }
}
```
Rejestrowane dynamicznie (nie w manifeście, `src/lib/content-scripts.js`):
```js
[{ id: 'pds-bridge',   matches: [pattern], js: ['/content/isolated-world.js'], runAt: 'document_start', world: 'ISOLATED', allFrames: false, persistAcrossSessions: false },
 { id: 'pds-recorder', matches: [pattern], js: ['/content/main-world.js'],     runAt: 'document_start', world: 'MAIN',     allFrames: false, persistAcrossSessions: false }]
```
(Ścieżki z wiodącym `/` wg F7 z E0. Jeśli T0 pokaże, że Chrome odrzuca `/` w `registerContentScripts`, piszemy je bez `/`.
Tło leży w korzeniu, więc ścieżki względne są tam równoważne w obu przeglądarkach.)

## Schema paczki

`schemaVersion: 2` (zmiana łamiąca). Plik `page-debug-snapshot-<Date.now()>.json`, nazwę liczy tło. JSON z wcięciem 2.
Sekcja „Wersja 2” i tabela migracji trafiają do `docs/snapshot-schema.md` (T8a), fixture do `tests/fixtures/snapshots/v2.json`.

```jsonc
{
  "schemaVersion": 2,
  "extensionVersion": "0.3.0",                 // runtime.getManifest().version; w trybie console: RECORDER_VERSION
  "source": "extension",                       // | "console"
  "collectedAt": "ISO",
  "recordingStartedAt": "ISO",                 // klik Nagrywaj (extension) / wklejenie (console)
  "recordingStoppedReason": null,              // | "time-limit"   (AC-4.9)
  "timeOrigin": 1768471200000.5,               // bieżącego (ostatniego) dokumentu
  "documents": [                               // NOWE: w kolejności otwarcia; index = wartość `doc` w rekordach
    { "id": 0, "url": "…", "timeOrigin": 1768471190000.1, "navigationType": "reload",
      "recorded": true, "flushed": true, "current": false,
      "counts": { "consoleLogs": 12, "runtimeErrors": 1, "network": 4 },          // ile zebrano w dokumencie
      "kept":   { "consoleLogs": 12, "runtimeErrors": 1, "network": 4 } }         // ile trafiło do paczki
  ],
  "limits":    { "consoleLogs": 5000, "runtimeErrors": 1000, "network": 5000, "entryChars": 10000 },
  "truncated": { "consoleLogs": false, "runtimeErrors": false, "network": false },
  "notes": ["Recording started at … (page reloaded); earlier data is not included.", "…"],
  "environment": { … },   "dom": { … },   "performance": { … },   "storage": { … },   // jak v1, z bieżącego dokumentu; null + note, gdy niedostępny
  "consoleLogs":   [ { "t": 12.3, "doc": 1, "level": "error", "args": [ … ], "stack": "…" } ],
  "runtimeErrors": [ { "t": 10.1, "doc": 1, "type": "error", "message": "…", "filename": "…", "lineno": 3, "colno": 9,
                       "stack": "…" },
                     { "t": 11.0, "doc": 1, "type": "unhandledrejection", "message": "…", "stack": "…", "reason": { … } } ],
  "network":       [ { "t": 11.5, "doc": 1, "type": "fetch", "method": "POST", "url": "http://…/api/fail",
                       "status": 500, "statusText": "Internal Server Error", "ok": false, "redirected": false,
                       "durationMs": 3.21, "requestHeaders": { }, "responseHeaders": { }, "requestBody": "…", "error": null } ]
}
```

Diff v1 → v2 (tabela migracji dla viewer/MCP):
| v1 | v2 | Migracja przy odczycie v1 |
|---|---|---|
| `version: "1.0.0"` | usunięte; `schemaVersion: 2`, `extensionVersion` | brak `schemaVersion` ⇒ v1 |
| `initializedAt` | `recordingStartedAt` | przepisać |
| — | `source`, `recordingStoppedReason`, `timeOrigin`, `documents`, `limits`, `truncated` | `source: "extension"`, `timeOrigin = performance.timeOrigin`, jeden dokument, `truncated` nieznane |
| `consoleLogs[].timestamp` (ISO) | `t` (ms od `documents[doc].timeOrigin`), `doc`, `stack?` | `t = Date.parse(timestamp) - timeOrigin` |
| `runtimeErrors[].timestamp`, `error`, `reason` | `t`, `doc`, `stack`, `message` (też dla rejection), `reason?` | `stack = error.stack` |
| `network[].startedAt`/`startedAtIso`, `input`, `init`, `headers`, `body`, `responseURL`, `async`, `readyState`, `responseType` | `t`, `doc`, `method`, `url`, `requestHeaders`, `responseHeaders`, `requestBody`, `error` | `url = url ?? responseURL`, `responseHeaders = headers` |
| `environment`, `dom`, `performance`, `storage` | bez zmian treści (mogą być `null` z notatką) | — |

## Zadania

Konwencje: ścieżki względem roota repo. Każde zadanie pisze testy najpierw. „DoD” zawsze obejmuje: testy zielone,
`npm test` całość zielony, eslint czysty na zmienionych plikach (konfiguracja z T3a). Pliki wygenerowane (`src/content/*`,
`src/standalone/console-snapshot.js`) nie wliczają się do limitu linii.

### E1-T0 Spike: tło, uprawnienie, kanał i pobranie w Playwright (+ szybki test w Firefoksie)  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/spike/e1/run.spike.mjs` (generuje minimalne rozszerzenie w `os.tmpdir()`, jak T17 w E0),
`docs/epics/E1/spike-T0.md`.
Co zrobić (timebox: jeden przebieg; zacząć jako pierwsze, równolegle z grupą B):
- S1: uchwyt SW (`context.serviceWorkers()` / `waitForEvent('serviceworker')`), `evaluate(() => chrome.runtime.id)`.
- S2: zatrzymanie SW przez `browserCdp` `Target.closeTarget` na celu `service_worker`, potem wybudzenie komunikatem z popupu.
  Czy `storage.session` przetrwał?
- S3: nadanie origin: `chrome.developerPrivate.addHostPermission(id, 'http://127.0.0.1/*')` na `chrome://extensions`
  → `permissions.contains` w SW. Gdy to nie działa: kopia z `host_permissions` (PB-2).
- S4: klik w popupie przez `Runtime.evaluate({ userGesture: true })` → `permissions.request` zwraca `true` bez okna;
  dla kontroli bez `userGesture` (zapisać komunikat błędu).
- S5: `registerContentScripts` (MAIN + ISOLATED, `document_start`, `js: ['/x.js']`) + `tabs.reload` → inline'owy błąd z `<head>`
  złapany 10/10.
- S6: handshake D3 (MouseEvent `relatedTarget` + CustomEvent ze stringiem) między światami w Chromium; skrypt strony dodany
  po handshake'u nie widzi żadnej wiadomości. Wariant fallback z dopięciem węzła.
- S7: popup: Blob + `downloads.download` przy `Browser.setDownloadBehavior({behavior:'allow', downloadPath})`. Plik ma
  prawdziwą nazwę, SW widzi `onChanged complete`, `downloads.search` daje ten sam basename.
- S8 (ręcznie, ~10 min, Firefox stable przez `web-ext run`): moduł `background.scripts` + `type: module` ładuje się;
  `storage.session` działa; `registerContentScripts` z `world: 'MAIN'` wyprzedza inline w `<head>`; handshake S6 działa;
  `permissions.request` z popupu: czy popup się zamyka (zapisać).
Testy do napisania najpierw (w skrypcie spike'u, raport PASS/FAIL per punkt): `spike: S1 service worker handle`,
`spike: S2 SW restart keeps storage.session`, `spike: S3 origin granted via developerPrivate`, `spike: S4 gesture click resolves
permissions.request`, `spike: S5 document_start before inline head script 10/10`, `spike: S6 private channel invisible to page`,
`spike: S7 popup blob download lands with real name`.
Definicja ukończenia: `spike-T0.md` z wynikami S1–S8, wersjami (Chromium, Playwright, Firefox) i decyzją dla T18
(wariant PB-2 tak/nie, ścieżki z `/` tak/nie, handshake: `relatedTarget` czy fallback). Przy porażce S3 orkiestrator idzie
z PB-2 do użytkownika przed T18. Przy porażce S6/S7 architekt dostaje raport (zmiana D3/D7).

### E1-T3a Serializacja i bufory; konfiguracja eslint dla nowych katalogów  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/serialize.js`, `src/page/buffer.js`, `tests/unit/serialize.test.js`, `tests/unit/buffer.test.js`, `eslint.config.js`.
Co zrobić:
- `serialize.js` (moduł ES, bez DOM-zależności poza `Element`/`Node` z `globalThis`): `safeSlice(value, max)`,
  `safeJson(value, { outerHtmlMax = 2000 })` z detekcją cykli po **stosie przodków** (współdzielona referencja bez cyklu
  nie daje `[Circular]`), `deepMerge(target, source)` kopiujący zagnieżdżone obiekty ze źródła (bez współdzielonych referencji),
  `serializeCapped(value, maxChars)` → `{ value, chars, truncated }` (powyżej limitu `{ truncated: true, preview }`).
- `buffer.js`: `createBuffer({ maxItems, maxChars })` → `{ push(entry, chars), items(), truncated, size, chars, clear() }`.
  Usuwa najstarsze wpisy, aż oba limity są spełnione.
- `eslint.config.js`: `src/page/**` → `sourceType: module`, globals browser (+ webextensions tylko dla
  `src/page/isolated-entry.js`); `src/content/**` i `src/standalone/**` → script, browser; `src/lib/**` i `src/background.js`
  → module, `webextensions` + `serviceworker`; `no-restricted-globals` dodatkowo `window`, `document` w
  `src/lib/**`/`src/background.js`.
Testy do napisania najpierw:
- `deepMerge merges nested objects`, `deepMerge replaces arrays`, `deepMerge returns copy of target for null/non-object source`,
  `deepMerge does not mutate target` (przeniesione z E0, te same asercje), **`deepMerge does not share references with source`** (AC-6.5).
- `safeSlice keeps short string`, `safeSlice truncates with exact N suffix`, `safeSlice returns non-string unchanged` (przeniesione).
- `safeJson`: `named and anonymous functions`, `Error to {name,message,stack}`, `Element to summary with outerHTML ≤ 2000 + suffix`,
  `cycle to [Circular]`, `BigInt to serializationError+fallback` (przeniesione); **`same object twice without cycle is serialized twice`** (D13).
- `serializeCapped returns preview and truncated:true above limit`.
- `buffer drops oldest and keeps length max` (semantyka E0 `pushLimited`), `buffer truncated is false below limits`,
  `buffer evicts by total chars`, `6000 pushes with max 5000 keep newest 5000 and truncated` (AC-4.8, część unit).
Definicja ukończenia: testy zielone; `npx eslint src/page tests/unit/serialize.test.js tests/unit/buffer.test.js` czysty.

### E1-T3b Collector (env/dom/perf/storage) jako moduł  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/collector.js`, `tests/unit/collector.test.js`.
Co zrobić:
- Przenieść z `page-debug-snapshot.js` `collectEnvironment`, `collectDomSnapshot`, `getPerformanceSummary`, `getStorageSnapshot`,
  `getAttributes`, `textContentShort`, `getElementSummary` jako funkcje `(win, doc, deps)`. Treść pól bez zmian (v2:
  „bez zmian treści”). `deps.safeSlice` wstrzykiwany (bez importu z T3a, żeby T3a i T3b szły równolegle).
- `export function collectPageState({ win, doc, safeSlice, limits })` → `{ environment, dom, performance, storage }`.
  Każda sekcja w osobnym `try`; błąd daje `null` + wpis do zwracanej tablicy `errors` (nazwa sekcji i `error.name`).
- Bez pływającego przycisku, toastu i `download()` (E0 UI znika).
Testy do napisania najpierw (jsdom):
- `environment keeps v1 keys` (location, document, navigator, screen, viewport, timestamp).
- `dom keeps v1 keys` (counts, html, meta, canonical, hreflangs, scripts, stylesheets, images, iframes, forms, rootMarkers).
- `dom forms redact password and hidden as in v1`.
- `storage keeps cookies string and local/session maps` (v1).
- `performance returns timeOrigin and navigation shape` (fake `performance`).
- `a throwing section yields null and an error entry, other sections intact`.
Definicja ukończenia: testy zielone; klucze sekcji identyczne z v1 (porównanie z listą w teście).

### E1-T4 Hooki sieciowe: fetch (Proxy) i XHR (Proxy construct)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/hooks-network.js`, `tests/unit/hooks-network.test.js`.
Co zrobić:
- `installFetchHook({ win, now, record, json, intrinsics })` → `restore()`. `installXhrHook({ … })` → `restore()`. Zachowanie
  według D5. `record('network', entry)`, `json` = serializacja wstrzyknięta (fake w testach).
- `method`/`url` z `Request` i `URL`; `requestHeaders` z `Headers`/obiektu/tablicy; `requestBody` jako podgląd.
- XHR: proxy `construct` przez `Reflect.construct(target, args, newTarget)`, metody instancji przez `Object.defineProperty`
  (`enumerable: false`), wywołanie bieżącego `XMLHttpRequest.prototype[m]` (odczyt w chwili wywołania).
- Recorder wyłączony (`enabled()` false) ⇒ czyste przejście bez rekordów.
Testy do napisania najpierw (jsdom XHR; fetch = funkcja-atrapa „natywna” zwracająca `Response` z Node):
- `new XMLHttpRequest() instanceof XMLHttpRequest after install`, `XMLHttpRequest.DONE === 4 and UNSENT/OPENED/HEADERS_RECEIVED/LOADING`,
  `XMLHttpRequest.prototype is the original object and its methods are untouched`,
  `withCredentials, responseType and onreadystatechange work`, `axios-like wrapper (open, setRequestHeader, send, onload) records method/url/status` (AC-5.1).
- `instance methods are non-enumerable (Object.keys(xhr) unchanged)`.
- `page patch on XMLHttpRequest.prototype.open after install is still called`.
- `fetch(new Request(url,{method:'POST'})) records POST and absolute url`, `fetch(new URL(...)) records url`,
  `fetch returns the same response object and does not consume body (bodyUsed false)`, `fetch rejection is rethrown unchanged and recorded with error` (AC-5.2).
- `fetch.name/length unchanged`.
- `restore() puts back identical window.fetch and window.XMLHttpRequest` (AC-5.3, część).
- `recorder exception inside hook never breaks the page call`.
Definicja ukończenia: testy zielone; brak importów z innych plików `src/page/*`.

### E1-T5 Hooki console i błędów  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/hooks-console.js`, `src/page/hooks-errors.js`, `tests/unit/hooks-console.test.js`, `tests/unit/hooks-errors.test.js`.
Co zrobić:
- `installConsoleHook({ win, now, record, json, levels, intrinsics })` → `restore()`. Rekord `{ t, level, args, stack }`
  według D5; `Reflect.apply(orig, console, args)` dokładnie raz, także gdy rekord się nie uda.
- `stackFromHere()`: `new Error().stack` bez nagłówka `Error` (Chrome) i bez pierwszej ramki; format Firefoksa (`fn@url:l:c`)
  też obsłużony; ≤ 4000 znaków.
- `installErrorHooks({ win, now, record, json })` → `restore()`: `error` → `{ t, type:'error', message, filename, lineno, colno, stack }`,
  `unhandledrejection` → `{ t, type, message, stack, reason }`.
Testy do napisania najpierw:
- `console.error calls the original once with same args and console as this` (szpieg na oryginale) (AC-4.6).
- `console record has stack containing the calling function name` (np. `function callerMarker()`) (AC-4.6).
- `stack strips recorder frame and Error header`, `stack parses Firefox format sample`, `stack omitted when Error.stackTraceLimit is 0`.
- `restore() restores identical console methods` (AC-5.3, część).
- `ErrorEvent dispatched on window is recorded with message/filename/lineno/stack`,
  `unhandledrejection with Error and with plain value is recorded`, `restore() removes both listeners (no record after)` (AC-5.3, część).
Definicja ukończenia: testy zielone.

### E1-T13 Prywatny kanał MAIN ↔ ISOLATED  [niezależne: tak]  [zależy od: — (wynik T0 S6 może zmienić wariant handshake'u)]
Pliki: `src/page/channel.js`, `tests/unit/channel.test.js`.
Co zrobić:
- `connectMain({ doc, intrinsics, onMessage })` i `connectIsolated({ doc, onMessage, randomUUID })` według D3 (handshake
  niezależny od kolejności, `MouseEvent.relatedTarget`, listenery na `document` zdejmowane po związaniu).
  Zwracają `{ send(type, payload, id?), whenBound, isBound, close() }`.
- Wiadomości to string JSON `{ n, v: PROTOCOL, id, type, payload }`. Odbiorca odrzuca: nie-string, zły JSON, inne `v`, inne `n`
  (po ustaleniu), nieznany `type`.
- Wariant fallback (dopięcie węzła do `documentElement` na czas synchronicznego handshake'u) za przełącznikiem `{ attachNode: true }`.
Testy do napisania najpierw (jsdom; dwa „światy” = dwie niezależne instancje na tym samym `document`):
- `handshake binds when MAIN starts first`, `handshake binds when ISOLATED starts first`.
- `messages round-trip both directions synchronously`.
- `after binding no listener remains on document` (spy na `removeEventListener`).
- `page listener on document and window sees no message after binding` (AC-5.6).
- `forged pds:isolated-ready after binding is ignored by MAIN` (AC-5.6).
- `message with wrong nonce, wrong version or non-string detail is dropped` (AC-5.6).
- `fallback attachNode leaves documentElement unchanged after handshake`.
Definicja ukończenia: testy zielone; kanał bez odwołań do `chrome.*` i `postMessage`.

### E1-T14 Generator bundli klasycznych  [niezależne: tak]  [zależy od: —]
Pliki: `scripts/gen-content.mjs`, `tests/unit/gen-content.test.js`, `package.json` (skrypt `"gen": "node scripts/gen-content.mjs"`).
Co zrobić:
- `export function bundle({ entries, srcDir, header })` → string: rozwiązuje jednolinijkowe względne importy w kolejności DFS
  (każdy moduł raz), usuwa linie `import`, zdejmuje `export ` z `export function|const|let|class`, opakowuje w
  `(function () { 'use strict'; … })();\n` z nagłówkiem `GENERATED`. Rzuca na: `export default`, `export {`, `import(`,
  import nierelatywny, import wieloliniowy, `require(`. Weryfikacja składni przez `new vm.Script(code)`.
- `export const BUNDLES` = `content/main-world.js` ← `page/main-entry.js`, `content/isolated-world.js` ← `page/isolated-entry.js`,
  `standalone/console-snapshot.js` ← `page/console-entry.js`. `generateAll({ check })`: zapis albo porównanie (`--check` daje kod 1
  przy różnicy). Brakujący plik wejściowy (wejścia powstają w T15/T7) = wyraźny błąd z nazwą.
Testy do napisania najpierw (fixture moduły w `os.tmpdir()`):
- `bundles modules in dependency order, each once`.
- `strips imports and export keywords; output has no import/export tokens`.
- `wraps in IIFE: top-level names do not leak to global` (uruchomienie w `vm` z pustym kontekstem, `Object.keys(ctx)` puste).
- `throws on export default / multi-line import / bare specifier`.
- `throws SyntaxError on duplicate top-level names across modules`.
- `check mode reports stale output`.
Definicja ukończenia: testy zielone; `npm run gen` działa (dla nieistniejących jeszcze wejść kończy się czytelnym błędem).

### E1-T11 Walker: `js: [...]` i fail-safe na nierozwiązywalne referencje  [niezależne: tak]  [zależy od: —]
Pliki: `scripts/lib/reachability.mjs`, `tests/unit/reachable-files.test.js`.
Co zrobić:
- W JS: `js: [ '…' ]` (jak `files:`, root-relative, tylko literały, inaczej błąd) dla `registerContentScripts`.
- Fail-safe (AC-6.3): rzucać `Unresolvable reference in <file>: <match>` przy `url(` w HTML/CSS/JS, `runtime.getURL(`,
  `import(` z template literal lub zmienną, `importScripts(`.
- Nie zmieniać obsługi manifestu (background/content_scripts już działa).
Testy do napisania najpierw:
- `follows js: [...] in registerContentScripts as root-relative` (z wiodącym `/` i bez).
- `rejects non-literal entry in js: [...]`.
- `throws on url( in html style / css / js`, `throws on chrome.runtime.getURL(`, `throws on import() with template literal`,
  `throws on importScripts(` (AC-6.3).
- `existing src/ still builds` (regresja: `collectReachable` na `src` z manifestem bazowym przechodzi).
Definicja ukończenia: testy zielone; `node scripts/build.mjs` kod 0.

### E1-T16 Uprawnienia w manifeście bazowym + README  [niezależne: tak]  [zależy od: —]
Pliki: `src/manifest.base.json`, `tests/unit/manifest-sources.test.js`, `tests/unit/manifest-parity.test.js`, `tests/unit/build.test.js`, `README.md`.
Co zrobić:
- Baza według sekcji „Zmiany w manifeście” (`permissions`, `optional_host_permissions`; `background` dopiero w T1c).
- Testy: dozwolone `permissions` = {activeTab, scripting, storage, downloads}; `optional_host_permissions` dokładnie
  [`http://*/*`, `https://*/*`(, `file:///*` przy PB-1 A)]; brak `host_permissions` (lub puste); lista dozwolonych kluczy
  nakładek: chrome ⊆ {`minimum_chrome_version`, `background`}, firefox ⊆ {`browser_specific_settings`, `background`}.
  Test E0 „sources have no broad host permissions” zmienić: dotyczy tylko `host_permissions`.
- README `## Uprawnienia`: po jednej linii PL dla `storage`, `downloads`, `optional_host_permissions` i zaktualizowane
  `activeTab`/`scripting`; w części „do formularzy” PL+EN z tabeli wyżej.
Testy do napisania najpierw:
- `permissions subset of activeTab, scripting, storage, downloads; no tabs, webRequest, cookies` (AC-3.1).
- `no host_permissions or empty`, `optional_host_permissions exactly http/https[/file]` (AC-3.1).
- `dist manifests: same permission rules` (`build.test.js`) (AC-3.1).
- `README Uprawnienia mentions every permission and optional_host_permissions, each with PL and EN line` (AC-3.5).
- `overlays only use allowed target keys` (rozszerzony o `background`).
Definicja ukończenia: testy zielone; `web-ext lint` 0 errors (warnings wpisane do state.md).

### E1-T1a Tło — biblioteka: origin, magazyn sesji, fałszywe API  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/origin.js`, `src/lib/session-store.js`, `tests/unit/helpers/fake-chrome.js`, `tests/unit/background-lib.test.js`.
Co zrobić:
- `originPatternFor(url)` → `{ origin, pattern } | null`: http/https → `origin` = `URL.origin`, `pattern` = `${protocol}//${hostname}/*`
  (IPv6 w nawiasach); `file:` → `{ origin: 'file://', pattern: 'file:///*' }` (PB-1 A); inne → `null`. `originOf(url)`.
- `createStore(area)` nad `storage.session`: `getRec`, `updateRec(fn)` (read-modify-write w kolejce), `clearRec`, `putDoc(id, data)`
  z budżetem (D4: 3 MB per dokument, 8 MB razem; przy przekroczeniu lub błędzie quota zapisuje `{ counts, dropped: true }`),
  `listDocs()`, `clearDocs()`, `getPending/setPending/clearPending`, `getLast/setLast(tabId)`, `getTestLimit()`. Klucze według D2.
- `fake-chrome.js`: atrapy `storage.session` (z `onChanged` i opcjonalnym limitem quota), `scripting.(un)registerContentScripts`/
  `getRegisteredContentScripts`, `tabs.reload/get/sendMessage/onRemoved`, `action.setBadgeText/BackgroundColor/getBadgeText`,
  `permissions.request/contains/onAdded`, `downloads.download/search/cancel/onChanged`, `runtime.getManifest/getURL/id/onMessage`.
  Każde wywołanie trafia do logu `calls`.
Testy do napisania najpierw:
- `originPatternFor` tabela: `http://127.0.0.1:8080/a?b` → pattern `http://127.0.0.1/*`, origin z portem;
  `https://example.com/` → `https://example.com/*`; `http://[::1]:3000/` → `http://[::1]/*`; `file:///C:/a.html` → `file:///*`;
  `chrome://version`, `about:blank`, `undefined` → `null` (AC-3.2).
- `pattern is exactly one <scheme>://<host>/* string` (regex AC-3.2).
- `updateRec serializes concurrent updates (no lost write)`.
- `putDoc over per-document budget keeps newest entries and marks truncated`.
- `putDoc over total budget drops oldest documents to counts only`.
- `putDoc on quota error stores counts only`.
- `store never touches storage.local` (atrapa `storage.local` rzuca).
Definicja ukończenia: testy zielone; moduły bez `window`/`document`.

### E1-T8a Składanie paczki v2 + dokumentacja schematu  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/package.js`, `tests/unit/package.test.js`, `tests/fixtures/snapshots/v2.json`, `docs/snapshot-schema.md`.
Co zrobić:
- `assemblePackage({ meta, current, priorDocs })` → obiekt v2 według sekcji „Schema paczki”. `meta` = `{ extensionVersion, source,
  startedAt, collectedAt, stopReason, limits }`. `current` = wynik `collect` z MAIN albo `null`, `priorDocs` = zrzuty
  z `pds:doc:*` (bez `docId` bieżącego). Rekordy dostają `doc`. Kolejność: dokumenty rosnąco, w dokumencie po `t`.
  Limity globalne zachowują najnowsze, a `truncated` = OR z dokumentów lub globalnego cięcia. `documents[].counts/kept`.
- `notes` (EN): zakres nagrania; pominięte dokumenty z liczbami; brak bieżącego dokumentu (sekcje `null`); dokumenty bez zrzutu
  (`flushed: false`); auto-stop.
- `packageFileName(now)` → `page-debug-snapshot-<now>.json`.
- `docs/snapshot-schema.md`: sekcja „Wersja 2” (tabela pól jak v1), tabela migracji v1→v2, nota o `doc`/`documents`, limity.
Testy do napisania najpierw:
- `header has schemaVersion 2, extensionVersion, source, collectedAt and recordingStartedAt as ISO, numeric timeOrigin` (AC-4.5).
- `every record in consoleLogs/runtimeErrors/network has numeric t and doc index into documents` (AC-4.5).
- `prior and current documents merged in order with documents[] metadata` (AC-4.4).
- `dropped prior document produces a note with its counts` (AC-4.4).
- `global limit keeps newest and sets truncated; no limit hit → truncated false` (AC-4.8).
- `recordingStoppedReason is time-limit or null` (AC-4.9).
- `current null → environment/dom/performance/storage null and a note` (AC-3.4).
- `fixture v2.json matches assemblePackage output shape` (klucze i typy) i `fixture contains only synthetic data` (domeny testowe).
Definicja ukończenia: testy zielone; `docs/snapshot-schema.md` ma sekcje v2 + migracja.

### E1-T6a Słownik komunikatów i `popup.html`  [niezależne: tak]  [zależy od: —]
Pliki: `src/popup/messages.js`, `src/popup/popup.html`, `tests/unit/messages.test.js`, `tests/unit/popup-html.test.js`.
Co zrobić:
- `MESSAGES` (PL): `disclosureTitle` „Do pliku trafią:”; `disclosureItems` = [„adres strony i dane przeglądarki”, „logi konsoli
  i błędy”, „zapytania sieciowe (adresy i nagłówki)”, „treść i struktura strony, w tym wartości wpisane w formularze”,
  „ciasteczka i dane zapisane przez stronę”]; `noUpload` „Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła.”;
  `reloadNotice` „Po kliknięciu „Nagrywaj” strona odświeży się, a nagrywanie zacznie się od jej początku.”; `starting`;
  `recordingSince(hhmmss)` → `Nagrywam od ${hhmmss}`; `recordingHint` „Odtwórz problem, a potem kliknij „Zapisz paczkę”.”;
  `stoppedByLimit` „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.”; `saving` „Zapisuję paczkę…”; `saved(fileName)`
  „Zapisano plik ${fileName} — znajdziesz go w pobranych plikach.”; `saveCancelled` „Zapis został przerwany lub anulowany.
  Nagrywanie trwa — kliknij „Zapisz paczkę” ponownie.”; `pageBusy` „Strona jeszcze się ładuje albo nie odpowiada. Poczekaj chwilę
  i kliknij „Zapisz paczkę” ponownie.”; `permissionDenied` „Bez Twojej zgody na dostęp do tej strony nie da się jej nagrać.
  Kliknij „Nagrywaj” ponownie i wybierz „Zezwól”.”; `otherOrigin` „Ta karta pokazuje teraz inną stronę. Nagranie obejmuje tylko
  stronę, na której je rozpoczęto — możesz zapisać to, co zebrano.”; `otherTabRecording` „Trwa nagrywanie w innej karcie.
  Kliknięcie „Nagrywaj” zakończy je bez zapisu.”; `recordFailed` „Nie udało się rozpocząć nagrywania. Odśwież stronę i spróbuj
  ponownie.”; `restricted`, `fileAccess`, `noTab`, `failed` bez zmian (regresja E0 AC-1.3/1.6).
- `formatClock(epochMs)` → `HH:MM:SS` (lokalny czas, `padStart`).
- `popup.html`: sekcje `#ready` (lista ujawnienia, `#noUpload`, `#reloadNotice`, `<button id="record">Nagrywaj</button>`),
  `#recording` (`#since`, `#hint`, `#note`, `<button id="save">Zapisz paczkę</button>`), `#status`. Teksty statyczne w HTML
  są identyczne ze słownikiem (test).
Testy do napisania najpierw:
- `messages contain no forbidden words` (rekurencyjnie po stringach, tablicach i funkcjach z przykładowym argumentem) (AC-1.8).
- `disclosure lists the five categories from AC-1.1 and the no-upload sentence verbatim`, `reload notice mentions odświeży` (AC-1.1).
- `recordingSince matches ^Nagrywam od \d{2}:\d{2}:\d{2}` (AC-1.3); `formatClock pads to two digits`.
- `stoppedByLimit text` (AC-1.9).
- `restricted still starts with "Na tej stronie nie da się zapisać paczki."` (regresja E0 AC-1.3).
- `popup.html: every <button> has a Polish label from the allowed set (Nagrywaj, Zapisz paczkę), none English` (AC-1.8).
- `popup.html static disclosure text equals MESSAGES` (AC-1.1).
Definicja ukończenia: testy zielone.

### E1-T3c Recorder: kompozycja hooków, marker, stop/destroy, limit  [niezależne: nie]  [zależy od: T3a, T4, T5]
Pliki: `src/page/recorder.js`, `src/page/constants.js`, `tests/unit/recorder.test.js`.
Co zrobić:
- `constants.js`: `RECORDER_VERSION` (= `version` z `manifest.base.json`), `PROTOCOL = 1`, `LIMITS` (D5), `MARKER_KEY = 'pds.installed'`.
- `createRecorder({ win, options })`: przechwytuje intrinsics, instaluje hooki (T4, T5) z `record` → bufory (T3a) i
  `serializeCapped`. API: `isInstalled(win)`, `install()` (marker; no-op przy istniejącym markerze), `setConfig({ record, deadline })`,
  `stop(reason)` (zdejmuje hooki, zachowuje bufory, ignoruje dalsze rekordy), `destroy()` (zdejmuje hooki + czyści bufory),
  `exportBuffers()` → `{ consoleLogs, runtimeErrors, network, truncated, counts }` (kopie), `timeOrigin`.
- Odcięcie po terminie: rekord z `timeOrigin + now() >= deadline` jest odrzucany; `setTimeout` na termin woła `stop('time-limit')`
  i callback `onStopped`.
- Fail-safe: bez `setConfig` w ciągu 10 s → `destroy()`.
- Recorder nic nie pisze do `console`.
Testy do napisania najpierw (jsdom + fałszywy zegar):
- `install defines non-enumerable frozen marker with version only` (AC-5.4/5.5); `second install in same window is a no-op and does not double entries` (AC-5.5).
- `window own property names/symbols after install differ only by the marker; no __PAGE_DEBUG_SNAPSHOT__ / PageDebugSnapshot` (AC-5.4).
- `destroy restores fetch, XMLHttpRequest and console methods (===) and removes error listeners` (AC-5.3).
- `recorder never writes to console` (szpieg na oryginałach: tylko wywołania strony) (AC-4.7).
- `6000 console.log keep 5000 newest, truncated.consoleLogs true; 10 logs → truncated false` (AC-4.8).
- `stop('time-limit') removes hooks, keeps buffers, ignores later records` (AC-1.9); `records after deadline are dropped even if timer is late` (AC-4.9).
- `no config within 10 s → destroyed and buffers empty` (D1 fail-safe).
- `setConfig({record:false}) destroys and clears` (AC-3.3, część).
- `RECORDER_VERSION equals manifest.base.json version`.
Definicja ukończenia: testy zielone.

### E1-T1b Tło — nagrywanie: start, hello, flush, status, zamknięcie karty  [niezależne: nie]  [zależy od: T1a]
Pliki: `src/lib/content-scripts.js`, `src/lib/recording.js`, `tests/unit/content-scripts.test.js`, `tests/unit/recording.test.js`.
Co zrobić:
- `content-scripts.js`: `SCRIPT_IDS`, `scriptsFor(pattern)` (opis z sekcji manifestu, ścieżki jako literały w `js: [...]`),
  `registerFor(scripting, pattern)` (najpierw wyrejestrowanie istniejących), `unregisterAll(scripting)` (ignoruje „nie istnieje”),
  `setBadge(action, tabId, 'recording'|'stopped'|'none')` (`'●'` czerwony / `'■'` szary / `''`).
- `createRecordingHandlers(api)` → `armStart`, `disarm`, `start`, `hello`, `flush`, `bridgeError`, `getStatus`, `onTabRemoved`,
  `onPermissionAdded`, `onStartup`, `onInstalled`. Zachowanie według D1, D2, D4, D9. Limit z T12 (`resolveLimitMs`) na razie
  jako stała 600 000 ms, wpięcie w T12.
- `start`: idempotentny po `requestId`; `permissions.contains` → inaczej `permissionDenied` bez rejestracji; inne nagranie
  → zakończ (unregister, `destroy` do starej karty best-effort, `clearDocs`); błąd rejestracji → `mapInjectionError` → `restricted`/`recordFailed`.
- `getStatus({ tabId, url })` → `{ state, startedAt, stopReason, isRecordingTab, otherTabRecording, otherOrigin, lastSaved, lastError }`.
  `lastError` jest jednorazowy (czyszczony po odczycie).
Testy do napisania najpierw (fake-chrome):
- `scriptsFor: MAIN and ISOLATED, document_start, allFrames false, persistAcrossSessions false, js root-relative` (AC-6.2).
- `start registers both scripts, stores state, sets badge, then reloads tab exactly once` (AC-1.3).
- `start twice with same requestId reloads once` (AC-1.3); `onPermissionAdded with fresh pending starts recording`.
- `start without granted permission returns permissionDenied and does not register or reload` (AC-1.4).
- `stale pending without permission is reported once as permissionDenied by getStatus` (AC-1.4).
- `hello from recording tab and exact origin → record:true with docId and deadline; badge set` (AC-1.6).
- `hello from another tab → record:false` (AC-3.3); `hello from another origin or port → record:false` (AC-3.4).
- `getStatus marks otherOrigin when tab url origin differs` (AC-3.4).
- `fresh handler instance reads the same status after restart (no module state)` (AC-1.5).
- `flush stores document via store.putDoc and marks flushed` (AC-4.4).
- `start in another tab ends the previous recording without saving` (D1).
- `onTabRemoved for recording tab unregisters and clears state; other tab ignored` (AC-2.6).
- `onStartup/onInstalled unregister scripts and clear state` (AC-2.6).
- `bridge messages accepted only from sender.tab with frameId 0` (D2).
Definicja ukończenia: testy zielone.

### E1-T8b Tło — zapis: zbieranie, śledzenie pobrania, limity czasu  [niezależne: nie]  [zależy od: T1a, T8a]
Pliki: `src/lib/save.js`, `tests/unit/save.test.js`.
Co zrobić:
- `createSaveHandlers(api)` → `collect({ tabId })`, `saveStarted({ downloadId, fileName })`, `saveFailed({ reason })`,
  `onDownloadChanged(delta)`, `expireSave(now)`.
- `collect`: stan `recording|stopped` dla tej karty, potem `save.phase = 'collecting'`. Gdy `tabs.get(tabId).url` ma origin
  nagrania: `tabs.sendMessage(tabId, { type:'collect' }, { frameId: 0 })` z timeoutem 15 s. Wynik walidowany: string JSON
  z `protocol`, `recorderVersion === runtime.getManifest().version` (inaczej `failed`; zastępuje backlogowy T9) i `docId`.
  Potem `assemblePackage` z `pds:doc:*` → `{ ok:true, json, fileName }`. Timeout → `{ ok:false, reason:'pageBusy' }`,
  brak odbiorcy → `failed`. Nazwę pliku zawsze ustala tło; pola `fileName`/`ok` z treści od karty są ignorowane.
- `saveStarted`: `save = { phase:'downloading', downloadId, … }`, potem od razu `downloads.search({ id })` (wyścig z `onChanged`).
- `onDownloadChanged`: tylko nasze `downloadId`. `complete` → basename z `downloads.search`, potem sprzątanie D7 i `setLast`.
  `interrupted` → `save = null`, `lastError: 'saveCancelled'` (`USER_CANCELED` i inne), nagranie trwa.
- `expireSave`: `collecting` > 15 s → `pageBusy`; `downloading` > 60 s → `downloads.cancel` + `failed`.
Testy do napisania najpierw (fake-chrome + fałszywy zegar):
- `success is reported only after onChanged complete; message file name equals basename from downloads.search (uniquify)` (AC-2.1).
- `interrupted and USER_CANCELED keep recording and set saveCancelled; second collect returns the same earlier entries` (AC-2.2).
- `no collect answer within 15 s → pageBusy, never success` (AC-2.4); `download not complete within 60 s → cancel + failed` (AC-2.4).
- `after complete: unregister, destroy sent to tab, docs cleared, badge cleared, last saved stored` (AC-2.5).
- `content result cannot set file name or success` (AC-5.6).
- `recorderVersion mismatch → failed`.
- `tab on other origin → package from stored docs only with note` (AC-3.4).
- `download events for other ids are ignored`.
Definicja ukończenia: testy zielone.

### E1-T6b Popup: widok, kontroler, DOM  [niezależne: nie]  [zależy od: T6a, T1a (origin.js)]
Pliki: `src/popup/view.js`, `src/popup/controller.js`, `src/popup/popup.js`, `tests/unit/popup-view.test.js`, `tests/unit/popup-controller.test.js`.
Co zrobić:
- `view.js`: `renderModel(status, ctx, now)` → `{ section: 'ready'|'recording', since, note, statusText, isError, buttons: { record, save } }`
  dla stanów z D9; dla `restricted`/`fileAccess`/`noTab` model bez prośby o zgodę.
- `controller.js`: `createController(api)` z `api` = `{ runtime, permissions, downloads, storage, tabs, URL, Blob, now, setTimeout }`.
  `init()` (tab, `classifyUrl`, `originPatternFor`, sonda plików, `getStatus`, subskrypcja `storage.session.onChanged`).
  `onRecord()` — **synchronicznie**: `armStart` (bez `await`), potem `permissions.request({ origins:[pattern] })`; dalej `start`/`disarm`.
  `onSave()` — `collect` z wyścigiem 15 s, potem Blob/URL/`downloads.download({ url, filename, saveAs:false, conflictAction:'uniquify' })`
  i `saveStarted`; błąd `downloads.download` → `saveFailed`. Przy stanie końcowym `revokeObjectURL`. Sukces wyłącznie ze stanu tła.
- `popup.js`: tylko DOM (przyciski, sekcje, `textContent`), `console.error` z detalami dla developera.
Testy do napisania najpierw (fałszywe `api`):
- `ready model shows disclosure section and record button` (AC-1.1); `recording model since matches regex and shows save` (AC-1.3, AC-1.5).
- `opening popup sends only getStatus; no permissions.request, no start` (AC-1.2).
- `onRecord calls permissions.request in the same tick with exactly [pattern]` (AC-3.2); `armStart sent before request, not awaited`.
- `denied permission → disarm, permissionDenied text, no start` (AC-1.4).
- `restricted, fileAccess and noTab show their messages without permissions.request` (AC-1.7).
- `otherOrigin note on recording tab` (AC-3.4); `otherTabRecording note in ready state`.
- `onSave: Zapisano shown only after status saved from background, never from download() resolve` (AC-2.1).
- `onSave: collect not answered in 15 s → pageBusy, never success` (fałszywy zegar, AC-2.4).
- `onSave: downloads.download rejection → saveFailed reported and error text` (AC-2.2).
- `blob URL revoked after terminal state`.
Definicja ukończenia: testy zielone; `popup.js` bez logiki poza DOM (≤ 80 linii).

### E1-T15 Punkty wejścia MAIN i ISOLATED + wygenerowane bundle  [niezależne: nie]  [zależy od: T3b, T3c, T13, T14]
Pliki: `src/page/main-entry.js`, `src/page/isolated-entry.js`, `src/content/main-world.js` (gen), `src/content/isolated-world.js` (gen), `tests/unit/entries.test.js`.
Co zrobić:
- `main-entry.js`: jeśli marker istnieje → koniec (AC-5.5). Inaczej `createRecorder().install()`, `connectMain`, `pagehide` (capture)
  → `flush` (tylko przy `record:true`). Obsługa `config` (`setConfig`), `collect` (synchronicznie: `collectPageState` + `exportBuffers`
  + `{ protocol, recorderVersion, docId, timeOrigin, navigationType, stopReason }` → `result` jako string), `destroy`.
  `onStopped` → `stopped`.
- `isolated-entry.js`: `connectIsolated`; `chrome.runtime.sendMessage({ type:'hello' })` → `config` do MAIN (kolejka do związania
  kanału); MAIN `flush`/`stopped` → `runtime.sendMessage`; `runtime.onMessage` dla `collect`/`destroy` (`sendResponse` + `return true`).
  Brak związania w 2 s → `bridgeError: 'unbound'`. `chrome.runtime` niedostępny (kontekst unieważniony) → cicho nic.
- `npm run gen` → dwa bundle.
Testy do napisania najpierw (jsdom; oba entry w jednym dokumencie, fałszywy `chrome.runtime`):
- `hello → config record:true → console.log recorded; collect returns result JSON with docId and protocol`.
- `config record:false → hooks removed and no data in collect buffers` (AC-3.3).
- `pagehide sends flush with buffers once per document` (AC-4.4).
- `destroy message restores originals` (AC-5.3).
- `second evaluation of main bundle in the same window is a no-op` (AC-5.5).
- `main bundle source contains no chrome.` (AC E1-R1: zero `chrome.*` w MAIN).
- `generated bundles are up to date` (`generateAll({ check: true })`).
Definicja ukończenia: testy zielone; bundle w `src/content/` z nagłówkiem GENERATED.

### E1-T7 `console-snapshot.js` na wspólnym recorderze  [niezależne: nie]  [zależy od: T3b, T3c, T14, T8a]
Pliki: `src/page/console-entry.js`, `src/standalone/console-snapshot.js` (gen), `tests/unit/console-snapshot.test.js`, `tests/unit/layout.test.js`.
Co zrobić:
- `console-entry.js`: jeśli marker istnieje → `console.info` „Rozszerzenie już nagrywa tę stronę — użyj przycisku „Zapisz paczkę”.”
  i koniec. Inaczej recorder z `record:true`, bez limitu czasu, `recordingStartedAt` = teraz. Global `window.PageDebugSnapshot =
  { download(), snapshot(), stop() }` (jedyny global, tylko w fallbacku). Wypisuje dokładnie „Zbieram od teraz. Odtwórz problem
  i wywołaj `PageDebugSnapshot.download()`.” (AC-7.2). `snapshot()` składa paczkę funkcją z `src/lib/package.js` (import względny,
  generator wkleja), `source: "console"`, notatka o braku danych sprzed wklejenia. `download()` przez `<a download>` (bez rozszerzenia).
- `layout.test.js`: test hasha E0 zastąpić testem „wygenerowany i aktualny” (D6). Ścieżki listy źródeł zaktualizować.
Testy do napisania najpierw (jsdom, ewaluacja wygenerowanego pliku):
- `pasting prints the exact Polish hint` (AC-7.2).
- `snapshot has schemaVersion 2, source console, recordingStartedAt = paste time, note about earlier data` (AC-7.3).
- `console-snapshot.js equals generator output` (AC-7.1); `hook implementation (new Proxy(, installConsoleHook) appears in src/page only once, not hand-copied` (AC-7.1).
- `console-snapshot.js is not in dist` (regresja AC-7.4, już w build.test — tu tylko odwołanie).
Definicja ukończenia: testy zielone.

### E1-T12 Limit nagrywania 10 min: integracja tła i popupu  [niezależne: nie]  [zależy od: T1b, T6b, T3c]
Pliki: `src/lib/time-limit.js`, `src/lib/recording.js`, `src/popup/view.js`, `tests/unit/time-limit.test.js`.
Co zrobić:
- `time-limit.js`: `RECORDING_LIMIT_MS = 600000`, `resolveLimitMs(override)` (liczba całkowita w [1000, 600000], inaczej domyślna),
  `deadlineFor(startedAt, limitMs)`, `isExpired(rec, now)`.
- `recording.js`: `start` czyta `store.getTestLimit()` → `limitMs`/`deadline`; `stopped` z mostu i leniwe `expire` w `getStatus`/`hello`
  → `status:'stopped'`, `stopReason:'time-limit'`, `unregisterAll`, badge „■”; `hello` po terminie → `record:false`.
- `view.js`: stan `stopped` → `stoppedByLimit` + przycisk *Zapisz paczkę*.
Testy do napisania najpierw (fake-chrome, fałszywy zegar):
- `resolveLimitMs clamps above 10 min and ignores non-numbers` (AC-1.9).
- `getStatus after deadline returns stopped/time-limit and unregisters scripts once` (AC-1.9).
- `stopped message from bridge sets stopped and badge` (AC-1.9).
- `hello after deadline returns record:false` (AC-1.9).
- `collect after stop still works and package has recordingStoppedReason time-limit` (AC-4.9; z T8b/T8a).
- `stopped view shows stoppedByLimit text and save button` (AC-1.9).
Definicja ukończenia: testy zielone.

### E1-T1c `background.js`: punkt wejścia i manifesty `background`  [niezależne: nie]  [zależy od: T1b, T8b, T12, T15, T11]
Pliki: `src/background.js`, `src/manifest.chrome.json`, `src/manifest.firefox.json`, `tests/unit/manifest-parity.test.js`, `tests/unit/background.test.js`.
Co zrobić:
- `background.js`: top-level `api` z `chrome.*`, handlery z `recording.js`/`save.js`, synchroniczna rejestracja listenerów, router
  `runtime.onMessage` z walidacją nadawcy (D2), odpowiedzi przez `sendResponse` + `return true`.
- Nakładki `background` według sekcji manifestu.
- `manifest-parity.test.js`: zastąpić „no background (E0)” testem „background w obu, ten sam plik i `type`, różny tylko klucz
  `service_worker`/`scripts`”.
Testy do napisania najpierw:
- `importing background.js registers all listeners synchronously` (fałszywy globalny `chrome`, licznik `addListener` po `import`).
- `background.js and src/lib use no importScripts, window, document, URL.createObjectURL, localStorage, indexedDB, storage.local` (AC-6.1, NFR prywatność).
- `router rejects popup commands from content scripts and bridge commands from extension pages` (D2).
- `chrome manifest has background.service_worker, firefox has background.scripts, same file and type module` (AC-6.1).
- `registered content files exist in both dist targets` (`buildToTmp`) (AC-6.2).
Definicja ukończenia: testy zielone; `npm run build` + `web-ext lint` 0 errors; ręcznie `npm run dev:chrome` ładuje SW bez błędów.

### E1-T17 Usunięcie przepływu E0  [niezależne: nie]  [zależy od: T6b, T1c, T15, T7]
Pliki (usunięcia + jeden nowy test): usunąć `src/page/page-debug-snapshot.js`, `src/popup/run-in-page.js`, `src/popup/snapshot-tab.js`,
`tests/unit/page-debug-snapshot.test.js`, `tests/unit/run-in-page.test.js`, `tests/unit/snapshot-tab.test.js`,
`tests/unit/helpers/load-page-script.js`, `tests/e2e/{smoke,double-click,failure,csp,restricted,packed-zip}.spec.js`,
`tests/fixtures/pages/throw-on-snapshot.html`; poprawki w `eslint.config.js` (stare wpisy); nowy `tests/unit/no-e0-flow.test.js`.
(Wyjątek od limitu 5 plików: same usunięcia, bez nowej logiki.)
Co zrobić: usunięcia, sprzątanie konfiguracji, sprawdzenie, że nic ich nie importuje.
Testy do napisania najpierw:
- `E0 flow files are gone from src` (`page-debug-snapshot.js`, `run-in-page.js`, `snapshot-tab.js`).
- `no __PAGE_DEBUG_SNAPSHOT__, executeScript or <a download> in src except standalone fallback` (AC-5.4, D7).
Definicja ukończenia: `npm test` i `npm run lint` zielone; `npm run build` kod 0.

### E1-T18 Harness e2e dla tła i nagrywania  [niezależne: nie]  [zależy od: T0, T1c, T15, T16]
Pliki: `tests/e2e/helpers/launch.js`, `tests/e2e/helpers/recording.js`, `tests/e2e/helpers/fixtures-server.js`, `tests/e2e/harness.spec.js`, `tests/unit/fixtures-server.test.js`.
Co zrobić (według wyniku T0):
- `launch.js`: `click()` przez `Runtime.evaluate({ userGesture: true })`; `serviceWorker(ext)` (pobranie/oczekiwanie, ponowne
  po restarcie); `stopServiceWorker(ext)` (`Target.closeTarget`); `grantOrigin(ext, 'http://127.0.0.1/*')` (wariant z T0 lub PB-2);
  `Browser.setDownloadBehavior({ behavior:'allow', downloadPath: mkdtemp, eventsEnabled:true })` przy starcie, sprzątanie przy `close()`;
  `setTestLimit(ext, ms)`.
- `recording.js`: `startRecording(ext, page)` (popup → klik `#record` → czekanie na reload i tekst `Nagrywam od`),
  `savePackage(ext, page)` → `{ fileName, json, statusText }` (czeka na `Zapisano plik …`, czyta plik z `downloadPath`),
  `badgeFor(ext, page)`.
- `fixtures-server.js`: `/api/ok` (200 JSON), `?delay=` dla `/api/ok`; host `127.0.0.1` (dostęp przez `localhost` do AC-3.4).
Testy do napisania najpierw:
- `harness: service worker reachable, stoppable and restarted on next message`.
- `harness: origin granted without prompt; permissions.request in popup resolves true`.
- `harness: popup click counts as user gesture`.
- `harness: saved file lands in temp download dir with its real name; nothing in user Downloads`.
- `fixtures-server: /api/ok returns 200 JSON` (unit).
Definicja ukończenia: `npx playwright test harness` zielony 10/10, headless.

### E1-T19a E2E: nagrywanie i zapis (happy path, `<head>`)  [niezależne: nie]  [zależy od: T18, T17]
Pliki: `tests/e2e/recording.spec.js`, `tests/fixtures/pages/early-error.html`.
Co zrobić: fixture `early-error.html`: w `<head>` kolejno `throw new Error('head-boom')`, `fetch('/api/fail')`,
`console.error('head-console', { a: 1 })`, `Promise.reject(new Error('head-rejection'))`, potem `console.log('marker-<n>')` w body.
Testy do napisania najpierw:
- `ready popup shows disclosure, no-upload sentence and reload notice` (AC-1.1).
- `nothing is collected before Nagrywaj: no marker symbol, pre-log absent from package` (AC-1.2).
- `Nagrywaj reloads the tab exactly once, start→reload ≤ 2 s, popup shows Nagrywam od HH:MM:SS` (AC-1.3, NFR).
- `status survives popup reopen and service worker stop` (AC-1.5).
- `badge is set on recording tab only` (AC-1.6).
- `save: Zapisano names the file that exists in download dir; file is JSON schemaVersion 2 with header fields` (AC-2.1, AC-4.5).
- `head error, early fetch 500, console.error and rejection are in the package with t < domContentLoadedEventStart` (AC-4.1, AC-4.2).
- `package has no extension-generated console entries` (AC-4.7).
- `after save: reload has no recorder and after-log not in next package` (AC-2.5).
- `closing the recording tab drops it; reopening the origin runs no recorder` (AC-2.6).
Definicja ukończenia: zielone headless 10/10, bez `retries`.

### E1-T19b E2E: nawigacje, karty, origin, limit  [niezależne: nie]  [zależy od: T18, T17]
Pliki: `tests/e2e/navigation.spec.js`, `tests/e2e/time-limit.spec.js`, `tests/fixtures/pages/spa.html`.
Testy do napisania najpierw:
- `pushState/replaceState/popstate keep recording; spa-marker exactly once` (AC-4.3).
- `full reload within origin: error and marker from both documents, documents[] has two entries` (AC-4.4).
- `second tab of the same origin is not recorded (marker B absent)` (AC-3.3).
- `navigation to localhost (other origin): popup shows otherOrigin; save keeps original entries` (AC-3.4).
- `time-limit (3 s test limit): popup shows stoppedByLimit, console.log is native again, save has recordingStoppedReason time-limit and no after-limit entry` (AC-1.9, AC-4.9).
Definicja ukończenia: zielone 10/10.

### E1-T19c E2E: izolacja i odporność na stronę  [niezależne: nie]  [zależy od: T18, T17]
Pliki: `tests/e2e/isolation.spec.js`, `tests/fixtures/pages/xhr-lib.html`, `tests/fixtures/pages/hostile.html`.
Co zrobić: `xhr-lib.html` to mini-klient w stylu axios (`instanceof`, `DONE`, `withCredentials`, `responseType = 'json'`,
`onreadystatechange`). `hostile.html` definiuje `window.PageDebugSnapshot = { download(){…} }`, wysyła `postMessage` z polami
w stylu `__pds`, emituje `pds:isolated-ready` z własnym węzłem i `CustomEvent`y na `document`, nasłuchuje `message`
i zdarzeń `pds:*` i zapisuje wszystko, co usłyszy, do `window.__heard`.
Testy do napisania najpierw:
- `axios-like XHR client works and is recorded; instanceof and DONE intact` (AC-5.1).
- `after save fetch/XHR/console differ from recording-time wrappers and console.log is native` (AC-5.3).
- `no own window property (strings and symbols) holds the console marker during and after; no __PAGE_DEBUG_SNAPSHOT__` (AC-5.4).
- `second injection of main-world.js (addScriptTag) does not duplicate entries` (AC-5.5).
- `hostile page: __heard is empty, success file name matches our pattern, package contains real marker and not forged data` (AC-5.6).
- `csp-strict page is recorded` (regresja E0 AC-2.4).
Definicja ukończenia: zielone 10/10.

### E1-T19d E2E: strony specjalne, awarie, paczka z zipa  [niezależne: nie]  [zależy od: T18, T17]
Pliki: `tests/e2e/restricted.spec.js`, `tests/e2e/failure.spec.js`, `tests/fixtures/pages/busy.html`, `tests/e2e/packed-zip.spec.js`.
Testy do napisania najpierw:
- `chrome://version: restricted message within 2 s, no reload, no permission request` (AC-1.7).
- `page main thread blocked during save: pageBusy/failed after 15 s, never Zapisano, recording continues` (AC-2.4).
- `packed chrome zip loads and records basic.html end-to-end` (regresja E0 AC-4.5).
Definicja ukończenia: zielone 10/10; czas całego `npm run test:e2e` ≤ 5 min.

### E1-T19e E2E: wydajność, flood, fallback konsolowy  [niezależne: nie]  [zależy od: T18, T17, T7]
Pliki: `tests/e2e/perf.spec.js`, `tests/e2e/console-fallback.spec.js`, `tests/fixtures/pages/flood.html`, `tests/fixtures/pages/perf.html`.
Testy do napisania najpierw:
- `perf: hook overhead p95 — console ≤ 0.5 ms, fetch/XHR ≤ 2 ms (1000 calls, recording tab vs unrecorded localhost tab)` (NFR).
- `perf: save→Zapisano median of 5 ≤ 5 s on basic.html` (NFR).
- `flood: 20 000 × 1 KB logs → package ≤ 10 MB, consoleLogs length = limit, truncated true, page responds within 2 s` (NFR, AC-4.8).
- `console fallback: script prints the Polish hint, download() yields schemaVersion 2 source console` (AC-7.2, AC-7.3).
Definicja ukończenia: zielone 10/10; wyniki perf zapisane w `test-results/` (do qa-report).

## Kolejność i równoległość

| Grupa | Zadania | Warunek startu | Równolegle |
|---|---|---|---|
| A | **E1-T0** (spike, zacząć pierwszy) | — | tak, z grupą B |
| B | T3a, T3b, T4, T5, T13, T14, T11, T16, T1a, T8a, T6a | — | tak, wszystkie (T3a jest właścicielem `eslint.config.js`) |
| C | T3c, T1b, T8b, T6b | T3c: T3a+T4+T5; T1b: T1a; T8b: T1a+T8a; T6b: T6a+T1a | tak |
| D | T15, T7, T12 | T15: T3b+T3c+T13+T14; T7: T3b+T3c+T14+T8a; T12: T1b+T6b+T3c | tak |
| E | T1c | T1b+T8b+T12+T15+T11 | — |
| F | T17, T18 | T17: T6b+T1c+T15+T7; T18: T0+T1c+T15+T16 | tak |
| G | T19a, T19b, T19c, T19d, T19e | T18+T17 (T19e także T7) | tak |

27 zadań, 7 grup. Ścieżka krytyczna: T3a/T4/T5 → T3c → T15 → T1c → T18 → T19*. Wynik T0 musi być znany przed T18.
Porażka S3 oznacza PB-2 u użytkownika przed grupą F, a porażka S6/S7 zmianę D3/D7 przed T15.

## Plan testów

Legenda: **U** vitest (`npm test`), **E2E** Playwright Chromium (`npm run test:e2e`), **WL** `web-ext lint`, **QA-C**/**QA-F**
QA ręczne Chrome stable / Firefox stable, **R** review.

| AC | Poziom | Test (zadanie) | Firefox |
|---|---|---|---|
| 1.1 | U + E2E | `disclosure lists the five categories…`, `popup.html static disclosure text equals MESSAGES` (T6a); `ready model shows disclosure…` (T6b); `ready popup shows disclosure…` (T19a) | QA-F F1 |
| 1.2 | U + E2E | `opening popup sends only getStatus…` (T6b); `nothing is collected before Nagrywaj…` (T19a) | QA-F F1 |
| 1.3 | U + E2E | `start registers…then reloads tab exactly once`, `start twice with same requestId…` (T1b); `recordingSince matches…` (T6a); `Nagrywaj reloads the tab exactly once…` (T19a) | QA-F F3 |
| 1.4 | U + QA | `start without granted permission…`, `stale pending…` (T1b); `denied permission → disarm…` (T6b) | QA-C + QA-F F2 |
| 1.5 | U + E2E | `fresh handler instance reads the same status…` (T1b); `status survives popup reopen and service worker stop` (T19a) | QA-F F7 |
| 1.6 | U + E2E | `hello from recording tab… badge set` (T1b); `badge is set on recording tab only` (T19a) | QA-F F13 |
| 1.7 | U + E2E + QA | `restricted, fileAccess and noTab… without permissions.request` (T6b); `chrome://version: restricted…` (T19d); QA-C: CWS, `about:blank`; regresja `restricted still starts with…` (T6a) | QA-F F10 |
| 1.8 | U | `messages contain no forbidden words`, `every <button> has a Polish label…` (T6a) | — |
| 1.9 (nowe) | U + E2E | `stop('time-limit')…` (T3c); `resolveLimitMs…`, `getStatus after deadline…`, `hello after deadline…`, `stopped view…` (T12); `time-limit (3 s test limit)…` (T19b) | QA-F F15 |
| 2.1 | U + E2E | `success is reported only after onChanged complete…` (T8b); `Zapisano shown only after status saved…` (T6b); `save: Zapisano names the file…` (T19a) | QA-F F8 |
| 2.2 | U + QA | `interrupted and USER_CANCELED keep recording…` (T8b); `downloads.download rejection → saveFailed` (T6b); QA-C: „Pytaj, gdzie zapisać” + Anuluj | QA-F F9 |
| 2.3 | QA | QA-C: „Automatyczne pobieranie” = Blokuj, 3 nagrania i zapisy, log jak `requa-chrome-f3.log` | QA-F F8b |
| 2.4 | U + E2E | `no collect answer within 15 s…`, `download not complete within 60 s…` (T8b); `collect not answered in 15 s…` (T6b); `page main thread blocked…` (T19d) | — (unit wspólny) |
| 2.5 | U + E2E | `after complete: unregister, destroy…` (T8b); `after save: reload has no recorder…` (T19a) | QA-F F8 |
| 2.6 | U + E2E + QA | `onTabRemoved…`, `onStartup/onInstalled…` (T1b); `closing the recording tab…` (T19a); QA-C restart | QA-F F11 |
| 3.1 | U | `permissions subset…`, `no host_permissions…`, `dist manifests: same permission rules` (T16) | WL |
| 3.2 | U | `originPatternFor` tabela, `pattern is exactly one…` (T1a); `onRecord calls permissions.request… exactly [pattern]` (T6b) | QA-F F1 (treść okna) |
| 3.3 | U + E2E | `hello from another tab → record:false` (T1b); `setConfig({record:false})…` (T3c); `config record:false…` (T15); `second tab of the same origin…` (T19b) | QA-F F14 |
| 3.4 | U + E2E | `hello from another origin or port…`, `getStatus marks otherOrigin…` (T1b); `tab on other origin → package from stored docs…` (T8b); `current null…` (T8a); `navigation to localhost…` (T19b) | QA-F F14 |
| 3.5 | U | `README Uprawnienia mentions every permission… PL and EN` (T16) | — |
| 4.1 | E2E | `head error, early fetch 500… t < domContentLoadedEventStart` (T19a) | QA-F F4 |
| 4.2 | E2E | ta sama fixture (T19a) | QA-F F4 |
| 4.3 | E2E | `pushState/replaceState/popstate…` (T19b) | QA-F F5 |
| 4.4 | U + E2E | `flush stores document…` (T1b); `putDoc over… budget…` (T1a); `pagehide sends flush…` (T15); `prior and current documents merged…`, `dropped prior document… note` (T8a); `full reload within origin…` (T19b) | QA-F F6 |
| 4.5 | U + E2E | `header has schemaVersion 2…`, `every record… numeric t and doc` (T8a); `save: … header fields` (T19a) | QA-F F8 |
| 4.6 | U | `console.error calls the original once…`, `console record has stack containing the calling function name` (T5) | — |
| 4.7 | U + E2E | `recorder never writes to console` (T3c); `package has no extension-generated console entries` (T19a) | QA-F F4 |
| 4.8 | U + E2E | `6000 pushes…` (T3a); `6000 console.log keep 5000…` (T3c); `global limit keeps newest…` (T8a); `flood…` (T19e) | — |
| 4.9 (nowe) | U + E2E | `records after deadline are dropped…` (T3c); `recordingStoppedReason is time-limit or null` (T8a); `collect after stop…` (T12); `time-limit…` (T19b) | QA-F F15 |
| 5.1 | U + E2E | lista testów XHR (T4); `axios-like XHR client works…` (T19c) | QA-F F18 |
| 5.2 | U | `fetch(new Request…) records POST…`, `fetch(new URL…)`, `fetch returns the same response… bodyUsed false`, `fetch rejection is rethrown…` (T4) | — |
| 5.3 | U + E2E | `restore()…` (T4, T5); `destroy restores… (===)…` (T3c); `destroy message restores originals` (T15); `after save fetch/XHR/console differ…` (T19c) | — |
| 5.4 | U + E2E | `install defines non-enumerable frozen marker…`, `window own property names/symbols…` (T3c); `no __PAGE_DEBUG_SNAPSHOT__…` (T17); `no own window property… holds the console marker…` (T19c) | — |
| 5.5 | U + E2E | `second install… no-op` (T3c); `second evaluation of main bundle…` (T15); `second injection of main-world.js…` (T19c) | — |
| 5.6 | U + E2E | `page listener… sees no message`, `forged pds:isolated-ready…`, `wrong nonce…` (T13); `content result cannot set file name or success` (T8b); `hostile page…` (T19c) | QA-F F18 (opcjonalnie) |
| 6.1 | U + WL + QA | `chrome manifest has background.service_worker, firefox has background.scripts…`, `… no importScripts, window…`, `importing background.js registers all listeners synchronously` (T1c) | QA-F F7 |
| 6.2 | U | `scriptsFor: … js root-relative` (T1b); `follows js: [...]…` (T11); `registered content files exist in both dist targets` (T1c) | — |
| 6.3 | U | `throws on url(…`, `…getURL(`, `…import() with template literal`, `…importScripts(` (T11) | — |
| 6.4 | R | lista scenariuszy Firefoksa niżej (F1–F18, ≥ 10); `qa-report.md` raportuje każdy osobno | — |
| 6.5 | U | `deepMerge does not share references with source` (T3a) | — |
| 7.1 | U | `console-snapshot.js equals generator output`, `hook implementation… not hand-copied` (T7); `generated bundles are up to date` (T15) | — |
| 7.2 | U + E2E | `pasting prints the exact Polish hint` (T7); `console fallback…` (T19e) | QA-F F12 |
| 7.3 | U + E2E | `snapshot has schemaVersion 2, source console…` (T7); `console fallback…` (T19e) | QA-F F12 |
| 7.4 | U | `dist contains no forbidden files` (istniejący `build.test.js`) | — |

NFR: rozmiar `dist/*` < 500 KB (`each target is under 500 KB`); wydajność hooków i czasy (T19e, T19a); flood ≤ 10 MB (T19e);
prywatność: `background.js and src/lib use no … localStorage, indexedDB, storage.local` (T1c), `store never touches storage.local` (T1a),
`no remote code` (build.test), `data_collection_permissions` bez zmian (T16); `npm test` ≤ 30 s i e2e ≤ 5 min (Q1);
stabilność 10/10 bez `retries` (DoD każdego T19). Review E1-R1: zero `chrome.*` w MAIN (`main bundle source contains no chrome.`, T15),
kanał z nonce (T13), limity buforów (T3a/T3c).

**QA ręczne Firefox (AC-6.4, każdy scenariusz osobno w `qa-report.md`; „QA ręczne”).** Środowisko: `npm run fixtures`
+ `npm run dev:firefox -- --url http://127.0.0.1:8080/basic.html`, Firefox stable (≥ 128).
| # | Scenariusz | AC |
|---|---|---|
| F1 | Pierwsze *Nagrywaj* na `basic.html`: okno zgody wymienia tylko `127.0.0.1`; „Zezwól” → przeładowanie → popup „Nagrywam od HH:MM:SS”; przed kliknięciem brak markera (`Object.getOwnPropertySymbols(window)` w konsoli) | 1.1, 1.2, 3.2 — QA ręczne |
| F2 | Odmowa zgody: komunikat `permissionDenied` (od razu albo po ponownym otwarciu, jeśli popup się zamknął), brak przeładowania, stan *Gotowy* | 1.4 — QA ręczne |
| F3 | Dokładnie jedno przeładowanie po zgodzie (panel Sieć: jedno żądanie dokumentu) | 1.3 — QA ręczne |
| F4 | `early-error.html`: błąd, fetch 500, `console.error`, odrzucenie z `<head>` w paczce z `t` < DCL; brak wpisów rozszerzenia | 4.1, 4.2, 4.7 — QA ręczne |
| F5 | `spa.html`: `pushState` → `spa-marker` dokładnie raz | 4.3 — QA ręczne |
| F6 | F5 w trakcie nagrania, potem pełne przeładowanie: wpisy obu dokumentów, `documents` = 2 | 4.4 — QA ręczne |
| F7 | `about:debugging` → „Zakończ skrypt tła”, ponowne otwarcie popupu: ten sam czas startu i *Zapisz paczkę* | 1.5, 6.1 — QA ręczne |
| F8 | Zapis z sukcesem: „Zapisano plik X”, plik X w Pobranych, JSON v2; po zapisie przeładowanie bez markera; F8b: 3 nagrania i zapisy = 3 pliki | 2.1, 2.3, 2.5, 4.5 — QA ręczne |
| F9 | Zapis przerwany: katalog pobierania tylko do odczytu (albo anulowanie w panelu pobrań przy `flood.html`) → komunikat, nagranie trwa, ponowny zapis po przywróceniu OK | 2.2 — QA ręczne |
| F10 | Strony specjalne: `about:addons`, `addons.mozilla.org`, `about:blank` → `restricted` ≤ 2 s, bez przeładowania | 1.7 — QA ręczne |
| F11 | Zamknięcie karty w trakcie nagrania → ponowne otwarcie origin bez markera; restart przeglądarki (dodatek tymczasowy: ponowne `web-ext run`) → brak nagrania | 2.6 — QA ręczne |
| F12 | Fallback konsolowy: wklejenie `src/standalone/console-snapshot.js` → polski komunikat; `PageDebugSnapshot.download()` → plik `schemaVersion 2`, `source: "console"` | 7.2, 7.3 — QA ręczne |
| F13 | Ikona: oznaczenie „●” tylko na nagrywanej karcie; po przeładowaniu nadal; na drugiej karcie brak | 1.6 — QA ręczne |
| F14 | Druga karta tego samego origin bez danych w paczce; przejście nagrywanej karty na `localhost` → komunikat `otherOrigin`, zapis z danymi pierwotnej strony | 3.3, 3.4 — QA ręczne |
| F15 | Limit: w konsoli tła `browser.storage.session.set({'pds:test:recordingLimitMs': 60000})`, nagranie 1 min → „zatrzymane po 10 minutach”, `recordingStoppedReason: "time-limit"` | 1.9, 4.9 — QA ręczne |
| F16 | `file://` (PB-1): komunikat zgodny z decyzją bramki, nigdy sukces bez pliku | decyzja 2 — QA ręczne |
| F17 | `csp-strict.html` nagrywa się | regresja E0 2.4 — QA ręczne |
| F18 | `xhr-lib.html` działa identycznie w trakcie nagrania; `hostile.html` nie zmienia wyniku zapisu | 5.1, 5.6 — QA ręczne |

QA-C (Chrome stable) dodatkowo: AC-1.4 (odmowa), AC-2.2 („Pytaj, gdzie zapisać” → Anuluj), AC-2.3 (F3 z logiem), AC-2.6 (restart),
AC-1.7 (CWS), `file://` z przełącznikiem i bez (PB-1), scenariusz zgłaszającego od instalacji do pliku z nagraniem ekranu (E1-Q1).

## Odrzucone zadania z backlogu

Brak odrzuconych. Zmiany zakresu i scalenia:
- **E1-T2** podzielone: rejestracja i badge w T1b (`content-scripts.js`), przeładowanie w T1b (`start`).
- **E1-T3** podzielone na T3a (serializacja, bufory), T3b (collector), T3c (recorder) oraz T15 (punkty wejścia) i T6/D6 (generator).
- **E1-T9** scalone: marker `Symbol.for('pds.installed')` w T3c. Weryfikacja wersji zamiast `runInPage` + `args` to
  `recorderVersion === runtime.getManifest().version` w T8b. `runInPage` znika (decyzja 4), a kanał prywatny (D3) wyklucza
  podstawienie obiektu przez stronę.
- **E1-T10** scalone w T8b/T6b: timeout 15 s dotyczy zbierania z karty (`tabs.sendMessage`) i startu pobrania, bo `executeScript`
  nie jest już używane.
- **E1-TEST1** = T4; **E1-TEST2** = T19a; **E1-TEST3** = T19b.
- **E1-DOC1** (instrukcja ze zrzutami) i opis cofania uprawnienia w README (decyzja 3) — faza Docs, poza zadaniami implementacji.
- Nowe zadania: T0, T1a/b/c, T3a/b/c, T6a/b, T8a/b, T12 (z bramki), T13, T14, T15, T16, T17, T18, T19a–e.

## Ryzyka techniczne i jak je wykryjemy wcześnie

| # | Ryzyko | Wczesny sygnał | Reakcja |
|---|---|---|---|
| R1 | Wyścig `document_start` (zwłaszcza Firefox): skrypt strony przed recorderem lub przed handshake'iem | T0 S5 < 10/10; QA-F F4 czerwony; `bridgeError: 'unbound'` w logu tła | Chrome: zgłosić jako flaky z przyczyną; Firefox: znane ograniczenie w docs, dokument `recorded:false` z notatką (nigdy fałszywe dane) |
| R2 | `relatedTarget`/`CustomEvent.detail` nie przechodzi między światami | T0 S6/S8 | wariant fallback D3 (dopięcie węzła); w ostateczności zmiana D3 przez architekta |
| R3 | Nadanie origin w e2e niemożliwe bez okna | T0 S3 | PB-2 (kopia z `host_permissions`) |
| R4 | `runtime.sendMessage` z `pagehide` nie dochodzi (bfcache, szybka nawigacja) | T19b `full reload within origin` < 10/10 | `flushed:false` + notatka; ewentualnie dodatkowy zrzut przy `visibilitychange: hidden` |
| R5 | Popup zamknięty przez okno „Zapisz jako” lub okno zgody zanim pobranie wystartuje | T0 S7; QA-C AC-2.2; QA-F F2 | zgoda: obsłużone przez `pending` + `onAdded`; zapis: uczciwe `failed`, a przy powtarzalności fallback D7 |
| R6 | Chrome odrzuca wiodący `/` w `registerContentScripts.js` | T0 S5 | ścieżki bez `/` (tło w korzeniu, F7 nie dotyczy) |
| R7 | Quota `storage.session` (10 MB Chrome; Firefox nieznana) przy wielu dokumentach | test `putDoc on quota error` (T1a); flood w T19e | budżety D4; notatki z liczbami |
| R8 | Narzut `new Error()` + `safeJson` na `console.*` > 0,5 ms p95 | T19e perf | stack tylko dla `warn`/`error` + próbkowanie dla `log` (decyzja w review, zapis w state.md) |
| R9 | Firefox: moduł w `background.scripts` lub `optional_host_permissions` nieobsługiwane w danej wersji | T0 S8; `web-ext lint` w T16/T1c | `strict_min_version` podnieść (np. 140 — decyzja E5-S2 przyspieszona przez bramkę) |
| R10 | Generowane bundle rozjeżdżają się ze źródłem albo z wersją manifestu | `generated bundles are up to date`, `RECORDER_VERSION equals manifest…` | `npm run gen` w checklist release (pds-release) |
| R11 | Playwright przy `Browser.setDownloadBehavior: allow` gubi lub psuje własne zdarzenia pobrań | T0 S7 | nie używamy zdarzeń Playwrighta; plik czytamy z `downloadPath` |
| R12 | Recorder zmienia zachowanie realnych stron (biblioteki XHR, frameworki owijające `console`) | T19c `xhr-lib`; QA-C na realnej stronie w E1-Q1 | poprawka hooka + przypadek testowy w T4/T5 |
