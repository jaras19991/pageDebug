# E2 — Kompletność danych

## Problem
Po E1 paczka v2 ma logi, błędy i zapytania z całego nagrania, ale developer nadal nie odpowie na trzy z czterech pytań.
*Co kliknął* — brak jakiegokolwiek rejestratora kroków (`src/page` nie nasłuchuje `click`/`input`/`submit`; QA E1: „co
użytkownik kliknął przed błędem: nie do ustalenia”). *Co było wolne* — `collector.js` zapisuje tylko surowe
`performance.navigation`/`resources` bieżącego dokumentu, bez LCP/CLS/INP/FCP/TTFB i atrybucji. *Co się zepsuło* — status
mają tylko `fetch`/XHR (`hooks-network.js`); obrazek, skrypt czy CSS z 404 i status samego dokumentu nie istnieją, a treść
odpowiedzi błędu nie jest czytana. *Jak to wyglądało* — brak zrzutu ekranu. Stosy są cięte do 4000 znaków
(`STACK_MAX_CHARS`, `TEXT_MAX_CHARS`), a `dom.outerHTML` stoi w JSON przed logami, więc developer przewija megabajty.

## Non-goals
- Session replay / wideo, zrzut całej przewijanej strony, zrzuty kart innych niż nagrywana.
- Pełna redakcja (reguły `rulesVersion: 1`, `redaction` w paczce, hash cookies, strukturalny DOM) i format `.zip` — E3.
  E2 dodaje tylko zabezpieczenia u źródła dla **nowych** danych (kroki, treść odpowiedzi, zrzut) — AC-3.4, AC-4.6, AC-6.3.
- `summary.md`, viewer, MCP, konfiguracja developerska (np. włączanie treści odpowiedzi dla 2xx) — E4.
- Modyfikowanie lub blokowanie zapytań; treść ramek WebSocket/SSE; zapytania service workera strony i innych kart.
- Polyfill CLS/INP/LoAF w Firefoksie — brak danych raportujemy jawnie, nie liczymy przybliżeń.
- Zawartość iframe'ów cross-origin (zostaje tylko lista `dom.iframes[].src`, jak dziś).
- Automatyczne e2e w Firefoksie (E5) — Firefox w E2 to `web-ext lint` + QA ręczne.
- Czysto techniczne wejścia z E1: **E2-IN2** (teardown e2e), **E2-IN4** (stała w `gen-content.mjs`), **E2-IN5**
  (zgodność `RECORDER_VERSION` przy `pack`) — bez AC w specu, architekt wpisuje je w `design.md` jako zadania.

## User stories

### US-1 (Zgłaszający) Jako zgłaszający chcę wiedzieć, że plik zawiera teraz też moje kliknięcia i zrzut ekranu, i nadal mieć tylko dwa przyciski, żeby niczego nie ustawiać i nie wysłać czegoś nieświadomie
- **AC-1.1** Given stan *Gotowy*, Then lista „Do pliku trafią:” zawiera dodatkowo (PL, bez żargonu): kroki — co klikasz
  i na jakich stronach, **bez** wpisywanych treści; zrzut widocznej części strony w chwili zapisu; fragmenty odpowiedzi
  serwera przy błędach (unit na `MESSAGES` + test równości z `popup.html` + e2e na widoczny tekst).
- **AC-1.2** Teksty ujawnienia nie zawierają słów `CWV`, `LCP`, `webRequest`, `HTTP`, `base64`, `selector` (unit słownika,
  rozszerzenie testu E1 AC-1.8).
- **AC-1.3** Popup 360×600 px (domyślne okno popupu): przycisk *Nagrywaj* jest w całości widoczny bez przewijania mimo
  dłuższej listy (e2e: `boundingBox` przycisku w viewport). Odpowiedź na uwagę UX z QA E1 (F-8).
- **AC-1.4** Brak nowych przycisków, przełączników i pytań w popupie: *Nagrywaj* i *Zapisz paczkę* jak w E1; zrzut, kroki
  i metryki zbierają się same (unit na `popup.html`: zbiór przycisków = zbiór z E1).
