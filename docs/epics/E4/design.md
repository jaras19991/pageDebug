# E4 — Design

## Pytania do bramki

> **Rozstrzygnięte 2026-10-26 (bramka Design):** PB-1 → (A) własny transport, bez SDK. PB-2 → wąski wyjątek „proza” jak niżej. Design zatwierdzony.

**PB-1 (odstępstwo od tekstu backlogu E4-D3): serwer MCP bez `@modelcontextprotocol/sdk`.** Backlog wymienia SDK. Proponuję
własny, minimalny transport stdio JSON-RPC 2.0 (≈ 200 linii, zero zależności runtime). Szczegóły w D6.
- **(A) — rekomendacja:** własna implementacja. `npm audit --omit=dev` = 0 z konstrukcji, a AC-5.8 („bez połączeń sieciowych”) da się
  sprawdzić statycznie na naszym kodzie. Nie trzeba `npm install` w WSL (pamięć projektu: tylko po stronie Windows). Zgodność z klientami
  sprawdza test integracyjny protokołu (TEST3) i QA z Claude Code (AC-5.1).
- **(B):** SDK w `dependencies` pakietu `mcp/`. Dostajemy oficjalną obsługę protokołu. Płacimy ≈ 15 pakietami przechodnimi
  (zod, express, cors, eventsource…) dla transportu, którego nie używamy, i ryzykiem advisory „high” w `npm audit --omit=dev`
  (warunek release z NFR), a SDK ma już historię takich zgłoszeń.

**PB-2 (granica reguły z AC-2.3): wyjątek „proza” w IN1.** AC-2.3 wymaga, żeby `auth: "Invalid credentials"` nie było maskowane. Proponuję
wąski wyjątek. Dotyczy tylko formy `klucz: "wartość"` z kluczem **bez cudzysłowu** (nie JSON `"k":`), tylko tokenów `auth`, `session`
i `key`, i tylko wartości złożonej z ≥ 2 słów zawierających wyłącznie litery, bez cyfr i symboli. `password`, `token`, `secret`
i reszta listy są maskowane zawsze. Cena: hasło z samych słów pod kluczem `auth: "…"` w tekście nie zostanie zamaskowane. Wpisujemy to do README
„Znane ograniczenia”. Alternatywa: wyjątek dla każdego tokenu z listy. Odradzam, bo hasło-fraza pod `password: "correct horse battery"` by wyciekło.

**Informacja (nie wymaga decyzji, ale decyduje o store review):** zmienia się manifest Chrome. Dochodzi klucz
`storage.managed_schema` i plik `managed-schema.json` (D4, polityka przedsiębiorstwa z Q-1). `permissions`
i `optional_host_permissions` zostają bez zmian, więc nie ma nowych ostrzeżeń. Zmienia się też tekst zgody (IN8) i lista ujawnień (AC-6.5),
dlatego **store reviewer powinien przejść ten epik** (lekko: manifest + teksty popupu).

**Odstępstwa od wytycznych architekta (zamknięte decyzje, bez zmian):** kanał MAIN ↔ ISOLATED **nie** używa `window.postMessage` z nonce.
Zostaje E1 D3 (prywatny odłączony węzeł DOM, `CustomEvent`, nonce w każdej wiadomości), zgodnie ze skillem `mv3-extension-rules`.
E4 nie dodaje do kanału żadnego nowego typu wiadomości.

## Kontekst
Wersja 0.5.0 zapisuje zredagowany zip v4 (`snapshot.json`, minimalny `summary.md`, `screenshot.jpg?`). Po zapisie zgłaszający widzi tylko
linię statusu. Developer nie ma viewera ani narzędzia dla agenta. Zostały też znane luki redakcji IN1–IN5 i drobne braki notatek i maski (IN6, IN7, IN11).
E4 dodaje cztery rzeczy, bez nowych uprawnień i bez wysyłki. Pierwsza to ekran *Zapisano* z „Pokaż plik”. Druga to pełny `summary.md` z jednej
warstwy zapytań, wspólnej dla rozszerzenia, jednoplikowego viewera offline i lokalnego serwera MCP. Trzecia to konfiguracja reguł *Domyślnie*
(plik wbudowany przy buildzie, z możliwością nadpisania polityką). Czwarta to domknięcie luk redakcji w zamkniętym korpusie (`rulesVersion: 2`, `schemaVersion` zostaje 4).

## Decyzje

Bez zmian zostają: E1 D1–D3, D5–D8 (rejestracja per origin, tło bez stanu, prywatny kanał, hooki Proxy, moduły ES + generator, Blob
i `downloads.download` w popupie z werdyktem z tła, uprawnienia); E2 D3a, D4, D5; E3 D1–D12 (redakcja w tle + u źródła, silnik z mapą sekcji,
SHA-256, struktura DOM, maska zrzutu fail-closed, własny writer ZIP, budżet 2 MB, `summary.md` jako moduł w `src/lib`, `devOptions` jako wejście potoku).

### D1 Jedna warstwa danych dla trzech konsumentów: moduły `src/lib` bez bundlera w rozszerzeniu i MCP, bundlowane tylko do viewera
Opcje:
(a) osobne implementacje w rozszerzeniu, viewerze i MCP;
(b) **czyste moduły ES w `src/lib`** (bez `chrome.*`, DOM i zegara). Rozszerzenie ładuje je natywnie (ESM w SW/popupie, walker builda
kopiuje tylko osiągalne). MCP importuje je względną ścieżką (`../src/lib/…`, Node ≥ 20 ESM). Viewer dostaje je zinlinowane przez
istniejący generator `scripts/gen-content.mjs` (ten sam, który dziś składa `console-snapshot.js` z `src/page` + `src/lib`);
(c) kopia modułów w `mcp/lib` i w viewerze, synchronizowana skryptem.
**Wybór: (b).**
Uzasadnienie: NFR „Spójność” i AC-5.3 wymagają bajtowo tego samego tekstu w `summary.md`, zakładce Podsumowanie i `get_summary`. Jedno źródło
kodu załatwia to z definicji. Mechanizm już istnieje i jest przetestowany: generator inlinuje `src/lib` do jednoplikowego fallbacku, więc
wystarczy mu nowy cel HTML. Nie potrzeba nowego bundlera ani zależności. (c) tworzy trzecią kopię do pilnowania. (a) łamie AC-5.3.
Podział modułów:
- `src/lib/snapshot-query.js` — czas bezwzględny, kroki, błędy (grupy, pierwsza ramka stosu), nieudane zapytania, filtr sieci, oś czasu;
- `src/lib/snapshot-metrics.js` — CWV per dokument z oceną i powodem niedostępności, najwolniejsze zasoby, ciasteczka i flagi `truncated`;
- `src/lib/summary.js` — `buildSummary(snapshot)` (rozbudowa modułu E3; nazwa pliku zostaje, bo `export.js` i fallback już go importują:
  E4-D1 „summarize.js” = ten moduł);
- `src/lib/screenshot-notes.js` — teksty notatek o zrzucie (EN) i ich polski opis do summary (IN6, IN11);
- tylko poza rozszerzeniem: `src/lib/unzip.js`, `src/lib/migrate.js`, `src/lib/package-reader.js`, `src/lib/snapshot-diff.js`.
Konsekwencje: moduły osiągalne z `export.js` (summary, query, metrics, screenshot-notes) trafiają też do `console-snapshot.js`. Muszą więc
spełniać reguły składni `src/page` z CLAUDE.md (importy jednolinijkowe, bez `import(`/`require(`/`url(` nawet w komentarzach). Zip rozszerzenia
rośnie tylko o query + metrics + notes + dev-options (szac. ≈ 6–8 KB po kompresji, NFR ≤ 30 KB). `unzip/migrate/reader/diff` nie są osiągalne
z manifestu, więc nie trafiają do `dist/` (walker). MCP w E4 działa tylko z klonu repo. Przy publikacji w npm (E5) skrypt pakujący skopiuje
`src/lib` do paczki, co zapisujemy jako ryzyko 9.

