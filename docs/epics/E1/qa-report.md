# E1 — QA report (2026-10-23)

Środowisko: Windows 11 (10.0.26200), Node 26.12.1. Chrome stable 155.0.8059.79 (headed, tymczasowy profil, Playwright 1.64.1 przez pipe + `Extensions.loadUnpacked`, popup otwarty `Extensions.triggerAction`, bąbel zgody obsługiwany przez UI Automation `Invoke` — bez ruchu myszy), Firefox stable 158.0.1 (headed, `web-ext` 10.8 + Marionette; popup obsługiwany z kontekstu chrome: `setHandlingUserInput` + `click()`, zrzuty przez `drawSnapshot`). Testowany stan: HEAD `fd12166` (dist przebudowany z niego; pierwsze ~40% przebiegu Firefoksa poszło na starszym buildzie sprzed „review fixes” — powtórzone na nowym, wyniki poniżej są z `fd12166`, wyjątek: F19 serii 1 i F9 — patrz uwagi). Dowody: `docs/epics/E1/qa-evidence/` (PNG ignorowane przez git; `*.json`, `*.txt`, `*.log` śledzone).

Ograniczenia metody (uczciwie): (1) zrzuty bąbla zgody nie są możliwe (panel natywny) — treść bąbla odczytana z drzewa DOM/UIA; (2) „odmowa/Odrzuć” to programowe wywołanie przycisku, a nie prawdziwy klik poza popupem, więc nie wiem, czy w realnym użyciu popup zamyka się przy fokusie na bąblu (w obu przeglądarkach w moim środowisku **nie zamknął się**); (3) „restart przeglądarki” w Firefoksie = dodatek tymczasowy znika z profilem, test bez wartości; (4) panel pobrań Firefoksa nigdy się nie otworzył przy `downloads.download` (zdarzenia `popupshown` tylko dla popupu).

## Kryteria akceptacji (E1 — tylko te z listy „Do QA ręcznego”; reszta pokryta testami, E1-Q1 potwierdza je w czystym klonie)

