# E2 — QA report (2026-10-23)

Środowisko: Windows 11, Node 26.12.1, Playwright Chromium 156 (headed, `Extensions.triggerAction` dla popupu, zrzuty popupu przez CDP przy 360×600), Firefox 158.0.1 (headed, web-ext + Marionette; popup otwierany `browserAction.triggerAction`, kliknięcia i zrzuty popupu z kontekstu chrome; strona sterowana Marionette). Testowany: working tree z `dist/` zbudowanym 15:49 (manifest nadal `0.3.0`). Realne strony: `https://wyborcza.pl/`, `https://www.agora.pl/` (tylko oglądanie, bez logowania, bez zgody CMP). Dowody: `docs/epics/E2/qa-evidence/` (PNG ignorowane przez git; `*.json`, `*.jpg` zostają). Skrypty pomocnicze trzymane poza repo (scratchpad), żeby lint był 0.

Ograniczenia metody: (1) uśpienie komputera nie do odtworzenia — użyto zamrożenia karty (`Page.setWebLifecycleState frozen`) i naturalnego przekroczenia limitu; (2) klik w popupie Firefoksa to `notifyUserGestureActivation + click()` z kontekstu chrome, nie prawdziwa mysz; (3) zgoda na origin nadana programowo (bąbel zgody nie badany, to zakres E1); (4) czasów „60 s” nie mierzyłem stoperem człowieka — szacunek z liczby linii/kroków; (5) QA wyczerpało budżet ~60 min po stronie Chrome (dwa zawieszenia harnessu przy zamrożonej karcie i po `runtime.reload`, ~25 min straty).

## Kryteria akceptacji

Legenda: PASS / FAIL / BLOCKED / nie sprawdzono (n/s — pokryte wyłącznie unit/e2e z raportu testera, QA nie powtarzało). Chrome = Chromium 156, FF = Firefox 158.