### D2 `summary.md`: stała struktura, wartości strony w code spanach, twarde limity
Opcje dla bezpieczeństwa Markdown (AC-3.8):
(a) escapowanie backslashem wszystkich znaków interpunkcyjnych ASCII (CommonMark). Bezpieczne, ale adresy robią się nieczytelne
(`https\://example\.com/a\_b`) dla developera i agenta;
(b) **każda wartość pochodząca ze strony jako inline code span z adaptacyjnym ogrodzeniem.** Ogrodzenie ma o jeden backtick więcej niż
najdłuższy ciąg backticków w wartości, a wartość zaczynającą się lub kończącą backtickiem otacza spacja. Wcześniej nowe linie (`\r\n\u2028\u2029`)
zamieniamy na spację, a wartość ucinamy do limitu pola. W code spanie CommonMark nie interpretuje HTML, linków ani emfazy. Wartość
nigdy nie stoi na początku linii, więc nie zrobi nagłówka, elementu listy ani bloku kodu (ogrodzenie ``` musi zaczynać linię);
(c) blok kodu na całą sekcję (gubi strukturę listy).
**Wybór: (b).** Tekst surowy pozostaje czytelny dla agenta (adres w backtickach), a po wyrenderowaniu nic się nie wykonuje.
Teksty szablonów są nasze, po polsku. Wszystkie liczby formatuje jeden helper `num()` z przecinkiem dziesiętnym („12,4 s”, „0,18”).
Struktura (AC-3.1). Sekcja nigdy nie znika: bez danych ma jedną linię „brak — <powód>”, gdzie powód pochodzi z `notes`/`truncated` albo
jest stały (np. „brak — nie zarejestrowano kroków”):
```
# Paczka diagnostyczna — <host>
Zapisano <collectedAt> · rozszerzenie <v> · schemat <n> · <źródło> · błędy JS <n> · błędy konsoli <n> · nieudane zapytania <n> · kroki <n> · słabe metryki <n> · zrzut: <tak|nie>
## Środowisko        adres, przeglądarka, okno×DPR, język (≤ 5 linii)
## Kroki             „ostatnie N z M”; ≤ 20 × `- 12,4 s · click · `#save` · `Zapisz``; navigate z adresem; krok przed 1. błędem: sufiks „ ← ostatni krok przed pierwszym błędem”
## Błędy             ≤ 10 grup: `- 3× od 12,9 s · `TypeError: x is undefined` · `result.js:12:9``; „i N grup więcej”
## Nieudane zapytania ≤ 20: `- `POST` `https://…/api` → 500 (312 ms)` / `→ błąd: `net::ERR_FAILED``; „i N więcej”; nagłówek z liczbą = overview.failedRequests
## CWV               per dokument (ostatnie ≤ 5, „i N dokumentów wcześniej”): TTFB/FCP/LCP/CLS/INP „wartość (dobrze|do poprawy|słabo)” albo „niedostępne — <powód PL>”, nigdy 0
## Najwolniejsze zasoby 5 × `- 812 ms · script · 48 KB · `https://…``
## Ciasteczka i rozmiar liczba, `cookiesTotalBytes`; „Ucięte przez limity: consoleLogs, network” (flagi `truncated` = true)
## Prywatność        linia E3 z „reguły v2” + „Wyłączone przez developera: …” + linia o zrzucie (IN6/IN11, po polsku)
## Uwagi             pierwsze 10 `notes`
Pełne dane: snapshot.json; obraz: screenshot.jpg.
```
Limity pól (znaki): adres 160, komunikat 160, selektor 80, tekst kroku 40, notatka 160, user agent 160. Na koniec działa strażnik
`fitSummary`: gdy tekst przekracza 16 384 bajtów UTF-8 albo 200 linii, usuwa linie od końca sekcji w kolejności Uwagi → Najwolniejsze
zasoby → Środowisko → Kroki (najstarsze) → Nieudane zapytania. W każdej przyciętej sekcji zostawia linię „(skrócono)”. Nagłówek, Błędy, CWV
i Prywatność są nienaruszalne. Czas: jedno przejście po każdej tablicy (bez sortowania całej sieci; top-5 przez wstawianie), co mieści się
w ≤ 100 ms na 10 MB JSON (AC-3.7).
Kontrakt czystości: `buildSummary(x) === buildSummary(JSON.parse(JSON.stringify(x)))`. Summary czyta tylko pola JSON-owalne, a `undefined`/`NaN`
traktuje jak brak. Dzięki temu MCP i viewer, które dostają sparsowany plik, dają ten sam tekst co rozszerzenie (AC-5.3).
Konsekwencje: zmienia się treść wpisu `summary.md` w zipie, a schemat nie (spec „Dane”). Testy snapshotowe dla 3 paczek:
`tests/unit/__snapshots__/summary-{v4,heavy,console}.md` (`toMatchFileSnapshot`).

### D3 Viewer: jeden plik HTML generowany z `src/viewer`, CSP z hashami, wyłącznie `textContent`
Opcje:
(a) ręcznie pisany `viewer.html` z całym kodem w środku (duplikuje summary/query, łamie D1);
(b) **szablon `src/viewer/viewer.html` + moduły ES `src/viewer/*.js` → `npm run gen` → `src/standalone/viewer.html`**. Generator
wstawia bundel IIFE jako jedyny inline `<script>` i oblicza `sha256` skryptu i stylu do
`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src blob:; base-uri 'none'; form-action 'none'">`;
(c) viewer jako strona w rozszerzeniu (odrzucone przez Q-8).
**Wybór: (b).**
Uzasadnienie: jeden plik działa z `file://` w Chrome, Edge i Firefoksie, offline (AC-4.1). Ten sam generator i jego `--check` pilnują świeżości
(jak `console-snapshot.js`). CSP z hashami blokuje na poziomie przeglądarki wszystko, co mogłoby przyjść z paczki: skrypty inline,
`javascript:`, ładowanie obrazów z sieci, `fetch`. Daje to drugą warstwę obrony obok zasady kodu (AC-4.5, ryzyko 2 spec). Zrzut wyświetlamy
przez `URL.createObjectURL(Blob)` (`img-src blob:`).
Zasady renderowania (AC-4.5, E4-R1). Jedyny sposób tworzenia DOM to `src/viewer/dom.js`: `h(tag, attrs, ...children)`. Dzieci-stringi
stają się węzłami tekstowymi. `attrs` mają whitelistę (`class`, `id`, `role`, `aria-*`, `data-*`, `type`, `hidden`, `title`, `value`, `for`,
`placeholder`), nigdy `on*`, `href`, `src` ani `style`. Obraz ustawia tylko `setImageBytes(img, bytes)` przez URL `blob:`. Adresy z paczki
są tekstem, nigdy `<a>`. ESLint w `src/viewer/**` zabrania: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
`setAttribute`, `srcdoc`, `eval`/`Function`. Generator odrzuca bundel zawierający `</script` lub `<!--` (fail-safe, zamiast escapowania).
Wydajność: zakładki renderowane leniwie przy pierwszym otwarciu i trzymane w pamięci (≤ 300 ms przełączenia, AC-4.2). Sieć renderuje
po 200 wierszy z „Pokaż kolejne 200”, ale liczba wyników liczy wszystkie (AC-4.4). `dom.structure`/`fullHtml` jako tekst w `<pre>`,
`fullHtml` ucięty w widoku do 1 MB z informacją.
Konsekwencje: nowy cel generatora `HTML_BUNDLES = [{ out: 'standalone/viewer.html', template: 'viewer/viewer.html', entry: 'viewer/viewer-entry.js' }]`.
`npm run pack` kopiuje go do `dist/page-debug-viewer-<wersja>.html` (artefakt wydania). Rozmiar ≤ 300 KB sprawdza test. Moduły `src/viewer`
podlegają regułom składni generatora.

### D4 Odczyt paczki: własny `unzip.js` na `DecompressionStream`, migracja v1–v3 → kształt v4 przy odczycie
Opcje:
(a) `fflate` w viewerze/MCP (nowa zależność runtime w artefakcie wydania);
(b) **`src/lib/unzip.js`**: parser central directory (PKZIP 2.0), metoda 0 i 8 (`DecompressionStream('deflate-raw')`, Chrome ≥ 103, Firefox ≥ 113,
Node ≥ 18), CRC32 z `zip.js`, rozmiary z central directory (działa też z flagą data descriptor). Limity: ≤ 64 wpisy, wpis ≤ 64 MB,
suma ≤ 128 MB, stosunek kompresji ≤ 200 (zip bomb). ZIP64 i szyfrowanie → `ZipError('unsupported')`;
(c) `node:zlib` w MCP + osobny kod w viewerze (dwie ścieżki do testowania).
**Wybór: (b).** Ten sam kod w obu konsumentach, zero zależności, test na zipach z naszego `createZip`, `fflate` (devDependency) i `zip -X`.
Migracja (`src/lib/migrate.js`, Q-9). `normalizeSnapshot(raw) → { snapshot, sourceVersion, newer, warnings }`:
- v4: ten sam obiekt (bez kopii, bez mutacji; kontrakt D2);
- v3 → v4 wg tabeli z `docs/snapshot-schema.md`: `attachments[id]` → `extras.screenshotDataUrl`, `screenshots[].file`;
  `storage.cookies` string → `[{ name, sizeBytes, valueHash: null }]`; `dom.html.outerHTML` zostaje (viewer pokazuje go jako tekst);
  brak `redaction` → `null` („Brak informacji o maskowaniu.”);
- v2 → v3 → v4: brak `steps`/`vitals`/`screenshots` → `[]`;
- v1 (best-effort): jeden dokument `{ id: 0, url, timeOrigin: Date.parse(initializedAt) }`, `t` = ISO − `timeOrigin`;
- `schemaVersion` > 4: dane bez zmian, `newer: true`, ostrzeżenie „nowsza wersja paczki” (AC-4.7).
`src/lib/package-reader.js`: `readPackage(bytes) → { format, snapshot, sourceVersion, newer, warnings, summaryMd, screenshot }`. Rozpoznaje
format po `PK\x03\x04`, potem JSON. Błędy mają kody `not-package` | `corrupt` | `too-large` | `unsupported`, a viewer zamienia je na polskie
komunikaty, MCP na błąd narzędzia.
Konsekwencje: viewer i MCP zawsze liczą summary od nowa z `snapshot.json` (paczka 0.5.0 też dostaje pełne podsumowanie). `summaryMd` z zipa służy
tylko testom równości.

### D5 Konfiguracja reguł redakcji: moduł wbudowywany przy buildzie + `storage.managed` jako nadpisanie
Opcje źródła wbudowanego:
(a) plik JSON w `dist` czytany `fetch(runtime.getURL(…))`. To dodatkowe żądanie (zaciemnia AC-2.1), a walker wymaga literału;
(b) **moduł `src/lib/dev-config.js`** (`BUILT_IN_DEV_CONFIG = { disabledRules: [] }`), który `npm run build -- --config <plik.json>`
(albo `PDS_CONFIG=<plik>`) **zastępuje w `dist/<cel>/lib/dev-config.js`** wygenerowaną treścią z tego pliku, identycznie dla Chrome i Firefoksa.
Bez flagi build kopiuje moduł bajt w bajt, a pliku z katalogu repo **nie czyta niejawnie** (lokalna konfiguracja developera nie trafi
przypadkiem do zipa wydania);
(c) strona opcji (odrzucona przez Q-1/AC-6.2).
Opcje nadpisania: (i) brak; (ii) **`storage.managed`**: Chrome przez politykę `3rdparty.extensions.<id>` ze schematem
`storage.managed_schema`, Firefox przez `policies.json` → `3rdparty.Extensions.<gecko.id>` (bez schematu).
**Wybór: (b) + (ii).**
Semantyka: `loadDevOptions({ storage })` (`src/lib/dev-options.js`) czyta `storage.managed.get('disabledRules')` z timeoutem 1 s.
Brak, błąd albo odrzucenie (Firefox bez polityki rzuca „Managed storage manifest not found”) daje konfigurację wbudowaną. Jeśli polityka
ma tablicę `disabledRules`, **zastępuje** wbudowaną w całości (polityka może też włączyć z powrotem: `[]`). `sanitizeDevConfig(raw)`
zostawia tylko stringi z `DEFAULT_RULES` (`email`, `phone`, `html-structure`). Reguły *Zawsze*, nieznane nazwy, nieznane klucze i zły typ
są ignorowane w tej części i zwracane w `ignored` (AC-6.3). Funkcja nigdy nie rzuca, a zapis nigdy nie czeka dłużej niż 1 s.
Schemat Chrome (`src/managed-schema.json`): `{ "type": "object", "properties": { "disabledRules": { "type": "array", "items": { "type": "string" } } } }`
**bez `enum`**. Chrome odrzuca politykę niezgodną ze schematem w całości, więc filtrowanie zostaje u nas i działa tak samo w obu przeglądarkach.
Odczyt jest w tle przy każdym `collect` (bez stanu w pamięci) i w popupie przy otwarciu (AC-6.5). Fallback konsolowy nie czyta konfiguracji:
zawsze domyślne reguły, opis w README.
Konsekwencje: `manifest.chrome.json` dostaje `"storage": { "managed_schema": "managed-schema.json" }`. `TARGET_KEYS` w `scripts/lib/manifest.mjs`
dostaje `storage`, a walker (`manifestRefs`) dostaje `storage.managed_schema`. Firefox go nie ma, bo nie obsługuje tego klucza. `web-ext lint`
o nim **nie** ostrzega (spike S0), więc brak klucza w `dist/firefox` pilnuje test `manifest-parity`, nie lint. Z backlogowego E4-D4 odpada „adres do wysyłki” (decyzja 2026-10-26). „Pełny HTML” to `html-structure`,
a „progi redakcji” to `disabledRules`.

### D6 Serwer MCP: katalog `mcp/` w repo, własny transport stdio, tylko odczyt
Opcje: (A) własny JSON-RPC (rekomendacja, PB-1); (B) `@modelcontextprotocol/sdk`.
**Wybór (do bramki): (A).**
Transport (`mcp/server.js`): JSON-RPC 2.0, jedna wiadomość na linię UTF-8 na stdin/stdout, logi wyłącznie na stderr. Metody: `initialize`
(negocjacja `protocolVersion`: odpowiadamy wersją klienta, jeśli jest w `['2025-06-18', '2025-03-26', '2024-11-05']`, inaczej najnowszą;
`capabilities: { tools: { listChanged: false } }`; `serverInfo: { name: 'page-debug-mcp', version }`), `notifications/initialized` (ignorowane),
`ping`, `tools/list`, `tools/call`. Nieznana metoda → `-32601`, zły JSON → `-32700`, złe parametry → `-32602`. Błąd narzędzia → wynik
`{ isError: true, content: [{ type: 'text', text }] }`. Żaden wyjątek nie kończy procesu (AC-5.8).
Katalog (`mcp/snapshots-dir.js`): `node mcp/server.js <katalog>`. `id` = nazwa pliku (`*.zip`, `*.json`) bezpośrednio w katalogu.
Odrzucane jest `id` z `/`, `\`, `..`, NUL, ścieżką bezwzględną oraz takie, którego `realpath` wychodzi poza `realpath(katalog)`. Dowiązania
symboliczne są pomijane. Plik > 64 MB → błąd. Cache wyników `readPackage` po `(mtimeMs, size)`. `list_snapshots` sortuje po `collectedAt`
(fallback `mtime`) i pokazuje ≤ 200 najnowszych. Plik uszkodzony ma `{ id, file, error }` i nie przerywa listy.
Narzędzia (`mcp/tools.js`, 7 z AC-5.1): `list_snapshots()`, `get_summary(id)`, `get_errors(id, limit?)`, `get_network(id, { status?, failedOnly = true,
type?, method?, urlContains?, limit = 50, offset = 0, includeHeaders = false, includeBody = false })`, `get_vitals(id)`, `get_steps(id, limit?)`,
`diff_snapshots(a, b)`. Odpowiedź to JSON (bez wcięć), `get_summary` zwraca markdown. Czasy są bezwzględne (ISO) i względne (s od startu
nagrania). Strażnik `capResponse(text, hint)` ucina do 25 000 znaków i dopisuje
„… ucięto N znaków; zawęź zapytanie: <hint>” (AC-5.7).
Konsekwencje: `mcp/package.json` (`name: page-debug-mcp`, `type: module`, `bin`, `engines.node: ">=20"`, **bez `dependencies`**). Test statyczny
sprawdza, że `mcp/*.js` i moduły `src/lib`, które importuje, nie importują `node:net|http|https|tls|dgram|child_process` i nie wołają `fetch(`.
Pliki są czytane tylko przez `fs.promises.readFile`/`readdir`/`stat`/`realpath` (AC-5.8).

### D7 Ekran *Zapisano* i „Pokaż plik”: stan z `lastSaved` w tle, akcja `downloads.show` z popupu
Opcje:
(a) ekran jako lokalny stan popupu (znika po zamknięciu, łamie AC-1.6);
(b) **ekran wynika ze statusu tła**: `state: 'idle'` + `lastSaved` tej karty (`pds:last:<tabId>`, już istnieje, `storage.session` → znika
po restarcie przeglądarki). Tło czyści `lastSaved` karty dopiero przy udanym `start` (nowe nagranie). Przycisk „Nowe nagranie” na
ekranie *Zapisano* przełącza tylko widok lokalnie na *gotowe* (ujawnienia + zgoda + *Nagrywaj*), więc zamknięcie popupu przed *Nagrywaj* przywraca
*Zapisano* (AC-1.6). Ujawnienia zostają tam, gdzie jest przycisk zgody (wymóg CWS);
(c) *Nagrywaj* bezpośrednio na ekranie *Zapisano* (zgoda bez widocznego ujawnienia — odrzucone).
**Wybór: (b).**
„Pokaż plik” (AC-1.2): popup ma już `downloads`. Przy wyrenderowaniu ekranu woła `downloads.search({ id })`, co w Chrome uruchamia sprawdzenie
istnienia pliku. Przy kliknięciu woła `search` ponownie: brak wpisu, `state !== 'complete'` albo `exists === false` daje
`MESSAGES.fileMissing` („Nie znaleziono pliku. Zapisz paczkę ponownie.”). W przeciwnym razie `await Promise.resolve(api.downloads.show(id))`
(Chrome zwraca `void`, Firefox `Promise<boolean>`). `false` albo wyjątek też dają `fileMissing`. Wszystko w `try/catch`, bez wyjątku w konsoli.
`downloads.onChanged` z `exists.current === false` dla tego id pokazuje komunikat od razu. Metodę wołamy w chwili kliknięcia (`api.downloads.show(...)`, bez
przechwytywania funkcji), żeby e2e mógł podstawić szpiega.
Treści (AC-1.1, 1.7): `savedTitle` „Zapisano”, `savedFile(name)` „Plik: <nazwa>”, `savedInstruction` (Q-2, dosłownie), `showFile` „Pokaż plik”,
`newRecording` „Nowe nagranie”, `fileMissing`, sufiksy zrzutu E3 (`screenshotOffSaved`/`screenshotFailedSaved`). Sufiks zrzutu ginie po
ponownym otwarciu popupu, bo `lastSaved` go nie trzyma; to akceptowalne. Zakaz słów `JSON|zip|MCP|snapshot|hash|redakcja` sprawdzamy na
szablonach `MESSAGES`; nazwa pliku to dane, a nie tekst UI.
Zgoda (IN8, AC-1.8): `consentNotice` = tekst z AC-1.8, równy w `messages.js` i `popup.html`.
Konsekwencje: `MESSAGES.saved` jako linia statusu znika z gotowego stanu. Helper e2e `readSaveOutcome(popup)` (TEST0) zastępuje regexy
`^Zapisano plik` w 6 specach. Żadnej nowej komunikacji z tłem poza istniejącym `getStatus`. Brak sieci (AC-2.1): `blob:` i `downloads.show`
nie są żądaniami HTTP.

### D8 Notatki o zrzucie (IN6, IN11): powód wyłączenia z popupu, widoczne ramki z tła, polski opis w summary
Opcje: (a) nowe pole w schemacie (odrzucone przez Q-7); (b) **notatki EN ze stałych w `src/lib/screenshot-notes.js` + polski opis
wyliczany z tych samych stałych**.
**Wybór: (b).**
Przepływ: `popup.js` przy *Zapisz* przekazuje `{ includeScreenshot, screenshotTouched }`. `view.js` eksportuje `wasTouched(box)` z istniejącego
`touchedBoxes`. Kontroler wylicza `screenshotOffReason` i wysyła go w `collect`:
`include` → brak; dotknięty przez zgłaszającego → `'reporter'`; `crossOriginFrames > 0` → `'frames'` (+ `crossOriginFrames`); `frameCheck` ≠ `'done'`
→ `'frameCheckFailed'`; inaczej `'reporter'`. Tło przyjmuje tylko te trzy wartości (inne → `'reporter'`) i liczbę 1–999.
Notatki (EN, `notes`):
- `off` (bez zmian): „Screenshot not included (turned off by the reporter).”;
- `offFrames(n)`: „Screenshot not included: the page showed N frame(s) of other sites, so it was off by default and the reporter did not turn it on.”;
- `offCheckFailed`: „Screenshot not included: the page could not be checked for frames of other sites, so it was off by default and the reporter did not turn it on.”;
- `framesVisible(n)` (IN11, AC-3.10; zrzut jest w paczce, `max(R1, R2).frames.crossOriginVisible > 0` z `fieldRects` w `save.js`):
  „The screenshot shows N frame(s) of other sites; they are not covered.”.
`describeScreenshot(snapshot) → string` (PL) mapuje notatki na linię w sekcji Prywatność: „Zrzut ekranu: wyłączony przez zgłaszającego” /
„wyłączony automatycznie — na stronie były okienka innych serwisów (N)” / „wyłączony automatycznie — nie udało się sprawdzić strony” /
„jest; widać na nim N okienek innych serwisów, nie są zakryte” / „brak — nie udało się zakryć pól formularzy” / „brak — powód w Uwagach”.
Konsekwencje: `package.js` i `save.js` biorą teksty z `screenshot-notes.js`. `meta` dostaje `screenshotOffReason` i `crossOriginFrames`.

### D9 Redakcja `rulesVersion: 2` (IN1–IN5): zamknięty korpus form, jedna iteracja review
Opcje: (a) kolejne heurystyki bez kryterium stopu (lekcja retro E3); (b) **zamknięty korpus form wymieniony niżej, kryterium stopu z Q-4: jedna iteracja
review redakcji, formy spoza korpusu → README „Znane ograniczenia”**.
**Wybór: (b).** Zmiany:
- **IN1** (`redact-rules.js`, `COLON_PAIR`): look-behind dopuszcza `"` przed kluczem. Forma `"k":` ma `"` przed `:`, więc nie koliduje
  (`{"log":"password: x"}` → `{"log":"password: [redacted:key-password]"}`). Wyjątek „proza” wg PB-2 w `BARE_KEY`: klucz bez cudzysłowu, token
  ∈ {`auth`, `session`, `key`}, wartość = ≥ 2 słowa `\p{L}+` rozdzielone spacjami, opcjonalna końcowa kropka.
- **IN3**: nowa reguła tekstowa `URL_KEY_IN_TEXT = /(?<=[?&#]|&amp;)(code|ticket)=([^&#\s"'\\;,<>]+)/gi` → `key-code`/`key-ticket`. Pokrywa
  `/cb?code=`, `&code=`, `#code=` i `https:\/\/…?code=` (JSON-escaped). `country_code=PL` (poprzedza `_`) i `{"code":"PL"}` (bez `=`) zostają bez zmian.
- **IN2**: w plikach na ścieżce maskowania w MAIN (`redact-rules.js`, `mask-secrets.js`, `hooks-network.js`, `hooks-steps.js`) zakaz `for…of`,
  destrukturyzacji tablic, spreadu w tablicach i wywołaniach, `Array.from`, a w funkcjach także `new Set/Map(iterable)`. Wszystko przez pętle indeksowe.
  `for (const ch of s)` po stringu → pętla po `s.charCodeAt(i)`. Pilnuje tego reguła ESLint `no-restricted-syntax` na tych 4 plikach (wyjątki
  na poziomie modułu, wykonywane przy ładowaniu przed stroną, z komentarzem `eslint-disable-next-line` i powodem).
- **IN4** (`redact.js`): `maskPreviewPairs` zastępuje redaktor tokenowy `redactJsonPreview(text, ctx)`, a całotekstowe `ctx.deep(preview)`
  znika (to on robił `token="[redacted…]"` z `"token=","x"` regułą `ATTRIBUTE`). Każdy literał stringu
  jest dekodowany (`JSON.parse` literału; niedomknięty na końcu jako surowy), przechodzi `ctx.text` i jest kodowany z powrotem `JSON.stringify`.
  W tablicach działa reguła par (`argKeyRule`), w obiektach reguła klucza (`"password": …` → wartość lub cały kontener). Struktura JSON zostaje
  bez zmian, a `applied` liczy faktyczne zamiany.
- **IN5** (`redact.js`, Q-4): (1) w `ctx.pairs` i w `redactJsonPreview` wartość-kontener po kluczu → `ctx.forced(kontener, rule)` (każdy skalar
  w środku, kształt zachowany); (2) `argKeyRule` rozpoznaje też zdanie kończące się słowem-kluczem, z opcjonalnym `is`/`jest`
  i opcjonalnym `:`/`=`: ostatnie słowo `[A-Za-z_][\w.-]*` po odcięciu `\s+(is|jest)\s*$` → `secretKeyRule`.
- `RULES_VERSION = 2` (AC-2.8) podbija E4-T10 po wszystkich zmianach reguł.

**Zamknięty korpus E4** (`tests/fixtures/redaction/sensitive.json`, `benign.json` — tekst; nowy `console-args.json` — argumenty konsoli
`{ id, args, secrets[] | expectUnchanged }`, sprawdzane przez `redact()` na paczce z jednym wpisem i na wpisie przyciętym do `{ truncated, preview }`):

| id | Forma | Oczekiwanie |
|---|---|---|
| in1-json-start | `{"log":"password: hunter2x"}` | zamaskowane |
| in1-json-start-esc | `"{\"msg\":\"token: abcd1234efgh\"}"` | zamaskowane |
| in1-prose-auth (benign) | `auth: "Invalid credentials"` | bez zmian |
| in1-prose-session (benign) | `session: "Expired session"` | bez zmian |
| in1-auth-code | `auth: "a1b2c3d4e5"` | zamaskowane (cyfry → nie proza) |
| in1-password-phrase | `password: "correct horse battery"` | zamaskowane (token spoza wyjątku) |
| in3-relative | `GET /cb?code=SplxlOBeZQQYbYS6 failed` | zamaskowane |
| in3-amp / in3-hash | `…&code=abc123xyz…`, `…#code=abc123xyz` | zamaskowane |
| in3-ticket | `/cas/login?ticket=ST-1234-abcd` | zamaskowane |
| in3-json-escaped | `"https:\/\/a.pl\/cb?code=SplxlOBeZQQ"` | zamaskowane |
| in3-benign (benign) | `{"code":"PL"}`, `country_code=PL`, `error code=42` | bez zmian |
| in5-container-obj | `('password:', { v: pw })` | `v` zamaskowane |
| in5-container-arr | `('password', [pw])` | element zamaskowany |
| in5-nested | `('token=', { a: { b: t } })` | zamaskowane |
| in5-sentence | `('Your password is', pw)`, `('Twoje password jest', pw)`, `('API key is', k)` | zamaskowane |
| in5-sentence-colon | `('Your token is:', t)` | zamaskowane |
| in4-preview | `["token=","x","more"]` × 2000 (wpis > `entryChars`) | `x` zamaskowane; preview parsuje się jak oryginał do miejsca cięcia; `masked` = liczba znaczników |
| in5-preview | `('password:', { v: pw }, …)` w wpisie przyciętym | `pw` nie występuje |
| console-benign | `('Loaded', 3, 'items')`, `('status is', 'ok')`, `('auth flow step', 2)` | bez zmian |
| console-fp (udokumentowany FP) | `('Pressed key', 'Enter')` | zamaskowane — akceptowany FP (skill: FP dopuszczalne) |

Kryteria: `sensitive` + `console-args` → 0 przecieków (sekret ani żaden jego 8-znakowy fragment), `benign` ≤ 2 FP łącznie (dziś 1).
Konsekwencje: README „Znane ograniczenia” (faza docs) dostaje: proza pod `auth|session|key` z samych słów, zdania bez słowa-klucza na końcu
(„hasło to …”), formy z backlogu E3 nadal otwarte (`&amp;quot;`, podwójne %-kodowanie, base64 < 32, `AKIA…`), iteratory `Map`/`Set`/`String`
podmienione przez stronę w modułach MAIN poza ścieżką maskowania (utrata danych, nie przeciek).

### D10 Maska zrzutu (IN7): margines 2 px CSS zamiast `max(2 px CSS, 8 px obrazu)`
Opcje: (a) asymetryczny margines (mniejszy u góry); (b) **margines `round(2 × skala)` px obrazu, czyli 2 px CSS przy każdym DPR**;
(c) bez marginesu.
**Wybór: (b).** 8 px obrazu chroniło przed blokami 8×8 JPEG. Ale zamalowanie dzieje się na bitmapie **przed** kodowaniem, więc artefakty
JPEG nie odtworzą usuniętych znaków. Prostokąt `getBoundingClientRect` obejmuje border-box, a tekst leży wewnątrz paddingu. 2 px CSS
wystarczają na antyaliasing ramki. Etykieta 4 px nad polem pozostaje nietknięta przy DPR 1 i 2 (AC-3.11).
Konsekwencje: `MASK_LIMITS.marginImagePx` usunięte, `marginCssPx: 2`. E2E porównuje piksele obszaru etykiety z obrazem bez maski
z tolerancją JPEG (średnia różnica ≤ 6/255).

## Architektura

```
 ZGŁASZAJĄCY                                                     DEVELOPER (lokalnie, offline)
 ┌────────────────────────────────────────────────────────┐      ┌──────────────────────────────────────────────┐
 │ POPUP popup.html · popup.js · controller.js · view.js   │      │ viewer.html (file://, src/standalone)         │
 │  #ready: ujawnienia (+ AC-6.5 z dev-options) · zgoda IN8│      │  CSP: default-src 'none'; script/style hash;  │
 │  #recording: [x] zrzut · Zapisz                          │      │  img-src blob:  · tylko textContent (dom.js)  │
 │  #saved (NOWE): Zapisano · Plik: X · instrukcja ·        │      │  plik ─▶ package-reader ─▶ unzip (Decompr.)   │
 │     [Pokaż plik] [Nowe nagranie]                         │      │        ─▶ migrate v1–v3→v4 ─▶ summary/query   │
 │  Pokaż plik: downloads.search({id}) → downloads.show(id) │      └──────────────────────────────────────────────┘
 │  loadDevOptions(storage.managed + dev-config) (NOWE)     │      ┌──────────────────────────────────────────────┐
 └──────┬─────────────────────────────────────▲────────────┘      │ mcp/server.js (Node ≥ 20, stdio JSON-RPC)    │
        │ runtime.sendMessage                  │ storage.session  │  agent ◀─▶ stdin/stdout; logi → stderr        │
        │ getStatus / armStart / start /       │ .onChanged       │  snapshots-dir: tylko readFile w <katalog>    │
        │ collect{tabId, includeScreenshot,    │                  │  tools: list/summary/errors/network/vitals/   │
        │   screenshotOffReason?, crossOriginFrames?} (NOWE pola)  │         steps/diff → ../src/lib/* (ten sam kod)│
        │ / frameCheck / saveStarted / saveFailed                 └──────────────────────────────────────────────┘
 ┌──────▼─────────────────────────────────────┴────────────┐              ▲ zip z dysku (zgłaszający wysyła sam,
 │ TŁO (SW Chrome / event page Firefox) background.js       │              │ e-mail/zgłoszenie — poza rozszerzeniem)
 │  collect: devOptions = await loadDevOptions() (NOWE, ≤1 s)│
 │   → zrzut (fieldRects R1/R2; NOWE: crossOriginVisible → notatka IN11; margines 2 px CSS IN7)
 │   → tabs.sendMessage collect → assembleParts(meta + screenshotOffReason) → export.js:
 │     redact (rules v2) → budżet → summary.js(query, metrics, screenshot-notes) → zip → base64 → popup
 │  start: NOWE store.clearLast(tabId) po udanym starcie (AC-1.6)
 │  storage.managed: tylko odczyt; storage.session: jak E1–E3; NIC niezredagowanego w storage.*
 └──────▲────────────────────────────────────┬─────────────┘
        │ runtime.sendMessage: hello/flush/  │ tabs.sendMessage(tabId, {collect|fieldRects|destroy|stop}, {frameId:0})
        │ stopped/bridgeError                │ (bez nowych typów)
 ┌──────┴────────────────────────────────────▼─────────────┐
 │ ISOLATED isolated-world.js — chrome.runtime, DOM; fieldRects (frames.crossOriginVisible — już jest)          │
 └──────▲────────────────────────────────────┬─────────────┘
        │ CustomEvent 'pds:m2i' na prywatnym │ CustomEvent 'pds:i2m' na prywatnym odłączonym węźle (E1 D3);
        │ węźle; detail = JSON-string        │ detail = JSON-string {n: nonce, v, id, type, payload};
        │ {n: nonce, …}; M2I: result, flush, │ odbiorca odrzuca zły n. NIE window.postMessage (strona widzi każdy listener).
        │ stopped                            │ MAIN nie ma chrome.* — do tła tylko przez ISOLATED.
 ┌──────┴────────────────────────────────────▼─────────────┐
 │ MAIN main-world.js — ZERO chrome.*; intrinsics z document_start; NOWE (IN2): ścieżka maskowania bez    │
 │ iteratorów strony (redact-rules, mask-secrets, hooks-network, hooks-steps — pętle indeksowe)            │
 └──────▲──────────────────────────────────────────────────┘
        │ zdarzenia DOM, console/fetch/XHR, Performance
 ┌──────┴──────────────┐   Fallback konsolowy: console-snapshot.js (realm strony) → te same src/page + export.js
 │ STRONA               │   (summary v2 też), bez dev-config (zawsze reguły domyślne), bez zrzutu.
 └─────────────────────┘
```

Kontrakty nowe lub zmienione:
- Popup → tło `collect { tabId, includeScreenshot, screenshotOffReason?: 'reporter'|'frames'|'frameCheckFailed', crossOriginFrames?: 1..999 }`
  → bez zmian odpowiedzi (`{ ok, zipBase64, fileName, packageBytes, screenshot }`).
- `getStatus` bez zmian kształtu. `lastSaved` znika po udanym `start` tej karty (dziś zostaje).
- `createSaveHandlers({ …, getDevOptions })` zamiast stałej `devOptions`: `() => Promise<{ disabledRules }>`. Testy wstrzykują wartość.
- `assembleParts({ meta: { …, screenshotOffReason, crossOriginFrames, framesVisible } })`.

## Zmiany w manifeście

| Klucz | Plik | Zmiana | Uzasadnienie |
|---|---|---|---|
| `storage.managed_schema: "managed-schema.json"` | `manifest.chrome.json` | **nowy** | Chrome dostarcza politykę rozszerzeniu (`storage.managed`) tylko przy zadeklarowanym schemacie (Q-1: polityka nadpisuje plik). Nie dodaje ostrzeżenia o uprawnieniach. |
| `managed-schema.json` | `src/` → tylko `dist/chrome` | **nowy plik** | schemat z D5 (bez `enum`; filtr reguł w kodzie) |
| `permissions: activeTab, scripting, storage, downloads` | base | bez zmian | `storage.managed` mieści się w `storage`; `downloads.show`/`search` w `downloads` |
| `optional_host_permissions` | base | bez zmian | — |
| `options_ui`, `options_page` | — | **nie dodajemy** | AC-6.2: zgłaszający nie ma żadnych ustawień |
| `downloads.open`, `downloads.shelf`, `cookies`, `tabs`, `<all_urls>` | — | **nie dodajemy** | „Pokaż plik” = `downloads.show` (w `downloads`); reszta jak E3 |
| usunięte | — | brak | — |

Build: `TARGET_KEYS` += `storage` (klucz tylko w overlayu Chrome), a walker czyta `storage.managed_schema`. Testy: `manifest-parity` (lista
`TARGET_KEYS`), nowy `permissions unchanged vs 0.5.0` (lista zapisana w teście: `["activeTab","scripting","storage","downloads"]` +
`optional_host_permissions`), `no options_ui/options_page`, `web-ext lint` dla `dist/firefox` bez nowych ostrzeżeń.

## Chrome vs Firefox (`dist/chrome` vs `dist/firefox`)

| Obszar | `dist/chrome` | `dist/firefox` |
|---|---|---|
| Manifest | + `storage.managed_schema` | bez klucza `storage` (Firefox go nie obsługuje; pilnuje `manifest-parity`) |
| Pliki | + `managed-schema.json`; reszta identyczna bajtowo | bez `managed-schema.json`; reszta identyczna |
| `lib/dev-config.js` | z `--config` (ten sam plik dla obu celów) albo domyślny | identyczny jak w Chrome |
| Nadpisanie polityką | GPO/registry/`/etc/opt/chrome/policies/managed/*.json` → `3rdparty.extensions.<id>.disabledRules` | `policies.json` → `3rdparty.Extensions.<gecko.id>.disabledRules`; bez polityki `storage.managed.get` **rzuca** → wbudowana konfiguracja |
| „Pokaż plik” | `downloads.show(id)` zwraca `void`; `search().exists` bywa nieaktualne do zakończenia sprawdzenia → `search` przy renderze i przy kliknięciu | `downloads.show(id)` → `Promise<boolean>`; `exists` aktualne |
| Ekran *Zapisano* | e2e Playwright (AC-1.1, 1.2 szpieg, 1.6, 2.1) | QA ręczne (AC-1.1, 1.2: Windows 11, macOS) |
| Zrzut po reloadzie | jak E3 | jak E3 (activeTab cofany; notatka) |
| Viewer (`file://`) | Chrome/Edge: `DecompressionStream('deflate-raw')` ≥ 103, meta CSP z hashem | Firefox ≥ 113, meta CSP z hashem; QA ręczne (AC-4.1) |
| MCP | nie dotyczy przeglądarki | — |
| Gałęzie w kodzie | brak; `Promise.resolve(downloads.show(…))`, `try/catch` na `storage.managed` | — |

## Schema paczki

**`schemaVersion` zostaje 4** (spec „Dane”: zmiany niełamiące). Wpis do `docs/snapshot-schema.md` (E4-T10), sekcja „Wersja 4 — zmiany w 0.6.0 (E4)”:

| Pole | 0.5.0 | 0.6.0 | Konsument |
|---|---|---|---|
| `redaction.rulesVersion` | `1` | `2` (IN1–IN5) | walidator akceptuje `1 ≤ v ≤ RULES_VERSION`; świeże paczki w e2e mają `=== 2` |
| `redaction.disabledRules` | zawsze `[]` w runtime | z konfiguracji D5 (⊆ `email`, `phone`, `html-structure`) | summary: „Wyłączone przez developera: …” |
| `notes` | + „turned off by the reporter” | + `offFrames(n)`, `offCheckFailed`, `framesVisible(n)` (D8) | summary: linia o zrzucie po polsku |
| `summary.md` | minimalny | struktura D2 (AC-3.1) | viewer/MCP liczą ją same z `snapshot.json` |

Nazwy reguł w znacznikach bez zmian (`key-code`/`key-ticket` już istniały dla URL-i, teraz także w tekście). Fixture `v4.json` zostaje
jako przykład 0.5.0 (`rulesVersion: 1`) do testów zgodności wstecz.

## Zadania

Konwencje (jak E3): testy najpierw. DoD = testy zadania zielone + `npm test` całość zielony (poza wyjątkami nazwanymi niżej) + eslint czysty
na zmienionych plikach. **Regeneracja `src/content/*`, `src/standalone/*` (`npm run gen`) tylko w E4-T9.** Do tego czasu `gen --check`,
`gen-content.test.js` i `layout.test.js` mogą być czerwone po zmianach w `src/page`, `src/lib` (osiągalnych z `export.js`) i `src/viewer`.
Odnotować to w `state.md`. Składnia modułów `src/page`, `src/lib` (osiągalnych z fallbacku lub viewera) i `src/viewer` według CLAUDE.md: bez `url(`,
`getURL(`, `import(`, `require(`, `files:`/`js:` nawet w komentarzach. Moduły `src/lib` nie używają `chrome.*` ani zegara poza wstrzykniętym.
Testy z `DecompressionStream` i `child_process` mają `// @vitest-environment node`. `.zip` jest w `.gitignore`, więc zipy testowe powstają
w teście (`createZip`/`exportPackage`) w katalogu tymczasowym.

### E4-S0 Spike: API przeglądarek dla E4  [niezależne: tak]  [zależy od: —]
Pliki: `tests/e2e/spike-e4/run.spike.mjs`, `tests/e2e/spike-e4/ext/` (minimalne rozszerzenie), `tests/e2e/spike-e4/viewer-probe.html`, `docs/epics/E4/spike-S0.md`.
Co zrobić (timebox jeden przebieg, pierwszego dnia):
- S1 Chromium (Playwright): `downloads.download(blob:)` → `search({id}).exists` → usunąć plik → `search` od razu i po 300 ms → `exists`; `downloads.show(id)`
  na istniejącym i usuniętym pliku (wyjątek? wartość?); `onChanged` z `exists`.
- S2 Chromium: `viewer-probe.html` z `file://`: meta CSP z hashem uruchamia inline skrypt; `fetch('http://127.0.0.1')` i `<img src=http…>` zablokowane;
  `img` z `blob:` działa; `DecompressionStream('deflate-raw')` czyta zip z `createZip`.
- S3 Firefox (ręcznie, `web-ext run`, ≈ 20 min): `downloads.show` (istnieje/usunięty), `storage.managed.get()` bez polityki (komunikat błędu)
  i z `policies.json` `3rdparty`; `web-ext lint` z `storage.managed_schema` w manifeście (ostrzeżenie?); S2 w Firefoksie z `file://`.
Testy do napisania najpierw (w skrypcie, PASS/FAIL per punkt): `spike: S1 exists after delete within 300 ms`, `spike: S1 show on missing file does not throw`,
`spike: S2 CSP hash allows inline, blocks network, allows blob img`, `spike: S2 deflate-raw unzip on file://`, `spike: S3 (manual checklist)`.
Definicja ukończenia: `spike-S0.md` z wynikami i decyzjami: D7 (kolejność `search`/`show`) bez zmian albo poprawka, D5 (`managed_schema` tylko Chrome)
potwierdzone, D3 (CSP meta na `file://`) potwierdzone. Porażka S2 → architekt wraca do D3 przed T3b.

### E4-T1a Zapytania o rekordy: czas, kroki, błędy, sieć, oś czasu  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/snapshot-query.js`, `tests/unit/snapshot-query.test.js`.
Co zrobić:
- `recordingStartMs(s)` (`Date.parse(recordingStartedAt)`, fallback: `timeOrigin` pierwszego dokumentu), `absTime(s, rec)` = `documents[rec.doc].timeOrigin + rec.t`
  (dokument bez `timeOrigin` → `null`), `relSeconds(s, rec)`.
- `consoleText(entry)` (pierwszy argument: string, odpakowany JSON-string, `{name,message}` błędu, `{truncated, preview}` → preview), `firstFrame(stack, fallback)`
  → `plik:linia:kolumna` (formaty V8 `at … (url:l:c)`, Firefox `fn@url:l:c`; fallback `filename:lineno:colno`).
- `errorEvents(s)` (runtimeErrors + consoleLogs `level: error`, z `at`/`rel`/`message`/`frame`/`stack`), `firstErrorAt(s)`,
  `errorGroups(s, { limit = 10 })` → `{ groups: [{ message, count, firstRel, frame, stack, stepBefore }], more }` (grupowanie po `message`, kolejność pierwszego wystąpienia).
- `stepList(s, { last = 20 })` → `{ items: [{ rel, at, type, label, url?, beforeFirstError }], total }` (`label` = `text` albo `selector`; `beforeFirstError` tylko dla ostatniego kroku z `at` < `firstErrorAt`).
- `isFailedRequest(e)` (identyczne z `budget.js isFailed`), `statusClass(e)` ∈ `2xx|3xx|4xx|5xx|error|unknown`, `failedRequests(s, { limit = 20 })` → `{ items, total, more }`,
  `filterNetwork(list, { statusClass?, statusRange?, failedOnly?, type?, method?, urlContains? })` → `{ items: [{ index, entry }], total }`.
- `timeline(s)` → posortowane po `at`: kroki, błędy, nieudane zapytania + `{ kind: 'document', doc, url, at: timeOrigin }` (granice dokumentów; AC-4.3).
Testy do napisania najpierw:
- `absTime uses the record's own document timeOrigin; null without it` (konwencja czasu skilla),
- `stepList: last 20 of 25, relative seconds, step before first error marked once (2 documents in v4.json)` (AC-3.2),
- `errorGroups: runtime + console errors grouped by message with count, ≤ 10 groups + more, first frame file:line:col for V8 and Firefox stacks` (AC-3.3),
- `failedRequests total equals overview.failedRequests on v4.json and on 200 generated packages (recount from budget.js)` (AC-3.4),
- `filterNetwork by status class, range, type, method, url fragment; 5000 entries ≤ 50 ms` (AC-4.4, AC-5.5),
- `timeline on v4.json: chronological across 2 documents with a document boundary between them` (AC-4.3),
- `missing fields never throw (empty object, v2 shape)` (czytanie defensywne).
Definicja ukończenia: testy zielone; moduł bez importów spoza `src/lib`, zgodny ze składnią generatora.

### E4-T1c Metryki: CWV per dokument, najwolniejsze zasoby, ciasteczka  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/snapshot-metrics.js`, `tests/unit/snapshot-metrics.test.js`.
Co zrobić:
- `vitalsByDoc(s, { last = 5 })` → `{ docs: [{ doc, url, metrics: { TTFB|FCP|LCP|CLS|INP: { available: true, value, rating } | { available: false, reason } } }], more }`.
  Brak metryki albo `value` nie-liczbowe → `available: false` z `reason` (`unknown`), nigdy `0`.
- `RATING_PL` (`good` → „dobrze”, `needs-improvement` → „do poprawy”, `poor` → „słabo”), `REASON_PL` (`unsupported-browser` → „przeglądarka tego nie mierzy”, `no-interaction` →
  „brak interakcji”, `cross-origin`, `unknown` → „nieznany powód”; nieznany kod → kod w code spanie).
- `slowestResources(s, n = 5)` (wpisy `network` z największym `durationMs`; top-n bez sortowania całej tablicy) → `[{ durationMs, type, sizeBytes, url }]`.
- `cookieInfo(s)` → `{ count, totalBytes, truncatedKeys: [klucze truncated === true] }`. `lastVitals(s)` → per metryka ostatnia dostępna wartość z oceną (dla diff).
Testy do napisania najpierw:
- `v4.json: doc 0 CLS/INP unavailable with reason, doc 1 LCP poor 4300` (AC-3.5), `missing value is unavailable, never 0` (AC-3.5),
- `slowest 5 by durationMs with type and sizeBytes; ties stable; 5000 entries ≤ 20 ms` (AC-3.6),
- `cookieInfo count, cookiesTotalBytes, only true truncated flags` (AC-3.6), `only last 5 documents + more`.
Definicja ukończenia: testy zielone.

### E4-T6 Czytnik ZIP na `DecompressionStream`  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/unzip.js`, `tests/unit/unzip.test.js`.
Co zrobić:
- `readZip(bytes, limits?) → Promise<Map<string, Uint8Array>>` według D4: EOCD (szukanie od końca, komentarz ≤ 64 KB), central directory, lokalne nagłówki,
  metoda 0/8, CRC32 (`crc32` z `zip.js`), nazwy UTF-8 (bit 11) i CP437→latin1 bez bitu, rozmiary z central directory.
- `ZipError` z `code` ∈ `not-zip | corrupt | unsupported | too-large`. Limity: wpisy ≤ 64, wpis ≤ 64 MB, suma ≤ 128 MB, kompresja ≤ 200×,
  nazwy z `..`/`/` na początku → `corrupt`.
Testy do napisania najpierw:
- `reads zip from createZip (snapshot.json deflated, screenshot.jpg stored) byte-identical` (AC-4.1, AC-5.2),
- `reads fflate.zipSync output and a zip with data descriptor flag`,
- `bad CRC → corrupt; truncated file → corrupt; ZIP64/encrypted → unsupported; zip bomb ratio → too-large; not a zip → not-zip` (AC-4.7, AC-5.8),
- `10 MB JSON entry inflated ≤ 300 ms` (perf, AC-4.6).
Definicja ukończenia: testy zielone.

### E4-T7 Migracja v1–v3 → kształt v4 przy odczycie  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/migrate.js`, `tests/unit/migrate.test.js`, `tests/fixtures/snapshots/v1.json` (przykład z `docs/snapshot-schema.md`, dane syntetyczne).
Co zrobić: `normalizeSnapshot(raw) → { snapshot, sourceVersion, newer, warnings, extras }` według D4 (v4 bez kopii i bez mutacji; v3, v2, v1 best-effort;
> 4 → `newer`). Nie-obiekt albo brak rozpoznawalnej wersji → wyjątek `PackageError('not-package')` (klasa w tym module, eksportowana).
Testy do napisania najpierw:
- `v4 returned as the same object and not mutated (deep-freeze)` (kontrakt D2),
- `v3.json → steps/vitals kept, cookies list with valueHash null, screenshot from attachments in extras, redaction null` (AC-4.1, AC-5.2),
- `v2.json → steps/vitals/screenshots empty arrays; queries from T1a do not throw` (AC-4.1),
- `v1.json → one document, t from ISO timestamps` (best-effort),
- `schemaVersion 5 → newer true with warning, data untouched` (AC-4.7), `array/string/null → not-package`.
Definicja ukończenia: testy zielone.

### E4-T3a Generator viewera: cel HTML, CSP z hashami, artefakt wydania  [niezależne: tak]  [zależy od: —]
Pliki: `scripts/gen-content.mjs`, `scripts/pack.mjs`, `src/viewer/viewer.html` (szablon: `<style>`, `<meta>` CSP z `{{CSP}}`, `<script>{{SCRIPT}}</script>`, szkielet zakładek po polsku),
`src/viewer/viewer-entry.js` (stub: renderuje „Przeciągnij plik paczki tutaj albo wybierz go z dysku.”), `tests/unit/gen-viewer.test.js`.
Co zrobić:
- `HTML_BUNDLES` + `bundleHtml({ template, entry, srcDir })`: `bundle()` z istniejącego kodu, wstawienie do szablonu, `sha256` (base64) skryptu i treści `<style>` do CSP z D3.
  Błąd, gdy bundel zawiera `</script` lub `<!--`, gdy szablon nie ma dokładnie jednego `{{SCRIPT}}`/`{{CSP}}` albo gdy wynik > 300 KB.
- `generateAll` obsługuje też `HTML_BUNDLES` (zapis i `--check`); wynik `src/standalone/viewer.html`.
- `pack.mjs`: po zipach kopiuje `src/standalone/viewer.html` do `dist/page-debug-viewer-<wersja>.html` (po `checkRelease`, który obejmuje świeżość viewera).
Testy do napisania najpierw:
- `viewer.html: one inline script, CSP script-src hash equals sha256 of the script, style hash equals sha256 of the style` (AC-4.1, AC-4.5),
- `CSP has default-src 'none', img-src blob:, no connect-src/unsafe-inline/unsafe-eval` (AC-4.1),
- `bundle containing </script or <!-- fails; missing placeholder fails; > 300 KB fails` (NFR rozmiar),
- `generateAll --check reports stale viewer.html` (CLAUDE.md: bundle nieaktualne → czerwone),
- `pack writes dist/page-debug-viewer-<version>.html equal to src/standalone/viewer.html` (Q-8; tmp root jak `check-release.test.js`).
Definicja ukończenia: testy zielone. `src/standalone/viewer.html` nie jest jeszcze commitowany (T9).

### E4-T3d Bezpieczne renderowanie viewera i reguły lint  [niezależne: tak]  [zależy od: —]
Pliki: `src/viewer/dom.js`, `eslint.config.js`, `tests/unit/viewer-dom.test.js`.
Co zrobić:
- `h(tag, attrs, ...children)` (whitelist tagów: `div, span, p, pre, code, ul, ol, li, table, thead, tbody, tr, th, td, h1–h3, button, input, select, option, label, img, section, nav, details, summary`;
  whitelist atrybutów z D3; dzieci: string/number → `createTextNode`, Node, tablice, `null` pomijane). Inny tag lub atrybut → `TypeError`.
- `setImageBytes(img, bytes, mime = 'image/jpeg')` → `URL.createObjectURL`, `revokeAll()`. `textBlock(text, maxChars)` → `<pre>` z informacją o ucięciu.
- `eslint.config.js`: blok `src/viewer/**/*.js` (browser globals, `sourceType: module`, `no-restricted-properties`: `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `srcdoc`, `write`/`writeln` na `document`, `setAttribute`; `no-restricted-globals`: `chrome`, `browser`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`);
  blok `mcp/**/*.js` z globals Node (dla T4a–T4c).
Testy do napisania najpierw (jsdom):
- `strings become text: "<img src=x onerror=…>" renders as text, no element, no attribute` (AC-4.5),
- `on* / href / src / style attributes throw; unknown tag throws` (AC-4.5),
- `javascript: string as child is text only, no anchor created` (AC-4.5), `setImageBytes uses blob: URL`,
- `eslint rejects innerHTML in src/viewer (ESLint API on a temp source)` (E4-R1).
Definicja ukończenia: testy zielone; `npx eslint src/viewer` czysty.

### E4-T4a Serwer MCP: transport stdio i protokół  [niezależne: tak]  [zależy od: —]
Pliki: `mcp/package.json`, `mcp/server.js`, `tests/unit/mcp-server.test.js`.
Co zrobić:
- `createServer({ tools, name, version }) → { handle(line): Promise<string | null> }` (JSON-RPC 2.0 według D6; `tools` = `[{ name, description, inputSchema, handler }]`).
- `main(argv, { stdin, stdout, stderr })`: wymagany argument katalogu (`<katalog>` lub `PDS_SNAPSHOTS_DIR`; brak → komunikat na stderr, kod 2), czytanie linii,
  sekwencyjne odpowiedzi, `stdout` tylko JSON. `tools` dostarcza `mcp/tools.js` (T4c); do tego czasu `main` przyjmuje wstrzyknięty rejestr (test).
- Wyjątek w handlerze → `isError: true`; `uncaughtException` → log na stderr, proces żyje.
Testy do napisania najpierw:
- `initialize negotiates protocolVersion (known → echo, unknown → latest) and declares tools capability`,
- `tools/list returns registry; tools/call routes args; unknown tool → isError; bad JSON → -32700; unknown method → -32601` (AC-5.8),
- `handler throwing → isError result, next request still answered` (AC-5.8),
- `stdout carries only JSON lines (spawned process, notifications/initialized has no reply)`.
Definicja ukończenia: testy zielone; `mcp/package.json` bez `dependencies`.

### E4-T2a Teksty popupu: ekran *Zapisano*, zgoda IN8, ujawnienia konfiguracji  [niezależne: tak]  [zależy od: —]
Pliki: `src/popup/messages.js`, `src/popup/popup.html`, `tests/unit/messages.test.js`, `tests/unit/popup-html.test.js`.
Co zrobić:
- `MESSAGES`: `savedTitle`, `savedFile(name)`, `savedInstruction` (Q-2 dosłownie), `showFile`, `newRecording`, `fileMissing` (AC-1.2 dosłownie);
  `consentNotice` = AC-1.8. `disclosureDevExtra` = `{ email: 'adresy e-mail widoczne na stronie i w logach', phone: 'numery telefonów widoczne na stronie i w logach',
  'html-structure': 'pełna treść strony, w tym widoczne na niej teksty' }` (ostateczne brzmienie może poprawić docs/store-reviewer; test pilnuje zgodności i zakazanych słów).
  `saved(fileName)` zostaje tylko dla zgodności z `messageFor`, ale nie jest używane w widoku *gotowe*.
- `popup.html`: sekcja `<section id="saved" hidden>` z `#savedTitle`, `#savedFile`, `#savedInstruction`, `#savedShot` (pusty), `#savedMissing` (pusty,
  `role="alert"`), przyciski `#showFile`, `#newRecording`. Lista ujawnień kończy się `<li id="disclosureDev" hidden>` (wypełniana z widoku). Styl bez przewijania
  (360×600). Statyczne teksty równe `MESSAGES`.
