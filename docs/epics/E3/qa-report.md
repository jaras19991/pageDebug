# E3 — QA report (2026-10-26)

Środowisko: Chromium 156 (Playwright 1.64.1, `channel: 'chromium'`, nowy headless, Linux/WSL2, poza sandboxem), Firefox 158.0.1 (Windows 11, headed, `web-ext` 10.8 + Marionette przez Windowsowy `node.exe`; popup otwierany `browserActionFor(...).triggerAction`, kliknięcia i zrzuty popupu z kontekstu chrome — nie prawdziwa mysz). Testowany: working tree, `dist/` zbudowany przed QA (manifest 0.4.0; `npm run build` nie uruchamiany). Fixtures: `privacy.html`, `heavy-e3.html`, `csp-strict.html`, `slow-lcp.html`, własna strona z iframe cross-origin; realny portal `https://wyborcza.pl/` (bez logowania i bez zgody CMP). Skrypty pomocnicze poza repo (scratchpad). Dowody: `docs/epics/E3/qa-evidence/` (PNG ignorowane przez git; `*.jpg`, `*.md` zostają; w dowodach tylko losowe pułapki fixture, żadnych prawdziwych sekretów). Czas: ~65 min; Firefox ograniczony do smoke (start, zapis ze zrzutem, zapis bez zrzutu, fallback konsolowy).

Ograniczenia metody: (1) pomiary czasu to pojedyncze przebiegi, mediana z 5 jest w e2e testera; (2) czas „60 s” developera szacowany z pozycji danych w pliku, bez stopera człowieka; (3) Firefox: klik w popupie to `setHandlingUserInput + click()` z kontekstu chrome; (4) zgoda na origin nadana programowo (bąbel zgody to zakres E1); (5) przy pierwszych przebiegach Firefoksa zrzut padał z `capture-failed`, bo popup nie był otwarty od nowa po przeładowaniu strony (znane z E2: Firefox cofa `activeTab` przy reloadzie) — artefakt harnessu, po ponownym otwarciu popupu zrzut jest.

## Kryteria akceptacji

Legenda: PASS / FAIL / BLOCKED (wymaga człowieka lub środowiska) / n/s (nie powtarzane przez QA; pokryte unit/e2e z `test-coverage.md`). Ch = Chromium, FF = Firefox.

