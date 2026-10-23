# E2 — Design

## Pytania do bramki

**PB-1 (warunkowe, rozstrzyga spike T0/S4): statusy zasobów i dokumentu w Firefoksie.**
D2 opiera statusy `<img>`/`<script>`/CSS/fontów i dokumentu na `PerformanceResourceTiming.responseStatus` i
`PerformanceNavigationTiming.responseStatus`. W Chrome to API jest od wersji 109, więc mamy je od `minimum_chrome_version` 121.
Nie wiemy, czy Firefox ≥ 128 je udostępnia. Jeśli spike pokaże, że tak, PB-1 znika. Jeśli nie, do wyboru są dwie opcje:
- **(A) — rekomendacja:** w Firefoksie wpisy zasobów i `documents[].status` mają `status: null` + `statusUnavailable: "unsupported-browser"`,
  a `notes` mówi, że statusy plików nie są dostępne w tej przeglądarce. Nie dodajemy uprawnień. AC-4.1/4.2 w QA Firefoksa
  akceptują wtedy `statusUnavailable`, tak jak AC-5.4 dla metryk (korekta specu w dwóch AC).
- **(B):** `webRequest` dodany **tylko** w `manifest.firefox.json` (obserwacja `onCompleted`/`onErrorOccurred` dla `tabId` nagrania).
  Warunek: store-reviewer potwierdza, że Firefox nie pokazuje przy instalacji ani aktualizacji nowego monitu (decyzja 4 bramki Spec).
  Koszt to nowe zadanie (≈ 2 pliki tła, mapa `requestId` w `storage.session`, korelacja URL+czas z wpisami MAIN), poluzowanie testu
  parytetu manifestów (`permissions` różne między targetami) i formularz AMO. Wybór B zmienia D2 tylko dla Firefoksa.

**PB-2 (sprzeczność w AC-7.2): gdzie leżą bajty zrzutu.** AC-7.2 każe ustawić `dom` jako ostatni klucz i jednocześnie mówi,
że „treść zrzutu nie poprzedza żadnej sekcji tekstowej”. `screenshots` stoi przed `consoleLogs`. Gdyby obraz (≈ 400 000 znaków
base64 w jednej linii) siedział w `screenshots[]`, poprzedzałby `consoleLogs`, `environment`, `storage` i `dom`. Przy zawijaniu
wierszy w edytorze to tysiące linii do przewinięcia (łamie AC-7.3).
- **(A) — rekomendacja:** `screenshots[]` zostaje na miejscu z AC-7.2, ale ma tylko metadane i klucz `attachment`. Same bajty
  idą do nowego, ostatniego klucza `attachments: { "<id>": "data:image/jpeg;base64,…" }`, który stoi **po** `dom`. `dom` jest
  wtedy ostatnią sekcją tekstową. AC-7.2 dostaje dopisek „… → `dom` → `attachments` (tylko dane binarne)”. E3-D2 zamieni
  `attachment` na `file` w zipie, a `attachments` zniknie.
- **(B):** `dataUrl` jako ostatnie pole wpisu w `screenshots[]` (dosłownie kolejność z AC-7.2). Wtedy drugie zdanie AC-7.2 trzeba skreślić.

**PB-3 (doprecyzowanie AC-5.4): Firefox z danymi zamiast „unsupported”.** Dostępność CLS/INP/long tasks ustala wyłącznie
wykrywanie funkcji (`PerformanceObserver.supportedEntryTypes`, `interactionId` w `PerformanceEventTiming.prototype`), nigdy UA.
Jeśli Firefox z QA ma już któreś z tych API, paczka będzie miała prawdziwą wartość zamiast `available: false`. Proponuję
uznać to za PASS AC-5.4 („nie `0`, nie brak klucza” nadal obowiązuje). Unit AC-5.4 sprawdza atrapę bez typów wpisów.

**Odstępstwa od wiążących skilli / backlogu (do akceptacji):**
- **D1** — własne `PerformanceObserver` zamiast `web-vitals` (skill `cwv-capture` rekomenduje bibliotekę). Uzasadnienie w D1.
- **D4** — rejestrator kroków w **MAIN**, nie w ISOLATED (backlog E2-D4, tabela światów w `mv3-extension-rules`). Uzasadnienie w D4.
- **D5** — zrzut nie wymaga nowego uprawnienia, bo `captureVisibleTab` działa na `activeTab` nadanym przy otwarciu popupu
  (sprawdza spike S1/S4).
- `limits.entryChars` 10 000 → 40 000 (T7a). Bez tego nie da się zapisać pełnego stosu w `console.error(err)` (AC-4.8).

**Zmiany uprawnień: brak.** Manifesty `src/manifest.*.json` zostają bez zmian. Warunek użytkownika (zero nowych ostrzeżeń, bez
poszerzania host permissions) jest spełniony przy PB-1 (A). Store-reviewer potwierdza tylko zaktualizowane uzasadnienie
`activeTab` (zrzut) i ujawnienie.

**Decyzje użytkownika (bramka Design, 2026-10-23):** PB-1 → **(A)** `statusUnavailable: "unsupported-browser"` w Firefoksie, jeśli S4
pokaże brak `responseStatus` (bez nowych uprawnień); PB-2 → **(A)** klucz `attachments` po `dom`; PB-3 → **zaakceptowane**
(prawdziwe dane w FF = PASS AC-5.4); odstępstwa D1 (własne PerformanceObserver), D4 (kroki w MAIN), `entryChars` 40 000 — **zaakceptowane**.

## Kontekst
Po E1 paczka v2 ma logi, błędy i zapytania fetch/XHR ze wszystkich dokumentów nagrania. Zbierają je hooki w MAIN przez prywatny kanał
do ISOLATED i tła. Stan trzyma `storage.session`, bundle generuje `gen-content.mjs`. Brakuje kroków użytkownika, metryk CWV z atrybucją,
statusów zasobów i dokumentu, treści odpowiedzi błędów, zrzutu ekranu i pełnych stosów, a kolejność kluczy chowa logi pod `outerHTML`.
E2 dodaje te dane w paczce `schemaVersion: 3` z blokiem `overview`. Nie dodaje uprawnień i nie zmienia przepływu *Nagrywaj* → *Zapisz paczkę*.

## Decyzje

Bez zmian zostają decyzje E1: D1 (rejestracja per origin + bramka), D2 (tło, stan w `storage.session`), D3 (kanał na odłączonym węźle),
D4 (zrzut dokumentów przy `beforeunload`/`pagehide` z tokenem), D5 (hooki Proxy, intrinsics), D6 (moduły ES + generator), D7 (Blob w popupie),
D8 (uprawnienia), D9 (popup jako widok), D10 (limit 10 min). E2 rozszerza D5 (nowe hooki), D10 (kontrola terminu przy zdarzeniu, D8 niżej)
i D12 (schemat → v3, D9 niżej).

### D1 CWV: własne `PerformanceObserver` czy `web-vitals`
Opcje:
(a) `web-vitals` attribution build, vendorowany do `src/vendor/` (Apache-2.0, ≈ 4 KB gz / ≈ 15 KB min);
(b) własny moduł: `PerformanceObserver` z `buffered: true` na `paint`, `largest-contentful-paint`, `layout-shift`, `event`
(+`first-input`), `long-animation-frame` + Navigation Timing dla TTFB; algorytmy okien CLS i percentyla INP według publicznych definicji
web.dev; wyrocznią w e2e jest `web-vitals` jako devDependency (D7).
**Wybór: (b).**
Uzasadnienie: rozmiar nie rozstrzyga, bo oba warianty mieszczą się w budżecie 500 KB. Rozstrzyga utrzymanie w naszych realiach.
(1) Generator bundli jest liniowy i przyjmuje tylko wąski podzbiór składni. Minifikowanego ESM `web-vitals` (jedna linia z `export{…}`
na końcu) nie przyjmie. Wersja niezminifikowana to ok. 20 plików z wieloliniowymi importami, więc każda aktualizacja biblioteki
oznaczałaby ręczną przeróbkę cudzego kodu. To odwrotność argumentu „biblioteka = mniej utrzymania”. (2) Spec wymaga stanów,
których biblioteka nie daje: `available: false` + `reason` (`unsupported-browser`, `no-interaction`, `hidden-at-start`), `finalized`,
metryki per dokument, INP tylko po wklejeniu w trybie konsolowym. W Firefoksie biblioteka po prostu nie woła callbacku, więc i tak
potrzebna jest warstwa z własnym wykrywaniem funkcji. Około połowy kodu (b) powstałaby więc tak czy inaczej. (3) Atrybucja
z biblioteki daje jej selektory (`body>div>img`), a AC-3.2 wymaga naszego selektora (id > data-* > ścieżka) wspólnego dla kroków
i metryk. (4) Licencja Apache-2.0 wymaga dołączenia LICENSE/NOTICE do `dist`. Walker osiąga tylko pliki z manifestu, więc byłaby
potrzebna zmiana buildu. Do tego AMO porównuje biblioteki po hashu pliku, a kod wklejony do `main-world.js` hashu nie ma, więc E5
miałby więcej wyjaśnień. (5) Kod (b) to ok. 250 linii czystych funkcji testowanych wektorami (T1a) plus ok. 200 linii obserwatorów (T1b).
Zdalnego kodu nie ma w żadnym wariancie.
Konsekwencje: zmiany definicji metryk (np. INP) śledzimy sami. Ryzyko łagodzą trzy rzeczy: wektory testowe z przypadkami
granicznymi okien CLS i percentyla INP, e2e porównujące nasze `LCP`/`CLS`/`INP` z `web-vitals` (devDependency, tylko w teście, ±10%;
D7) i wpis w `docs/` o przeglądzie definicji przy każdym epiku z metrykami. Long tasks liczymy tylko z `long-animation-frame` (Chrome ≥ 123).
Fallbacku `longtask` nie ma, bo nie daje URL-a skryptu (AC-5.3), a AC-5.4 wymaga `unsupported-browser` dla Chrome 121–122.

### D2 Statusy i rozmiary: Resource/Navigation Timing + hooki, bez `webRequest`
Opcje:
(a) `chrome.webRequest` (obserwacja) w tle z mapą `requestId → {url, status, type}` i korelacją z MAIN po URL+czasie;
(b) **Resource Timing** w MAIN: `PerformanceObserver({type:'resource', buffered:true})` → `responseStatus`, `initiatorType`, `encodedBodySize`;
status dokumentu z `PerformanceNavigationTiming.responseStatus`; fetch/XHR dalej z hooków (status z `Response`/`xhr.status`), wpisy RT
`fetch`/`xmlhttprequest` służą tylko do `sizeBytes`; błędy ładowania elementów z listenera `error` w fazie capture;
(c) tylko hooki fetch/XHR (bez statusów `<img>`/`<script>` — AC-4.1 niespełnione).
**Wybór: (b).**
Uzasadnienie: kluczowe pytanie brzmiało, czy `webRequest` bez szerszych host permissions widzi więcej niż Resource Timing. Nie widzi.
Chrome dostarcza zdarzenia `webRequest` wyłącznie dla zapytań, do których URL-a **i** inicjatora rozszerzenie ma dostęp. Mamy tylko
opcjonalne uprawnienie do origin nagrania, więc `webRequest` zobaczyłby dokładnie zasoby same-origin. Ich status już dziś podaje
`responseStatus` (Chrome ≥ 109). Zasoby z CDN (cross-origin) są niewidoczne w obu wariantach i zawsze dostaną `statusUnavailable:
"cross-origin"`. Firefox też wymaga host permission dla URL-a zapytania. Potrzeba `webRequest` nie jest więc wykazana w Chrome,
a warunek użytkownika (zero nowych ostrzeżeń i bez poszerzania host permissions) przemawia przeciw dodawaniu uprawnienia „na zapas”.
Wariant (a) ma też realne koszty: wybudzanie SW przy każdym zapytaniu, zapisy do `storage.session`, korelację między procesami bez
wspólnego identyfikatora (MAIN nie zna `requestId`), a `responseSize` istnieje tylko w Firefoksie, więc rozmiaru i tak by nie było.
(b) działa też w fallbacku konsolowym (AC-7.5) bez rozszerzenia. Jedyna luka (b) to Firefox, jeśli nie ma `responseStatus`. To PB-1:
spike S4 rozstrzyga, a (B) daje `webRequest` tylko tam, gdzie potrzeba byłaby wykazana. Spike S5 potwierdza na Chromium tezę
„`webRequest` bez host permission nie widzi zasobów cross-origin”.
Konsekwencje:
- `network[].type` ∈ {`fetch`, `xhr`, `img`, `script`, `css`, `font`, `other`}. Rodzaj zasobu wynika z rozszerzenia pliku i `initiatorType`
  (`resourceKind`, T3a). Wpisy RT z `initiatorType` `fetch`/`xmlhttprequest` nie tworzą osobnych wpisów (AC-4.4), tylko uzupełniają `sizeBytes`
  hooków przez korelację FIFO per URL po `startTime` (E2-TEST1). Status fetch/XHR zawsze pochodzi z hooka, więc błędna korelacja nie może
  zamienić statusów.
- `status: null` zawsze z `statusUnavailable` ∈ {`cross-origin`, `unsupported-browser`, `network-error`, `unknown`}. Nigdy samo `0` (AC-4.3).
  Same-origin `responseStatus === 0` albo zdarzenie `error` elementu bez wpisu RT dają `network-error`.
- `sizeBytes` = `encodedBodySize` (bajty treści z sieci, przed dekompresją). Dla cross-origin bez `Timing-Allow-Origin` (same zera)
  wartość to `null`.
- `documents[].status` (+ `statusUnavailable?`) pochodzi z Navigation Timing dokumentu (AC-4.2).
- Zasoby wczytane przed `document_start` nie istnieją (recorder startuje przed pierwszym zasobem), a `buffered: true` łapie wpisy
  sprzed utworzenia obserwatora. Zasoby jeszcze ładowane w chwili zapisu nie mają wpisu, bo RT emituje wpis po `responseEnd`.