| ID | Kryterium | Wynik | Dowód |
|---|---|---|---|
| 1.1 | Ujawnienie nad „Nagrywaj” | PASS (treść), **FAIL** (prawdziwość „bez haseł i pól ukrytych”, F-3) | `ff-F1-1-ready.png`; `ff-privacy-grep.txt` |
| 1.2 | Przed klikiem nic nie jest zbierane | PASS (FF i Chrome) | FF: `getOwnPropertySymbols(window)` = [], `permissions.getAll().origins` = [], `storage.session` = {} przed kliknięciem |
| 1.3 | Jedno przeładowanie po zgodzie | PASS | FF: licznik `nsIWebProgress` = 1 start dokumentu po „Zezwól”; Chrome: nagrywanie od razu, e2e |
| 1.4 | Odmowa → komunikat, bez przeładowania, Gotowy | **FAIL** gdy popup zostaje otwarty (FF i Chrome) | `ff-F2-denied.png`, `ch-AC1.4-denied-popup.png`: po „Zabroń/Odmawiaj” `#status` = "" (brak `permissionDenied`) |
| 1.5 | Stan po wyładowaniu tła | PASS (FF) | `terminateBackground()` ×2: „Nagrywam od 23:36:36” bez zmian, zapis zawiera wpisy sprzed i po |
| 1.6 | Ikona ● tylko na nagrywanej karcie | PASS (FF i Chrome) | FF `ff-F13-badge-tabA.png`, badge „●” / „” na drugiej; Chrome `action.getBadgeText`: `●` tylko dla karty nagrywanej |
| 1.7 | Strony specjalne | PASS | FF: about:blank, about:addons, addons.mozilla.org, about:newtab, moz-extension: → `restricted` (<1,2 s, bez przeładowania); Chrome: prawdziwy `chromewebstore.google.com/category/extensions` → `restricted` (8 ms), `ch-AC1.7-cws.png` |
| 1.9 | Limit czasu | PASS (FF, limit 8 s) | `ff-F15-stopped.png`; `recordingStoppedReason:"time-limit"`, wpis po limicie nieobecny |
| 2.1/2.5 | Zapisano = plik jest; po zapisie czysto | PASS | FF 278 ms, Chrome 262 ms; reload po zapisie bez recordera |
| 2.2 | Zapis przerwany | PASS | Chrome z „Pytaj, gdzie zapisać”: dialog „Zapisywanie jako” pojawia się mimo `saveAs:false`; Anuluj → „Zapis został przerwany…”, nagrywanie trwa, ponowny zapis OK z wcześniejszymi wpisami (`ch-AC2.2-*.png`); dialog otwarty 18 s → nadal „Zapisuję…” i po „Zapisz” sukces. FF: `downloads.cancel` → `USER_CANCELED` → ten sam komunikat, retry OK |
| 2.3 | Blokada pobrań, 3 zapisy | PASS | Chrome, `automatic_downloads=2` w profilu: 3 × „Zapisano” = 3 nowe pliki; FF 3 zapisy = 3 pliki z własnymi markerami |
| 2.6 | Zamknięcie karty / restart | PASS (karta FF, restart Chrome) | Chrome: zamknięcie przeglądarki w trakcie nagrania, ponowny start: `storage.session` puste, skrypty wyrejestrowane, popup „Gotowy”, brak recordera (`ch-AC2.6-after-restart.png`). Uwaga: po restarcie `optional` uprawnienia też puste (profil + `loadUnpacked` — nie rozstrzygam) |
| 3.2 | Okno zgody tylko o origin karty | PASS | FF: „Dostęp do danych na stronach w domenach 127.0.0.1”; Chrome: „Odczytywanie i modyfikowanie Twoich danych na: 127.0.0.1” |
| 3.3 | Druga karta tego samego origin | PASS | marker z karty B nieobecny w paczce z A (FF); karta B pokazuje „Trwa nagrywanie w innej karcie…” |
| 3.4 | Przejście na inny origin | **FAIL** (FF i Chrome) | komunikat `otherOrigin` jest, ale paczka nie ma danych pierwotnej strony przy przejściu na **inny host** — F-2 |
| 4.1/4.2/4.7 | Błąd/fetch 500/console.error/rejection z `<head>` | PASS (FF) | `ff-F4-F8-package.json`: `t` 20 < DCL 21; nic od rozszerzenia w `consoleLogs` |
| 4.3/4.4 | SPA / pełne przeładowanie | PASS (FF) | `ff-F5-F6-package.json`: `after-push`, `after-replace`, `after-popstate` po 1×; `documents` = 2, markery obu dokumentów |
| 5.1/5.6 | XHR axios-like, hostile | PASS z uwagą (FF) | `instanceof`, `DONE`=4, `responseType`, `fetch(Request)`, `fetch(URL)` OK; `hostile.html`: `seen`=0, `intercepted`=0, w pliku brak sfałszowanej treści. Uwaga F-6 |
| 7.2/7.3 | Fallback konsolowy | PASS (FF) | komunikat „Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().”, plik `schemaVersion 2`, `source:"console"` |
| PB-1 | `file://` | Chrome PASS; **FAIL** (FF) | Chrome: bez zgody komunikat `fileAccess` (`ch-file-noaccess.png`), z włączonym dostępem zapis + marker; FF — F-4 |
| E1-Q1 | Czysty klon | **FAIL** (1 test jednostkowy) | `q1-clean-clone-*.log`: `npm ci` 0, lint 0, e2e 39/39, `npm test` 600/601 — F-5 |

PASS 20 · FAIL 5 (1.4, 3.4, PB-1 FF, E1-Q1, prawdziwość ujawnienia 1.1) · BLOCKED 0.

## Firefox F1–F19 (osobno)

