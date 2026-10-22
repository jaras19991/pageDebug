# E0 — QA report (2026-10-22)

Środowisko: Windows 11 (10.0.26200), Node 26.12.1. Chrome stable 155.0.8059.79 (uruchomiony przez `npm run dev:chrome` z `PDS_CHROMIUM_BINARY`, tymczasowy profil `tmp-web-ext-*`), Chromium Playwright 147.0.7727.15 (harness e2e / CDP `Extensions.triggerAction`), Playwright 1.64.1, web-ext 10.8.0, Firefox stable 158.0.1 (`web-ext run`, dodatek tymczasowy; sterowany przez Marionette, bez myszy). Testowany stan: `e48fc41` (Q1 w świeżym klonie tego commita). Dowody: `docs/epics/E0/qa-evidence/`.

Uwaga o metodzie: popup Chrome stable otwierałem klikając ikonę systemowo (zrzut okna z ekranu). Raz przy próbie klikania okna Firefoksa fokus przeskoczył na inne okno (Steam) i dwa kliknięcia trafiły poza przeglądarkę (nic w projekcie, zrzuty usunięte). Potem Firefox był sterowany wyłącznie Marionette (`.click()` na przycisku akcji + zrzut okna). Przy sprawdzaniu wersji `chrome.exe --version` otworzyło się w istniejącej sesji użytkownika (bez skutków).

## Kryteria akceptacji

Wynik wspólny dla obu przeglądarek = najgorszy z nich. PASS 38 · FAIL 4 · BLOCKED 1.

