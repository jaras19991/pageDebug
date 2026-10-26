# E3 — Design

## Decyzje bramki Design (użytkownik, 2026-10-26) — wiążące, mają pierwszeństwo przed tekstem poniżej
- **PB-1 = (B)**: iframe'y cross-origin **nie** są zakrywane na zrzucie. Maskujemy tylko pola z pytania 2 (w tym same-origin iframe'y).
  `collectFieldRects` dla ramki cross-origin (dostęp rzuca) **pomija ją** i liczy w `frames.crossOrigin` (bez prostokąta). Brak notatki
  „N embedded frames … hidden”. Ryzyko (numer karty w iframe płatności widoczny na zrzucie) trafia do ryzyk E3 i do sekcji
  „Co jest w paczce, a czego nie ma” (E3-DOC1).
- **PB-2 = tak**: reguła `email` wszędzie, gdzie przechodzi przebieg tekstowy.
- **Odstępstwa** (kanał E1 D3, `redaction.masked` per sekcja najwyższego poziomu, pseudo-reguła `html-structure`) — zaakceptowane.
- **Wynik spike'a S0 (2026-10-26, decyzja orkiestratora)** — D6 bez zmian architektury; doprecyzowania: (1) przesunięcie pól w same-origin
  iframe = rect ramki + `clientLeft/Top` + `padding-left/top` (content box); (2) Firefox: `openOrClosedShadowRoot` to getter —
  wykrywanie `'openOrClosedShadowRoot' in Element.prototype`, odczyt jako właściwość (nie `typeof Element.prototype…`, rzuca);
  (3) `collectFieldRects` zwraca `vvScale`; `planMask` przy `vvScale ≠ 1` (pinch-zoom) → brak zrzutu z notatką (fail-closed).
  Szczegóły: `docs/epics/E3/spike-S0.md`.
- **Bramka Review (2026-10-26)**: przy widocznych ramkach cross-origin przełącznik zrzutu startuje wyłączony (notatka w popupie).
  `collectFieldRects` → `frames = { sameOrigin, crossOrigin, crossOriginVisible }`; „widoczna” = przecina viewport, ≥ 40×20 px CSS,
  bez display:none/visibility:hidden/opacity 0; wyjątek → liczona jako widoczna. Popup ↔ tło: `frameCheck { tabId }` →
  `{ ok: true, crossOriginFrames }` (liczba widocznych) | `{ ok: false }`.
- `tests/unit/layout.test.js` — zdublowany import usunięty przez orkiestratora przed implementacją.

## Pytania do bramki

**PB-1 (luka w AC-2.2 / pytaniu 2): iframe'y z innego originu na zrzucie.** Pytanie 2 obejmuje pola w iframe'ach same-origin.
Formularze płatności (Stripe, Przelewy24, PayU) i logowania (SSO) są jednak prawie zawsze w iframe'ach **cross-origin**. Most w ISOLATED
nie ma dostępu do ich DOM, więc nie zna prostokątów pól. Bez decyzji numer karty wpisany w taki iframe trafi na obraz.
- **(A) — rekomendacja:** zamaskować na zrzucie **cały prostokąt** każdego widocznego iframe'u cross-origin (≥ 16×16 px CSS) i dopisać
  notatkę „N embedded frames from other sites were hidden on the screenshot.”. Stracimy obraz osadzonych map i wideo, ale zgodnie
  ze skillem lepiej zamaskować za dużo.
- **(B):** maskować tylko pola z pytania 2, a iframe'y cross-origin zostawić bez zmian. Ryzyko wpisujemy do ujawnienia i do ryzyk E3.

**PB-2 (odstępstwo od tabeli poziomów w spec US-3): zasięg reguły `email`.** Spec stosuje `email` (poziom *Domyślnie*) do konsoli, błędów,
`requestBody`, podglądów odpowiedzi i storage (pytanie 7). Proponuję stosować ją **wszędzie, gdzie przechodzi przebieg tekstowy**: URL-e
(`?email=jan@…`), tytuł dokumentu, etykiety kroków, atrybuty `data-*` i `notes`. Developer nadal może ją wyłączyć jednym przełącznikiem.
FP w benign są bliskie zeru, bo wzorzec wymaga `@` i domeny. Reguła `phone` zostaje tylko w sekcjach ze spec, bo w URL-ach i selektorach
daje za dużo FP (skill).

**Odstępstwa od wiążących skilli i wytycznych (do akceptacji):**
- Kanał MAIN ↔ ISOLATED **nie** używa `window.postMessage` z nonce, wbrew ogólnej instrukcji dla architekta. Zostaje zamknięta decyzja
  E1 D3 (prywatny odłączony węzeł DOM, `CustomEvent`, nonce w każdej wiadomości) zapisana w skillu `mv3-extension-rules`. Uzasadnienie
  jest w skillu: `postMessage` widzi każdy listener strony. E3 nie dodaje do kanału nowych typów wiadomości.
- Skill `privacy-redaction`: `redaction.masked` ma klucze sekcji najwyższego poziomu (`network`, `storage`…), a nie podsekcji
  (`network.headers`). Tylko tak suma da się jednoznacznie sprawdzić z liczbą znaczników (AC-4.3). Dochodzi `disabledRules` (spec).
- Skill `privacy-redaction` w tabeli poziomów ma pozycję „pełny `outerHTML`”. Realizuje ją pseudo-reguła `html-structure` z poziomu
  *Domyślnie*: jej wyłączenie oznacza `dom.fullHtml`. Developer ma jeden mechanizm (`disabledRules`) zamiast dwóch opcji.

**Zmiany uprawnień: brak** (sekcja „Zmiany w manifeście”). **Nowych zależności runtime: brak** (D7, D4).

**Uwaga do orkiestratora (poza E3, stan drzewa):** niezacommitowana zmiana w `tests/unit/layout.test.js` dodaje drugi, identyczny
`import { bundle } …` (linia 7). To błąd składni („Identifier 'bundle' has already been declared”), więc `npm test` jest czerwony,
zanim zaczniemy. Trzeba to cofnąć przed implementacją.

## Kontekst
Paczka v3 (0.4.0) to jeden JSON z jawnymi ciasteczkami, storage, wartościami pól, nagłówkami i URL-ami, z pełnym `outerHTML`
(≈ 1,2 MB) i zrzutem w base64. Maskowanie obejmuje tylko podglądy odpowiedzi i `steps[].url`. E3 dodaje redakcję całej paczki
w tle według polityki `rulesVersion: 1`, strukturę DOM bez tekstów, skróty ciasteczek i maskowanie pól na zrzucie (z przełącznikiem
„Dołącz zrzut ekranu”). Dochodzą też budżet 2 MB oraz plik `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` z `snapshot.json`, `summary.md`
i `screenshot.jpg`, wszystko w paczce `schemaVersion: 4`, bez nowych uprawnień i zależności.

## Decyzje

Bez zmian zostają decyzje E1: D1 (rejestracja per origin), D2 (tło bez stanu, `storage.session`), D3 (prywatny kanał na odłączonym
węźle), D5 (hooki Proxy, intrinsics), D6 (moduły ES + generator), D7 (Blob i `downloads.download` w popupie, werdykt z tła) i D8 (uprawnienia).
Bez zmian zostają też decyzje E2: D3a (maskowanie u źródła podglądów), D4 (kroki w MAIN), D5 (zrzut w tle przy `collect`). E3 rozszerza
E2 D5 (maskowanie pól i przełącznik), E2 D3a (z `mask-secrets.js` robi pełne `redact-rules.js`) i schemat (→ v4).

### D1 Gdzie działa redakcja: tło (rozstrzyga) + u źródła (obrona w głąb) + ta sama biblioteka w fallbacku
Opcje:
(a) tylko w MAIN, przy zbieraniu;
(b) tylko w tle, na złożonej paczce;
(c) **tło jako przebieg rozstrzygający** na gotowym obiekcie (`assemblePackage` → `redact`) **plus** redakcja u źródła tam, gdzie jest tania
i zapobiega zapisaniu sekretu do `storage.session` lub bufora (wartości pól, kroki, podglądy, wartości wrażliwych nagłówków żądania);
(d) w ISOLATED (DOM i niepodmienione prototypy, ale nie widzi buforów MAIN, a fallback nie ma ISOLATED).
**Wybór: (c).**
Uzasadnienie: skill zabrania redakcji w MAIN jako jedynej, bo strona może podmienić `String.prototype.replace`/`RegExp`/`JSON` (AC-3.6).
Tło działa w osobnym realmie, na którego intrinsics strona nie ma wpływu, a widzi całą paczkę: dokumenty z `pagehide`, wynik `collect`,
zrzut i notatki tła. Każdy sekret, który przejdzie przez MAIN niezamaskowany (nawet z powodu łatki strony), tło zamaskuje przed
serializacją. (a) nie spełnia AC-3.6. (b) trzyma wartości wrażliwych nagłówków żądania w `pds:doc:*` (`storage.session`) przez cały czas
nagrania. NFR wymaga czystości dopiero po zapisie, ale tani pierwszy przebieg po nazwie nagłówka (jedno `Set.has` na nagłówek)
zmniejsza okno ekspozycji, a koszt jest mierzalny (TEST6 E2). (d) nie pokrywa buforów ani fallbacku. Fallback konsolowy (pytanie 5) używa
**tych samych** modułów `src/lib` (bundlowanych przez `../lib/…`), więc polityka jest identyczna (AC-3.7). Jego słabość jest jawna: działa
w realmie strony po jej skryptach, więc nie spełnia AC-3.6 wobec wrogiej strony (to samo ograniczenie co dziś, wpis do schematu).
Konsekwencje: `redact.js` to czysta, synchroniczna funkcja bez DOM i bez `chrome.*` (`src/lib`), idempotentna. Kolejność w tle:
`assemblePackage` → `redact` → budżet → przeliczenie znaczników → `summary.md` → zip (D8). Żaden niezredagowany obiekt nie trafia do
`storage.*`. Wynik `collect` żyje tylko w pamięci instancji tła, a `pds:doc:*` i `pds:rec` znikają przy `finalize` (jak w E1).

### D2 Silnik redakcji: mapa sekcji schematu + przebieg tekstowy „catch-all”, ślad w postaci znaczników
Opcje:
(a) generyczny przebieg po wszystkich liściach (reguła kluczy na każdej nazwie właściwości, wzorce na każdym stringu);
(b) **mapa ścieżek schematu → strategia** (klucz/wartość dla map danych użytkownika, URL, tekst, transformacje specjalne)
**plus przebieg tekstowy na każdym pozostałym liściu-stringu**;
(c) tylko jawna mapa ścieżek (pole spoza mapy przechodzi bez zmian).
**Wybór: (b).**
Uzasadnienie: w (a) reguła kluczy trafia w klucze **naszego** schematu. `steps[].key` („Enter”) pasuje do tokenu `key`, `limits`/`truncated`
też mają podobne nazwy, więc (a) zniszczyłby dane developera (AC-5.4). (c) jest kruche: każde nowe pole danych z E4+ przecieka, dopóki
ktoś nie dopisze go do mapy. W (b) mapa mówi, **gdzie** klucze są danymi użytkownika (storage, nagłówki, obiekty w `args`, atrybuty DOM,
`reason`), a gdzie są schematem. Przebieg tekstowy (wzorce `jwt`, `bearer`, `basic`, `card`, `iban`, `pesel`, `long-secret`, pary `klucz=wartość`
w tekście, `email`) dotyka **każdego** stringa, którego mapa nie obsłużyła, więc nowe pole jest domyślnie chronione (fail-safe).
Nietknięte zostają tylko: `schemaVersion`, `extensionVersion`, `source`, znaczniki czasu ISO, `overview`, `limits`, `truncated`, `redaction`,
`screenshots[]` oraz liczby i wartości logiczne poza mapami danych użytkownika (AC-5.4).
Ślad (AC-4.1): wartość → `"[redacted:<reguła>]"`. Nigdy `null`, `""` ani usunięty klucz. Liczba albo boolean przy kluczu wrażliwym w danych
użytkownika → string znacznika (jedyna zmiana typu, opis w schemacie). Liczby: reguły z tablicy w D3.
Raport: `redact(pkg, options) → { snapshot, applied }`. `applied` = liczba zamian w tym przebiegu: drugi przebieg daje 0 (AC-4.2,
idempotencja), bo wartości będące już znacznikiem są pomijane. Blok `redaction.masked` liczy **znaczniki obecne** w gotowym `snapshot.json`
per sekcja najwyższego poziomu, **po** budżecie (`countMarkers(snapshot)`). Dzięki temu suma `masked` = liczba `[redacted:` w pliku
(AC-4.3), także gdy znacznik powstał już w MAIN (podglądy, `steps[].url`) albo budżet usunął wpis ze znacznikiem.
Poziomy (AC-4.5): `ALWAYS_RULES` (nie do wyłączenia) i `DEFAULT_RULES = ['email', 'phone', 'html-structure']`. `options.disabledRules`
jest filtrowane do `DEFAULT_RULES`, a reszta jest cicho pomijana i nie trafia do `redaction.disabledRules`.
Konsekwencje: dwa pliki — `redact.js` (silnik, rekordy, nagłówek, `notes`) i `redact-page.js` (storage, ciasteczka, DOM, `environment`,
`performance`) — ze wspólnym kontraktem `ctx` (T2a/T2b mogą iść równolegle). Wydajność: szybka ścieżka pomija stringi < 6 znaków
i bez znaków wyzwalających (`@`, `=`, `:`, cyfra, `.`, `<`, ≥ 32 znaki ciągłe). Budżet czasu ≤ 1,5 s na 5 MB JSON razem z kompresją (NFR).