- `limits.network` (5000) obejmuje teraz także zasoby. To zmiana semantyki, która wraz z `type` uzasadnia v3 (decyzja 5 bramki).

### D3 Treść odpowiedzi błędów
Opcje: (a) `response.clone().text()` (czyta całość, ryzyko pamięci i strumieni bez końca); (b) **klon + czytnik strumienia z limitem**:
`clone().body.getReader()` + `TextDecoder` do 8192 znaków albo do końca albo 2 s, potem `reader.cancel()`; XHR — `responseText`
(tylko `responseType` `''`/`'text'`) lub `JSON.stringify(xhr.response)` (`'json'`), po `loadend`; (c) czytanie w tle (`webRequest` nie daje treści w MV3).
**Wybór: (b).**
Uzasadnienie: warunki (wszystkie naraz) to status ≥ 400, `content-type` tekstowy (`text/*`, `application/json`, `*+json`, `*xml`,
`application/x-www-form-urlencoded`), `response.type` ≠ `opaque`/`opaqueredirect`, ciało obecne. `clone()` przed jakimkolwiek odczytem
strony nie ustawia `bodyUsed` na oryginale. Anulowanie jednej gałęzi `tee` nie dotyka drugiej, więc strona dalej czyta `r.json()` (AC-4.6).
W pamięci zostaje najwyżej to, co pobraliśmy (≤ 8192 znaków + jeden chunk). Strumień bez końca kończy się po 2 s bez pola (AC-4.5).
XHR `blob`/`arraybuffer`/`document` nie są czytane. Maskowanie (D3a, niżej) idzie **przed** przycięciem do 4096 znaków. Po przycięciu
usuwamy końcowy niepełny „wyraz” (`[A-Za-z0-9._~+/=-]+` dotykający cięcia), żeby nie zostawić połowy tokenu. Wynik ląduje w
`responseBodyPreview` + `responseBodyTruncated: true|false`. Odczyt jest asynchroniczny, więc wpis sieci powstaje przy nagłówkach
(jak w E1), a podgląd recorder dopina później przez `attach` z budżetem 256 KB na dokument. Ten sam budżet obowiązuje w paczce:
zostają najnowsze podglądy, starsze tracą pole, a `truncated.responseBodies` = `true` i jest notatka. Opcja „także 2xx” nie istnieje
w E2 (E4-D4).
**D3a Maskowanie u źródła:** czysty moduł `src/lib/mask-secrets.js` (bez DOM, idempotentny) z regułami `jwt`, `bearer` i kluczami z listy
`privacy-redaction` w postaciach `"klucz": "wartość"` (JSON) i `klucz=wartość` (form/tekst) → `"[redacted:jwt]"`, `"[redacted:bearer]"`,
`"[redacted:key-<token>]"`. Działa dwa razy. Pierwszy raz w MAIN przy zbieraniu (decyzja 3 bramki: „maskowanie przy zbieraniu”), więc
token nie trafia do bufora, `storage.session` ani przez kanał. Drugi raz w `assemblePackage` w tle, jako obrona przed stroną, która
podmieniła `String.prototype`/`RegExp` w MAIN. Moduł leży w `src/lib`, bo importują go i bundle MAIN (`../lib/…`, generator ma
`srcDir = src`), i `package.js`. E3 rozszerzy go do pełnego `redact.js`.
Konsekwencje: narzut na stronę pojawia się tylko przy błędnych odpowiedziach (odczyt asynchroniczny, poza wywołaniem `fetch`), więc
NFR ≤ 2 ms p95 dotyczy ścieżki synchronicznej, a mierzy go TEST6. Podgląd może dotrzeć po `pagehide` i wtedy przepada (bez notatki,
bo to wpis opcjonalny).

### D4 Kroki użytkownika: MAIN, capture na `window`, selektor id > data-* > ścieżka
Opcje: (a) listener w ISOLATED (backlog). Kroki żyją w osobnym buforze ISOLATED, więc trzeba zmienić `flush`/`collect` (scalanie
JSON-ów albo zmiana protokołu wyniku), a fallback konsolowy nie ma ISOLATED (AC-7.5 wymaga tych samych kluczy); (b) **listener w MAIN**
instalowany przez recorder na `document_start`: `window.addEventListener(type, h, { capture: true, passive: true })` dla `click`, `input`,
`change`, `submit`, `keydown`, plus `popstate`, `hashchange`, Proxy `apply` na `History.prototype.pushState/replaceState` i krok
`navigate` przy starcie dokumentu.
**Wybór: (b).**
Uzasadnienie: kroki idą wtedy tą samą drogą co logi (`record('steps')`, bufor z limitem, termin, `flush`, `collect`, `doc`). Fallback
konsolowy dostaje je za darmo, protokół MAIN ↔ ISOLATED ↔ tło się nie zmienia, a selektor jest wspólny z atrybucją CWV, która i tak musi
być w MAIN (skill `cwv-capture`: węzłów nie da się przesłać między światami). Argument za ISOLATED, czyli odporność na łatki strony,
zastępujemy przechwyceniem intrinsics na `document_start`: `Document/Element.prototype.querySelectorAll`, `getAttribute`, `closest`,
gettery `tagName`, `parentElement`, `id`, `value`, `CSS.escape`. Strona nie zdąży ich podmienić. Listener capture na `window` dodany
przed skryptami strony jest pierwszy w kolejności, jest pasywny i niczego nie woła na zdarzeniu. `defaultPrevented`, `stopPropagation`,
kolejność handlerów strony i `isTrusted` zostają bez zmian (AC-3.7). Rejestrujemy tylko `event.isTrusted === true`.
Reguły (prywatność u źródła, AC-3.4/3.5):
- `click` → `selector` celu rozwiązanego przez `closest('a, button, [role=button], input, select, textarea, label, summary, [onclick]')`
  (inaczej sam cel); `text` (≤ 80 znaków: `aria-label`, potem `textContent` po normalizacji spacji; dla `input[type=submit|button|reset]` atrybut
  `value`) **tylko** dla `a`, `button`, `[role=button]` i tych trzech typów `input`. Pola formularza nie mają `text`.
- `input` → `inputType` (`type` pola lub `textarea`/`select`/`contenteditable`), `valueLength` (`value.length`; contenteditable:
  `textContent.length`). Wartości nie zapisujemy nigdy. `password` → tylko `inputType`. Kolejne `input` w to samo pole bez innego kroku
  pomiędzy aktualizują ostatni wpis (`valueLength`, `t` zostaje z pierwszego znaku) — AC-3.3.
- `change` → tylko dla `checkbox`, `radio`, `select`, `file` (pola tekstowe mają już `input`): `inputType`, dla checkbox/radio `checked`
  (boolean, nie wartość), dla `select` `valueLength`, dla `file` liczba plików jako `valueLength`.
- `submit` → `selector` formularza. `key` → wyłącznie `Enter`, `Escape`, `Tab`, `ArrowUp/Down/Left/Right`, bez `repeat`, z `selector` celu.
- `navigate` → `url` (≤ 4000) i `via` ∈ {`navigate`, `reload`, `back_forward`, `pushState`, `replaceState`, `popstate`, `hashchange`}.
  Bez `selector`. Duplikat (ten sam URL w ≤ 50 ms) jest pomijany.
- Selektor (T5a): `#id`, jeśli unikalny → `tag[data-testid|data-test|data-test-id|data-qa|data-cy="…"]`, jeśli unikalny → ścieżka
  `tag:nth-of-type(k)` od najbliższego przodka z unikalnym id (albo od `html`), łączona ` > `. Ścieżka jest unikalna z konstrukcji,
  co sprawdza jedno `querySelectorAll` (AC-3.2). Shadow DOM: selektor hosta (cel po retargetingu). Limit 1000 znaków.
Konsekwencje: `History.prototype` dostaje Proxy (jak `fetch` w E1). `destroy()` przywraca oryginał, gdy na prototypie nadal stoi nasz
Proxy (wzorzec „restore guard” z E1 H2). Koszt selektora na dużym DOM (skan `[data-testid]`) mierzy TEST4 (≤ 0,5 ms p95 na fixture).
Na stronach z > 5000 elementów krok data-* jest pomijany, żeby nie skanować całego drzewa przy każdym kliknięciu. Wtedy działa id → ścieżka.

### D5 Zrzut ekranu: `captureVisibleTab` w tle przy `collect`, JPEG 60, dopasowanie rozmiaru w tle
Opcje: (a) `captureVisibleTab` w popupie; (b) **w tle** (`save.js` → `collect`), przed zebraniem danych ze strony; (c) `tabCapture`/`desktopCapture`
(nowe uprawnienia, zakazane w skillu).
**Wybór: (b).**
Uzasadnienie: w Chrome `captureVisibleTab` wymaga `activeTab` na tej karcie albo `<all_urls>`. Samo opcjonalne uprawnienie do origin
nie wystarcza (`CanCaptureVisiblePage`). *Zapisz paczkę* klika się w popupie otwartym ikoną na nagrywanej karcie, a otwarcie popupu nadaje
`activeTab` dla bieżącego dokumentu. Tło wywołuje więc `captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 })` bez nowego
uprawnienia (spike S1 i S4 dla Firefoksa). Tło i tak ustala wynik zapisu (D7 E1), ma pod ręką `tabs.get` do kontroli origin i nie zależy
od życia popupu. Kolejność w `collect`: `tabs.get` → zrzut **tylko** gdy `tab.active` i `isSameOrigin(tab.url, rec.origin)` → ponowne
`tabs.get` (karta nie zmieniła origin w trakcie, inaczej zrzut jest wyrzucany) → `collect` ze strony. Zrzut przedstawia więc stan z chwili
kliknięcia. Popup rozszerzenia jest osobnym oknem i nie trafia do obrazu (AC-6.2). Strona spoza origin, strona specjalna albo karta w tle
dają brak zrzutu i notatkę (AC-6.3). Wyjątek API, limit wywołań (Chrome: 2/s) albo przekroczony czas 3 s dają `screenshots: []`
i notatkę z powodem, a zapis idzie dalej (AC-6.4). Dopasowanie do `limits.screenshotBytes` (307 200 B) w `src/lib/screenshot.js`: jeśli
obraz z API jest ≤ limitu, bierzemy go bez zmian (dokładne wymiary, AC-6.1). W przeciwnym razie `createImageBitmap` + `OffscreenCanvas.convertToBlob`
(oba w SW Chrome i w event page Firefoksa): jakość 60 → 45 → 30, potem skala ×0,75 w pętli (≤ 8 prób). Nigdy nie obcinamy pliku.
Gdy nic nie zmieści się powyżej 320 px szerokości, zrzutu nie ma i jest notatka `too-large` (AC-6.5). Dekodowanie data URL robimy
ręcznie (base64 → `Uint8Array` → `Blob`), **bez `fetch`**, żeby tło nie zawierało żadnego wywołania sieciowego (AC-4.9).
Konsekwencje: zrzut jest tylko przy *Zapisz* (decyzja 1). JPEG trafia do JSON jako data URL (decyzja 2) w `attachments` (PB-2 A).
Pola `password` maskuje przeglądarka. Wartości innych pól są widoczne na obrazie, co pokrywa pozycja ujawnienia „zrzut widocznej
części strony”. Zrzut nie przechodzi przez `storage.session`: żyje w pamięci instancji tła w trakcie `collect` i wraca do popupu
w stringu JSON.

> **Uzupełnienie po spike T0 (orkiestrator, 2026-10-23):** Firefox cofa `activeTab` przy każdym przeładowaniu/nawigacji, także w tym samym
> originie (Chrome — tylko przy zmianie originu). Popup otwarty → przeładowanie → *Zapisz* w Firefoksie = brak zrzutu + notatka (AC-6.4);
> scenariusz do QA Firefoksa. Brak uprawnienia i limit wywołań Chrome mapują się na `capture-failed`.

### D6 Iframe'y same-origin: tylko błędy i `console.error`, z top-level MAIN
Opcje: (a) `allFrames: true` w rejestracji + bramka i most per ramka (router przyjmuje dziś tylko `frameId 0`, `hello` per ramka, tokeny,
flush per ramka); (b) **z dokumentu głównego**: recorder obserwuje `iframe` (lista istniejących + `MutationObserver`). Na każde `load`
ramki, jeśli `contentWindow` jest same-origin (dostęp bez wyjątku i `origin` równy), instaluje w nim `installConsoleHook({ levels:['error'] })`
i `installErrorHooks`. Rekordy idą do buforów dokumentu głównego z polem `frame` (URL ramki ≤ 4000).
**Wybór: (b)** (decyzja 8 bramki).
Uzasadnienie: zero zmian w rejestracji, routerze i kanale, ten sam limit i termin. Hooki istnieją, wystarczy inny `win`. Ramki
cross-origin rzucają przy dostępie, więc zostaje dla nich lista `dom.iframes[].src` jak dziś. Rekursja dla ramek zagnieżdżonych sięga
głębokości 2, a limit to 20 ramek.
Konsekwencje: błędy ramki sprzed jej zdarzenia `load` są tracone (znane ograniczenie, opis w `docs/snapshot-schema.md`). Po nawigacji
ramki stare hooki znikają razem z jej oknem, a nowe instalują się przy kolejnym `load`. Kroki, sieć i metryki ramek są poza E2.

### D7 Wyrocznia metryk w e2e: `web-vitals` jako devDependency (zalecane)
Opcje: (a) tylko progi z AC-5.1/5.2; (b) progi + porównanie z `web-vitals` (devDependency, serwowane przez serwer fixture z `node_modules`
pod `/vendor/web-vitals.attribution.js`, ładowane **przez fixture**, nie przez rozszerzenie).
**Wybór: (b).**
Uzasadnienie: to tani bezpiecznik dla D1, bo różnica > 10% między naszym `LCP`/`CLS`/`INP` a biblioteką na tej samej stronie od razu
sygnalizuje dryf definicji. Pakiet nie trafia do `dist` (walker), więc nie wpływa na rozmiar rozszerzenia.
Konsekwencje: `package.json` + lockfile (T13). Jeśli instalacja jest niepożądana, test `vitals match web-vitals` zostaje oznaczony `skip`
z komentarzem, a reszta TEST2 działa bez niego.