Testy do napisania najpierw:
- `saved screen texts in popup.html equal MESSAGES; instruction is Q-2 verbatim` (AC-1.1),
- `consentNotice is AC-1.8 verbatim in messages.js and popup.html` (AC-1.8),
- `new texts (saved*, showFile, newRecording, fileMissing, disclosureDevExtra) contain none of JSON|zip|MCP|snapshot|hash|redakcja (case-insensitive)` (AC-1.7),
- `no element in popup.html changes developer settings (no select/checkbox other than #includeScreenshot)` (AC-6.2).
Definicja ukończenia: testy zielone.

### E4-D4a Opcje developerskie: wbudowane + `storage.managed`  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/dev-config.js`, `src/lib/dev-options.js`, `tests/unit/dev-options.test.js`.
Co zrobić: według D5: `BUILT_IN_DEV_CONFIG`, `sanitizeDevConfig(raw) → { disabledRules, ignored }`, `loadDevOptions({ storage, builtIn, timeoutMs = 1000 })
→ Promise<{ disabledRules, source: 'built-in' | 'policy', ignored }>`. Nigdy nie rzuca. Bez `chrome.*` w module (storage wstrzykiwane).
Testy do napisania najpierw:
- `no managed value → built-in`, `managed disabledRules replaces built-in (also [] re-enables)` (AC-6.1),
- `Firefox: managed.get rejects "Managed storage manifest not found" → built-in, no throw`, `managed.get hangs → built-in after 1 s` (AC-6.1, AC-6.3),
- `jwt / unknown rule / unknown key / string instead of array ignored, valid rest kept, listed in ignored` (AC-6.3),
- `result passes resolveDisabledRules unchanged (order of DEFAULT_RULES)` (AC-6.4).
Definicja ukończenia: testy zielone.

