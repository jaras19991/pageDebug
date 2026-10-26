# Schemat paczki snapshotu

Źródło prawdy o strukturze paczki: od v4 zip `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` z `snapshot.json`, `summary.md`
i opcjonalnym `screenshot.jpg`; do v3 jeden plik `page-debug-snapshot-<timestamp>.json`. Reguły wersjonowania: skill `snapshot-schema`.
Aktualna wersja: **4** (od E3). Paczkę v4 składa `assemblePackage` z `src/lib/package.js`, a redaguje, przycina do budżetu
i pakuje `exportPackage` z `src/lib/export.js` (tło rozszerzenia i fallback konsolowy). Rozpoznawanie przy odczycie: plik
zaczyna się od `PK` (zip) → `snapshot.json` w środku; jest `schemaVersion` → ta wersja; brak `schemaVersion` i `version: "1.0.0"` →
wersja 1 (tabele migracji na końcu). Przykłady (dane syntetyczne): `tests/fixtures/snapshots/v4.json` (aktualny),
`v3.json` i `v2.json` (do testów migracji). Zgodność z v4 sprawdza walidator `tests/helpers/snapshot-validator.js`
(`validateSnapshot(pkg) → { ok, errors }` dla `snapshot.json`, `validateZipEntries(names, pkg?)` dla wpisów zipa), wspólny
dla testów unit i e2e.

## Wersja 1 (baseline, rozszerzenie 1.0.0, E0)

Paczkę v1 generował `src/page/page-debug-snapshot.js` (metoda `snapshot()`); plik nie ma pola `schemaVersion`.

Pełna redakcja danych wrażliwych **nie istnieje** do E3: kolumny „redagowane” poniżej to „nie”, poza wyjątkiem
opisanym przy `dom.forms` i `dom.html` (wartości pól typu `password` i `hidden` są podmieniane na `"[redacted]"`; w `dom.html.outerHTML`
wartości pól `password`/`hidden` są też zastępowane `[redacted]` od E1, a reszta HTML pozostaje jawna do E3). Czasy w rekordach to ciągi ISO (`timestamp`, `startedAt`) — do zmiany w E1.

### Klucze najwyższego poziomu

| Ścieżka | Typ | Opis | Od kiedy | Redagowane |
|---|---|---|---|---|
| `version` | string | wersja formatu paczki, `"1.0.0"` | v1 | nie |
| `collectedAt` | string (ISO) | chwila wykonania zrzutu | v1 | nie |
| `initializedAt` | string (ISO) | chwila wstrzyknięcia skryptu na stronę; zbieranie logów zaczyna się wtedy | v1 | nie |
| `notes` | string[] | ograniczenia zbierania (np. „captured only from initialization time”) | v1 | nie |
| `environment` | object | `timestamp`, `location` (pełny adres z `search` i `hash`), `document` (tytuł, referrer, stan), `navigator` (userAgent, język, platforma…), `screen`, `viewport` | v1 | nie |
| `dom` | object | `counts`, `html` (`doctype`, `lang`, `charset`, `outerHTML` do 2 000 000 znaków), `meta`, `canonical`, `hreflangs`, `scripts`, `stylesheets`, `images`, `iframes`, `forms`, `rootMarkers` | v1 | częściowo: `dom.forms[].elements[].value` oraz wartości pól `password`/`hidden` w `outerHTML` = `"[redacted]"`; reszta HTML jawna do E3 |
| `performance` | object | `timeOrigin`, `navigation` (czasy nawigacji lub `null`), `resources[]` (zasoby załadowane do chwili zrzutu) | v1 | nie |
| `storage` | object | `cookies` (string z `document.cookie`), `localStorage`, `sessionStorage` (obiekty klucz → wartość, wartość do 5000 znaków) | v1 | nie |
| `consoleLogs` | object[] | wpisy konsoli od `initializedAt`: `timestamp`, `level` (`log`/`info`/`warn`/`error`/`debug`), `args` | v1 | nie |
| `runtimeErrors` | object[] | `timestamp`, `type` (`error`/`unhandledrejection`), `message`, `filename`, `lineno`, `colno`, `error` albo `reason` | v1 | nie |
| `network` | object[] | zapytania `fetch`/XHR od `initializedAt`: `type`, `startedAt`, `url`, `status`, `ok`, `durationMs`, nagłówki, `error` | v1 | nie |

Tablice `consoleLogs`, `runtimeErrors`, `network` mają limit `maxItems` = 5000 (najstarsze wpisy są usuwane); w v1 paczka
nie informuje o obcięciu. Tekst dłuższy niż limit kończy się sufiksem `... [truncated N chars]`.

### Przykład (zredagowany, dane syntetyczne)

```json
{
  "version": "1.0.0",
  "collectedAt": "2026-01-15T10:00:05.000Z",
  "initializedAt": "2026-01-15T10:00:04.990Z",
  "notes": ["Console logs are captured only from initialization time."],
  "environment": {
    "location": { "href": "http://127.0.0.1:8080/basic.html", "hostname": "127.0.0.1", "pathname": "/basic.html" },
    "document": { "title": "Basic fixture", "readyState": "complete" }
  },
  "dom": { "counts": { "totalElements": 12, "forms": 1 }, "html": { "outerHTML": "<html>…</html>" } },
  "performance": { "timeOrigin": 1768471200000, "navigation": { "type": "navigate" }, "resources": [] },
  "storage": { "cookies": "sid=EXAMPLE", "localStorage": { "theme": "dark" }, "sessionStorage": {} },
  "consoleLogs": [{ "timestamp": "2026-01-15T10:00:04.995Z", "level": "info", "args": ["PageDebugSnapshot initialized."] }],
  "runtimeErrors": [],
  "network": []
}
```

W v1 nic z powyższego nie jest maskowane — `storage.cookies` i wartości storage są jawne (maskowanie to E3).

## Wersja 2 (E1, rozszerzenie 0.3.0)

Zmiana łamiąca względem v1: czasy w rekordach to liczby względem `timeOrigin` dokumentu, a paczka obejmuje wszystkie
dokumenty nagrane w karcie (przeładowania w obrębie origin). Redakcja danych wrażliwych nadal **nie istnieje** (E3), poza
wyjątkiem z v1 dla `dom.forms`. Sekcje `environment`, `dom`, `performance`, `storage` mają tę samą treść co w v1.

### Klucze najwyższego poziomu

| Ścieżka | Typ | Opis | Od kiedy | Redagowane |
|---|---|---|---|---|
| `schemaVersion` | integer | `2` | v2 | nie |
| `extensionVersion` | string | wersja rozszerzenia z manifestu; w trybie `console` wersja recordera | v2 | nie |
| `source` | `"extension"` \| `"console"` | rozszerzenie albo skrypt wklejony do konsoli (`console-snapshot.js`) | v2 | nie |
| `collectedAt` | string (ISO) | chwila złożenia paczki | v1 | nie |
| `recordingStartedAt` | string (ISO) | klik *Nagrywaj* (extension) albo wklejenie skryptu (console) | v2 | nie |
| `recordingStoppedReason` | `"time-limit"` \| `null` | `"time-limit"`, gdy nagranie zatrzymało się samo po 10 min; wtedy w paczce nie ma wpisów z chwili ≥ limitu | v2 | nie |
| `timeOrigin` | number \| null | `performance.timeOrigin` bieżącego (ostatniego) dokumentu, ms od epoki; `null` tylko gdy żaden dokument nie ma danych | v2 | nie |
| `documents` | object[] | dokumenty nagrane w karcie, w kolejności otwarcia; indeks w tablicy = `doc` w rekordach | v2 | nie |
| `limits` | object | `consoleLogs` (5000), `runtimeErrors` (1000), `network` (5000) — maks. liczba wpisów w paczce; `entryChars` (10000) — limit znaków serializowanego argumentu/powodu | v2 | nie |
| `truncated` | object | `consoleLogs`, `runtimeErrors`, `network`: `true`, gdy brakuje jakichkolwiek wpisów tej kategorii (bufor dokumentu, budżet zrzutu, limit paczki, odrzucony dokument) | v2 | nie |
| `notes` | string[] | po angielsku: zakres nagrania, pominięte dokumenty z liczbami wpisów, dokumenty nienagrane (błąd mostu), dokumenty bez zrzutu, brak danych bieżącej strony (z powodem, patrz niżej), sekcje, których nie udało się zebrać, auto-stop, obcięcia | v1 | nie |
| `environment`, `dom`, `performance`, `storage` | object \| null | jak w v1, z bieżącego dokumentu; `null` + wpis w `notes`, gdy bieżąca strona nie odpowiedziała, opuściła origin nagrania albo sekcja się nie zebrała | v1 | jak v1 |
| `consoleLogs` | object[] | `t`, `doc`, `level` (`log`/`info`/`warn`/`error`/`debug`), `args` (stringi JSON lub `{ truncated: true, preview }`), `stack?` (wywołanie na stronie, ≤ 4000 znaków; brak przy `Error.stackTraceLimit = 0`) | v1 (kształt v2) | nie |
| `runtimeErrors` | object[] | `t`, `doc`, `type`: `error` → `message`, `filename`, `lineno`, `colno`, `stack`; `unhandledrejection` → `message`, `stack`, `reason?` | v1 (kształt v2) | nie |
| `network` | object[] | `t` (start zapytania), `doc`, `type` (`fetch`/`xhr`), `method`, `url` (absolutny), `status`, `statusText`, `ok`, `redirected`, `durationMs`, `requestHeaders`, `responseHeaders`, `requestBody` (podgląd ≤ 5000 znaków lub `"[FormData]"` itp.), `error` (`null` lub opis; XHR: `error`/`abort`/`timeout`) | v1 (kształt v2) | nie |