### D8 Termin przy zdarzeniu i żywe `otherOrigin` (E2-IN3, E2-IN1)
Opcje dla IN3: (a) `chrome.alarms` (nowe uprawnienie); (b) **kontrola `Date.now() >= deadline` przy każdym `record()` i przy `visibilitychange`
w MAIN → `stop('time-limit')` od razu** + istniejące leniwe wygaszanie w tle (`getStatus`/`hello`) + nowy komunikat tło → most → MAIN `stop`
po wygaszeniu w tle.
Opcje dla IN1: (a) popup odpytuje co sekundę; (b) **popup nasłuchuje `tabs.onUpdated` dla swojej karty → `refresh()`**, a tło liczy `otherOrigin`
z `tabs.get(rec.tabId).url`. Brak `url` oznacza brak uprawnienia do nowego hosta, czyli inny origin.
**Wybór: (b) w obu.**
Uzasadnienie: IN3 nie wymaga uprawnień. Monotoniczny `setTimeout` zostaje tylko jako dodatkowy mechanizm. Po wybudzeniu komputera
pierwsze zdarzenie strony albo otwarcie popupu zatrzymuje nagranie (AC-2.2). Dla IN1 `tabs.onUpdated` działa bez uprawnienia `tabs`
(wrażliwe pola są obcięte, ale samo zdarzenie przychodzi), a nawigacja wywołuje je w chwili commitu (≤ 1 s, AC-2.1). Filtra
`onUpdated(…, { tabId })` nie używamy, bo Chrome go nie obsługuje. Filtrujemy w handlerze. Tło jest źródłem prawdy, bo `ctx.tab.url`
w popupie jest nieaktualne po nawigacji.
Konsekwencje: typ I2M `stop` w kanale (`I2M_TYPES`). `PROTOCOL`/`RESULT_PROTOCOL` → 2 (zmiana kształtu wyniku `collect`).

### D9 Schemat paczki v3
Opcje: (a) nowe pola w v2 jako opcjonalne (skill: „v3 dopiero przy zmianie istniejącego pola”); (b) **v3**: zmiana semantyki `network[].type`
i zakresu `limits.network`, nowa kolejność kluczy, pola wymagane, `overview`.
**Wybór: (b)** (decyzja 5 bramki). Szczegóły w sekcji „Schema paczki”. Walidator schematu (`tests/helpers/snapshot-validator.js`)
jest jeden dla unit i e2e (AC-7.1).

## Architektura

```
 Zgłaszający ──klik ikony──▶ przeglądarka nadaje activeTab dla bieżącego dokumentu karty (potrzebne do captureVisibleTab, D5)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ POPUP  popup.html (360 px, 8 pozycji ujawnienia) · controller.js · view.js · messages.js                     │
 │  otwarcie: tabs.query → classify → getStatus; subskrypcje: storage.session.onChanged, tabs.onUpdated(tabId)  │
 │            ─▶ refresh() (NOWE: IN1 — żywe otherOrigin)                                                       │
 │  Zapisz: sendMessage(collect) ⇒ {json (z attachments), fileName} → Blob → downloads.download → saveStarted   │
 └───────────────┬──────────────────────────────────────────────────▲───────────────────────────────────────────┘
                 │ runtime.sendMessage (router: sender.url = popup/) │ storage.session.onChanged
 ┌───────────────▼──────────────────────────────────────────────────┴───────────────────────────────────────────┐
 │ TŁO  background.js → lib/recording.js, lib/save.js, lib/package.js, lib/screenshot.js (NOWE), lib/mask-secrets │
 │  getStatus: otherOrigin = !isSameOrigin(tabs.get(rec.tabId).url, rec.origin)   (NOWE, IN1)                   │
 │  wygaszenie terminu (getStatus/hello/stopped) → unregister, badge ■, tabs.sendMessage(stop) (NOWE, IN3)      │
 │  collect: tabs.get → [active && same origin] captureVisibleTab(windowId,{jpeg,60}) → fitJpeg ≤ 300 KB        │
 │           → tabs.get (origin bez zmian?) → tabs.sendMessage(collect) → assemblePackage v3 (+mask 2. przebieg)│
 └───────▲──────────────────────────────────────────────────┬───────────────────────────────────────────────────┘
         │ runtime.sendMessage: hello / flush(token) /        │ tabs.sendMessage(tabId, {collect|destroy|stop}, {frameId:0})
         │ stopped / bridgeError                              │
 ┌───────┴────────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
 │ ISOLATED  content/isolated-world.js — most; chrome.runtime; NIE widzi JS strony; bez nowych danych            │
 │  NOWE: relay `stop` z tła → MAIN                                                                             │
 └───────▲────────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
         │ N.dispatchEvent(CustomEvent('pds:m2i',              │ N.dispatchEvent(CustomEvent('pds:i2m',
         │   {detail: JSON-string {n:nonce, v, id, type, payload}}))   {detail: JSON-string {n:nonce, v, id, type, payload}}))
         │   M2I: result, flush, stopped                       │   I2M: config, collect, destroy, stop (NOWE)
         │   (prywatny węzeł z handshake'u D3 E1; strona nie ma referencji; NIE window.postMessage — nonce w każdej wiadomości)
 ┌───────┴────────────────────────────────────────────────────▼─────────────────────────────────────────────────┐
 │ MAIN  content/main-world.js — ZERO chrome.*; bufory w domknięciu; intrinsics z document_start                │
 │  recorder: console · errors · fetch(Proxy, +podgląd treści ≥400 → mask → attach) · XHR(Proxy, +podgląd)      │
 │   NOWE: steps (capture na window, History Proxy) · resources (PerformanceObserver 'resource' + error capture)│
 │         vitals (paint/LCP/layout-shift/event/LoAF + nav) · frames (same-origin iframe: console.error+errors) │
 │         selector (id > data-* > ścieżka; wspólny dla kroków i atrybucji)                                    │
 │   record(): Date.now() ≥ deadline → stop('time-limit') natychmiast (IN3)                                    │
 │  collect → snapshot({final: hidden}) ; beforeunload/pagehide → flush snapshot({final: true})                │
 └───────▲──────────────────────────────────────────────────────────────────────────────────────────────────────┘
         │ zdarzenia DOM (trusted, capture/passive), wywołania console/fetch/XHR/history, wpisy Performance
 ┌───────┴───────────────────┐        ┌─────────────────────────────────────────┐
 │ STRONA (skrypty strony)   │──────▶ │ iframe same-origin (hooki z MAIN rodzica)│
 └───────────────────────────┘        └─────────────────────────────────────────┘
```

Przepływy nowe lub zmienione względem E1:
1. *Kroki*: zdarzenie zaufane → handler MAIN (capture, passive) → `selectorOf` → `record('steps', …)` (koalescencja `input`) → bufor
   `steps` → `flush`/`collect` jak logi.
2. *Zasoby*: `PerformanceObserver('resource')` → `resourceRecord` → `record('network', …)`. Wpisy `fetch`/`xmlhttprequest` z RT trafiają do
   pierścienia korelacji, a zdarzenia `error` elementów do pierścienia błędów ładowania. W `snapshot()` `correlateSizes` + `mergeLoadErrors`
   działają na **kopiach** wpisów, a `documentStatus` pochodzi z Navigation Timing.
3. *Treść odpowiedzi*: fetch → `finish()` (nagłówki, wpis jak E1) → asynchronicznie klon → czytnik ≤ 8192 zn./2 s → `maskSecrets` → cięcie
   4096 → `attach(entry, {responseBodyPreview, responseBodyTruncated}, chars)` (budżet 256 KB, inaczej `truncated.responseBodies`).
4. *Metryki*: obserwatory od `document_start`. `snapshot()` woła `takeRecords()` i składa `vitals` (wartości, ratingi, atrybucja, `finalized`).
5. *Zrzut*: tło `collect` → (D5) → `meta.screenshots`/`meta.screenshotNote` → `assemblePackage` → `screenshots[]` + `attachments`.
6. *Termin*: MAIN `record()` lub `visibilitychange` po terminie → `stop('time-limit')` → `stopped` → tło. Tło wygasza też leniwie
   (`getStatus`) i wysyła `stop` → most → MAIN.
7. *otherOrigin*: `tabs.onUpdated` w popupie → `getStatus` → tło `tabs.get` → widok.

## Zmiany w manifeście

**Brak zmian w `src/manifest.base.json`, `manifest.chrome.json` i `manifest.firefox.json`** (przy PB-1 A).

| Klucz | Zmiana | Uzasadnienie |
|---|---|---|
| `permissions: activeTab` | bez zmian, **nowe użycie** | zrzut widocznej części karty przy *Zapisz paczkę* (`captureVisibleTab`). README PL/EN do aktualizacji (T12): EN „When the user clicks the toolbar icon, the extension reads the address of the current tab and, when the user clicks *Save*, captures a screenshot of the visible part of that tab for the report; without the click it cannot access any website.” |
| `permissions: scripting`, `storage`, `downloads` | bez zmian | jak E1 |
| `optional_host_permissions` | bez zmian (`http://*/*`, `https://*/*`, `file:///*`) | prośba tylko o origin karty; **bez poszerzania** (decyzja 4) |
| `webRequest` | **nie dodajemy** (D2) | potrzeba niewykazana w Chrome. Przy PB-1 (B) tylko `manifest.firefox.json` (wymaga zgody i store-reviewera) |
| `tabs`, `<all_urls>`, `cookies`, `alarms`, `offscreen`, `tabCapture`, `desktopCapture` | nie dodajemy | D5, D8, skill |
| usunięte | brak | — |

Różnice `dist/chrome` vs `dist/firefox` (jawnie):

| Obszar | `dist/chrome` | `dist/firefox` |
|---|---|---|
| Manifest | jak 0.3.0: `minimum_chrome_version: 121`, `background.service_worker` | jak 0.3.0: `browser_specific_settings.gecko` (128, `data_collection_permissions: none`), `background.scripts` |
| Pliki | identyczne (ten sam walker, te same bajty) | identyczne |
| CLS, INP, long tasks | dane (Chrome ≥ 123 dla LoAF; 121–122 → `unsupported-browser` dla long tasks) | `available: false, reason: "unsupported-browser"`, chyba że wykrywanie funkcji znajdzie API (PB-3) |
| Statusy zasobów/dokumentu | `responseStatus` (≥ 109) | `responseStatus`, jeśli jest (S4); inaczej PB-1 |
| Zrzut | `captureVisibleTab` w SW, `OffscreenCanvas` w SW | `captureVisibleTab` w event page, `OffscreenCanvas` w event page (S4) |
| Różnice w kodzie | brak gałęzi per przeglądarka. Wyłącznie wykrywanie funkcji w runtime | — |

## Schema paczki

`schemaVersion: 3` (zmiana łamiąca, decyzja 5). `SCHEMA_VERSION = 3` w `src/lib/package.js`, sekcja „Wersja 3” + tabela migracji w
`docs/snapshot-schema.md`, fixture `tests/fixtures/snapshots/v3.json` (v2.json zostaje do testów migracji). JSON z wcięciem 2.

Kolejność kluczy najwyższego poziomu (AC-7.2, wariant PB-2 A), wymuszana przez budowę obiektu w tej kolejności i test `Object.keys`:
```
schemaVersion, extensionVersion, source, collectedAt, recordingStartedAt, recordingStoppedReason, timeOrigin,   ← nagłówek v2
overview, limits, truncated,                                                                                       ← nagłówek (nowe/rozszerzone)
documents, notes, steps, runtimeErrors, network, vitals, screenshots, consoleLogs,
environment, performance, storage, dom,
attachments                                                                                                         ← tylko dane binarne (PB-2 A)
```
**Wymagane** (zawsze obecne; mogą być `null`/puste, wtedy z wpisem w `notes`): wszystkie klucze powyżej. **Opcjonalne** (tylko gdy jest dana):
`consoleLogs[].stack`, `runtimeErrors[].stack`, `*.frame`, `network[].statusUnavailable`, `responseBodyPreview`, `responseBodyTruncated`,
`documents[].statusUnavailable`, atrybucja metryk (`selector`, `url`, `sources`, `eventType`, fazy INP), `steps[].selector|text|inputType|valueLength|checked|key|url|via`,
`screenshots[].attachment`.