### D3 Reguły `rulesVersion: 1` (E3-T1, E3-IN2, E3-IN3)
Opcje: (a) rozbudować `mask-secrets.js` w miejscu; (b) **nowy moduł `src/lib/redact-rules.js`** z funkcjami tekstowymi i walidatorami, a
`mask-secrets.js` zostaje cienką nakładką (`maskSecrets(text)` = reguły *Zawsze* bez `email`/`phone`) dla MAIN i dotychczasowych testów.
**Wybór: (b).** Nazwa `maskSecrets` jest wpięta w hooki MAIN, w `package.js` i w 157 linii testów E2. Nakładka nie zmienia ich kontraktu,
a nowy moduł ma czyste API dla `redact.js`.
Reguły (ID reguły = `<nazwa>` w znaczniku):
| Reguła | Poziom | Dopasowanie (implementer dopracowuje na korpusie) |
|---|---|---|
| `key-<token>` | Zawsze | nazwa klucza/parametru/nagłówka/atrybutu zawiera token z listy skilla jako wyraz (granice `^`, `$`, `_`, `-`, `.`, spacja, `[`, `]`; camelCase → snake). Nowe: sufiks `sessid`/`sessionid` bez granicy (`JSESSIONID`, `PHPSESSID`, `ASP.NET_SessionId`) → `key-session`. Formy w tekście: JSON `"k": "v"` **i** `"k": 123`/`true` (IN2: → `"k":"[redacted:key-…]"`, JSON zostaje poprawny), `k=v`, `k: v` (IN2: do końca linii, `,` `;` lub `}`), XML `<k>v</k>` (IN2), atrybut `k="v"` (struktura DOM, HTML w podglądach) |
| `jwt`, `bearer` | Zawsze | jak E2 (`mask-secrets.js`) |
| `basic` | Zawsze | `Basic\s+[A-Za-z0-9+/=]{8,}` (IN2) |
| `card` | Zawsze | 13–19 cyfr ze spacjami/myślnikami, **Luhn** i prefiks IIN (`4`, `5[1-5]`, `2[2-7]`, `3[47]`, `6`). Timestampy ms (`1…`) odpadają z konstrukcji |
| `iban` | Zawsze | `[A-Z]{2}\d{2}[A-Z0-9]{11,30}` (także ze spacjami co 4) + **mod-97** |
| `pesel` | Zawsze | `\b\d{11}\b` + suma kontrolna + poprawny miesiąc (kody stulecia) |
| `long-secret` | Zawsze | ≥ 32 znaki `[A-Za-z0-9+/=_-]` bez spacji, entropia Shannona > 4,0 bit/znak, ≥ 1 cyfra i ≥ 1 litera. Hex (UUID, hash commita) ma entropię ≤ 4 → nie łapie. Nie stosowana do `selector` i do segmentów ścieżki URL zakończonych rozszerzeniem pliku (`/static/abc….js`) |
| `url-credentials` | Zawsze | `scheme://user:pass@` → `scheme://[redacted:url-credentials]@` |
| `url-fragment` | Zawsze | w polu-URL: fragment `#…` z parą o kluczu wrażliwym lub ze wzorcem → **cały** fragment `#[redacted:url-fragment]` (OAuth implicit, AC-3.3) |
| `form-value` | Zawsze | obrona w tle: jeśli w `dom.forms[].elements[]` przyjdzie `value`, zamieniamy je na `valueLength`, a w `dom.fullHtml` atrybut `value` pól na znacznik |
| `email` | Domyślnie | `[\w.+-]+@[\w-]+(\.[\w-]+)+`; zasięg wg PB-2 |
| `phone` | Domyślnie | `+48`/`0048` + 9 cyfr albo 9 cyfr w grupach 3-3-3 (spacja/myślnik); goła liczba 9-cyfrowa tylko z prefiksem PL komórkowym `[4-8]`. Tylko `consoleLogs`, `runtimeErrors`, `requestBody`, `responseBodyPreview`, storage |
| `html-structure` | Domyślnie | pseudo-reguła: wyłączona ⇒ `dom.fullHtml` (D5) |
Pole-URL (`maskUrl`, IN3): rozbiór regexem `^([^?#]*)(\?[^#]*)?(#.*)?$` (bez `new URL`, żeby nie normalizować adresu), parametry query
po kluczu, parametry ścieżki `;jsessionid=…`, potem wzorce na całości. Pola-URL według AC-3.3: `network[].url`, `documents[].url`, `vitals[].LCP.url`,
`vitals[].longTasks.items[].scripts[].url`, `performance.navigation.name`, `performance.resources[].name`, `dom.images[].src`, `dom.scripts[].src`,
`dom.stylesheets[].href`, `dom.iframes[].src`, `dom.forms[].action`, `dom.canonical`, `dom.hreflangs[].href`, `*.frame`, `steps[].url`,
`environment.location.href`, `environment.document.referrer`. Pola `search` i `hash` w `environment.location` liczymy z zamaskowanego `href`, więc są spójne.
URL wewnątrz tekstu (`stack`, `message`, `notes`) obsługują pary `k=v` z przebiegu tekstowego.
Regexy są liniowe (bez zagnieżdżonych kwantyfikatorów na nakładających się klasach) i tworzone przy ładowaniu modułu. W MAIN dzieje się to
na `document_start`. Brak cięcia wejścia przed maskowaniem w tle: `MASK_LIMITS.inputChars` dotyczy tylko podglądów w MAIN.
Konsekwencje: korpusy `tests/fixtures/redaction/sensitive.json` (≥ 50) i `benign.json` (≥ 50) są kontraktem reguł. Każdy FP jest opisany
w teście (AC-5.1). Ograniczenie, które idzie do ryzyk: krótkie własne tokeny bez słowa-klucza (np. `x-trace: a1b2c3`) nie są łapane.

### D4 Ciasteczka: parsowanie `document.cookie` w tle + SHA-256 w czystym JS
Opcje dla hasha: (a) `crypto.subtle.digest` (asynchroniczne; w MAIN i fallbacku brak go na stronach `http:` bez secure context);
(b) **własne SHA-256 w `src/lib/sha256.js`** (≈ 70 linii, synchroniczne, wektory NIST); (c) hash w MAIN przed wysłaniem.
**Wybór: (b), liczone w `redact-page.js` (tło i fallback).**
Uzasadnienie: synchroniczna funkcja zostawia `redact` czystym i synchronicznym. Działa identycznie w SW, event page, Node (testy) i na stronie
`http:` w fallbacku. Nie zależy od `crypto.subtle`, które strona w fallbacku mogłaby podmienić. Koszt (ciasteczka ≤ 4 KB każde, typowo
< 50) jest pomijalny. (c) przenosiłoby rozstrzygającą transformację do realmu strony (sprzeczne z D1).
Kształt (AC-4.4): MAIN wysyła jak dziś `cookies: doc.cookie` (string, tylko w pamięci wyniku `collect`, nigdy w `pds:doc:*`). Tło robi
`split('; ')` i pierwsze `=`, a wynik to `[{ name, sizeBytes, valueHash }]`, gdzie `sizeBytes` = bajty UTF-8 pary `name=value` (to, co liczy
się do limitu 4 KB), `valueHash` = 8 pierwszych znaków hex SHA-256 bajtów UTF-8 wartości. Do tego `cookiesTotalBytes` = bajty UTF-8 całego
`document.cookie`. Nazwy zostają (poziom *Zostaje*). Domeny i flag `document.cookie` nie podaje (backlog D4: „jeśli dostępne” → brak).
Konsekwencje: hash jest deterministyczny i bez soli (wymóg AC-4.4: ta sama wartość w dwóch paczkach daje ten sam hash), więc wartość
o niskiej entropii (`consent=1`) da się odgadnąć słownikiem. To akceptowalne, bo sesje mają wysoką entropię. Ryzyko jest w sekcji ryzyk.

### D5 Struktura DOM: serializator w MAIN na przechwyconych intrinsics, whitelist atrybutów, 300 KB
Opcje:
(a) `outerHTML` + usuwanie tekstów regexem w tle (najpierw czyta cały `outerHTML`, łamie E3-T0 „cięty przed odczytem”);
(b) **własny walker w MAIN** (`src/page/dom-structure.js`): `TreeWalker`/`firstElementChild`/`nextElementSibling` i gettery `tagName`,
`attributes` przechwycone na `document_start`, z licznikiem znaków;
(c) walker w ISOLATED (niepodmienione prototypy), ale wynik `collect` powstaje w MAIN, więc trzeba by zmienić protokół wyniku (scalanie
dwóch JSON-ów), a fallback nie ma ISOLATED.
**Wybór: (b).**
Uzasadnienie: (b) nigdy nie materializuje pełnego HTML. Koszt jest liniowy w liczbie elementów i kończy się po `limits.html` znakach.
Ten sam moduł działa w fallbacku. Strona, która podmieni gettery DOM, może co najwyżej zafałszować strukturę. Nie spowoduje przecieku,
bo walker emituje tylko nazwy tagów zgodne z `^[a-z][a-z0-9-]*$` i atrybuty z whitelisty, a ich wartości przechodzą przez redakcję w tle.
Format `dom.structure` (string, HTML bez tekstów): elementy w kolejności dokumentu, bez węzłów tekstowych, komentarzy i treści
`<script>`/`<style>`/`<template>`/`<noscript>` (sam tag zostaje, więc `nth-of-type` się zgadza, AC-5.3). Elementy puste (void) bez tagu
zamykającego. Atrybuty: `id`, `class`, `role`, `data-*`, `aria-*` oprócz `aria-label`, `aria-valuetext`, `aria-description`, `aria-placeholder`
(mogą nieść treść użytkownika), oraz `type` na `input`/`button` (enumeracja, potrzebna developerowi). Nigdy `value`, `placeholder`, `title`,
`alt`, `href`/`src` (URL-e są w listach `dom.*`). Wartości atrybutów są escapowane (`&`, `"`, `<`). Cięcie: po przekroczeniu `limits.html`
(300 000 znaków) walker przestaje schodzić w głąb, domyka otwarte tagi (wynik da się sparsować przez `DOMParser`) i zwraca
`{ structure, truncated: true, omittedElements }`. Paczka dostaje `truncated.html: true` + notatkę „DOM structure was cut at 300000
characters; N elements omitted.”. Shadow DOM i `iframe` nie są serializowane (sam host/tag), co odnotowujemy w schemacie.
`dom.fullHtml` (pseudo-reguła `html-structure` wyłączona przez developera): ten sam walker w trybie `full`, czyli z węzłami tekstowymi
(escapowanymi) i wszystkimi atrybutami poza `value` pól, z limitem 8 000 000 znaków. W tle przechodzi przez przebieg tekstowy. Sufit 10 MB
zipa egzekwuje budżet (D8).
`dom.forms[].elements[]`: `value` → `valueLength` u źródła (collector). `password` nie ma `valueLength` (spec „Dane”).
Element w `consoleLogs[].args` (`serialize.js`): `{ tagName, id, className, structure }`, gdzie `structure` to wynik tego samego walkera
z limitem 2000 znaków, zamiast `outerHTML`. To czyta tylko tyle, ile trzeba (E3-T0), i nie wynosi tekstów ani wartości (D5 v4).
Konsekwencje: `dom.html` traci `outerHTML` (zostaje `doctype`, `lang`, `charset`, `compatMode`), a `dom.structure` i `dom.fullHtml` są ostatnimi
kluczami `dom`. Wydajność: na 50 000 elementów walker kończy się po ≈ 300 KB (≈ 6–10 tys. elementów). Czas mierzy unit perf (≤ 150 ms
w jsdom na 10 000 elementów) i e2e AC-5.2.

### D6 Maskowanie pól na zrzucie: prostokąty z ISOLATED, zamalowanie w tle, fail-closed
Opcje:
(a) wstrzyknięcie CSS/nakładek na stronę przed `captureVisibleTab` i zdjęcie po (zmienia stronę, miga, wyścig z renderowaniem: zrzut
może wyjść przed nałożeniem — łamie AC-2.3/2.4);
(b) **prostokąty pól z ISOLATED** (`getBoundingClientRect`) przed i po zrzucie, **zamalowanie na bitmapie w tle** (`OffscreenCanvas.fillRect`)
przed kodowaniem JPEG;
(c) prostokąty z MAIN (przez kanał; MAIN ma łatwe do podmiany `getBoundingClientRect`).
**Wybór: (b).**
Uzasadnienie: strona nie jest dotykana, więc wartości, focus i przewinięcie zostają, a mignięcia nie ma (AC-2.3). ISOLATED ma własne,
niepodmienione prototypy DOM, a ten sam DOM co strona. Odpowiada na nowy komunikat tła `fieldRects` bez udziału MAIN i bez zmiany kanału.
Zamalowanie dzieje się w tle na zdekodowanej bitmapie, więc obraz bez maski nigdy nie opuszcza procesu tła i nie trafia do pliku.
Przepływ w `save.js` (przełącznik włączony, karta aktywna na origin nagrania): `R1 = fieldRects` (≤ 1 s) → `captureVisibleTab` →
`R2 = fieldRects` → jeśli `scrollX/scrollY/innerWidth/innerHeight` w R1 ≠ R2 (strona się przesunęła), jedna ponowna próba, a potem brak zrzutu
z notatką → maska = suma R1 ∪ R2 → `codec.mask(bitmap, rects × skala)` → JPEG 60 → `fitJpeg`. Skala = `szerokośćObrazu / innerWidth`,
co pokrywa DPR i zoom. Margines: każdy prostokąt powiększony o `max(2 px CSS, 8 px obrazu)`, żeby bloki 8×8 JPEG i antyaliasing nie
zostawiły krawędzi znaku. Kolor jednolity `#9e9e9e`.
Fail-closed (AC-2.4): brak odbiorcy `fieldRects` (dokument bez mostu, np. `loadedAfterStop`), timeout, wyjątek, brak kodeka
(`OffscreenCanvas`) przy niepustej masce albo niezgodna skala dają `screenshots: []` i notatkę „No screenshot: form fields could not be
hidden (<powód>).”. Zapis idzie dalej. Zero pól w widoku daje obraz bez maski (nie ma czego zakrywać).
Zakres pól (pytanie 2): `input` poza `button/submit/reset/checkbox/radio/range/color/image/hidden`, `textarea`, `select`, `[contenteditable]`
(element-host z `isContentEditable`). Do tego: same-origin iframe'y (rekursja do głębokości 2, przesunięcie o content box ramki), otwarte
shadow rooty, a zamknięte przez `chrome.dom.openOrClosedShadowRoot` (Chrome) lub `Element.prototype.openOrClosedShadowRoot` (Firefox),
wybierane wykrywaniem funkcji. Iframe'y cross-origin według PB-1. Liczymy tylko prostokąty przecinające viewport, z maksymalnie 2000
prostokątami (powyżej: cały viewport zamaskowany i notatka).
Przełącznik (IN1, pytanie 1): checkbox „Dołącz zrzut ekranu” w `#recording` nad *Zapisz paczkę*, domyślnie zaznaczony przy każdym otwarciu
popupu (bez zapamiętywania). `collect` dostaje `includeScreenshot`. Przy `false` nie ma wywołania API, jest `screenshots: []` i notatka
„Screenshot not included (turned off by the reporter).”.
Konsekwencje: `screenshots[]` dostaje `maskedFields` (liczba zamalowanych prostokątów). `createCanvasCodec` dostaje metodę `mask`. Obraz
zawsze przechodzi ponowne kodowanie, gdy maska jest niepusta (koszt ≈ 50–150 ms). Ryzyko rozjazdu przy DPR/zoom sprawdza spike S0.