### `documents[]`

| Pole | Typ | Opis |
|---|---|---|
| `id` | integer | indeks w tablicy = wartość `doc` w rekordach |
| `url` | string \| null | adres dokumentu |
| `timeOrigin` | number \| null | `performance.timeOrigin` tego dokumentu; `null`, gdy jego dane nie dotarły |
| `navigationType` | string \| null | `navigate` / `reload` / `back_forward` / `prerender` |
| `recorded` | boolean | `true` — dokument był nagrywany. `false`, gdy recorder nie nagrywał go: most nie połączył się ze stroną (błąd kanału, np. `unbound`) albo tło oznaczyło go jako nienagrywany. Liczniki są wtedy zerowe, a `notes` ma wpis „was not recorded”. Powód techniczny nie jest polem paczki — trafia tylko do `notes` |
| `flushed` | boolean | `false` — zrzut przy opuszczaniu strony nie dotarł (np. crash karty); wpisów brak, jest notatka |
| `current` | boolean | bieżący dokument w chwili zapisu (najwyżej jeden, zawsze ostatni) |
| `counts` | object | ile wpisów każdej kategorii zebrano w dokumencie (także usuniętych później) |
| `kept` | object | ile z nich trafiło do paczki |

### Notatki o braku danych bieżącej strony

Gdy `environment`, `dom`, `performance` i `storage` są `null`, `notes` zawiera jedną z dwóch notatek:

- „The current page was not available: page was loaded after the recording stopped (time limit); package contains documents recorded before the limit. …” — nagranie zatrzymał limit 10 min, a karta załadowała się później (nie ma w niej recordera); w paczce są dokumenty nagrane przed limitem. Tło wie o tym z własnego stanu (`meta.currentMissingReason: "loadedAfterStop"` przekazywane do `assemblePackage`; to wejście funkcji, **nie pole paczki**);
- „The current page was not available (it left the recorded origin or did not answer); …” — pozostałe przypadki.

Sekcja, której nie udało się zebrać na stronie, daje notatkę „Section <nazwa> could not be collected (<błąd>)”.

### Czas, dokumenty i limity

- `t` to milisekundy od `documents[doc].timeOrigin` **swojego** dokumentu. Czas bezwzględny wpisu:
  `documents[r.doc].timeOrigin + r.t`. Wartości `t` z różnych dokumentów nie są porównywalne bez tego przeliczenia.
- Kolejność rekordów: dokumenty rosnąco, w obrębie dokumentu po `t`.
- Dane wcześniejszych dokumentów karty pochodzą z jednorazowego zrzutu przy opuszczaniu strony. Budżet: ≤ 3 MB na
  dokument (dłuższy traci najstarsze wpisy) i ≤ 8 MB razem — najstarsze dokumenty ponad budżet zostają w `documents[]`
  tylko z `counts` (`kept` = 0), a `notes` podaje, ile wpisów pominięto.
- `limits.*` dotyczą całej paczki: przy przekroczeniu zostają **najnowsze** wpisy, `truncated.<kategoria>` = `true`
  i jest notatka. Bez przekroczenia i bez strat w dokumentach `truncated.*` = `false`.

### Przykład

Pełny przykład z dwoma dokumentami: `tests/fixtures/snapshots/v2.json`. Skrót:

```json
{
  "schemaVersion": 2,
  "extensionVersion": "0.3.0",
  "source": "extension",
  "collectedAt": "2026-01-15T10:01:05.000Z",
  "recordingStartedAt": "2026-01-15T10:00:00.000Z",
  "recordingStoppedReason": null,
  "timeOrigin": 1768471204200.25,
  "documents": [
    { "id": 0, "url": "http://127.0.0.1:8080/form.html", "timeOrigin": 1768471200120.5, "navigationType": "reload",
      "recorded": true, "flushed": true, "current": false,
      "counts": { "consoleLogs": 1, "runtimeErrors": 0, "network": 0 }, "kept": { "consoleLogs": 1, "runtimeErrors": 0, "network": 0 } },
    { "id": 1, "url": "http://127.0.0.1:8080/result.html", "timeOrigin": 1768471204200.25, "navigationType": "navigate",
      "recorded": true, "flushed": true, "current": true,
      "counts": { "consoleLogs": 1, "runtimeErrors": 2, "network": 1 }, "kept": { "consoleLogs": 1, "runtimeErrors": 2, "network": 1 } }
  ],
  "limits": { "consoleLogs": 5000, "runtimeErrors": 1000, "network": 5000, "entryChars": 10000 },
  "truncated": { "consoleLogs": false, "runtimeErrors": false, "network": false },
  "notes": ["Recording started at 2026-01-15T10:00:00.000Z (page reloaded); earlier data is not included."],
  "environment": {}, "dom": {}, "performance": {}, "storage": {},
  "consoleLogs": [{ "t": 15.2, "doc": 1, "level": "error", "args": ["\"save failed\""],
                    "stack": "at onSave (http://127.0.0.1:8080/result.js:12:9)" }],
  "runtimeErrors": [{ "t": 8.7, "doc": 1, "type": "error", "message": "Uncaught TypeError: x is undefined",
                      "filename": "http://127.0.0.1:8080/result.html", "lineno": 3, "colno": 9, "stack": "TypeError: …" }],
  "network": [{ "t": 12.5, "doc": 1, "type": "fetch", "method": "POST", "url": "http://127.0.0.1:8080/api/fail",
                "status": 500, "statusText": "Internal Server Error", "ok": false, "redirected": false, "durationMs": 3.21,
                "requestHeaders": {}, "responseHeaders": {}, "requestBody": "{\"name\":\"Example\"}", "error": null }]
}
```

(`environment`, `dom`, `performance`, `storage` skrócone — treść jak w v1.)

## Wersja 3 (E2, rozszerzenie 0.4.0)

Zmiana łamiąca względem v2: `network[]` obejmuje teraz także zasoby strony (`img`, `script`, `css`, `font`, `other`), więc
zmienia się znaczenie `network[].type` i `limits.network`. Do tego dochodzi nowa kolejność kluczy (rekordy przed sekcjami strony)
i nowe sekcje wymagane: `overview`, `steps`, `vitals`, `screenshots`, `attachments`. Redakcja danych wrażliwych nadal **nie istnieje**
(E3) poza wyjątkami z v1/v2 (`dom.forms`, `password`/`hidden` w `outerHTML`). E2 dodaje ochronę u źródła tylko dla nowych danych:
kroki nie mają wartości pól, podglądy odpowiedzi mają zamaskowane tokeny (`"[redacted:<reguła>]"`), zrzut powstaje tylko na
origin nagrania.

### Co developer czyta najpierw

Plik czyta się od góry. Kolejność kluczy jest stała (test `Object.keys` i walidator):

1. `overview` — same liczby: błędy JS, błędy konsoli, nieudane zapytania (status ≥ 400 albo `error`), kroki, metryki `poor`, czy jest zrzut.
2. `notes` — czego w paczce brakuje i dlaczego (obcięcia, dokumenty bez danych, brak zrzutu, metryki nie-finalne, brak statusów).
3. `steps` → `runtimeErrors` → `network` — co zgłaszający zrobił, co się zepsuło, które zapytanie odpowiedziało błędem.
   Ostatni krok przed błędem: porównaj `t` w obrębie tego samego `doc`.
4. `vitals` (szukaj `"rating": "poor"`), `screenshots` (metadane zrzutu), `consoleLogs`.
5. Sekcje strony `environment`, `performance`, `storage` i na końcu `dom` z dużym `outerHTML`.
6. `attachments` — wyłącznie dane binarne (obraz w base64), zawsze ostatni, żeby nie zasłaniał tekstu w edytorze.

### Klucze najwyższego poziomu (w kolejności w pliku)

Wszystkie klucze tej tabeli są **wymagane**: występują zawsze, także w fallbacku konsolowym. Gdy danych nie ma, wartość to `null`
albo pusta tablica/obiekt, a `notes` mówi dlaczego (dla `steps`, `vitals`, `screenshots` i sekcji strony `null`). Puste
`consoleLogs`, `runtimeErrors`, `network` notatki nie wymagają (nic się nie wydarzyło).

