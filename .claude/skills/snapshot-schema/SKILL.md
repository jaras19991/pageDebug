---
name: snapshot-schema
description: Kontrakt danych paczki Page Debug Snapshot — struktura snapshot.json, wersjonowanie schemaVersion, konwencje czasu i limitów, zasady dodawania pól. Czytaj gdy zmieniasz, co trafia do paczki, piszesz summary/viewer/MCP lub dokumentujesz schemat.
---

# Schema paczki

Paczka to jedno źródło prawdy dla trzech konsumentów: `summary.md`, `viewer.html`, `page-debug-mcp`.
Każda zmiana struktury musi być jawna i wersjonowana, inaczej któryś z nich się rozjedzie.

## Zasady

1. **`schemaVersion`** (integer) na górze `snapshot.json`. Obecny kod (wersja z `version: '1.0.0'`,
   bez `schemaVersion`) traktujemy jako `schemaVersion: 1`. Pierwsza zmiana → `2` (**zrealizowane w E1**, rozszerzenie 0.3.0; `SCHEMA_VERSION` w `src/lib/package.js`).
   Podbijasz, gdy: usuwasz/zmieniasz nazwę lub typ pola, zmieniasz semantykę (np. jednostkę czasu).
   **Nie** podbijasz, gdy tylko dodajesz pole opcjonalne — ale dopisujesz je do `docs/snapshot-schema.md`
   z adnotacją „od wersji rozszerzenia x.y.z”.
2. **Konsumenci czytają defensywnie**: brak pola = `undefined`, nie wyjątek. Viewer i MCP wspierają
   wszystkie wersje ≥ 1 (tabela migracji w `docs/snapshot-schema.md`).
3. **Czas**: wszystkie znaczniki w rekordach to `t` — milisekundy od `performance.timeOrigin` (number).
   Jedno pole ISO w nagłówku: `collectedAt`, `recordingStartedAt`. Nie mieszaj (v1 miało ISO w każdym
   rekordzie — zmienione w v2/E1; `t` liczone od `documents[doc].timeOrigin` **swojego** dokumentu).
4. **Limity** są częścią schematu: każda tablica ma w nagłówku `limits.<nazwa>` (max) i `truncated.<nazwa>`
   (bool). Developer ma wiedzieć, że czegoś brakuje.
5. **Redakcja** zostawia ślad: pole zastąpione → `"[redacted:<reguła>]"` (string), nigdy `null`
   (null = „nie było”). Zbiorczy raport w `redaction` (liczby, bez wartości).
6. **Brak danych binarnych w JSON** poza małymi rzeczami. Do E3 zrzut leży w `attachments['screenshot-0']`
   (data URL base64, ostatni klucz paczki, po `dom`); w `screenshots[]` tylko metadane
   `{ t, doc, reason, mime, width, height, bytes, attachment }`. Osobny plik w zipie (`screenshot.jpg`) dopiero od E3/E4.

## Docelowa struktura (kierunek dla E1–E4; pola oznaczone epikiem, w którym się pojawiają)

**Stan: aktualna wersja to 4 (E3, release 0.5.0).** Pola i kolejność kluczy: `docs/snapshot-schema.md` (z migracją v3→v4);
walidator (unit i e2e): `tests/helpers/snapshot-validator.js`; fixture `tests/fixtures/snapshots/v4.json` (generowany potokiem
`exportPackage`, `src/lib/export.js`; `v3.json` zamrożony). Kontener: zip `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`
(`snapshot.json`, `summary.md`, opcjonalnie `screenshot.jpg`). v4: `redaction` po `overview`; usunięte `attachments`
i `dom.html.outerHTML`; `storage.cookies` = `[{name, sizeBytes, valueHash}]` + `cookiesTotalBytes`; `dom.structure`/`dom.fullHtml`;
`altLength`/`titleLength`/`valueLength`/`fileCount`; `screenshots[].file` + `maskedFields`.
Poniższy szkic to kierunek: pola z oznaczeniem E4 jeszcze nie istnieją; E1–E3 dodały m.in. `documents[]`, `recordingStoppedReason`,
`overview`, `steps`, `vitals`, `screenshots`, `redaction`, których szkic nie pokazuje w pełni.