| # | Wynik | Dowód / uwagi |
|---|---|---|
| F1 | PASS | Przed klikiem brak markera/uprawnień; bąbel: „Rozszerzenie „Page Debug Snapshot” prosi o dodatkowe ustawienia — Nowe uprawnienia: Dostęp do danych na stronach w domenach 127.0.0.1”. **To czego spike nie sprawdził:** bąbel `permissions.request` z popupu **nie zamyka popupu** (status „Uruchamiam nagrywanie…” widoczny pod bąblem, `ff-F1-2-popup-while-bubble.png`), po „Zezwól” tło startuje (`pds:rec.status=recording`), karta przeładowana raz, ikona ●. Zamknięcie popupu przy otwartym bąblu → po „Zezwól” nagrywanie startuje samo (auto-start z `onAdded`) |
| F2 | **FAIL** | Zabroń / zamknięcie bąbla bez wyboru → `permissions.request` = false → brak przeładowania, stan Gotowy, ale **żadnego komunikatu** (F-1). `ff-F2-denied.png` |
| F3 | PASS | 1 start dokumentu (licznik postępu) |
| F4 | PASS | patrz 4.1 |
| F5 | PASS | patrz 4.3 |
| F6 | PASS | patrz 4.4 |
| F7 | PASS | patrz 1.5 |
| F8 / F8b | PASS | „Zapisano plik page-debug-snapshot-1792704737783.json — znajdziesz go w pobranych plikach.”; JSON v2; 3 nagrania = 3 pliki z własnymi markerami |
| F9 | PASS | anulowanie przez `downloads.cancel` → „Zapis został przerwany lub anulowany. Nagrywanie trwa — kliknij „Zapisz paczkę” ponownie.”, retry OK (5000 wpisów). Katalog tylko do odczytu: Firefox **po cichu zapisał do `~/Downloads`** i popup powiedział „Zapisano” — prawda, ale zgłaszający nie wie gdzie (usunąłem ten jeden plik, który sam utworzyłem) |
| F10 | PASS | patrz 1.7 |
| F11 | PASS (karta) / BLOCKED-by-design (restart) | po zamknięciu karty: `storage.session` puste, skrypty wyrejestrowane, nowa karta tego origin bez recordera, ikona bez ● |
| F12 | PASS | patrz 7.2 |
| F13 | PASS | także po nawigacji w obrębie origin |
| F14 | **FAIL** | druga karta OK; przejście na `localhost` → komunikat `otherOrigin` OK, ale paczka bez danych (F-2). Przejście na ten sam host/inny dokument: dane zachowane |
| F15 | PASS | limit 8 s przez `storage.session` ustawione z karty rozszerzenia |
| F16 | **FAIL** | F-4 |
| F17 | PASS | `csp-strict.html` nagrana (`console.log` w paczce, v2) |
| F18 | PASS z uwagą | patrz 5.1/5.6; `xhr-lib.html` nie istnieje w fixtures — użyty własny klient w stylu axios |
| F19 | PASS (z zastrzeżeniem) | zapis z `flood.html` (`alwaysOpenPanel=true`), 3× na starym i 3×+3× na nowym buildzie: popup **zostaje otwarty**, status „Zapisano”, plik kompletny (2,3 MB; 3,6 MB; 4,2 MB), JSON parsuje się, `consoleLogs` = 5000, `truncated.consoleLogs=true`, ostatni „flood 5999”, brak `.part`. Panel pobrań **nie otworzył się** (brak `popupshown`) — scenariusz „panel zamyka popup” nie został wywołany. Dodatkowo wymusiłem zniszczenie dokumentu popupu (`panel.hidePopup()` + usunięcie `<browser>`) po 120–300 ms od kliknięcia: plik kompletny 5/5; przy zamknięciu ≤90 ms pobranie w ogóle nie startuje (patrz F-7). Wniosek: fallback D7(d) nie jest potrzebny na podstawie tych danych; ryzyko pozostaje dla realnego panelu pobrań, którego nie dało się wywołać |

## Scenariusz zgłaszającego — obserwacje