| # | Ścieżka | Typ | Opis | Od kiedy |
|---|---|---|---|---|
| 1 | `schemaVersion` | integer | `3` | v2 (wartość v3) |
| 2 | `extensionVersion` | string | wersja rozszerzenia z manifestu; w trybie `console` wersja recordera | v2 |
| 3 | `source` | `"extension"` \| `"console"` | rozszerzenie albo skrypt wklejony do konsoli | v2 |
| 4 | `collectedAt` | string (ISO) | chwila złożenia paczki | v1 |
| 5 | `recordingStartedAt` | string (ISO) | klik *Nagrywaj* albo wklejenie skryptu | v2 |
| 6 | `recordingStoppedReason` | `"time-limit"` \| `null` | jak v2 | v2 |
| 7 | `timeOrigin` | number \| null | `performance.timeOrigin` bieżącego (ostatniego) dokumentu | v2 |
| 8 | `overview` | object | `runtimeErrors`, `consoleErrors` (`consoleLogs` z `level: "error"`), `failedRequests` (`network`: `status` ≥ 400 lub `error` ≠ `null`), `steps`, `poorVitals` (metryki z `rating: "poor"` we wszystkich dokumentach) — liczby całkowite; `screenshot` — boolean. Liczone z tego, co jest **w paczce** (po limitach), nie z `counts` | v3 |
| 9 | `limits` | object | `consoleLogs` 5000, `runtimeErrors` 1000, `network` 5000 (fetch + XHR + zasoby), `steps` 2000, `entryChars` 40 000, `stackChars` 16 000, `responseBodyChars` 4096, `responseBodyTotalChars` 262 144, `screenshotBytes` 307 200, `longTasks` 20 | v2 (rozszerzone) |
| 10 | `truncated` | object | `consoleLogs`, `runtimeErrors`, `network`, `steps`: `true`, gdy brakuje wpisów tej kategorii; `responseBodies`: `true`, gdy część podglądów treści usunięto przez budżet | v2 (rozszerzone) |
| 11 | `documents` | object[] | dokumenty nagrane w karcie, w kolejności otwarcia; indeks = `doc` w rekordach (tabela niżej) | v2 |
| 12 | `notes` | string[] | po angielsku; jak v2 + brak kroków, brak metryk, metryki nie-finalne, statusy niedostępne w przeglądarce, brak zrzutu z powodem, usunięte podglądy treści | v1 |
| 13 | `steps` | object[] | kroki zgłaszającego (tabela niżej) | v3 |
| 14 | `runtimeErrors` | object[] | jak v2; `stack` ≤ 16 000 znaków; `frame?` — adres iframe'u, z którego przyszedł błąd | v1 (kształt v2) |
| 15 | `network` | object[] | zapytania fetch/XHR i zasoby strony (tabela niżej) | v1 (kształt v3) |
| 16 | `vitals` | object[] | metryki strony, jeden wpis na dokument z danymi (tabela niżej) | v3 |
| 17 | `screenshots` | object[] | metadane zrzutów ekranu (tabela niżej); `[]`, gdy zrzutu nie ma | v3 |
| 18 | `consoleLogs` | object[] | jak v2; `stack` ≤ 16 000 znaków; `Error` w `args` ma `name`, `message`, `stack`, `cause` (do 5 poziomów); `frame?` | v1 (kształt v2) |
| 19 | `environment` | object \| null | jak v1, z bieżącego dokumentu | v1 |
| 20 | `performance` | object \| null | jak v1 | v1 |
| 21 | `storage` | object \| null | jak v1 (wartości jawne do E3) | v1 |
| 22 | `dom` | object \| null | jak v1/v2; ostatnia sekcja tekstowa | v1 |
| 23 | `attachments` | object | `{ "<id>": "data:image/jpeg;base64,…" }`; `{}`, gdy zrzutu nie ma. Tylko dane binarne | v3 |

### Pola opcjonalne (tylko gdy jest dana)

`consoleLogs[].stack`, `runtimeErrors[].stack`, `consoleLogs[].frame`, `runtimeErrors[].frame`, `runtimeErrors[].reason`,
`network[].statusUnavailable`, `network[].responseBodyPreview` + `network[].responseBodyTruncated` (zawsze razem), `network[].initiatorType`,
`documents[].statusUnavailable`, atrybucja metryk (`selector`, `url`, `sources`, `eventType`, `inputDelay`, `processing`, `presentation`,
`interactions`), `steps[].selector|text|inputType|valueLength|checked|key|url|via`, `screenshots[].attachment`.
Brak pola opcjonalnego znaczy „nie było danej”, nie błąd.

Sekcja strony (`environment`, `dom`, `performance`, `storage`), która jest `null`, a nie ma wpisu o błędzie zbierania, dostaje notatkę
„Section <nazwa> was not received from the page.” — `null` w paczce zawsze ma wyjaśnienie w `notes`.

### `documents[]`

Jak w v2 (`id`, `url`, `timeOrigin`, `navigationType`, `recorded`, `flushed`, `current`, `counts`, `kept`), plus:

| Pole | Typ | Opis |
|---|---|---|
| `status` | integer \| null | status HTTP dokumentu z Navigation Timing (`responseStatus`), np. `200`, `404`, `500` |
| `statusUnavailable` | string, opcjonalne | tylko przy `status: null`: `unsupported-browser` (brak API), `unknown` (brak danych, np. dokument bez zrzutu) |
| `counts`, `kept` | object | jak v2, plus klucz `steps` |

### `steps[]`

`t` (ms od `documents[doc].timeOrigin`), `doc`, `type` ∈ {`click`, `input`, `change`, `submit`, `navigate`, `key`}.

| Pole | Kiedy | Opis |
|---|---|---|
| `selector` | wszystkie poza `navigate` (gdy da się wyznaczyć) | selektor CSS jednoznaczny w dokumencie: `#id` > `[data-testid]`/`data-*` > ścieżka; ≤ 1000 znaków |
| `text` | `click` w przycisk, link, `role=button` | widoczna etykieta ≤ 80 znaków; dla pól formularza brak |
| `inputType` | `input`, `change` | typ pola (`email`, `password`, `checkbox`, `textarea`, `select`, `contenteditable`…) |
| `valueLength` | `input`, `change` (nie dla `password`, `checkbox`, `radio`) | długość wartości; **bez** `valueLength` przy `password` (nie zdradzamy długości hasła) i przy checkboxie/radiu (wartość to stały token, zmianę niesie `checked`). **Wartości pól nigdy nie trafiają do kroków** |
| `checked` | `change` checkboxa/radia | boolean |
| `key` | `key` | tylko `Enter`, `Escape`, `Tab`, strzałki; nigdy znaki |
| `url`, `via` | `navigate` | adres (przepuszczony przez maskowanie tokenów, np. `?token=[redacted:…]`) i sposób (`navigate`, `reload`, `back_forward`, `pushState`, `replaceState`, `popstate`, `hashchange`) |

Kolejne wpisywanie w to samo pole to jeden krok `input` z ostatnią długością. Kolejne wywołania `history.replaceState` (np. strona
przepisująca `?q=` przy każdym znaku) to jeden krok `navigate` z ostatnim adresem i `t`; nie przerywa to scalania kroków `input`.

### `network[]`

Jak w v2 (`t`, `doc`, `method`, `url`, `status`, `statusText`, `ok`, `redirected`, `durationMs`, `requestHeaders`, `responseHeaders`,
`requestBody`, `error`), plus:

| Pole | Typ | Opis |
|---|---|---|
| `type` | `fetch` \| `xhr` \| `img` \| `script` \| `css` \| `font` \| `other` | **zmiana semantyki**: zasoby z Resource Timing są osobnymi wpisami; rodzaj z rozszerzenia pliku i `initiatorType` |
| `status` | integer \| null | status HTTP. `null` zawsze z `statusUnavailable` (zasoby) albo z `error` (nieudany fetch). XHR zakończony błędem ma `status: 0` i `error` (`error`/`abort`/`timeout`). Samo `0` bez wyjaśnienia jest niezgodne ze schematem: `fetch` w trybie `no-cors` (odpowiedź *opaque*) to `status: null` + `cross-origin`, a każde inne nieuzasadnione `0` z `fetch`/XHR (bez `error`) to `status: null` + `unknown` |
| `statusUnavailable` | string, opcjonalne | `cross-origin` (zasób z innego originu, przeglądarka ukrywa status), `unsupported-browser`, `network-error` (zasób nie doszedł), `unknown` |
| `sizeBytes` | integer \| null | bajty treści z sieci (`encodedBodySize`, przed dekompresją); `null`, gdy nieznane (cross-origin bez `Timing-Allow-Origin`) |
| `initiatorType` | string, opcjonalne | surowy `initiatorType` zasobu |
| `responseBodyPreview` | string, opcjonalne | tylko fetch/XHR ze statusem ≥ 400 i typem tekstowym (`text/*`, JSON, XML); ≤ 4096 znaków; tokeny (JWT, Bearer, klucze wrażliwe) zastąpione `"[redacted:<reguła>]"` |
| `responseBodyTruncated` | boolean, opcjonalne | `true`, gdy podgląd obcięto do limitu |

Podglądy łącznie ≤ 262 144 znaków. Budżet liczony jest na bieżąco na stronie i ponownie przy składaniu paczki; ponad budżet
**zostają najnowsze** podglądy, najstarsze tracą oba pola (`responseBodyPreview`, `responseBodyTruncated`), a wpis `network` zostaje.
`truncated.responseBodies` = `true` zawsze towarzyszy notatka „Older response previews were removed to fit the total limit of …”.
Podgląd powstaje dopiero po odczycie treści odpowiedzi (do 2 s): jeśli w tym czasie strona została opuszczona (`pagehide`) albo
nagranie się zakończyło, podgląd tego zapytania nie trafia do paczki (wpis `network` jest, bez podglądu).

### `vitals[]`

Jeden wpis na dokument z danymi (zrzucony albo bieżący): `{ doc, TTFB, FCP, LCP, CLS, INP, longTasks }`. Każda metryka jest zawsze
obecna, w jednej z dwóch postaci:

- dostępna: `{ available: true, value, rating, t, finalized, …atrybucja }`. `rating` ∈ {`good`, `needs-improvement`, `poor`}
  według progów web.dev. `t` to chwila względem `timeOrigin` dokumentu. CLS bez przesunięć ma `value: 0` i `t: null`.
  `finalized: false` znaczy, że strona była widoczna przy zapisie i LCP/CLS/INP mogły jeszcze rosnąć (jest notatka).
  Atrybucja: `LCP` → `selector`, `url`; `CLS` → `sources[]` (≤ 5: `selector`, `value`, `t`); `INP` → `selector`, `eventType`,
  `inputDelay`, `processing`, `presentation`, `interactions`.
