# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/). Wpisy per epik pod `[Unreleased]` do czasu release.

## [Unreleased]

## [0.6.0] - 2026-10-27

### E4 — Wyjście: podsumowanie, viewer, przekazanie, dostęp dla agenta (rozszerzenie 0.6.0, `schemaVersion` bez zmian: 4)

#### Dodano
- **Dla developera — pełne `summary.md`** (`src/lib/summary.js`): środowisko, ostatnie kroki (z oznaczeniem kroku przed pierwszym błędem), grupy błędów, nieudane zapytania, CWV per dokument, najwolniejsze zasoby, ciasteczka i rozmiar, prywatność (linia o regułach v2, o regułach wyłączonych przez developera i o zrzucie), uwagi; stała struktura, ≤ 16 KB i 200 linii, wartości ze strony w code spanach. Ten sam tekst w rozszerzeniu, viewerze i MCP. Wspólne moduły: `snapshot-query.js`, `snapshot-metrics.js`, `snapshot-diff.js`.
- **Viewer** `dist/page-debug-viewer-<wersja>.html` (artefakt `npm run pack`; źródło `src/viewer`, generowany do `src/standalone/viewer.html`): jeden plik otwierany z `file://`, offline, z CSP z hashami i renderowaniem wyłącznie przez tekst. Zakładki: Podsumowanie, Kroki, Błędy, Sieć, Konsola, CWV, DOM, Storage. Czyta paczki v1–v4 (`unzip.js`, `migrate.js`, `package-reader.js`); dla v1–v3 pokazuje baner „Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny”.
- **Serwer MCP** `mcp/` (własny transport stdio, bez zależności npm, tylko odczyt): katalog paczek przez argument albo `PDS_SNAPSHOTS_DIR` (jeden katalog na serwer) i siedem narzędzi: `list_snapshots`, `get_summary`, `get_errors`, `get_network`, `get_vitals`, `get_steps`, `diff_snapshots`; limit odpowiedzi 25 000 znaków. Klucz diffu statusów to metoda + `pathname` bez hosta (staging vs produkcja). `list_snapshots` ma pole `warnings`, `get_summary` dla v<4 dopisuje notę o braku redakcji.
- **Dla zgłaszającego — ekran „Zapisano”** w popupie: nazwa pliku, „Pokaż plik” (sprawdzenie `downloads.search`, potem `downloads.show`), „Nowe nagranie”; stan `lastSaved` w `storage.session`. Zdanie zgody (dane osobowe, „Klikając „Nagrywaj”, zgadzasz się…”) stoi nad przyciskiem „Nagrywaj” i nie przewija się poza ekran. Wysyłki z popupu nie ma (decyzja 2026-10-26) — zgłaszający wysyła plik sam.
- **Konfiguracja deweloperska**: `npm run build|dev:* -- --config <plik>` albo `PDS_CONFIG` wbudowuje `disabledRules` do `lib/dev-config.js`; polityka `storage.managed` (Chrome: `managed-schema.json`, Firefox: `policies.json` `3rdparty`) nadpisuje ją w całości. Wyłączyć można tylko `email`, `phone` i `html-structure`. `npm run pack --config` czyta tylko jawny `--config` i dopisuje do zipów sufiks `-devconfig` z ostrzeżeniem. Popup i `summary.md` ujawniają wyłączone reguły.
- Notatki o zrzucie w `notes`: powód wyłączenia przez popup (ramki innych serwisów, nieudane sprawdzenie) i liczba niezakrytych ramek na zrzucie (`src/lib/screenshot-notes.js`); polska linia „Zrzut ekranu: …” w `summary.md`.
- Dokumentacja: [docs/JAK-CZYTAC-PACZKE.md](docs/JAK-CZYTAC-PACZKE.md), `mcp/README.md`; zaktualizowana instrukcja dla zgłaszającego (ekran „Zapisano”, wysyłka samodzielna, zgoda nad „Nagrywaj”).