| ID | Wynik | Dowód |
|---|---|---|
| 1.1 | PASS (Ch, FF) | Ch: `snapshot-127.0.0.1-20261026-124447.zip`, 1 plik w pobranych, komunikat „Zapisano plik snapshot-127.0.0.1-20261026-124447.zip — znajdziesz go w pobranych plikach.” (`ch-4-saved.png`). FF: `ff-3-saved.png`, nazwa w komunikacie = nazwa pliku na dysku. Host portalu: `snapshot-wyborcza.pl-20261026-132326.zip` |
| 1.2 | PASS (`unzip -t`), BLOCKED (Eksplorator Win 11, Archiwizator macOS) | `unzip -t`: „No errors detected” dla zipów z Ch (fixture, heavy 1,65 MB, portal, 6 zapisów w jednej sekundzie) i z FF (4 zipy). Eksplorator/Archiwizator: lista dla użytkownika niżej |
| 1.3 | PASS z uwagą (F-6) | `ch-1-ready.png`, `ff-1-ready.png`: brak „mogą zawierać dane logowania” przy sieci i ciasteczkach; jest zdanie „Hasła, tokeny i wartości ciasteczek są usuwane z pliku automatycznie. Plik nadal może zawierać adresy odwiedzanych stron i treść logów.”; brak słów JSON/zip/hash/redakcja |
| 1.4 | PASS (Ch, FF) | Ch (stan *Nagrywam*): przełącznik 122–146 px, *Zapisz paczkę* 145,5–181,5 px w oknie 197 px, bez przewijania (`ch-3-recording.png`). Stan gotowy: *Nagrywaj* 466–502 w 510 px. FF 360×600: *Nagrywaj* kończy się na 592/600 (przycisk przyklejony), `scrollHeight` 641 > 600 — lekkie przewijanie listy, jak w E2; *Nagrywam* 360×181 bez przewijania (`ff-2-recording.png`) |
| 1.5 | PASS (pojedyncze przebiegi) | Ch: fixture 54–104 ms, portal 206 ms, heavy-e3 1 492 ms (5 000 logów × 40 000 zn. + 5 000 zapytań + DOM 50 000). FF: 117–121 ms (zrzut + maskowanie). Mediana z 5: e2e testera |
| 2.1 | PASS (Ch, FF) | Domyślnie włączony (`ch-3-recording.png`, FF `recState.toggle: true`); wyłączony → zip bez `screenshot.jpg`, `screenshots: []`, `overview.screenshot:false`, notatka „Screenshot not included (turned off by the reporter).” (Ch `ch-6-toggle-off.png`; FF zip `…132132`). Wybór nie jest zapamiętywany: po kolejnym nagraniu znów włączony |
| 2.2 | PASS (Ch DPR 1, FF DPR 1); DPR 2 n/s | `ch-5-screenshot-masked.jpg`, `ff-4-screenshot-masked.jpg`: email, tel, text, textarea, select, karta, hasło, `q`, contenteditable, pole w same-origin iframe i `input[type=file]` zamalowane na jednolity szary; checkbox/radio/range/color/przyciski widoczne. `maskedFields`: Ch 9, FF 11. Iframe cross-origin: niezakryty (PB-1 B, F-1). Uwaga kosmetyczna F-4 |
| 2.3 | BLOCKED (mignięcie); wartości/scroll n/s | mignięcie ≤ 1 klatki — tylko oko człowieka. Wartości, focus, `scrollY` — e2e testera |
| 2.4 | PASS (pinch-zoom), reszta n/s | Ch, `Emulation.setPageScaleFactor 2` (`visualViewport.scale` = 2): zapis udany, brak obrazu, notatka „No screenshot: form fields could not be hidden (page is zoomed in).” Nigdy obraz bez maski. Pozostałe ścieżki błędu — unit |
| 3.1, 3.2 | n/s | unit (korpus, sekcje) |
| 3.3 | PASS (spot) | `…/api/login?access_token=[redacted:key-token]`; portal: `sd_tc_string=[redacted:jwt]`, `do_sid=[redacted:key-sid]` w `dom.structure` i URL-ach |
| 3.4 | n/s (input) | krok `input` e-mail: `valueLength:25`, bez wartości. `input[type=file]` — e2e testera; na `privacy.html` pole jest zamalowane na zrzucie |
| 3.5 | PASS (Ch, FF) | `privacy.html`: JWT w localStorage, cookie `sid`, token w `?access_token=` i w `console.log`, `Authorization: Bearer …`, e-mail, hasło, numer karty, telefon: `grep -c -a` po wszystkich plikach zipa (`snapshot.json`, `summary.md`, `screenshot.jpg`) = 0 (Ch `…124447`, FF `…132125`; skrypt `traps.py`: 0 linii LEAK). FF dodatkowo bez zrzutu i fallback = 0 |
| 3.6 | n/s | e2e `privacy::hostile page` |
| 3.7 | PASS (FF), Ch n/s | FF: `console-snapshot.js` wklejony w `privacy.html` → `PageDebugSnapshot.download()` → zip `…132135` (`source: "console"`, notatka „Screenshots are not available without the extension.”), 0 trafień pułapek, `unzip -t` OK |
| 4.1 | PASS | `[redacted:key-auth]` (localStorage `auth`), `[redacted:key-authorization]`, `[redacted:key-password]`, `[redacted:email]` w `requestBody`, `[redacted:key-token]` ×4; żaden klucz usunięty, żadne `null` |
| 4.2 | n/s | unit property-based |
| 4.3 | PASS | `redaction.masked` Ch fixture: network 4, consoleLogs 2, performance 1, storage 1 = 8; markerów w `snapshot.json`: 8; `summary.md`: „Zamaskowano 8 wartości w 4 sekcjach (reguły v1).”. Portal: 54 = 2+1+51; markerów 54 |
| 4.4 | PASS | `storage.cookies: [{"name":"sid","sizeBytes":36,"valueHash":"8ce7146b"}]`, `cookiesTotalBytes:36`; wartość `sid` nieobecna; portal: 11 ciasteczek z `valueHash` |
| 4.5 | n/s | unit |
| 5.1 | PASS z uwagą (F-3) | portal wyborcza.pl: 2 z 83 wpisów `network` (2,4 %) ze znacznikiem, próg 20 %. Jeden FP: UUID w `x-ms-request-id` |
| 5.2 | PASS | `dom.structure` bez tekstów i `value` (`<h1></h1>`, `<input type="email" id="f-email" class="field mask">`), `fullHtml: null`, brak `outerHTML`; portal 223 094 zn. ≤ 300 000; heavy: cięte do 300 000, `truncated.html:true` + notatka „dom.structure was cut to 300000 characters; 39019 elements were not included.” |
| 5.3, 5.4 | n/s | unit |
| 5.5 | PASS (szacunek, nie stoper) | patrz „Scenariusz developera”: błąd, nieudane zapytania i kroki leżą w pierwszych 4,3 KB `snapshot.json`, `summary.md` ma 25 linii |
| 6.1 | PASS | heavy-e3: zip 1 652 327 B (limit 2 097 152; `snapshot.json` 2,66 MB, zrzut 304 KB); portal 160 048 B; privacy 28,5 KB; FF 46 KB |
| 6.2 | PASS z uwagą (F-2) | heavy: nietknięte `steps` 4, `runtimeErrors` 5, `network` z `status` 500 ×20, `vitals`, metadane zrzutu; cięte: `consoleLogs`, `network`, `html`, `resources`, każde z `truncated.<sekcja>:true` i notatką. Notatka o logach zaniża liczbę (F-2) |
| 6.3 | n/s | unit (opcja developerska) |
| 6.4 | PASS | kolejność `snapshot.json`, `summary.md`, `screenshot.jpg`; `screenshots[0].file: "screenshot.jpg"`; `grep -c "data:image\|/9j/"` w `snapshot.json` = 0 (Ch fixture, heavy, portal, FF) |
| 6.5 | n/s | unit/perf |
| NFR uprawnienia, dist | n/s | e2e testera |