### E4-D4b Schemat polityki w manifeście Chrome  [niezależne: tak]  [zależy od: —]
Pliki: `src/managed-schema.json`, `src/manifest.chrome.json`, `scripts/lib/manifest.mjs`, `scripts/lib/reachability.mjs`, `tests/unit/manifest-parity.test.js`.
Co zrobić: schemat z D5; `"storage": { "managed_schema": "managed-schema.json" }` w overlayu Chrome; `TARGET_KEYS` += `storage`; `manifestRefs` dodaje
`m.storage?.managed_schema`.
Testy do napisania najpierw:
- `dist/chrome has storage.managed_schema and managed-schema.json; dist/firefox has neither` (D5),
- `permissions and optional_host_permissions equal the 0.5.0 list in both manifests` (AC-2.1, NFR uprawnienia),
- `no options_ui / options_page in both manifests` (AC-6.2), `managed-schema.json has no enum (filtering stays in code)`.
Definicja ukończenia: testy zielone; `npm run lint` (web-ext lint `dist/firefox`) bez nowych ostrzeżeń.

### E4-D4c Wstrzyknięcie konfiguracji przy buildzie  [niezależne: tak]  [zależy od: kontrakt `dev-config.js` z D4a]
Pliki: `scripts/build.mjs`, `pds.config.example.json`, `.gitignore`, `tests/unit/build.test.js`.
Co zrobić: `build({ …, devConfigPath })` + CLI `--config <plik>` / `PDS_CONFIG`. Nieprawidłowy JSON → błąd builda z nazwą pliku. Przy semantycznie złych
wpisach build działa dalej, a ostrzeżenie (przez `sanitizeDevConfig`) idzie na stderr. Wynik to `dist/<cel>/lib/dev-config.js` = nagłówek `// GENERATED by scripts/build.mjs from <basename>`
+ `export const BUILT_IN_DEV_CONFIG = Object.freeze(<JSON>);`. Bez konfiguracji plik jest kopiowany bajt w bajt. `.gitignore` dostaje `pds.config.json`.
Testy do napisania najpierw:
- `without config dist/lib/dev-config.js equals src byte for byte` (powtarzalność builda),
- `with --config both targets get identical dev-config.js with the given disabledRules` (AC-6.1 „to samo w Chrome i Firefoksie”),
- `invalid JSON fails the build naming the file; jwt in config → warning, build ok` (AC-6.3),
- `no implicit config: pds.config.json in repo root is ignored without --config` (ryzyko 6).
Definicja ukończenia: testy zielone.

