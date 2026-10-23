# Schemat paczki snapshotu

Źródło prawdy o strukturze pliku `page-debug-snapshot-<timestamp>.json`. Reguły wersjonowania: skill `snapshot-schema`.
Aktualna wersja: **2** (od E1). Paczkę v2 składa `assemblePackage` z `src/lib/package.js` (tło rozszerzenia i fallback
konsolowy). Rozpoznawanie przy odczycie: jest `schemaVersion` → ta wersja; brak `schemaVersion` i `version: "1.0.0"` →
wersja 1 (tabela migracji na końcu). Przykład v2: `tests/fixtures/snapshots/v2.json` (dane syntetyczne).

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
