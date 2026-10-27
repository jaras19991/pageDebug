# E4 — QA report (2026-10-27)

Środowisko: Chromium 156.0.8078.4 (Playwright channel `chromium`, nowy headless, rozszerzenie z `dist/chrome` 0.5.0 zbudowane 09:14 — nowsze niż każdy plik w `src/`, więc bez przebudowy), Playwright 1.64.1, Node z Windows (przeglądarka) i Linux v24.19 (MCP), Windows 11 + WSL2.
Uwaga o środowisku: biblioteki `libnss3/libnspr4/libasound2` w `/tmp/claude-1000/libs` nie istniały (a `apt` jest za proxy zablokowany), więc Chromium uruchomiłem Node'em z Windows przez `cmd.exe` (droga z skilla `extension-testing`), poza sandboksem. MCP i greppy — Linux, w sandboksie.
Skrypty i dowody: `docs/epics/E4/qa/` (`run-reporter.mjs`, `run-viewer.mjs`, `run-viewer-xss.mjs`, `run-mcp.mjs`; wyniki `*-results.json`; zrzuty `shots/` 35 plików; paczki `pkgs/`). Katalog Pobrane użytkownika nie był używany (pobrania do `qa/dl`, usunięte).
Poza zakresem tego przebiegu (headless, bez systemowego menedżera plików, bez Windows/Firefoksa): patrz „Checklista ręczna”.

## Kryteria akceptacji

PASS = sprawdzone przeze mnie na żywo. „e2e” = nie powtarzałem, opieram się na stanie testera (e2e 106/106) → NIEZWERYFIKOWANE przeze mnie.