```jsonc
{
  "schemaVersion": 3,
  "extensionVersion": "0.4.0",
  "source": "extension",                         // | "console"
  "collectedAt": "ISO", "recordingStartedAt": "ISO", "recordingStoppedReason": null, "timeOrigin": 1768471204200.25,
  "overview": {                                  // NOWE — tylko liczby (+ zrzut tak/nie), z tego, co jest w paczce
    "runtimeErrors": 2, "consoleErrors": 1,      // consoleLogs z level "error"
    "failedRequests": 3,                         // network: status ≥ 400 lub error ≠ null
    "steps": 14, "poorVitals": 1,                // metryki z rating "poor" we wszystkich dokumentach
    "screenshot": true
  },
  "limits": { "consoleLogs": 5000, "runtimeErrors": 1000, "network": 5000, "steps": 2000, "entryChars": 40000,
              "stackChars": 16000, "responseBodyChars": 4096, "responseBodyTotalChars": 262144,
              "screenshotBytes": 307200, "longTasks": 20 },
  "truncated": { "consoleLogs": false, "runtimeErrors": false, "network": false, "steps": false, "responseBodies": false },
  "documents": [
    { "id": 0, "url": "…", "timeOrigin": 1768471200120.5, "navigationType": "reload",
      "status": 200,                              // NOWE (statusUnavailable?, gdy null)
      "recorded": true, "flushed": true, "current": false,
      "counts": { "consoleLogs": 1, "runtimeErrors": 0, "network": 6, "steps": 5 },
      "kept":   { "consoleLogs": 1, "runtimeErrors": 0, "network": 6, "steps": 5 } }
  ],
  "notes": ["…", "LCP, CLS and INP are values at the time of saving; they could still grow."],
  "steps": [                                      // NOWE; t względem documents[doc].timeOrigin
    { "t": 0, "doc": 0, "type": "navigate", "url": "http://127.0.0.1:8080/steps.html", "via": "reload" },
    { "t": 812.4, "doc": 0, "type": "click", "selector": "#login", "text": "Zaloguj" },
    { "t": 930.0, "doc": 0, "type": "input", "selector": "form > input:nth-of-type(1)", "inputType": "email", "valueLength": 15 },
    { "t": 1201.7, "doc": 0, "type": "input", "selector": "#pass", "inputType": "password" },
    { "t": 1300.2, "doc": 0, "type": "change", "selector": "[data-testid=\"terms\"]", "inputType": "checkbox", "checked": true },
    { "t": 1400.0, "doc": 0, "type": "key", "selector": "#pass", "key": "Enter" },
    { "t": 1401.0, "doc": 0, "type": "submit", "selector": "#loginForm" }
  ],
  "runtimeErrors": [ { "t": 8.7, "doc": 1, "type": "error", "message": "…", "filename": "…", "lineno": 3, "colno": 9,
                       "stack": "… (≤ 16 000)", "frame": "http://…/inner.html" /* tylko z iframe'u */ } ],
  "network": [                                    // type: fetch|xhr|img|script|css|font|other (ZMIANA SEMANTYKI)
    { "t": 12.5, "doc": 1, "type": "fetch", "method": "POST", "url": "…/api/fail", "status": 500, "statusText": "…", "ok": false,
      "redirected": false, "durationMs": 3.21, "sizeBytes": 23, "requestHeaders": {}, "responseHeaders": {}, "requestBody": "…",
      "responseBodyPreview": "{\"error\":\"expired\",\"access_token\":\"[redacted:key-token]\"}", "responseBodyTruncated": false, "error": null },
    { "t": 40.1, "doc": 1, "type": "img", "method": "GET", "url": "…/img/missing.png", "status": 404, "statusText": null, "ok": false,
      "redirected": null, "durationMs": 2.4, "sizeBytes": 9, "requestHeaders": {}, "responseHeaders": {}, "requestBody": null, "error": null,
      "initiatorType": "img" },
    { "t": 41.0, "doc": 1, "type": "img", "method": "GET", "url": "https://cdn.example/x.png", "status": null,
      "statusUnavailable": "cross-origin", "statusText": null, "ok": null, "redirected": null, "durationMs": 20.1, "sizeBytes": null,
      "requestHeaders": {}, "responseHeaders": {}, "requestBody": null, "error": null, "initiatorType": "img" }
  ],
  "vitals": [                                     // NOWE: jeden wpis na dokument z danymi (flushed lub bieżący)
    { "doc": 1,
      "TTFB": { "available": true, "value": 47, "rating": "good", "t": 47, "finalized": true },
      "FCP":  { "available": true, "value": 820, "rating": "good", "t": 820, "finalized": true },
      "LCP":  { "available": true, "value": 1712, "rating": "good", "t": 1712, "finalized": false,
                "selector": "#hero", "url": "http://…/img/hero.png" },
      "CLS":  { "available": true, "value": 0.183, "rating": "needs-improvement", "t": 560, "finalized": false,
                "sources": [ { "selector": "main > p:nth-of-type(1)", "value": 0.183, "t": 560 } ] },
      "INP":  { "available": true, "value": 336, "rating": "needs-improvement", "t": 2100, "finalized": false,
                "selector": "#slow", "eventType": "click", "inputDelay": 2, "processing": 304, "presentation": 30, "interactions": 1 },
      "longTasks": { "available": true, "items": [ { "t": 300.2, "duration": 212, "blockingDuration": 162,
                     "scripts": [ { "url": "http://…/heavy.js", "function": "heavyWork", "invoker": "…", "duration": 205 } ] } ] } }
    // niedostępne: { "available": false, "reason": "unsupported-browser" | "no-interaction" | "hidden-at-start" | "no-data" }
  ],
  "screenshots": [ { "t": 5230.1, "doc": 1, "reason": "save", "mime": "image/jpeg", "width": 1280, "height": 720,
                     "bytes": 81234, "attachment": "screenshot-0" } ],
  "consoleLogs": [ { "t": 15.2, "doc": 1, "level": "error", "args": [ { "name": "TypeError", "message": "…", "stack": "…",
                     "cause": { "name": "Error", "message": "…", "stack": "…" } } ], "stack": "…" } ],
  "environment": {}, "performance": {}, "storage": {}, "dom": {},     // treść jak v2 (E3 zmieni dom/storage)
  "attachments": { "screenshot-0": "data:image/jpeg;base64,/9j/…" }  // ostatni; {} gdy brak zrzutu
}
```

Diff v2 → v3 (do `docs/snapshot-schema.md`):
| v2 | v3 | Migracja przy odczycie v2 |
|---|---|---|
| `schemaVersion: 2` | `3` | — |
| kolejność: nagłówek, `documents`, `limits`, `truncated`, `notes`, sekcje, rekordy | jak wyżej (rekordy przed sekcjami, `dom` ostatnia tekstowa) | nie dotyczy (kolejność nie zmienia typów) |
| — | `overview` | policzyć z rekordów; `poorVitals: 0`, `screenshot: false` |
| `network[].type` ∈ {`fetch`,`xhr`} | + `img`/`script`/`css`/`font`/`other`; `sizeBytes`, `statusUnavailable?`, `responseBodyPreview?`, `responseBodyTruncated?`, `initiatorType?` (zasoby) | `sizeBytes: null`; zasobów w v2 nie ma (były tylko w `performance.resources`) |
| `limits.network` = fetch+XHR | fetch+XHR+zasoby | — |
| `limits`/`truncated` | + `steps`, `stackChars`, `responseBodyChars`, `responseBodyTotalChars`, `screenshotBytes`, `longTasks` / + `steps`, `responseBodies`; `entryChars` 10000 → 40000 | brak ⇒ nieznane |
| `documents[]` | + `status`, `statusUnavailable?`; `counts`/`kept` + `steps` | `status: null`, `statusUnavailable: "unknown"` |
| `*.stack` ≤ 4000 | ≤ 16 000; `Error` w `args`/`reason` ma `cause` (≤ 5 poziomów) | — |
| — | `steps`, `vitals`, `screenshots`, `attachments` (wymagane, mogą być puste) | `[]`, `[]`, `[]`, `{}` |
| — | `runtimeErrors[].frame?`, `consoleLogs[].frame?` | — |

Limity i zasady:
- `steps` ≤ 2000 w paczce i na dokument. Zostają najnowsze, a `truncated.steps` działa jak dla innych tablic (AC-3.6). `counts`/`kept` mają `steps`.
- Podglądy treści ≤ 4096 znaków na odpowiedź i ≤ 262 144 łącznie (na dokument w recorderze i w paczce). Ponad budżet starsze podglądy
  tracą pole, `truncated.responseBodies` jest `true` i pojawia się notatka.
- Zrzut ≤ 307 200 B (zdekodowane bajty JPEG). `bytes` = rozmiar JPEG, nie długość base64.
- `vitals[].longTasks.items` ≤ 20 (po `blockingDuration`). `CLS.sources` ≤ 5.
- `overview` liczy z tego, co jest **w paczce** (po limitach), nie z `counts`.
- Fallback konsolowy (`source: "console"`): te same klucze wymagane; `screenshots: []`, `attachments: {}` + notatka „Screenshots are not
  available without the extension.”; INP tylko z interakcji po wklejeniu + notatka (AC-5.8, AC-7.5).
- `extensionVersion` 0.4.0 ustala release (podbicie `RECORDER_VERSION` + `npm run gen`, pilnowane przez IN5).

## Zadania

Konwencje (jak E1): testy najpierw, DoD = testy zielone + `npm test` całość zielony + eslint czysty na zmienionych plikach. Pliki generowane
(`src/content/*`, `src/standalone/console-snapshot.js`) nie liczą się do limitu linii. Każde zadanie zmieniające `src/page/*` lub `src/lib/package.js`/
`src/lib/mask-secrets.js` kończy się `npm run gen` **tylko** w zadaniach grupy D (T9b, T7b). Wcześniejsze zadania nie commitują regeneracji, żeby
równoległe gałęzie nie konfliktowały na bundlach. `gen --check` w nich może być czerwony; to oczekiwane i odnotowane w `state.md`.
Składnia modułów `src/page`/`src/lib` według CLAUDE.md. W kodzie i komentarzach **nie** pisać `url(` (poprzedzone niesłowem), `getURL(`,
`import(`, `require(` — fail-safe walkera i generatora.

### E2-T0 Spike: zrzut, `responseStatus`, Firefox, `webRequest` bez host permission  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/spike-e2/run.spike.mjs`, `tests/e2e/spike-e2/ext/` (minimalne rozszerzenie w tmp, jak E1-T0), `docs/epics/E2/spike-T0.md`.
Co zrobić (timebox: jeden przebieg; zacząć pierwsze, równolegle z grupą A):
- S1 Chromium (Playwright, nowy headless): popup przez `Extensions.triggerAction` → SW `tabs.captureVisibleTab(windowId, {format:'jpeg', quality:60})`.
  Czy działa, wymiary vs `innerWidth×innerHeight×dpr`, kolor 4 rogów (popup niewidoczny). Kontrola: tylko `grantOrigin`, bez otwarcia popupu
  po nawigacji na inny origin i z powrotem → zapisać komunikat błędu (mapowanie powodów w T6a).
- S2 Chromium: czy `activeTab` z popupu przetrwa przeładowanie w obrębie origin (popup otwarty przed reloadem, zrzut po).
- S3 Chromium: `responseStatus` dla same-origin `<img>` 404, `<script>` 404, CSS 200, font; `<img>` cross-origin (localhost) → `0`?;
  nawigacja na stronę 404 → `PerformanceNavigationTiming.responseStatus`; zasób z zamkniętego portu: wpis RT? zdarzenie `error`?
- S4 Firefox (ręcznie, `web-ext run`, ~15 min): `'responseStatus' in PerformanceResourceTiming.prototype` i navigation;
  `PerformanceObserver.supportedEntryTypes`; `'interactionId' in PerformanceEventTiming.prototype`; `captureVisibleTab` z event page po otwarciu
  popupu (wymiary); `OffscreenCanvas.convertToBlob({type:'image/jpeg'})` + `createImageBitmap(Blob)` w event page.
- S5 Chromium: rozszerzenie z `webRequest` + opcjonalnym `http://127.0.0.1/*` (nadanym) → strona 127.0.0.1 z obrazkiem z `localhost`:
  `onCompleted` widzi tylko 127.0.0.1 (potwierdzenie D2). Bez instalowania w głównym rozszerzeniu.
- S6 Chromium: `fetch` 500 ze strumieniem bez końca (`text/plain`): klon + czytnik 2 s + `cancel()` → strona dalej czyta swoją gałąź; `bodyUsed`.
Testy do napisania najpierw (w skrypcie, PASS/FAIL per punkt): `spike: S1 captureVisibleTab after triggerAction (jpeg, dims, corners)`,
`spike: S2 activeTab survives same-origin reload`, `spike: S3 responseStatus same-origin 404 / cross-origin 0 / navigation 404`,
`spike: S5 webRequest sees only granted origin`, `spike: S6 clone reader cancel keeps page branch`.
Definicja ukończenia: `spike-T0.md` z wynikami S1–S6, wersjami (Chromium, Playwright, Firefox) i decyzjami: PB-1 tak/nie (S4), mapowanie
powodów zrzutu, Firefox `captureVisibleTab` OK/nie (jeśli nie → AC-6.6 do bramki). Przy porażce S1 architekt wraca do D5 przed T6b.

### E2-T7a Pełne stosy i `cause` w serializacji (E2-T7)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/serialize.js`, `src/page/hooks-console.js`, `src/page/hooks-errors.js`, `src/page/constants.js`, `tests/unit/serialize.test.js`
(+ istniejące `hooks-console.test.js`, `hooks-errors.test.js` — tylko nowe przypadki).
Co zrobić:
- `STACK_MAX_CHARS` 4000 → 16 000 (`hooks-console.js`). W `hooks-errors.js` osobny `STACK_MAX_CHARS = 16000` dla `stack`, a `TEXT_MAX_CHARS`
  (4000) zostaje dla `message`/`filename`.
- `serialize.js`: `Error` → `{ name, message, stack, cause? }`. `cause` rekurencyjnie do 5 poziomów (głębiej: `"[cause depth limit]"`),
  `cause` nie-`Error` przez zwykłą serializację, `stack` przyczyn ≤ 4000 znaków, stos główny ≤ 16 000. Cykl `cause` → `[Circular]`.
- `constants.js`: `LIMITS.entryChars` 10 000 → 40 000 (stos 16 000 + łańcuch przyczyn musi się zmieścić w `args`).
Testy do napisania najpierw:
- `runtime error stack equals error.stack for 10 frames with 300-char URLs` (AC-4.8),
- `console stack equals call stack for stacks up to 16000 chars; longer is cut at 16000`,
- `console.error(err) args contain name, message, full stack and cause chain of 5 levels; 6th level marked` (AC-4.8),
- `cause cycle yields [Circular]`, `non-Error cause serialized as value`,
- `message still capped at 4000`.
Definicja ukończenia: testy zielone, dotychczasowe testy `serialize`/`hooks-*` zielone bez zmian asercji poza limitem 4000.

