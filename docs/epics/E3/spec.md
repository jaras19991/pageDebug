# E3 — Prywatność i rozmiar paczki

## Problem
Paczka v3 (0.4.0) ma jawne dane, które pozwalają przejąć sesję albo ujawniają dane osobowe: `storage.cookies` to surowy
`document.cookie` (`collector.js`, `getStorageSnapshot`), `localStorage`/`sessionStorage` mają wartości bez maskowania,
`dom.forms[].elements[].value` i `dom.html.outerHTML` mają wpisane dane (maskowane są tylko `password`/`hidden`),
`requestHeaders`/`requestBody`/URL-e przechodzą bez zmian, a `maskSecrets` (`src/lib/mask-secrets.js`) działa tylko na podglądach
odpowiedzi i `steps[].url`. Zrzut ekranu pokazuje e-mail i numer karty wpisane w pola (QA E2 F-3). Plik to jeden JSON
`page-debug-snapshot-<ms>.json`; na realnym portalu ma 1,2 MB, głównie `outerHTML`, a zrzut leży w nim jako base64.

## Non-goals
- `summary.md` w pełnej postaci, viewer, MCP i kanał konfiguracji developerskiej (`chrome.storage.managed`/plik) — E4.
  E3 definiuje *które* reguły developer może wyłączyć; *jak* je dostarcza — E4-D4.
- Zbieranie ciasteczek HttpOnly (uprawnienie `cookies`) i jakiekolwiek wysyłanie paczki przez rozszerzenie.
- Maskowanie tekstu wyświetlanego na stronie *poza* polami formularzy na zrzucie (np. „Zalogowany jako jan@…” w nagłówku)
  — zgłaszający widzi to w ujawnieniu; rozpoznawanie tekstu na obrazie (OCR) nie wchodzi.
- Przełącznik „pokaż pełne dane” w UI zgłaszającego — nigdy.
- Redakcja paczek już zapisanych (v1–v3) i narzędzie do ich czyszczenia.
- E3-IN5 (`npm audit` w devDeps) — tylko obserwacja; architekt wpisuje do `design.md`, bez AC. Warunek release: `npm audit --omit=dev` = 0 high.

## Ustalenia przyjęte przed specem
- **E3-IN1 (decyzja użytkownika 2026-10-23):** przy *Zapisz paczkę* zgłaszający ma przełącznik „Dołącz zrzut”, a pola
  formularzy są na obrazie zamaskowane. To jedyny nowy element UI w E3 (wyjątek od zasady E2 AC-1.4).
- Polityka redakcji = skill `privacy-redaction`, `rulesVersion: 1`, z rozszerzeniami z E3-IN2/IN3 (tabela w US-3).

## User stories

### US-1 (Zgłaszający) Jako zgłaszający chcę dostać jeden plik, o którym wiem, co zawiera, żeby go wysłać bez obaw i bez dopytywania
- **AC-1.1** (E3-D2, E3-T4) Given nagranie, When *Zapisz paczkę*, Then w pobranych jest **dokładnie jeden** plik
  `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` (host bez portu, znaki spoza `[a-z0-9.-]` → `-`), a komunikat *Zapisano* podaje tę
  nazwę (e2e Chrome: `downloads.search` = 1 element; QA ręczne Firefox).
- **AC-1.2** (E3-D2) Plik otwiera się wbudowanymi narzędziami systemu bez instalowania programów: Eksplorator Windows 11,
  Archiwizator macOS, `unzip -t` (= „No errors”) (unit: `unzip -t` na wyniku w CI; QA ręczne Windows).
- **AC-1.3** (E3-DOC1) Lista „Do pliku trafią:” mówi prawdę po E3: znikają sformułowania „mogą zawierać dane logowania”
  przy sieci i ciasteczkach; jest zdanie, że hasła, tokeny i wartości ciasteczek są usuwane automatycznie, oraz czego
  plik nadal może zawierać (adresy stron, treść logów). Bez słów `JSON`, `zip`, `hash`, `redakcja`, `token` w znaczeniu
  technicznym poza tym jednym zdaniem (unit na `MESSAGES` + równość z `popup.html`).
- **AC-1.4** Popup 360×600 px: *Nagrywaj* i *Zapisz paczkę* widoczne w całości bez przewijania, także z przełącznikiem
  z AC-2.1 (e2e `boundingBox`).
- **AC-1.5** Od *Zapisz paczkę* do *Zapisano* ≤ 5 s (mediana z 5) na `basic.html` i na fixture z 5 000 wpisami konsoli
  (e2e Chrome; QA ręczne Firefox ≤ 5 s).