| ID | Kryterium | Wynik | Dowód |
|---|---|---|---|
| 1.1 | Sukces + nazwa pliku w popupie | **FAIL** (Firefox); Chrome PASS | Chrome: `chrome-stable-basic-click1.png` ("Gotowe. Zapisano plik page-debug-snapshot-1792655809436.json — znajdziesz go w pobranych plikach."). Firefox 158: `firefox-unpatched-basic-2-result.png` — "Nie udało się zapisać paczki…", brak pliku (F1) |
| 1.2 | Wyjątek zrzutu → błąd PL, brak pliku | PASS | Chrome `chrome-throw-2-result.png`; Firefox `firefox-unpatched-throw-2-result.png` (w Firefoksie formalnie PASS, ale tak samo kończy się każda strona — F1; z obejściem F1: `firefox-patched-throw-2-result.png`) |
| 1.3 | chrome:// / sklep → "Na tej stronie nie da się zapisać paczki." ≤ 2 s | PASS | Chrome: `chrome-chrome-version-2-result.png` (23–30 ms), prawdziwy CWS `chrome-cws-real-2-result.png`, `about:blank`, stable `chrome-stable-newtab-step3.png`. Firefox: `firefox-about-addons-2-result.png`, `firefox-amo-2-result.png`, `firefox-about-blank-2-result.png`, about:newtab (log). Uwaga: `chrome-cws-*-result.png` z pierwszego biegu to strona zgody consent.google.com (tam zrzut działa poprawnie), nie sklep |
| 1.4 | Brak żargonu w komunikatach | PASS | unit `messages`; wszystkie widziane teksty cytowane niżej |
| 1.5 | Dwa kliknięcia → 2 pliki, `marker` raz | **FAIL** (Firefox); Chrome PASS | Chrome `chrome-run3.log`: 2 pliki, marker 1×. Firefox w stanie repo: brak plików (F1). Z obejściem F1: `firefox-patched-extra.log` — 2 pliki, `marker` 1×, brak ostrzeżenia "already exists" |
| 1.6 | `file://` bez zgody → polski komunikat o zgodzie | **FAIL** | Chrome stable 155 `chrome-stable-file-noconsent-result1.png` i Chromium `chrome-run2.log`: pokazuje komunikat o "stronie, której nie da się zapisać" zamiast instrukcji o "Zezwalaj na dostęp do adresów URL plików" (F2). Brak sukcesu i pliku — to część spełniona. Ze zgodą: PASS (`chrome-file-consent-2-result.png`) |
| 2.1 | Manifesty bez `<all_urls>`/WAR, permissions ⊆ {activeTab, scripting} | PASS | `dist/*/manifest.json`; unit zielone w Q1 |
| 2.2 | Szczegóły/about:addons bez dostępu do wszystkich witryn | PASS (uwaga F4) | Chrome stable: `chrome-stable-puzzle-menu.png` ("Nie potrzebują dostępu — Te rozszerzenia nie muszą odczytywać ani zmieniać informacji na tej stronie."), `chrome-stable-details.png` (sekcja "Uprawnienia" pusta); `developerPrivate`: `hasAllHosts:false, hosts:[]`. Firefox: `firefox-about-addons-permissions.txt` — "To rozszerzenie nie wymaga żadnych uprawnień." + "…nie wymaga ono zbierania danych." |
| 2.3 | Brak węzłów `chrome-extension://`, brak śladów | PASS | e2e smoke (Q1 13/13) |
| 2.4 | CSP `script-src 'self'` → sukces | **FAIL** (Firefox); Chrome PASS | Chrome `chrome-csp-2-result.png`; Firefox `firefox-unpatched-csp-2-result.png` (F1; z obejściem: `firefox-patched-csp-2-result.png` sukces) |
| 2.5 | Brak `inject.js` | PASS | listing `dist/chrome` (11 plików: icons, manifest, page, popup) |
| 3.1 | Czysty klon: ci, lint, test, e2e → kod 0 | PASS | `q1-clean-clone.txt`: ci 35,4 s, lint 6,0 s, test 2,2 s, e2e 11,0 s, wszystkie exit 0; lint 0 errors / 2 warnings |
| 3.2 | npm test ≤ 30 s, e2e ≤ 3 min | PASS | test 1,2 s (vitest), e2e 10–11 s; lokalny serwer 127.0.0.1 (sieci nie odłączałem) |
| 3.3 | e2e ładuje `dist/chrome` | PASS | `extensionInfo.path = C:\Agora\pluginDebbuging\dist\chrome` (`chrome-run.log`) |
| 3.4 | Brak zapisów w Pobrane/repo po e2e | PASS | `git status` w klonie po e2e czysty |
| 3.5 | Odwrócona asercja → kod ≠ 0 | PASS | `npm test` exit 1 (1 failed / 199 passed), plik przywrócony |
| 4.1–4.8 | Build, osiągalność, rozmiar, pack, ikony, parytet | PASS | unit/e2e zielone w Q1; `dist/chrome` 70 932 B, `dist/firefox` 71 133 B (< 500 KB); build 586 ms; pack 696 ms, zipy 49 328 / 49 413 B |
| 5.1 | Brak śledzonych ścieżek zabronionych | PASS | unit + `check-repo.mjs` |
| 5.2 | Historia bez zabronionych plików | PASS | `check-repo.mjs --history`: "Local history OK", "Remote-tracking refs OK"; `origin/main` = 411f60e (nie f139411) |
| 5.3 | Czysty klon bez logo/node_modules/zip w `src/` | PASS | `q1-clean-clone.txt` |
| 5.4, 5.6 | Dane syntetyczne w testach, wpis w .gitignore | PASS | unit zielone |
| 5.5 | README | **BLOCKED** | README ma 16 linii (Uprawnienia, Ikony); brak wersji Node, komend, ładowania unpacked/Firefox — czeka na E0-DOC1 |
| 6.1–6.5 | Testy logiki, klucze paczki | PASS | unit/e2e zielone; klucze paczki zgodne (`chrome-stable-basic.json`: 11 kluczy, `version 1.0.0`) |
| 7.1 | `dev-browser -Browser chrome` na osobnym profilu | PASS | `chrome-stable-devchrome-window.png`; Chrome stable 155 z `--user-data-dir=%TEMP%\tmp-web-ext-…`, rozszerzenie widoczne w menu (`chrome-stable-puzzle-menu.png`). Nie sprawdzałem bajt po bajcie profilu użytkownika |
| 7.2 | Firefox na osobnym profilu, rozszerzenie widoczne | PASS (uwaga) | `-profile %TEMP%\firefox-profile…`; ikona jest w panelu "Rozszerzenia" (puzzle), nie przypięta na pasku — domyślne zachowanie |
| 7.3 | ≤ 60 s od komendy do okna | PASS | Chrome stable: okno po 1,0–1,1 s (6 uruchomień); Firefox: okno po 2,7 s, dodatek zainstalowany po 2,0 s |
| 7.4 | Zła wartość `-Browser` → kod ≠ 0 z listą | PASS | `.ps1 -Browser opera` exit 1 ("does not belong to the set "chrome;firefox""); `node scripts/dev-browser.mjs opera` exit 2 ("Allowed: chrome, firefox") |
| ST.1–ST.4 | Opis, brak zdalnego kodu, uprawnienia w README, gecko id | PASS | unit zielone (200/200) |