Wynik: PASS 20 (w tym 1.3, 5.1, 6.2 z uwagą; 1.2 częściowo), FAIL 0, BLOCKED 2 (część 1.2: Eksplorator/Archiwizator, 2.3: mignięcie), n/s 12 (pokryte unit/e2e).

## Scenariusz zgłaszającego — obserwacje

Wykonane dosłownie jak osoba nietechniczna, na `privacy.html` (Chrome i Firefox):
- **Kliknięcia: 3** (ikona → *Nagrywaj* → ikona → *Zapisz paczkę*; plus odtworzenie problemu). Przełącznika nie trzeba ruszać, domyślnie włączony.
- Popup w stanie gotowym: lista „Do pliku trafią:” (8 pozycji) jest zrozumiała po polsku, bez żargonu. Zdanie „Hasła, tokeny i wartości ciasteczek są usuwane z pliku automatycznie. Plik nadal może zawierać adresy odwiedzanych stron i treść logów.” jasno mówi, co zostaje. Pozycja „zrzut ekranu … pola formularzy są na nim zakryte, reszta ekranu jest widoczna” — zrozumiała, ale nie jest prawdziwa dla iframe cross-origin (F-1).
- Stan *Nagrywam*: „Nagrywam od 12:44:46”, „Odtwórz problem, a potem kliknij „Zapisz paczkę”.”, pole „Dołącz zrzut ekranu” nad przyciskiem. Jasne, wiadomo co dalej.
- Po zapisie popup wraca do stanu gotowego z zielonym komunikatem na górze: „Zapisano plik snapshot-127.0.0.1-20261026-124447.zip — znajdziesz go w pobranych plikach.” Nazwa pliku jest „techniczna”, ale komunikat podaje dokładną nazwę, także z „ (1)” przy kolizji. Po zapisie nagrywanie się kończy (kolejny zapis wymaga *Nagrywaj* i odświeżenia strony) — nie jest to napisane w popupie, ale stan „Nagrywaj” jest oczywisty.
- Czas *Zapisz → Zapisano*: 54–206 ms zwykłe strony, 1,5 s ekstremalnie ciężka strona. Zrzut wygląda sensownie, pola zakryte szarym (F-4: ramki zakrywają dolną połowę etykiet nad polami).
- **Dwa zapisy w tej samej sekundzie** (zapis → *Nagrywaj* → zapis w jednym popupie, 6 razy w ~2 s): komunikaty `…124813.zip`, `…124813 (1).zip`, `… (2).zip`, `… (3).zip`, `…124814.zip`, `… (1).zip`; pliki na dysku mają dokładnie te nazwy (komunikat podaje faktyczną nazwę, nie planowaną). PASS.
- **Iframe cross-origin na zrzucie** (strona `127.0.0.1` z ramką `localhost` z formularzem): ramka z e-mailem, telefonem, imieniem widoczna na zrzucie (`ch-8-xo-iframe-screenshot.jpg`), `maskedFields: 0`, brak notatki. Zgodne z decyzją PB-1 (B); ocena w F-1.
- Ścieżka błędu w popupie: strona `chrome://version` → „Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.” (`ch-NEG-1-chrome-page.png`), przyciski ukryte — zrozumiałe.
- Gdy zrzut się nie uda (pinch-zoom, `capture-failed`), zgłaszający nie dostaje o tym informacji w popupie — komunikat „Zapisano” jest taki sam, powód jest tylko w notatce paczki po angielsku (F-5).