| ID | Kryterium | Wynik | Dowód |
|---|---|---|---|
| 1.1 | Ekran Zapisano: nazwa, instrukcja, „Pokaż plik”, bez przewijania | PASS | `shots/03-saved.png`; `scrollH 244 ≤ innerH 243 (+1 px zaokrąglenia)`; wariant z linią statusu 315/315 (`06-…`), z komunikatem o braku pliku 272/271 (`05-…`) |
| 1.2 | „Pokaż plik” — brak wyjątku, brak pliku → komunikat | PASS (część automatyczna) / BLOCKED (Eksplorator) | istniejący plik: bez komunikatu błędu (`04-show-file-existing.png`); po `rm` pliku: „Nie znaleziono pliku. Zapisz paczkę ponownie.” czerwonym tekstem (`05-show-file-deleted.png`). Otwarcie menedżera plików niewidoczne headless → FQ-E4-2 |
| 1.6 | Ekran Zapisano wraca po ponownym otwarciu popupu | PASS | po zapisie popup zamknięty i otwarty od nowa 3× (kroki 5, 6, 7) — zawsze `saved`; po „Nowe nagranie” → `ready` (`09-after-new-recording.png`) |
| 1.7 | Brak JSON/zip/MCP/snapshot/hash/redakcja w tekstach ekranu | PASS z uwagą | tekst `saved` czysty; nazwa pliku `…​.zip` jest z natury widoczna (nie tekst UI) |
| 1.8 | Zdanie zgody IN8 | PASS (treść) | `consentNotice` w popupie równe wymaganemu; ale patrz F-1 (poza ekranem) |
| 2.1 | 0 żądań sieciowych od zapisu do zamknięcia Zapisano; permissions bez zmian | NIEZWERYFIKOWANE (e2e) | nie mierzyłem |
| 2.2 | Zapisano nie pokazuje danych z paczki | PASS | stan `saved`: wyłącznie `Plik: snapshot-127.0.0.1-….zip` + stałe teksty (JSON w `reporter-results.json` kroki 5–8); adres strony z `?access_token=` nie występuje |
| 2.3 | IN1: „Uncaught Error: password: …” | PASS | `iterator.zip`/`iterator-keep.zip`: `Uncaught Error: password: [redacted:key-password]` (summary + MCP get_errors); wartość 0× w zipie |
| 2.4/2.6/2.7 | IN3/IN4/IN5 korpus | NIEZWERYFIKOWANE (unit) | poza zakresem przebiegu na żywo |
| 2.5 | Podmieniony `Array.prototype[Symbol.iterator]` | PASS | `privacy-iterator.html`: 5 kroków, 1 zapytanie 500, 2× błąd w paczce (nagranie niepuste), `Authorization` i `access_token` zamaskowane; 0 trafień 3 pułapek w każdym pliku zipa |
| 2.8 | `rulesVersion: 2`, „reguły v2” | PASS | `redaction.rulesVersion=2`; summary: „Zamaskowano 10 wartości w 6 sekcjach (reguły v2)” |
| 2.9 | Trzej konsumenci bez wartości-pułapek | PASS | `run-mcp.mjs`: 12 pułapek × 5 paczek × {zip, summary.md, tekst wszystkich 8 zakładek viewera, odpowiedzi 6 narzędzi MCP z nagłówkami i treścią} = 0 trafień (`mcp-results.json` → `leaks`) |
| 3.1 | Kolejność sekcji i „brak — powód” | PASS | `pkgs/iterator.summary.md`: Środowisko, Kroki, Błędy, Nieudane zapytania, CWV, Najwolniejsze zasoby, Ciasteczka i rozmiar, Prywatność, Uwagi; „brak — nie zarejestrowano błędów”, „INP niedostępne — brak interakcji” |
| 3.2 | Kroki ≤ 20, krok przed błędem oznaczony | PASS | `- 0,4 s · click · \`Błąd\` ← ostatni krok przed pierwszym błędem` |
| 3.3 | Błędy zgrupowane z ramką | PASS | `2× od 0,4 s · \`Uncaught Error: password: [redacted:key-password]\` · \`privacy-iterator.html:39:17\`` |
| 3.4 | Nieudane zapytania | PASS | `GET …/status/500?body=token → 500 (3 ms)`; liczba w nagłówku (1) = overview |
| 3.5 | CWV z oceną/powodem, nigdy 0 | PASS | `TTFB 2 ms (dobrze) … INP niedostępne — brak interakcji` |
| 3.6 | Najwolniejsze zasoby, ciasteczka | PASS | `network.zip` summary |
| 3.7 | ≤ 200 linii, ≤ 16 KB | PASS | 52–55 linii / 1,6–1,8 KB (zapis na żywo); ciężka paczka przez MCP 5 232 znaki. Czasu generowania nie mierzyłem (unit) |
| 3.8 | Wartości strony nie tworzą markdownu | NIEZWERYFIKOWANE (unit); viewer pokazuje na żywo tylko `<pre>` | — |
| 3.9–3.11 | Notatki o zrzucie / maska | NIEZWERYFIKOWANE (e2e) | brak strony z ramką płatności w moim przebiegu |
| 4.1 | viewer.html z `file://`, v4 zip, v2/v3 JSON, 0 żądań | PASS (Chrome) / FQ-E4-4 (Firefox, Edge) | `viewer-results.json`: 13 plików, `seen.requests=[]`, `dialogs=[]`, `errors=[]` za każdym razem; v3 „(plik w wersji 3, odczytany jako 4)” |
| 4.2 | 8 zakładek, zrzut, ≤ 300 ms | PASS | przełączenie 10–15 ms; zrzut w Podsumowaniu (`viewer-network.zip-summary.png`) |
| 4.3 | Oś czasu | PASS (ocena) | zakładka Kroki: kroki, zapytanie i błędy w jednej kolejności z czasem bezwzględnym i względnym |
| 4.4 | Filtr 5000 wpisów ≤ 500 ms | NIEZWERYFIKOWANE (e2e) | — |
| 4.5 | XSS | PASS | `xss-traps.json`, wszystkie 8 zakładek: flaga `__pwned=null`, 0 dialogów, 0 żądań, 0 `<a href>`, 0 script/iframe/img/svg w `main` (`viewer-xss-results.json`, `shots/viewer-xss-traps.png`) |
| 4.6 | Ciężka paczka ≤ 3 s | NIEZWERYFIKOWANE (e2e) | wczytanie zipów ~620 ms łącznie z 600 ms czekania skryptu |
| 4.7 | Uszkodzony / nie-paczka / schema 5 | PASS | `corrupt.zip` → „Plik paczki jest uszkodzony.”; `.json` i `.txt` bez paczki → „To nie jest plik paczki.”; `schema5.json` → dane + „Nowsza wersja paczki — część danych może być niewidoczna.”; nigdzie biały ekran (`shots/viewer-corrupt.zip-error.png`) |
| 5.1 | MCP stdio, 7 narzędzi | PASS (serwer) / BLOCKED (Claude Code, Cursor → FQ-E4-5) | `tools/list`: list_snapshots, get_summary, get_errors, get_network, get_vitals, get_steps, diff_snapshots |
| 5.2 | list_snapshots z v2, v3, v4, uszkodzonym | PASS | 14 plików; `corrupt.zip` z polem `error` „Plik paczki jest uszkodzony.”, lista nie wywrócona; sortowanie wg daty modyfikacji pliku (uszkodzony pierwszy, bo świeżo utworzony) |
| 5.3 | get_summary == summary.md bajtowo | PASS | `summaryIdentical: true` (iterator.zip) |
| 5.4 | get_errors/get_steps/get_vitals | PASS | `get_errors`: `stack`, `stepBefore {label:"Błąd", rel:0.387}`; steps z `beforeFirstError` |
| 5.5 | get_network: domyślnie nieudane, limit 50, reszta | PASS | `matched 150, returned 50, remaining 100`; patrz UX-3 o długości |
| 5.6 | diff_snapshots | PASS | `diff-a` vs `diff-b`: errors added/removed, statuses (500→200; 404→net::ERR_FAILED), LCP poor→needs-improvement, cookies added lang / removed consent / changedHash sid; długość 973 znaki |
| 5.7 | Odpowiedź ≤ 25 000 | PASS | najdłuższe: get_network z nagłówkami i treścią, limit 500: 24 502 / 24 503; get_errors ciężka: 23 498 z `hint` „Pominięto 5 z 10 pozycji…” |
| 5.8 | Tylko odczyt, `../`, ścieżka bezwzględna | PASS | `../README.md`, `/etc/passwd` → błąd „Nieprawidłowy identyfikator…”; uszkodzony/nieistniejący → `isError`, serwer żyje dalej (`stillAlive`) |
| 6.1–6.5 | Konfiguracja developera | NIEZWERYFIKOWANE (unit + e2e `dev-config`) | popup bez opcji dev w `ready`: `disclosureDev` ukryty, brak kontrolek |

