# E4-S0 — spike: API przeglądarek dla E4

Data: 2026-10-26. Skrypt: `tests/e2e/spike-e4/run.spike.mjs` (nieśledzony jak `spike-e3`), minimalne rozszerzenie
`tests/e2e/spike-e4/ext/` (`downloads`, `storage`, `storage.managed_schema`), sonda viewera `tests/e2e/spike-e4/viewer-probe.html`
(generowana przez `--write-probe`: hashe CSP liczone w skrypcie, zip z `src/lib/zip.js` `createZip`). Rozszerzenie i pobrania
idą do katalogu tymczasowego; `src/`, `dist/` i manifesty nie są ruszane.

```
node tests/e2e/spike-e4/run.spike.mjs              # S1 + S2, Chromium (Playwright, channel 'chromium')
node tests/e2e/spike-e4/run.spike.mjs --shell      # tylko S2, chrome-headless-shell (sandbox bez gniazd unix)
node tests/e2e/spike-e4/run.spike.mjs --firefox    # S3: S1 + S2 + storage.managed w Firefoksie (web-ext + Marionette)
node tests/e2e/spike-e4/run.spike.mjs --lint       # S3: web-ext lint z i bez storage.managed_schema
node tests/e2e/spike-e4/run.spike.mjs --write-probe
```

## Wyniki

| Punkt | Wynik | Gdzie |
|---|---|---|
| `spike: S2 CSP hash allows inline, blocks network, allows blob img` | **PASS** | Chromium 156.0.8078.4 (headless shell), Linux/WSL, `file://` |
| `spike: S2 deflate-raw unzip on file://` | **PASS** | jw. |
| (dodatkowo) S2 odczyt zipa wybranego przez `<input type=file>` | **PASS** | jw. |
| `spike: S3` lint: manifest Firefoksa bez klucza `storage` — 0 błędów | **PASS** | web-ext 10.8.0, Linux node |
| `spike: S1 exists after delete within 300 ms` | **PASS** (2026-10-27, patrz „Wyniki S1”) | Chromium 156.0.8078.4 pełny, headless, Linux/WSL |
| `spike: S1 show on missing file does not throw` | **PASS** (bez wyjątku, ale bez sygnału) | jw. |
| `spike: S1 managed storage without a policy (Chrome)` | **FAIL wg skryptu** — `storage.managed.get` bez polityki nie odpowiada w 1 s (timeout), nie odrzuca | jw. |
| `spike: S3 (manual checklist)` | **do ręcznego potwierdzenia** | lista niżej |

Dowody S2 (Chromium): skrypt z hashem wykonany, styl z hashem zastosowany (`rgb(1, 2, 3)`); drugi inline `<script>` bez hasha
i atrybut `onerror` na `<img src=x>` **nie** wykonane; `fetch('http://127.0.0.1:<port>/fetch')` → `TypeError`, `<img src=http…>` → `error`,
**serwer lokalny nie dostał ani jednego żądania**; `<img>` z `blob:` (PNG 1×1) → `load`, `naturalWidth = 1`. Zdarzenia
`securitypolicyviolation`: `script-src-attr` (inline), `img-src` (`file`), `script-src-elem` (inline), `connect-src` (http), `img-src` (http).
Zip z `createZip` (2 wpisy, metoda 8) rozpakowany przez `DecompressionStream('deflate-raw')` z poprawnym CRC32 — zarówno osadzony
w stronie, jak i wybrany z dysku (`File.arrayBuffer()` z `file://` działa). `new Response(stream).arrayBuffer()` do zebrania strumienia
działa pod `default-src 'none'` (to nie jest żądanie sieciowe).

Dowody lint (S3): manifest w kształcie `dist/firefox` (bez `storage`) — 0 błędów, 2 ostrzeżenia `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`
/ `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` od `data_collection_permissions` (to samo co w obecnym `dist/firefox`, niezwiązane z E4).
Ten sam manifest **z** `storage.managed_schema` — **dokładnie te same** ostrzeżenia, **brak dodatkowego** wpisu dla `storage`.

## Ograniczenia środowiska (dlaczego S1 i S3 nie poszły automatycznie)