## Scenariusz developera — czas do odpowiedzi

Paczka heavy-e3 (5 błędów, 20 nieudanych zapytań, 3 kliki): `summary.md` ma 25 linii i od razu mówi: „Błędy JavaScript: 5”, „Nieudane zapytania: 20”, „Kroki: 4”, zrzut: tak, raport redakcji i listę cięć w „Uwagach”.
- **(a) pierwszy błąd:** `summary.md` podaje liczbę, treść w `snapshot.json` linia 110 (bajt 2 685), `Uncaught Error: heavy error 0`, plik i linia. Szacunek: ≤ 20 s.
- **(b) nieudane zapytanie:** `snapshot.json` linia 162 (bajt 4 300), pierwszy wpis `network`: `500 …/status/500?fail=0`. Wpisy ze statusem ≥ 400 nie są cięte. Szacunek: ≤ 30 s. `summary.md` nie wymienia, *które* zapytania padły — trzeba otworzyć `snapshot.json` (E4: pełne summary).
- **(c) co kliknął przed błędem:** `steps` linia 80 (bajt 2 138): `click #act` ×3 w 2 711/2 771/2 820 ms, błąd w 2 872 ms, zapytania 500 w 2 822 ms. Szacunek: ≤ 15 s.
- Całość „co się zepsuło” ≤ 60 s: wynik PASS wg szacunku (klucze `steps`, `runtimeErrors`, `network` stoją przed `consoleLogs` (linia 769) i `performance`, więc ciężkie dane są na końcu). Nie mierzone stoperem człowieka. Realny portal (wyborcza.pl, bez błędów): `summary.md` pokazuje 1 błąd „Script error.”, bez nieudanych zapytań; kroki: reload + klik `#onetrust-policy-text`.
- Developer widzi, co zamaskowano: `redaction.masked` + znaczniki `[redacted:key-token]`, `[redacted:jwt]`, ciasteczka z `valueHash`; `dom.structure` zamiast `outerHTML`.

## Prywatność — wynik grep

| Paczka | Wartości szukane | Wynik |
|---|---|---|
| Ch `privacy.html` (zip 28,5 KB) | JWT, `sid`, token z URL i konsoli, Bearer, `jan.kowalski`, `4111 1111`, `Sekret123`, `600 700 800` w `snapshot.json`, `summary.md`, `screenshot.jpg` (bajty) | 0 |
| FF `privacy.html` ze zrzutem | to samo | 0 |
| FF bez zrzutu | to samo | 0 |
| FF fallback konsolowy | to samo (bez zrzutu) | 0 |
| Portal wyborcza.pl | `sid=`/`do_sid=` → `[redacted:key-sid]` ×45, `jwt` ×4, `card` ×3, `long-secret` ×2; cookies jako `valueHash` | brak jawnych wartości ciasteczek w paczce |

Brak znalezisk critical.

## Rozmiar i czas

| Strona | zip | `snapshot.json` | Zapisz → Zapisano |
|---|---|---|---|
| `privacy.html` (Ch) | 28,5 KB | 16 KB | 104 ms |
| `privacy.html` (FF) | 46 KB | 16 KB | 121 ms |
| wyborcza.pl (Ch) | 160 KB | 430 KB | 206 ms |
| heavy-e3 (Ch) | 1 652 327 B (limit 2 097 152) | 2,66 MB | 1 492 ms |

## Ścieżki negatywne