### E2-T5a Selektor elementu (część E2-T5)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/selector.js`, `tests/unit/selector.test.js`, `tests/fixtures/pages/selectors.html` (fragment DOM do testu jsdom, 20 elementów).
Co zrobić:
- `export function createSelectorOf({ doc, intrinsics })` → `selectorOf(el) → string | null` według D4 (id → data-* → ścieżka `nth-of-type` od
  najbliższego przodka z unikalnym id). Unikalność sprawdza przechwycone `querySelectorAll`. `CSS.escape` (z fallbackiem dla jsdom).
- `export function captureSelectorIntrinsics(win)` (querySelectorAll, getAttribute, closest, gettery `tagName`/`parentElement`/`id`/`children`).
- Próg 5000 elementów: powyżej pomijamy krok data-*. Limit 1000 znaków. Element odłączony od dokumentu → `null`.
- Bez `url(`/`getURL(` w kodzie.
Testy do napisania najpierw:
- `selector is unique for all 20 fixture elements (with id, with data-testid, with neither)` (AC-3.2),
- `prefers id over data-testid over path`, `duplicate id falls back to data-testid then path`,
- `escapes ids with special chars (":" , space, leading digit)`,
- `page patching Element.prototype.getAttribute after capture does not change result`,
- `detached element returns null`, `selector length capped`.
Definicja ukończenia: testy zielone; moduł bez importów spoza `src/page`.

### E2-T1a Matematyka metryk (część E2-T1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/vitals-math.js`, `tests/unit/vitals-math.test.js`.
Co zrobić (czyste funkcje, bez DOM):
- `THRESHOLDS` i `rate(name, value)` według skilla (LCP 2500/4000, CLS 0.1/0.25, INP 200/500, FCP 1800/3000, TTFB 800/1800).
- `clsFromShifts(entries)` → `{ value, t, windowEntries }`: pomija `hadRecentInput`, okna sesyjne (przerwa > 1 s lub okno > 5 s → nowe), bierze
  największe okno. `value` zaokrąglone do 3 miejsc.
- `inpFromEvents(entries)` → `{ value, entry, count } | null`: grupuje po `interactionId > 0`, maks. `duration` w grupie; p98 przybliżony
  (`count < 50` → maks.; inaczej `sorted[Math.min(len-1, floor(count/50))]` z listy 10 najdłuższych).
- `inpPhases(entry)` → `{ inputDelay, processing, presentation }` (`processingStart-startTime`, `processingEnd-processingStart`,
  `startTime+duration-processingEnd`; ujemne → 0).
- `topLongTasks(loafs, max)` → `[{ t, duration, blockingDuration, scripts: [{ url, function, invoker, duration }] }]` po `blockingDuration`.
- `unavailable(reason)` → `{ available: false, reason }`.
Testy do napisania najpierw:
- `rating boundaries for each metric (value at threshold is good/needs-improvement as in web.dev)` (AC-5.1),
- `CLS takes the largest session window, not the sum` (2 okna), `CLS ignores hadRecentInput`, `CLS window closes after 1 s gap and at 5 s`,
- `INP with 1 interaction equals its duration`, `INP with 120 interactions takes ~p98`, `events without interactionId ignored`,
- `INP phases sum to duration` (AC-5.2), `top 20 long tasks by blockingDuration with script url and function` (AC-5.3).
Definicja ukończenia: testy zielone.

### E2-T3a Zasoby, rodzaj, korelacja rozmiarów (E2-T3 + E2-TEST1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/network-merge.js`, `tests/unit/network-merge.test.js`.
Co zrobić (czyste funkcje):
- `resourceKind(initiatorType, url)` → `img|script|css|font|other` albo `null` dla `fetch`/`xmlhttprequest`/`navigation` (rozszerzenie pliku:
  `woff2?|ttf|otf|eot` → font, `css` → css, `png|jpe?g|gif|webp|avif|svg|ico` → img, `m?js` → script; potem `initiatorType`:
  `img`/`image`/`input` → img, `script` → script, `link` → css; reszta → other).
- `resourceRecord(entry, { docOrigin, supportsStatus })` → wpis sieci v3 (kolejność kluczy jak w schemacie). Status według D2: `responseStatus > 0` → status;
  cross-origin → `null` + `cross-origin`; brak API → `unsupported-browser`; same-origin `0` → `network-error`. `sizeBytes` według D2.
- `correlateSizes(hookEntries, rtEntries)` → nowa tablica: dla każdego wpisu `fetch`/`xhr` (wg `t`) pierwszy nieprzypisany wpis RT tego samego URL
  i rodzaju (`fetch`↔`fetch`, `xhr`↔`xmlhttprequest`) z `startTime ∈ [t-5, t+1000]`. Przypisuje tylko `sizeBytes`, **nigdy** statusu.
- `mergeLoadErrors(records, loadErrors)`: błąd ładowania elementu (`{t, url, kind}`) → `error: 'load-failed'` na pasującym wpisie zasobu, a bez
  dopasowania nowy wpis `status: null`, `statusUnavailable: 'network-error'`.
- `documentStatus(navEntry, supportsStatus)` → `{ status }` | `{ status: null, statusUnavailable }`.
Testy do napisania najpierw (E2-TEST1):
- `3 identical fetch('/api/x') within 50 ms map 1:1 to 3 RT entries in order; statuses 200/500/404 untouched; no extra entries` (AC-4.4),
- `RT entries of initiatorType fetch/xmlhttprequest never become own records` (AC-4.4),
- `unmatched hook entry keeps sizeBytes null`, `RT entry far outside window not assigned`,
- `kind mapping table` (AC-4.1), `cross-origin entry with responseStatus 0 → null + cross-origin; never bare 0` (AC-4.3),
- `same-origin 404 img keeps status 404`, `unsupported browser → statusUnavailable unsupported-browser` (AC-5.4-analog dla statusów, PB-1),
- `load error merged into matching entry; unmatched load error becomes network-error record`,
- `documentStatus from navigation responseStatus 404` (AC-4.2).
Definicja ukończenia: testy zielone; brak importów.

### E2-T4a Maskowanie u źródła (część E2-T4)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/mask-secrets.js`, `tests/unit/mask-secrets.test.js`, `tests/fixtures/redaction/e2-bodies.json` (≥ 15 przykładów wrażliwych, ≥ 10 łagodnych).
Co zrobić:
- `export function maskSecrets(text) → { text, masked }`: reguły `jwt`, `bearer`, klucze z listy skilla `privacy-redaction` (granice wyrazu `[_\-.]|^|$`)
  w JSON (`"klucz"\s*:\s*"…"` oraz wartości liczbowe/boolean bez zmian) i w `klucz=wartość` (do `&`, białego znaku lub końca).
  Zamiana na `"[redacted:jwt]"`, `"[redacted:bearer]"`, `"[redacted:key-<token>]"` (dla JSON w cudzysłowie, żeby JSON pozostał poprawny).
- `export function cutPreview(text, max)` → `{ preview, truncated }` z usunięciem końcowego niepełnego „wyrazu” (D3).
- Idempotentne, bez DOM, bez przechwytywania globali (moduł działa w MAIN i w tle; w MAIN regexy są tworzone przy załadowaniu bundla,
  na `document_start`).
Testy do napisania najpierw:
- `{"error":"expired","access_token":"eyJ…"} → access_token value replaced by [redacted:key-token]; JSON still parses` (AC-4.7),
- `Bearer token in plain text replaced by [redacted:bearer]`, `bare JWT anywhere → [redacted:jwt]` (AC-4.7),
- `corpus e2-bodies.json: 0 leaks of sensitive values` , `benign corpus: ≤ 2 false positives (documented)`,
- `idempotent: mask(mask(x)) === mask(x)`, `cutPreview never ends with a partial token`, `masked count reported`.
Definicja ukończenia: testy zielone; moduł zgodny ze składnią generatora (import z `src/page` przez `../lib/mask-secrets.js` sprawdzony w T9b).

### E2-T6a Zrzut: przechwycenie i dopasowanie rozmiaru (część E2-T6)  [niezależne: tak]  [zależy od: — (S1 może zmienić powody)]
Pliki: `src/lib/screenshot.js`, `tests/unit/screenshot.test.js`.
Co zrobić:
- `captureScreenshot({ tabs, tab, codec, now, maxBytes, timeoutMs = 3000 })` → `{ shot: { epochMs, mime, width, height, bytes, dataUrl } }`
  | `{ error: 'capture-failed' | 'timeout' | 'too-large' }`. Woła `tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 })`.
- `fitJpeg({ dataUrl, maxBytes, codec })` według D5 (≤ limitu → bez zmian; jakość 60/45/30; skala ×0,75; min 320 px; ≤ 8 prób).
- `bytesOfDataUrl`, `dataUrlToBlob` (ręczne base64, **bez `fetch`**), `blobToDataUrl` (`arrayBuffer` + `btoa` w kawałkach).
- `createCanvasCodec(scope)` — `createImageBitmap` + `OffscreenCanvas` (`decode(dataUrl) → {bitmap, width, height}`, `encode(bitmap, w, h, quality) → Blob`).
  Pokrywa go e2e (jsdom nie ma tych API).
Testy do napisania najpierw (atrapa kodeka: rozmiar = f(piksele, jakość)):
- `image under limit is returned unchanged (same dims)` (AC-6.1), `4K image is recompressed/downscaled to ≤ 307200 bytes, never truncated` (AC-6.5),
- `quality ladder before downscale`, `gives up below 320 px with too-large`,
- `captureVisibleTab throwing → capture-failed`, `hanging capture → timeout after 3 s` (AC-6.4),
- `bytes counts decoded JPEG bytes, not base64 length`, `module source contains no fetch(`.
Definicja ukończenia: testy zielone; moduł bez `window`/`document`.

### E2-T12 Popup: ujawnienie, układ 360×600, README  [niezależne: tak]  [zależy od: —]
Pliki: `src/popup/messages.js`, `src/popup/popup.html`, `tests/unit/messages.test.js`, `tests/unit/popup-html.test.js`, `README.md`.
Co zrobić:
- `disclosureItems` + 3 pozycje (PL, bez żargonu), np. „kroki: co klikasz i na jakich stronach — bez treści, które wpisujesz”, „zrzut widocznej
  części strony w chwili zapisu”, „fragmenty odpowiedzi serwera, gdy coś się nie uda”. Tekst w `popup.html` identyczny.
- Lista zakazanych słów w teście słownika: dotychczasowe + `CWV`, `LCP`, `webRequest`, `HTTP`, `base64`, `selector`.
- `popup.html`: `body` 328 px + padding 16 (= 360), zwarte marginesy i font 12–13 px dla listy. `.actions` w `#ready`: `position: sticky; bottom: 0`
  z tłem, żeby *Nagrywaj* był widoczny nawet przy dłuższym tekście. Kolejność DOM `#noUpload < #consentNotice < #record` bez zmian.
- README `## Uprawnienia`: zaktualizowane PL/EN dla `activeTab` (zrzut przy *Zapisz*). Nowych uprawnień brak.
Testy do napisania najpierw:
- `disclosure lists steps without typed text, screenshot and server responses on errors` (AC-1.1),
- `messages contain no forbidden words incl. CWV, LCP, webRequest, HTTP, base64, selector` (AC-1.2),
- `popup.html static disclosure equals MESSAGES` (AC-1.1), `button set equals E1 set {record, save}` (AC-1.4),
- `consent order unchanged`, `README activeTab line mentions screenshot in PL and EN` (E0 AC-ST.3).
Definicja ukończenia: testy zielone; widoczność przycisku sprawdza TEST5 (e2e).

### E2-T11 Żywe `otherOrigin` i zatrzymanie po terminie w tle (E2-IN1, E2-IN3 — tło/popup)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/recording.js`, `src/popup/controller.js`, `tests/unit/background-recording.test.js`, `tests/unit/popup-controller.test.js`, `tests/unit/helpers/fake-chrome.js`.
Co zrobić:
- `getStatus`: dla `isRecordingTab` `otherOrigin` = `!isSameOrigin((await tabs.get(rec.tabId)).url, rec.origin)`. Brak `url` → `true`. Błąd `tabs.get`
  → dotychczasowa reguła z `url` z komunikatu.
- `afterStop(rec)`: po wyrejestrowaniu i badge'u best-effort `tabs.sendMessage(rec.tabId, { type: 'stop', reason: 'time-limit' }, { frameId: 0 })`.
- `controller.js`: w `init()` dla `target === 'web'` `api.tabs.onUpdated.addListener(onTabUpdated)`. Handler: `tabId === ctx.tab.id` → `refresh()`.
  `destroy()` zdejmuje listener. Bez argumentu filtra (Chrome go nie obsługuje).
- `fake-chrome.js`: `tabs.onUpdated` z `fire(tabId, changeInfo)`, `tabs.get` zwracający `url` zależnie od „uprawnienia”.
Testy do napisania najpierw:
- `popup refreshes on tabs.onUpdated of its tab and shows otherOrigin; back on origin note disappears` (AC-2.1),
- `onUpdated of another tab is ignored`, `destroy removes onUpdated listener`,
- `getStatus: tab url hidden (no permission) → otherOrigin true; same origin other path → false`,
- `Date.now() 11 min past start, timer not fired: getStatus → state stopped, stopReason time-limit, stop sent to tab` (AC-2.2, część tła),
- `onInstalled after update clears recording and scripts` (AC-1.6, regresja).
Definicja ukończenia: testy zielone; `popup-background-integration.test.js` zielony.

### E2-IN2 Teardown e2e: `git status` poza `docs/`  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/helpers/git-status.js`, `tests/e2e/global-teardown.js`, `tests/unit/git-status.test.js`.
Co zrobić: `gitStatus({ exclude = ['docs/'] })` filtruje linie porcelain, których ścieżka (także po `->` przy rename) zaczyna się od wykluczonego
prefiksu. Setup i teardown używają tej samej funkcji.
Testy do napisania najpierw: `porcelain lines under docs/ are ignored`, `rename into docs/ ignored, out of docs/ kept`, `other changes still reported`.
Definicja ukończenia: testy zielone; e2e teardown nie zgłasza zmian w `docs/` przy równoległej pracy.