Liczby: PASS 28 · FAIL 0 (kryteria; defekty niżej nie obalają AC wprost) · BLOCKED 3 (menedżer plików 1.2, Claude Code/Cursor 5.1, Firefox 4.1) · NIEZWERYFIKOWANE 12 (2.1, 2.4, 2.6, 2.7, 3.8, 3.9–3.11, 4.4, 4.6, 6.x) — wszystkie z nich mają pokrycie w e2e/unit testera.

## Scenariusz zgłaszającego — obserwacje

Dosłownie: `basic.html` → ikona → „Do pliku trafią” → Nagrywaj → klik na stronie → ikona → Zapisz paczkę → ekran Zapisano → Pokaż plik → Nowe nagranie.
- Kliknięcia: Nagrywaj (1), Zapisz paczkę (1), potem opcjonalnie Pokaż plik / Nowe nagranie. Czas Nagrywaj→„Nagrywam od” 38 ms po odświeżeniu; Zapisz → ekran Zapisano 870 ms (pierwszy zapis ze zrzutem), 110–120 ms później. Zip 22 KB.
- Ekran Zapisano czytelny: tytuł, `Plik: …zip`, instrukcja „Wyślij ten plik osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.”, dwa duże przyciski. Wiadomo, co dalej. Nie wiadomo tylko, do kogo (ryzyko 4 ze specyfikacji potwierdza się z konstrukcji: tekst nie wskazuje adresata — to decyzja, nie defekt).
- Stan `ready` (`shots/01-ready.png`): lista „Do pliku trafią” jest długa (8 punktów, w tym punkt o zrzucie na 4 linie); przycisk Nagrywaj jest przypięty, ale zdanie zgody (`consentNotice`) i „strona się odświeży” są pod listą — F-1.
- Strona `chrome://version`: „Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.” — zrozumiałe, bez przycisków (`10-restricted.png`).
- Dwa razy Nagrywaj (szybko): jedno nagrywanie, stan `recording`, bez błędu.
- Nagrywanie w innej karcie: na ekranie `ready` linia „Trwa nagrywanie w innej karcie. Kliknięcie „Nagrywaj” zakończy je bez zapisu.” (zielona, nad sekcją) — zrozumiała (`08-ready-…png`). Na ekranie `saved` ta sama linia pojawia się nad „Zapisano”, ale nie ma tam przycisku „Nagrywaj” (jest „Nowe nagranie”) — F-3.