Liczba kliknięć: instalacja → ikona (1) → „Nagrywaj” (2) → „Zezwól” w oknie przeglądarki (3) → [odtworzenie błędu] → ikona (4) → „Zapisz paczkę” (5) = 5 kliknięć do pliku, w tym 1 w oknie zgody (kolejne nagrania na tej samej stronie: 3). Czas klik „Zapisz” → „Zapisano”: 260–280 ms.
- Ujawnienie (cytat): „Do pliku trafią: adresy odwiedzonych podstron…, logi konsoli i błędy, zapytania sieciowe strony: adresy, nagłówki i wysyłana treść (mogą zawierać dane logowania)…, treść i struktura strony, w tym wartości wpisane w formularze (bez haseł i pól ukrytych), ciasteczka i dane zapisane przez stronę (mogą zawierać dane logowania). Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła. Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku. Po kliknięciu „Nagrywaj” strona odświeży się…” — zrozumiałe, ale długie (w popupie 280 px ≈ 25 linii; przycisk dopiero na dole), a zgoda „przez kliknięcie” jest ukryta w środku bloku tekstu (UX, średnia waga). Okno zgody przeglądarki mówi o „dodatkowych ustawieniach/uprawnieniach” i domenie `127.0.0.1` — dla laika nieczytelne; Firefox dodaje puste nagłówki „Nowe zbieranie danych: / Opcjonalne ustawienia:”.
- Po przeładowaniu wiadomo, że nagrywa: ikona „●” i popup „Nagrywam od 23:30:40 — Odtwórz problem, a potem kliknij „Zapisz paczkę”.” — wystarczające.
- „Zapisano plik … — znajdziesz go w pobranych plikach.” mówi gdzie (w ogólności); nie mówi, co dalej (komu wysłać) — to E4. Brak przycisku „pokaż plik”.
- Tekst `otherOrigin`: „Ta karta pokazuje teraz inną stronę. Nagranie obejmuje tylko stronę, na której je rozpoczęto — możesz zapisać to, co zebrano.” — słowa „origin” nie ma, zrozumiały; ale „możesz zapisać to, co zebrano” obiecuje dane, których (F-2) po przejściu na inny host nie ma.
- Komunikat `restricted` „Na tej stronie nie da się zapisać paczki…” pokazuje się bez żadnego przycisku — zrozumiałe.
- `docs/INSTRUKCJA-ZGLASZAJACEGO.md` jest zdezaktualizowana (jeden klik → dwa kroki + zgoda + ikona ●, brak „odświeży się”).
- Pobrany plik trafia w Firefoksie do skonfigurowanego katalogu lub po cichu do `~/Downloads`; Chrome z „Pytaj, gdzie zapisać” pokazuje okno systemowe przy „Zapisz paczkę” (popup w tym czasie: „Zapisuję paczkę…” — zgłaszający może nie wiedzieć, że czeka okno).

## Scenariusz developera — czas do odpowiedzi

Paczka v2 (pretty JSON, klucze: nagłówek → `documents` → `limits`/`truncated`/`notes` → `environment`, `dom` (z `outerHTML` w środku) → `storage` → `consoleLogs` → `runtimeErrors` → `network`). Mierzone na `ff-F4-F8-package.json` (385 linii) i `ff-F19` (3,6 MB, nie zachowany): (a) pierwszy błąd: `runtimeErrors[0]` → „Error: head-boom”, early-error.html:8:11, `t`=20 ms — ok. 10–20 s (wyszukanie sekcji; w pliku 3 MB `outerHTML` stoi między nagłówkiem a logami, więc bez jq/wyszukiwania dłużej); (b) nieudane zapytanie: `network[]` z `status:500` `/api/fail` — ok. 10–20 s (brak filtra, ale `ok:false`, `status`, `durationMs` są); (c) „co użytkownik kliknął przed błędem”: **nie do ustalenia** (kroków brak — E2); zastępczo `consoleLogs` obok `t` błędu (tu: `head-console` t=20) — niepełne. `documents[]` czytelne: `{id, url, timeOrigin, navigationType:"reload", recorded, flushed, current, counts, kept}`; `notes` jawnie mówi „Recording started at … (page reloaded); earlier data is not included.” oraz — przy utracie danych dokumentu — „The data of document 0 was not received… its entries are missing.”. Brak `summary.md` (E4), więc minuta z CLAUDE.md zależy od narzędzi.