### E4-IN1 Redakcja tekstu: klucz na początku stringu JSON, proza, `code`/`ticket` w tekście (IN1, IN3)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/redact-rules.js`, `tests/fixtures/redaction/sensitive.json`, `tests/fixtures/redaction/benign.json`, `tests/unit/redact-rules.test.js`.
Co zrobić: zmiany IN1 i IN3 z D9 (look-behind `COLON_PAIR`, wyjątek prozy w `BARE_KEY` wg PB-2, `URL_KEY_IN_TEXT`). Przypadki `in1-*`, `in3-*` z tabeli D9
w korpusach. **Nie** zmieniać `RULES_VERSION` (T10).
Testy do napisania najpierw:
- `sensitive corpus incl. in1/in3 cases: 0 leaks` (AC-2.3, AC-2.4), `benign corpus: ≤ 2 FP total, each documented` (AC-2.3),
- `{"log":"password: x"} masked and stays valid JSON`, `auth: "Invalid credentials" unchanged; auth: "a1b2c3d4e5" masked; password: "correct horse battery" masked` (AC-2.3, PB-2),
- `/cb?code=, &code=, #code=, ticket, https:\/\/…?code= masked; {"code":"PL"}, country_code=PL unchanged` (AC-2.4),
- `idempotent: second pass applies 0` (regresja E3), `5 MB text ≤ 700 ms` (regresja perf E3).
Definicja ukończenia: testy zielone; dotychczasowe testy redakcji zielone.