## Scenariusz zgłaszającego — obserwacje

Chrome (stable 155): ikona domyślnie schowana pod "puzzle", więc ścieżka to **3 kliknięcia** (puzzle → Page Debug Snapshot → "Debug snapshot"), po przypięciu 2. Firefox: tak samo (puzzle → rozszerzenie → przycisk). Popup (`chrome-stable-popup-on-newtab.png`): tytuł "Page Debug Snapshot", opis "Uruchom snapshot debugowy dla aktualnej karty.", jeden czarny przycisk "Debug snapshot".

Komunikaty (cytaty z popupu):
- sukces (zielony): "Gotowe. Zapisano plik page-debug-snapshot-1792655809436.json — znajdziesz go w pobranych plikach." — zrozumiały, wiadomo gdzie szukać pliku; brak wskazówki, co z plikiem dalej (przycisk "Wyślij" to E1+).
- strona specjalna (czerwony): "Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie." — jasny, wiadomo co dalej.
- błąd (czerwony): "Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki." — zrozumiały. W Firefoksie zgłaszający zobaczy go na KAŻDEJ zwykłej stronie, więc "odśwież i spróbuj ponownie" nie pomoże (F1).
- `file://` bez zgody w Chrome: ten sam tekst "Na tej stronie nie da się zapisać paczki. Otwórz stronę…" — wprowadza w błąd, bo problem to ustawienie rozszerzenia, nie strona (F2).
- stan pośredni "Zapisuję paczkę…" nie jest widoczny (wynik po ~10–30 ms).
- Nie rozumiem / UX: przycisk "Debug snapshot" jest po angielsku i nie przypomina "Nagrywaj/Zapisz paczkę" (zakres E1, non-goal E0). Stan "restricted" jest czerwony jak błąd, choć to nie błąd użytkownika (nit).

Ścieżka awaryjna po błędzie: popup po błędzie jest od razu gotowy do kolejnego kliknięcia (przycisk odblokowany).

## Scenariusz developera — czas do odpowiedzi

Plik pobrany (`chrome-stable-basic.json`, 5,7 KB, 189 linii, JSON sformatowany). Klucze najwyższego poziomu w kolejności: version, collectedAt, initializedAt, notes, environment, dom, performance, storage, consoleLogs, runtimeErrors, network.
- (a) pierwszy błąd: ~5 s do `runtimeErrors` (linia 188 z 189) — **pusta tablica**; w E0 zbieranie startuje dopiero od kliknięcia (`notes`: "captured only from initialization time"), więc błąd sprzed kliknięcia jest niewidoczny. Obserwacja, nie FAIL (E1).
- (b) nieudane zapytanie: ~5 s do `network` (linia 189) — `[]`, z tego samego powodu.
- (c) co kliknął użytkownik: **brak sekcji kroków** w paczce (E1+); jedyny ślad to `consoleLogs`, którego pierwszy wpis to własny log rozszerzenia "PageDebugSnapshot initialized." (szum, nit).

## Prywatność — wynik grep