## Scenariusz developera — czas do odpowiedzi

Paczka `iterator.zip` (klik „Pobierz”, „Dalej”, „Błąd”; fetch 500; uncaught error).
- Viewer z `file://`: paczka wczytana w ~0,6 s; Podsumowanie od razu widoczne, **wszystkie trzy odpowiedzi na pierwszym ekranie 1280×900 bez przewijania** (`shots/viewer-iterator.zip-summary.png`).
- (a) pierwszy błąd: sekcja „Błędy”, 1 grupa `Uncaught Error: password: [redacted:key-password]` z `privacy-iterator.html:39:17` — linia 25 z 52 w summary.md; szacunek: ~10–15 s czytania, 0 kliknięć.
- (b) nieudane zapytanie: „Nieudane zapytania (1)” → `GET …/status/500?body=token → 500 (3 ms)` — kolejna sekcja; ~5 s po (a), 0 kliknięć.
- (c) co kliknięto przed błędem: sekcja „Kroki”, ostatni wiersz `0,4 s · click · \`Błąd\` ← ostatni krok przed pierwszym błędem`; sekcja leży nad Błędami. Łącznie ≈ 20–30 s (szacunek z czytania, nie stoper) — AC-3.1 „≤ 60 s” spełnione z zapasem.
- MCP: `get_errors` zwraca w jednym wywołaniu komunikat, ramkę, stos i `stepBefore` (kliknięcie „Błąd”, rel 0.387 s).
- Stare paczki: v2 i v3 wczytane, summary poprawny, brak sekcji CWV/Kroki zastąpione linią „brak — …”.

## Prywatność — wynik grep

Strony: `privacy.html` (JWT w localStorage, cookie `sid`, e-mail/hasło/telefon/karta w formularzu, POST z `Authorization`/`access_token` i e-mailem+hasłem w body), `privacy-iterator.html` (z podmienionym iteratorem i `?keep=1`). 12 wartości-pułapek (losowych) i wartości formularza.
- Zip (wszystkie pliki), `summary.md`, tekst 8 zakładek viewera, odpowiedzi MCP (6 narzędzi, nagłówki i treść włączone): **0 trafień** (`mcp-results.json`, klucz `leaks`).
- Dodatkowo grep `snapshot.json` z `privacy.zip`: `kowalski`, `Sekret`, `4111`, `600 700`, `example.com`, `Prosta 1` — 0. Znaczniki `[redacted:email]`, `[redacted:key-password]`, `[redacted:key-auth]` obecne (kontrola dodatnia).
- **Znalezione: `RABAT-2026`** — wartość atrybutu `value` pola wewnątrz `srcdoc` ramki w `dom.iframes[0].attributes.srcdoc` (pełny HTML ramki, w tym tekst „Kod rabatowy”). Patrz F-2.

## Ścieżki negatywne

| Ścieżka | Wynik |
|---|---|
| `chrome://version` | PASS, komunikat PL |
| Dwa razy Nagrywaj | PASS |
| Plik usunięty → Pokaż plik | PASS, komunikat PL w popupie |
| Nagrywanie w innej karcie | PASS z uwagą (F-3) |
| Viewer: uszkodzony zip / nie-paczka / schema 5 | PASS |
| MCP: `../`, ścieżka bezwzględna, uszkodzony, brak pliku | PASS, serwer żyje |
| Zamknięcie karty w trakcie, stop w trakcie ładowania, surowe CSP, odmowa zgody | nie powtarzane (pokrycie e2e z E1–E3, bez zmian w E4) |

## Findings