### E2-IN4 Generator: moduł importowany tylko dla efektu ubocznego bez stałej  [niezależne: tak]  [zależy od: —]
Pliki: `scripts/gen-content.mjs`, `tests/unit/gen-content.test.js`.
Co zrobić: przy wiązaniu modułu (`const __pds_mN = …`) emitować przypisanie tylko, gdy którykolwiek import używa jego bindingów lub
`export … from`. Dla `import './x.js'` (i wejścia) emitować samo `(function () { … })();`.
Testy do napisania najpierw: `side-effect-only module is emitted without const binding`, `module used by named import keeps binding`,
`ESLint no-unused-vars passes on a bundle with side-effect import`.
Definicja ukończenia: testy zielone; `npm run gen -- --check` po regeneracji zielony (regeneracja w T9b).

### E2-IN5 Kontrola wersji przy `pack`  [niezależne: tak]  [zależy od: —]
Pliki: `scripts/check-release.mjs`, `scripts/pack.mjs`, `tests/unit/check-release.test.js`.
Co zrobić: `checkRelease({ root })` → lista błędów: `RECORDER_VERSION` (odczyt regexem z `src/page/constants.js`) ≠ `manifest.base.json.version`;
`generateAll({ check: true })` zwraca nieaktualne bundle. `pack()` woła `checkRelease` przed buildem i kończy się błędem z listą. CLI
`node scripts/check-release.mjs`.
Testy do napisania najpierw: `mismatched RECORDER_VERSION fails with both versions in message`, `stale bundle fails`, `consistent tree passes`,
`pack refuses to zip on failed check` (tmp root).
Definicja ukończenia: testy zielone; `npm run pack` na czystym drzewie działa.

### E2-T13 Serwer fixture: trasy statusów, opóźnień, sekwencji, drugi origin, wyrocznia metryk  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/helpers/fixtures-server.js`, `tests/unit/fixtures-server.test.js`, `tests/fixtures/pages/img/hero.png` (mały PNG), `package.json` (+ lockfile; devDependency `web-vitals`, D7).
Co zrobić:
- `/status/<code>?type=<mime>&body=json|text|token|png|page&delay=<ms>` (body `token` = `{"error":"expired","access_token":"<JWT>"}` + linia `Authorization: Bearer <…>`;
  `page` = prosta strona HTML), `/seq/<name>` (kolejne odpowiedzi 200 → 500 → 404, `?reset`), `/img/hero.png?delay=<ms>`, `/stream/500` (nieskończony `text/plain` 500),
  `/echo/headers` (zapamiętuje nagłówki żądania pod `?id=`, `GET /echo/last?id=` je zwraca, AC-4.9), `/vendor/web-vitals.attribution.js` z `node_modules`.
- Drugi origin: ten sam serwer pod `http://localhost:<port>` (już działa w E1, test na zasób cross-origin).
Testy do napisania najpierw: `status route returns code, type and body`, `delay route waits ≥ ms`, `seq route cycles 200/500/404 and resets`,
`echo stores request headers by id`, `stream route never ends (first chunk arrives)`, `vendor route serves web-vitals`.
Definicja ukończenia: testy zielone; `npm run fixtures` działa do QA Firefoksa.

### E2-T5b Rejestrator kroków (E2-T5)  [niezależne: nie]  [zależy od: T5a]
Pliki: `src/page/hooks-steps.js`, `tests/unit/hooks-steps.test.js`.
Co zrobić:
- `installStepsHook({ win, doc, now, record, selectorOf, intrinsics })` → `restore()` według D4: listenery capture+passive na `window`, Proxy `apply`
  na `History.prototype.pushState/replaceState` (wywołanie oryginału dokładnie raz, potem krok), `popstate`/`hashchange`, krok `navigate` przy instalacji
  (`via` z `navigationType`).
- Koalescencja `input`: referencja do ostatniego wpisu i elementu. Kolejny `input` tego samego elementu bez innego kroku pomiędzy → aktualizacja `valueLength`.
- Wyłącznie `isTrusted`. Żadnego `value` w rekordzie. Każdy błąd połknięty.
- `restore()`: zdejmuje listenery, przywraca metody History, jeśli wciąż są nasze.
Testy do napisania najpierw (jsdom; zaufanie zdarzeń przez `isTrusted`-atrapę wstrzykiwaną w teście):
- `click on button records selector and text ≤ 80; click on input has no text` (AC-3.5),
- `typing 18 chars into email field gives one input step with valueLength 18` (AC-3.3),
- `password input step has inputType only; no value or valueLength anywhere` (AC-3.4), `contenteditable step has no text content` (AC-3.4),
- `key steps only for Enter/Escape/Tab/arrows; letters never recorded` (AC-3.4),
- `checkbox change records checked; select change records valueLength only`,
- `submit records form selector`, `pushState/replaceState/popstate/hashchange record navigate with url and via` (AC-3.1),
- `untrusted events ignored`, `page handler stopPropagation/preventDefault unaffected; defaultPrevented same with and without hook` (AC-3.7),
- `restore removes listeners and puts back History methods (===)`.
Definicja ukończenia: testy zielone.

### E2-T1b Obserwatory metryk (E2-T1)  [niezależne: nie]  [zależy od: T1a, T5a]
Pliki: `src/page/vitals.js`, `tests/unit/vitals.test.js`, `tests/unit/helpers/fake-performance.js`.
Co zrobić:
- `installVitals({ win, doc, now, selectorOf, intrinsics, accept, options: { interactionsSince } })` → `{ snapshot({ final }), restore() }`.
- Wykrywanie funkcji: `PerformanceObserver.supportedEntryTypes`, `interactionId` w `PerformanceEventTiming.prototype`, LoAF. Brak → `unavailable('unsupported-browser')`.
- Obserwatory `buffered: true`: `paint`, `largest-contentful-paint` (selektor i `url` liczone w callbacku), `layout-shift` (selektory ≤ 5 źródeł na wpis o `value ≥ 0.001`, limit 50 wpisów),
  `event` (`durationThreshold: 16`) + `first-input`, `long-animation-frame`. TTFB z navigation (`responseStart - activationStart`).
- `firstHiddenTime`: `hidden` przy instalacji → 0; `visibilitychange` → min. Wpisy LCP/FCP po `firstHiddenTime` są ignorowane, a bez wpisów
  dostajemy `hidden-at-start` (gdy 0) albo `no-data`. INP bez interakcji (lub tylko przed `interactionsSince`) → `no-interaction`.
- `snapshot({ final })`: `takeRecords()` na każdym obserwatorze, składanie przez T1a, `finalized` = `final` dla LCP/CLS/INP (TTFB/FCP zawsze `true`),
  `t` względem `timeOrigin`. `accept(t)` (termin) odrzuca wpisy po terminie.
Testy do napisania najpierw (atrapa `PerformanceObserver` z typami i `takeRecords`):
- `TTFB, FCP, LCP, CLS present with value and rating` (AC-5.1), `LCP uses the last entry and reports selector and url` (AC-5.2),
- `CLS sources carry selector and shift value` (AC-5.2), `INP carries target selector, event type and three phases` (AC-5.2),
- `browser without layout-shift/event/LoAF → available:false reason unsupported-browser, keys present` (AC-5.4), `no LoAF (Chrome 121–122) → longTasks unsupported-browser` (AC-5.4),
- `no interaction → INP no-interaction` (AC-5.5), `visible at snapshot → finalized:false; final → true` (AC-5.6), `hidden at start → LCP/FCP hidden-at-start` (AC-5.6),
- `interactionsSince filters earlier interactions` (AC-5.8), `entries past deadline rejected`, `restore disconnects all observers`.
Definicja ukończenia: testy zielone.

### E2-T3b Obserwator zasobów i status dokumentu (E2-T3)  [niezależne: nie]  [zależy od: T3a]
Pliki: `src/page/hooks-resources.js`, `tests/unit/hooks-resources.test.js`.
Co zrobić:
- `installResourceHooks({ win, doc, now, record, intrinsics })` → `{ adjust(networkItems), documentStatus(), restore() }`.
- `PerformanceObserver({ type: 'resource', buffered: true })`. Rodzaj ≠ `null` → `record('network', resourceRecord(…))`. Wpisy `fetch`/`xmlhttprequest`
  trafiają do pierścienia (500) dla `correlateSizes`.
- Listener `error` w fazie capture na `window` z celem `img`/`script`/`link[rel=stylesheet]`/`source`/`video`/`audio` → pierścień błędów ładowania (200) z URL-em
  (`currentSrc`/`src`/`href`) i rodzajem.
- `adjust(items)` (na kopiach): `takeRecords()`, `correlateSizes`, `mergeLoadErrors`. `documentStatus()` z navigation.
- `docOrigin` z `win.location.origin` przechwyconego przy instalacji. `supportsStatus` = `'responseStatus' in PerformanceResourceTiming.prototype`.
Testy do napisania najpierw:
- `img 404 and script 404 same-origin produce records with status 404 and kind` (AC-4.1), `css 200 → type css`,
- `cross-origin resource → status null + cross-origin` (AC-4.3), `fetch RT entry not recorded but fills sizeBytes via adjust` (AC-4.4),
- `element error without RT entry → network-error record`, `documentStatus 500` (AC-4.2),
- `runtime error listener (hooks-errors) does not see resource errors` (regresja), `restore disconnects observer and removes listener`.
Definicja ukończenia: testy zielone.

### E2-T4b Treść odpowiedzi błędów w hookach (E2-T4)  [niezależne: nie]  [zależy od: T4a]
Pliki: `src/page/hooks-network.js`, `tests/unit/hooks-network.test.js`.
Co zrobić:
- `NETWORK_LIMITS` + `responseBodyChars: 4096`, `responseReadChars: 8192`, `bodyTimeoutMs: 2000`. `isTextual(contentType)` według D3.
- fetch: w `finish()` dla kwalifikującej się odpowiedzi → asynchronicznie `clone()` → czytnik → `maskSecrets` → `cutPreview` → `ctx.attach(entry,
  { responseBodyPreview, responseBodyTruncated }, chars)`. Brak końca w 2 s → `cancel()`, bez pola. Każdy wyjątek połknięty. Nie dotyka oryginału.
- XHR: przy `loadend`, status ≥ 400, `responseType` `''`/`'text'` (`responseText`) lub `'json'` (przechwycony `JSON.stringify(xhr.response)`), tekstowy
  `content-type` → to samo przez `ctx.attach`. `blob`/`arraybuffer`/`document` nietknięte.
- `sizeBytes: null` w nowych wpisach fetch/XHR (uzupełnia T3b `adjust`).
Testy do napisania najpierw:
- `fetch 500 application/json → preview ≤ 4096 with truncated flag; 200 JSON → no field; 500 image/png → no field; opaque → no field` (AC-4.5),
- `after fetch 500 page can await r.json(); bodyUsed false before page read` (AC-4.6),
- `endless 500 stream → reader cancelled after 2 s, no field, page branch still readable` (AC-4.5),
- `XHR 401 text → preview; XHR responseType blob/arraybuffer untouched (response identical)` (AC-4.6),
- `token in body masked before cut; no partial token at cut` (AC-4.7),
- `fetch hook synchronous path unchanged (same promise result, same exceptions)` (regresja AC-5.2 E1).
Definicja ukończenia: testy zielone; dotychczasowe testy hooków bez zmian asercji.

### E2-T8 Iframe'y same-origin: błędy i `console.error` (E2-D6)  [niezależne: nie]  [zależy od: T7a (sygnatury hooków)]
Pliki: `src/page/hooks-frames.js`, `tests/unit/hooks-frames.test.js`.
Co zrobić:
- `installFrameHooks({ win, doc, now, record, json, intrinsics, depth = 0 })` → `restore()` według D6: istniejące `iframe` + `MutationObserver`,
  listener `load` na elemencie, kontrola same-origin w `try`, instalacja `installConsoleHook({ levels: ['error'] })` i `installErrorHooks`
  z `record` dopisującym `frame` (URL ≤ 4000). Rekursja do głębokości 2, limit 20 ramek.
- Ramka cross-origin → nic. Ponowne `load` → stare przywrócenie (best effort) i nowa instalacja.
Testy do napisania najpierw (jsdom, iframe same-origin):
- `console.error in same-origin iframe recorded with frame url; console.log not recorded`,
- `error event in iframe recorded with frame`, `cross-origin-like frame (access throws) ignored without exception`,
- `frame reload reinstalls hooks once (no duplicates)`, `restore removes hooks from all frames`, `more than 20 frames: extra ignored`.
Definicja ukończenia: testy zielone.

### E2-T10a Paczka v3 (`assemblePackage`)  [niezależne: nie]  [zależy od: T4a]
Pliki: `src/lib/package.js`, `src/lib/session-store.js`, `tests/unit/package.test.js`, `tests/unit/background-lib.test.js`.
Co zrobić:
- `SCHEMA_VERSION = 3`. `RECORD_KEYS` + `steps`. `DEFAULT_LIMITS` według schematu. `session-store.js` `DOC_LISTS` + `steps` (budżet D4 tnie też kroki).
- `normalizeDoc` czyta `steps`, `vitals`, `documentStatus`, `truncated.responseBodies`. `documents[]` + `status`/`statusUnavailable`. `counts`/`kept` + `steps`.
- `vitals[]` z dokumentów z danymi (`doc` = indeks). `screenshots[]` + `attachments` z `meta.screenshots` (`t` = `epochMs - current.timeOrigin`, `doc` = indeks bieżącego).
  `meta.screenshotNote` trafia do `notes`.