Strona testowa z tokenem (localStorage), sekretem sessionStorage, ciasteczkiem, e-mailem i hasłem w formularzu (`privacy-grep.txt`).
- Paczka rozszerzenia (`dist/`, `src/`): **0 trafień** dla każdej wartości.
- Pobrany snapshot: token 2×, sekret sesji 2×, ciasteczko 2×, e-mail 2×, hasło 1× (atrybut `value` pola `password` w `dom`). Jawne dane w snapshocie są **znane i zaakceptowane w spec** (redakcja = E3), więc nie liczę tego jako FAIL E0. Do E3: wartość pola hasła trafia przez `outerHTML`/DOM, nie tylko przez `storage`.
- Rozszerzenie nie wysyła nic do sieci (brak host_permissions i kodu sieciowego).

## Rozmiar i czas

dist/chrome 70 932 B, dist/firefox 71 133 B, zipy 49 328 / 49 413 B. Czas od kliknięcia do zdarzenia `download`: mediana 9 ms (7–12 ms, 2×3×5 uruchomień, własny skrypt); e2e perf (z odczytem pliku) 58–67 ms (`snapshot-timing.json`).
Baseline `411f60e`: **niezmierzony, bo stara wersja nie tworzy pliku**. W Chromium popup pokazał "Snapshot został uruchomiony i pobrany." bez żadnego pobrania; w konsoli strony: "window.PageDebugSnapshot nie istnieje po wstrzyknięciu" (`old-411f60e-check.txt`) — czyli odtworzony błąd z opisu problemu (fałszywy sukces). Wniosek: NFR "+20%" nie ma punktu odniesienia; nowa wersja jest szybka w wartościach bezwzględnych. Worktree usunięty.

## Ścieżki negatywne

| Ścieżka | Chrome | Firefox |
|---|---|---|
| `chrome://version` / `about:addons` | restricted, 23–30 ms | restricted (about:addons) |
| `about:blank`, nowa karta | restricted | restricted (about:blank, about:newtab) |
| sklep (CWS / AMO) | restricted (prawdziwy `chromewebstore.google.com`) | restricted (`addons.mozilla.org/pl/firefox/`) |
| dwa szybkie kliknięcia w jednym popupie | 1 plik, 1 komunikat sukcesu (przycisk blokuje się) | j.w. (z obejściem F1) |
| dwa osobne kliknięcia | 2 pliki, `marker` 1× | 2 pliki, `marker` 1× (z obejściem F1) |
| zamknięcie karty zaraz po kliknięciu | popup znika z kartą, brak pliku, brak błędów | brak pliku, panel popupu pozostaje otwarty; bez awarii |
| kliknięcie przy trwającej nawigacji | zrzut starej strony, sukces | nie testowane |
| `file://` bez zgody | błędny komunikat (F2) | n/d (Firefox: zrzut działa z obejściem F1) |
| `file://` ze zgodą | sukces | sukces (z obejściem F1) |

Nie udało się zasymulować kliknięcia przed pierwszym bajtem strony (harness wymaga aktywnej karty).

## Findings

**F1 — CRITICAL (Firefox): zrzut nie działa na żadnej zwykłej stronie.** `src/popup/snapshot-tab.js:37` wywołuje `executeScript({ files: ['page/page-debug-snapshot.js'] })`. Firefox rozwiązuje ścieżkę względem strony popupu (`moz-extension://…/popup/page/page-debug-snapshot.js`), nie korzenia rozszerzenia. Wstrzyknięcie kończy się per-ramkowym `error: "Unable to load script"` (Firefox rozwiązuje obietnicę zamiast odrzucić), a druga sonda znów zwraca `not-loaded`, więc popup pokazuje "Nie udało się zapisać paczki…". Fail-safe działa (nie ma fałszywego sukcesu), ale AC-1.1, 1.5, 2.4 nie przechodzą w Firefoksie. Kroki: `npm run dev:firefox`, otworzyć `http://127.0.0.1:8080/basic.html` (`npm run fixtures`), kliknąć ikonę → "Debug snapshot". Dowody: `firefox-unpatched-*-2-result.png`, `firefox-run.log`. Weryfikacja przyczyny na kopii `dist/firefox` w katalogu tymczasowym (nie w repo) z `files: ['/page/page-debug-snapshot.js']`: sukces w Firefoksie 158, AC-1.5 (marker 1×) i 2.4 przechodzą (`firefox-patched-*.png`, `firefox-patched-extra.log`). Dlaczego testy nie złapały: unit mockują `executeScript`, e2e jest tylko w Chromium (spec: Firefox = web-ext lint + QA ręczne). Sugestia: ścieżka z wiodącym `/`, test jednostkowy na wiodący `/`, sprawdzanie `results[0].error` po wstrzyknięciu.