- Pełny Chromium (`channel: 'chromium'`, jedyny, który ładuje rozszerzenia) w sandboxie WSL kończy się `FATAL process_singleton_posix.cc:
  socket() failed: Operation not permitted` — sandbox blokuje gniazda unix. Brakujące `libnss3`/`libnspr4`/`libasound2` dało się
  rozpakować z `.deb` do `$TMPDIR` (`LD_LIBRARY_PATH`), więc S2 poszedł na chrome-headless-shell (`--shell`), który nie ładuje rozszerzeń.
- Node z Windows (`node.exe`, droga z `extension-testing` dla e2e w WSL) wymaga wyjścia poza sandbox — odmowa uprawnień w tej sesji.
- Firefox jest tylko w Windows (`C:\Program Files\Mozilla Firefox`), więc `--firefox` wymaga tego samego co wyżej.

**Do uruchomienia przez użytkownika (Windows, PowerShell w katalogu repo, ~2 min):**
`node tests\e2e\spike-e4\run.spike.mjs` i `node tests\e2e\spike-e4\run.spike.mjs --firefox`. Uwaga: `downloads.show` otworzy okno Eksploratora
(raz dla istniejącego pliku, ewentualnie raz dla usuniętego) — to oczekiwane. Wyniki PASS/FAIL z dowodami wkleić do tabeli wyżej.

## S3 — lista ręczna (Firefox ≥ 128, Windows 11; macOS jeśli dostępny)

Przygotowanie: `npx web-ext run --source-dir <kopia tests/e2e/spike-e4/ext z manifestem Firefoksa>` albo tylko `--firefox` (robi to
automatycznie: punkty 1–3 i 5). Ręcznie zostaje punkt 4 i ocena okna menedżera plików.

1. `storage.managed.get('disabledRules')` **bez polityki**: zapisać, czy odrzuca, jaki komunikat (oczekiwane „Managed storage manifest
   not found”) i w jakim czasie (musi < 1 s, inaczej timeout z D5 jest jedyną ochroną).
2. `downloads.download(blob:)` → `search({id}).exists` → usunąć plik z dysku → `search` od razu / po 300 ms; czy przychodzi `onChanged`
   z `exists.current === false` (sam z siebie czy dopiero po `search`).
3. `downloads.show(id)`: na istniejącym pliku (otwiera menedżer z zaznaczonym plikiem? zwraca `true`?), na usuniętym (`false`, wyjątek,
   czy otwiera folder?), na nieznanym id (odrzucenie?).
4. **Z polityką**: `C:\Program Files\Mozilla Firefox\distribution\policies.json` (wymaga administratora; po teście usunąć):
   `{ "policies": { "3rdparty": { "Extensions": { "pds-spike-e4@example.invalid": { "disabledRules": ["email"] } } } } }`
   → restart Firefoksa → `about:policies` pokazuje politykę → strona `page.html?auto=1` rozszerzenia: `managed.value` ma
   `{ disabledRules: ["email"] }`. Sprawdzić też z kluczem spoza schematu (np. `"foo": 1`) — czy Firefox go przepuszcza (brak schematu).
5. S2 w Firefoksie: otworzyć `tests/e2e/spike-e4/viewer-probe.html` z dysku (`file://`), dopisać `#port=9`; pole wyniku: `style` =
   `rgb(1, 2, 3)`, `unhashedScript: false`, `onerrorAttr: false`, `fetch: "blocked…"`, `httpImg.result: "error"`, `blobImg.result: "load"`,
   `unzip` — 2 wpisy `ok: true`. Wybrać dowolny zip paczki 0.5.0 przez „Przeglądaj” → `fileUnzip` z `ok: true`.
6. Chrome z polityką (opcjonalnie, do D4b-QA): `HKCU\Software\Policies\Google\Chrome\3rdparty\extensions\<id>\policy` lub
   `/etc/opt/chrome/policies/managed/*.json`; `chrome://policy` pokazuje wartość; `storage.managed.get` ją zwraca.

## Wnioski dla designu

- **D3 (CSP meta z hashami na `file://`)** — **potwierdzone w Chromium**, bez zmian. Wskazówki dla T3a/T3b: hash liczyć z dokładnej treści
  między `<script>`/`</script>` (bez zmiany białych znaków po wyliczeniu); `<style>` też wymaga hasha (bez niego styl nie działa);
  `URL.createObjectURL` + `img.src = blobUrl` wystarcza; zbieranie strumienia przez `new Response(stream)` jest dozwolone.
  Firefox — do ręcznego potwierdzenia (punkt 5) przed QA AC-4.1; dla T3b nie blokuje.