| Scenariusz | Wynik | Dowód |
|---|---|---|
| `chrome://version` | PASS, komunikat zrozumiały | `ch-NEG-1-chrome-page.png` |
| Strona z surowym CSP (`csp-strict.html`) | PASS: zip z `screenshot.jpg`, 3 wpisy | zip `…124912` |
| Dwa razy *Nagrywaj* (dwa szybkie kliknięcia) | PASS: jedno nagranie, „Nagrywam od 12:49:13” | `ch-NEG-2-double-record.png` |
| Zapis tuż po nawigacji (strona się ładuje) | PASS: zapis udany | `ch-NEG-3-save-during-load.png` |
| Zamknięcie karty w trakcie nagrywania | PASS: popup w nowej karcie w stanie gotowym, bez śladu nagrania | `ch-NEG-4-after-tab-closed.png` |
| Nagrywanie w drugiej karcie | PASS: „Trwa nagrywanie w innej karcie. Kliknięcie „Nagrywaj” zakończy je bez zapisu.” | `ch-NEG-two-tabs-p2.png` |
| Pinch-zoom (scale 2) | PASS: bez zrzutu, notatka | patrz AC 2.4 |
| Zapis z wyłączonym zrzutem po stronie FF | PASS | zip `…132132` |
| Stop nagrywania w trakcie ładowania, uśpienie komputera, limit | n/s (poza zakresem E3, bez zmian od E1/E2) | — |

## Findings

| ID | Waga | Opis | Kroki | Dowód |
|---|---|---|---|---|
| F-1 | MEDIUM (ryzyko zaakceptowane w PB-1 B; do świadomej decyzji) | Zawartość iframe cross-origin (np. płatność) jest widoczna na zrzucie wraz z wpisanymi danymi; paczka nie ma o tym żadnej notatki (`maskedFields: 0`, brak informacji o niezakrytych ramkach), a popup mówi „pola formularzy są na nim zakryte, reszta ekranu jest widoczna”, co dla iframe jest nieprawdą. Zachowanie zgodne z decyzją, ale zgłaszający nie ma szansy go zauważyć (jedyna ochrona: może wyłączyć zrzut). Propozycja: dopisać do ujawnienia „…poza ramkami z innych stron” albo notatkę w paczce o liczbie ramek cross-origin | strona 127.0.0.1 z `<iframe src="http://localhost:…/privacy.html">` → *Nagrywaj* → *Zapisz* | `ch-8-xo-iframe-screenshot.jpg` |
| F-2 | LOW–MEDIUM (AC-6.2: notatka z liczbą usuniętych wpisów) | Notatka o cięciu logów zaniża stratę: „44 oldest console logs … were removed”, tymczasem `documents[0].counts.consoleLogs: 5000`, `kept.consoleLogs: 55` (zniknęło ok. 4 945). Pierwsze cięcie (przed redakcją) nie dodaje notatki albo jest gubione przy scalaniu; liczbę widać tylko w `documents[].kept`. Developer czytający `summary.md` myśli, że brakuje 44 logów | `heavy-e3.html`, `heavyLogs(5000, 40000)`, zapis | `ch-Q1-heavy-summary.md` (linia „44 oldest console logs”), `snapshot.json` `documents[0]` |
| F-3 | LOW | Fałszywie dodatnia reguła `card` na UUID w nagłówku `x-ms-request-id` (`…00e[redacted:card]`) na realnym portalu. Wpływ minimalny (1 z 83 wpisów), mieści się w budżecie AC-5.1 (≤ 2 FP), ale dotyczy nagłówka, którym developer koreluje logi serwera | wyborcza.pl, nagranie, zapis, `grep redacted:card` | `snapshot.json` portalu (lokalnie, `x-ms-request-id`) |
| F-4 | LOW (kosmetyka) | Margines maski 8 px zakrywa dolną połowę etykiet nad polami („E-mail”, „Uwagi”, „Kraj”, „Hasło”…); etykiety są przycięte i trudniej odczytać, które pole co zawiera. Dotyczy Ch i FF | `privacy.html` → zapis ze zrzutem | `ch-5-screenshot-masked.jpg`, `ff-4-screenshot-masked.jpg` |
| F-5 | LOW (UX) | Gdy zrzut się nie uda (pinch-zoom, `capture-failed`), popup mówi tylko „Zapisano plik…”, a powód jest po angielsku w notatce paczki. Zgłaszający nie wie, że obrazu nie ma, i że może spróbować po zresetowaniu zoomu | pinch-zoom na stronie → *Zapisz* | zip z notatką „No screenshot: form fields could not be hidden (page is zoomed in).” |
| F-6 | LOW (UX) | Zdanie zgody „Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi.” stoi tuż pod zdaniem, że hasła i tokeny są usuwane automatycznie. Zgodne z AC-1.3 (zdanie dotyczy zgody, nie listy), ale lekko sprzeczne w odbiorze. Dodatkowo w FF 360×600 zdanie „Po kliknięciu „Nagrywaj” strona odświeży się…” jest częściowo pod przyciskiem (trzeba przewinąć) — stan jak w E2 | otworzyć popup | `ff-1-ready.png` |