**F2 — HIGH (Chrome): AC-1.6 nie spełnione, `file://` bez zgody pokazuje zły komunikat.** Bez zgody na adresy URL plików `tab.url` jest `undefined` (activeTab nie ujawnia go dla `file://`), więc `classifyUrl` zwraca `unknown`, sonda `isAllowedFileSchemeAccess` jest pomijana (`snapshot-tab.js:22` wymaga `target === 'file'`), a `mapInjectionError(err, undefined)` mapuje "Cannot access contents of the page…" na `restricted`. Zgłaszający czyta "Otwórz stronę, na której widzisz problem" zamiast instrukcji o "Zezwalaj na dostęp do adresów URL plików". Kroki: Chrome (testowane: stable 155 i Chromium 147), `chrome://extensions` → Szczegóły → wyłączyć "Zezwalaj na dostęp do adresów URL plików", otworzyć `file:///…/basic.html`, kliknąć. Dowody: `chrome-stable-file-noconsent-result1.png`, `chrome-run2.log`; potwierdzenie przyczyny: `tabs.query → [{"id":…}]` bez `url`, `isAllowedFileSchemeAccess() = false`. Testy jednostkowe przechodzą, bo podają `tab.url = 'file:///…'`. Sugestia: gdy URL nieznany, a Chrome zgłosił błąd braku dostępu, wywołać sondę zgody (`false` → `fileAccess`).

**F3 — LOW (UX):** przycisk "Debug snapshot" jest po angielsku i nie jest jednym z trzech znanych zgłaszającemu przycisków; popup nie mówi, co zrobić z plikiem. Zakres E1-T6, tylko do notatki.

**F4 — LOW/info (Chrome):** strona Szczegóły rozszerzenia ma sekcję "Dostęp do stron: To rozszerzenie może odczytywać i zmieniać Twoje dane na stronach… Automatycznie zezwól na dostęp na tych stronach" (włączone). To standardowy interfejs Chrome dla activeTab (brak hostów, `hasAllHosts:false`), ale zgłaszający lub recenzent sklepu może odczytać to jako szeroki dostęp. Firefox pokazuje "nie wymaga żadnych uprawnień".

**F5 — LOW:** `dev:chrome` na Chrome stable pokazuje pasek "Użyto nieobsługiwanej flagi wiersza polecenia: --disable-blink-features=AutomationControlled" (flaga web-ext); ikona nie jest przypięta. Kosmetyka dla developera. Bez `PDS_CHROMIUM_BINARY` skrypt (wg state.md) wybiera Canary — tego nie weryfikowałem.

**F6 — INFO (dla E3):** wartość pola `password` trafia do paczki w `dom` (patrz Prywatność); uwzględnić przy projektowaniu redakcji.

Sprzątanie: usunięto 9 plików `page-debug-snapshot-*.json` z Pobrane, które sam wygenerowałem (Chrome stable: 1792655809436, 1792655876633; Firefox: 1792656682876, 1792656690064, 1792656693684, 1792656697278, 1792656730275, 1792656732064, 1792656734470). Pozostały dwa wcześniejsze pliki użytkownika (1792487181606, 1792580787863), nietknięte. Usunięto worktree `411f60e`, klon tymczasowy i profile `tmp-web-ext-*` / `firefox-profile*`; zatrzymano serwery fixture i przeglądarki dev.

## Werdykt: FAIL

Blokujące:
1. F1 — Firefox: zrzut nie działa na zwykłych stronach (AC-1.1, 1.5, 2.4); Firefox jest drugim targetem E0.
2. F2 — Chrome: `file://` bez zgody pokazuje zły komunikat (AC-1.6).

Poza tym Chrome (stable 155 i Chromium 147) działa zgodnie ze spec; Q1 w czystym klonie zielone (200 unit, 13 e2e, lint 0 errors).