## Prywatność — wynik grep

`ff-privacy-grep.txt`, `ch-privacy-grep.txt` (identyczne): w paczce jawnie: token `localStorage` (2×, w tym w `console.log`), `sessionStorage` (1), cookie (1), e-mail z formularza (2), nagłówek `Authorization: Bearer …` (1), treść POST z polem `password` (1). **Hasło wpisane w `<input type=password>` — 0 trafień** (wartość pola `[redacted]`). **Wartość pola ukrytego — 1 trafienie w `dom.html.outerHTML`**, a także hasło podane w atrybucie `value="…"` markupu (`SECRET-PWATTR-444` jest w `outerHTML`) — sprzeczne z deklaracją „bez haseł i pól ukrytych” (F-3). Zgodnie z zakresem E1 (bez redakcji) pozostałe — obserwacja, nie FAIL. Poza paczką: `storage.session` po zapisie zawiera wyłącznie `pds:last:<tabId>` = `{fileName, downloadId, at}` (bez treści; nie jest „puste”, ale nie zawiera danych) — OK; brak `.crdownload`/`.part`; w `~/Downloads` brak plików poza zapisanym przez Firefoksa w teście F9 (usunięty).

## Rozmiar i czas

dist 154 KB / target (build HEAD). Zapis → plik: Firefox 261–278 ms (mały), 260–290 ms przy 3,6 MB; Chrome 258–262 ms. Przeładowanie startuje ≤ 0,5 s po zgodzie.

## Ścieżki negatywne

Dwa szybkie kliknięcia „Nagrywaj”: 1 bąbel, 1 przeładowanie (FF), 1 bąbel (Chrome). Zamknięcie popupu przy otwartym bąblu: auto-start po „Zezwól” (FF i Chrome). Zamknięcie karty w trakcie: czysto (FF). Zapis tuż po przeładowaniu: nie zweryfikowany (mój test wpadał w stan, w którym przycisk „Zapisz” jeszcze nie był widoczny — artefakt harnessu; pageBusy pokrywa e2e). Zapis gdy nagrywa inna karta: popup drugiej karty nie ma przycisku zapisu, pokazuje „Trwa nagrywanie w innej karcie…”. Zamknięcie popupu ≤ 90 ms po „Zapisz paczkę” (FF): brak pliku, brak komunikatu, tło zostaje w „Zapisuję paczkę…” do 15 s, kolejny zapis w tym czasie kończy się „Strona jeszcze się ładuje albo nie odpowiada” (F-7).

## Findings

