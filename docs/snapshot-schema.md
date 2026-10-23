# Schemat paczki snapshotu

Źródło prawdy o strukturze pliku `page-debug-snapshot-<timestamp>.json`. Reguły wersjonowania: skill `snapshot-schema`.
Aktualna wersja: **3** (od E2). Paczkę v3 składa `assemblePackage` z `src/lib/package.js` (tło rozszerzenia i fallback
konsolowy). Rozpoznawanie przy odczycie: jest `schemaVersion` → ta wersja; brak `schemaVersion` i `version: "1.0.0"` →
wersja 1 (tabele migracji na końcu). Przykłady (dane syntetyczne): `tests/fixtures/snapshots/v3.json` (aktualny),
`tests/fixtures/snapshots/v2.json` (do testów migracji). Zgodność paczki z v3 sprawdza walidator
`tests/helpers/snapshot-validator.js` (`validateSnapshot(pkg) → { ok, errors }`), wspólny dla testów unit i e2e.

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
| `valueLength` | `input`, `change` (nie dla `password`) | długość wartości; dla `file` liczba plików. **Wartości pól nigdy nie trafiają do kroków** |
| `checked` | `change` checkboxa/radia | boolean |
| `key` | `key` | tylko `Enter`, `Escape`, `Tab`, strzałki; nigdy znaki |
| `url`, `via` | `navigate` | adres i sposób (`navigate`, `reload`, `back_forward`, `pushState`, `replaceState`, `popstate`, `hashchange`) |

Kolejne wpisywanie w to samo pole to jeden krok `input` z ostatnią długością.

### `network[]`

Jak w v2 (`t`, `doc`, `method`, `url`, `status`, `statusText`, `ok`, `redirected`, `durationMs`, `requestHeaders`, `responseHeaders`,
`requestBody`, `error`), plus:

| Pole | Typ | Opis |
|---|---|---|
| `type` | `fetch` \| `xhr` \| `img` \| `script` \| `css` \| `font` \| `other` | **zmiana semantyki**: zasoby z Resource Timing są osobnymi wpisami; rodzaj z rozszerzenia pliku i `initiatorType` |
| `status` | integer \| null | status HTTP. `null` zawsze z `statusUnavailable` (zasoby) albo z `error` (nieudany fetch). XHR zakończony błędem ma `status: 0` i `error` (`error`/`abort`/`timeout`). Samo `0` bez wyjaśnienia jest niezgodne ze schematem |
| `statusUnavailable` | string, opcjonalne | `cross-origin` (zasób z innego originu, przeglądarka ukrywa status), `unsupported-browser`, `network-error` (zasób nie doszedł), `unknown` |
| `sizeBytes` | integer \| null | bajty treści z sieci (`encodedBodySize`, przed dekompresją); `null`, gdy nieznane (cross-origin bez `Timing-Allow-Origin`) |
| `initiatorType` | string, opcjonalne | surowy `initiatorType` zasobu |
| `responseBodyPreview` | string, opcjonalne | tylko fetch/XHR ze statusem ≥ 400 i typem tekstowym (`text/*`, JSON, XML); ≤ 4096 znaków; tokeny (JWT, Bearer, klucze wrażliwe) zastąpione `"[redacted:<reguła>]"` |
| `responseBodyTruncated` | boolean, opcjonalne | `true`, gdy podgląd obcięto do limitu |

Podglądy łącznie ≤ 262 144 znaków: ponad budżet starsze podglądy tracą pole, `truncated.responseBodies` = `true` i jest notatka.

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
i notatka z powodem. W fallbacku konsolowym zrzutów nie ma („Screenshots are not available without the extension.”).

### Limity i ograniczenia

- `steps` ≤ 2000 w paczce i na dokument; zostają najnowsze, `truncated.steps` jak dla innych tablic.
- `stack` ≤ 16 000 znaków; argument konsoli po serializacji ≤ 40 000 znaków (`entryChars`).
- iframe: z iframe'ów tego samego originu (do 20 naraz, zagnieżdżenie do 2) zbierane są tylko błędy (`console.error`,
  `error`, `unhandledrejection`) z polem `frame`. Błędy sprzed podpięcia ramki (przed jej `load`) giną. Ramek z innego originu nie widać.
  Kroki, sieć i metryki pochodzą tylko z dokumentu głównego.
- Zasoby: wpis powstaje po zakończeniu pobierania, więc zasoby jeszcze ładowane w chwili zapisu nie mają wpisu. Zasoby z innego
  originu mają `status: null` + `statusUnavailable: "cross-origin"` i zwykle `sizeBytes: null`.
- Firefox: brak `layout-shift` i long animation frames, więc `CLS` i `longTasks` mają `available: false`,
  `reason: "unsupported-browser"`.
- Fallback konsolowy: te same klucze wymagane; `INP` tylko z interakcji po wklejeniu skryptu (notatka).

### Przykład

Pełny przykład (2 dokumenty, kroki, zasoby, metryki dostępne i niedostępne, zrzut 1×1 px): `tests/fixtures/snapshots/v3.json`.
Plik jest wynikiem `assemblePackage` dla danych z `tests/unit/snapshot-validator.test.js`. Po zamierzonej zmianie kształtu paczki
odświeżasz go komendą `PDS_UPDATE_FIXTURES=1 npx vitest run tests/unit/snapshot-validator.test.js`. Skrót:

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

### Wpis zmian

- **v3 (E2, rozszerzenie 0.4.0):** kroki zgłaszającego (`steps`), metryki CWV z atrybucją i długie zadania (`vitals`), zasoby strony
  i status dokumentu (`network`, `documents[].status`), fragment treści odpowiedzi błędów, zrzut ekranu (`screenshots` + `attachments`),
  pełniejsze stosy z `cause`, blok `overview`, kolejność kluczy pod czytanie od góry.
- **v2 (E1, rozszerzenie 0.3.0):** czas `t` względem `timeOrigin` dokumentu, wiele dokumentów w paczce (`documents`), `limits`,
  `truncated`, `source`, fallback konsolowy.
- **v1 (E0, rozszerzenie 1.0.0):** baseline, czasy ISO w rekordach.