| ID | Wynik | Dowód |
|---|---|---|
| 1.1 | PASS (Chrome, FF) | `ch-C1-1-ready.png`, `ff-FQ10-1-ready.png`: 8 pozycji, w tym „kroki… bez treści, które wpisujesz”, „fragmenty odpowiedzi serwera, gdy coś się nie uda”, „zrzut widocznej części strony w chwili zapisu” |
| 1.2 | PASS | czytane z `ch-C1-1-ready.png`: brak CWV/LCP/webRequest/HTTP/base64/selector |
| 1.3 | PASS (Chrome, FF) | Chrome: przycisk 507–543 px w oknie 597; FF: 515–552 w 600. FF `scrollHeight` 606 > 600 (lekki scroll, przycisk sticky, widoczny) |
| 1.4 | PASS | stany popupu: tylko `#record`, `#save` (`ch-C2-1-…`, `ff-FQ1-3-…`) |
| 1.5 | PASS | Zapisz→Zapisano: Chrome 238, 264, 278, 353 ms; FF 122–154 ms (fixtures i 1,2 MB wyborcza; ze zrzutem) |
| 1.6 | BLOCKED (e2e), PASS (kod) | manifest wciąż 0.3.0 — brak realnej aktualizacji; `recording.js:381 onInstalled → resetAll()` (każdy powód) czyści nagranie i skrypty; test `runtime.reload` zawiesił harness. Wymaga ręcznego 0.3.0 → 0.4.0 przed releasem |
| 2.1 | PASS (FF live) | FF: popup otwarty, nawigacja na `localhost` → `otherOrigin` po 7 ms (od końca nawigacji), powrót → znika po 4 ms; `ff-FQ11-otherOrigin-live.png`. Chrome: e2e (tester) |
| 2.2 | PASS częściowy | Chrome: limit 3 s, karta zamrożona 6,5 s, popup otwarty na zamrożonej karcie → „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę” (`ch-AC22-popup-frozen.png`; nie rozstrzyga, czy zadziałał timer tła czy sprawdzenie `Date.now()`). FF: nagranie zostawione 26 min → po otwarciu popupu `stoppedByLimit`, `recordingStoppedReason: "time-limit"`, dokument załadowany po terminie nieodebrany z jasną notatką (`ff-FQ8-package.json`). Prawdziwe uśpienie komputera — do człowieka |
| 3.1 | PASS (Chrome, FF) | `ch-C2-package.json`, `ff-FQ1-package.json`: klik, input(email), change(checkbox), submit, pushState, navigate (reload/pushState/navigate), kolejność i `t` poprawne |
| 3.2, 3.6, 3.7 | n/s | unit/e2e testera |
| 3.3 | PASS | 15 znaków e-mail → 1 wpis `input` (`valueLength:15`) |
| 3.4 | PASS (Chrome, FF) | grep `jan@example.com`, `Sekret123`, `Prywatna notatka`, `Jan Kowalski`, `4111…` = 0 w całej paczce; `password`: tylko `inputType`; `key: "Tab"`; contenteditable bez treści. Uwaga L-3 |
| 3.5 | PASS | `text` tylko przy `#btn`, `#push`, `#go`, `#next`, `#login`; pola bez `text` |
| 4.1 | PASS (Chrome, FF) | `ff-FQ2-3-package.json`: css 200, script 404, img 404, font 200 (z rozszerzenia), xhr 401, fetch 500; każdy `status`, `type`, `sizeBytes` |
| 4.2 | PASS (FF) | `documents[1]`: `/status/404?body=page` → `status: 404` |
| 4.3 | PASS (FF, Chrome real) | `img localhost:8092` → `status: null`, `statusUnavailable: "cross-origin"`; brak gołego `0` we wszystkich paczkach |
| 4.4 | n/s | unit/e2e testera (w moich paczkach brak duplikatów poza 2× `/favicon.ico` w FF — dwa dokumenty) |
| 4.5 | PASS | 500 JSON i 401 mają `responseBodyPreview`; 404 `img`/`css` brak pola |
| 4.6 | n/s | e2e testera |
| 4.7 | PASS (Chrome, FF) | 401: `{"error":"expired","access_token":"[redacted:key-token]"}` + `Authorization: Bearer [redacted:bearer]`; grep `eyJ`, `pdsFixtureBearer` = 0 |
| 4.8, 4.9 | n/s | unit/e2e testera |
| 5.1 | PASS | FF: TTFB/FCP/LCP z `rating` (slow-lcp LCP 1527 ms, `good` wg progu 2500); Chrome real: wyborcza TTFB 58 / FCP 396 / LCP 396 / CLS 0,008; slow-lcp/cls Chrome — e2e testera (wyrocznia 1:1) |
| 5.2 | PASS | Chrome real (`ch-Q1-wyborcza-summary.json`): LCP z selektorem i `url` obrazu, CLS z 4 `sources` (selektor+value), INP po kliknięciu (`#btn`, pointerdown, fazy, 16 ms); FF: LCP selektor+url, INP z fazami |
| 5.3 | PASS | wyborcza: long taski z `t`, `duration`, URL skryptów (`otBannerSdk.js` 290 ms); tester: `heavy.js` |
| 5.4 | PASS z uwagą | FF: TTFB/FCP/LCP są; CLS i longTasks `available:false, reason:"unsupported-browser"`; **INP w FF ma prawdziwą wartość** (FF 158 ma `interactionId`) — wbrew literze AC („`INP` … `available:false`”), zgodnie z decyzją PB-3 w design; zaktualizować spec/skill. Chrome 121–122: n/s |
| 5.5 | PASS | `INP: {available:false, reason:"no-interaction"}` (FF i Chrome, strony bez klików) |
| 5.6 | PASS częściowy | bieżący dokument: `LCP.finalized:false`, notatka „LCP, CLS and INP are values at the time of saving; they could still grow.”; `hidden-at-start` n/s (unit) |
| 5.7 | PASS | obie paczki z 2 dokumentami mają `vitals` per `doc` z własnym `t` |
| 5.8 | PASS (FF) | `ff-FQ12-console-package.json` `source:"console"`: TTFB/FCP/LCP, INP `no-interaction`, notatka „INP covers only interactions after the script was pasted.” |
| 6.1 | PASS (Chrome, FF) | `screenshots[0]`: `reason:"save"`, `image/jpeg`, 1100×700 (viewport 1100×700), 1280×800 (viewport 1280×800); FF 1280×955 = `innerWidth×innerHeight×dpr1`, 22 KB. JPEG dekoduje się (`*.jpg`) |
| 6.2 | PASS | FF `ff-FQ5-screenshot-screenshot.jpg`: jednolity `rgb(0,128,255)` do rogów, brak popupu |
| 6.3 | PASS (FF) | zapis po przejściu na `localhost`: `screenshots: []`, notatka „No screenshot: the tab showed a page outside the recorded site.” (`ff-FQ6-otherorigin-package.json`); pole `password` na zrzucie — kropki, nie wartość (poniżej, FQ-6) |
| 6.4, 6.5 | n/s | unit; realny zrzut wyborcza 119 KB ≤ 300 KB |
| 6.6 | PASS | Chrome i FF, wymiary powyżej |
| 7.1 | PASS | wszystkie wymagane klucze obecne w 11 paczkach (Chrome, FF, console); puste sekcje jako `[]`/null z notatką |
| 7.2 | PASS | kolejność: nagłówek → `overview`, `limits`, `truncated` → `documents` → `notes` → `steps` → `runtimeErrors` → `network` → `vitals` → `screenshots` → `consoleLogs` → `environment` → `performance` → `storage` → `dom` → `attachments` (dane zrzutu na samym końcu, PB-2) |
| 7.3 | PASS z zastrzeżeniem | patrz „Scenariusz developera” |
| 7.4 | n/s | unit (schemaVersion 3 widoczny w paczkach) |
| 7.5 | PASS (FF) | paczka `source:"console"` ma te same klucze, `screenshots:[]`, notatka „Screenshots are not available without the extension.”; zasoby cross-origin z `statusUnavailable` |

