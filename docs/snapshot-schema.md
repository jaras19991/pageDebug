# Schemat paczki snapshotu

Źródło prawdy o strukturze pliku `page-debug-snapshot-<timestamp>.json`. Reguły wersjonowania: skill `snapshot-schema`.
Plik generuje `src/page/page-debug-snapshot.js` (metoda `snapshot()`); `schemaVersion` w rozumieniu skilla
liczymy od `1` dla obecnego kodu, choć plik **nie zawiera jeszcze pola `schemaVersion`** — rozpoznajesz wersję
po `version: "1.0.0"` i braku `schemaVersion`. Test regresji kluczy: `tests/e2e/smoke.spec.js`.

## Wersja 1 (baseline, rozszerzenie 1.0.0)

Redakcja danych wrażliwych **nie istnieje** do E3: wszystkie kolumny „redagowane” poniżej to „nie”, poza jednym wyjątkiem
opisanym przy `dom.forms` (wartości pól typu `password` i `hidden` są podmieniane na `"[redacted]"`; wartość pola hasła
pozostaje jednak jawna w `dom.html.outerHTML`). Czasy w rekordach to ciągi ISO (`timestamp`, `startedAt`) — do zmiany w E1.

### Klucze najwyższego poziomu

| Ścieżka | Typ | Opis | Od kiedy | Redagowane |
|---|---|---|---|---|
| `version` | string | wersja formatu paczki, `"1.0.0"` | v1 | nie |
| `collectedAt` | string (ISO) | chwila wykonania zrzutu | v1 | nie |
| `initializedAt` | string (ISO) | chwila wstrzyknięcia skryptu na stronę; zbieranie logów zaczyna się wtedy | v1 | nie |
| `notes` | string[] | ograniczenia zbierania (np. „captured only from initialization time”) | v1 | nie |
| `environment` | object | `timestamp`, `location` (pełny adres z `search` i `hash`), `document` (tytuł, referrer, stan), `navigator` (userAgent, język, platforma…), `screen`, `viewport` | v1 | nie |
| `dom` | object | `counts`, `html` (`doctype`, `lang`, `charset`, `outerHTML` do 2 000 000 znaków), `meta`, `canonical`, `hreflangs`, `scripts`, `stylesheets`, `images`, `iframes`, `forms`, `rootMarkers` | v1 | częściowo: `dom.forms[].elements[].value` dla `password`/`hidden` = `"[redacted]"` |
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

## Zmiany między wersjami

Brak. Wersja 1 jest punktem odniesienia (baseline); E0 nie zmieniło schematu.