### E4-IN4 Redakcja argumentów konsoli: podgląd tokenowy, kontenery w parze, zdania (IN4, IN5)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/redact.js`, `tests/fixtures/redaction/console-args.json`, `tests/unit/redact-console.test.js`.
Co zrobić: według D9: `redactJsonPreview(text, ctx)` zamiast `maskPreviewPairs` + `ctx.deep` na preview; `ctx.pairs` wymusza kontener po kluczu;
`argKeyRule` rozpoznaje zdanie z kluczem na końcu (`is`/`jest`, `:`/`=`). Korpus `console-args.json` = wiersze `in4-*`, `in5-*`, `console-*` z tabeli D9.
Testy do napisania najpierw:
- `console-args corpus: 0 leaks, both as full args and as {truncated, preview}` (AC-2.7),
- `["token=","x","more"] preview: x masked, structure equal to original up to the cut, masked count == markers in output` (AC-2.6),
- `snapshot with that entry passes validator v4 (sum of redaction.masked == occurrences of [redacted:)` (AC-2.6),
- `console-benign unchanged; ('Pressed key','Enter') masked as documented FP` (AC-2.7),
- `property: redact(redact(x)) deep-equals redact(x) with new forms` (regresja E3-TEST2).
Definicja ukończenia: testy zielone; `redact.test.js`, `redact-property.test.js` zielone.

### E4-IN6 Notatki o zrzucie: powód wyłączenia i widoczne ramki (IN6, IN11)  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/screenshot-notes.js`, `src/lib/package.js`, `src/lib/save.js`, `tests/unit/package.test.js`, `tests/unit/save.test.js`.
Co zrobić: według D8: moduł notatek (EN) + `describeScreenshot(snapshot)` (PL). `assembleParts` przyjmuje `meta.screenshotOffReason`, `meta.crossOriginFrames`,
`meta.framesVisible`. `collect` waliduje `screenshotOffReason`/`crossOriginFrames` z wiadomości. `takeScreenshot` zwraca `framesVisible = max(R1, R2).frames.crossOriginVisible`.
`SCREENSHOT_NOTES` w `package.js` jako re-eksport (zgodność importów).
Testy do napisania najpierw:
- `includeScreenshot false + reason frames(3) → note offFrames(3), not "turned off by the reporter"`, `reason frameCheckFailed → offCheckFailed`, `missing/unknown reason → off` (AC-3.9),
- `screenshot included and fieldRects crossOriginVisible 2 → note framesVisible(2); 0 → no note` (AC-3.10),
- `describeScreenshot maps every note kind to Polish; no note text in English leaks into it` (AC-3.9),
- `crossOriginFrames outside 1..999 ignored` (walidacja wejścia).
Definicja ukończenia: testy zielone.

### E4-IN7 Margines maski 2 px CSS  [niezależne: tak]  [zależy od: —]
Pliki: `src/lib/screenshot.js`, `tests/unit/screenshot.test.js`.
Co zrobić: według D10: `planMask` margines = `round(MASK_LIMITS.marginCssPx × skala)`, bez `marginImagePx`.
Testy do napisania najpierw: `margin is 2 CSS px at dpr 1 (2 px) and dpr 2 (4 px)`, `label rect 4 CSS px above field not intersected by mask at dpr 1 and 2` (AC-3.11),
`field rect fully inside mask` (E3 AC-2.2), regresje `planMask` (skala, przycięcie, aspect mismatch).
Definicja ukończenia: testy zielone.

### E4-T1b `summary.md` pełny (E4-S1, E4-T1, E4-TEST1)  [niezależne: nie]  [zależy od: T1a, T1c, IN6]
Pliki: `src/lib/summary.js`, `tests/unit/summary.test.js`, `tests/unit/__snapshots__/summary-v4.md`, `tests/unit/__snapshots__/summary-heavy.md`, `tests/unit/__snapshots__/summary-console.md`.
Co zrobić: `buildSummary(s)` według D2 (sekcje, „brak — powód”, code spany, `num()`, limity pól, `fitSummary`, linia zrzutu z `describeScreenshot`). Paczka konsolowa =
`v4.json` z `source: 'console'`, bez `screenshots` i z notatką fallbacku (budowana w teście).
Testy do napisania najpierw:
- `section order fixed; empty section shows one "brak — <reason>" line` (AC-3.1) + snapshoty 3 paczek (AC-3.1, E4-TEST1),
- `steps: ≤ 20, seconds with one decimal (comma), navigate with URL, step before first error marked` (AC-3.2),
- `errors grouped with counts, ≤ 10, first frame` (AC-3.3), `failed requests ≤ 20 + "i N więcej", total == overview.failedRequests` (AC-3.4),
- `CWV per document, unavailable with Polish reason, never 0` (AC-3.5), `slowest 5 with type and size; cookies count/bytes/truncated` (AC-3.6),
- `heavy: ≤ 200 lines, ≤ 16 KB; generation median of 5 ≤ 100 ms on 10 MB JSON` (AC-3.7),
- `trap values (# heading, ](javascript:…), <img onerror>, \n, ``` backticks) produce no heading/link/HTML/code block: every line starts with an allowed prefix and every page value sits inside a balanced code span` (AC-3.8),
- `"reguły v2" when rulesVersion 2; disabled rules line` (AC-2.8, AC-6.4), `screenshot line in Polish for each D8 note` (AC-3.9),
- `buildSummary(x) === buildSummary(JSON.parse(JSON.stringify(x)))` (AC-5.3), `no trap value from redaction-traps.js appears` (AC-2.9).
Definicja ukończenia: testy zielone; `export.test.js` zielony (zip nadal ma `summary.md`).

### E4-T5 Porównanie paczek (E4-T5)  [niezależne: nie]  [zależy od: T1a, T1c]
Pliki: `src/lib/snapshot-diff.js`, `tests/unit/snapshot-diff.test.js`, `tests/fixtures/snapshots/diff-a.json`, `tests/fixtures/snapshots/diff-b.json`.
Co zrobić: `diffSnapshots(a, b)` → `{ errors: { added, removed }, statuses: [{ method, path, before, after }], vitals: [{ metric, before, after }], cookies: { count, totalBytes, added, removed, changedHash } }`.
Błędy porównywane po komunikacie (`errorGroups`). Statusy po `metoda + ścieżka URL` (bez query i fragmentu; ostatni wpis pary), tylko różne. CWV z `lastVitals` z oceną.
Ciasteczka po nazwie (`valueHash` różny → `changedHash`). Fixture: kopie `v4.json` ze znanymi różnicami (opisane w teście).
Testy do napisania najpierw: `known differences of diff-a/diff-b found exactly (errors, statuses, CWV with rating, cookie count/size/hash names)` (AC-5.6),
`identical packages → all lists empty`, `v2 vs v4 (normalized) does not throw`.
Definicja ukończenia: testy zielone.

### E4-T8 Czytnik paczki: zip lub JSON → znormalizowany snapshot  [niezależne: nie]  [zależy od: T6, T7]
Pliki: `src/lib/package-reader.js`, `tests/unit/package-reader.test.js`.
Co zrobić: `readPackage(bytes) → Promise<{ format, snapshot, sourceVersion, newer, warnings, summaryMd, screenshot }>` według D4 (BOM, UTF-8, `snapshot.json` wymagany w zipie,
`screenshot.jpg` opcjonalny, limit JSON 64 MB). Błędy jako `PackageError` z kodem. `READ_ERRORS_PL` (komunikaty dla viewera): „To nie jest plik paczki.”,
„Plik paczki jest uszkodzony.”, „Plik jest za duży.”, „Nieobsługiwany format pliku.”.
Testy do napisania najpierw:
- `zip from exportPackage(v4 input) → snapshot deep-equals snapshot.json, summaryMd present, screenshot bytes present` (AC-4.1),
- `v2.json / v3.json bytes → normalized` (AC-4.1), `schemaVersion 5 → newer` (AC-4.7),
- `random bytes, truncated zip, zip without snapshot.json, invalid JSON → PackageError with code; every code has a Polish message` (AC-4.7, AC-5.2).
Definicja ukończenia: testy zielone.

### E4-IN2 Ścieżka maskowania w MAIN odporna na podmienione iteratory (IN2)  [niezależne: nie]  [zależy od: IN1 (ten sam plik), T3d (eslint.config.js)]
Pliki: `src/lib/redact-rules.js`, `src/page/hooks-network.js`, `src/page/hooks-steps.js`, `eslint.config.js`, `tests/unit/hostile-realm.test.js`.
Co zrobić: według D9: pętle indeksowe zamiast `for…of`/destrukturyzacji/spreadu/`Array.from` w 4 plikach (`mask-secrets.js` już czysty, ale też objęty regułą).
Reguła `no-restricted-syntax` (`ForOfStatement`, `ArrayPattern`, `ArrayExpression > SpreadElement`, `CallExpression > SpreadElement`, `NewExpression > SpreadElement`,
`CallExpression[callee.object.name='Array'][callee.property.name='from']`) dla tych plików.
Testy do napisania najpierw:
- `hostile realm: Array.prototype[Symbol.iterator] replaced (throwing and empty variants) after load → JWT in 500 body preview, Authorization header, step URL token still masked` (AC-2.5),
- `String.prototype[Symbol.iterator] replaced → ibanValid/shannon unchanged`,
- `eslint: for…of in hooks-network.js is an error (ESLint API on a temp copy)`,
- regresja perf: istniejący test p95 hooka `fetch` — różnica ≤ 0,1 ms względem wyniku sprzed zmiany (NFR czas).
Definicja ukończenia: testy zielone; `npx eslint` czysty na 4 plikach.

### E4-T2b Popup: ekran *Zapisano*, „Pokaż plik”, powód zrzutu, ujawnienia konfiguracji  [niezależne: nie]  [zależy od: T2a, D4a; kontrakt `collect` z „Architektury”]
Pliki: `src/popup/controller.js`, `src/popup/view.js`, `src/popup/popup.js`, `tests/unit/popup-controller.test.js`, `tests/unit/popup-view.test.js`.
Co zrobić:
- `renderModel`: sekcja `'saved'`, gdy `state === 'idle'`, `lastSaved?.fileName` i brak lokalnego `showReady`. Model: `{ savedFile, savedShot, savedMissing }`, tylko `fileName` z danych.
  `disclosureDev` = teksty `disclosureDevExtra` dla `devOptions.disabledRules`.
- Kontroler: `init` → `loadDevOptions({ storage: api.storage })` (bez blokowania pierwszego renderu). `onShowFile()` według D7 (`search` przy renderze, `search` + `show` przy kliknięciu,
  `onChanged` `exists`). `onNewRecording()` → `ctx.showReady = true` (tylko lokalnie). `onSave({ includeScreenshot, screenshotTouched })` → `screenshotOffReason`/`crossOriginFrames` według D8.
  Wynik zapisu (`saved`) przechodzi w sekcję `saved` z sufiksem zrzutu.
- `view.js`: `applyModel` dla `#saved` i `#disclosureDev` (tylko `textContent`), eksport `wasTouched(box)`. `popup.js`: podpięcie `#showFile`, `#newRecording` i przekazanie `screenshotTouched`.
Testy do napisania najpierw:
- `after save outcome and on reopen with lastSaved → saved section with file name, instruction, showFile` (AC-1.1, AC-1.6),
- `newRecording shows ready locally; reopen without Nagrywaj → saved again` (AC-1.6),
- `showFile: search then show(downloadId of lastSaved); exists false / missing item / show rejects / show false → fileMissing, no logError throw` (AC-1.2),
- `saved model contains only fileName from data (fixture with trap values and ?token= URL in status)` (AC-2.2),
- `box untouched + crossOriginFrames 2 → collect screenshotOffReason frames, crossOriginFrames 2; failed check → frameCheckFailed; touched → reporter` (AC-3.9),
- `disabledRules [email, html-structure] → disclosureDev lists both texts; [] → hidden` (AC-6.5), `no control changes dev options` (AC-6.2).
Definicja ukończenia: testy zielone; regresje kontrolera E1–E3 zielone.

### E4-D4d Tło: opcje z konfiguracji, czyszczenie `lastSaved` przy starcie  [niezależne: nie]  [zależy od: D4a, IN6 (save.js)]
Pliki: `src/background.js`, `src/lib/save.js`, `src/lib/recording.js`, `tests/unit/background-router.test.js`, `tests/unit/background-recording.test.js`.
Co zrobić: `background.js` zamiast `DEV_OPTIONS` przekazuje `getDevOptions: () => loadDevOptions({ storage: api.storage })`. `save.js` w `collect` woła `await getDevOptions()`
raz (`fullHtml` i `exportAssembled` z tego samego wyniku); błąd → `{}`. `recording.start` po udanym starcie → `store.clearLast(tabId)`.
Testy do napisania najpierw:
- `collect uses disabledRules from managed storage (fake) → redaction.disabledRules ['email'], email not masked` (AC-6.1, AC-6.4),
- `managed rejects → defaults, save succeeds` (AC-6.3), `html-structure from policy → collect sends fullHtml` (AC-6.1),
- `successful start clears pds:last:<tabId>; refused consent keeps it` (AC-1.6),
- `background never imports popup code; getDevOptions read per collect (no module state)` (tło bez stanu).
Definicja ukończenia: testy zielone.

### E4-T3b Viewer: wczytywanie, błędy, zakładki, Podsumowanie, zrzut  [niezależne: nie]  [zależy od: T3a, T3d, T8, T1b]
Pliki: `src/viewer/viewer-entry.js`, `src/viewer/app.js`, `src/viewer/viewer.html`, `tests/unit/viewer-app.test.js`.
Co zrobić:
- Przeciągnij i upuść + `<input type="file" accept=".zip,.json">` → `file.arrayBuffer()` → `readPackage`. Błędy → komunikat PL (`READ_ERRORS_PL`), stan startowy zostaje (AC-4.7).
  `newer` → baner „Nowsza wersja paczki — część danych może być niewidoczna.”, a dane są pokazane.
- Nagłówek (host, `collectedAt`, wersje, liczby z `overview`). Pasek zakładek: Podsumowanie, Kroki, Błędy, Sieć, Konsola, CWV, DOM, Storage (`role="tablist"`). Leniwy render
  i cache. Kontrakt zakładek z T3c/T3e: `renderSteps|renderErrors|renderNetwork|renderConsole(snapshot) → Element` (`tabs-records.js`),
  `renderVitals|renderDom|renderStorage(snapshot) → Element` (`tabs-page.js`).