PASS 33 · FAIL 0 · BLOCKED 1 (1.6 e2e) · PASS częściowy 3 (2.2, 5.6, 7.3 — liczone w PASS) · n/s 11 (3.2, 3.6, 3.7, 4.4, 4.6, 4.8, 4.9, 6.4, 6.5, 7.4 i część 5.4/5.6 dla Chrome 121–122 / hidden-at-start).

## Scenariusze Firefox FQ-1..FQ-12 (Firefox 158)

| FQ | Wynik | Dowód |
|---|---|---|
| FQ-1 (3.1, 3.4) | PASS | `ff-FQ1-package.json`: 19 kroków w kolejności, grep wartości = 0 |
| FQ-2 (4.1, 4.2) | PASS | `ff-FQ2-3-package.json`; `responseStatus` działa w FF 158 (PB-1 nieaktualne), font z rozszerzenia pliku |
| FQ-3 (4.3) | PASS | `localhost` img → `null` + `cross-origin` |
| FQ-4 (5.1, 5.4) | PASS | `ff-FQ4-slowlcp-package.json` LCP 1527, `ff-FQ4-cls-package.json` CLS/LT `unsupported-browser` (INP — patrz 5.4) |
| FQ-5 (6.1, 6.2, 6.6) | PASS | 1280×955 vs `innerWidth×innerHeight×1`, rogi jednolite |
| FQ-6 (6.3) | PASS | brak zrzutu na `localhost` + notatka; zrzut z `password`: `ff-FQ6-password-screenshot.jpg` — pole „Hasło” to 10 czarnych kropek, treści nie widać; w paczce 0 trafień `Sekret123`. **Ale** w tym samym zrzucie czytelne są: e-mail `jan.kowalski@example.com` i `numer karty 4111 1111 1111 1111` wpisane w zwykłe pola (L-3) |
| FQ-7 (1.6) | BLOCKED | patrz 1.6 |
| FQ-8 (2.2) | PASS częściowy | limit czasu działa (26 min bez zdarzeń); uśpienie sprzętowe nie do odtworzenia |
| FQ-9 (4.5, 4.7) | PASS (część) | 500 JSON i 401 token z podglądem/maską; 200 JSON, 500 PNG i strumień — e2e testera, QA nie powtarzało w FF |
| FQ-10 (1.1, 1.3) | PASS | `ff-FQ10-1-ready.png`; po zapisie komunikat „Zapisano…” przycięty u dołu (D-2) |
| FQ-11 (2.1) | PASS | 7 ms / 4 ms; w FF popup nie zamknął się przy nawigacji z Marionette (przy `loadURI` z kontekstu chrome zamknął się sam — po ponownym otwarciu `otherOrigin` jest, `ff-FQ11-reopen-on-localhost.png`) |
| FQ-12 (5.8, 7.5) | PASS | `console-snapshot.js` wklejony na `localhost:8092` (bez rozszerzenia), `PageDebugSnapshot.download()` → plik v3, `source:"console"` |