| # | Waga | Opis | Kroki | Dowód |
|---|---|---|---|---|
| F-1 | **HIGH** | Odmowa zgody nie daje żadnego komunikatu, gdy popup pozostaje otwarty (Firefox i Chrome — w obu bąbel nie zamknął popupu). AC-1.4 niespełnione: zgłaszający klika „Zabroń”, nic się nie dzieje. Przyczyna (`src/popup/controller.js:133`): `applyStatus` zeruje `ctx.outcome`, gdy zmienia się stan tła (`starting`→`idle`), a `permissionDenied` nie jest w `STICKY_OUTCOMES`. Chrome e2e przechodzi, bo tam popup się zamyka i komunikat przychodzi z `lastError`. | popup → Nagrywaj → bąbel → Zabroń (FF) / Odmawiaj (Chrome) → `#status` puste | `ff-F2-denied.png`, `ch-AC1.4-denied-popup.png` |
| F-2 | **HIGH** | Przejście nagrywanej karty **prosto na inny host** (np. przekierowanie SSO, link zewnętrzny) gubi wszystkie dane dokumentu: `documents[0].flushed=false`, notes „data of document 0 was not received”, `consoleLogs` puste; komunikat `otherOrigin` obiecuje „możesz zapisać to, co zebrano”. Przejście w obrębie hosta działa. Test e2e `navigation to localhost` tego nie wyłapuje, bo najpierw skacze na ten sam host/inny port. Dotyczy Firefox i Chrome stable. Hipoteza: flush z `pagehide` odrzucany, bo karta już należy do innego hosta. | nagrywaj `http://127.0.0.1:8080/basic.html`, `console.log('m')`, przejdź na `http://localhost:8080/basic.html`, Zapisz | `ff-F14-package.json`; sesja po przejściu: doc `flushed:false`, brak `pds:doc:*` |
| F-3 | **HIGH** (prywatność/zgoda) | Ujawnienie obiecuje „bez haseł i pól ukrytych”, a `dom.html.outerHTML` zawiera `value="…"` pól `type=password` i `type=hidden` zapisanych w markupie (np. tokeny CSRF) — sprzeczne z tekstem zgody CWS. | strona z `<input type=hidden value=SECRET>` → nagrywaj → zapisz → grep | `ff-privacy-package.json` (`.dom.html.outerHTML`) |
| F-4 | MEDIUM | Firefox, `file://`: okno zgody mówi „Dostęp do danych użytkownika na wszystkich stronach”, popup pokazuje „Nagrywam od …”, ale recorder nigdy się nie wstrzykuje (brak markera, `docs:[]`); *Zapisz* kończy się ogólnym „Nie udało się zapisać paczki…”. Brak fałszywego sukcesu, ale decyzja 2 oczekiwała jasnego komunikatu przed nagrywaniem. | `file:///…/privacy.html` → Nagrywaj → Zezwól → Zapisz | `ff-F16-after-failed-save.png` |
| F-5 | MEDIUM | E1-Q1: w czystym klonie (`git clone` do głębokiej ścieżki tymczasowej) `tests/unit/recorder.test.js › 6000 console.log keep 5000 newest` pada deterministycznie (3103 zamiast 5000, 4/4), w drzewie roboczym przechodzi. Hipoteza: długość `stack` zależy od długości bezwzględnej ścieżki, a bufor ma limit znaków. Test zależny od ścieżki checkoutu. | `git clone`, `npm ci`, `npm test` | `q1-clean-clone-test.log` |
| F-6 | LOW | W trakcie nagrywania `XMLHttpRequest.prototype.constructor === XMLHttpRequest` jest `false` (Proxy). `instanceof`, stałe i `prototype` OK; bibliotek porównujących `constructor` to może dotyczyć. | w nagrywanej stronie: `XMLHttpRequest.prototype.constructor === XMLHttpRequest` | sesja f1718 (FF), log w rozmowie |
| F-7 | LOW | Zamknięcie popupu ≤ 90 ms po „Zapisz paczkę” (Firefox): brak pliku i komunikatu; stan „Zapisuję paczkę…” do 15 s; kolejne „Zapisz” w tym czasie daje mylące „Strona jeszcze się ładuje albo nie odpowiada”. | kliknij Zapisz i od razu zamknij popup | sesja f19e (FF) |
| F-8 | LOW (UX) | Katalog pobierania tylko do odczytu: Firefox zapisuje po cichu do `~/Downloads`; komunikat mówi „w pobranych plikach”, bez ścieżki. Ujawnienie ma ~25 linii (przycisk poza ekranem na małych oknach), zgoda ukryta w tekście. Okno zgody Firefoksa/Chrome nieczytelne dla laika. | — | `ff-F1-1-ready.png` |

## Werdykt: FAIL (blokujące: F-1, F-2, F-3; do decyzji: F-5 jako warunek E1-Q1)

Nowy model nagrywania działa w obu przeglądarkach (zapis kompletny, jedno przeładowanie, odporność na wyładowanie tła, limit, anulowanie, restart, brak wycieków poza paczkę), ale odmowa zgody jest niema, przejście na inny host traci całe nagranie, a deklaracja „bez haseł i pól ukrytych” jest nieprawdziwa dla atrybutów w markupie.