- Budżet podglądów treści w paczce (najnowsze, `truncated.responseBodies`, notatka) + drugi przebieg `maskSecrets` na `responseBodyPreview`.
- `overview` liczony z rekordów w paczce. Notatki: wartości nie-finalne, statusy niedostępne w przeglądarce, brak zrzutu z powodem.
- Budowa obiektu w kolejności kluczy z sekcji „Schema paczki”.
Testy do napisania najpierw:
- `Object.keys order equals AC-7.2 (+attachments last)` (AC-7.2), `all required keys present for empty input (null/[] + notes)` (AC-7.1),
- `3000 steps across 2 documents → newest 2000, truncated.steps, kept per document` (AC-3.6), `steps of prior documents included with doc index` (AC-3.6),
- `documents[].status from documentStatus; missing → null + statusUnavailable` (AC-4.2), `vitals per document with doc index for both documents` (AC-5.7),
- `screenshot metadata in screenshots[], data only in attachments` (AC-6.1/PB-2), `no screenshot → [] and note with reason` (AC-6.3/6.4),
- `response previews over 262144 total: newest kept, truncated.responseBodies, note`, `unmasked token in preview is masked by second pass` (AC-4.7),
- `overview counts errors, failed requests (≥400 or error), steps, poor vitals, screenshot` (AC-7.3 pomocniczo),
- `store trims steps of a flushed document over budget` (background-lib).
Definicja ukończenia: testy zielone; v2 fixture test zastąpiony testem v3 w T10b (do tego czasu `fixture v2.json` test oznaczony jako migracyjny).

### E2-T9a Recorder: integracja nowych hooków, termin przy zdarzeniu, budżet treści  [niezależne: nie]  [zależy od: T5b, T1b, T3b, T4b, T8, T7a]
Pliki: `src/page/recorder.js`, `src/page/constants.js`, `tests/unit/recorder.test.js`.
Co zrobić:
- `constants.js`: `PROTOCOL = 2`. `LIMITS` + `steps: 2000`, `responseBodyChars`, `responseBodyTotalChars`, `longTasks`, `stackChars`.
- `RECORDER_SECTIONS` + `steps`. Instalacja: `createSelectorOf` z przechwyconymi intrinsics, potem `installStepsHook`, `installResourceHooks`,
  `installFrameHooks`, `installVitals` (`accept` = `!pastDeadline(t)`, `interactionsSince` z opcji). Restores w jednej liście.
- `record()`: `pastDeadline` → `stop('time-limit')` natychmiast (IN3), wpis odrzucony. Listener `visibilitychange` (intrinsic) robi tę samą kontrolę.
- `attach(entry, fields, chars)`: budżet `responseBodyTotalChars` na dokument; ponad budżet pole pominięte i `truncated.responseBodies = true`.
  Chars doliczone do bufora (`documentChars`).
- `snapshot({ final = false })`: `exportBuffers` z `network` po `resources.adjust`, `steps`, `vitals: vitals.snapshot({ final })`, `documentStatus`,
  `truncated.responseBodies`. `stop()`/`destroy()` zdejmują wszystko (obserwatory, History, ramki).
Testy do napisania najpierw:
- `install adds steps/resources/vitals/frames; destroy restores History methods, disconnects observers, removes listeners` (regresja AC-5.3 E1),
- `3000 clicks keep newest 2000 and truncated.steps` (AC-3.6), `Date.now() 11 min past deadline, timer not fired: next console.log stops recording
  with time-limit and calls onStopped; entry dropped` (AC-2.2), `visibilitychange after deadline stops`,
- `attach over 256 KB budget drops field and sets truncated.responseBodies`, `snapshot contains steps, vitals, documentStatus; protocol 2`,
- `stop(time-limit) freezes vitals and steps (no entries after)`.
Definicja ukończenia: testy zielone; `entries.test.js` może być czerwony do T9b (odnotować).

### E2-T10b Walidator schematu, fixture v3, dokumentacja schematu  [niezależne: nie]  [zależy od: T10a]
Pliki: `tests/helpers/snapshot-validator.js`, `tests/unit/snapshot-validator.test.js`, `tests/fixtures/snapshots/v3.json`, `docs/snapshot-schema.md`.
Co zrobić:
- `validateSnapshot(pkg) → { ok, errors[] }` (bez zależności): klucze wymagane i ich kolejność, typy, enumy (`type`, `reason`, `rating`, `statusUnavailable`),
  `status: null` ⇒ `statusUnavailable`, brak `0` bez wyjaśnienia, `doc` w zakresie `documents`, `screenshots[].attachment` istnieje w `attachments`,
  `steps` bez kluczy `value`, metryki `available: false` ⇒ `reason`.
- `v3.json`: dane syntetyczne (2 dokumenty, kroki, zasoby, metryki dostępne i niedostępne, zrzut 1×1 px).
- `docs/snapshot-schema.md`: sekcja „Wersja 3” (tabela pól, wymagane/opcjonalne, limity, kolejność, ograniczenia: iframe, zasoby w trakcie ładowania), tabela migracji v2→v3.
Testy do napisania najpierw:
- `validator rejects package missing any required key` (po kolei dla każdego) (AC-7.1), `validator rejects wrong key order` (AC-7.2),
- `validator rejects status 0 without statusUnavailable` (AC-4.3), `v3.json passes validator` (AC-7.4), `assemblePackage output passes validator` (AC-7.1),
- `v3.json contains only synthetic domains` (jak v2).
Definicja ukończenia: testy zielone; dokument ma sekcję v3 i migrację.

### E2-T6b Zapis: zrzut w `collect` (E2-T6)  [niezależne: nie]  [zależy od: T6a, T10a]
Pliki: `src/lib/save.js`, `src/background.js`, `tests/unit/save.test.js`, `tests/unit/helpers/fake-chrome.js`.
Co zrobić:
- `RESULT_PROTOCOL = 2` (zgodny z `PROTOCOL` z T9a).
- W `collect` według D5: `tab.active && isSameOrigin` → `captureScreenshot` → ponowne `tabs.get` → `meta.screenshots`. W przeciwnym razie albo przy
  błędzie `meta.screenshotNote` (EN: `No screenshot: the tab showed a page outside the recorded site.` / `…: the tab was not visible.` / `…: capture failed (<reason>).` /
  `…: the image could not be made smaller than 300 KB.`). Czas zrzutu wlicza się do 15 s (`COLLECT_TIMEOUT_MS`).
- `background.js`: `createHandlers` wstrzykuje `codec: createCanvasCodec(globalThis)` do `createSaveHandlers`.
- `fake-chrome.js`: `tabs.captureVisibleTab` (sukces/rzut/zawieszenie), `tab.active`, `windowId`.
Testy do napisania najpierw:
- `save on recorded origin includes one screenshot with reason save, jpeg, dims, bytes` (AC-6.1), `tab on other origin → no capture call, note` (AC-6.3),
- `origin changed during capture → screenshot discarded, note` (AC-6.3), `captureVisibleTab throws → package saved, screenshots [], note; result ok` (AC-6.4),
- `inactive tab → no screenshot, note`, `capture happens before page collect` (stan z chwili kliknięcia).
Definicja ukończenia: testy zielone; `popup-background-integration.test.js` zielony.

### E2-T9b Kanał, most i punkt wejścia MAIN: `stop`, `final`; regeneracja bundli  [niezależne: nie]  [zależy od: T9a, T11, T6b, IN4]
Pliki: `src/page/main-entry.js`, `src/page/isolated-entry.js`, `src/page/channel.js`, `tests/unit/entries.test.js`, `tests/unit/channel.test.js` (+ wygenerowane `src/content/*.js`, `src/standalone/console-snapshot.js`).
Co zrobić:
- `channel.js`: `I2M_TYPES` + `stop`.
- `isolated-entry.js`: wiadomość tła `{ type: 'stop', reason }` (tylko od tła, jak `destroy`) → `channel.send('stop', { reason })`.
- `main-entry.js`: `stop` → `rec.stop(reason === 'time-limit' ? 'time-limit' : 'user')`. `flush` → `rec.snapshot({ final: true })`.
  `collect` → `snapshot({ final: doc.visibilityState === 'hidden' })`.
- `npm run gen`, commit bundli. `npm run gen -- --check` zielony.
Testy do napisania najpierw:
- `background stop message reaches MAIN and stops hooks (console native again), buffers kept` (AC-2.2),
- `stop from page-forged event is ignored` (nonce; regresja AC-5.6 E1), `flush payload marks vitals finalized, collect while visible does not` (AC-5.6),
- `collect result has protocol 2, steps, vitals, documentStatus` , `isolated ignores stop from a tab sender`.
Definicja ukończenia: testy zielone; `gen --check` 0; `npm run build` OK; `dist/*` < 500 KB (wypisać rozmiar).

### E2-T7b Fallback konsolowy na v3  [niezależne: nie]  [zależy od: T9b, T10a]
Pliki: `src/page/console-entry.js`, `tests/unit/console-entry.test.js` (+ wygenerowany `src/standalone/console-snapshot.js`).
Co zrobić: `createRecorder({ win, options: { interactionsSince: performance.now() } })`. `assemblePackage` z `meta.screenshots: []` i notatkami
„Screenshots are not available without the extension.” oraz „INP covers only interactions after the script was pasted.”. `npm run gen`.
Testy do napisania najpierw:
- `console package has every required v3 key and passes validator` (AC-7.5, AC-7.1), `screenshots [] and attachments {} with note` (AC-7.5),
- `vitals present from buffered entries; INP only after paste with note` (AC-5.8), `steps recorded after paste`.
Definicja ukończenia: testy zielone; `gen --check` 0.

### E2-TEST2 E2E: metryki CWV z atrybucją i long tasks  [niezależne: nie]  [zależy od: T9b, T13, T10b]
Pliki: `tests/e2e/vitals.spec.js`, `tests/fixtures/pages/slow-lcp.html`, `tests/fixtures/pages/cls.html`, `tests/fixtures/pages/inp.html`, `tests/fixtures/pages/heavy.js` (+ `longtask.html`).
Co zrobić: fixture'y według AC-5.1–5.3 (hero przez `/img/hero.png?delay=1500`, baner po 500 ms, handler 300 ms, `heavyWork()` 200 ms w `heavy.js`).
Każdy test: `startRecording` → akcja → `saveRecording` → asercje + `validateSnapshot`.
Testy do napisania najpierw:
- `slow-lcp: TTFB/FCP/LCP/CLS with value and rating; LCP ≥ 1500, selector #hero, url of image` (AC-5.1, 5.2),
- `cls: CLS > 0.1 with ≥ 1 source selector and value` (AC-5.1, 5.2), `inp: INP ≥ 300 with target, click, phases` (AC-5.2),
- `longtask: entry with heavy.js url, duration ≥ 200, ≤ 20 items` (AC-5.3),
- `reload during recording: vitals for both documents with own t` (AC-5.7),
- `vitals match web-vitals oracle within 10% (LCP, CLS, INP)` (D7; `skip` z komentarzem, jeśli D7 odrzucone).
Definicja ukończenia: zielone 10/10 (`--repeat-each=10`) bez `retries`.

### E2-TEST3 E2E: statusy, rozmiary, treść odpowiedzi  [niezależne: nie]  [zależy od: T9b, T6b, T13, T10b]
Pliki: `tests/e2e/network.spec.js`, `tests/fixtures/pages/network.html`, `tests/fixtures/pages/responses.html`.
Co zrobić: `network.html`: `<img>` 404, `<script>` 404, CSS 200, font 200, `fetch` 500 (JSON), XHR 401 (token), `<img>` z `localhost` (drugi origin), 3× `fetch('/seq/x')`.
`responses.html`: 500 JSON vs 200 JSON vs 500 PNG, strumień bez końca, odczyt `r.json()` po 500 i `bodyUsed`, XHR `blob`/`arraybuffer` (wyniki w `window.__results`).
Testy do napisania najpierw:
- `every network entry has status, type and sizeBytes (number|null) for img 404, script 404, css, fetch 500, xhr 401` (AC-4.1),
- `subpage returning 404 during recording → documents[] entry status 404` (AC-4.2), `cross-origin img → status or null + statusUnavailable; never bare 0` (AC-4.3),
- `3 identical fetches → exactly 3 fetch entries with 200/500/404 and no duplicates` (AC-4.4),
- `preview only for 500 JSON; none for 200 JSON, 500 PNG, endless stream` (AC-4.5), `page reads r.json() after 500; bodyUsed false; blob/arraybuffer XHR intact` (AC-4.6),
- `token values from 401 body absent from package (grep 0), [redacted:…] present` (AC-4.7),
- `request headers seen by server identical with and without recording` (AC-4.9).
Definicja ukończenia: zielone 10/10.

### E2-TEST4 E2E: kroki użytkownika  [niezależne: nie]  [zależy od: T9b, T13, T10b]
Pliki: `tests/e2e/steps.spec.js`, `tests/fixtures/pages/steps.html`, `tests/fixtures/pages/steps-2.html`.
Co zrobić: `steps.html` z przyciskiem, `input[type=email]`, polem hasła, `contenteditable`, checkboxem, formularzem (`submit` z `preventDefault`,
bez wysyłki wartości siecią i bez `console.*` z wartościami), `pushState`, linkiem do `steps-2.html`. Klawiatura i myszka przez Playwright (zaufane zdarzenia).
Testy do napisania najpierw:
- `steps in order: click, input, change, submit, navigate(pushState), navigate(full page), each with t, doc, type, selector (except navigate)` (AC-3.1),
- `18 typed chars → one input step valueLength 18` (AC-3.3),
- `jan@example.com, Sekret123!, contenteditable text: 0 grep hits outside dom` (AC-3.4),
- `steps of first document present after navigation (doc 0 and doc 1)` (AC-3.6),
- `page sees same defaultPrevented/propagation with and without recording; 1000 clicks p95 overhead ≤ 0.5 ms` (AC-3.7).
Definicja ukończenia: zielone 10/10.