## E2-Q1 — realny portal

- **wyborcza.pl** (Chrome, `ch-Q1-wyborcza-summary.json`, zrzut `ch-Q1-wyborcza-screenshot.jpg` — widać okno zgody CMP, bez danych osobowych): paczka 1,2 MB (dom 906 KB, network 35 KB, performance 30 KB); `status`/`type`/`sizeBytes` na 84 wpisach; CWV: TTFB 58, FCP 396, LCP 396 (obraz + selektor + url), CLS 0,008 z 4 źródłami, INP no-interaction, ≥3 long taski z URL skryptów; zrzut 1280×800 119 KB; `documents[0].status: 200`; kroki: tylko `navigate` (klik w oknie zgody nie wykonany — „tylko oglądanie”); Zapisz → plik 353 ms.
- **agora.pl** (Chrome): klik w link `about-agora` + klik w `#cm-overlay` → 3 kroki (navigate, navigate, click `#cm-overlay`), 2 dokumenty ze statusem 200, LCP 1336/404 ms `good`, paczka 426 KB, zapis 264 ms.
- **Sygnał ryzyka 1 ze specu (> 30% wpisów bez statusu): wyborcza 77,4% (65/84; 33 script, 24 img, 4 css, 4 other cross-origin → `statusUnavailable:"cross-origin"`), agora 8,8% (18/205).** Spodziewane (CDN-y), ale próg przekroczony → patrz F-2.

## Scenariusz zgłaszającego — obserwacje

- Kliknięcia do pliku: ikona (1) → *Nagrywaj* (2) → [odtworzenie] → ikona (3) → *Zapisz paczkę* (4); zgoda na origin pominięta (nadana programowo). Czas *Zapisz→Zapisano*: 122–353 ms.
- Ujawnienie ma 8 pozycji + 3 akapity ≈ 25 linii; w 360×600 przycisk *Nagrywaj* jest widoczny bez przewijania (Chrome i FF) dzięki sticky; wciąż jedno „dużo tekstu” (UX z E1 F-8 — poprawione tylko co do widoczności przycisku).
- Po zapisie popup wraca do ekranu „Do pliku trafią…” i dopiero pod nim jest zielony komunikat „Zapisano plik … — znajdziesz go w pobranych plikach.”. W Chrome komunikat mieści się; **w Firefoksie dolna linia jest przycięta (`scrollHeight` 622 > 600, `ff-FQ1-4-saved.png`)** — zgłaszający może nie zobaczyć potwierdzenia bez przewijania (D-2).
- Strona specjalna (`chrome://version`, `about:blank`): „Na tej stronie nie da się zapisać paczki…” bez przycisków (`ch-NEG-restricted.png`, `ff-NEG-restricted.png`) — zrozumiałe.
- Zrzut zawiera to, co widać, także wpisane teksty (L-3); ujawnienie mówi „zrzut widocznej części strony”, ale nie, że wpisane w pola dane są na obrazie.

## Scenariusz developera — czas do odpowiedzi