### D7 Format paczki: własny writer ZIP na `CompressionStream('deflate-raw')` + CRC32, transfer base64 do popupu
Opcje:
(a) `fflate` vendorowany (≈ 8 KB min, MIT). Nowa zależność runtime, licencja w `dist`, generator nie przyjmie minifikowanego ESM;
(b) **własny writer**: lokalne nagłówki + central directory + EOCD (PKZIP 2.0), metoda 8 (deflate) przez natywne
`CompressionStream('deflate-raw')`, CRC32 z tablicą 256 wpisów, flaga UTF-8 (bit 11), data/czas DOS z czasu lokalnego, bez ZIP64 i bez
data descriptor (rozmiary znane przed zapisem). `screenshot.jpg` metodą 0 (stored), bo JPEG się nie kompresuje;
(c) zip bez kompresji (store): nie mieści 2 MB;
(d) `.json.gz`: jeden plik, ale bez `summary.md`/obrazu obok, a Eksplorator Windows nie otwiera `.gz` bez programów (AC-1.2).
**Wybór: (b).**
Uzasadnienie: `CompressionStream` z formatem `deflate-raw` jest w Chrome od 103 i w Firefoksie od 113, czyli poniżej naszych minimów
(121/128). Działa w service workerze, w event page, na stronie (fallback) i w Node ≥ 18 (testy jednostkowe na prawdziwej kompresji).
Writer to ≈ 150 linii czystego kodu bez zależności, testowany `unzip -t`, `fflate.unzipSync` (devDependency, już jest) i `zlib.inflateRawSync`.
Format PKZIP 2.0 z deflate otwierają Eksplorator Windows 11, Archiwizator macOS i `unzip` (AC-1.2). Unikamy pól, które Eksplorator
źle czyta (ZIP64, szyfrowanie, rozszerzone znaczniki czasu, data descriptor). Fallback bez `CompressionStream` (stara przeglądarka
w trybie konsolowym) zapisuje metodą 0. Wynik jest poprawny, tylko większy, i dostaje notatkę.
Transfer: odpowiedź `collect` przez `runtime.sendMessage` w Chrome jest serializowana do JSON (`Uint8Array` nie przejdzie), a w Firefoksie
przez structured clone. Wspólny mianownik to **string base64** (`zipBase64`). Narzut 33% (2 MB → 2,7 MB, sufit 10 MB → 13,3 MB) jest
daleko poniżej limitu komunikatu 64 MB. Popup dekoduje base64 do `Uint8Array`, robi `Blob({ type: 'application/zip' })` i woła
`downloads.download` jak w E1 D7. Tło nie ma `URL.createObjectURL` w SW, a Firefox odrzuca `data:` w `downloads.download`.
Nazwa (AC-1.1, pytanie 6): `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`. `host` = `hostname` originu nagrania (bez portu), małymi literami, znaki
spoza `[a-z0-9.-]` → `-`, pusty (np. `file:`) → `local`. Czas lokalny komputera z `Date` (te same pola co DOS-time w zipie).
Kolejność wpisów: `snapshot.json` (pierwszy), `summary.md`, `screenshot.jpg` (tylko gdy jest zrzut) (AC-6.4).
Konsekwencje: `attachments` znika. `screenshots[].attachment` → `screenshots[].file: "screenshot.jpg"`. Nowy moduł `src/lib/zip.js`
(`createZip(files, { compress, date }) → Uint8Array`, `crc32(bytes)`, `toBase64(bytes)`) i `src/lib/file-name.js`.
Popup: zmiana kontraktu `collect` (sekcja „Architektura”).

### D8 Potok zapisu i budżet rozmiaru (E3-S2): mierzymy kompresją, tniemy w ustalonej kolejności
Opcje:
(a) budżet na znakach JSON przed kompresją (zgadujemy współczynnik);
(b) **pomiar rzeczywisty**: kompresja `snapshot.json`, potem cięcie z celem w znakach wyliczonym z obserwowanego współczynnika, ponowna
kompresja (≤ 4 rundy);
(c) jedna kompresja i usuwanie z gotowego zipa (niemożliwe bez rozpakowania).
**Wybór: (b).**
Uzasadnienie: współczynnik kompresji JSON-a waha się od 5× (logi) do 20× (struktura DOM). Zgadywanie albo przycina za dużo, albo przekracza
2 MB. Natywna kompresja 5–10 MB trwa dziesiątki milisekund, więc dwie–trzy rundy mieszczą się w NFR. W typowym przypadku (≤ 2 MB po pierwszej
kompresji) runda jest jedna, a jej wynik od razu idzie do zipa.
Potok (`src/lib/export.js`, wspólny dla tła i fallbacku):
`assemblePackage(v4)` → `redact` → `fitBudget(pkg, { limitBytes, measure })` → `pkg.redaction = { rulesVersion: 1, disabledRules, masked: countMarkers(pkg) }`
→ `JSON.stringify(pkg, null, 2)` → `buildSummary(pkg)` → `createZip`. Wynik: `{ bytes, fileName, packageBytes }`. Gdy `measure` mierzy zip,
rezerwuje rozmiar JPEG + 16 KB na `summary.md` i nagłówki.
Kolejność cięcia (AC-6.2; od najmniej potrzebnego; każdy krok ustawia `truncated.<klucz>` i dodaje notatkę z liczbą usuniętych pozycji):
1. `performance.resources` — najstarsze ponad 200 (duplikat wpisów zasobów w `network`) → `truncated.resources`;
2. `network[]` udane (status < 400 i `error` = null): najpierw najstarsze zasoby (`img/script/css/font/other`), potem najstarsze `fetch/xhr`
   → `truncated.network`;
3. `consoleLogs` z `level` `debug` → `log` → `info` → `warn`, w każdej grupie najstarsze → `truncated.consoleLogs`;
4. listy `dom.meta/scripts/stylesheets/images/iframes/hreflangs` do 100 pozycji → `truncated.dom`, potem `dom.structure` do 100 000 znaków
   (cięcie na granicy elementu z domknięciem) → `truncated.html`;
5. wartości `storage.localStorage/sessionStorage` > 1000 znaków przycięte (z usunięciem niepełnego „wyrazu”, jak `cutPreview`) → `truncated.storage`;
6. `consoleLogs` z `level: error`, najstarsze → `truncated.consoleLogs`;
7. `stack` w `runtimeErrors`/`consoleLogs` do 4000 znaków (wpisy zostają) → `truncated.stacks`.
**Nigdy**: `overview`, `redaction`, `documents`, `notes`, `steps`, wpisy `runtimeErrors`, wpisy `network` ze `status` ≥ 400 lub `error`, `vitals`,
`screenshots[]` i plik obrazu (≤ 300 KB, mieści się w budżecie). Gdy po kroku 7 nadal jest za dużo: zapis i tak powstaje (nigdy nie blokujemy),
z notatką „Package is larger than 2 MB (N bytes) after all cuts.”. Cięcia zmieniają wpisy, więc `overview` i `documents[].kept`
liczymy **po** budżecie (`overview` = z tego, co jest w paczce — jak v3).
`dom.fullHtml` (AC-6.3, pytanie 3): `limits.packageBytes` = 10 485 760. Krok 0 przed listą: `fullHtml` przycinany (granica elementu), aż zip
≤ 10 MB → `truncated.html` + notatka „Full HTML was cut to fit 10 MB.”. Zip > 2 MB dostaje notatkę „Package exceeds 2 MB: full HTML
enabled by developer.”. Kroki 1–7 działają dalej z celem 10 MB. NFR „`snapshot.json` ≤ 10 MB po rozpakowaniu” egzekwujemy przy konfiguracji
domyślnej jako drugi warunek celu.
Konsekwencje: `fitBudget` jest czysty i synchroniczny względem danych. Pomiar `measure(pkg) → Promise<bytes>` jest wstrzykiwany, więc unit
testuje kolejność cięcia z atrapą, a potok z prawdziwą kompresją. W SW pamięć szczytowa to ≈ 3× rozmiar JSON-a (obiekt, string, bajty).
Przy 12 MB to ≈ 40 MB, akceptowalne (ryzyko 5 ze spec).

### D9 Serializacja z budżetem w MAIN (E3-T0) i porządek `pds:doc:*`
Opcje dla `serializeCapped`:
(a) `JSON.stringify` z replacerem-licznikiem i sentinelem rzucanym po `maxChars`. Rzut przerywa stringify, ale gubi już zbudowany prefiks
(potrzebny do `preview`), a tablice z milionami elementów i tak przechodzą przez replacer;
(b) **własny ograniczony walker** `toPlain(value, budget)`: buduje kopię złożoną ze zwykłych obiektów i tablic, liczy przybliżone znaki
(klucze + długości stringów + 4 na wartość), przestaje schodzić po wyczerpaniu budżetu, zachowuje reguły `safeJson` (funkcje, `Error`
z `cause`, węzły DOM, cykle po ścieżce przodków), a stringi tnie **przed** skopiowaniem;
(c) bez zmian (dziś pełny `JSON.stringify` + `JSON.parse`: `console.log(obiekt 5 MB)` kosztuje dziesiątki ms).
**Wybór: (b).**
Uzasadnienie: koszt (b) zależy od `entryChars` (40 000), a nie od rozmiaru obiektu. Zatrzymuje się po ≈ 40 tys. znaków, więc spełnia
≤ 5 ms p95 (AC-6.5). Nie potrzebuje `JSON.parse` (dziś podwójny koszt). Nie zależy od globalnego `JSON`, który strona z polyfillem
podmienia (E3-T0, AC-3.6). Do escapowania nic nie potrzeba, bo wynikiem jest obiekt, a serializuje go przechwycony `stringify`
w `main-entry.js`. Kształt wyniku pozostaje: `{ value, chars, truncated }`. Przy obcięciu `value` = `{ truncated: true, preview }`, gdzie
`preview` = pierwsze `maxChars` znaków przechwyconego `JSON.stringify(częściowaKopia)` (koszt ograniczony rozmiarem kopii). `serialize.js`
przechwytuje `JSON.stringify`, `Object.keys`, `Array.isArray`, `Reflect.apply` na poziomie modułu, czyli przy ładowaniu bundla
na `document_start`.
`pds:doc:*` (AC-6.5 część 2): `recording.js` przycina `rec.docs` do 100 (`slice(-MAX_DOCS)`), ale `pds:doc:<id>` przyciętych dokumentów
zostaje. Po `updateRec` ustalamy usunięte `id` i wołamy nowe `store.removeDocs(ids)` (poza callbackiem `updateRec`, który nie może
wołać store). `assemblePackage` zachowuje kolejność `documents[]` według `rec.docs`.
Konsekwencje: test perf jednostkowy (50 powtórzeń, p95) i regresja kształtu `safeJson` (`serialize.test.js` bez zmian asercji poza
`Element` → `structure`).

### D10 Schemat paczki v4
Opcje: (a) pola opcjonalne w v3; (b) **v4**: zmiana kontenera (zip), usunięcie `attachments`, zmiana typu `storage.cookies`
i `dom.forms[].elements[].value`, jedyna dopuszczalna zmiana typu wartości (liczba → znacznik).
**Wybór: (b)** (spec „Dane”). Szczegóły w sekcji „Schema paczki”. Walidator jest jeden dla unit i e2e.

### D11 `summary.md` minimalny (pytanie 4) jako moduł gotowy na E4
Opcje: (a) tekst składany w `save.js`; (b) **`src/lib/summary.js`**: `buildSummary(snapshot) → string` z zredagowanego obiektu (skill:
„nigdy z surowego”), bez DOM i bez `chrome.*`.
**Wybór: (b).** E4-S1 rozbuduje ten sam moduł (viewer/MCP), a fallback używa go bez zmian.
Treść (PL, bo AC-4.3 podaje polską linię): nagłówek `# Paczka diagnostyczna — <host>`, data zapisu (`collectedAt`), wersja rozszerzenia
i schematu, źródło; **Środowisko** (zredagowany `location.href`, `navigator.userAgent`, viewport × DPR, język); **Przegląd** (`overview`
w punktach: błędy JS, błędy konsoli, nieudane zapytania, kroki, metryki „poor”, zrzut tak/nie); **Prywatność** — linia
„Zamaskowano N wartości w M sekcjach (reguły v1). Hasła, tokeny i dane logowania nie są w tym pliku.” (+ „Wyłączone przez developera: …”,
gdy `disabledRules` niepuste; odmiana liczebników: 1 wartość / 2–4 wartości / 5+ wartości); **Uwagi** (pierwsze 10 `notes`); stopka
„Pełne dane: snapshot.json; obraz: screenshot.jpg.”. Bez danych spoza snapshotu.

### D12 Opcje developerskie w E3: kontrakt bez źródła
Opcje: (a) czytać `chrome.storage.managed` już w E3; (b) **przyjąć `devOptions = { disabledRules: [] }` jako wejście potoku**. W runtime E3
to stała `{}`, a testy wstrzykują wartości. Źródło dostarczy E4-D4.
**Wybór: (b)** (spec non-goals: „jak dostarcza — E4-D4”). `createSaveHandlers({ …, devOptions })` i `exportPackage({ devOptions })`.
`fullHtml` (`html-structure` w `disabledRules`) jest przekazywane do MAIN w `collect` (`{ type: 'collect', options: { fullHtml: true } }` → most
→ payload I2M `collect`). Typ wiadomości kanału zostaje ten sam, a pole payloadu jest opcjonalne.