- **AC-1.5** Od *Zapisz paczkę* do *Zapisano* na `basic.html` ≤ 5 s (mediana z 5, e2e), także ze zrzutem ekranu;
  niepowodzenie zrzutu nie blokuje zapisu (AC-6.4).
- **AC-1.6** Po aktualizacji rozszerzenia z 0.3.x pierwsze otwarcie popupu pokazuje nową listę przed nagrywaniem;
  nagrywanie rozpoczęte przed aktualizacją nie zbiera nowych kategorii (QA ręczne Chrome i Firefox; wymóg CWS z E1-T6).

### US-2 (Zgłaszający) Jako zgłaszający chcę, żeby popup zawsze mówił prawdę o stanie nagrania, także gdy strona się zmieni albo komputer zaśnie, żeby nie wysłać pustego pliku
- **AC-2.1** (E2-IN1) Given popup otwarty na nagrywanej karcie, When karta przechodzi na inny origin, Then w ≤ 1 s popup
  (bez zamykania) pokazuje komunikat `otherOrigin`; po powrocie na origin nagrania komunikat znika (e2e 127.0.0.1 → localhost).
- **AC-2.2** (E2-IN3) Given termin 10 min minął w czasie uśpienia komputera, When komputer się wybudza i strona nagrywana
  generuje dowolne zdarzenie lub zgłaszający otwiera popup, Then nagranie jest zatrzymane od razu (popup `stoppedByLimit`,
  `recordingStoppedReason: "time-limit"`), bez czekania na timer (unit z fałszywym zegarem: `Date.now()` przesunięty
  o 11 min, timer nieodpalony; QA ręczne z uśpieniem w Chrome).

### US-3 (Developer) Jako developer chcę widzieć listę kroków zgłaszającego z czasem i elementem, żeby wiedzieć, co kliknął przed błędem
- **AC-3.1** Fixture `steps.html`: klik przycisku, wpisanie tekstu w `input[type=email]`, zaznaczenie checkboxa, `submit`,
  `history.pushState`, pełne przejście na drugą stronę origin → `steps[]` ma te zdarzenia w kolejności, każdy z `t`,
  `doc`, `type` ∈ {`click`, `input`, `change`, `submit`, `navigate`, `key`} i `selector` (poza `navigate`) (e2e).
- **AC-3.2** `selector` jednoznacznie wskazuje element w zrzuconym dokumencie: `document.querySelectorAll(selector).length
  === 1` dla 20 elementów fixture (z `id`, z `data-testid`, bez obu); preferencja: `id` > `data-testid`/`data-*` > ścieżka (unit jsdom).
- **AC-3.3** Kolejne wpisywanie w to samo pole daje jeden krok `input` (z ostatnią długością), nie krok na znak (e2e: 18 znaków → 1 wpis).
- **AC-3.4** Prywatność u źródła: krok `input`/`change` ma `inputType` i `valueLength`, nigdy wartości; dla `password`
  — tylko `inputType`; `key` tylko dla Enter/Escape/Tab/strzałek, nigdy znaków; `contenteditable` — bez treści. E2e: wartości
  wpisane w fixture (`jan@example.com`, `Sekret123!`, tekst w `contenteditable`) — 0 trafień grep w całej paczce poza `dom`
  (wartości w `dom.forms`/`outerHTML` to stan sprzed E3, bez zmian).
- **AC-3.5** Krok `click` ma `text` — widoczną etykietę elementu ≤ 80 znaków, tylko dla przycisków, linków i elementów
  z `role=button`; dla pól formularza brak `text` (unit).
- **AC-3.6** Kroki z poprzednich dokumentów karty są w paczce (jak logi w E1 AC-4.4); `limits.steps` i `truncated.steps`
  działają jak dla innych tablic — zostają najnowsze (unit z 3000 kliknięć).
- **AC-3.7** Rejestrator kroków nie zmienia zachowania strony: `event.defaultPrevented`, `stopPropagation` w handlerze
  strony, kolejność handlerów i `isTrusted` bez zmian; narzut ≤ 0,5 ms na klik (p95, 1000 kliknięć, e2e Chromium).