- Podsumowanie = `<pre>` z `buildSummary(snapshot)` (tekst 1:1). Zrzut (`screenshot` z czytnika albo `extras.screenshotDataUrl` v3 → bytes) w Podsumowaniu przez `setImageBytes`.
Testy do napisania najpierw (jsdom, zakładki T3c/T3e zastąpione atrapami):
- `zip from exportPackage: Podsumowanie textContent === summary.md entry` (AC-4.2, AC-5.3),
- `corrupt file / non-package / schemaVersion 5 → Polish message or warning banner, app still usable` (AC-4.7),
- `tab switch renders once and reuses the node` (AC-4.2), `screenshot shown via blob: when present; absent → no img` (AC-4.2),
- `no element/attribute from package data: trap fixture leaves no <script>/<img onerror>/<a> in DOM` (AC-4.5).
Definicja ukończenia: testy zielone; `npm run gen` lokalnie daje viewer.html ≤ 300 KB (bez commitu, T9).

### E4-T3c Viewer: zakładki rekordów (Kroki/oś czasu, Błędy, Sieć, Konsola)  [niezależne: nie]  [zależy od: T3d, T1a; kontrakt z T3b]
Pliki: `src/viewer/tabs-records.js`, `tests/unit/viewer-tabs-records.test.js`.
Co zrobić: Kroki = `timeline(s)` (granice dokumentów jako nagłówki, czas bezwzględny `HH:MM:SS.mmm` lokalnie i względny). Błędy = `errorGroups` z rozwijanym stosem (`<details>`/`<pre>`).
Sieć = filtry: klasa statusu (2xx/3xx/4xx/5xx/błąd/nieznany), typ, fragment URL, licznik „N z M”, stronicowanie po 200, szczegóły wiersza (nagłówki, podgląd treści jako tekst).
Konsola = poziom, czas, argumenty przez `JSON.stringify` jako tekst.
Testy do napisania najpierw:
- `steps tab on v4.json: chronological items with a boundary between documents` (AC-4.3),
- `network filter 4xx + type img + "missing" → count text and rows; 5000 entries filter ≤ 500 ms (jsdom)` (AC-4.4),
- `console args and network bodies with <script>, javascript:, onerror rendered as text` (AC-4.5).
Definicja ukończenia: testy zielone.

### E4-T3e Viewer: zakładki strony (CWV, DOM, Storage)  [niezależne: nie]  [zależy od: T3d, T1c; kontrakt z T3b]
Pliki: `src/viewer/tabs-page.js`, `tests/unit/viewer-tabs-page.test.js`.
Co zrobić: CWV = tabela per dokument (`vitalsByDoc` bez limitu dokumentów, ocena, powód, atrybucja: selektor LCP/INP, źródła CLS, long tasks). DOM = `dom.counts`, listy (`scripts`,
`stylesheets`, `images`, `iframes`, `forms`) jako tabele tekstowe, `dom.structure` i `dom.fullHtml` w `textBlock` (≤ 1 MB). v3 `dom.html.outerHTML` też jako tekst.
Storage = ciasteczka (`name`, `sizeBytes`, `valueHash`), `localStorage`/`sessionStorage` klucz–wartość.
Testy do napisania najpierw: `CWV unavailable shows reason, never 0` (AC-3.5 w viewerze), `dom.structure with <script> shown as text, no element created` (AC-4.5),
`storage keys with <img onerror> as text` (AC-4.5), `v3 outerHTML rendered as text` (AC-4.1).
Definicja ukończenia: testy zielone.

### E4-T4b MCP: katalog paczek, bezpieczne ścieżki, cache  [niezależne: nie]  [zależy od: T8]
Pliki: `mcp/snapshots-dir.js`, `tests/unit/mcp-dir.test.js`.
Co zrobić: według D6: `createSnapshotDir(root, { readPackage, fs })` → `{ list(), open(id) }` (`realpath`, pomijanie dowiązań, limit 64 MB, cache po `mtimeMs/size`, sortowanie,
≤ 200 najnowszych, wpis uszkodzony z `error` PL).
Testy do napisania najpierw (tmp dir z zipami z `exportPackage`, `v2.json`, `v3.json`, plikiem uszkodzonym, dowiązaniem na zewnątrz):
- `list: id, file, host, collectedAt, schemaVersion, overview counts; newest first; corrupt marked, list complete` (AC-5.2),
- `open("../x"), absolute path, "a/b", NUL, symlink outside → error; nothing read outside root (spy on fs)` (AC-5.8),
- `second list uses cache (readPackage called once per unchanged file)`, `no write/unlink/rename on fs spy` (AC-5.8).
Definicja ukończenia: testy zielone.

### E4-T10 `rulesVersion: 2`, walidator, dokumentacja schematu  [niezależne: nie]  [zależy od: IN1, IN2, IN4 (wszystkie zmiany reguł)]
Pliki: `src/lib/redact-rules.js` (tylko `RULES_VERSION = 2`), `tests/helpers/snapshot-validator.js`, `tests/unit/snapshot-validator.test.js`, `docs/snapshot-schema.md`.
Co zrobić: podbicie wersji reguł. Walidator akceptuje `1 ≤ rulesVersion ≤ RULES_VERSION` i ma opcję `{ expectRulesVersion }` dla świeżych paczek. Sekcja schematu z tabeli
„Schema paczki” (rulesVersion 2, nowe notatki, struktura `summary.md`, `disabledRules` z konfiguracji), skill `snapshot-schema` (zmiana przez użytkownika, `.claude/skills` zablokowane).
Testy do napisania najpierw: `v4.json (rulesVersion 1) still valid` (zgodność wstecz), `fresh export has rulesVersion 2 with expectRulesVersion` (AC-2.8),
`rulesVersion 3 invalid`.
Definicja ukończenia: testy zielone; `docs/snapshot-schema.md` z wpisem 0.6.0.

### E4-T4c MCP: siedem narzędzi, limit odpowiedzi, README  [niezależne: nie]  [zależy od: T4a, T4b, T1a, T1b, T1c, T5]
Pliki: `mcp/tools.js`, `mcp/server.js` (podpięcie rejestru w `main`), `mcp/README.md`, `tests/unit/mcp-tools.test.js`.
Co zrobić: 7 narzędzi z D6 z `inputSchema` (JSON Schema). Odpowiedzi z `snapshot-query`/`metrics`/`summary`/`diff`: `get_errors` = grupy + pełny stos ≤ 4000 znaków + ostatni krok
przed błędem. `get_steps`/`get_vitals` z czasem ISO i względnym. `get_network` domyślnie tylko nieudane, `limit` 50, `remaining`, nagłówki i podgląd treści tylko przy
`includeHeaders`/`includeBody`. `capResponse` 25 000 znaków z podpowiedzią. README: uruchomienie, konfiguracja Claude Code (`claude mcp add page-debug -- node <repo>/mcp/server.js <katalog>`)
i Cursor (`.cursor/mcp.json`), „serwer tylko czyta”, Node ≥ 20.
Testy do napisania najpierw (wywołania handlerów na tmp dir):
- `get_summary equals summary.md of a zip made by exportPackage (byte-identical)` (AC-5.3),
- `get_errors / get_steps / get_vitals on v4.json zip: values equal fixture (absolute times = timeOrigin + t)` (AC-5.4),
- `get_network: default failed only, status range, type, method, urlContains, limit/offset/remaining; headers/body only on request` (AC-5.5),
- `diff_snapshots wires snapshot-diff` (AC-5.6), `heavy package: every response ≤ 25 000 chars with a narrowing hint` (AC-5.7),
- `static: mcp/*.js and imported src/lib modules import no net/http/https/tls/dgram/child_process, no fetch(` (AC-5.8).
Definicja ukończenia: testy zielone; README kompletny.

### E4-T9 Regeneracja bundli i viewera; budżet rozmiaru  [niezależne: nie]  [zależy od: IN1, IN2, IN4, IN6, T1b, T10, T3b, T3c, T3e]
Pliki: `src/content/main-world.js`, `src/content/isolated-world.js`, `src/standalone/console-snapshot.js`, `src/standalone/viewer.html` (wszystkie generowane), `tests/unit/size-budget.test.js`.
Co zrobić: `npm run gen` → commit. Test rozmiaru: zip `dist/chrome` (fflate, jak `pack`) ≤ 162 413 + 30 720 B, `viewer.html` ≤ 300 KB, `dist/<cel>` < 500 KB.
Fallback konsolowy: smoke na `console-entry.test.js` (summary v2, rules v2).
Testy do napisania najpierw: `chrome extension zip grows ≤ 30 KB vs 0.5.0`, `viewer.html ≤ 300 KB` (NFR rozmiar).
Definicja ukończenia: `npm run gen -- --check` OK; `npm test` całość zielony (koniec wyjątków z konwencji); `npm run lint` czysty.

### E4-TEST3 MCP: integracja przez stdio na przykładowym katalogu (E4-TEST3)  [niezależne: nie]  [zależy od: T4c]
Pliki: `tests/unit/mcp-integration.test.js`, `tests/unit/helpers/snapshot-dir.js` (buduje tmp dir: zip v4 z `exportPackage`, zip ciężki z `heavy-package.js`, `v2.json`, `v3.json`, plik uszkodzony, para diff).
Co zrobić: uruchomić `node mcp/server.js <tmp>` (`child_process.spawn`), wykonać pełny handshake i każde narzędzie przez stdio. Sprawdzić odpowiedzi, czas i brak zapisu w katalogu
(snapshot `mtime`/listy plików przed i po).
Testy do napisania najpierw: `handshake + tools/list returns 7 tools` (AC-5.1), `list_snapshots over v2/v3/v4/corrupt` (AC-5.2), `get_summary byte-identical` (AC-5.3),
`each tool answers on heavy ≤ 25 000 chars` (AC-5.7), `bad id / ../ / corrupt → isError, server answers next call` (AC-5.8), `directory unchanged after all calls` (AC-5.8).
Definicja ukończenia: testy zielone 3× z rzędu (flakiness procesu).

### E4-TEST0 E2E: helper wyniku zapisu i regresje istniejących speców  [niezależne: nie]  [zależy od: T9, T2b, D4d]
Pliki: `tests/e2e/helpers/recording.js`, `tests/e2e/recording.spec.js`, `tests/e2e/failure.spec.js`, `tests/e2e/perf.spec.js`, `tests/e2e/privacy.spec.js`.
Co zrobić: `readSaveOutcome(popup) → { fileName } | { error }` czyta `#savedFile` albo `#status.error`. Podmiana regexów `^Zapisano plik` i `MESSAGES.saved` w tych specach.
Walidator e2e z `expectRulesVersion: 2`.
Testy do napisania najpierw: `readSaveOutcome resolves saved section and error status` (w `recording.spec.js`), dotychczasowe asercje na nowym helperze.
Definicja ukończenia: te speki zielone ×2 (Chromium, `PDS_E2E_NO_BUILD=1` po jednym buildzie).

### E4-TEST4a E2E: ekran *Zapisano*, sieć, konfiguracja developera  [niezależne: nie]  [zależy od: TEST0, D4c]
Pliki: `tests/e2e/saved.spec.js`, `tests/e2e/dev-config.spec.js`, `tests/fixtures/config/disable-email.json`, `tests/e2e/helpers/launch.js` (jeśli trzeba: build do tmp z `--config`).
Co zrobić / testy najpierw:
- `saved screen: file name, instruction, "Pokaż plik" visible without scrolling at 360×600 (boundingBox)` (AC-1.1),
- `Pokaż plik calls downloads.show with the saved downloadId (spy in popup)`; `file deleted → "Nie znaleziono pliku…" and no console error` (AC-1.2),
- `close and reopen popup → saved screen; Nowe nagranie → ready; Nagrywaj → recording; reopen after save of new recording → new file name` (AC-1.6),
- `from Zapisz to closing saved screen (incl. Pokaż plik): 0 http/https/ws requests from service worker and popup` (AC-2.1),
- `popup has no settings controls; manifest has no options page` (AC-6.2),
- `build with disable-email.json: e-mail from privacy.html present in snapshot.json, redaction.disabledRules ["email"], summary line "Wyłączone przez developera: email"; disclosure lists e-mail` (AC-6.1, AC-6.4, AC-6.5).
Definicja ukończenia: zielone ×2.

### E4-TEST4b E2E: notatki i maska zrzutu  [niezależne: nie]  [zależy od: TEST0]
Pliki: `tests/e2e/screenshot.spec.js`, `tests/e2e/screenshot-frames.spec.js`, `tests/e2e/screenshot-mask.spec.js`, `tests/fixtures/pages/screenshot-mask.html`, `tests/fixtures/pages/frames-visible.html`.
Co zrobić: migracja na `readSaveOutcome`. Testy najpierw:
- `frames page, box untouched → notes offFrames(n), not "turned off by the reporter"; summary.md Polish reason` (AC-3.9),
- `frame check failing (stub fieldRects error) → offCheckFailed note` (AC-3.9),
- `reporter turns screenshot on with a visible cross-origin frame → notes framesVisible(1)` (AC-3.10),
- `label 4 px above field: mean pixel diff vs unmasked capture ≤ 6/255 at dpr 1 and 2; field fully covered (E3 AC-2.2)` (AC-3.11).
Definicja ukończenia: zielone ×2.

### E4-TEST4c E2E: prywatność — wroga strona z iteratorem, trzech konsumentów  [niezależne: nie]  [zależy od: TEST0, TEST3, T9]
Pliki: `tests/e2e/privacy-consumers.spec.js`, `tests/fixtures/pages/privacy-iterator.html`.
Co zrobić / testy najpierw:
- `page replacing Array.prototype[Symbol.iterator] before recording: JWT in 500 response, Authorization header and step URL token absent from zip` (AC-2.5),
- `privacy.html zip: trap values absent from summary.md, from viewer DOM text of every tab (viewer opened from file:// with this zip), and from every MCP tool response (server spawned on the download dir)` (AC-2.9).
Definicja ukończenia: zielone ×2.