## Architektura

```
 Zgłaszający ──klik ikony──▶ przeglądarka nadaje activeTab (zrzut, E2 D5)
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ POPUP  popup.html · popup.js · controller.js · view.js · messages.js                                          │
 │  #recording: [x] Dołącz zrzut ekranu (NOWE, domyślnie zaznaczony, niezapamiętywany)  [Zapisz paczkę]          │
 │  Zapisz: sendMessage({type:'collect', tabId, includeScreenshot}) ⇒ {ok, zipBase64, fileName}                  │
 │          → atob → Uint8Array → Blob(application/zip) → downloads.download(fileName) → saveStarted (jak E1 D7) │
 └───────────────┬──────────────────────────────────────────────────▲───────────────────────────────────────────┘
                 │ runtime.sendMessage (router: sender.url = popup/)  │ storage.session.onChanged
 ┌───────────────▼──────────────────────────────────────────────────┴───────────────────────────────────────────┐
 │ TŁO (SW Chrome / event page Firefox)  background.js → lib/save.js                                             │
 │  collect:                                                                                                     │
 │   1. includeScreenshot && tab.active && same origin:                                                          │
 │      R1 = tabs.sendMessage(tabId,{type:'fieldRects'},{frameId:0})  (NOWE, ≤1 s; brak → brak zrzutu, AC-2.4)  │
 │      captureVisibleTab(jpeg 60) → R2 = fieldRects → R1≈R2? → codec.mask(bitmap, R1∪R2 × skala) → fitJpeg     │
 │   2. tabs.sendMessage(tabId,{type:'collect', options?:{fullHtml}}) → wynik MAIN (string JSON, w pamięci)      │
 │   3. lib/export.js: assemblePackage(v4) → redact (redact.js + redact-page.js + redact-rules.js + sha256.js)   │
 │        → fitBudget (measure = zip.js/CompressionStream('deflate-raw')) → redaction.masked = countMarkers      │
 │        → JSON → summary.js → zip.js [snapshot.json, summary.md, screenshot.jpg?] → base64                     │
 │   NIC niezredagowanego do storage.*; pds:doc:* i pds:rec czyszczone przy finalize (E1)                        │
 └───────▲───────────────────────────────────────────────────┬──────────────────────────────────────────────────┘
         │ runtime.sendMessage: hello / flush(token) /         │ tabs.sendMessage(tabId, {collect|fieldRects|destroy|stop}, {frameId:0})
         │ stopped / bridgeError                               │
 ┌───────┴─────────────────────────────────────────────────────▼────────────────────────────────────────────────┐
 │ ISOLATED  content/isolated-world.js — most; chrome.runtime; DOM tak, JS strony nie; prototypy niepodmienialne │
 │  NOWE: fieldRects → page/field-rects.js (getBoundingClientRect pól; same-origin iframe; shadow roots          │
 │        przez chrome.dom.openOrClosedShadowRoot | el.openOrClosedShadowRoot) → odpowiedź wprost do tła, bez MAIN│
 │  collect: przekazuje options (fullHtml) w payloadzie I2M                                                      │
 └───────▲─────────────────────────────────────────────────────┬────────────────────────────────────────────────┘
         │ N.dispatchEvent(CustomEvent('pds:m2i',               │ N.dispatchEvent(CustomEvent('pds:i2m',
         │   {detail: JSON-string {n:nonce, v, id, type, payload}}))  {detail: JSON-string {n:nonce, v, id, type, payload}}))
         │   M2I: result, flush, stopped (bez zmian)            │   I2M: config, collect(+options), destroy, stop
         │   prywatny odłączony węzeł z handshake'u E1 D3 — strona nie ma referencji; NIE window.postMessage;
         │   nonce w KAŻDEJ wiadomości, odbiorca odrzuca zły `n`
 ┌───────┴─────────────────────────────────────────────────────▼────────────────────────────────────────────────┐
 │ MAIN  content/main-world.js — ZERO chrome.*; intrinsics z document_start                                      │
 │  serialize.js: toPlain z budżetem, przechwycony JSON (NOWE, T0) · hooks-network: wartości wrażliwych          │
 │  nagłówków żądania → znacznik u źródła (NOWE) · hooks-steps: file bez valueLength, change → fileCount (IN4)    │
 │  collector: dom.structure (dom-structure.js, ≤300 KB), forms valueLength, cookies surowy string (tylko w      │
 │  wyniku collect, nigdy we flush), fullHtml tylko na życzenie                                                  │
 └───────▲──────────────────────────────────────────────────────────────────────────────────────────────────────┘
         │ zdarzenia DOM, console/fetch/XHR, Performance
 ┌───────┴───────────────────┐
 │ STRONA (skrypty strony)   │   Fallback konsolowy: console-snapshot.js w realmie strony → te same moduły
 └───────────────────────────┘   src/page + src/lib/export.js → <a download> snapshot-<host>-<…>.zip (bez zrzutu)
```

Kontrakty nowe lub zmienione:
- Popup → tło `collect { tabId, includeScreenshot: boolean }` → `{ ok: true, zipBase64, fileName, packageBytes } | { ok: false, reason }`.
  Brak `includeScreenshot` traktujemy jak `true` (domyślny stan przełącznika).
- Tło → ISOLATED `fieldRects` → `{ ok: true, viewport: { innerWidth, innerHeight, scrollX, scrollY, dpr }, rects: [{ x, y, w, h }], frames: { hidden: n } }`
  | `{ ok: false, reason }`. Nadawca sprawdzany jak dla `collect` (tylko tło: `sender.id === runtime.id && !sender.tab`).
- Tło → ISOLATED `collect { options?: { fullHtml?: true } }` → I2M `collect` z `payload.options` → `collectPageState({ fullHtml })`.
- `PROTOCOL`/`RESULT_PROTOCOL` → 3 (kształt wyniku `collect`: `dom.structure`, `forms[].valueLength`, `args` z `Element.structure`).

## Zmiany w manifeście

**Brak zmian** w `src/manifest.base.json`, `manifest.chrome.json` i `manifest.firefox.json` poza podbiciem `version` przy release (E3-T10/release).

| Klucz | Zmiana | Uzasadnienie |
|---|---|---|
| `permissions: activeTab` | bez zmian | zrzut jak w E2; maskowanie dzieje się w tle na bitmapie |
| `permissions: scripting`, `storage`, `downloads` | bez zmian | `downloads` pobiera teraz `.zip` (ten sam przepływ) |
| `optional_host_permissions` | bez zmian | `fieldRects` idzie do już wstrzykniętego mostu (`tabs.sendMessage` nie wymaga nowych uprawnień) |
| `cookies`, `<all_urls>`, `tabs`, `offscreen`, `unlimitedStorage` | **nie dodajemy** | HttpOnly celowo poza paczką; kompresja i SHA-256 bez uprawnień; `OffscreenCanvas` działa w SW bez `offscreen` |
| usunięte | brak | — |

Test: `manifest-parity.test.js` + nowy `manifest unchanged vs 0.4.0 except version` (NFR „bez nowych uprawnień”, T10).

## Chrome vs Firefox

| Obszar | `dist/chrome` | `dist/firefox` |
|---|---|---|
| Manifest | jak 0.4.0 (`minimum_chrome_version: 121`, `background.service_worker`) | jak 0.4.0 (`gecko.strict_min_version: 128.0`, `background.scripts`) |
| Pliki | identyczne bajty (ten sam walker, te same moduły) | identyczne |
| Kompresja | `CompressionStream('deflate-raw')` w SW (Chrome ≥ 103) | ten sam API w event page (Firefox ≥ 113) |
| SHA-256 | czysty JS (`sha256.js`) — bez różnic | bez różnic |
| Prostokąty pól w zamkniętym shadow DOM | `chrome.dom.openOrClosedShadowRoot(el)` w ISOLATED | `el.openOrClosedShadowRoot` (Xray) w ISOLATED; wybór przez wykrywanie funkcji, nie UA |
| Maskowanie bitmapy | `createImageBitmap` + `OffscreenCanvas` w SW | to samo w event page (potwierdzone dla `convertToBlob` w E2 S4; `fillRect` sprawdza S0-S3) |
| Odpowiedź `collect` do popupu | serializacja JSON → `zipBase64` (string) | structured clone → ten sam string (wspólny mianownik) |
| Zrzut po przeładowaniu przy otwartym popupie | jest (activeTab żyje w obrębie originu) | brak + notatka (activeTab cofany przy reloadzie, E2) — bez zmian |
| Pobieranie | `Blob` URL z popupu, `.zip` | to samo; QA ręczne: nazwa pliku zgodna z `fileName` |
| Testy | e2e Playwright (AC-1.1, 1.5, 2.2, 3.5, 3.6, 3.7, 6.1) | QA ręczne FQ-E3-1..6 (spec NFR „Przeglądarki”) |
| Gałęzie w kodzie | brak; tylko wykrywanie funkcji (`openOrClosedShadowRoot`, `CompressionStream`, `OffscreenCanvas`) | — |

## Schema paczki

`schemaVersion: 4` (zmiana łamiąca). `SCHEMA_VERSION = 4` w `src/lib/package.js` i w walidatorze. Fixture `tests/fixtures/snapshots/v4.json`
(v3.json zostaje do testów migracji). Sekcja „Wersja 4” + tabela v3 → v4 w `docs/snapshot-schema.md`.

Kontener: `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` → `snapshot.json` (pierwszy, JSON z wcięciem 2), `summary.md`, `screenshot.jpg?`.

Kolejność kluczy najwyższego poziomu `snapshot.json`:
```
schemaVersion, extensionVersion, source, collectedAt, recordingStartedAt, recordingStoppedReason, timeOrigin,
overview, redaction, limits, truncated,
documents, notes, steps, runtimeErrors, network, vitals, screenshots, consoleLogs,
environment, performance, storage, dom
```

Diff v3 → v4:
| v3 | v4 | Migracja przy odczycie v3 |
|---|---|---|
| plik `page-debug-snapshot-<ms>.json` | zip `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` z `snapshot.json`, `summary.md`, `screenshot.jpg?` | konsument rozpoznaje po rozszerzeniu / pierwszym bajcie `PK` |
| `schemaVersion: 3` | `4` | — |
| — | `redaction: { rulesVersion: 1, disabledRules: string[], masked: { "<sekcja>": n } }` (po `overview`) | brak ⇒ „dane niezredagowane” |
| `attachments` (ostatni klucz) | **usunięte** | obraz z `attachments[id]` |
| `screenshots[].attachment` | `screenshots[].file` (`"screenshot.jpg"`), nowe `maskedFields` (integer) | `file` = `attachment`, `maskedFields: null` |
| `storage.cookies`: string | `[{ name, sizeBytes, valueHash }]` + nowe `storage.cookiesTotalBytes` | rozbić string; `valueHash: null` |
| `storage.localStorage/sessionStorage` wartości jawne | wartości po redakcji (znaczniki) | — |
| `dom.html.outerHTML` | usunięte; nowe `dom.structure` (string ≤ 300 000, bez tekstów) i `dom.fullHtml` (`null` lub string) — ostatnie klucze `dom` | brak struktury |
| `dom.forms[].elements[].value` | `valueLength` (integer; brak dla `password`) | `valueLength` = długość `value` |
| `consoleLogs[].args` — `Element` `{tagName,id,className,outerHTML}` | `{tagName,id,className,structure}` (≤ 2000 znaków, bez tekstów) | — |
| `steps[]` `change` pliku: `valueLength` = liczba plików | `fileCount` (integer); `input` na `input[type=file]` nie jest rejestrowany (IN4) | `fileCount` = `valueLength` |
| wartości w dowolnym polu tekstowym jawne | `"[redacted:<reguła>]"`; liczba/boolean przy kluczu wrażliwym w danych użytkownika → string znacznika (jedyna zmiana typu) | — |
| `limits` | + `html` (300 000), `packageBytes` (2 097 152 albo 10 485 760 przy `fullHtml`) | brak ⇒ nieznane |
| `truncated` | + `html`, `resources`, `dom`, `storage`, `stacks` | `false` |
| `notes` | + brak zrzutu: wyłączony przez zgłaszającego / nie udało się zamaskować pól; cięcia budżetu z liczbami; >2 MB z `fullHtml`; zip bez kompresji (fallback) | — |
| `overview` | bez zmian (liczone po budżecie; `screenshot: false` przy wyłączonym zrzucie) | — |

Nazwy reguł w znacznikach (`rulesVersion: 1`): `key-<token>`, `jwt`, `bearer`, `basic`, `card`, `iban`, `pesel`, `long-secret`, `url-credentials`,
`url-fragment`, `form-value`, `email`, `phone`. `disabledRules` ⊆ {`email`, `phone`, `html-structure`}.
`redaction.masked` klucze ⊆ klucze najwyższego poziomu (`steps`, `runtimeErrors`, `network`, `vitals`, `consoleLogs`, `documents`, `notes`,
`environment`, `performance`, `storage`, `dom`). Sekcje z 0 nie występują. Suma = liczba wystąpień `[redacted:` w `snapshot.json`.

## Zadania

Konwencje (jak E2): testy najpierw. DoD = testy zadania zielone + `npm test` całość zielony (poza wyjątkami nazwanymi w zadaniu)
+ eslint czysty na zmienionych plikach. Pliki generowane (`src/content/*`, `src/standalone/console-snapshot.js`) nie liczą się do limitu.
**Regeneracja bundli tylko w grupie D** (T8, T9, sekwencyjnie). Wcześniejsze zadania zmieniające `src/page/*` albo `src/lib/*` importowane przez
`src/page` nie commitują `npm run gen`, a `gen --check`/`gen-content`/`layout` mogą być czerwone do T8 (odnotować w `state.md`).
Składnia modułów według CLAUDE.md. W kodzie i komentarzach nie pisać `url(` (po niesłowie), `getURL(`, `import(`, `require(`.
Moduły `src/lib` importowane przez `src/page` (`redact-rules.js`, `mask-secrets.js`, `export.js` i jego importy) muszą być bez `chrome.*`,
bez top-level `await` i bez `globalThis.chrome`. Testy `CompressionStream` w środowisku `node` (`// @vitest-environment node`).