- **D5 (`managed_schema` tylko w Chrome)** — decyzja **bez zmian**, ale **poprawka uzasadnienia**: web-ext 10.8.0 **nie ostrzega** o
  `storage.managed_schema` (design: „`web-ext lint` ostrzega”). Klucz zostaje tylko w `manifest.chrome.json`, bo Firefox go nie używa,
  a `dist/firefox` ma nie mieć zbędnych plików. Test D4b „`web-ext lint` bez nowych ostrzeżeń” przejdzie w obu wariantach — nie może
  służyć jako dowód, że klucza nie ma w Firefoksie; to sprawdza `manifest-parity`/test plików `dist/firefox`.
  Zachowanie Firefoksa bez polityki (rzuca/czas) i z `policies.json` — do potwierdzenia (punkty 1, 4); timeout 1 s z D5 zostaje niezależnie.
- **D7 (kolejność `search`/`show`)** — **bez zmian do czasu wyniku S1** (nie uruchomiono). Hipoteza do sprawdzenia: w Chrome sprawdzenie
  istnienia pliku startuje dopiero po `downloads.search` i jest asynchroniczne, więc pierwszy `search` po usunięciu może zwrócić
  `exists: true`, a `onChanged` z `exists: false` przychodzi chwilę później — dokładnie to, co D7 obsługuje przez `search` przy renderze
  i ponownie przy kliknięciu. Jeśli S1 pokaże `exists: true` także w drugim `search` po > 300 ms, D7 potrzebuje poprawki (np. krótkie
  czekanie na `onChanged` po kliknięciu) — wtedy wraca do architekta przed T2b.

## Do decyzji

1. Uruchomienie S1 (Chromium z rozszerzeniem) i `--firefox` po stronie Windows przez użytkownika — bez tego D7 i część D5 zostają
   niepotwierdzone. Wynik S1 jest potrzebny przed T2b, wynik S3 przed D4b-QA i QA AC-1.2/AC-4.1.
2. Punkt 4 (polityka Firefoksa) wymaga zapisu do `Program Files` jako administrator — tylko ręcznie, za zgodą użytkownika.


## Wyniki S1 (Chromium 156, pełny, headless, 2026-10-27, uruchomione poza sandboxem)

- `downloads.search({id})` zaraz po pobraniu: `state: complete`, `exists: true`.
- Po usunięciu pliku z dysku: **pierwszy `search` (0 ms) już zwraca `exists: false`** (search wymusza sprawdzenie), kolejny po 300 ms też `false`.
  Samoczynny `downloads.onChanged` z `exists.current: false` przychodzi po ok. 656 ms od usunięcia, także bez `search`.
- `downloads.show(id)`: dla istniejącego, **usuniętego** i nieznanego id zwraca `undefined` synchronicznie i `undefined` po `await`,
  `runtime.lastError` puste. Czyli **`show` nie sygnalizuje braku pliku w żaden sposób** i nie rzuca.
- `storage.managed.get('disabledRules')` bez polityki w Chromium: **nie odrzuca szybko, tylko nie odpowiada w 1 s** (timeout skryptu).
  Ochrona `timeoutMs = 1000` w `src/lib/dev-options.js` jest tu jedyną ochroną i działa tak, jak zaprojektowano (D5).

Wniosek dla popupu: sprawdzenie `search` tuż przed `show` (kontroler to robi) wystarcza do wykrycia usuniętego pliku, bo `search` sam wymusza
`exists`. Powtórne sprawdzenie po `FILE_RECHECK_MS = 500` jest zbędne dla Chrome, ale nieszkodliwe (łapie ewentualne opóźnienie
na innych platformach) i pasuje do samoczynnego `onChanged` po ~650 ms. Defensywna obsługa w `controller.js` (`show` w try/catch,
`false` z Firefoksa = brak pliku, `undefined` = bez błędu) jest zgodna z wynikiem. Nie zmieniać. Firefox (S3) nadal do ręcznego potwierdzenia.