Mierzone na paczkach z `ch-C2-package.json` (28 KB, 564 linie) i wyborcza (1,2 MB, 6311 linii; czasy szacowane z pozycji w pliku i kroków wyszukiwania, **nie stoperem człowieka** — raport oznacza to jawnie).

| Pytanie | Wynik (paczka 28 KB) | Paczka 1,2 MB |
|---|---|---|
| (a) ostatni krok przed pierwszym błędem | `overview.runtimeErrors:1` (l. 11); `runtimeErrors` l. 227 → `t` 14489 ms; `steps` l. 86–226: ostatni z mniejszym `t` = klik `#push` „Zmień adres” (14463) + `navigate pushState`; ~20–30 s | `runtimeErrors` l. 73, `steps` l. 64: ~15 s |
| (b) pierwsze zapytanie ≥ 400 | `overview.failedRequests:3`; `network` l. 239, pierwszy wpis fetch 500 l. 259 (z `responseBodyPreview`); ~10–15 s | `failedRequests:0`; `network` ma 1700 linii, szukanie `"status": 4`, ~30 s |
| (c) metryka `poor` | `overview.poorVitals:0`; `vitals` l. 311; ~10 s | `vitals` l. 1795 (po 1700 liniach sieci), `poorVitals:0` — odpowiedź „brak poor” widoczna w `overview` w 5 s |
| (d) obraz ekranu | `screenshots` l. 404 mówi `attachment:"screenshot-0"`, **sam obraz jest w `attachments` na końcu pliku jako data URL**; w edytorze tekstu trzeba skopiować ciąg do paska adresu przeglądarki/narzędzia → ~30–45 s, nie „bez jq”-owe w 10 s | j.w., `attachments` l. 6309 po 906 KB `dom` |

`overview` na górze naprawdę skraca (a)–(c). (d) mieści się w 60 s, ale to najwolniejszy krok i wymaga umiejętności („data:image/jpeg;base64” w pasku adresu). Werdykt AC-7.3: PASS z zastrzeżeniem, do potwierdzenia stoperem przez człowieka.

## Prywatność — wynik grep

Paczki Chrome i FF z fixtures `steps.html`, `pw.html`: `jan@example.com`, `jan.kowalski`, `Sekret123`, `4111…`, `Prywatna notatka`, `Jan Kowalski`, `HIDDEN-CSRF-777`, `eyJ`, `pdsFixtureBearer` — **0 trafień** (`ch-C2-package.json`, `ch-C3-package.json`, `ff-FQ1-package.json`, `ff-FQ6-password-package.json`). Treść 401 i nagłówek `Bearer` zamaskowane (`[redacted:key-token]`, `[redacted:bearer]`). Poza paczką: **zrzut ekranu (`*-screenshot.jpg`) zawiera czytelnie wpisany e-mail i numer karty** (L-3). Paczek z realnych portali (cookies/identyfikatory reklamowe w `storage` — stan sprzed E3) nie zachowano w repo; zostały `summary.json` i zrzuty publicznych stron.

## Rozmiar i czas

`dist/chrome` i `dist/firefox`: 308 KB (największy plik `content/main-world.js` 146 KB < 500 KB). Paczka: fixture + zrzut 29–47 KB; wyborcza 1,2 MB (głównie `dom`). Zapis 122–353 ms. Zrzut: 11–119 KB.

## Ścieżki negatywne

- `chrome://version` (Chrome), `about:blank` (FF): `restricted`, bez przeładowania.
- Dwa razy *Nagrywaj* (Chrome: 1 przeładowanie, „Nagrywam od…”; FF: stan „Nagrywam”).
- Zamknięcie nagrywanej karty w trakcie (FF): nowa karta → popup „Gotowy”, `recordEnabled:true` (`ff-NEG-after-tab-close.png`).
- Przejście na inny origin przed zapisem: FF PASS (brak zrzutu, notatka), Chrome e2e testera.
- Zapis po przekroczeniu limitu 10 min: FF PASS.
- Nie wykonane: stop w trakcie ładowania, CSP strict (e2e E1/E2 pokrywają), `file://`.

## Findings