### E3-S0 Spike: dopasowanie maski do zrzutu i API Firefoksa  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/spike-e3/run.spike.mjs`, `tests/e2e/spike-e3/ext/` (minimalne rozszerzenie w tmp, jak E2-T0), `docs/epics/E3/spike-S0.md`.
Co zrobić (timebox jeden przebieg; start pierwszego dnia, równolegle z grupą A):
- S1 Chromium: strona z 6 polami (w tym `position: fixed`, w przewiniętym kontenerze, w same-origin iframe), `deviceScaleFactor` 1 i 2, zoom 125%
  (`chrome.tabs.setZoom` w spike). ISOLATED `getBoundingClientRect` → SW `captureVisibleTab` → `OffscreenCanvas.fillRect(rect × szerokośćObrazu/innerWidth)`
  → pomiar jednolitości w prostokącie (≤ 2%) i różnicy krawędzi.
- S2 Chromium: `chrome.dom.openOrClosedShadowRoot` w ISOLATED dla zamkniętego shadow root z `<input>`.
- S3 Firefox (ręcznie, `web-ext run`, ≈ 15 min): w event page `CompressionStream('deflate-raw')` + `OffscreenCanvas.fillRect` + `convertToBlob`.
  W content script `el.openOrClosedShadowRoot`, `getBoundingClientRect` w same-origin iframe.
Testy do napisania najpierw (w skrypcie, PASS/FAIL per punkt): `spike: S1 mask covers fields at dpr 1, dpr 2, zoom 125%, fixed, scrolled, iframe`,
`spike: S2 closed shadow root reachable in ISOLATED`, `spike: S3 (manual checklist) firefox deflate-raw, fillRect, openOrClosedShadowRoot`.
Definicja ukończenia: `spike-S0.md` z wynikami, wersjami i decyzją: skala z `szerokośćObrazu/innerWidth` wystarcza (tak/nie). Margines 8 px obrazu
wystarcza (tak/nie). Przy porażce S1 architekt wraca do D6 przed IN1c.

### E3-T0a Serializacja z budżetem i przechwycony JSON (E3-T0, część 1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/serialize.js`, `tests/unit/serialize.test.js`, `tests/unit/serialize-perf.test.js`.
Co zrobić:
- `toPlain(value, { maxChars, elementStructure })` według D9: kopia obiektów i tablic, licznik znaków, cięcie stringów przed kopiowaniem, cykle
  po ścieżce przodków (`[Circular]`), `Error` → `{ name, message, stack, cause? }` (reguły E2-T7a), funkcja → `[Function: n]`, `Node` → `[Node: …]`.
- `Element` → `{ tagName, id, className, structure }`. `structure` daje wstrzyknięta funkcja `elementStructure(el, 2000)` (T3a dostarczy
  implementację; domyślnie `null`, żeby zadanie było niezależne). Nigdy `outerHTML`.
- `serializeCapped`/`safeJson` na `toPlain`. Przy przekroczeniu `{ truncated: true, preview }`, gdzie `preview` = pierwsze `maxChars` znaków
  przechwyconego `JSON.stringify` częściowej kopii. Kształt wyniku i `chars` bez zmian.
- Przechwycić na poziomie modułu `JSON.stringify`, `Object.keys`, `Array.isArray`, `Reflect.apply`, `Object.prototype.toString` i używać tylko ich.
Testy do napisania najpierw:
- `console.log(5 MB object) serialize p95 ≤ 5 ms over 50 runs` (AC-6.5; `serialize-perf.test.js`, środowisko `node`),
- `array of 1e6 numbers stops after budget; chars ≤ maxChars + 64`, `single 5 MB string is sliced before copy`,
- `page overriding JSON.stringify/JSON.parse after module load does not change result` (AC-3.6, E3-T0),
- `Element in args has structure from injected function and no outerHTML`,
- regresje: `cycles → [Circular]`, `Error cause chain 5 levels`, `functions and nodes summarised` (dotychczasowe asercje).
Definicja ukończenia: testy zielone. Dotychczasowe testy `serialize`/`hooks-console` zielone poza asercją `outerHTML` → `structure`.

### E3-T0b Przycinanie `rec.docs` usuwa `pds:doc:*` (E3-T0, część 2)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/recording.js`, `src/lib/session-store.js`, `tests/unit/background-lib.test.js`, `tests/unit/background-recording.test.js`.
Co zrobić:
- `store.removeDocs(ids)` (kolejka, `area.remove` kluczy `pds:doc:<id>`).
- W `recording.js` (miejsca `slice(-MAX_DOCS)` w `hello`/`bridgeError`): w callbacku `updateRec` zapamiętać `id` wypchniętych dokumentów, a po
  nim wywołać `store.removeDocs`.
- Kolejność `documents[]` w paczce = kolejność `rec.docs` (bez zmian w `package.js`; test regresji).
Testy do napisania najpierw:
- `101st document trims rec.docs and removes pds:doc of the dropped one` (AC-6.5),
- `documents[] keeps background order after trimming` (AC-6.5), `removeDocs tolerates missing keys`.
Definicja ukończenia: testy zielone.

### E3-T1 Reguły redakcji i korpusy (E3-T1, E3-IN2, E3-TEST1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/redact-rules.js`, `src/lib/mask-secrets.js`, `tests/unit/redact-rules.test.js`, `tests/fixtures/redaction/sensitive.json`, `tests/fixtures/redaction/benign.json`.
Co zrobić:
- `export const RULES_VERSION = 1`, `ALWAYS_RULES`, `DEFAULT_RULES` (D2), `secretKeyRule(name) → 'key-<token>' | null` (lista skilla + sufiks `sessid`/`sessionid`).
- `maskText(text, { email, phone, longSecret = true }) → { text, applied }`: kolejność jak w D3 (pary JSON tekst/liczba/bool, `k=v`, `k: v`, XML, atrybut `k="v"`,
  potem `basic`, `bearer`, `jwt`, `card` (Luhn+IIN), `iban` (mod-97), `pesel` (suma+miesiąc), `long-secret` (entropia), `email`, `phone`). Wartości będące
  znacznikiem są pomijane.
- `maskUrl(url, opts) → { text, applied }` według D3 (query, `;jsessionid`, `url-credentials`, `url-fragment`, potem wzorce).
- Walidatory jako eksporty testowalne: `luhn`, `peselValid`, `ibanValid`, `shannon`.
- `mask-secrets.js`: `maskSecrets(text)` = `maskText` z regułami *Zawsze* (kontrakt E2 `{ text, masked }`); `cutPreview` bez zmian.
- Korpus `sensitive.json` ≥ 50 (`{ id, rule, text, secrets: [] }`): każdy przypadek IN2 (`JSESSIONID`, `PHPSESSID`, `Basic`, `<token>…</token>`,
  `password: x`, `"pin":1234`), JWT, Bearer, klucze AWS/Stripe-like, karta ze spacjami, IBAN PL, PESEL, `?access_token=`, `#access_token=`, `user:pass@`,
  e-mail, telefon. `benign.json` ≥ 50 (timestampy ms/s, UUID-y i hashe commitów w URL-ach, wersje semver, base64 małych obrazków, ID zamówień,
  kody HTTP, zwykły tekst PL z cyframi, `tokenizer`, `keyboard`).
Testy do napisania najpierw:
- `sensitive corpus: 0 leaks — no secret nor any 8-char fragment of it in output` (AC-3.1),
- `benign corpus: ≤ 2 false positives, each listed with reason` (AC-5.1),
- `maskText is idempotent and second pass applies 0` (AC-4.2, poziom tekstu),
- `JSON stays valid after masking string, number and boolean values` (IN2), `XML element and attribute forms masked` (IN2),
- `maskUrl: query by key, ;jsessionid, credentials, token fragment → whole fragment; benign query kept` (AC-3.3),
- `card requires Luhn and IIN; 13-digit ms timestamps not masked`, `pesel requires checksum and valid month`, `iban mod-97`,
- `email/phone only when enabled`, `maskSecrets keeps E2 contract` (dotychczasowy `mask-secrets.test.js` zielony),
- `5 MB text masked in ≤ 700 ms` (perf, środowisko `node`).
Definicja ukończenia: testy zielone; moduł bez importów i bez DOM.

### E3-D4 SHA-256 w czystym JS  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/sha256.js`, `tests/unit/sha256.test.js`.
Co zrobić: `sha256Hex(string) → string` (UTF-8 przez `TextEncoder`, padding, 64 rundy), `shortHash(string) = sha256Hex(s).slice(0, 8)`. Bez `crypto.subtle`.
Testy do napisania najpierw: `NIST vectors: "", "abc", 448-bit message, 1e6 × "a"` (AC-4.4), `UTF-8 input (ą, emoji) equals node:crypto`,
`shortHash same value → same, different → different on 10 000 random values`.
Definicja ukończenia: testy zielone.

### E3-T4a Writer ZIP i nazwa pliku (E3-D2, część 1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/zip.js`, `src/lib/file-name.js`, `tests/unit/zip.test.js`, `tests/unit/file-name.test.js`.
Co zrobić:
- `crc32(bytes)` (tablica 256), `deflateRaw(bytes) → Promise<Uint8Array>` (`CompressionStream('deflate-raw')`; brak API → `null`),
  `createZip(files, { date })` gdzie `files = [{ name, data: Uint8Array, compress: boolean }]` → `Promise<{ bytes, compressed: boolean }>` według D7
  (PKZIP 2.0, flaga UTF-8, DOS-time lokalny, kolejność wejścia zachowana, bez ZIP64; > 4 GB → wyjątek).
- `toBase64(bytes)` w kawałkach (jak `blobToDataUrl`), `fromBase64(string)`.
- `file-name.js`: `snapshotFileName({ origin, date })` według D7 (`host`, sanityzacja, `local`, `YYYYMMDD-HHMMSS` z pól lokalnych).
Testy do napisania najpierw:
- `zip with snapshot.json, summary.md, screenshot.jpg passes unzip -t (No errors)` (AC-1.2; wymagane przy `CI`, inaczej `skipIf` bez `unzip`),
- `fflate.unzipSync and zlib.inflateRawSync read identical bytes; snapshot.json is first entry` (AC-6.4),
- `jpeg entry stored (method 0), json deflated (method 8)`, `crc32 matches zlib.crc32 on random buffers`,
- `without CompressionStream entries are stored and zip still valid`,
- `file name: host without port, [a-z0-9.-] only, local time, file: → local, IPv6 sanitized` (AC-1.1),
- `5 MB JSON compressed in ≤ 500 ms` (perf).
Definicja ukończenia: testy zielone.

### E3-T3a Serializator struktury DOM (E3-D3, E3-T3 część 1)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/dom-structure.js`, `tests/unit/dom-structure.test.js`, `tests/fixtures/pages/structure.html` (≥ 20 elementów z id, data-testid, bez obu; formularz; script/style/template; komentarz; tekst z e-mailem).
Co zrobić:
- `captureDomIntrinsics(win)` (gettery `tagName`, `attributes`, `firstElementChild`, `nextElementSibling`, `localName`, `Attr.name/value`) na `document_start`.
- `serializeDom(root, { mode: 'structure'|'full', maxChars, intrinsics }) → { html, truncated, omittedElements, elements }` według D5 (whitelist, escape,
  void elements, domykanie przy cięciu, `script/style/template/noscript` bez treści, tryb `full` z tekstem i atrybutami bez `value`).
- `elementStructure(el, maxChars)` do `serialize.js` (T0a).
Testy do napisania najpierw:
- `structure has no text nodes, no comments, no script/style content, no value/placeholder/title/alt/aria-label` (AC-5.2),
- `20 selectors from fixture (id, data-testid, nth-of-type paths from selector.js) match exactly 1 element in DOMParser(structure)` (AC-5.3),
- `10 000 elements → ≤ 300 000 chars, truncated true, omittedElements > 0, output parses and tags are balanced` (AC-5.2),
- `page patching Element.prototype.getAttribute after capture does not change output`, `tag names outside [a-z][a-z0-9-]* skipped`,
- `full mode keeps text, drops input value attribute`, `10 000 elements serialized in ≤ 150 ms (jsdom)`.
Definicja ukończenia: testy zielone; brak importów spoza `src/page`.

### E3-IN1a Prostokąty pól dla maski zrzutu (ISOLATED)  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/field-rects.js`, `tests/unit/field-rects.test.js`, `tests/fixtures/pages/privacy.html` (pola `email`, `tel`, `text`, `textarea`, `select`, `contenteditable`, numer karty, `password`, przyciski; same-origin iframe z polem).
Co zrobić:
- `collectFieldRects({ win, doc, openShadowRoot }) → { ok, viewport, rects, frames }` według D6: selektor pól (lista z pytania 2), `contenteditable`
  przez `isContentEditable` hosta, rekursja do same-origin iframe'ów (głębokość 2, przesunięcie o `clientLeft/Top` + rect ramki), shadow rooty
  (otwarte + `openShadowRoot(el)`), filtr przecięcia z viewportem, limit 2000. Iframe'y cross-origin według PB-1 (B: pomijane, bez prostokąta,
  liczba w `frames.crossOrigin`).
- Brak wyjątków na zewnątrz: błąd → `{ ok: false, reason }`.
Testy do napisania najpierw (jsdom z atrapą `getBoundingClientRect`):
- `every editable type from question 2 yields a rect; buttons/checkbox/radio/range/color/image/hidden do not` (AC-2.2),
- `fields outside viewport skipped; partially visible kept`, `same-origin iframe fields offset by frame position`,
- `closed shadow root reached through injected openShadowRoot`, `cross-origin frame (access throws) → no rect, frames.crossOrigin 1, ok true` (PB-1 B),
- `throwing DOM → ok false with reason`, `> 2000 rects → single viewport rect`.
Definicja ukończenia: testy zielone.

### E3-IN1b Zamalowanie pól na obrazie (tło)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/screenshot.js`, `tests/unit/screenshot.test.js`.
Co zrobić:
- `createCanvasCodec`: nowa metoda `mask(bitmap, width, height, rects, quality) → Blob` (`drawImage` + `fillStyle '#9e9e9e'` + `fillRect` per prostokąt).
- `planMask({ rects, viewport, imageWidth, imageHeight }) → rects w pikselach obrazu` (skala = `imageWidth / innerWidth`, margines `max(2 px CSS, 8 px)`,
  przycięcie do obrazu). Błędna skala (różnica proporcji > 2%) → `null`.