### US-4 (Developer) Jako developer chcę mieć status, rozmiar i — przy błędach — fragment odpowiedzi każdego zapytania strony oraz pełny stos błędów, żeby wiedzieć, co się zepsuło
- **AC-4.1** Fixture: `<img>` z 404, `<script>` z 404, CSS 200, `fetch` 500, XHR 401, wszystko same-origin → każdy wpis
  `network[]` ma `status`, `type` (`fetch`/`xhr` albo rodzaj zasobu: `img`, `script`, `css`, `font`, `other`) i `sizeBytes`
  (number lub `null`) (e2e Chromium; QA Firefox — E2-TEST3).
- **AC-4.2** Status dokumentu głównego każdej nagranej strony (np. strona zwraca 500 lub 404) jest w paczce przy
  odpowiadającym wpisie `documents[]` (e2e: fixture-serwer zwraca 404 dla podstrony w trakcie nagrania).
- **AC-4.3** Zasób cross-origin (drugi origin fixture'a): wpis ma `status` **albo** `status: null` i `statusUnavailable`
  z powodem (np. `"cross-origin"`); nigdy `0` bez wyjaśnienia (e2e Chromium + QA Firefox).
- **AC-4.4** Brak duplikatów: 3 identyczne `fetch('/api/x')` w ≤ 50 ms dają dokładnie 3 wpisy `fetch` z poprawnie przypisanymi
  statusami (200/500/404 z fixture) i 0 dodatkowych wpisów tego samego zapytania (unit korelacji — E2-TEST1 + e2e).
- **AC-4.5** Dla `fetch`/XHR ze statusem ≥ 400 i `content-type` tekstowym (`text/*`, `application/json`, `*+json`, `*xml`)
  paczka ma `responseBodyPreview` ≤ limitu (pyt. 3) i znacznik obcięcia; dla < 400, typów binarnych, `no-cors`/opaque
  i strumieni bez końca — brak pola (unit + e2e 500 z JSON vs 200 z JSON vs 500 z `image/png`).
- **AC-4.6** Czytanie treści nie zmienia strony: po `fetch` 500 strona nadal czyta `await r.json()`, `r.bodyUsed === false`
  przed odczytem przez stronę; XHR z `responseType: 'blob'`/`'arraybuffer'` nietknięty (unit + e2e).
- **AC-4.7** Ochrona u źródła dla treści odpowiedzi: fixture zwraca 401 z `{"error":"expired","access_token":"eyJ…"}`
  i nagłówkiem `Bearer …` w treści → wartości tokenów nie występują w paczce (grep = 0), na ich miejscu
  `"[redacted:<reguła>]"` (reguły `jwt`, `bearer`, klucze z listy `privacy-redaction`; E3 rozszerza) (unit + e2e).
- **AC-4.8** (E2-T7) Stos `runtimeErrors[].stack` i `consoleLogs[].stack` jest identyczny z `error.stack` / stosem wywołania
  dla stosów ≤ 16 000 znaków (fixture: 10 ramek z URL-ami po 300 znaków); `console.error(err)` z obiektem `Error` ma w `args`
  `name`, `message`, pełny `stack` i łańcuch `cause` do 5 poziomów (unit).
- **AC-4.9** Rozszerzenie nadal nie wysyła żadnych zapytań i nie modyfikuje zapytań strony (grep `dist/*` jak E0 AC-ST.2;
  e2e: nagłówki zapytań widziane przez serwer fixture identyczne z nagraniem i bez).

### US-5 (Developer) Jako developer chcę metryki CWV z atrybucją i długie zadania, żeby wiedzieć, co było wolne i przez co
- **AC-5.1** Chromium: fixture `slow-lcp.html` (obraz hero opóźniony o 1500 ms) i `cls.html` (baner wstawiony po 500 ms)
  → `vitals` bieżącego dokumentu ma `TTFB`, `FCP`, `LCP`, `CLS` z `value` i `rating` ∈ {`good`,
  `needs-improvement`, `poor`} wg progów skilla `cwv-capture`; `LCP.value` ≥ 1500; `CLS.value` > 0,1 (e2e — E2-TEST2).
- **AC-5.2** Atrybucja: `LCP` ma selektor elementu i `url` obrazu; `CLS` ma ≥ 1 źródło z selektorem przesuniętego elementu
  i wartością przesunięcia; `INP` (po kliknięciu w fixture z 300 ms pracy w handlerze) ma selektor celu, typ zdarzenia
  i fazy `inputDelay`/`processing`/`presentation`, `value` ≥ 300 (e2e Chromium).
- **AC-5.3** Długie zadania: fixture blokuje wątek na 200 ms w nazwanej funkcji skryptu `heavy.js` → paczka ma wpis long
  task z `t`, czasem trwania i URL-em skryptu `heavy.js`; maks. 20 najdłuższych (e2e Chromium ≥ 123).
- **AC-5.4** Firefox (≥ 128): `TTFB`, `FCP`, `LCP` obecne; `CLS` i long tasks mają `available: false`
  i `reason: "unsupported-browser"` — nie `0`, nie brak klucza (QA ręczne + unit z atrapą bez typów wpisów). Analogicznie
  long tasks w Chrome 121–122 (unit). **Korekta wg PB-3 (Docs, po QA F-4):** `INP` w Firefoksie ma prawdziwą wartość (FF 158
  udostępnia `interactionId`; dostępność ustala wykrywanie funkcji) — to jest PASS; `INP` ma `available: false`
  (`unsupported-browser`) tylko w przeglądarce bez wpisów `event` z `interactionId`. Sprawdzone na Firefoksie 158; 128–157 nie.
- **AC-5.5** Brak interakcji po starcie nagrania → `INP` ma `available: false`, `reason: "no-interaction"` (unit).
- **AC-5.6** Wartości zebrane, gdy strona była widoczna w chwili zapisu, mają `finalized: false` i notatkę w `notes`,
  że LCP/CLS/INP mogły jeszcze rosnąć; karta w tle od startu dokumentu → `reason: "hidden-at-start"` dla LCP/FCP (unit).
- **AC-5.7** Metryki są per dokument: po przeładowaniu w nagraniu paczka ma metryki obu dokumentów (o ile dokument został
  zrzucony, `documents[].flushed`), każdy z `t` względem swojego `timeOrigin` (e2e).
- **AC-5.8** Fallback konsolowy: paczka `source: "console"` ma `vitals` z danymi buforowanymi przeglądarki; `INP` tylko dla
  interakcji po wklejeniu, z notatką (unit).

### US-6 (Developer) Jako developer chcę zrzut ekranu z chwili zapisu, żeby zobaczyć to, co widział zgłaszający
- **AC-6.1** Po *Zapisz paczkę* paczka ma `screenshots[]` z ≥ 1 wpisem: `t`, `doc`, `reason: "save"`, typ JPEG, wymiary
  i rozmiar w bajtach; obraz dekoduje się do JPEG o wymiarach widocznej części karty (e2e: dekodowanie, wymiary ±1 px
  względem `innerWidth×innerHeight × devicePixelRatio`).
- **AC-6.2** Zrzut nie zawiera popupu rozszerzenia ani innych kart (e2e: kolor tła fixture w 4 rogach obrazu).
- **AC-6.3** Prywatność: gdy w chwili zapisu karta pokazuje stronę spoza origin nagrania (stan `otherOrigin`) albo stronę
  specjalną, zrzutu brak, a `notes` mówi dlaczego (e2e 127.0.0.1 → localhost). Pola `password` są w zrzucie zamaskowane
  przez przeglądarkę — bez dodatkowej obróbki (QA wizualne).
- **AC-6.4** Niepowodzenie zrzutu (odmowa API, limit wywołań, karta niewidoczna) → paczka zapisana, `screenshots: []`
  i notatka z powodem; popup pokazuje zwykłe *Zapisano* (unit z atrapą rzucającą).
- **AC-6.5** Rozmiar zrzutu ≤ `limits.screenshotBytes` (domyślnie 300 KB); większy — ponowna kompresja albo
  zmniejszenie, nigdy obcięty plik (unit na fixture 4K).
- **AC-6.6** Chrome i Firefox: zrzut działa w obu (e2e Chromium; QA ręczne Firefox z wymiarami w raporcie).

### US-7 (Developer/agent AI) Jako developer chcę przewidywalnej struktury paczki z jasnym podziałem pól wymaganych i opcjonalnych, żeby w ≤ 60 s znaleźć odpowiedź bez przewijania HTML
- **AC-7.1** (E2-S1) Pola **wymagane** — zawsze obecne (mogą być `null`/puste, wtedy z wpisem w `notes`): nagłówek v2
  (`schemaVersion`…`notes`), `steps`, `vitals`, `screenshots`, `consoleLogs`, `runtimeErrors`, `network`, `environment`,
  `performance`, `storage`, `dom`. **Opcjonalne** — tylko gdy jest dana: `stack`, `responseBodyPreview`,
  `statusUnavailable`, atrybucja metryk, `text`/`valueLength`/`key` w krokach. Walidator schematu w testach odrzuca
  paczkę bez pola wymaganego (unit na fixture + e2e na prawdziwej paczce).
- **AC-7.2** Kolejność kluczy w zapisanym JSON (czytanie od góry): nagłówek → `documents` → `notes` → `steps` →
  `runtimeErrors` → `network` → `vitals` → `screenshots` → `consoleLogs` → `environment` → `performance` → `storage` →
  `dom` (ostatni, z `outerHTML`) (unit na `Object.keys` po `JSON.parse`). Treść zrzutu nie poprzedza żadnej sekcji tekstowej.
  **Dopisek (PB-2):** po `dom` następuje jeszcze `attachments` (dane binarne zrzutu w base64), a `overview` otwiera plik
  zaraz po nagłówku; `dom` jest ostatnią sekcją *tekstową*. Kolejność w kodzie: nagłówek → `overview` → `limits` → `truncated` →
  `documents` → `notes` → `steps` → … → `dom` → `attachments`.
- **AC-7.3** Scenariusz „60 s”: QA otwiera paczkę z `E2-Q1` w edytorze tekstu bez jq i odpowiada z czasem: ostatni krok przed
  pierwszym błędem, pierwsze zapytanie ≥ 400, metryka z `rating: "poor"`, obraz ekranu — każde ≤ 60 s (QA ręczne, czasy w raporcie).
- **AC-7.4** `schemaVersion` zgodny z decyzją (pyt. 5); `docs/snapshot-schema.md` ma sekcję nowej wersji i tabelę migracji;
  fixture `tests/fixtures/snapshots/v3.json` (lub zaktualizowany v2) przechodzi walidator z AC-7.1 (unit).
- **AC-7.5** Paczka z fallbacku konsolowego ma te same klucze wymagane; sekcje niedostępne bez rozszerzenia (`screenshots`,
  statusy zasobów spoza Resource Timing) są puste z notatką (unit).

## Wymagania niefunkcjonalne
- **Rozmiar rozszerzenia:** każdy `dist/*` < 500 KB (dziś 154 KB); zależności zewnętrzne tylko lokalnie w paczce (bez CDN).
- **Wydajność:** narzut hooków `fetch`/XHR z odczytem treści ≤ 2 ms p95 (jak E1), krok ≤ 0,5 ms p95 (AC-3.7),
  obserwatory wydajności bez wpływu na `LCP` fixture > 50 ms (e2e z i bez nagrywania, mediana z 5).
- **Rozmiar paczki:** `basic.html` + zrzut ≤ 1 MB; fixture „flood” z E1 + 2000 kroków + 100 błędnych odpowiedzi ≤ 12 MB,
  zapis ≤ 5 s; łączny budżet treści odpowiedzi ≤ 256 KB (domyślnie, pyt. 3).
- **Prywatność:** nowe kategorie (kroki, treść odpowiedzi, zrzut) objęte ujawnieniem (AC-1.1) i ochroną u źródła
  (AC-3.4, AC-4.7, AC-6.3); dane spoza origin nagrania nie trafiają do paczki (regresja E1 AC-3.3/3.4 + kroki/zrzut);
  nic nie trafia do `storage.local`/IndexedDB poza stanem w `storage.session`; `data_collection_permissions: none`
  i deklaracja CWS „no transfer” pozostają prawdziwe. Pozostałe jawne dane (cookies, storage, nagłówki) — bez zmian do E3.
- **Uprawnienia:** każde nowe uprawnienie z uzasadnieniem PL/EN w README (test E0 AC-ST.3); brak `<all_urls>`, `tabs`,
  `cookies`; aktualizacja nie może wyłączyć rozszerzenia u zgłaszającego bez jego wiedzy (pyt. 4).
- **Przeglądarki:** Chrome ≥ 121, Firefox ≥ 128; brak funkcji API = jawne `available: false` + `reason`, nigdy wyjątek
  ani puste pole. E2e tylko Chromium; Firefox: `web-ext lint` 0 errors + QA ręczne ≥ 8 scenariuszy (AC-3.1, 4.1, 4.3,
  5.4, 6.1, 6.3, 1.6, 2.2) raportowane osobno.
- **Testy:** `npm test` ≤ 30 s, e2e ≤ 7 min, stabilne 10/10 bez `retries`.

## Dane — zmiany w schemacie paczki
Nazwy pól robocze — ostateczny kształt ustala Design i `docs/snapshot-schema.md`.

| Pole | Zmiana |
|---|---|
| `schemaVersion` | `3` (rekomendacja, pyt. 5) |
| `steps[]` | nowe: `t`, `doc`, `type`, `selector?`, `text?`, `inputType?`, `valueLength?`, `key?`, `url?` (dla `navigate`) |
| `vitals` | nowe, per dokument: `TTFB`/`FCP`/`LCP`/`CLS`/`INP` → `value`, `rating`, atrybucja, `available`, `reason?`, `finalized`; `longTasks[]` |
| `screenshots[]` | nowe: `t`, `doc`, `reason`, `mime`, `width`, `height`, `bytes` + dane obrazu (pyt. 2) |
| `network[]` | `type` poszerzony o rodzaje zasobów (**zmiana semantyki**); nowe `sizeBytes`, `statusUnavailable?`, `responseBodyPreview?`, `responseBodyTruncated?` |
| `documents[]` | nowe: status HTTP dokumentu |
| `limits`, `truncated` | nowe klucze: `steps`, `screenshotBytes`, `responseBodyChars`, `responseBodyTotalChars` |
| `consoleLogs[].stack`, `runtimeErrors[].stack` | limit 4000 → 16 000 znaków; `cause` w serializacji `Error` |
| kolejność kluczy | jak AC-7.2 (nie zmienia typu pól) |
| `overview` | nowe, tylko liczniki — jeśli pyt. 6 = tak |

## Otwarte pytania do użytkownika
1. **Kiedy zrzut ekranu?** Rekomendacja: **tylko przy *Zapisz paczkę*** (AC-6.1). Zrzuty przy błędach łapią ekrany, których
   zgłaszający nie widział świadomie (prywatność), dokładają setki KB i mogą wymagać szerszych uprawnień po przeładowaniu.
   Wrócić po E3, jeśli developerzy zgłoszą potrzebę.
2. **Format zrzutu przed E3?** Rekomendacja: **JPEG (jakość ~60) osadzony w JSON** (≤ 300 KB), żeby zgłaszający dalej wysyłał
   jeden plik; E3-D2 przeniesie go do `screenshot.jpg` w zipie (`screenshots[].file`). Osobny plik teraz = dwa pobrania
   i dwa załączniki — sprzeczne z „jeden plik”.
3. **Treść odpowiedzi — zakres i limit?** Rekomendacja: **tylko status ≥ 400, typy tekstowe, ≤ 4 KB na odpowiedź, ≤ 256 KB
   łącznie**, z ochroną z AC-4.7; włączanie dla 2xx — wyłącznie konfiguracja developerska w E4-D4, nigdy w UI zgłaszającego.
4. **Nowe uprawnienie dla statusów zasobów (np. `webRequest`)?** Rekomendacja: **zgoda, jeśli architekt wykaże potrzebę**
   (AC-4.1–4.3 bez tego niespełnialne dla `<img>`/`<script>`), pod warunkiem, że store-reviewer potwierdzi brak nowego
   ostrzeżenia przy instalacji/aktualizacji w Chrome i Firefoksie (uprawnienie z ostrzeżeniem wyłącza rozszerzenie
   po aktualizacji do czasu akceptacji). **Bez** poszerzania host permissions — zasoby cross-origin dostają `statusUnavailable`.
5. **`schemaVersion: 3`?** Rekomendacja: **tak** — `network[].type` zmienia semantykę (wpisy zasobów obok fetch/XHR, inny
   zakres `limits.network`); konsumentów (E4) jeszcze nie ma, więc koszt migracji jest minimalny.
6. **Blok `overview` z licznikami na górze paczki** (błędy, zapytania ≥ 400, kroki, metryki `poor`, zrzut tak/nie)?
   Rekomendacja: **tak, tylko liczby** — skraca AC-7.3 bez czekania na `summary.md` (E4).
7. **Etykieta klikniętego elementu w krokach (`text`)?** Rekomendacja: **tak, ≤ 80 znaków, tylko przyciski/linki** (AC-3.5) —
   bez niej kroki są mało czytelne; ryzyko danych osobowych w etykietach (np. imię w menu) obejmie E3.
8. **Iframe'y same-origin (E2-D6)?** Rekomendacja: **w E2 tylko błędy i `console.error` z iframe'ów same-origin** z adresem
   ramki; kroki, sieć i metryki iframe'ów — poza E2 (osobne zadanie po QA E2, jeśli realne strony tego potrzebują).

### Odpowiedzi użytkownika (bramka Spec, 2026-10-23)
Wszystkie rekomendacje przyjęte:
1. Zrzut ekranu **tylko przy *Zapisz paczkę***.
2. **JPEG (~60) osadzony w JSON**, ≤ 300 KB; E3-D2 przeniesie do pliku w zipie.
3. Treść odpowiedzi: **tylko status ≥ 400, typy tekstowe, ≤ 4 KB na odpowiedź, ≤ 256 KB łącznie**, maskowanie tokenów przy zbieraniu.
4. `webRequest`: **zgoda warunkowa** — tylko jeśli architekt wykaże potrzebę i store-reviewer potwierdzi brak nowego ostrzeżenia
   przy instalacji/aktualizacji (Chrome i Firefox); **bez** poszerzania host permissions.
5. **`schemaVersion: 3`** — tak.
6. Blok **`overview`** z samymi licznikami — tak.
7. Etykieta kliknięcia **≤ 80 znaków, tylko przyciski/linki** — tak.
8. Iframe'y same-origin: **w E2 tylko błędy i `console.error`** z adresem ramki.

## Ryzyka
1. **Statusy zasobów cross-origin niedostępne** (większość zasobów portali to CDN) — paczka ma głównie `statusUnavailable`.
   Sygnał: w E2-Q1 na realnym portalu > 30% wpisów `network[]` bez statusu.
2. **Uprawnienie przy aktualizacji/store** — nowe uprawnienie wyłącza rozszerzenie u zgłaszających albo CWS/AMO pytają
   o uzasadnienie. Sygnał: po aktualizacji 0.3.0 → 0.4.0 w czystym profilu Chrome komunikat „wymaga nowych uprawnień”;
   uwaga store-reviewera.
3. **Odczyt treści odpowiedzi psuje stronę** (strumienie, duże odpowiedzi, pamięć). Sygnał: fixture SSE/duży JSON zachowuje
   się inaczej z nagrywaniem; wzrost pamięci karty > 50 MB w teście flood.
4. **Nowy kanał wycieku** (etykiety kliknięć, treść 4xx, zrzut). Sygnał: grep sekretów fixture z AC-3.4/4.7 > 0 lub reviewer
   E2-R1 znajduje dane logowania w nowym polu.
5. **Rozjazd Firefoksa** (inne Performance API, zachowanie zrzutu) wychodzi dopiero w QA. Sygnał: którykolwiek scenariusz
   Firefox z NFR „Przeglądarki” FAIL lub pole bez `available`/`reason` w paczce z Firefoksa.