Brak findingów critical i high.

## Do ręcznego QA przez użytkownika

1. **Eksplorator Windows 11 (AC-1.2, FQ-E3-6):** zapisz paczkę w Firefoksie i w Chrome (strona `npm run fixtures` → `http://127.0.0.1:8080/privacy.html`), dwuklik na `.zip` w pobranych → powinny być widoczne `snapshot.json`, `summary.md`, `screenshot.jpg`, każdy plik otwiera się; „Wyodrębnij wszystkie” działa. `unzip -t` na tych plikach zrobiono w tym QA (OK).
2. **Archiwizator macOS (AC-1.2):** to samo na Macu, dwuklik na zipie.
3. **Mignięcie przy zrzucie (AC-2.3):** w Chrome i Firefox na `privacy.html` kliknij *Zapisz paczkę* przy otwartym oknie (nie headless) i obserwuj stronę; pola nie powinny zmienić wartości ani mignąć dłużej niż 1 klatkę; po zapisie focus w polu i pozycja przewinięcia bez zmian.
4. **Pinch-zoom w prawdziwej przeglądarce (AC-2.4):** na urządzeniu z touchpadem/ekranem dotykowym zrób pinch-zoom, zapisz paczkę: brak zrzutu i notatka (potwierdzone emulacją, nie fizycznym gestem).
5. **FQ-E3-5 (zamknięty shadow DOM, Firefox):** fixture z S0 (`tests/e2e/spike-e3/run.spike.mjs`, strona S1 z polem w zamkniętym shadow root) — nagrywanie i zapis w Firefoksie; pole ma być zamalowane. W tym QA nie sprawdzone (FF tylko smoke; spike S0 potwierdził getter `openOrClosedShadowRoot`).
6. **Realna strona logowania z polem hasła (FQ-E3-2):** zapis ze zrzutem przed zalogowaniem; pola zakryte, brak tekstu na krawędziach (wyborcza.pl bez logowania sprawdzone, rozmiar i redakcja OK).
7. **Realny portal z intensywną konsolą (AC-6.1, ryzyko 4):** zip ≤ 2 MB, `redaction.masked` i < 20 % URL-i ze znacznikiem (wyborcza.pl: 160 KB, 2,4 %).
8. **Stoper developera (AC-5.5):** niezależna osoba otwiera `summary.md` + początek `snapshot.json` z paczki portalu i odpowiada, co kliknięto i co się zepsuło, w ≤ 60 s.
9. **Firefox, pełna lista FQ-E3-1 (pomiar ≤ 5 s ręcznie myszą) i `web-ext lint`** — smoke QA (sterowany Marionette) dał 117–121 ms, ale to nie prawdziwy klik myszy.

## Werdykt: PASS z uwagami

Blokujących brak. Do rozstrzygnięcia przed release: F-1 (decyzja produktowa: ujawnić w popupie, że ramki z innych stron nie są zakrywane, lub dopisać notatkę do paczki) i F-2 (notatka o cięciu logów zaniżona względem `documents[].kept`; AC-6.2 spełnione dla flag, częściowo dla liczby usuniętych wpisów). F-3 do F-6 — do backlogu. Po ręcznym QA z listy powyżej (pkt 1–3, 8 ważne dla AC-1.2, AC-2.3, AC-5.5) można zamknąć epik.

Sprzątanie: pobrane pliki Chrome w katalogach tymczasowych harnessu (usunięte przy zamknięciu przeglądarki); 8 zipów Firefoksa zapisanych przez QA do `C:\Users\jaros\Downloads` usunięto po analizie. Katalog `test-results/qa-ff/` usunięty.