#### Zmieniono
- **Redakcja `rulesVersion: 2`** (nazwy reguł i znaczników bez zmian): klucz na początku stringu JSON (IN1), `code`/`ticket` w tekście i w adresach względnych (IN3), podgląd `{ truncated, preview }` argumentów konsoli bez zniekształceń i bez zawyżonego `masked` (IN4), kontener w parze z kluczem i zdania kończące się słowem-kluczem w argumentach konsoli (IN5), wyjątek „proza” dla `auth`/`session`/`key` bez cudzysłowu (PB-2), poprawka IN1b (`Error: password: …` po innym kluczu).
- **`srcdoc` ramek**: atrybut `dom.iframes[].attributes.srcdoc` zastępuje `[redacted:html-structure]` (niósł pełny HTML ramki z wartościami pól).
- Maska pól na zrzucie: margines 2 px CSS zamiast 8 px (etykiety nad polami zostają czytelne; IN7).
- `redaction.disabledRules` pochodzi z konfiguracji developera (w 0.5.0 zawsze `[]`); `rulesVersion` w świeżej paczce to `2`. Walidator przyjmuje `1 ≤ rulesVersion ≤ 2`.
- Manifest Chrome: klucz `storage.managed_schema` (nie jest uprawnieniem; Firefox go nie ma). Uzasadnienia uprawnień `storage` i `downloads` w README uzupełnione o `storage.managed` i „Pokaż plik”.
- **`schemaVersion` zostaje 4** — bez nowych ani usuniętych pól; konsument v4 z 0.5.0 czyta paczki 0.6.0 (patrz [docs/snapshot-schema.md](docs/snapshot-schema.md#wersja-4--zmiany-w-060-e4)).

#### Naprawiono
- Maskowanie w MAIN odporne na podmienione iteratory strony (IN2, IN2b): pętle indeksowe zamiast `for…of` w `recorder`, `hooks-console`, `serialize` i w regułach — wcześniej nagranie pod podmienionym `Array.prototype[Symbol.iterator]` było puste.
- Wydajność redakcji: `TRAILING_BLANKS` i `INPUT_TAG` liniowe (40 000 spacji: 1461 ms → 0,5 ms).
- Viewer: pasek zakładek nie jest widoczny przed wczytaniem paczki (FIX1).
- Review i QA: pary w `'token: abcd…'` z apostrofem, `redactJsonPreview` z parami `{name, value}`, pusty tekst argumentów `{ truncated, preview }` w grupowaniu błędów, ukryte `INPUT_TAG`/`TEXTAREA` przy wyłączonym `html-structure`, tekst o nagrywaniu w innej karcie na ekranie „Zapisano” (QA F-3), `pack` nie czyta `PDS_CONFIG` z env niejawnie.

#### Bezpieczeństwo
- Wyciek wykryty w TEST3 i naprawiony przed wydaniem: `Error: password: …` (para po innym kluczu) była jawna; `dom.iframes[].attributes.srcdoc` niósł wartości pól formularzy ramki (QA F-2).
- Viewer i MCP renderują dane z paczki wyłącznie jako tekst, CSP viewera blokuje skrypty inline i sieć; MCP czyta tylko wskazany katalog (odrzuca ścieżki, `..` i dowiązania symboliczne), nie zapisuje i nie łączy się z siecią.
- Brak nowych uprawnień względem 0.3.0. Do sklepów trafia zawsze build bez `--config`; zipy `*-devconfig.zip` są tylko do użytku wewnętrznego.
- Znane ograniczenia (README „Znane ograniczenia”): frazy-hasła złożone z samych słów pod `session:`/`key:`/`auth:` w cudzysłowie nie są maskowane (PB-2); podgląd JSON długiego wpisu konsoli nie zamaskuje `{"value":…,"name":"password"}`; nieutwardzone są podmienione iteratory `Map`/`Set`/`String`, `%ArrayIteratorPrototype%.next` i metody tablic; telefony w tekście kroków nie są maskowane; `downloads.show` nie sygnalizuje usunięcia pliku.
- Do ręcznej weryfikacji: Eksplorator Windows (Pokaż plik), prawdziwy klient MCP, Firefox i Edge, polityki `storage.managed` w obu przeglądarkach (Firefox: spike S3).

## [0.5.0] - 2026-10-26

### E3 — Prywatność i rozmiar paczki (schemat paczki v4)

#### Dodano
- Paczka jako jeden plik `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip` ze `snapshot.json`, `summary.md` (minimalne podsumowanie po polsku z raportem redakcji) i `screenshot.jpg`; zip otwiera się Eksploratorem Windows i Archiwizatorem macOS (`src/lib/zip.js`, `file-name.js`, `summary.js`).
- Redakcja całej paczki w tle przed zapisem (`src/lib/redact.js`, `redact-rules.js`, `redact-page.js`; `rulesVersion: 1`): poziom *Zawsze* (klucze wrażliwe, JWT, `Bearer`/`Basic`, karta, IBAN, PESEL, długie sekrety, dane w adresach, wartości pól) i *Domyślnie* (`email`, `phone`, `html-structure`; wyłączane tylko opcją developerską). Znaczniki `[redacted:<reguła>]`, raport `redaction` (`rulesVersion`, `disabledRules`, `masked` per sekcja) i linia w `summary.md`.
- Nowe klucze wrażliwe: `cvv`, `cvc`, `pass`, `pw` (cały klucz) oraz `code`, `ticket` tylko jako parametr adresu URL; pary w JSON-ie zagnieżdżonym w stringu, w encjach (`&quot;`, `&lt;`), w wartościach uciętych na granicy limitu, w treści formularzy kodowanej procentowo oraz w argumentach konsoli (`console.log('password:', x)`).
- `storage.cookies[]`: `name`, `sizeBytes`, `valueHash` (8 znaków hex SHA-256, czysty JS w `src/lib/sha256.js`) i `storage.cookiesTotalBytes`.
- `dom.structure` (struktura bez tekstów, ≤ 300 000 znaków) i `dom.fullHtml` (tylko z opcją developerską) zamiast `dom.html.outerHTML`; `dom.images[].altLength`, `dom.iframes[].titleLength`, `dom.forms[].elements[].fileCount`; element DOM w `consoleLogs[].args` ma `structure`.
- Przełącznik „Dołącz zrzut ekranu” przy *Zapisz paczkę* (domyślnie włączony, niezapamiętywany; wyłączony, gdy na stronie są okienka innych serwisów albo nie udało się sprawdzić strony — wtedy z notatką pod spodem) oraz maska pól formularzy na zrzucie (`screenshots[].maskedFields`, fail-closed: bez maski nie ma obrazu).
- Popup po zapisie mówi, że plik nie ma zrzutu (wyłączony albo nie udało się go bezpiecznie wykonać).
- Budżet rozmiaru: zip ≤ 2 MB (`limits.packageBytes`), stała kolejność cięcia (`src/lib/budget.js`), nowe flagi `truncated.html|resources|dom|storage|stacks`, notatki z liczbami i notatki o całkowitej różnicy między nagranym a zapisanym (`recordLoss`).
- Kontrakt opcji developerskich `devOptions: { disabledRules }` w `exportPackage` (bez źródła opcji w tym epiku — E4-D4).
- Walidator v4 i fixture `tests/fixtures/snapshots/v4.json`; korpusy redakcji (sensitive/benign), testy property-based, e2e prywatności, maski zrzutu, formatu i rozmiaru.

#### Zmieniono
- **Schemat paczki v3 → v4 jest łamiący**: kontener zip zamiast `page-debug-snapshot-<ms>.json`, nowy klucz `redaction`, usunięte `attachments` i `dom.html.outerHTML`, `storage.cookies` z tekstu na listę, `dom.forms[].elements[].value` → `valueLength`, `alt`/`title` → długości; migracja v3 → v4 w `docs/snapshot-schema.md`. `schemaVersion: 4` także w fallbacku konsolowym (ten sam potok eksportu, bez zrzutu).
- Lista „Do pliku trafią:” w popupie: bez „mogą zawierać dane logowania” przy sieci i ciasteczkach; nowe zdanie, że hasła i tokeny są usuwane, a wartości ciasteczek zastępowane krótkim skrótem; pozycja o zrzucie mówi, że pola tej strony są zakryte, ale formularze osadzone z innych serwisów mogą być widoczne.
- Zrzut i potok eksportu: `maskSecrets` w MAIN zostaje obroną w głąb; rozstrzyga redakcja w tle. Pełny HTML nie jest osiągalny dla zgłaszającego.
- Krok `change` na `input[type=file]` ma `fileCount` zamiast `valueLength` (długości ścieżki `C:\fakepath\…`).
- Serializacja argumentów konsoli z budżetem (`serializeCapped`), przechwycone `JSON`/`RegExp`/metody `String` w MAIN, przycinanie `rec.docs` usuwa odpowiadające `pds:doc:*`.
- Walker osiągalności plików (`scripts/lib/reachability.mjs`) pomija komentarze i wywołania metod.

#### Naprawiono
- Przecieki znalezione w review: JSON zagnieżdżony w stringu i w encjach, cięcie przed redakcją zostawiające początek sekretu, para `klucz: "wartość"`, karta po prefiksie (`order-id-<numer>`), JSON w treści formularza, pary `{name, value}`, XML po `&lt;`, pary w argumentach konsoli (w tym łańcuch kluczy), wroga strona podmieniająca `Array.prototype.map`/`String.prototype.replace` (puste lub przekłamane sekcje).
- Fałszywie dodatnie `card` na UUID; utrata `?x=1` po `;jsessionid=` w tekście; kolejność skracania podglądów odpowiedzi (zostają najnowsze).
- Notatka o cięciu logów nie zaniża już straty (`recordLoss`).

#### Bezpieczeństwo
- **Zmiana obsługi danych:** rozszerzenie nadal nic nie wysyła, ale plik zmienił się z jawnego JSON-a w zredagowany zip. Hasła, tokeny i wartości ciasteczek są usuwane automatycznie (zamiast jawnych), e-mail i telefon w danych strony są maskowane domyślnie, a pełny HTML i wartości pól nie trafiają do paczki. Zmiana jest ujawniona zgłaszającemu w popupie przed *Nagrywaj* i w instrukcji.
- Brak nowych uprawnień względem 0.3.0; surowe dane żyją tylko w `storage.session` do chwili zapisu, redakcja następuje przy eksporcie, a obraz bez maski żyje wyłącznie w pamięci tła.
- Znane ograniczenia (patrz README „Znane ograniczenia”): **ramki z innych originów (płatność, logowanie) nie są zakrywane na zrzucie** (decyzja PB-1 B; przełącznik startuje wyłączony przy widocznych ramkach), fałszywie dodatnie i luki redakcji regułowej (N7, N8, N12, N15, `console.log('Your password is', x)`, `&amp;quot;`, podwójne kodowanie procentowe, base64 < 32 znaków, `AKIA…` jako identyfikator), `valueHash` bez soli, notatka „turned off by the reporter” także przy wyłączeniu przez popup.
- Do ręcznej weryfikacji: Eksplorator Windows 11 i Archiwizator macOS, mignięcie przy zrzucie, pinch-zoom fizycznym gestem, zamknięty shadow DOM w Firefoksie, stoper developera.

## [0.3.0] - 2026-10-23

## [0.4.0] - 2026-10-23

### E2 — Kompletność danych: kroki, CWV, statusy, zrzut (schemat paczki v3)

#### Dodano
- `steps[]` — kroki zgłaszającego: `click` (selektor CSS, `text` ≤ 80 znaków), `input`/`change` (`inputType`, `valueLength`; nigdy wartość), `submit`, `key` (tylko Enter/Escape/Tab/strzałki), `navigate` (`url`, `via`); kolejne wpisywanie w to samo pole i kolejne `replaceState` są scalane.
- `vitals[]` — TTFB, FCP, LCP, CLS, INP z `rating` i atrybucją (LCP: `selector`/`url`; CLS: `sources`; INP: `selector`, `eventType`, `inputDelay`/`processing`/`presentation`) oraz do 20 najdłuższych `longTasks` ze skryptem; niedostępna metryka to `{ available: false, reason }`.
- `network[]` obejmuje zasoby strony (`img`, `script`, `css`, `font`, `other`) ze `status`, `sizeBytes`, `statusUnavailable?`; `documents[].status` (status HTTP dokumentu).
- `responseBodyPreview` / `responseBodyTruncated` — fragment treści odpowiedzi `fetch`/XHR ze statusem ≥ 400 i treścią tekstową (≤ 4096 znaków na wpis, ≤ 262 144 łącznie, zostają najnowsze; `truncated.responseBodies` + notatka).
- Zrzut ekranu widocznej części karty przy „Zapisz paczkę” (`screenshots[]` + `attachments`, JPEG ≤ 300 KB jako base64), tylko dla aktywnej karty na origin nagrania; notatka z powodem, gdy zrzutu nie ma.
- `overview` (liczby na górze pliku), `frame` w błędach z iframe'ów tego samego originu, `Error.cause` (do 5 poziomów), `stack` ≤ 16 000 znaków, nowe `limits` (`steps`, `stackChars`, `responseBodyChars`, `responseBodyTotalChars`, `screenshotBytes`, `longTasks`) i `truncated.steps`, `truncated.responseBodies`.
- Ujawnienie w popupie rozszerzone do 8 pozycji (kroki, fragmenty odpowiedzi, zrzut); popup odświeża stan przy nawigacji karty (`otherOrigin`).
- Walidator schematu `tests/helpers/snapshot-validator.js` i fixture `tests/fixtures/snapshots/v3.json`; fixture'y e2e (CWV, sieć, kroki, zrzut), wyrocznia `web-vitals` w testach (devDependency, nie trafia do `dist`).

#### Zmieniono
- **Schemat paczki v2 → v3 jest łamiący**: nowa kolejność kluczy (`overview` → `notes` → `steps` → `runtimeErrors` → `network` → … → `dom` → `attachments`), nowe znaczenie `network[].type` i `limits.network`, `limits.entryChars` 40 000; migracja v2 → v3 w `docs/snapshot-schema.md`.
- Protokół tło ↔ strona w wersji 2; tło zatrzymuje recorder poleceniem `stop`; `schemaVersion: 3` także w fallbacku konsolowym (`console-snapshot.js`, `INP` tylko z interakcji po wklejeniu).
- Brak uprawnień dodanych względem 0.3.0 (zrzut używa `activeTab`; statusy z Resource Timing, `webRequest` odrzucono).

#### Naprawiono
- Status `0` nie jest zapisywany gołym zerem: `fetch` `no-cors` to `status: null` + `statusUnavailable: "cross-origin"`, inne niewyjaśnione `0` to `unknown`.
- Brak sekcji strony w paczce zawsze ma notatkę („Section … was not received from the page.”); `truncated.responseBodies` zawsze ma notatkę.
- Budżet podglądów odpowiedzi zachowuje najnowsze podglądy zamiast najstarszych.
- Metryki: strona prerenderowana (`prerendering`) nie jest już traktowana jako ukryta od startu (nie dostaje fałszywego `hidden-at-start`).
- `steps[].url` przechodzi przez maskowanie tokenów; checkbox/radio nie mają `valueLength`.
- Popup (Firefox): komunikat „Zapisano plik …” nie jest przycięty pod listą ujawnienia.
- Wyciek `removeEventListener` między testami `hooks-errors`; timeout testów na `/mnt/c`.

#### Bezpieczeństwo
- Kroki nie zawierają wartości pól ani długości haseł; `url` kroków i podglądy odpowiedzi mają zamaskowane tokeny (`[redacted:<reguła>]`: JWT, `Bearer`, wartości przy kluczach wrażliwych).
- Zrzut powstaje tylko na origin nagrania, przy aktywnej karcie, na jawne „Zapisz paczkę”; ostrzeżenie w ujawnieniu: na zrzucie widać wszystko z ekranu, także dane wpisane w pola (hasła są ukryte).
- Znane ograniczenia: **zrzut nie jest maskowany** (przełącznik i maskowanie pól — E3); maskowanie w podglądach jest regułowe (nie łapie `klucz: wartość`, `sessid`, `Basic <b64>`, liczb JSON przy kluczach wrażliwych — E3); zasoby cross-origin (CDN) bez statusu; Firefox 158: brak `CLS` i `longTasks`, `activeTab` cofany przy przeładowaniu (brak zrzutu); `input type=file` zapisuje długość `C:\fakepath\…` (E3); do ręcznej weryfikacji: uśpienie komputera, aktualizacja 0.3.0 → 0.4.0 z nagraniem.

## [0.3.0] - 2026-10-23

### E1 — Model nagrywania: dane od startu strony (schemat paczki v2)

#### Dodano
- Przepływ **Nagrywaj → Zapisz paczkę**: po „Nagrywaj” rozszerzenie prosi o dostęp do witryny aktywnej karty (`permissions.request`), rejestruje skrypty (`scripting.registerContentScripts`, `document_start`) i przeładowuje kartę; nagrywanie obejmuje konsolę, błędy i sieć od początku ładowania strony, także po przeładowaniach i nawigacjach w obrębie witryny.
- Tło: `src/background.js` jako service worker (Chrome) i event page (Firefox), stan w `storage.session` (`src/lib/session-store.js`, `src/lib/recording.js`), znaczek ● / ■ na ikonie.
- Limit nagrywania 10 minut (auto-stop, zapis nadal możliwy; `recordingStoppedReason: "time-limit"`).
- Zapis przez `downloads.download`; sukces („Zapisano plik …”) dopiero po `complete`, z nazwą faktycznego pliku; limity 15 s (zrzut) i 60 s (pobranie).
- Popup w trzech stanach (gotowy / nagrywam / zapis) z listą „Do pliku trafią:” i zgodą (`disclosureItems`, `consentNotice` w `src/popup/messages.js`); nowe komunikaty: `permissionDenied`, `pageBusy`, `saveCancelled`, `downloadFailed`, `recordFailed`, `stoppedByLimit`, `otherTabRecording`, `otherOrigin`.
- Schemat paczki **v2** (`schemaVersion: 2`): `documents[]`, `limits`, `truncated`, `source`, `recordingStartedAt`, `recordingStoppedReason`, `timeOrigin`, czas `t` względem `timeOrigin` dokumentu, `stack` w logach konsoli, `method`/`statusText`/`redirected`/`requestBody` w `network`; fixture `tests/fixtures/snapshots/v2.json`; migracja v1 → v2 w `docs/snapshot-schema.md`.
- Uprawnienia: `storage`, `downloads`, `optional_host_permissions` (`http://*/*`, `https://*/*`, `file:///*`); uzasadnienia PL/EN i akapit o cofaniu dostępu do witryny w `README.md`.
- Kod strony jako moduły ES w `src/page` + generator `scripts/gen-content.mjs` (`npm run gen`, `npm run gen -- --check`) → `src/content/{isolated,main}-world.js` i `src/standalone/console-snapshot.js`.
- Fallback konsolowy `console-snapshot.js` (`PageDebugSnapshot.start/stop/download/snapshot`) na tym samym kodzie i schemacie (`source: "console"`).
- Harness e2e dla tła: `serviceWorker()`, `stopServiceWorker()`, `grantOrigin()`, `sessionStorage`, `downloadDir`, `startRecording`, `saveRecording`, `setRecordingLimit`, `popupState`; flaga `PDS_E2E_NO_BUILD=1`; testy izolacji, nawigacji, limitu czasu, wydajności i fallbacku.

#### Zmieniono
- **Schemat paczki v1 → v2 jest łamiący** (`initializedAt` → `recordingStartedAt`, `timestamp`/`startedAt` → `t`, `network[].input/init/headers/body` → `method`/`url`/`requestHeaders`/`responseHeaders`/`requestBody`, usunięte `version`); konsumenci rozpoznają v1 po braku `schemaVersion`.
- Hooki: `fetch` i `XMLHttpRequest` przez `Proxy` (zachowane `instanceof` i stałe), `console` ze `stack`, bufory pierścieniowe z limitami (5000 / 1000 / 5000 wpisów); po zapisie hooki są zdejmowane, a wrapper założony przez stronę nie jest nadpisywany.
- Termin nagrywania liczony z `Date.now()` (a nie `performance.now()`), więc uśpienie komputera nie przedłuża limitu.
- Budżet `storage.session` (≤ 3 MB na dokument, ≤ 8 MB razem) egzekwowany przed zapisem; przy braku miejsca najstarsze dokumenty zostają tylko z licznikami.
- `documents[].recorded` jest `false` także dla dokumentu, do którego recorder się nie podłączył; `notes` wyjaśnia, gdy bieżąca strona załadowała się po auto-stopie.

#### Usunięto
- Przepływ E0 (jednorazowy zrzut przez `scripting.executeScript`): `src/page/page-debug-snapshot.js`, `src/popup/snapshot-tab.js`, `src/popup/run-in-page.js`, przycisk „Debug snapshot”, globalne `window.__PAGE_DEBUG_SNAPSHOT__` oraz testy i specyfikacje e2e E0.

#### Naprawiono
- Fałszywy sukces przy zablokowanych pobraniach (F3 z E0): komunikat dopiero po potwierdzeniu `downloads.onChanged`.
- Błędy i zapytania sprzed kliknięcia nie giną już — recorder działa od `document_start`.
- Popup nie gubi wyniku `pageBusy` / `failed` / `saveCancelled` przy zmianie stanu tła (komunikat zostaje na ekranie).
- Odmowa zgody na dostęp do witryny pokazuje komunikat zamiast cichego powrotu do stanu początkowego.
- Firefox + strona z dysku (`file://`): komunikat `fileUnsupportedFirefox` zamiast prośby o zgodę, która nie ma sensu.
- Dane nie giną przy przejściu na inną witrynę: bufory są przekazywane przy `beforeunload` i `pagehide`, a `flush` z `frameId≠0` jest przyjmowany (uwierzytelnianie tokenem per dokument).
- E2E: `popup.close() czeka na zamknięcie celu, `openPopupFor` na gotowy dokument; równoległe przebiegi nie przebudowują `dist/` z `PDS_E2E_NO_BUILD=1`.

#### Bezpieczeństwo
- Ujawnienie danych i zgoda w UI: lista „Do pliku trafią:” (w tym treść żądań sieciowych, ciasteczka i dane strony, „mogą zawierać dane logowania”) oraz zgoda przy „Nagrywaj”.
- Dostęp do witryn tylko opcjonalny i tylko dla witryny aktywnej karty; brak `host_permissions`, `tabs`, `webRequest`, `cookies`, zdalnego kodu.
- Brak globali w trybie rozszerzenia (`window.PageDebugSnapshot`, `__PAGE_DEBUG_SNAPSHOT__`); bufor tylko w domknięciu; po zapisie hooki zdjęte, skrypty wyrejestrowane.
- Prywatny kanał MAIN ↔ ISOLATED (odłączony węzeł DOM, `CustomEvent` ze stringiem, intrinsics przechwycone na `document_start`) zamiast `postMessage`: skrypty strony nie czytają bufora ani nie podszywają się pod rozszerzenie.
- Router tła przyjmuje polecenia tylko od popupu rozszerzenia, a wiadomości mostu tylko z ramki głównej karty; wynik zapisu ustala wyłącznie tło.
- Wartości pól `password` i `hidden` są maskowane (`[redacted]`) także w `dom.html.outerHTML`; reszta HTML nadal jawna do E3.
- Strażnik przywracania `console`: wrapper założony przez stronę (np. Sentry) zostaje, nasz staje się przelotowy.
- Znane ograniczenie: **dane nadal niezredagowane** (maskowanie w E3) — ciasteczka, storage, nagłówki i treść żądań, wartości pól formularzy (poza `password`/`hidden`) i `dom.html.outerHTML` trafiają do pliku wprost.
- Znane ograniczenia: `xhr.constructor === XMLHttpRequest` daje `false`; `fetch.toString()` w trakcie nagrywania nie ma nazwy; auto-stop po uśpieniu komputera zapada przy odpaleniu timera; Firefox bez automatycznego e2e (ręczne QA).

## [0.2.0] - 2026-10-22

### E0 — Fundament: repo, build, testy, higiena MV3 (Chrome + Firefox)

#### Dodano
- Dwa targety MV3 z jednej bazy: `dist/chrome` i `dist/firefox` (`npm run build`), manifesty składane z `src/manifest.base.json`, `src/manifest.chrome.json`, `src/manifest.firefox.json`.
- `npm run pack` — po jednym zipie na target: `dist/page-debug-snapshot-<target>-<wersja>.zip` (deterministyczne).
- `npm run icons` — ikony 16/48/128 generowane skryptem `scripts/icons.mjs` (neutralne, bez tekstu i logo).
- `npm run dev:chrome` / `npm run dev:firefox` (`scripts/dev-browser.mjs`, przez `web-ext`) oraz zmienna `PDS_CHROMIUM_BINARY`.
- Testy: vitest + jsdom (jednostkowe, w tym charakteryzacyjne dla `page-debug-snapshot.js`), Playwright e2e na Chromium z `dist/chrome` (headless; `PDS_E2E_HEADED=1` — z oknem), `web-ext lint` w `npm run lint`.
- `npm run check:history` i `scripts/check-repo.mjs` — pilnują, by w repo i historii nie było `*.pem`, `*.crx`, `*.xpi`, `*.zip`, logo ani prawdziwych snapshotów.
- Dokumentacja: `README.md`, `docs/INSTRUKCJA-ZGLASZAJACEGO.md`, `docs/snapshot-schema.md`, sklepowe uzasadnienia uprawnień PL/EN w README.

#### Zmieniono
- Układ repo: `page-debug-extension/` → `src/{popup,page,icons,standalone}`; `console-snapshot.js` → `src/standalone/`; `package.json` w katalogu głównym, bez `dependencies` (usunięto `sharp`).
- Popup pokazuje prawdziwy wynik po polsku (komunikaty w `src/popup/messages.js`): sukces z nazwą pliku, strona niedostępna, brak zgody na pliki lokalne, brak karty, błąd.
- Wstrzykiwanie przez `scripting.executeScript` w świecie `MAIN` zamiast doklejania `<script src="chrome-extension://…">`; usunięto `inject.js`.
- `permissions`: tylko `activeTab` i `scripting`; `description` w manifeście to jedno zdanie.
- Identyfikator Firefoksa: GUID `{799eb178-df9a-41bb-9775-8fc8aff45926}`; ikony bez znaków towarowych (projekt niezależny).
- `scripts/dev-browser.ps1` deleguje do `npm run build` / `npm run pack` i `scripts/dev-browser.mjs`.

#### Naprawiono
- Fałszywy sukces: popup nie mówi już „pobrano”, gdy zrzut się nie udał (błąd wewnątrz skryptu strony jest raportowany).
- Firefox: zrzut nie działał na żadnej stronie (ścieżka pliku wstrzykiwanego rozwiązywana względem popupu) — ścieżka z wiodącym `/`.
- Chrome: strona `file://` bez zgody „Zezwalaj na dostęp do adresów URL plików” pokazuje instrukcję zamiast komunikatu o stronie niedostępnej.
- `scripts/dev-browser.ps1 -Pack` zawsze kończył się błędem (zepsuty filtr) — teraz `npm run pack`.

#### Bezpieczeństwo
- Brak `host_permissions` (w tym `<all_urls>`) i `web_accessible_resources`; rozszerzenie nie ujawnia swojego ID stronom i nie wysyła niczego do sieci.
- Brak zdalnego kodu, `eval` i `new Function` w `dist/*` (test).
- Klucz `.pem`, `*.crx`, `*.xpi`, `*.zip`, `dist/` i prawdziwe snapshoty są ignorowane; historia gita oczyszczona z plików logo.
- Znane ograniczenia (E3): paczka nadal zawiera jawnie ciasteczka, storage, treść strony i wartości pól (poza `password`/`hidden` w `dom.forms`); po zrzucie zostaje `window.__PAGE_DEBUG_SNAPSHOT__`.
- Znane ograniczenia (E1): w Chrome zablokowane automatyczne pobieranie wielu plików może dać komunikat sukcesu bez pliku.
- Znane ograniczenia (Firefox): dodatek ładowany tymczasowo znika po restarcie przeglądarki; trwała instalacja wymaga podpisu AMO (E5).
- Licencja: MIT (`LICENSE`, `package.json`).