- `maskScreenshot({ dataUrl, rects, viewport, codec, maxBytes }) → { shot } | { error: 'mask-failed' }`: pusta maska → `fitJpeg` bez zmian;
  inaczej `decode` → `mask` → JPEG 60 → `fitJpeg` z bitmapy zamaskowanej. Brak kodeka przy niepustej masce → `mask-failed` (fail-closed).
- `screenshotErrorReason('mask-failed')` → `fields-not-hidden`.
Testy do napisania najpierw (atrapa kodeka zapisująca wywołania):
- `rect scaled ×2 at dpr 2 and ×1.25 at zoom 125%, with margin`, `rects clipped to image`,
- `non-empty mask without codec → error, never the original image` (AC-2.4), `empty mask returns original via fitJpeg`,
- `mask applied before fit: encode receives the masked bitmap`, `aspect mismatch → error`.
Definicja ukończenia: testy zielone; dotychczasowe testy `screenshot` zielone.

### E3-IN4 `input type=file` bez ścieżki i długości  [niezależne: tak]  [zależy od: —]
Pliki: `src/page/hooks-steps.js`, `tests/unit/hooks-steps.test.js`.
Co zrobić: zdarzenie `input` na `input[type=file]` nie tworzy kroku. `change` pliku → `{ inputType: 'file', fileCount }` bez `valueLength`. Nigdy nie
czytamy `value` pola pliku.
Testy do napisania najpierw: `file input event produces no step and never reads value` (AC-3.4), `file change records fileCount 2 and no valueLength, no names` (AC-3.4),
`other input types unchanged` (regresja).
Definicja ukończenia: testy zielone.

### E3-T5 `summary.md` minimalny (E3-T5)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/summary.js`, `tests/unit/summary.test.js`.
Co zrobić: `buildSummary(snapshot) → string` według D11. Odmiana „wartość/wartości”, „sekcja/sekcje/sekcjach”. Sekcje bez danych pomijane. Wyłącznie pola
snapshotu (bez dodatkowych wejść). Brak `redaction` (paczka v3) → linia „Brak informacji o maskowaniu.”.
Testy do napisania najpierw:
- `contains "Zamaskowano 14 wartości w 3 sekcjach (reguły v1)." for masked {network:10, storage:3, consoleLogs:1}` (AC-4.3),
- `lists disabled rules when present`, `overview counts and screenshot yes/no rendered`, `polish plural forms 1/2/5/22`,
- `built from redacted snapshot: no marker-free secret from fixture appears` (pomocniczo AC-3.5), `first 10 notes only`.
Definicja ukończenia: testy zielone.

### E3-T6 Budżet rozmiaru (E3-S2)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/budget.js`, `tests/unit/budget.test.js`, `tests/unit/helpers/heavy-package.js` (generator syntetycznej paczki „ciężkiej” v4: 5000 logów po 40 000 znaków, 5000 zapytań, struktura 300 KB, 1000 błędów).
Co zrobić: `fitBudget(pkg, { limitBytes, maxJsonChars, measure, reserveBytes })` → `Promise<{ pkg, packageBytes, cuts }>` według D8 (kolejność 0–7, cele
z obserwowanego współczynnika, ≤ 4 pomiary, `truncated.*`, notatki z liczbami, nota „larger than 2 MB”). Mutuje kopię. Przelicza `overview`
i `documents[].kept` po cięciach (eksport pomocniczy `recount(pkg)`).
Testy do napisania najpierw (atrapa `measure` = długość JSON / stały współczynnik):
- `heavy page fits ≤ 2 097 152 with default config` (AC-6.1, z prawdziwą kompresją: `measure` z `zip.js` — test przy T4b; tu atrapa),
- `never removes overview, steps, runtimeErrors, network ≥400/error, vitals, screenshots` (AC-6.2),
- `cut order: resources → successful network → debug/log/info/warn → dom lists/structure → storage → error logs → stacks` (AC-6.2),
- `each cut sets truncated.<key> and a note with the number removed` (AC-6.2),
- `fullHtml: limit 10 MB, fullHtml cut first, note "exceeds 2 MB" when over 2 MB` (AC-6.3), `never throws; over-limit after all cuts → note, pkg returned` (AC-6.3),
- `overview recounted after cuts`.
Definicja ukończenia: testy zielone.

### E3-UI1 Teksty popupu i przełącznik w HTML (E3-DOC1 część popupu, E3-IN1 UI)  [niezależne: tak]  [zależy od: —]
Pliki: `src/popup/messages.js`, `src/popup/popup.html`, `tests/unit/messages.test.js`, `tests/unit/popup-html.test.js`.
Co zrobić:
- `disclosureItems` po E3 (AC-1.3), propozycja: sieć — „zapytania sieciowe strony: adresy, nagłówki i wysyłana treść oraz adresy wczytanych plików”;
  strona — „struktura strony bez tekstów i bez wartości wpisanych w formularze”; zrzut — „zrzut ekranu w chwili zapisu (możesz go wyłączyć) —
  pola formularzy są na nim zakryte, reszta ekranu jest widoczna”; ciasteczka — „nazwy i rozmiary ciasteczek oraz dane zapisane przez stronę”;
  nowe zdanie `privacyNote`: „Hasła, tokeny i wartości ciasteczek są usuwane z pliku automatycznie. Plik nadal może zawierać adresy odwiedzanych
  stron i treść logów.”. Ostateczne brzmienie może poprawić faza docs/store-reviewer, a test pilnuje zgodności.
- `includeScreenshot: 'Dołącz zrzut ekranu'`. W `popup.html` w `#recording` nad `#save`: `<label><input type="checkbox" id="includeScreenshot" checked> …</label>`.
- `consentNotice` bez zmian (osobna decyzja store-reviewera).
Testy do napisania najpierw:
- `disclosure has no "mogą zawierać dane logowania" for network and cookies; privacyNote present` (AC-1.3),
- `forbidden words JSON, zip, hash, redakcja anywhere; "token" only inside privacyNote` (AC-1.3),
- `popup.html static texts equal MESSAGES incl. privacyNote and includeScreenshot label` (AC-1.3), `checkbox #includeScreenshot checked by default, above #save` (AC-2.1).
Definicja ukończenia: testy zielone; widoczność (AC-1.4) sprawdza TEST5.

### E3-UI2 Kontroler popupu: przełącznik i zip  [niezależne: tak (kontrakt z „Architektury”)]  [zależy od: —]
Pliki: `src/popup/controller.js`, `src/popup/popup.js`, `src/popup/view.js`, `tests/unit/popup-controller.test.js`, `tests/unit/popup-view.test.js`.
Co zrobić:
- `onSave({ includeScreenshot })`: `collect { tabId, includeScreenshot }`. Odpowiedź `{ ok, zipBase64, fileName }` → `fromBase64` (lokalnie albo import
  z `../lib/zip.js`; walker obejmie plik) → `Blob([bytes], { type: 'application/zip' })` → `downloads.download`. Brak `zipBase64` → `failed`.
- `popup.js`: `controller.onSave({ includeScreenshot: document.getElementById('includeScreenshot').checked })`.
- `view.js`/`applyModel`: checkbox `disabled` podczas `saving`; render nie zmienia `checked` (wybór żyje do zamknięcia popupu, bez zapamiętywania).
Testy do napisania najpierw:
- `save sends includeScreenshot from checkbox (true default, false when unchecked)` (AC-2.1),
- `zipBase64 becomes application/zip Blob with the background file name` (AC-1.1), `missing zipBase64 → failed`,
- `checkbox disabled while saving, checked state untouched by re-render`, regresje 15 s/60 s (dotychczasowe).
Definicja ukończenia: testy zielone (integracja z tłem w IN1c).

### E3-T2a Silnik redakcji i sekcje rekordów (E3-D1, E3-T2, E3-TEST2)  [niezależne: nie]  [zależy od: T1]
Pliki: `src/lib/redact.js`, `tests/unit/redact.test.js`, `tests/unit/redact-property.test.js`.
Co zrobić:
- `redact(pkg, { disabledRules }) → { snapshot, applied }` (kopia; D2). `ctx = { text(s, where), url(s), keyed(map, where), deep(value, where) }`.
  Kontrakt dla T2b: `redactPageSections(pkg, ctx)` importowane z `./redact-page.js`. Do czasu T2b w teście stub.
- Sekcje: `network[]` (`url` → url; `requestHeaders`/`responseHeaders` → keyed; `requestBody`/`responseBodyPreview` → text+phone), `consoleLogs[]` (`args` → deep
  z kluczami, liczby/boole przy kluczu → znacznik; `stack`, `frame`), `runtimeErrors[]` (`message`, `stack`, `filename`, `reason` deep, `frame`), `steps[]`
  (`url` → url, `selector` bez `long-secret`, `text`), `documents[].url`, `vitals[]` (LCP `url`, `longTasks…scripts[].url/invoker/function`), `notes[]`;
  catch-all na pozostałych stringach rekordów; nietykalne pola z D2.
- `countMarkers(pkg) → { masked, total }` (po sekcjach najwyższego poziomu). `resolveDisabledRules(list)` filtr do `DEFAULT_RULES` (AC-4.5).
Testy do napisania najpierw (fixture `v3.json` z pułapkami + generator):
- per sekcja z wartością-pułapką: `network[].url`, `requestHeaders`, `responseHeaders`, `requestBody`, `responseBodyPreview`, `consoleLogs[].args (nested, Error.cause)`,
  `consoleLogs[].stack`, `runtimeErrors[].message/stack/reason/filename`, `steps[]`, `documents[].url`, `notes` (AC-3.2),
- `same URL trap in every URL field → 0 hits` (AC-3.3 dla pól rekordów),
- `masked value is "[redacted:<rule>]", never null/""/missing; key paths before == after` (AC-4.1),
- `property: redact(redact(x)) deep-equals redact(x); second applied 0; container types and keys unchanged except number→marker` (AC-4.2, E3-TEST2; 200 losowych
  mutacji v3 fixture z wstrzykniętymi sekretami, ziarno stałe),
- `countMarkers total equals occurrences of "[redacted:" in JSON.stringify` (AC-4.3),
- `disabling email removes email masking and lists it; disabling jwt ignored and not listed` (AC-4.5),
- `statuses, methods, t, durations, sizes, overview, vitals numbers, error messages without secrets unchanged` (AC-5.4),
- `steps[].key "Enter" untouched (schema key not user data)`, `page-patched String.prototype.replace in test realm does not affect result` (wywołanie w osobnym
  `vm` kontekście; AC-3.6 pomocniczo).
Definicja ukończenia: testy zielone.

### E3-T2b Redakcja sekcji strony: storage, ciasteczka, DOM, środowisko (E3-T2, E3-D4)  [niezależne: nie]  [zależy od: T1, D4; kontrakt `ctx` z T2a]
Pliki: `src/lib/redact-page.js`, `tests/unit/redact-page.test.js`.
Co zrobić:
- `redactPageSections(pkg, ctx)`: `storage.localStorage/sessionStorage` → keyed + text (email, phone); `__error` bez zmian; `storage.cookies` string → `[{ name, sizeBytes, valueHash }]`
  + `cookiesTotalBytes` (D4; już tablica → bez zmian, idempotencja); `dom.forms[].elements[]` `value` → `valueLength` (`password` bez), `action` → url;
  `dom.meta[]` → `attributes.content` znacznik, gdy `name`/`property`/`http-equiv` jest kluczem wrażliwym (`csrf-token`); `text` → text; mapy `attributes`
  i `rootMarkers.*` → keyed (atrybut `data-token` → `key-token`); `src`/`href`/`canonical`/`hreflangs` → url; `images[].alt` → text; `dom.structure`/`dom.fullHtml` → text
  (z formą atrybutu `k="v"`); `environment.location.href` → url, a `search`/`hash` z zamaskowanego `href`; `document.referrer` → url; `document.title` → text;
  `performance.navigation.name`, `resources[].name` → url.
Testy do napisania najpierw:
- per sekcja z pułapką: `storage.localStorage` (klucz `token`, JWT przy kluczu `x`, e-mail przy kluczu `profile`), `storage.sessionStorage`, `storage.cookies`,
  `dom (forms, meta csrf-token, data-* attrs, structure attribute)`, `environment.location/referrer`, `performance` (AC-3.2, AC-3.3, pytanie 7),
- `cookies: [{name,sizeBytes,valueHash}] + cookiesTotalBytes; same value → same hash across packages; different → different; vector "abc"` (AC-4.4),
- `forms: valueLength integer, none for password, no value key` (spec „Dane”),
- `idempotent on already redacted page sections` (AC-4.2).
Definicja ukończenia: testy zielone; po połączeniu z T2a (bez stubu) `redact.test.js` zielony.

### E3-T2c Redakcja u źródła w hookach sieci (E3-IN3, obrona w głąb)  [niezależne: nie]  [zależy od: T1]
Pliki: `src/page/hooks-network.js`, `tests/unit/hooks-network.test.js`.
Co zrobić: przy zapisie wpisu fetch/XHR wartości nagłówków żądania o nazwach wrażliwych (`secretKeyRule(name) !== null`) → znacznik. `url` przez
`maskUrl` (tylko reguły *Zawsze*). Wywołanie strony bez zmian (nagłówki wysyłane bez zmian). Koszt: jedno dopasowanie na nagłówek.
Testy do napisania najpierw:
- `Authorization/Cookie/X-Api-Key request header values never stored in buffer; request sent with original headers` (AC-3.5 u źródła, AC-4.9 E2 regresja),
- `?access_token= in fetch URL masked in buffer entry`, `fetch hook p95 overhead unchanged within +0.2 ms on 1000 calls` (NFR ≤ 2 ms).
Definicja ukończenia: testy zielone.

### E3-T3b Collector v4: struktura, formularze, opcja pełnego HTML (E3-T3 część 2)  [niezależne: nie]  [zależy od: T3a]
Pliki: `src/page/collector.js`, `tests/unit/collector.test.js`.
Co zrobić:
- `collectDomSnapshot`: `html` bez `outerHTML` (`doctype`, `lang`, `charset`, `compatMode`); na końcu `structure` (`serializeDom` structure, `limits.html`),
  `structureTruncated`, `omittedElements`, `fullHtml` (`null`; string tylko przy `options.fullHtml`). Usunąć `redactedOuterHTML`.