| ID | Waga | Opis | Dowód |
|---|---|---|---|
| F-1 | medium (UX/zgoda) | Zdanie zgody IN8 („Klikając „Nagrywaj”, zgadzasz się…”) w stanie `ready` jest poniżej linii zgięcia: `scrollH` 700 przy oknie 510 (popup headless; w prawdziwym popupie 600 też za mało), a przycisk Nagrywaj jest przypięty (sticky) u dołu. Zgłaszający może kliknąć Nagrywaj, nie widząc zgody; widzi za to 8 punktów listy + `privacyNote` + początek `noUpload`. Zgoda jest tekstowo poprawna, ale niewidoczna bez przewijania. Rekomendacja: skrócić listę lub przenieść zgodę nad przycisk/pod listę w obszarze sticky. | `shots/01-ready.png` (urywa się w „Plik zostaje na Twoim dysku, rozszerzenie niczego nie…”), `reporter-results.json` → `1-ready.state.scrollH=700`, `innerH=510`, `recordBottom=502` |
| F-2 | medium (prywatność) | `dom.iframes[].attributes.srcdoc` zawiera cały źródłowy HTML ramki bez zdejmowania tekstów i wartości pól: trafił tekst „Kod rabatowy” i `value='RABAT-2026'`. Rozjazd z zapowiedzią „struktura strony bez tekstów i bez wartości wpisanych w formularze”. To wartość atrybutu inicjalnego (nie wpisana przez użytkownika), więc nie jest to wyciek hasła, ale strony z `srcdoc` (np. widgety) mogą nieść dowolne dane. Prawdopodobnie sprzed E4 (do potwierdzenia w E3) — poza zakresem AC E4, do zadecydowania. | `pkgs/privacy.zip` → `snapshot.json` offset ~10479; widoczne w zakładce DOM viewera |
| F-3 | low (UX) | Linia `otherTabRecording` na ekranie Zapisano: tekst odwołuje się do „Nagrywaj”, którego na tym ekranie nie ma (są „Pokaż plik”, „Nowe nagranie”); ponadto zielony status nad „Zapisano” sugeruje, że dotyczy zapisanego pliku. Działa poprawnie na `ready`. Rekomendacja: osobny tekst dla `saved` („…Kliknięcie „Nowe nagranie” zakończy je bez zapisu.”). | `shots/06-saved-with-other-tab-recording.png` |
| F-4 | low (UX) | Viewer nie ostrzega, że paczki v2/v3 są niezredagowane z założenia. Ostrzeżenie jest tylko dla v1 („dane odczytane w przybliżeniu”) — i dotyczy dokładności, nie prywatności; v2/v3 mają jedynie „(plik w wersji 3, odczytany jako 4)”. Dla developera, który wyśle taką paczkę dalej, brak sygnału. | `viewer-results.json` → `v3.json`/`v2.json`.header; `shots/viewer-v2.json-summary.png` |
| F-5 | low (UX) | Podsumowanie w viewerze to surowy markdown w `<pre>` (znaczniki `##`, backticki widoczne), a nagłówek viewera pokazuje czas lokalny, summary czas UTC (`09:50:42` vs `…08:50:42Z`) — różnica godziny bez wyjaśnienia. Czytelne, ale „techniczne”. | `shots/viewer-iterator.zip-summary.png` |
| F-6 | info | Zdanie w summary „Hasła, tokeny i dane logowania nie są w tym pliku.” to twierdzenie bezwzględne (redakcja jest best-effort, z udokumentowanymi ograniczeniami w README). Rozważyć „zostały usunięte automatycznie”. | `pkgs/iterator.summary.md` sekcja Prywatność |
| F-7 | info (środowisko) | Brak `/tmp/claude-1000/libs/root/...` (biblioteki dla linuksowego Chromium) — przebieg poszedł przez Chromium z Windows. Nie wpływa na wynik. | — |

Brak defektów critical/high. Brak FAIL kryteriów akceptacji w zakresie, który mogłem sprawdzić.

## Ocena UX wskazanych punktów