- niedostępna: `{ available: false, reason }`, `reason` ∈ {`unsupported-browser`, `no-interaction`, `hidden-at-start`, `no-data`}.
  Nigdy `0` w miejscu brakującej wartości. Dostępność ustala wykrywanie funkcji przeglądarki, nie User-Agent.

`longTasks`: `{ available: true, items: [{ t, duration, blockingDuration, scripts: [{ url, function, invoker, duration }] }] }`,
najwyżej 20 najdłuższych (po `blockingDuration`), albo `{ available: false, reason }`.

### `screenshots[]` i `attachments`

`screenshots[]`: `t` (względem `timeOrigin` dokumentu `doc`; `null`, gdy nieznany), `doc`, `reason: "save"`, `mime: "image/jpeg"`,
`width`, `height` (piksele obrazu), `bytes` (rozmiar JPEG po zdekodowaniu, ≤ `limits.screenshotBytes`, nie długość base64),
`attachment` — klucz w `attachments`. Same bajty leżą w `attachments[<attachment>]` jako data URL. Zrzut powstaje tylko przy
*Zapisz paczkę*, gdy karta jest widoczna i pokazuje origin nagrania. W przeciwnym razie `screenshots: []`, `attachments: {}`
i notatka z powodem. W Firefoksie uprawnienie `activeTab` ginie przy każdym przeładowaniu karty, więc zapis po przeładowaniu przy otwartym popupie daje
`screenshots: []` z notatką (otwarcie popupu od nowa przywraca zrzut). Obraz obejrzysz, kopiując ciąg `data:image/jpeg;base64,…`
z `attachments` do paska adresu przeglądarki. W fallbacku konsolowym zrzutów nie ma („Screenshots are not available without the extension.”).

### Limity i ograniczenia

- `steps` ≤ 2000 w paczce i na dokument; zostają najnowsze, `truncated.steps` jak dla innych tablic.
- `stack` ≤ 16 000 znaków; argument konsoli po serializacji ≤ 40 000 znaków (`entryChars`).
- iframe: z iframe'ów tego samego originu (do 20 naraz, zagnieżdżenie do 2) zbierane są tylko błędy (`console.error`,
  `error`, `unhandledrejection`) z polem `frame`. Błędy sprzed podpięcia ramki (przed jej `load`) giną. Ramek z innego originu nie widać.
  Kroki, sieć i metryki pochodzą tylko z dokumentu głównego.
- Podglądy odpowiedzi tylko dla statusu ≥ 400 i treści tekstowej (`text/*`, JSON, XML); odpowiedzi binarne, 2xx/3xx i strumienie
  bez końca (czytane najwyżej 2 s) nie mają podglądu. Maskowanie tokenów w podglądzie jest regułowe (JWT, `Bearer`, wartości przy
  kluczach wrażliwych); pełna redakcja to E3.
- Zasoby: wpis powstaje po zakończeniu pobierania, więc zasoby jeszcze ładowane w chwili zapisu nie mają wpisu. Zasoby z innego
  originu mają `status: null` + `statusUnavailable: "cross-origin"` i zwykle `sizeBytes: null`.
- Firefox (sprawdzone na 158): brak `layout-shift` i long animation frames, więc `CLS` i `longTasks` mają `available: false`,
  `reason: "unsupported-browser"`. `INP` jest dostępne (Firefox ma `interactionId`), a `TTFB`/`FCP`/`LCP` i `status` zasobów
  i dokumentu działają jak w Chrome. Wersje 128–157 nie były sprawdzane; dostępność zawsze ustala wykrywanie funkcji.
- Fallback konsolowy: te same klucze wymagane; `INP` tylko z interakcji po wklejeniu skryptu (notatka).

### Przykład

Pełny przykład (2 dokumenty, kroki, zasoby, metryki dostępne i niedostępne, zrzut 1×1 px): `tests/fixtures/snapshots/v3.json`.
Plik powstał z `assemblePackage` w wersji 0.4.0 i od v4 jest zamrożony (testy migracji i redakcji paczki v3). Skrót:

```jsonc
{
  "schemaVersion": 3, "extensionVersion": "0.4.0", "source": "extension",
  "collectedAt": "2026-01-15T10:01:05.000Z", "recordingStartedAt": "2026-01-15T10:00:00.000Z",
  "recordingStoppedReason": null, "timeOrigin": 1768471204200.25,
  "overview": { "runtimeErrors": 2, "consoleErrors": 1, "failedRequests": 3, "steps": 9, "poorVitals": 1, "screenshot": true },
  "limits": { "consoleLogs": 5000, "runtimeErrors": 1000, "network": 5000, "steps": 2000, "entryChars": 40000, "stackChars": 16000,
              "responseBodyChars": 4096, "responseBodyTotalChars": 262144, "screenshotBytes": 307200, "longTasks": 20 },
  "truncated": { "consoleLogs": false, "runtimeErrors": false, "network": false, "steps": false, "responseBodies": false },
  "documents": [
    { "id": 0, "url": "http://127.0.0.1:8080/form.html", "timeOrigin": 1768471200120.5, "navigationType": "reload", "status": 200,
      "recorded": true, "flushed": true, "current": false,
      "counts": { "consoleLogs": 1, "runtimeErrors": 0, "network": 2, "steps": 7 },
      "kept": { "consoleLogs": 1, "runtimeErrors": 0, "network": 2, "steps": 7 } },
    { "id": 1, "url": "http://127.0.0.1:8080/result.html", "timeOrigin": 1768471204200.25, "navigationType": "navigate", "status": 500,
      "recorded": true, "flushed": true, "current": true, "counts": { … }, "kept": { … } }
  ],
  "notes": ["Recording started at 2026-01-15T10:00:00.000Z (page reloaded); earlier data is not included.",
            "LCP, CLS and INP are values at the time of saving; they could still grow."],
  "steps": [ { "t": 0, "doc": 0, "type": "navigate", "url": "http://127.0.0.1:8080/form.html", "via": "reload" },
             { "t": 812.4, "doc": 0, "type": "click", "selector": "#start", "text": "Zacznij" },
             { "t": 1201.7, "doc": 0, "type": "input", "selector": "#pass", "inputType": "password" } ],
  "runtimeErrors": [ { "t": 8.7, "doc": 1, "type": "error", "message": "Uncaught TypeError: x is undefined", "…": "…" } ],
  "network": [
    { "t": 41, "doc": 0, "type": "img", "method": "GET", "url": "https://cdn.example/logo.png", "status": null,
      "statusUnavailable": "cross-origin", "sizeBytes": null, "…": "…" },
    { "t": 12.5, "doc": 1, "type": "fetch", "method": "POST", "url": "http://127.0.0.1:8080/api/fail", "status": 500,
      "sizeBytes": 23, "responseBodyPreview": "{\"error\":\"expired\"}", "responseBodyTruncated": false, "error": null, "…": "…" }
  ],
  "vitals": [
    { "doc": 0, "TTFB": { "available": true, "value": 47, "rating": "good", "t": 47, "finalized": true },
      "CLS": { "available": false, "reason": "unsupported-browser" }, "…": "…" },
    { "doc": 1, "LCP": { "available": true, "value": 4300, "rating": "poor", "t": 4300, "finalized": false,
                         "selector": "#hero", "url": "http://127.0.0.1:8080/img/hero.png" }, "…": "…" }
  ],
  "screenshots": [ { "t": 5230.1, "doc": 1, "reason": "save", "mime": "image/jpeg", "width": 1, "height": 1, "bytes": 136,
                     "attachment": "screenshot-0" } ],
  "consoleLogs": [ { "t": 15.2, "doc": 1, "level": "error", "args": [ { "name": "TypeError", "message": "x is undefined",
                     "stack": "…", "cause": { "name": "Error", "message": "save failed", "stack": "…" } } ], "stack": "…" } ],
  "environment": { … }, "performance": { … }, "storage": { … }, "dom": { … },
  "attachments": { "screenshot-0": "data:image/jpeg;base64,/9j/…" }
}
```

## Wersja 4 (E3, rozszerzenie 0.5.0)

Zmiana łamiąca względem v3 (design E3 D10): inny kontener (zip zamiast jednego JSON-a), usunięte `attachments`, zmieniony typ
`storage.cookies` i `dom.forms[].elements[].value`, usunięte `dom.html.outerHTML`. Dochodzi redakcja całej paczki (`redaction`),
struktura DOM bez tekstów i budżet rozmiaru 2 MB. Paczkę v4 składa `assembleParts`/`assemblePackage` (`src/lib/package.js`),
a redaguje, przycina i pakuje `exportPackage` (`src/lib/export.js`). Ten sam potok działa w tle rozszerzenia i w fallbacku konsolowym.

### Kontener

Plik `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`:

- `<host>` to nazwa hosta originu nagrania: bez portu, małymi literami, znaki spoza `[a-z0-9.-]` zamienione na `-`, najwyżej 80
  znaków; bez hosta `local`.
- Czas to **lokalny** zegar zgłaszającego, żeby rozpoznał swój plik. Dokładny czas UTC jest w `collectedAt`.

Wpisy zipa, zawsze w tej kolejności (walidator: `validateZipEntries`):

| # | Wpis | Zawartość |
|---|---|---|
| 1 | `snapshot.json` | paczka (ten dokument), JSON z wcięciem 2 spacji, UTF-8, skompresowany (deflate) |
| 2 | `summary.md` | krótki opis po polsku, budowany **z już zredagowanego** `snapshot.json` (`src/lib/summary.js`): host, data, wersje, środowisko, `overview`, linia o prywatności („Zamaskowano N wartości w M sekcjach (reguły v1). …”), pierwsze 10 `notes` |
| 3 | `screenshot.jpg` | tylko gdy `screenshots[]` ma wpis: JPEG ≤ 300 KB z zamalowanymi polami formularzy, zapisany bez kompresji |