- `forms[].elements[]`: `valueLength` zamiast `value` (bez dla `password`), bez czytania `value` pól `password`.
- `getStorageSnapshot`: bez zmian (cookies jako string; transformacja w tle). `collectPageState({ …, fullHtml })`.
- Intrinsics DOM z T3a przechwycone przy załadowaniu modułu.
Testy do napisania najpierw:
- `dom has structure ≤ limit and no outerHTML anywhere` (AC-5.2), `forms elements carry valueLength, password without, no value key` (AC-3.2 dom),
- `fullHtml null by default; string with option` (AC-6.3), `typed email in input not present in dom section (JSON.stringify grep)`.
Definicja ukończenia: testy zielone.

### E3-T4b Paczka v4 i potok eksportu (E3-D1, E3-D2, E3-T4)  [niezależne: nie]  [zależy od: T2a, T2b, T4a, T5, T6, D4]
Pliki: `src/lib/package.js`, `src/lib/export.js`, `tests/unit/package.test.js`, `tests/unit/export.test.js`.
Co zrobić:
- `package.js`: `SCHEMA_VERSION = 4`. Kolejność kluczy v4 z `redaction` (placeholder `{ rulesVersion: 1, disabledRules: [], masked: {} }`) po `overview`,
  bez `attachments`. `screenshots[]` z `file: 'screenshot.jpg'`, `maskedFields`, a bajty zwracane osobno (`assemblePackage` → `{ pkg, files: { screenshot?: Uint8Array } }`
  albo `meta.screenshots[].dataUrl` dekodowany w eksporcie; wybór implementera, test kontraktu). `limits.html`, `limits.packageBytes`, `truncated` v4. Normalizacja `dom`:
  `structureTruncated` → `truncated.html` + notatka z liczbą elementów; `forms[].elements[].value` → `valueLength` (obrona). Notatki brakującego zrzutu:
  wyłączony przez zgłaszającego, pola nieukryte. Usunąć `packageFileName` (zastępuje `file-name.js`).
- `export.js`: `exportPackage({ input, devOptions, date }) → Promise<{ bytes, fileName, packageBytes, snapshot }>` według D8: assemble → redact → `fitBudget` (measure =
  `createZip` snapshot.json + rezerwa) → `redaction` (`disabledRules`, `countMarkers`) → JSON → `buildSummary` → `createZip`. Zip bez kompresji → notatka „The package
  is not compressed (this browser cannot compress).”.
Testy do napisania najpierw:
- `Object.keys order v4; no attachments; redaction after overview` (spec „Dane”), `zip entries: snapshot.json first, summary.md, screenshot.jpg only with shot;
  no base64 image in snapshot.json; screenshots[].file names the entry` (AC-6.4),
- `heavy package (helpers/heavy-package.js) → zip ≤ 2 097 152 bytes with real compression` (AC-6.1), `redaction + compression of 5 MB JSON ≤ 1.5 s (median of 5)` (NFR),
- `sum redaction.masked == count of "[redacted:" in snapshot.json after budget cuts` (AC-4.3), `summary.md built from redacted snapshot contains the line` (AC-4.3),
- `trap values (JWT, cookie, email, password, access_token) absent from every zip entry bytes` (AC-3.5 poziom unit), `screenshot off → screenshots [] + reporter note` (AC-2.1),
- `fullHtml in disabledRules → limits.packageBytes 10 MB` (AC-6.3), `never throws on oversized input; save not blocked` (AC-6.3).
Definicja ukończenia: testy zielone; `package.test.js` przepisany na v4 (asercje v3 przeniesione do migracji walidatora).

### E3-IN1c Zapis w tle: przełącznik, maska, zip  [niezależne: nie]  [zależy od: IN1b, T4b; kontrakt UI2 i IN1a; wynik S0]
Pliki: `src/lib/save.js`, `src/background.js`, `tests/unit/save.test.js`, `tests/unit/helpers/fake-chrome.js`, `tests/unit/popup-background-integration.test.js`.
Co zrobić:
- `collect({ tabId, includeScreenshot = true })`: zrzut według D6 (R1 → capture → R2 → ponowna próba → `maskScreenshot`). Timeout `fieldRects` 1 s, wliczany w 15 s.
  `includeScreenshot === false` → bez wywołań i z notatką. Notatki: „Screenshot not included (turned off by the reporter).”, „No screenshot: form fields could not be
  hidden (<reason>).”, „No screenshot: the page moved while the screenshot was taken.”. Brak notatki o iframe'ach cross-origin (PB-1 B).
- `collect` do MAIN z `options.fullHtml`, gdy `devOptions.disabledRules` zawiera `html-structure`. `exportPackage` z `date = new Date(collectedAt)` i `origin = rec.origin`.
  Odpowiedź `{ ok: true, zipBase64, fileName, packageBytes }`. Nic z paczki nie trafia do `storage.session` (tylko `fileName`).
- `background.js`: `devOptions` = `{}` (stała, E4-D4) wstrzykiwana do `createSaveHandlers`.
- `fake-chrome.js`: odbiorca `fieldRects` (sukces/brak/zawieszenie/zmiana scrolla), `captureVisibleTab`, atrapa kodeka z `mask`.
Testy do napisania najpierw:
- `includeScreenshot false → no captureVisibleTab call, screenshots [], reporter note` (AC-2.1),
- `fieldRects missing/timeout/throws → saved without screenshot, note with reason; never unmasked image` (AC-2.4),
- `scroll changed between R1 and R2 → one retry, then note`, `mask = union of R1 and R2`,
- `zipBase64 decodes to zip with snapshot.json first; fileName snapshot-<host>-<local time>.zip` (AC-1.1, 6.4),
- `storage.session dump after successful save has 0 trap values` (NFR prywatność),
- integracja popup ↔ tło: `popup save → download of application/zip with background name` (AC-1.1, część unit).
Definicja ukończenia: testy zielone.

### E3-T7 Walidator v4, fixture v4, dokumentacja schematu  [niezależne: nie]  [zależy od: T4b]
Pliki: `tests/helpers/snapshot-validator.js`, `tests/unit/snapshot-validator.test.js`, `tests/fixtures/snapshots/v4.json`, `docs/snapshot-schema.md`.
Co zrobić:
- Walidator v4 (dalej bez importu `package.js`): klucze i kolejność v4, `redaction` (klucze, `rulesVersion` 1, `disabledRules` ⊆ default, suma `masked` = liczba znaczników
  w `JSON.stringify(pkg, null, 2)`), `storage.cookies` tablica obiektów z `valueHash` `^[0-9a-f]{8}$`, `dom.structure` string ≤ `limits.html` (chyba że `truncated.html`),
  brak `dom.html.outerHTML`, brak `value` w `forms[].elements[]`, `screenshots[].file` = `screenshot.jpg`, brak `attachments`, `steps` bez `value`, `fileCount` dla `file`.
  `validateZipEntries(names)`: kolejność i zbiór wpisów.
- `v4.json` z `exportPackage` (dane syntetyczne: 2 dokumenty, ciasteczka, storage z pułapkami zamaskowanymi, struktura, zrzut 1×1).
- `docs/snapshot-schema.md`: sekcja „Wersja 4” (kontener, kolejność, `redaction`, reguły i znaczniki, ciasteczka, struktura DOM, budżet i kolejność cięcia,
  ograniczenia: shadow DOM/iframe w strukturze, fallback a AC-3.6, hash bez soli), tabela v3 → v4, wpis zmian; skill `snapshot-schema` — „Stan: wersja 4”.
Testy do napisania najpierw:
- `validator rejects each missing v4 key, wrong order, attachments present, raw cookie string, outerHTML present, form value present, masked sum mismatch` (spec „Dane”),
- `v4.json passes`, `exportPackage output passes`, `v4.json contains only synthetic domains`.
Definicja ukończenia: testy zielone; dokument ma sekcję v4 i migrację.

### E3-T8 Mosty i punkt wejścia MAIN; regeneracja bundli  [niezależne: nie]  [zależy od: T0a, T3a, T3b, IN1a, IN4, T2c, IN1c]
Pliki: `src/page/isolated-entry.js`, `src/page/main-entry.js`, `src/page/constants.js`, `tests/unit/entries.test.js`, `tests/unit/recorder.test.js` (+ wygenerowane `src/content/*.js`, `src/standalone/console-snapshot.js`).
Co zrobić:
- `isolated-entry.js`: `fieldRects` od tła (sprawdzenie nadawcy jak `collect`) → `collectFieldRects({ win, doc, openShadowRoot: api.dom?.openOrClosedShadowRoot ?? (el) => el.openOrClosedShadowRoot })`
  → `sendResponse`. `collect` przekazuje `message.options` w payloadzie I2M.
- `main-entry.js`: `collect` z `payload.options.fullHtml` → `collectPageState({ fullHtml })`. `serialize` dostaje `elementStructure` z `dom-structure.js`.
- `constants.js`: `PROTOCOL = 3` (zgodnie z `RESULT_PROTOCOL` w `save.js` — zmiana w IN1c).
- `npm run gen`, commit bundli; `npm run gen -- --check` zielony.
Testy do napisania najpierw:
- `fieldRects from background answered by ISOLATED without MAIN; from a tab sender ignored` (D6),
- `collect with fullHtml option reaches collector; without → fullHtml null`, `collect result protocol 3 has dom.structure and no outerHTML`,
- `page-forged collect/stop with wrong nonce ignored` (regresja kanału E1 D3).
Definicja ukończenia: testy zielone; `gen --check` 0; `npm run build` OK; `dist/*` bez pliku > 500 KB (wypisać rozmiary).

### E3-T9 Fallback konsolowy: ten sam zip i redakcja (pytanie 5, AC-3.7)  [niezależne: nie]  [zależy od: T8, T4b]
Pliki: `src/page/console-entry.js`, `tests/unit/console-entry.test.js` (+ wygenerowany `src/standalone/console-snapshot.js`).
Co zrobić: `download()` → `async`: `exportPackage({ input: { meta(console), current }, devOptions: {}, date: new Date() })` → `Blob(bytes, application/zip)` → `<a download>`
z `snapshotFileName({ origin: location.origin })`. Zwraca `Promise<fileName>`. `snapshot()` zwraca zredagowany obiekt. Brak `CompressionStream` → zip stored + notatka. `npm run gen`.
Testy do napisania najpierw:
- `console download produces snapshot-<host>-<time>.zip with snapshot.json + summary.md, no screenshot` (pytanie 5),
- `console package redacted: trap values absent, validator v4 passes` (AC-3.7 unit), `snapshot() returns redacted object`.
Definicja ukończenia: testy zielone; `gen --check` 0.

### E3-TEST0 Helpery e2e na zip i regresje istniejących speców  [niezależne: nie]  [zależy od: T8, T9, T7]
Pliki: `tests/e2e/helpers/recording.js`, `tests/e2e/helpers/download.js`, `tests/e2e/screenshot.spec.js`, `tests/e2e/console-fallback.spec.js`, `tests/e2e/helpers/image.js`.
Co zrobić: `saveRecording` → `{ fileName, path, entries, json (snapshot.json), summary, files }` (rozpakowanie w pamięci przez `fflate.unzipSync`, jak `unzip.js`).
`waitForDownloadZip` dla fallbacku. `decodeImage` przyjmuje bajty JPEG. `screenshot.spec.js`: `attachments` → `files['screenshot.jpg']`, `screenshots[].file`. Każdy
zapis waliduje v4 (`validateSnapshot`). Pozostałe spece korzystają z `json` bez zmian.
Testy do napisania najpierw: istniejące spece przechodzą na v4 (`screenshot`, `console-fallback`, `recording`, `network`, `steps`, `vitals`, `navigation`).
Nowe: `saved file name matches snapshot-<host>-<YYYYMMDD-HHMMSS>.zip; exactly one download (downloads.search)` (AC-1.1).
Definicja ukończenia: pełny `npm run test:e2e` zielony (jeden build, `PDS_E2E_NO_BUILD=1` dla powtórzeń).

### E3-TEST3 E2E: prywatność całej paczki  [niezależne: nie]  [zależy od: TEST0]
Pliki: `tests/e2e/privacy.spec.js`, `tests/fixtures/pages/privacy.html` (z IN1a; dopisać skrypt pułapek), `tests/fixtures/pages/privacy-hostile.html`, `tests/e2e/helpers/fixtures-server.js` (trasa `/api/login` echo 401 bez treści sekretów).
Co zrobić: `privacy.html` przy starcie: JWT w `localStorage`, cookie `sid=<losowe>`, `console.log({ token })`, `fetch('/api/login?access_token=<t>', { method: 'POST',
headers: { Authorization: 'Bearer <t2>' }, body: JSON.stringify({ email, password }) })` po wypełnieniu formularza przez Playwright. `privacy-hostile.html` nadpisuje
`JSON.stringify/parse`, `String.prototype.replace`, `RegExp.prototype[Symbol.replace]`, `Array.prototype.map` (zwracają błędne wyniki) i robi to samo.
Testy do napisania najpierw:
- `grep -c of each trap value over all unzipped files (incl. screenshot.jpg bytes) = 0` (AC-3.5),
- `hostile page: package valid JSON, validator passes, 0 trap hits` (AC-3.6),
- `console fallback on privacy.html: 0 trap hits` (AC-3.7),
- `file input: steps have fileCount, no fakepath, no valueLength` (AC-3.4 e2e),
- `storage.session after save contains none of the trap values` (NFR prywatność).
Definicja ukończenia: zielone 10/10 (`--repeat-each=10`) bez `retries`.