### E4-TEST2 E2E viewer (E4-TEST2)  [niezależne: nie]  [zależy od: T9]
Pliki: `tests/e2e/viewer.spec.js`, `tests/fixtures/snapshots/xss-traps.json`, `tests/e2e/helpers/packages.js` (zipy z fixture'ów przez `createZip`, ciężki przez `exportPackage` + `heavy-package.js`, plik 5000 zapytań).
Co zrobić: Chromium bez rozszerzenia, `file://…/src/standalone/viewer.html`, wybór pliku przez `setInputFiles` i drag&drop (`DataTransfer`). Testy najpierw:
- `loads zip v4, v3.json, v2.json; Polish UI; 0 network requests after load (page.on('request') except the viewer file)` (AC-4.1),
- `all 8 tabs switch ≤ 300 ms; screenshot visible for zip with image` (AC-4.2),
- `network filter by status class, type, URL fragment on 5000 entries ≤ 500 ms with count` (AC-4.4, E4-TEST2),
- `xss-traps: trap flag unset, no dialog, 0 requests, no anchor with javascript:` (AC-4.5, E4-R1),
- `heavy zip (~1.7 MB): first tab visible ≤ 3 s, median of 3` (AC-4.6),
- `corrupt file / not a package / schemaVersion 5 → Polish message / warning banner, no blank screen` (AC-4.7).
Definicja ukończenia: zielone ×2.

## Kolejność i równoległość

| Fala | Zadania (równolegle w fali; rozłączne pliki) | Warunek startu |
|---|---|---|
| **A** | S0, T1a, T1c, T6, T7, T3a, T3d, T4a, T2a, D4a, D4b, D4c, IN1, IN4, IN6, IN7 | — (D4c tylko kontrakt `dev-config.js`; S0 pierwszego dnia) |
| **B** | T1b (T1a, T1c, IN6), T5 (T1a, T1c), T8 (T6, T7), IN2 (IN1, T3d), T2b (T2a, D4a), D4d (D4a, IN6) | A |
| **C** | T3b (T3a, T3d, T8, T1b; wynik S0-S2), T3c (T3d, T1a), T3e (T3d, T1c), T4b (T8), T10 (IN1, IN2, IN4) | B |
| **D** | T4c (T4a, T4b, T1a–T1c, T5) ‖ T9 (wszystko, co dotyka bundli/viewera: IN1, IN2, IN4, IN6, T1b, T10, T3b, T3c, T3e) | C |
| **E** | TEST3 (T4c; bez przeglądarki) ‖ TEST0 → potem TEST4a, TEST4b, TEST4c, TEST2 (najwyżej dwa przebiegi e2e naraz, jeden `npm run build`, reszta `PDS_E2E_NO_BUILD=1`) | D |

Pary z tym samym plikiem są celowo w różnych falach: `redact-rules.js` (IN1 → IN2 → T10), `save.js` (IN6 → D4d), `eslint.config.js` (T3d → IN2),
`mcp/server.js` (T4a → T4c), `viewer.html` (T3a → T3b). Checkpoint commit po każdej fali. Wynik S0 musi być przed T3b i D4b-QA.
Fazy po implementacji: E4-R1 (review: viewer XSS, lista kontrolna AC-4.5; jedna iteracja review redakcji wg Q-4), store review (manifest + teksty),
E4-Q1 (QA: zgłaszający → plik → viewer → agent przez MCP w Claude Code; Firefox; Windows/macOS „Pokaż plik”), E4-DOC1, release 0.6.0.

Liczba zadań implementacyjnych: 35 (w tym spike i 6 zadań testowych e2e/integracyjnych). Grupy równoległe: A (16), B (6), C (5), D (2), E (TEST3 ‖ TEST0 → 4 e2e).

## Plan testów

| AC | Unit / integracja | E2E (Chromium) | Firefox / ręczne |
|---|---|---|---|
| 1.1 | T2a `texts equal`, T2b `saved section` | TEST4a `360×600 boundingBox` | QA FQ-E4-1 |
| 1.2 | T2b `showFile …fileMissing` | TEST4a `downloads.show spy`, `deleted file` | QA: Eksplorator Windows 11, Finder macOS, Chrome i Firefox (FQ-E4-2) |
| 1.6 | T2b `reopen`, D4d `start clears last` | TEST4a `close and reopen` | FQ-E4-1 |
| 1.7 | T2a `forbidden words` | — | — |
| 1.8 | T2a `consentNotice verbatim` | — | store review |
| 2.1 | D4b `permissions unchanged` | TEST4a `0 requests` | store review |
| 2.2 | T2b `only fileName` | — | — |
| 2.3 | IN1 korpus | — | review redakcji (1 iteracja) |
| 2.4 | IN1 korpus | — | — |
| 2.5 | IN2 `hostile realm` | TEST4c `iterator page` | — |
| 2.6 | IN4 `preview structure`, `validator` | każdy zapis e2e przez walidator | — |
| 2.7 | IN4 `console-args corpus` | — | review redakcji |
| 2.8 | T10, T1b `reguły v2` | TEST0 walidator `expectRulesVersion: 2` | — |
| 2.9 | T1b `no trap`, TEST3 | TEST4c `three consumers` | — |
| 3.1 | T1b order + 3 snapshoty (E4-TEST1) | — | QA developer ≤ 60 s |
| 3.2 | T1a `stepList`, T1b | — | — |
| 3.3 | T1a `errorGroups`, T1b | — | — |
| 3.4 | T1a `failedRequests == overview`, T1b | — | — |
| 3.5 | T1c, T1b, T3e | — | — |
| 3.6 | T1c, T1b | — | — |
| 3.7 | T1b `≤ 200 lines, ≤ 16 KB, ≤ 100 ms` | — | — |
| 3.8 | T1b `trap values` | — | review |
| 3.9 | IN6, T2b, T1b | TEST4b `offFrames`, `offCheckFailed` | FQ-E4-3 |
| 3.10 | IN6 `framesVisible` | TEST4b | — |
| 3.11 | IN7 | TEST4b `label pixels dpr 1/2` | FQ-E4-3 (wzrokowo) |
| 4.1 | T3a CSP/plik, T7, T8, T3e (v3) | TEST2 `v2/v3/v4, 0 requests` | FQ-E4-4 Firefox, Edge `file://` |
| 4.2 | T3b | TEST2 `≤ 300 ms` | — |
| 4.3 | T1a `timeline`, T3c | — | — |
| 4.4 | T1a `filterNetwork`, T3c | TEST2 `5000 ≤ 500 ms` | — |
| 4.5 | T3d, T3b, T3c, T3e, lint | TEST2 `xss-traps` | E4-R1 |
| 4.6 | T6 perf | TEST2 `≤ 3 s` | — |
| 4.7 | T7, T8, T3b | TEST2 `corrupt / v5` | — |
| 5.1 | T4a, TEST3 `7 tools` | — | QA Claude Code: „jakie błędy są w ostatniej paczce?” (FQ-E4-5) |
| 5.2 | T4b, TEST3 | — | — |
| 5.3 | T1b `JSON roundtrip`, T4c, TEST3 | — | — |
| 5.4 | T4c | — | — |
| 5.5 | T1a, T4c | — | — |
| 5.6 | T5, T4c | — | — |
| 5.7 | T4c, TEST3 | — | QA ryzyko 3 |
| 5.8 | T4a, T4b, T4c `static`, TEST3 | — | — |
| 6.1 | D4a, D4c, D4d | TEST4a `dev-config` | FQ-E4-6: polityka Chrome (`/etc/opt/chrome/policies/managed`) i Firefox (`policies.json`) |
| 6.2 | T2a, T2b, D4b | TEST4a | — |
| 6.3 | D4a, D4c, D4d | — | — |
| 6.4 | D4d, T1b | TEST4a | — |
| 6.5 | T2b | TEST4a | — |
| NFR rozmiar | T3a, T9 | — | — |
| NFR czas | IN2 p95 `fetch`, T1b perf | istniejący `perf.spec` (≤ 5 s) przez TEST0 | — |
| NFR uprawnienia/prywatność | D4b, T4c static | TEST4a | store review |

Scenariusze QA ręcznego (wyniki w `qa-report.md`):
- **FQ-E4-1** (AC-1.1, 1.6) Firefox: `basic.html` → zapis → ekran *Zapisano* bez przewijania; zamknij/otwórz popup → nadal *Zapisano*; „Nowe nagranie”.
- **FQ-E4-2** (AC-1.2) „Pokaż plik” w Chrome i Firefoksie na Windows 11 i macOS: menedżer plików z zaznaczonym plikiem; po usunięciu pliku → komunikat.
- **FQ-E4-3** (AC-3.9–3.11) Firefox: strona z ramką płatności; zrzut domyślnie wyłączony → notatka; maska nie zasłania etykiet.
- **FQ-E4-4** (AC-4.1) `viewer.html` z dysku w Firefoksie i Edge: zip v4, v3.json, brak sieci w narzędziach developera.
- **FQ-E4-5** (AC-5.1) Claude Code i Cursor z konfiguracją z README: 7 narzędzi, odpowiedź o błędach ostatniej paczki.
- **FQ-E4-6** (AC-6.1) polityka przedsiębiorstwa w Chrome i Firefoksie nadpisuje `disabledRules` z builda.

## Odrzucone zadania z backlogu
- [-] **E4-S2** Flow „Wyślij” (mailto, link do formularza, Jira SD): odrzucone przez użytkownika 2026-10-26. Zgłaszający wysyła plik sam. Ekran *Zapisano* ma tylko instrukcję
  i „Pokaż plik”.
- [-] **E4-IN9** zip źródeł dla AMO, `strict_min_version` 140: przeniesione do E5 (E5-S4, E5-T7), decyzja 2026-10-26.
- [-] **E4-IN10** `npm audit` w devDeps (web-ext → node-forge): tylko obserwacja, bez zadania. Warunek release: `npm audit --omit=dev` = 0 high (root i `mcp/`).
- [~] **E4-D4** zawężone do reguł redakcji (D5). „Adres do wysyłki” odpada razem z E4-S2, „pełny HTML” = `html-structure`, „progi” = `disabledRules`.
- [~] **E4-S1, E4-S3, E4-S4**: spec zatwierdzony. Realizacja w T1b (S1), T3a–T3e (S3), T4a–T4c (S4).
- [~] **E4-D1, E4-D2, E4-D3**: decyzje D1–D4, D6 tego dokumentu (D3 backlogu: bez SDK → PB-1).
- [~] **E4-T1** = T1a + T1c + T1b; **E4-T2** = T2a + T2b + D4d; **E4-T3** = T3a–T3e; **E4-T4** = T4a–T4c; **E4-T5** = T5 (+ rejestracja w T4c).
- [~] **E4-TEST1** w T1b (snapshoty 3 paczek), **E4-TEST2** = TEST2, **E4-TEST3** = TEST3.
- [~] **E4-IN8** w T2a (tekst zgody), **E4-IN11** = T1b (nieudane zapytania w summary) + IN6 (notatka o ramkach), **E4-IN3** w zadaniu IN1, **E4-IN5** w zadaniu IN4.
- [~] **E4-R1, E4-Q1, E4-DOC1**: fazy review, QA i docs. Lista kontrolna R1 = AC-4.5 + reguły lint z T3d. DOC1: README developera (viewer, MCP, konfiguracja
  `--config` i polityka, „Znane ograniczenia” z D9), instrukcja zgłaszającego (ekran *Zapisano*).

## Ryzyka techniczne i jak je wykryjemy wcześnie
1. **Ogon form redakcji wraca** (ryzyko 1 spec). Wykrycie: korpus zamknięty z D9 w testach fali A i jedna iteracja review redakcji (Q-4). Mitygacja: formy spoza korpusu idą
   do README, nie do kodu. Sygnał stopu: > 2 nowe formy albo `benign` FP > 2 → bramka użytkownika, bez kolejnej iteracji.
2. **XSS w viewerze** (ryzyko 2 spec). Wykrycie: lint `src/viewer` (T3d) w fali A, testy pułapek w T3b/T3c/T3e i TEST2, CSP z hashem jako druga warstwa
   (S0-S2 potwierdza działanie z `file://`). Sygnał: jakikolwiek `innerHTML`/`setAttribute` w diffie viewera.
3. **Odpowiedzi MCP zapychają kontekst** (ryzyko 3 spec). Wykrycie: T4c/TEST3 na ciężkiej paczce mierzą długość każdej odpowiedzi przy domyślnych filtrach. Cel: ≤ 10 000 znaków
   (40% limitu). Mitygacja: domyślnie tylko nieudane zapytania, bez nagłówków i treści, `limit` 50.
4. **Rozjazd trzech konsumentów** (ryzyko 5 spec). Wykrycie: równość bajtowa `summary.md` ↔ `get_summary` ↔ zakładka (T1b roundtrip, T3b, T4c, TEST3). Jedno źródło kodu (D1).
5. **`downloads.show`/`exists` różnie w przeglądarkach i systemach.** Wykrycie: spike S0 (S1, S3) pierwszego dnia, FQ-E4-2. Mitygacja: dwa `search`, `try/catch`, komunikat zamiast wyjątku.
6. **Lokalna konfiguracja developera trafia do zipa wydania.** Wykrycie: test D4c „no implicit config”. Mitygacja: konfiguracja tylko z jawnego `--config`; `pack`
   wypisuje, czy wbudowano konfigurację (dla wydania: brak).
7. **Firefox `storage.managed` bez polityki rzuca, a zapis nie może czekać.** Wykrycie: D4a `rejects`/`hangs` i S0-S3. Mitygacja: `catch` + timeout 1 s.
8. **Generator viewera i reguły składni** (`</script` w kodzie, `url(` w komentarzu, wieloliniowe importy w nowych modułach `src/lib`/`src/viewer`). Wykrycie: `npm run gen` lokalnie
   w DoD T3b, błąd generatora zamiast cichego escapowania. Mitygacja: regeneracja tylko w T9 (lekcja retro E3).
9. **MCP importuje `../src/lib` — nie zadziała po publikacji w npm.** Akceptowane w E4 (Q-10: tylko lokalnie). E5 dodaje krok kopiujący `src/lib` do paczki. Wpis w backlogu E5
   w fazie docs.
10. **Wzrost zipa rozszerzenia > 30 KB** przez moduły summary. Wykrycie: test T9 (fflate na `dist/chrome`). Mitygacja: `migrate/unzip/reader/diff` poza grafem tła (walker).
11. **Czerwone pełne `vitest` w falach A–C** (nieaktualne bundle, zmiana tekstów popupu łamie e2e helpery). Mitygacja: wyjątki nazwane w konwencjach, TEST0 jako pierwsze
    zadanie e2e, zapis w `state.md`.
12. **Inne iteratory strony (Map/Set/String) w modułach MAIN poza ścieżką maskowania** mogą gubić dane (nie powodują przecieku). Poza AC-2.5. Wpis do README „Znane ograniczenia”
    i kandydat do backlogu E5.