- **REASON_PL** (`src/lib/snapshot-metrics.js`): „przeglądarka tego nie mierzy”, „brak interakcji”, „karta była w tle przy otwarciu strony” — jasne. „brak danych” — za ogólne (developer nie wie, czy to błąd, czy normalne); „zasób z innej domeny” — bez kontekstu (chodzi o ograniczenie atrybucji LCP/INP dla zasobu cross-origin?) może zmylić; „nieznany powód” — ok. Widziane na żywo tylko „brak interakcji” (`INP niedostępne — brak interakcji`), czytelne.
- **otherTabRecording na Zapisano**: patrz F-3.
- **get_network 12 975 znaków przy celu 10 000**: potwierdzone 12 976–12 987 znaków (heavy.zip, net5000.zip, 50 pozycji po ~255 znaków; pola `statusText:null`, `ok:false`, `error:null` powtarzają się). Poniżej twardego limitu 25 000 i poniżej `get_errors` (21–23 K); 3–4 tys. tokenów — akceptowalne, nie wymaga zmiany. Gdyby cel 10 000 był istotny: pominąć pola `null`/`ok` lub obniżyć domyślny limit do ~35.
- **Viewer a paczki v1–v3**: F-4. v1 ma ostrzeżenie o przybliżeniu; v2/v3 bez ostrzeżenia. Dane starych paczek wyświetlają się poprawnie, brak białego ekranu.

## Checklista ręcznego QA dla użytkownika

Windows 11 / Firefox / spike S3 — niewykonane przeze mnie (brak Firefoksa/GUI w środowisku).
- [ ] **FQ-E4-1** Firefox: `basic.html` → Nagrywaj → Zapisz → ekran Zapisano bez przewijania → zamknij i otwórz popup (nadal Zapisano) → „Nowe nagranie”. Chrome na Windows: jak wyżej, zwrócić uwagę na F-1 (czy zgoda widoczna bez przewijania w prawdziwym popupie 600 px).
- [ ] **FQ-E4-2** „Pokaż plik” Chrome i Firefox na Windows 11 (i macOS jeśli dostępny): otwiera się Eksplorator z zaznaczonym plikiem; po usunięciu pliku → „Nie znaleziono pliku. Zapisz paczkę ponownie.” (w Chrome sprawdziłem tylko komunikat; spike S1: `show()` nie sygnalizuje braku pliku, dlatego działa `search` przed `show`).
- [ ] **FQ-E4-3** Firefox: strona z ramką płatności → zrzut domyślnie wyłączony + notatka; maska nie zasłania etykiet (3.9–3.11).
- [ ] **FQ-E4-4** `viewer.html` z dysku w Firefoksie i Edge: zip v4, `v3.json`, brak żądań sieciowych w narzędziach developera (Chrome sprawdzone: 0).
- [ ] **FQ-E4-5** Claude Code i Cursor z konfiguracją z `mcp/README.md` (ścieżki Windows): 7 narzędzi, odpowiedź na „jakie błędy są w ostatniej paczce?” (serwer stdio sprawdzony ręcznie, klientów nie).
- [ ] **FQ-E4-6** Polityka przedsiębiorstwa Chrome (`…\Policies\Google\Chrome\3rdparty\extensions\<id>\policy`) i Firefox (`policies.json`) nadpisuje `disabledRules`; popup pokazuje ujawnienie w liście „Do pliku trafią”.
- [ ] **Spike S3** (`node tests\e2e\spike-e4\run.spike.mjs --firefox` w PowerShellu): `storage.managed.get` bez polityki w Firefoksie — czy odrzuca i w ≪ 1 s (w Chrome bez polityki **nie odpowiada** w 1 s → zabezpiecza timeout z D5), `downloads.search/show` po usunięciu pliku w Firefoksie.
- [ ] Pozostałe NIEZWERYFIKOWANE: AC-2.1 (0 żądań przy zapisie), 3.9–3.11, 4.4/4.6 — jeśli chcesz potwierdzenie poza raportem testera, uruchom `PDS_E2E_NO_BUILD=1 npm run test:e2e` (Windows).

## Werdykt: PASS z uwagami

Blokujących nie ma. Do decyzji przed wydaniem: F-1 (zgoda poniżej zgięcia, medium), F-2 (`srcdoc` w DOM, medium, prawdopodobnie sprzed E4), F-3/F-4 (low, teksty). Wszystko ręczne z checklisty (Windows, Firefox, S3, FQ-E4-1..6) — otwarte.