| # | Waga | Opis | Kroki | Dowód |
|---|---|---|---|---|
| F-1 | MEDIUM (UX, FF) | Po zapisie komunikat „Zapisano plik …” jest pod długą listą ujawnienia i w Firefoksie przycięty u dołu okna 360×600 (`scrollHeight` 622). Zgłaszający może uznać, że nic się nie stało. | FF: nagraj → *Zapisz paczkę* → popup | `ff-FQ1-4-saved.png` |
| F-2 | LOW (ryzyko znane) | Na portalu z wieloma CDN-ami 77% wpisów `network` bez statusu (`cross-origin`) — spec ryzyko 1 (próg 30%) przekroczony; developer nie zobaczy 404 z CDN. | nagraj wyborcza.pl, zapisz, policz `status:null` | `ch-Q1-wyborcza-summary.json` |
| F-3 | MEDIUM (prywatność, zgoda) | Zrzut zawiera wpisane w zwykłe pola dane (e-mail, numer karty); AC-6.3 maskuje tylko `password`, a ujawnienie nie ostrzega o tym. Zrzut wpisany ręcznie nie jest maskowany także w kolejnych epikach bez decyzji (E3). | nagraj stronę logowania, wpisz e-mail w pole tekstowe, zapisz, otwórz zrzut | `ff-FQ6-password-screenshot.jpg`, `ch-C3-screenshot.jpg` |
| F-4 | LOW | AC-5.4: w FF `INP` ma wartość, a AC mówi `available:false`/`unsupported-browser` — implementacja słuszna (FF 158 ma `interactionId`), spec/skill `cwv-capture` do korekty; nieznane zachowanie Firefoksa 128–157. | FF: klik → paczka | `ff-FQ1-package.json` `vitals[0].INP` |
| F-5 | LOW | Krok `input` dla checkboxa ma bezsensowne `valueLength:2` (długość „on”) obok `change.checked`. | steps.html klik `#chk` | `ch-C2-package.json` |
| F-6 | LOW (UX) | Obraz ekranu w paczce siedzi w `attachments` na końcu pliku jako data URL; w sekcji `screenshots` brak wskazówki, jak go obejrzeć (`attachment: "screenshot-0"` wystarczy dla agenta, nie dla człowieka). Pomaga zdanie w `notes`/`docs`. | otwórz paczkę w edytorze | `ch-C2-package.json` l. 404, 562 |
| F-7 | INFO | Wersja w manifeście nadal 0.3.0 — AC-1.6/FQ-7 (aktualizacja 0.3.0→0.4.0) wymaga ręcznego przebiegu po podbiciu wersji. | — | — |
| F-8 | INFO (narzędzia) | Harness e2e/Playwright zawiesza się, gdy karta jest zamrożona przez `Page.setWebLifecycleState` albo po `chrome.runtime.reload()` (popup nie otwiera się) — nie defekt produktu, ale utrudnia test AC-2.2/1.6. | — | — |

Brak defektów critical/high.

## Do weryfikacji ręcznej przez człowieka

1. Uśpienie komputera (Chrome i FF): nagranie z limitem, uśpienie > limit, wybudzenie → `stoppedByLimit` (AC-2.2).
2. Aktualizacja 0.3.0 → 0.4.0 w profilu z działającym nagraniem (AC-1.6/FQ-7, ostrzeżenie o uprawnieniach u zgłaszających).
3. Prawdziwy klik myszą w ikonę/popup w Firefoksie i zrzut na ekranie HiDPI (spike T0 też tego nie sprawdził).
4. Czasy 60 s (AC-7.3) stoperem na paczce z `E2-Q1` — obraz ekranu (F-6) najwolniejszy.
5. Decyzja produktowa o F-3 (zrzut z wpisanymi danymi) przed wydaniem 0.4.0.

## Werdykt: PASS z uwagami

Blokujących nie ma. Do decyzji przed releasem: F-3 (dane w zrzucie / ujawnienie), F-1 (przycięte „Zapisano” w FF); AC-1.6 i AC-2.2 (uśpienie) tylko częściowo zweryfikowane.