Inne wpisy się nie pojawiają. Gdy przeglądarka nie ma `CompressionStream`, zip powstaje bez kompresji, a `notes` dostaje wpis
„The package is not compressed (this browser cannot compress).”. W `snapshot.json` nie ma danych binarnych ani base64 obrazu.

### Co developer czyta najpierw

1. `summary.md` — minuta na kontekst.
2. W `snapshot.json` od góry: `overview`, `redaction` (co zamaskowano, w których sekcjach), `limits`/`truncated` (czego brakuje),
   `notes`, potem `steps` → `runtimeErrors` → `network` → `vitals` → `screenshots` → `consoleLogs`, na końcu sekcje strony,
   a w nich jako ostatnie `dom.structure` i `dom.fullHtml`.

### Klucze najwyższego poziomu (w kolejności w pliku)

Wszystkie są **wymagane**, także w fallbacku konsolowym. `null` lub pusta tablica jest wyjaśniona w `notes` tak jak w v3.

| # | Ścieżka | Typ | Opis | Od kiedy |
|---|---|---|---|---|
| 1 | `schemaVersion` | integer | `4` | v2 (wartość v4) |
| 2–7 | `extensionVersion`, `source`, `collectedAt`, `recordingStartedAt`, `recordingStoppedReason`, `timeOrigin` | | jak v3 | v2 |
| 8 | `overview` | object | jak v3; liczony **po** budżecie rozmiaru (z tego, co jest w paczce); `screenshot: false`, gdy zgłaszający wyłączył zrzut | v3 |
| 9 | `redaction` | object | `{ rulesVersion, disabledRules, masked }` — raport redakcji bez żadnych wartości (niżej) | **v4** |
| 10 | `limits` | object | jak v3 + `html` (300 000), `packageBytes` (2 097 152; 10 485 760, gdy developer włączył pełny HTML) | v2 (rozszerzone) |
| 11 | `truncated` | object | jak v3 + `html`, `resources`, `dom`, `storage`, `stacks` (niżej, „Budżet rozmiaru”) | v2 (rozszerzone) |
| 12 | `documents` | object[] | jak v3; `url` po redakcji | v2 |
| 13 | `notes` | string[] | jak v3 + powody braku zrzutu z E3, cięcia budżetu z liczbami, po jednej notatce na sekcję rekordów z różnicą między nagranym a zapisanym (`<sekcja>: N recorded, M in the package; K were not included (recording limits, time limit or package size limit).`), cięcia po redakcji (`dom.structure was cut to N characters after redaction.`), przekroczenie 2 MB z pełnym HTML, zip bez kompresji | v1 |
| 14 | `steps` | object[] | jak v3; krok `change` pola pliku ma `fileCount` (niżej) | v3 |
| 15 | `runtimeErrors` | object[] | jak v3, po redakcji | v1 |
| 16 | `network` | object[] | jak v3, po redakcji (URL-e, nagłówki, `requestBody`, podglądy) | v1 |
| 17 | `vitals` | object[] | jak v3 | v3 |
| 18 | `screenshots` | object[] | metadane zrzutu: `file` zamiast `attachment`, nowe `maskedFields`; najwyżej 1 wpis | v3 (kształt v4) |
| 19 | `consoleLogs` | object[] | jak v3, po redakcji; element DOM w `args` ma `structure` zamiast `outerHTML` | v1 |
| 20 | `environment` | object \| null | jak v3, po redakcji (`location.href`/`search`/`hash` zgodne ze sobą) | v1 |
| 21 | `performance` | object \| null | jak v3, adresy po redakcji | v1 |
| 22 | `storage` | object \| null | `cookies` jako lista skrótów, nowe `cookiesTotalBytes`, wartości `localStorage`/`sessionStorage` po redakcji | v1 (kształt v4) |
| 23 | `dom` | object \| null | bez `html.outerHTML`; nowe `structure` i `fullHtml` jako ostatnie klucze; formularze bez wartości | v1 (kształt v4) |

`attachments` **nie istnieje** w v4: obraz to wpis `screenshot.jpg` w zipie.

### `redaction`

```jsonc
"redaction": {
  "rulesVersion": 1,                 // wersja polityki redakcji (src/lib/redact-rules.js)
  "disabledRules": [],               // reguły wyłączone opcją developerską; podzbiór ["email", "phone", "html-structure"]
  "masked": { "network": 2, "consoleLogs": 3, "environment": 2, "storage": 2, "dom": 1 }
}
```

- Klucze `masked` to sekcje najwyższego poziomu paczki: `documents`, `notes`, `steps`, `runtimeErrors`, `network`, `vitals`,
  `consoleLogs`, `environment`, `performance`, `storage`, `dom`. Sekcja bez znaczników nie występuje (brak klucza, nie `0`).
- `masked.<sekcja>` to liczba wystąpień `[redacted:` w tej sekcji **po** budżecie rozmiaru. Suma `masked` równa się liczbie
  wystąpień `[redacted:` w całym `snapshot.json` (AC-4.3). Walidator sprawdza i sumę, i każdą sekcję.
- `disabledRules` wymienia tylko reguły poziomu *Domyślnie*, w kolejności `email`, `phone`, `html-structure`, bez powtórzeń.
  Próba wyłączenia reguły poziomu *Zawsze* jest ignorowana i nie trafia do listy (AC-4.5). Zgłaszający nie ma tej opcji. Źródło
  opcji developerskich dostarczy E4-D4; w E3 lista jest zawsze pusta.
- `redaction` nie zawiera żadnej zamaskowanej wartości ani jej fragmentu.

### Reguły i znaczniki

Zamaskowana wartość to string `"[redacted:<reguła>]"`, nigdy `null` (`null` znaczy „nie było”). Znacznik zastępuje całą wartość
(klucz wrażliwy, wartość pola) albo tylko pasujący fragment tekstu (`"session [redacted:jwt]"`,
`"?access_token=[redacted:key-token]"`). Reguły `rulesVersion: 1`:

| Reguła | Poziom | Co maskuje |
|---|---|---|
| `key-<token>` | Zawsze | wartość przy kluczu, parametrze, nagłówku albo atrybucie, którego nazwa zawiera słowo z listy (`token`, `access_token`, `refresh_token`, `id_token`, `auth`, `authorization`, `session`, `sessionid`, `sid`, `jwt`, `secret`, `api_key`, `apikey`, `key`, `password`, `passwd`, `pwd`, `csrf`, `xsrf`, `cookie`, `set-cookie`, `bearer`, `credential`, `private`, `signature`, `sig`, `otp`, `pin`, `cvv`, `cvc`, `pass`), np. `key-token`, `key-password`, `key-cvv`; `key-session` także dla przyrostka `sessid`/`sessionid` (`JSESSIONID`, `PHPSESSID`). Dwa wyjątki: `pw` liczy się tylko jako cały klucz (`pw`, nie `new_pw`), a `code` i `ticket` (kod OAuth, bilet CAS: `key-code`, `key-ticket`) tylko jako parametr query albo fragmentu adresu URL — w JSON-ie i tekście to zwykłe słowa (`{"code":"PL"}` zostaje). `passenger`, `passport`, `compass`, `bypass`, `country_code`, `promo_code` nie są maskowane |
| `jwt` | Zawsze | token JWT (`eyJ….….…`) |
| `bearer`, `basic` | Zawsze | dane po `Bearer ` / `Basic ` |
| `card` | Zawsze | numer karty: 13–19 cyfr z prefiksem wydawcy (Visa, Mastercard, Amex, Discover/Maestro) i poprawną sumą Luhna |
| `iban` | Zawsze | IBAN z poprawną sumą kontrolną |
| `pesel` | Zawsze | PESEL z poprawną sumą kontrolną |
| `long-secret` | Zawsze | długi ciąg o wysokiej entropii (klucze API bez słowa-klucza); nie w selektorach |
| `url-credentials` | Zawsze | `user:hasło@` w adresie |
| `url-fragment` | Zawsze | cały fragment `#…` adresu, gdy niesie dane (np. `#id_token=…` z OAuth) |
| `form-value` | Zawsze | wartość pola formularza (`value` w pełnym HTML, treść `textarea`) |
| `email` | Domyślnie | adres e-mail — wszędzie, gdzie przechodzi przebieg tekstowy (także URL-e, tytuł, kroki, atrybuty `data-*`, `notes`) |
| `phone` | Domyślnie | numer telefonu — tylko w konsoli, błędach, `requestBody`, podglądach odpowiedzi i storage (w URL-ach i selektorach za dużo fałszywych trafień) |
| `html-structure` | Domyślnie | pseudo-reguła: pełny HTML strony nie trafia do paczki; jej wyłączenie oznacza `dom.fullHtml` |

**Jedyna zmiana typu wartości:** liczba albo boolean przy kluczu wrażliwym w danych użytkownika (np. `{ "pin": 1234 }` w argumencie
konsoli, w `requestBody` albo w storage) staje się stringiem znacznika (`"pin": "[redacted:key-pin]"`). Pozostałe pola zachowują
typ: znacznik zawsze zastępuje string. Liczniki, statusy, czasy, rozmiary, `overview`, `vitals` i komunikaty błędów (poza
zamaskowanymi fragmentami) redakcja zostawia bez zmian (AC-5.4). Nie skanuje też nagłówka paczki, `limits`, `truncated`
i metadanych `screenshots`.