### US-2 (Zgłaszający) Jako zgłaszający chcę sam zdecydować, czy dołączyć zrzut, i wiedzieć, że wpisane dane nie będą na nim widoczne
- **AC-2.1** (E3-IN1) W stanie *Nagrywam*/*Zatrzymane* nad *Zapisz paczkę* jest przełącznik „Dołącz zrzut ekranu” (PL,
  domyślnie wg pytania 1). Wyłączony → paczka bez obrazu, `screenshots: []`, notatka „Screenshot not included (turned off
  by the reporter).” (e2e).
- **AC-2.2** (E3-IN1) Given fixture `privacy.html` z wypełnionymi polami `email`, `tel`, `text`, `textarea`, `select`,
  `contenteditable` i polem z numerem karty, When zapis ze zrzutem, Then w prostokącie każdego pola (z `getBoundingClientRect`
  × `devicePixelRatio`) obraz jest jednolity (odchylenie jasności pikseli ≤ 2 %), a poza polami obraz nie jest zamazany
  (e2e Chrome przy DPR 1 i 2; QA ręczne Firefox na stronie logowania).
- **AC-2.3** Maskowanie zrzutu nie zmienia strony: po zapisie pola mają te same wartości, focus i pozycję przewinięcia;
  zgłaszający nie widzi mignięcia dłuższego niż 1 klatka (e2e: wartości i `scrollY` przed/po; QA ręczne).
- **AC-2.4** Nie udało się zamaskować pól (np. strona nie odpowiedziała) → zrzutu nie ma, jest notatka z powodem; zapis
  się udaje. Nigdy obraz bez maskowania (unit z mockiem błędu).

### US-3 (Zgłaszający) Jako zgłaszający chcę, żeby moje hasła, tokeny i dane osobowe nie trafiły do pliku, nawet gdy go nie przejrzę
Polityka (E3-S1). **Zawsze** (developer nie wyłącza): wartości ciasteczek, nagłówki `Authorization`, `Proxy-Authorization`,
`Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-*`, `X-CSRF-*`; wartości pól formularzy; wartości przy kluczach z listy skilla
(w obiektach, JSON, `klucz=wartość`, `klucz: wartość`, XML `<klucz>…</klucz>`, także liczby: `"pin":1234`); wzorce JWT,
`Bearer`, `Basic <b64>`, karta (Luhn), IBAN, PESEL (suma kontrolna), `long-secret`; sufiksy `sessid`/`sessionid`
(`JSESSIONID`, `PHPSESSID`). **Domyślnie** (developer może wyłączyć, zgłaszający nie): e-mail i telefon w konsoli, błędach,
`requestBody` i podglądach odpowiedzi; wartości storage przy kluczach spoza listy, gdy pasują do wzorców; strukturalny DOM
zamiast pełnego HTML. **Zostaje**: nazwy i rozmiary ciasteczek, klucze storage, URL-e bez wrażliwych parametrów, kody HTTP,
nagłówki niewrażliwe, metryki, struktura DOM bez tekstów, komunikaty błędów (po wzorcach).
- **AC-3.1** (E3-T1, E3-TEST1, E3-IN2) Korpus `sensitive` (≥ 50 przykładów, w tym każdy przypadek z E3-IN2 i każdy wzorzec
  powyżej) → **0** przecieków: żaden oryginalny sekret (ani jego fragment ≥ 8 znaków) nie występuje w wyniku (unit).
- **AC-3.2** (E3-T2) Każda sekcja to osobny test unit z wartością-pułapką: `storage.localStorage`, `storage.sessionStorage`,
  `storage.cookies`, `network[].url`, `requestHeaders`, `responseHeaders`, `requestBody`, `responseBodyPreview`,
  `consoleLogs[].args` (zagnieżdżone obiekty, `Error.cause`), `consoleLogs[].stack`, `runtimeErrors[].message/stack/reason/filename`,
  `steps[]`, `dom` (formularze, `meta[content]` np. `csrf-token`, atrybuty `data-*`), `environment.location`/`referrer`,
  `documents[].url`, `notes`.
- **AC-3.3** (E3-IN3) Każdy URL w paczce (`network`, `documents`, `vitals` LCP `url` i `longTasks` `scripts[].url`,
  `performance.resources[].name`, `dom.images/scripts/stylesheets/iframes/forms.action/canonical/hreflangs`, `frame`,
  `notes`, `environment`) ma maskowane parametry query po kluczu i cały fragment `#…` zawierający token (OAuth implicit)
  (unit: ten sam URL-pułapka wstawiony w każde pole → 0 trafień).
- **AC-3.4** (E3-IN4) Krok dla `input[type=file]` nie ma `valueLength` ani ścieżki (`C:\fakepath\…`); `change` ma liczbę
  plików, bez nazw (unit + e2e).
- **AC-3.5** (E3-TEST3) E2e `privacy.html`: token JWT w `localStorage`, cookie `sid`, e-mail i hasło w formularzu wysłanym
  `fetch` POST z nagłówkiem `Authorization`, token w `?access_token=` i w `console.log` → `grep -c <wartość>` po rozpakowaniu
  całego zipa (wszystkie pliki, także `screenshot.jpg` jako bajty) = 0 dla każdej wartości (Chrome e2e; Firefox QA ręczne).
- **AC-3.6** Redakcja nie zależy od tego, co strona podmieniła: fixture nadpisujący `JSON.stringify/parse`,
  `String.prototype.replace`, `RegExp.prototype[Symbol.replace]` i `Array.prototype.map` daje paczkę z 0 przecieków i poprawnym
  JSON (e2e; E3-T0 — strona z polyfillem JSON zapisuje `args` poprawnie).
- **AC-3.7** Fallback konsolowy (`console-snapshot.js`) stosuje tę samą politykę: AC-3.5 na fallbacku = 0 trafień (e2e).

### US-4 (Developer) Jako developer chcę wiedzieć, co i gdzie zamaskowano, i móc porównać dwie paczki, żeby nie zgadywać, czy dana zniknęła, czy jej nie było
- **AC-4.1** (E3-D1) Zamaskowana wartość to string `"[redacted:<reguła>]"` (np. `key-token`, `jwt`, `card`, `email`); nigdy
  `null`, `""` ani usunięty klucz (unit: zbiór ścieżek przed i po redakcji identyczny).
- **AC-4.2** (E3-TEST2) Redakcja jest idempotentna (`redact(redact(x))` ≡ `redact(x)`, drugi przebieg raportuje 0) i nie
  zmienia kształtu: klucze i typy kontenerów bez zmian, poza polami opisanymi w „Dane” (unit, property-based na v3 fixture).
- **AC-4.3** (E3-D1, E3-T5) Paczka ma `redaction` = `{ rulesVersion, disabledRules, masked: { "<sekcja>": n } }` bez żadnych
  wartości; suma `masked` = liczba znaczników `[redacted:` w `snapshot.json` (unit). Raport trafia też do `summary.md`
  linią „Zamaskowano N wartości w M sekcjach (reguły v1). …” (pytanie 4).
- **AC-4.4** (E3-D4) Ciasteczka: `[{ name, sizeBytes, valueHash }]` + `cookiesTotalBytes`; `valueHash` = 8 znaków hex
  SHA-256 wartości; ta sama wartość w dwóch paczkach → ten sam hash, różna → różny (unit; wektor testowy SHA-256).
- **AC-4.5** Given wyłączona reguła domyślna (opcja developerska, test unit), Then `redaction.disabledRules` ją wymienia;
  próba wyłączenia reguły z poziomu *Zawsze* jest ignorowana i nie pojawia się w `disabledRules` (unit).

### US-5 (Developer) Jako developer chcę, żeby po redakcji paczka nadal mówiła, co się zepsuło, żeby odpowiedzieć sobie w ≤ 60 s
- **AC-5.1** (E3-TEST1) Korpus `benign` (≥ 50: timestampy, UUID-y i hashe commitów w URL-ach, wersje, base64 małych obrazków,
  ID zamówień, kody HTTP, zwykły tekst PL) → ≤ 2 fałszywie dodatnie; każdy FP opisany w teście (unit).
- **AC-5.2** (E3-D3, E3-T3) `dom` ma strukturę bez tekstów: tagi, `id`, `class`, `data-*` (wartości po regułach), `role`,
  `aria-*` bez `aria-label` z treścią użytkownika; bez `value`, bez treści `<script>`/`<style>`, bez komentarzy; ≤ 300 KB,
  przy obcięciu `truncated.html: true` + notatka (unit jsdom + e2e na fixture z 10 000 elementów).
- **AC-5.3** Selektory z `steps[]`, `vitals` (`selector`) i `CLS.sources` dają się odnaleźć w strukturze DOM bieżącego
  dokumentu (unit: 20 selektorów fixture → `querySelectorAll` na sparsowanej strukturze = 1).
- **AC-5.4** Statusy, metody, czasy, rozmiary, `overview`, `vitals` i komunikaty błędów nie zmieniają się przez redakcję
  (unit: porównanie pól niewrażliwych przed/po na v3 fixture = równe).
- **AC-5.5** Scenariusz QA developera: na paczce z realnego portalu odpowiedź na „co kliknął / co się zepsuło / co było
  wolne” w ≤ 60 s, czytając `summary.md` i początek `snapshot.json` (QA ręczne, pomiar czasu).

### US-6 (Developer) Jako developer chcę paczki ≤ 2 MB, która mieści się w załączniku i nie gubi najważniejszego
- **AC-6.1** (E3-S2, E3-Q1) Z konfiguracją domyślną zip ≤ 2 MB (2 097 152 B) dla: fixture'ów e2e, syntetycznej strony
  „ciężkiej” (DOM 50 000 elementów, 5 000 logów po 40 000 znaków, 5 000 zapytań, zrzut 300 KB) i realnego portalu (QA).
- **AC-6.2** Gdy dane przekraczają budżet, paczka traci najpierw dane najmniej potrzebne (kolejność wg design) i **nigdy**:
  `overview`, `steps`, `runtimeErrors`, wpisów `network` ze `status` ≥ 400 lub `error`, `vitals`, metadanych zrzutu; każde
  cięcie ma `truncated.<sekcja>: true` i notatkę z liczbą usuniętych wpisów (unit na stronie „ciężkiej”).
- **AC-6.3** Wyjątki od 2 MB są tylko jawne: opcja developerska „pełny HTML” (`dom.fullHtml`) — wtedy limit wg pytania 3
  i notatka „Package exceeds 2 MB: full HTML enabled by developer.” Zapis nigdy nie jest blokowany przez rozmiar (unit).
- **AC-6.4** (E3-D2) Zawartość zipa: `snapshot.json` (pierwszy wpis), `summary.md`, `screenshot.jpg` (tylko gdy jest zrzut);
  w `snapshot.json` brak danych base64 obrazu; `screenshots[].file` wskazuje nazwę pliku w zipie (unit + e2e).
- **AC-6.5** (E3-T0) Nagrywanie nie spowalnia strony przy dużych danych: `console.log(obiekt 5 MB)` dodaje ≤ 5 ms (p95, 50
  powtórzeń, test perf), a przycinanie listy dokumentów do 100 usuwa też ich zapisane dane, z zachowaniem kolejności
  `documents[]` (unit `session-store`).

## Wymagania niefunkcjonalne
- **Rozmiar paczki:** ≤ 2 MB skompresowane przy konfiguracji domyślnej (AC-6.1); `snapshot.json` po rozpakowaniu ≤ 10 MB.
- **Czas:** redakcja + kompresja paczki 5 MB JSON ≤ 1,5 s na CI (unit perf, mediana z 5); *Zapisz* → *Zapisano* ≤ 5 s (AC-1.5);
  hooki na stronie bez regresji wobec 0.4.0 (≤ 2 ms p95 na `fetch`, test syntetyczny z E1).
- **Prywatność:** redakcja lokalna, przed zapisaniem czegokolwiek na dysk; `summary.md` powstaje z już zredagowanego
  snapshotu; żadna niezredagowana kopia nie zostaje w `storage.session`/`storage.local` po zapisie (unit: dump storage = 0 trafień).
- **Uprawnienia:** bez nowych uprawnień i host permissions w obu manifestach (unit porównujący manifesty z 0.4.0);
  bez nowych zależności runtime.
- **Przeglądarki:** Chrome ≥ 121 i Firefox ≥ 128 (obecne minima) — kompresja i SHA-256 tylko z API dostępnych w obu, w tle
  działającym jako service worker i event page. Firefox: AC-1.1, 1.5, 2.2, 3.5 jako scenariusze QA ręcznego (e2e FF — E5).
- **Rozszerzenie:** `dist/*` bez pliku > 500 KB; `web-ext lint` bez nowych ostrzeżeń.

## Dane — zmiany w schemacie paczki
Zmiana łamiąca → **`schemaVersion: 4`**, wpis w `docs/snapshot-schema.md` (tabela v3 → v4), fixture `v4.json`, walidator.
- Kontener: plik `.zip` zamiast `.json`; nazwa `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`; w środku `snapshot.json`, `summary.md`,
  `screenshot.jpg?`.
- `attachments` — **usunięte** (obraz jako plik w zipie); `screenshots[].attachment` → `screenshots[].file`.
- `storage.cookies`: string → `[{ name, sizeBytes, valueHash }]`; nowe `storage.cookiesTotalBytes`.
- `dom.html.outerHTML` → `dom.structure` (string, bez tekstów, ≤ 300 KB) + `dom.fullHtml` (`null`, chyba że developer włączył).
- `dom.forms[].elements[].value` → `valueLength` (integer; brak dla `password`).
- Nowe: `redaction` `{ rulesVersion, disabledRules, masked }`; `limits.html`, `limits.packageBytes`; `truncated.html` i
  `truncated.<sekcja>` dla cięć budżetowych (AC-6.2).
- Wartości zamaskowane w dowolnym polu tekstowym → `"[redacted:<reguła>]"` (typ pola bez zmian: string; liczby przy kluczach
  wrażliwych → string znacznika — **jedyna zmiana typu wartości**, opisana w schemacie).
- `overview.screenshot` liczone jak dotąd (false, gdy zgłaszający wyłączył zrzut).

## Otwarte pytania do użytkownika
1. **Domyślny stan „Dołącz zrzut ekranu”.** Propozycja: **włączony** przy każdym zapisie (wybór nie jest zapamiętywany) —
   pola są zamaskowane, a zrzut to najszybsza odpowiedź na „jak to wyglądało”.
2. **Które pola maskujemy na zrzucie.** Propozycja: wszystkie edytowalne — `input` poza `button/submit/reset/checkbox/radio/
   range/color/image`, `textarea`, `select`, `[contenteditable]`, także w same-origin iframe'ach; nie maskujemy etykiet.
3. **Limit z włączonym pełnym HTML.** Propozycja: twardy sufit 10 MB zipa; powyżej pełny HTML jest cięty z notatką.
4. **`summary.md` w E3.** Propozycja: minimalny plik (środowisko, `overview`, raport redakcji, wskazówka „pełne dane w
   snapshot.json”); pełna treść wg E4-S1 w E4 tym samym modułem.
5. **Fallback konsolowy.** Propozycja: ten sam `.zip` i ta sama redakcja (AC-3.7); bez zrzutu, jak dziś.
6. **Czas w nazwie pliku.** Propozycja: lokalny czas komputera zgłaszającego (rozpozna plik); dokładny UTC jest w `collectedAt`.
7. **Telefon i e-mail w `localStorage`/`sessionStorage` przy niewrażliwych kluczach.** Propozycja: maskować domyślnie
   (poziom *Domyślnie*), jak w konsoli — profil użytkownika w storage to częsty przypadek.

### Odpowiedzi użytkownika (bramka Spec, 2026-10-25)
Wszystkie propozycje przyjęte:
1. „Dołącz zrzut ekranu” — **włączony** domyślnie, wybór niezapamiętywany.
2. Maskowane na zrzucie — wszystkie pola edytowalne wg listy z pytania 2 (przyjęte domyślnie).
3. Pełny HTML — twardy sufit **10 MB** zipa; powyżej pełny HTML cięty z notatką; zapis nigdy nie blokowany.
4. `summary.md` w E3 — **minimalny** (środowisko, `overview`, raport redakcji); pełny w E4.
5. Fallback konsolowy — ten sam `.zip` i ta sama redakcja, bez zrzutu (przyjęte domyślnie).
6. Nazwa pliku — czas **lokalny** zgłaszającego (przyjęte domyślnie).
7. E-mail/telefon w storage przy niewrażliwych kluczach — maskowane **domyślnie** (poziom *Domyślnie*, wyłączalne przez developera).

## Ryzyka
1. **Przeciek nieznanego formatu sekretu** (własne tokeny bez słowa-klucza, krótkie). Sygnał: E3-R1 lub QA znajduje jawną
   wartość z nagłówka/storage realnej strony; korpus `sensitive` wymaga dopisywania wyjątków.
2. **Nadmiar fałszywie dodatnich** odbiera developerowi dane (UUID-y, hashe w URL-ach jako `long-secret`). Sygnał: > 2 FP
   w `benign`, w QA portalu > 20 % URL-i `network` ze znacznikiem.
3. **Maska zrzutu nie pokrywa pól** (zoom, DPR, przewijanie, `position: fixed`, shadow DOM, iframe). Sygnał: AC-2.2 przechodzi
   tylko przy DPR 1; w QA Firefox widać fragment tekstu na krawędzi pola.
4. **2 MB nie wystarcza** na portalach z intensywną konsolą. Sygnał: zip portalu w QA > 1,5 MB albo cięcia AC-6.2 usuwają
   > 50 % `consoleLogs` przy typowym nagraniu.
5. **Czas/pamięć tła** przy redakcji i kompresji dużej paczki (SW/event page ubite w trakcie). Sygnał: mediana AC-1.5 > 3 s
   na fixture 5 000 logów albo `pageBusy`/`failed` w e2e po zmianie formatu.