### E3-TEST4 E2E: maskowanie zrzutu i przełącznik  [niezależne: nie]  [zależy od: TEST0]
Pliki: `tests/e2e/screenshot-mask.spec.js`, `tests/e2e/helpers/image.js` (statystyka jasności w prostokącie).
Testy do napisania najpierw:
- `dpr 1 and dpr 2: every field rect (getBoundingClientRect × dpr) uniform (luma stddev ≤ 2%); a control region outside fields not uniform` (AC-2.2),
- `values, activeElement and scrollY identical before and after save` (AC-2.3),
- `checkbox off → screenshots [], note "turned off by the reporter", no screenshot.jpg in zip` (AC-2.1),
- `bridge gone (document loaded after time limit) → no screenshot, note, save ok` (AC-2.4),
- `same-origin iframe field masked; cross-origin iframe not masked` (pytanie 2, PB-1 B).
Definicja ukończenia: zielone 10/10.

### E3-TEST5 E2E: format, rozmiar, czas, popup  [niezależne: nie]  [zależy od: TEST0]
Pliki: `tests/e2e/package-v4.spec.js`, `tests/fixtures/pages/heavy-e3.html` (DOM 50 000 elementów, 5000 logów po 40 000 znaków, 5000 zapytań do `/status/200`, duży obraz tła pod zrzut ≈ 300 KB), `tests/fixtures/pages/dom-10k.html`, `tests/e2e/perf.spec.js` (dopisanie).
Testy do napisania najpierw:
- `zip entries order; unzip -t on downloaded file "No errors"` (AC-1.2, AC-6.4), `exactly one file in downloads` (AC-1.1),
- `fixtures: basic, privacy, network → zip ≤ 2 MB; heavy-e3 → ≤ 2 MB with truncated flags and notes; never-cut sections intact` (AC-6.1, 6.2),
- `dom-10k: dom.structure ≤ 300 000, truncated.html true + note` (AC-5.2),
- `save → Zapisano ≤ 5 s median of 5 on basic.html and on flood (5000 logs)` (AC-1.5),
- `popup 360×600: Nagrywaj and Zapisz paczkę fully visible with the checkbox` (AC-1.4),
- `dist/chrome and dist/firefox: no file > 500 KB` (NFR), `manifests equal 0.4.0 except version` (NFR uprawnienia).
Definicja ukończenia: zielone 10/10 na przebiegu na wyłączność; wyniki rozmiarów i czasów do `test-coverage.md`.

## Kolejność i równoległość

| Fala | Zadania (równolegle w fali) | Warunek startu |
|---|---|---|
| **A** | S0 (spike), T0a, T0b, T1, D4, T4a, T3a, IN1a, IN1b, IN4, T5, T6, UI1, UI2 | — (rozłączne pliki; S0 zaczyna pierwszego dnia) |
| **B** | T2a (T1), T2b (T1, D4; kontrakt `ctx`), T2c (T1), T3b (T3a) | zależności z A; rozłączne pliki |
| **C** | T4b (T2a, T2b, T4a, T5, T6, D4) | B |
| **C'** | IN1c (IN1b, T4b, wynik S0), T7 (T4b) — równolegle, rozłączne pliki | C |
| **D** | T8 (T0a, T3a, T3b, IN1a, IN4, T2c, IN1c) → T9 (T8, T4b) | sekwencyjnie (obie regenerują bundle) |
| **E** | TEST0 → potem równolegle TEST3, TEST4, TEST5 | D; jeden `npm run build`, przebiegi z `PDS_E2E_NO_BUILD=1`, najwyżej dwa naraz |

Checkpoint commit po każdej fali. Wynik S0 musi być przed IN1c. Porażka S1 wraca do architekta (D6). Fazy po implementacji: E3-R1 (review
bezpieczeństwa z listą kontrolną na paczce z realnej strony), E3-Q1 (QA ≤ 2 MB, otwieranie w Windows/macOS, Firefox FQ-E3-*), E3-DOC1 (faza docs: instrukcja
„Co jest w paczce, a czego nie ma”, README), release (wersja 0.5.0, `RECORDER_VERSION`, `npm audit --omit=dev` = 0 high).

Liczba zadań implementacyjnych: 27 (w tym spike i 4 e2e). Grupy równoległe: A (14), B (4), C (1), C' (2), D (2 sekwencyjnie), E (1 + 3 równolegle).

## Plan testów

| AC | Unit | E2E (Chromium) | Firefox / ręczne |
|---|---|---|---|
| 1.1 | T4a `file name…`, UI2 `zipBase64 → Blob`, IN1c `fileName…` | TEST0 `name + one download`, TEST5 | FQ-E3-1 |
| 1.2 | T4a `unzip -t` | TEST5 `unzip -t` | Q1: Eksplorator Windows 11, Archiwizator macOS |
| 1.3 | UI1 `disclosure…`, `forbidden words…`, `html equals MESSAGES` | — | docs (DOC1) |
| 1.4 | UI1 `checkbox above #save` | TEST5 `360×600 visible` | FQ-E3-1 |
| 1.5 | T4b `≤ 1.5 s` (pomocniczo) | TEST5 `≤ 5 s median` | FQ-E3-1 ≤ 5 s |
| 2.1 | UI2 `sends includeScreenshot`, IN1c `false → no capture`, T4b `screenshot off` | TEST4 `checkbox off` | FQ-E3-2 |
| 2.2 | IN1a `every editable type`, IN1b `scaled ×2…` | TEST4 `dpr 1 and 2` | FQ-E3-2 (strona logowania) |
| 2.3 | — | TEST4 `values, activeElement, scrollY` | FQ-E3-2 (mignięcie wzrokowo) |
| 2.4 | IN1b `no codec → error`, IN1c `fieldRects missing…` | TEST4 `bridge gone` | — |
| 3.1 | T1 `sensitive corpus 0 leaks` | — | — |
| 3.2 | T2a per sekcja, T2b per sekcja, T3b `forms`, T0a | — | — |
| 3.3 | T1 `maskUrl…`, T2a `same URL trap…`, T2b url-pola strony | — | — |
| 3.4 | IN4 `file input…` | TEST3 `file input` | — |
| 3.5 | T4b `trap values absent from every entry`, T2c u źródła | TEST3 `grep -c = 0` | FQ-E3-3 |
| 3.6 | T0a `JSON override`, T2a `vm realm` | TEST3 `hostile page` | — |
| 3.7 | T9 `console package redacted` | TEST3 `console fallback` | FQ-E3-4 |
| 4.1 | T2a `marker never null…` | — | — |
| 4.2 | T1 tekst, T2a property (E3-TEST2), T2b | — | — |
| 4.3 | T2a `countMarkers`, T5 linia, T4b `sum == count`, T7 walidator | każdy zapis e2e przez walidator | Q1 `summary.md` |
| 4.4 | D4 wektory, T2b `cookies…` | TEST3 (`sid` nie występuje; jest `valueHash`) | — |
| 4.5 | T2a `disabling email… jwt ignored` | — | — |
| 5.1 | T1 `benign ≤ 2 FP` | — | Q1: < 20% URL-i `network` ze znacznikiem (ryzyko 2) |
| 5.2 | T3a `no text…`, `10 000 elements…`, T3b | TEST5 `dom-10k` | — |
| 5.3 | T3a `20 selectors…` | — | — |
| 5.4 | T2a `statuses… unchanged` | — | — |
| 5.5 | — | — | QA ręczne developera ≤ 60 s (E3-Q1) |
| 6.1 | T6 (atrapa), T4b `heavy ≤ 2 MB` | TEST5 fixtures + heavy | Q1 portal |
| 6.2 | T6 `never removes…`, `cut order`, `truncated + note` | TEST5 heavy | — |
| 6.3 | T6 `fullHtml…`, `never throws`, T4b, T3b | — | — |
| 6.4 | T4a, T4b `zip entries…`, T7 | TEST5 entries | — |
| 6.5 | T0a `p95 ≤ 5 ms`, T0b `trim removes pds:doc` | — | — |
| NFR rozmiar/czas | T4b `≤ 1.5 s`, T4a perf, T1 perf | TEST5 | — |
| NFR prywatność | IN1c `storage dump`, T2c | TEST3 `storage.session` | — |
| NFR uprawnienia | — | TEST5 `manifests equal 0.4.0` | `web-ext lint` bez nowych ostrzeżeń |
| NFR dist ≤ 500 KB | — | TEST5 | — |

Scenariusze QA ręcznego Firefox (`npm run dev:firefox` + `npm run fixtures`; wyniki w `qa-report.md`):
- **FQ-E3-1** (AC-1.1, 1.4, 1.5) `basic.html`: jeden plik `snapshot-127.0.0.1-<czas>.zip`, komunikat z nazwą, ≤ 5 s, popup bez przewijania.
- **FQ-E3-2** (AC-2.1–2.3) `privacy.html` i realna strona logowania: pola zakryte, brak tekstu na krawędziach, brak mignięcia; przełącznik wyłączony → brak obrazu.
- **FQ-E3-3** (AC-3.5) `privacy.html`: `grep` wartości-pułapek po rozpakowaniu = 0.
- **FQ-E3-4** (AC-3.7) `console-snapshot.js` wklejony w `privacy.html`: zip, 0 trafień.
- **FQ-E3-5** zamknięty shadow DOM z polem (fixture z S0): pole zakryte.
- **FQ-E3-6** zip z Firefoksa otwarty w Eksploratorze Windows 11 i `unzip -t`.

## Odrzucone zadania z backlogu
- [-] **E3-IN5** `npm audit` w devDeps (3 high: web-ext → adbkit → node-forge) — tylko obserwacja (spec non-goals). Bez zadania i AC. Warunek release:
  `npm audit --omit=dev` = 0 high (sprawdza faza release). Przy każdej nowej wersji `web-ext` sprawdzić, czy łańcuch zniknął. Downgrade
  odrzucony, bo cofa poprawki lint dla Firefoksa.
- [~] **E3-D4** „domena/flagi jeśli dostępne” → `document.cookie` ich nie podaje, a uprawnienie `cookies` jest poza zakresem (non-goal). Zostaje nazwa, rozmiar i hash.
- [~] **E3-TEST1** realizowane jako testy najpierw w T1 (korpusy) i T2a, bez osobnego zadania.
- [~] **E3-TEST2** realizowane w T2a (`redact-property.test.js`) i T2b, bez osobnego zadania.
- [~] **E3-D1/E3-D2/E3-D3** to decyzje D1–D3, D5, D7 tego dokumentu; implementacja w T2a/T2b, T4a/T4b, T3a/T3b.
- [~] **E3-R1, E3-Q1, E3-DOC1** — fazy review/QA/docs pipeline'u `/pds-deliver`, nie zadania implementera. Część DOC1 widoczna w popupie (AC-1.3) jest w UI1.
- [-] **E3-T6** — przeniesione do E1 wcześniej (backlog), nic do zrobienia.

## Ryzyka techniczne i jak je wykryjemy wcześnie
1. **Maska nie pokrywa pól przy DPR/zoom/fixed/iframe** (ryzyko 3 spec). Wykrycie: spike S0 pierwszego dnia (DPR 1/2, zoom 125%), TEST4 przy DPR 2,
   FQ-E3-2/5. Mitygacja: skala z szerokości obrazu, margines 8 px, suma R1 ∪ R2, fail-closed.
2. **Iframe'y cross-origin z danymi płatniczymi** (PB-1). Wykrycie: R1 na stronie z osadzonym formularzem płatności. Decyzja użytkownika PB-1 (B): nie maskujemy — ryzyko przyjęte i ujawnione w E3-DOC1.
3. **Przeciek nieznanego formatu** (ryzyko 1 spec). Wykrycie: korpus `sensitive`, E3-R1 na realnej stronie, QA. Mitygacja: przebieg tekstowy catch-all
   na każdym stringu, `long-secret` z entropią, reguła kluczy na każdej mapie danych użytkownika. Każdy nowy przypadek z R1/QA trafia do korpusu.
4. **Fałszywie dodatnie** (ryzyko 2 spec): telefon na 9-cyfrowych ID, `long-secret` na hashach base64 zasobów, PESEL na 11-cyfrowych ID. Wykrycie: korpus
   `benign` (≤ 2 FP), Q1: odsetek URL-i `network` ze znacznikiem (> 20% = sygnał). Mitygacja: walidatory (Luhn+IIN, suma PESEL+miesiąc, mod-97), wyłączenia `long-secret`.
5. **Czas i pamięć tła przy dużej paczce** (ryzyko 5 spec). Wykrycie: T4b `≤ 1.5 s`, TEST5 `≤ 5 s` na flood i heavy. Mitygacja: szybka ścieżka redakcji,
   ≤ 4 kompresje, `toPlain` w MAIN ogranicza dane u źródła. Sygnał: mediana > 3 s → przenieść kompresję zrzutu poza pętlę budżetu (JPEG jest stored).
6. **2 MB nie wystarcza** (ryzyko 4 spec). Wykrycie: Q1 portal > 1,5 MB albo cięcie > 50% `consoleLogs`. Mitygacja: kolejność cięcia zaczyna od duplikatów
   (`performance.resources`, udane zasoby); decyzja o wyższym budżecie do użytkownika.
7. **Zgodność zipa z Eksploratorem/Archiwizatorem**. Wykrycie: `unzip -t` w CI, fflate+zlib w unit, Q1 ręcznie na Windows 11 i macOS przed release.
   Mitygacja: wyłącznie PKZIP 2.0, bez ZIP64, bez data descriptor, nazwy ASCII.
8. **Hash ciasteczek bez soli** pozwala odgadnąć wartości o niskiej entropii (`consent=1`, `pin=1234`). Wynika z AC-4.4 (porównywalność między paczkami). Wpis do
   schematu i R1; wartości wrażliwe po nazwie (`pin`, `token`) i tak są poza paczką.
9. **Fallback w realmie strony** nie jest odporny na łatki strony (AC-3.6 dotyczy rozszerzenia). Wpis w schemacie i w instrukcji developera.
10. **Konflikty bundli przy pracy równoległej**. Mitygacja: regeneracja tylko w T8/T9 (sekwencyjnie). `gen --check` czerwony w falach A–C jest odnotowany w `state.md`.
11. **Walker/generator odrzucają nowy kod** (`url(` w komentarzu, wieloliniowe importy, `export.js` importowany z `src/page`). Wykrycie: `npm run build` i `gen --check`
    w DoD T8/T9. Uwaga w konwencjach zadań.
12. **Popup zamknięty w trakcie długiego zapisu** (zip w pamięci tła przepada). Bez zmian względem E1 D7: próba wygasa, nagranie trwa.