Pary klucz–wartość są rozpoznawane także w miejscach, gdzie nie ma zwykłego obiektu: JSON zagnieżdżony w stringu (dowolny poziom
escape'ów, np. `redux-persist`), JSON w atrybutach z encjami (`&quot;`, `&#34;`, `&lt;` w XML), wartości ucięte na granicy limitu
(maskowane do końca), JSON zakodowany procentami w treści formularza, pary `{ name, value }` i `[nazwa, wartość]`, a w argumentach
konsoli sąsiednie argumenty (`console.log('password:', x)`, `console.log('login', 'jan', 'password', x)`, łańcuch kluczy).
Sama nazwa klucza w argumencie konsoli musi być jednym słowem albo kończyć się `:`/`=`; zdanie (`'Your password is', x`) nie jest kluczem.

Redakcja ma dwa etapy. Rozstrzyga ta w tle (`src/lib/redact.js` + `redact-page.js`) na złożonej paczce. Ochrona u źródła w MAIN
(podglądy odpowiedzi, nagłówki i adresy w hookach sieci, kroki) jest obroną w głąb. Fallback konsolowy używa tych samych modułów.

### `storage`

```jsonc
"storage": {
  "cookies": [ { "name": "sid", "sizeBytes": 20, "valueHash": "93d70a40" }, { "name": "consent", "sizeBytes": 11, "valueHash": "8a798890" } ],
  "cookiesTotalBytes": 45,
  "localStorage": { "theme": "dark", "authToken": "[redacted:key-token]", "profile": "{\"email\":\"[redacted:email]\",\"plan\":\"free\"}" },
  "sessionStorage": { "cart": "3" }
}
```

| Pole | Typ | Opis |
|---|---|---|
| `cookies` | object[] | jeden wpis na ciasteczko widoczne dla `document.cookie` (bez `HttpOnly`), w kolejności z `document.cookie`. Para bez `=` to ciasteczko z pustą nazwą |
| `cookies[].name` | string | nazwa jawnie |
| `cookies[].sizeBytes` | integer | bajty UTF-8 pary `nazwa=wartość` |
| `cookies[].valueHash` | string | pierwsze 8 znaków hex (małe litery) SHA-256 wartości. Ta sama wartość daje ten sam skrót w każdej paczce, różna — różny. Sama wartość nigdy nie trafia do paczki |
| `cookiesTotalBytes` | integer | bajty UTF-8 całego `document.cookie` (z separatorami `; `) |
| `localStorage`, `sessionStorage` | object | klucze jawnie. Wartości po redakcji: przy kluczu wrażliwym cała wartość to znacznik, w pozostałych przebieg tekstowy (z `email` i `phone`). Wartość ≤ 5000 znaków od kolektora, w budżecie może być skrócona do 1000 (`truncated.storage`). Błąd odczytu obszaru: klucz `__error` z komunikatem |

### `dom`

Klucze w kolejności: `counts`, `html`, `meta`, `canonical`, `hreflangs`, `scripts`, `stylesheets`, `images`, `iframes`, `forms`,
`rootMarkers` (jak v3, adresy i atrybuty po redakcji), a jako **ostatnie** `structure` i `fullHtml`.

| Pole | Typ | Opis |
|---|---|---|
| `html` | object | `doctype` (`{ name, publicId, systemId }` \| `null`), `lang`, `charset`, `compatMode`. **Bez `outerHTML`** |
| `images[]` | object[] | `src`, `naturalWidth`, `naturalHeight`, `width`, `height`, `loading`, `altLength` (integer, długość tekstu `alt`; 0, gdy go nie ma). **Bez `alt`** — tekst bywa imieniem i nazwiskiem („Avatar Jana Kowalskiego”) |
| `iframes[]` | object[] | `src`, `id`, `name`, `titleLength` (integer, długość atrybutu `title`; 0, gdy go nie ma), `attributes` (bez `title`). **Bez `title`** z tego samego powodu |
| `forms[].elements[]` | object[] | `tagName`, `type`, `name`, `id`, `checked?`, `valueLength?`, `fileCount?`. **Nigdy `value`.** `valueLength` (integer) to długość wartości; pola `password` go nie mają. Pole `file` nie ma `valueLength` (w v3 była to długość ścieżki `C:\fakepath\…`), tylko `fileCount` (integer, liczba wybranych plików; brak, gdy przeglądarka jej nie podaje). `fileCount` występuje wyłącznie przy `type: "file"` |
| `structure` | string \| null | struktura bieżącego dokumentu jako HTML bez tekstów (niżej); ≤ `limits.html` znaków, chyba że `truncated.html` |
| `fullHtml` | string \| null | `null`, chyba że developer wyłączył `html-structure` (`redaction.disabledRules`). Wtedy pełny HTML z tekstami i atrybutami (bez `value` pól), po przebiegu tekstowym redakcji, ≤ 8 000 000 znaków od kolektora, cięty dalej przez budżet 10 MB |

`structure` — elementy w kolejności dokumentu:

- Tylko tagi i atrybuty z białej listy: `id`, `class`, `role`, `data-*`, `aria-*` bez `aria-label`, `aria-valuetext`,
  `aria-description`, `aria-placeholder`, oraz `type` na `input`/`button`. Wartości atrybutów są po redakcji (np.
  `data-user="[redacted:email]"`).
- Brak węzłów tekstowych, komentarzy, `value`, `placeholder`, `title`, `alt`, `href`, `src`.
- Brak treści `<script>`, `<style>`, `<template>`, `<noscript>`. Sam tag zostaje, więc selektory `nth-of-type` z `steps`, `vitals`
  i `CLS.sources` dalej trafiają w ten sam element (AC-5.3).
- Elementy puste (void) nie mają tagu zamykającego. Wynik zawsze da się sparsować (`DOMParser`).
- Gdy kolektor przekroczy 300 000 znaków, przestaje schodzić w głąb i domyka otwarte tagi. Paczka dostaje wtedy
  `truncated.html: true` i notatkę „dom.structure was cut to 300000 characters; N elements were not included.”.
  Znacznik redakcji bywa dłuższy od zastąpionej wartości (`a@b.pl` → `[redacted:email]`): gdy po redakcji `structure` przekroczy
  `limits.html`, eksport przycina ją na granicy elementu z domknięciem tagów, ustawia `truncated.html: true` i dodaje notatkę
  „dom.structure was cut to 300000 characters after redaction.” (jeśli `truncated.html` nie było już ustawione).
  Budżet rozmiaru może dalej skrócić `structure` (najmniej do 100 000 znaków) z notatką „dom.structure was cut by N characters …”.

### Elementy w `consoleLogs[].args`

Element DOM przekazany do `console.*` to `{ tagName, id, className, structure }`. `structure` to ten sam serializator co
`dom.structure`, ograniczony do 2000 znaków na element, bez tekstów i wartości. W v3 było tu `outerHTML`.

### `steps[]` — pole pliku

`input[type=file]`: zapisywany jest tylko krok `change` z `inputType: "file"` i `fileCount` (integer, liczba wybranych plików).
Krok `input` na polu pliku nie powstaje. Nie ma `valueLength`: w v3 była to długość ścieżki `C:\fakepath\…`. Nazwa ani ścieżka
pliku nigdy nie trafia do paczki. Pozostałe pola kroków jak v3.

### `screenshots[]`

`t`, `doc`, `reason: "save"`, `mime: "image/jpeg"`, `width`, `height`, `bytes` — jak v3, plus:

| Pole | Typ | Opis |
|---|---|---|
| `file` | string | `"screenshot.jpg"` — nazwa wpisu w zipie z bajtami obrazu (zastępuje `attachment`) |
| `maskedFields` | integer \| null | ile pól formularza zamalowano na obrazie; `null`, gdy nieznane |

Najwyżej jeden wpis (jeden obraz w zipie). Pola edytowalne są zamalowane: `input` poza `button`, `submit`, `reset`, `checkbox`,
`radio`, `range`, `color`, `image`, a także `textarea`, `select`, `[contenteditable]`, również w iframe'ach tego samego originu.
Etykiet nie zamalowujemy. Gdy zrzutu nie ma, `screenshots: []`, a `notes` podaje powód:

- „Screenshot not included (turned off by the reporter).” — przełącznik „Dołącz zrzut ekranu” był wyłączony. Notatka brzmi tak samo,
  gdy to nie zgłaszający go wyłączył, tylko popup zostawił go wyłączonego (okienka innych serwisów na stronie albo nieudane sprawdzenie
  strony — fail-closed); ze schematu nie da się tych przypadków odróżnić;
- „No screenshot: form fields could not be hidden (<powód>).” — nie udało się ustalić pól, więc obrazu nie ma (fail-closed);
- „No screenshot: the page moved while the screenshot was taken.” — przewinięcie między odczytami pól;
- „More than 2000 form fields: the whole screenshot is covered.” — zbyt wiele pól, obraz jest w całości zakryty (zrzut jest, ale bez treści);
- „No screenshot: the image could not be included.” — eksport nie dostał bajtów obrazu (metadane są usuwane, `overview.screenshot: false`);
- oraz powody z v3 (inna strona, karta niewidoczna, obraz za duży, fallback konsolowy).

### Budżet rozmiaru i kolejność cięcia

Przy konfiguracji domyślnej zip ma najwyżej `limits.packageBytes` = 2 097 152 B, a `snapshot.json` po rozpakowaniu najwyżej
10 MB znaków. Rozmiar jest mierzony prawdziwą kompresją (do 4 pomiarów). Najpierw, jeszcze przed redakcją, paczka jest przycinana
do 10 MB JSON-u, ale tylko całymi wpisami. Stringów nie skraca się przed redakcją, bo ucięty sekret mógłby przestać pasować do reguły.
Gdy paczka jest za duża, dane są usuwane w stałej kolejności, od najmniej potrzebnych. Każdy krok ustawia flagę w `truncated`
i dopisuje notatkę z liczbą usuniętych pozycji:

| Krok | Co | `truncated` |
|---|---|---|
| 0 | `dom.fullHtml` (tylko z opcją developera), cięty na granicy elementu do 10 MB | `html` |
| 1 | `performance.resources` — najstarsze ponad 200 | `resources` |
| 2 | `network[]` udane (status < 400, bez `error`): najpierw najstarsze zasoby, potem najstarsze `fetch`/`xhr` | `network` |
| 3 | `consoleLogs` poziomu `debug` → `log` → `info` → `warn`, najstarsze | `consoleLogs` |
| 4 | listy `dom.meta`/`scripts`/`stylesheets`/`images`/`iframes`/`hreflangs` do 100 pozycji | `dom` |
| 5 | `dom.structure` do 100 000 znaków (domknięte tagi) | `html` |
| 6 | wartości `localStorage`/`sessionStorage` dłuższe niż 1000 znaków | `storage` |
| 7 | `consoleLogs` poziomu `error`, najstarsze | `consoleLogs` |
| 8 | `stack` w `runtimeErrors` i `consoleLogs` do 4000 znaków (wpisy zostają) | `stacks` |

**Nigdy nie są cięte:** `overview`, `redaction`, `documents`, `notes`, `steps`, wpisy `runtimeErrors`, wpisy `network` ze `status` ≥ 400
lub `error`, `vitals`, `screenshots[]` i `screenshot.jpg`. `overview` i `documents[].kept` są liczone po cięciach. Rozmiar nigdy nie blokuje
zapisu: gdy po wszystkich krokach paczka jest nadal za duża, powstaje z notatką „Package is larger than 2 MB (N bytes) after all cuts.”.
Gdy developer włączył pełny HTML, `limits.packageBytes` wynosi 10 485 760, a zip większy niż 2 MB dostaje notatkę
„Package exceeds 2 MB: full HTML enabled by developer.”.

### Ograniczenia

- **Shadow DOM i iframe w strukturze:** `dom.structure` nie wchodzi do shadow rootów ani do dokumentów ramek. Widać tylko element-host
  i tag `<iframe>`. Selektor kroku wewnątrz shadow DOM nie znajdzie się w `structure`.
- **Iframe'y z innego originu na zrzucie nie są zamalowywane** (decyzja PB-1 B). Formularz płatności lub logowania osadzony w takiej
  ramce może być widoczny na `screenshot.jpg`. Zamalowujemy pola dokumentu głównego i ramek tego samego originu.
- **Fallback konsolowy a AC-3.6:** redakcja w tle nie zależy od tego, co podmieniła strona. Fallback działa jednak w realmie strony,
  po jej skryptach. Używa tych samych reguł (AC-3.7), ale wroga strona, która podmieni `RegExp`, `String.prototype` albo `JSON`
  przed wklejeniem skryptu, może osłabić jego redakcję.
- **Skrót ciasteczka bez soli:** `valueHash` to stałe 8 znaków hex SHA-256. Pozwala porównać wartości między paczkami. Wartość
  o małej liczbie możliwości (`consent=yes`, `lang=pl`, krótki PIN) da się jednak odgadnąć, licząc skróty kandydatów. Wartości
  sesji i tokenów są zbyt długie i losowe, żeby to było praktyczne.
- **Ramki z innych originów a paczka:** liczba widocznych ramek cross-origin (`crossOriginVisible`) służy tylko popupowi do ustawienia
  domyślnego stanu przełącznika zrzutu. **Nie trafia do paczki** i nie ma o niej notatki; `screenshots[].maskedFields` liczy wyłącznie zamalowane pola.
- **Post-redakcyjne cięcia stringów:** po redakcji znacznik na granicy cięcia (`cutText`) może zostać usunięty (utrata informacji, bez przecieku);
  podgląd konsoli `{ truncated, preview }` po maskowaniu par tablic bywa zniekształcony (`masked` zawyżone).
- **Redakcja regułowa:** sekret bez słowa-klucza, krótszy niż próg `long-secret` i w nietypowym miejscu może przejść: base64 < 32 znaków,
  `&amp;quot;` (podwójne kodowanie encji), podwójne kodowanie procentowe, `code`/`ticket` w adresach względnych (`/cb?code=…`) i w tekście
  poza adresami bezwzględnymi, klucz na samym początku stringu JSON (`{"log":"password: x"}`). Klucz AWS `AKIA…` to sam identyfikator;
  sekret (40 znaków) łapie `long-secret`. Fałszywie dodatnie trafienia (np. „123 456 789 zł” jako `phone`, `auth: "Invalid credentials"`)
  zabierają developerowi pojedyncze wartości. Pełna lista: [README](../README.md#znane-ograniczenia).

### Przykład

Pełny przykład (2 dokumenty, kroki z polem pliku, zasoby, metryki, ciasteczka, storage z zamaskowanymi wartościami, struktura DOM,
element w konsoli, zrzut 1×1 px z `maskedFields`): `tests/fixtures/snapshots/v4.json`. To `snapshot.json` z zipa, który `exportPackage`
tworzy dla syntetycznych danych z `tests/unit/snapshot-validator.test.js`. Wartości-pułapki w tych danych są syntetyczne i w pliku
występują tylko jako znaczniki. Po zamierzonej zmianie kształtu paczki odświeżasz plik komendą
`PDS_UPDATE_FIXTURES=1 npx vitest run tests/unit/snapshot-validator.test.js`. Skrót:

```jsonc
{
  "schemaVersion": 4, "extensionVersion": "0.5.0", "source": "extension",
  "collectedAt": "2026-01-15T10:01:05.000Z", "recordingStartedAt": "2026-01-15T10:00:00.000Z",
  "recordingStoppedReason": null, "timeOrigin": 1768471204200.25,
  "overview": { "runtimeErrors": 2, "consoleErrors": 1, "failedRequests": 3, "steps": 10, "poorVitals": 1, "screenshot": true },
  "redaction": { "rulesVersion": 1, "disabledRules": [],
                 "masked": { "network": 2, "consoleLogs": 3, "environment": 2, "storage": 2, "dom": 1 } },
  "limits": { "consoleLogs": 5000, "…": "…", "longTasks": 20, "html": 300000, "packageBytes": 2097152 },
  "truncated": { "consoleLogs": false, "runtimeErrors": false, "network": false, "steps": false, "responseBodies": false,
                 "html": false, "resources": false, "dom": false, "storage": false, "stacks": false },
  "documents": [ … ], "notes": [ … ],
  "steps": [ { "t": 1350, "doc": 0, "type": "change", "selector": "#avatar", "inputType": "file", "fileCount": 2 }, … ],
  "runtimeErrors": [ … ],
  "network": [ { "t": 12.5, "doc": 1, "type": "fetch", "method": "POST", "url": "http://127.0.0.1:8080/api/fail", "status": 500,
                 "requestHeaders": { "content-type": "application/json", "authorization": "[redacted:key-authorization]" },
                 "requestBody": "{\"name\":\"Example\",\"password\":\"[redacted:key-password]\"}", "…": "…" }, … ],
  "vitals": [ … ],
  "screenshots": [ { "t": 5230.1, "doc": 1, "reason": "save", "mime": "image/jpeg", "width": 1, "height": 1, "bytes": 136,
                     "file": "screenshot.jpg", "maskedFields": 3 } ],
  "consoleLogs": [ { "t": 16, "doc": 1, "level": "log", "args": [ "clicked",
                     { "tagName": "BUTTON", "id": "slow", "className": "btn", "structure": "<button id=\"slow\" class=\"btn\" type=\"button\"></button>" } ] },
                   { "t": 17, "doc": 1, "level": "warn", "args": [ "session [redacted:jwt]",
                     { "password": "[redacted:key-password]", "user": "[redacted:email]" } ] }, … ],
  "environment": { "location": { "href": "http://127.0.0.1:8080/result.html?access_token=[redacted:key-token]", "…": "…" }, … },
  "performance": { … },
  "storage": { "cookies": [ { "name": "sid", "sizeBytes": 20, "valueHash": "93d70a40" }, … ], "cookiesTotalBytes": 45,
               "localStorage": { "theme": "dark", "authToken": "[redacted:key-token]", "…": "…" }, "sessionStorage": { "cart": "3" } },
  "dom": { "counts": { … }, "html": { "doctype": { "name": "html", "publicId": "", "systemId": "" }, "lang": "pl", "charset": "UTF-8", "compatMode": "CSS1Compat" },
           "forms": [ { "id": "profile", "elements": [ { "tagName": "INPUT", "type": "email", "name": "email", "id": "mail", "valueLength": 20 },
                                                       { "tagName": "INPUT", "type": "password", "name": "password", "id": "pass" }, … ] } ],
           "rootMarkers": { … },
           "structure": "<html lang=\"pl\"><head><meta charset=\"utf-8\"><script></script></head><body class=\"page\">…<div data-user=\"[redacted:email]\"></div>…</html>",
           "fullHtml": null }
}
```

## Zmiany między wersjami

### v1 → v2 (E1)

Konsument (viewer, MCP, `summary.md`) rozpoznaje v1 po braku `schemaVersion` i migruje przy odczycie:

| v1 | v2 | Migracja przy odczycie v1 |
|---|---|---|
| `version: "1.0.0"` | **usunięte**; nowe `schemaVersion: 2`, `extensionVersion` | brak `schemaVersion` ⇒ v1; `extensionVersion` nieznane |
| `initializedAt` | `recordingStartedAt` | przepisać wartość |
| `collectedAt` | bez zmian | — |
| — | **nowe**: `source`, `recordingStoppedReason`, `timeOrigin`, `documents`, `limits`, `truncated` | `source: "extension"`, `recordingStoppedReason: null`, `timeOrigin = performance.timeOrigin`, jeden dokument (`id 0`, `current: true`, `url = environment.location.href`), `limits` = 5000 dla każdej tablicy, `truncated` nieznane |
| `consoleLogs[].timestamp` (ISO) | `t` (ms od `documents[doc].timeOrigin`), `doc`, **nowe** `stack?` | `t = Date.parse(timestamp) - timeOrigin`, `doc = 0` |
| `runtimeErrors[].timestamp`, `error`, `reason` | `t`, `doc`, `stack`, `message` (także dla `unhandledrejection`), `reason?`; `error` **usunięte** | `t` jak wyżej, `stack = error.stack` |
| `network[].startedAt` / `startedAtIso` | `t` | `t = Date.parse(startedAtIso ?? startedAt) - timeOrigin` |
| `network[].input`, `init` | **usunięte**; `method`, `url`, `requestHeaders`, `requestBody` | `method = init.method ?? "GET"`, `requestHeaders = init.headers`; dla `fetch(Request)` v1 miało `{}` — dane niedostępne |
| `network[].headers`, `body` | `responseHeaders`, `requestBody` | `responseHeaders = headers`, `requestBody = body` |
| `network[].responseURL`, `async`, `readyState`, `responseType` | **usunięte** | `url = url ?? responseURL` |
| `network[].status`, `ok`, `durationMs`, `error` | bez zmian; **nowe** `statusText`, `redirected` | — |
| `notes` | bez zmiany typu; nowe treści | — |
| `environment`, `dom`, `performance`, `storage` | bez zmian treści; mogą być `null` z notatką | — |

Nazwa pliku bez zmian: `page-debug-snapshot-<Date.now()>.json` (w v2 nadaje ją tło przez `packageFileName`).

### v2 → v3 (E2)

Konsument rozpoznaje v2 po `schemaVersion: 2`. Typy pól v2 w v3 się nie zmieniają. Zmienia się kolejność kluczy, znaczenie
`network[].type`/`limits.network` i dochodzą nowe klucze.

| v2 | v3 | Migracja przy odczycie v2 |
|---|---|---|
| `schemaVersion: 2` | `3` | — |
| kolejność: nagłówek, `documents`, `limits`, `truncated`, `notes`, sekcje strony, rekordy | nagłówek, `overview`, `limits`, `truncated`, `documents`, `notes`, `steps`, `runtimeErrors`, `network`, `vitals`, `screenshots`, `consoleLogs`, `environment`, `performance`, `storage`, `dom`, `attachments` | nie dotyczy (kolejność nie zmienia typów) |
| — | `overview` | policzyć z rekordów; `steps: 0`, `poorVitals: 0`, `screenshot: false` |
| `network[].type` ∈ {`fetch`, `xhr`} | + `img`/`script`/`css`/`font`/`other`; nowe `sizeBytes`, `statusUnavailable?`, `responseBodyPreview?`, `responseBodyTruncated?`, `initiatorType?` | `sizeBytes: null`; zasobów w v2 nie ma (były tylko w `performance.resources`) |
| `limits.network` = fetch + XHR | fetch + XHR + zasoby | — |
| `limits`: `consoleLogs`, `runtimeErrors`, `network`, `entryChars` (10 000) | + `steps`, `stackChars`, `responseBodyChars`, `responseBodyTotalChars`, `screenshotBytes`, `longTasks`; `entryChars` 40 000 | brak klucza ⇒ limit nieznany |
| `truncated`: `consoleLogs`, `runtimeErrors`, `network` | + `steps`, `responseBodies` | `steps: false`, `responseBodies: false` |
| `documents[]` | + `status`, `statusUnavailable?`; `counts`/`kept` + `steps` | `status: null`, `statusUnavailable: "unknown"`, `steps: 0` |
| `*.stack` ≤ 4000 znaków | ≤ 16 000; `Error` w `args`/`reason` ma `cause` (≤ 5 poziomów) | — |
| — | `steps`, `vitals`, `screenshots`, `attachments` (wymagane, mogą być puste) | `[]`, `[]`, `[]`, `{}` |
| — | `runtimeErrors[].frame?`, `consoleLogs[].frame?` | — |

Nazwa pliku bez zmian: `page-debug-snapshot-<Date.now()>.json`.

### v3 → v4 (E3)

Konsument rozpoznaje v4 po kontenerze (zip, pierwsze bajty `PK`) i `schemaVersion: 4` w `snapshot.json`. Kolejność kluczy v3 zostaje,
dochodzi `redaction` po `overview`, a `attachments` znika.

| v3 | v4 | Migracja przy odczycie v3 |
|---|---|---|
| plik `page-debug-snapshot-<ms>.json` | zip `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`: `snapshot.json`, `summary.md`, `screenshot.jpg?` | rozpoznać po rozszerzeniu albo pierwszych bajtach `PK`; JSON v3 czytać wprost |
| `schemaVersion: 3` | `4` | — |
| — | `redaction: { rulesVersion: 1, disabledRules: string[], masked: { "<sekcja>": n } }` (po `overview`) | brak ⇒ „dane niezredagowane” |
| `attachments` (ostatni klucz) | **usunięte**; obraz to wpis `screenshot.jpg` | obraz z `attachments[screenshots[i].attachment]` |
| `screenshots[].attachment` | `screenshots[].file` (`"screenshot.jpg"`), nowe `maskedFields` (integer \| null) | `file` = `attachment`, `maskedFields: null` |
| `storage.cookies`: string (`document.cookie`) | `[{ name, sizeBytes, valueHash }]` + nowe `storage.cookiesTotalBytes` | rozbić string po `; ` i pierwszym `=`; `valueHash: null` |
| `storage.localStorage`/`sessionStorage`: wartości jawne | wartości po redakcji (znaczniki) | — |
| `dom.html.outerHTML` | **usunięte**; nowe `dom.structure` (string ≤ 300 000, bez tekstów) i `dom.fullHtml` (`null` lub string) — ostatnie klucze `dom` | brak struktury (`outerHTML` v3 można pokazać jako pełny HTML) |
| `dom.images[].alt`, `dom.iframes[].title` (+ `title` w `iframes[].attributes`) | `altLength`, `titleLength` (integer); `title` znika z `attributes` | długość tekstu; `null` → 0 |
| `dom.forms[].elements[].value` | `valueLength` (integer; brak dla `password`); pole `file`: `fileCount` zamiast `valueLength` | `valueLength` = długość `value` (`"[redacted]"` z v3 — brak); dla `file` brak (`fileCount` nieznane) |
| `consoleLogs[].args` — element `{ tagName, id, className, outerHTML }` | `{ tagName, id, className, structure }` (≤ 2000 znaków, bez tekstów) | — |
| `steps[]` `change` pola pliku: `valueLength` (długość ścieżki) | `fileCount` (integer); krok `input` na polu pliku nie powstaje | `fileCount` nieznane |
| wartości w polach tekstowych jawne | `"[redacted:<reguła>]"`; liczba/boolean przy kluczu wrażliwym w danych użytkownika → string znacznika (jedyna zmiana typu) | — |
| `limits` | + `html` (300 000), `packageBytes` (2 097 152 albo 10 485 760 z pełnym HTML) | brak ⇒ nieznane |
| `truncated` | + `html`, `resources`, `dom`, `storage`, `stacks` | `false` |
| `notes` | + brak zrzutu: wyłączony przez zgłaszającego / nie udało się zamaskować pól / strona się przesunęła; cięcia budżetu z liczbami; > 2 MB z pełnym HTML; zip bez kompresji | — |
| `overview` | bez zmian kształtu; liczony po budżecie; `screenshot: false` przy wyłączonym zrzucie | — |

### Wpis zmian

- **v4 (E3, rozszerzenie 0.5.0):** paczka jako zip (`snapshot.json`, `summary.md`, `screenshot.jpg`) z nazwą `snapshot-<host>-<czas>.zip`;
  redakcja całej paczki według reguł v1 ze znacznikami `[redacted:<reguła>]` i raportem `redaction`; ciasteczka jako nazwy, rozmiary
  i skróty SHA-256; struktura DOM bez tekstów zamiast `outerHTML` (pełny HTML tylko z opcją developera); formularze i pola plików bez
  wartości; `alt` obrazków i `title` ramek tylko jako długości; zrzut z zamalowanymi polami i przełącznikiem zgłaszającego; budżet 2 MB z ustaloną kolejnością cięcia (`limits.packageBytes`,
  nowe flagi `truncated`); `attachments` usunięte.
- **v3 (E2, rozszerzenie 0.4.0):** kroki zgłaszającego (`steps`), metryki CWV z atrybucją i długie zadania (`vitals`), zasoby strony
  i status dokumentu (`network`, `documents[].status`), fragment treści odpowiedzi błędów, zrzut ekranu (`screenshots` + `attachments`),
  pełniejsze stosy z `cause`, blok `overview`, kolejność kluczy pod czytanie od góry.
- **v2 (E1, rozszerzenie 0.3.0):** czas `t` względem `timeOrigin` dokumentu, wiele dokumentów w paczce (`documents`), `limits`,
  `truncated`, `source`, fallback konsolowy.
- **v1 (E0, rozszerzenie 1.0.0):** baseline, czasy ISO w rekordach.