```jsonc
{
  "schemaVersion": 2,
  "extensionVersion": "0.3.0",
  "collectedAt": "ISO",
  "recordingStartedAt": "ISO",            // E1
  "timeOrigin": 1760950000000,
  "source": "extension" | "console",      // E1 (fallback jednoplikowy)
  "limits": { "consoleLogs": 5000, "network": 5000, "steps": 2000, "html": 300000 },
  "truncated": { "consoleLogs": false, "network": false, "steps": false, "html": true },

  "environment": { "location": {}, "document": {}, "navigator": {}, "screen": {}, "viewport": {} },

  "steps": [                              // E2 — co użytkownik robił
    { "t": 1234.5, "type": "click|input|submit|navigate|keydown", "selector": "#login > button",
      "text": "Zaloguj", "inputType": "email", "valueLength": 18, "url": "…" }
  ],

  "consoleLogs": [
    { "t": 1200.1, "level": "error", "args": [], "stack": "…" }   // stack: E2
  ],
  "runtimeErrors": [
    { "t": 1300.0, "type": "error|unhandledrejection", "message": "", "filename": "", "lineno": 0,
      "colno": 0, "stack": "" }
  ],

  "network": [
    { "t": 900.0, "type": "fetch|xhr|resource", "method": "GET", "url": "…", "status": 500,  // status: E2
      "ok": false, "durationMs": 312.4, "sizeBytes": 1234, "requestHeaders": {}, "responseHeaders": {},
      "responseBodyPreview": "…", "initiator": "script", "error": null }
  ],

  "vitals": {                             // E2
    "TTFB": { "value": 47, "rating": "good" },
    "FCP":  { "value": 820, "rating": "good" },
    "LCP":  { "value": 2100, "rating": "good", "element": "img.hero", "url": "…" },
    "CLS":  { "value": 0.18, "rating": "needs-improvement", "sources": [{ "selector": "…", "shift": 0.12 }] },
    "INP":  { "value": 350, "rating": "poor", "target": "button#save", "eventType": "click" },
    "longTasks": [{ "t": 1500, "duration": 180, "attribution": "…" }]
  },

  "performance": { "navigation": {}, "resources": [] },   // bez zmian; resources skrócone do pól użytecznych

  "dom": {                                // E3 — struktura zamiast outerHTML
    "counts": {}, "doctype": {}, "lang": "pl", "charset": "UTF-8",
    "structure": "<html><head>…</head><body class=\"…\"><div id=\"app\">…",   // bez tekstów, bez value, bez <script>
    "fullHtml": null,                     // tylko gdy developer włączył
    "meta": [], "scripts": [], "stylesheets": [], "images": [], "iframes": [], "forms": []
  },

  "storage": {                            // E3 — hashe zamiast wartości
    "cookies": [{ "name": "sid", "sizeBytes": 93, "valueHash": "a1b2c3d4" }],
    "cookiesTotalBytes": 6250,
    "localStorage": { "token": "[redacted:key-token]", "theme": "dark" },
    "sessionStorage": {}
  },

  "screenshots": [{ "t": 4000, "file": "screenshot.jpg", "reason": "save|error" }],  // E3+ (w v3: metadane + attachment, bajty w attachments)

  "redaction": { "rulesVersion": 1, "masked": { "storage": 3, "network.headers": 2, "console": 1 } },  // E3

  "notes": ["…"]                          // ograniczenia, o których developer ma wiedzieć
}
```

## Zawartość zipa (E3+)

```
snapshot-<host>-<YYYYMMDD-HHMMSS>.zip
├── snapshot.json
├── summary.md          // E4 — generowany z snapshot.json tym samym modułem co viewer/MCP
└── screenshot.jpg      // E3+ — opcjonalny (w v3 w attachments)
```

## Checklist przy zmianie schematu

- [ ] `schemaVersion` podbity (jeśli zmiana łamiąca) i stała w kodzie zaktualizowana.
- [ ] `docs/snapshot-schema.md` — tabela pól + sekcja „Zmiany vs poprzednia wersja”.
- [ ] `summarize.js`, `viewer.html`, MCP — obsługują nowe i stare pole (jeśli istnieją).
- [ ] Fixture `tests/fixtures/snapshots/v<N>.json` dodany; testy snapshotowe `summary.md` zaktualizowane.
- [ ] Redakcja obejmuje nowe pole (jeśli może zawierać dane użytkownika).