### E2-TEST5 E2E: zrzut, popup, schemat, żywe otherOrigin  [niezależne: nie]  [zależy od: T9b, T6b, T12, T11, T10b]
Pliki: `tests/e2e/screenshot.spec.js`, `tests/e2e/popup-live.spec.js`, `tests/e2e/helpers/image.js` (dekodowanie data URL w karcie przez `<img>` + canvas), `tests/fixtures/pages/screenshot.html` (jednolite tło).
Testy do napisania najpierw:
- `save → one screenshot, reason save, jpeg; decoded dims = innerWidth×innerHeight×dpr ±1` (AC-6.1, 6.6 Chromium),
- `4 corners have fixture background color (no popup in image)` (AC-6.2),
- `tab on localhost at save → no screenshot, note` (AC-6.3),
- `popup ready shows the three new disclosure items (visible text)` (AC-1.1), `Nagrywaj fully visible without scrolling at 360×600` (AC-1.3),
- `save to Zapisano on basic.html ≤ 5 s (median of 5) with screenshot` (AC-1.5),
- `real package passes validator; Object.keys order` (AC-7.1, 7.2),
- `popup open during navigation 127.0.0.1 → localhost shows otherOrigin within 1 s; disappears on return` (AC-2.1, `popup-live.spec.js`).
Definicja ukończenia: zielone 10/10.

### E2-TEST6 E2E: wydajność i rozmiar (NFR)  [niezależne: nie]  [zależy od: T9b, T13]
Pliki: `tests/e2e/perf.spec.js`, `tests/fixtures/pages/flood-e2.html`.
Testy do napisania najpierw:
- `fetch hook overhead with 200 × 500-JSON responses p95 ≤ 2 ms` (NFR wydajność),
- `slow-lcp LCP with vs without recording differs ≤ 50 ms (median of 5)` (NFR),
- `basic.html + screenshot package ≤ 1 MB` (NFR rozmiar),
- `flood + 2000 steps + 100 error responses ≤ 12 MB and save ≤ 5 s; truncated.responseBodies true` (NFR),
- `dist/chrome and dist/firefox < 500 KB` (NFR, `fs.stat`).
Definicja ukończenia: zielone 10/10 na przebiegu na wyłączność (`PDS_E2E_NO_BUILD=1` po jednym buildzie); wyniki do `test-coverage.md`.

## Kolejność i równoległość

| Grupa | Zadania (równolegle w grupie) | Warunek startu |
|---|---|---|
| **A** | T0 (spike), T7a, T5a, T1a, T3a, T4a, T6a, T12, T11, IN2, IN4, IN5, T13 | — (rozłączne pliki; T7a jedyny dotyka `constants.js`) |
| **B** | T5b (T5a), T1b (T1a, T5a), T3b (T3a), T4b (T4a), T8 (T7a), T10a (T4a) | zależności z A; rozłączne pliki |
| **C** | T9a (T5b, T1b, T3b, T4b, T8, T7a), T10b (T10a), T6b (T6a, T10a; po T0/S1) | B |
| **D** | T9b (T9a, T11, T6b, IN4) → potem T7b (T9b, T10a) | sekwencyjnie (oba regenerują bundle) |
| **E** | TEST2, TEST3, TEST4, TEST5, TEST6 | D; jeden `npm run build`, potem przebiegi z `PDS_E2E_NO_BUILD=1`, najwyżej dwa naraz |

Checkpoint commit po każdej grupie. T0 musi skończyć się przed T6b (S1) i przed bramką PB-1 (S4). Wynik S4 trafia do orkiestratora
od razu, równolegle z dalszą pracą grupy A.

## Plan testów

| AC | Unit | E2E (Chromium) | Firefox |
|---|---|---|---|
| 1.1 | T12 `disclosure lists…`, `static equals MESSAGES` | TEST5 `popup ready shows…` | QA FQ-10 |
| 1.2 | T12 `no forbidden words…` | — | n.d. |
| 1.3 | — | TEST5 `Nagrywaj fully visible…` | QA FQ-10 |
| 1.4 | T12 `button set equals E1 set` | — | n.d. |
| 1.5 | — | TEST5 `save ≤ 5 s` | — |
| 1.6 | T11 `onInstalled after update clears…` | — | QA FQ-7 (+ Chrome ręcznie) |
| 2.1 | T11 `popup refreshes on tabs.onUpdated…` | TEST5 `popup-live` | QA FQ-11 |
| 2.2 | T9a `11 min past deadline…`, T11 `getStatus → stopped`, T9b `stop reaches MAIN` | — | QA FQ-8 (+ Chrome z uśpieniem) |
| 3.1 | T5b `pushState…`, `click…` | TEST4 `steps in order…` | QA FQ-1 |
| 3.2 | T5a `unique for 20 fixture elements` | — | n.d. |
| 3.3 | T5b `18 chars → one input` | TEST4 | — |
| 3.4 | T5b `password…`, `contenteditable…`, `key…` | TEST4 `0 grep hits` | QA FQ-1 |
| 3.5 | T5b `click on button… text ≤ 80` | — | — |
| 3.6 | T10a `3000 steps…`, T9a `3000 clicks…` | TEST4 `steps of first document…` | — |
| 3.7 | T5b `page handler… unaffected` | TEST4 `p95 ≤ 0.5 ms` | — |
| 4.1 | T3a `kind mapping`, T3b `img 404…` | TEST3 | QA FQ-2 |
| 4.2 | T3a `documentStatus`, T10a `documents[].status` | TEST3 `subpage 404` | QA FQ-2 (PB-1) |
| 4.3 | T3a `cross-origin… never bare 0`, T10b validator | TEST3 | QA FQ-3 |
| 4.4 | T3a E2-TEST1 `3 identical fetch…` | TEST3 | — |
| 4.5 | T4b `fetch 500 JSON…`, `endless stream` | TEST3 | QA FQ-9 |
| 4.6 | T4b `bodyUsed`, `blob/arraybuffer untouched` | TEST3 | — |
| 4.7 | T4a corpus + JSON, T4b `masked before cut`, T10a `second pass` | TEST3 `grep 0` | QA FQ-9 |
| 4.8 | T7a `stack equals…`, `cause chain` | — | — |
| 4.9 | T6a `no fetch(` | TEST3 `request headers identical` | — |
| 5.1 | T1a `rating boundaries`, T1b `present with value and rating` | TEST2 | QA FQ-4 (TTFB/FCP/LCP) |
| 5.2 | T1b atrybucja ×3 | TEST2 | n.d. (brak CLS/INP) |
| 5.3 | T1a `top 20…` | TEST2 `longtask` | n.d. |
| 5.4 | T1b `unsupported-browser…` (Firefox, Chrome 121–122) | — | QA FQ-4 |
| 5.5 | T1b `no interaction → no-interaction` | — | — |
| 5.6 | T1b `finalized`, `hidden-at-start`; T9b `flush finalized` | — | — |
| 5.7 | T10a `vitals per document` | TEST2 `reload…` | — |
| 5.8 | T1b `interactionsSince`, T7b | — | QA FQ-12 |
| 6.1 | T6a `under limit unchanged`, T6b `includes one screenshot` | TEST5 dims | QA FQ-5 (wymiary w raporcie) |
| 6.2 | — | TEST5 `4 corners` | QA FQ-5 |
| 6.3 | T6b `other origin`, `origin changed during capture` | TEST5 `localhost at save` | QA FQ-6 + wizualnie pola `password` |
| 6.4 | T6a `throws/timeout`, T6b `throws → saved` | — | — |
| 6.5 | T6a `4K → ≤ 307200` | — | — |
| 6.6 | — | TEST5 (Chromium) | QA FQ-5 |
| 7.1 | T10a `required keys`, T10b validator, T7b | TEST5 `real package passes validator` | QA FQ-12 |
| 7.2 | T10a `Object.keys order`, T10b | TEST5 | — |
| 7.3 | T10a `overview` (pomocniczo) | — | QA ręczne „60 s” (Chrome; E2-Q1) |
| 7.4 | T10b `v3.json passes validator` + docs | — | — |
| 7.5 | T7b | — | QA FQ-12 |
| NFR | T6a/T4b | TEST6 | `web-ext lint` 0 errors |

Scenariusze QA ręcznego Firefox (`npm run dev:firefox` + `npm run fixtures`; wyniki osobno w `qa-report.md`):
- **FQ-1** (AC-3.1, 3.4) `steps.html`: kroki w kolejności, bez wartości (grep `jan@example.com`, `Sekret123!`).
- **FQ-2** (AC-4.1, 4.2) `network.html` + podstrona 404: `status`, `type`, `sizeBytes`; przy PB-1 (A) `statusUnavailable: "unsupported-browser"` + notatka.
- **FQ-3** (AC-4.3) zasób z `localhost`: `null` + powód, nigdy `0`.
- **FQ-4** (AC-5.1, 5.4) `slow-lcp.html`, `cls.html`: TTFB/FCP/LCP z wartościami; CLS/INP/long tasks `available: false` + `unsupported-browser` (albo dane — PB-3).
- **FQ-5** (AC-6.1, 6.2, 6.6) `screenshot.html`: zrzut JPEG, wymiary vs `innerWidth×innerHeight×dpr` w raporcie, brak popupu na obrazie.
- **FQ-6** (AC-6.3) nawigacja na `localhost` przed *Zapisz*: brak zrzutu + notatka; pole `password` zamaskowane na zrzucie (wizualnie).
- **FQ-7** (AC-1.6) instalacja 0.3.0 (podpis/tymczasowa) → nagrywanie → aktualizacja do 0.4.0 → popup pokazuje nową listę, stare nagranie nie zbiera kroków.
- **FQ-8** (AC-2.2) limit testowy 60 s, uśpienie/wstrzymanie > 60 s, pierwsze zdarzenie → `stoppedByLimit`, `recordingStoppedReason: "time-limit"`.
- **FQ-9** (AC-4.5, 4.7) `responses.html`: podgląd tylko dla 500 JSON, tokeny zamaskowane.
- **FQ-10** (AC-1.1, 1.3) popup: nowe pozycje widoczne, *Nagrywaj* bez przewijania.
- **FQ-11** (AC-2.1) popup otwarty w trakcie przejścia na `localhost` → `otherOrigin` ≤ 1 s, znika po powrocie.
- **FQ-12** (AC-5.8, 7.5) `console-snapshot.js` wklejony w Firefoksie: klucze wymagane, `screenshots: []` z notatką.

## Odrzucone zadania z backlogu
- [-] **E2-T2** webRequest w SW (mapa `requestId`, filtr `tabId`) — D2: bez szerszych host permissions widzi tylko to, co Resource Timing
  (same-origin). Potrzeba niewykazana w Chrome. Wraca wyłącznie jako zadanie Firefoksa przy PB-1 (B).
- [~] **E2-T3** „korelacja webRequest ↔ hooki” → zastąpione korelacją Resource Timing ↔ hooki (T3a/T3b) dla `sizeBytes`. Status zawsze z hooka.
- [~] **E2-D4/E2-T5** „listener w ISOLATED” → MAIN (D4, odstępstwo do bramki).
- [~] **E2-D5** „opcjonalnie przy każdym błędzie (throttle)” → odrzucone decyzją 1 bramki (tylko przy *Zapisz*).
- [~] **E2-D3** „konfigurowalne (2xx)” → poza E2 (E4-D4), decyzja 3.
- [~] **E2-TEST1** zrealizowane jako testy najpierw w T3a (unit korelacji), bez osobnego zadania.

## Ryzyka techniczne i jak je wykryjemy wcześnie
1. **`captureVisibleTab` bez `activeTab` lub w headless/Firefoksie** (D5). Wykrycie: spike S1/S2/S4 przed T6b. Plan B (Chrome): zrzut w popupie
   (ten sam `activeTab`). Gdy Firefox odmawia, AC-6.6 idzie do bramki (bez `<all_urls>`).
2. **Firefox bez `responseStatus`** (PB-1). Wykrycie: S4 w pierwszym dniu. Wynik od razu do bramki.
3. **Własne algorytmy CLS/INP rozjeżdżają się z definicją** (D1). Wykrycie: wektory T1a + wyrocznia `web-vitals` w TEST2 (±10%). Sygnał: > 10% różnicy.
4. **Koszt selektora na dużych DOM** (AC-3.7). Wykrycie: TEST4 p95 i ręcznie na realnym portalu (E2-Q1, > 5000 elementów). Mitygacja: próg data-*, limit długości.
5. **Odczyt treści psuje stronę** (ryzyko 3 spec). Wykrycie: S6, T4b `endless stream`, TEST3 `bodyUsed`/`blob`, TEST6 flood. Mitygacja: tylko ≥ 400 + tekst, limit 8192/2 s, `cancel()`.
6. **Rozmiar wiadomości i pamięć** (zrzut 300 KB + flood ≤ 12 MB przez `runtime.sendMessage`). Wykrycie: TEST6. Limit Chrome 64 MB, więc jest zapas.
7. **`History.prototype` Proxy koliduje z routerami SPA** (React Router, Next). Wykrycie: `spa.html` (E1) w regresji navigation.spec + E2-Q1 na realnej SPA.
   Mitygacja: wywołanie oryginału dokładnie raz, restore guard.
8. **Konflikty bundli przy pracy równoległej**. Wykrycie: `gen --check` w CI. Mitygacja: regeneracja tylko w grupie D (sekwencyjnie).
9. **Nowy kanał wycieku** (etykiety, treść 4xx, zrzut — ryzyko 4 spec). Wykrycie: T4a korpus, TEST3/TEST4 grep, R1 reviewer. Zrzut pokazuje wartości pól
   widoczne na ekranie, co pokrywa ujawnienie. E3 zajmie się etykietami z danymi osobowymi.
10. **Walker/generator odrzucają nowy kod** (`url(` w komentarzu, wieloliniowe importy). Wykrycie: `npm run build` i `gen --check` w DoD każdego zadania z grupy D.
    Uwaga w konwencjach zadań.
11. **Wynik `collect` > 15 s z zrzutem na wolnej maszynie**. Wykrycie: TEST5 mediana i timeout 3 s na zrzut.
