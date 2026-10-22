# Backlog — Page Debug Snapshot

Cel produktu: osoba, która ma problem na stronie, klika *Nagrywaj*, odtwarza problem, klika
*Zapisz paczkę* i wysyła ją developerowi. Developer otwiera paczkę i rozumie, co się stało,
bez dopytywania „co dokładnie zrobiłeś?”.

Kolejność epików jest zależnościowa: E0 daje fundament testowy, E1 naprawia model nagrywania
(bez tego dane są puste), E2–E4 dokładają wartość, E5 wypuszcza.

Każdy epik przechodzi przez `/pds-deliver E<n>` fazami:
**Spec → Design → Implementacja → Testy → Review + QA → Docs → Release**.
Zadania poniżej to punkt wyjścia dla fazy Design — architekt może je doprecyzować,
ale nie może pominąć żadnego bez zapisania powodu w `design.md`.

Status: `[ ]` do zrobienia · `[~]` w toku · `[x]` zrobione · `[-]` odrzucone (powód w epiku)

---

## E0 — Fundament: repo, build, testy, higiena MV3

**Problem:** nie ma gita, testów ani buildu; `.pem` leży obok kodu; paczka `.crx` ma 13 MB
przez `node_modules` i `logo.png`; `inject.js` + `web_accessible_resources` to obejście z MV2.
**Efekt:** każdy kolejny epik ma gdzie pisać testy i czym się zbudować.

Spec
- [x] E0-S1 Spisać definicję „gotowe” dla repo (co jest w paczce, co w repo, co w ignore).

Design
- [x] E0-D1 Układ repo: `src/` dla kodu rozszerzenia, `scripts/` dla narzędzi (ikony), `tests/`.
- [x] E0-D2 Wybór narzędzi: vitest + jsdom, Playwright (chromium, `--load-extension`), eslint.
- [x] E0-D3 Build: `npm run build` składa `dist/chrome/` i `dist/firefox/`, `npm run pack` robi dwa zipy.
- [x] E0-D4 Manifesty: `src/manifest.base.json` + `manifest.chrome.json` (`minimum_chrome_version`) +
      `manifest.firefox.json` (`browser_specific_settings.gecko.id`, `strict_min_version: "128.0"`);
      lista kluczy, którymi wolno się różnić; reszta identyczna (test porównawczy).
- [x] E0-D5 Źródłowe logo: **usunięte** (decyzja użytkownika 2026-10-21); ikony 16/48/128 są jedynym źródłem.

Implementacja
- [x] E0-T1 `git init`, `.gitignore` (pem, crx, zip, node_modules, snapshoty) — **pem poza repo**.
- [x] E0-T2 `package.json` (root): usunąć `sharp`, dodać `web-ext` do `devDependencies`, skrypty `test`, `test:e2e`, `lint`, `build`, `pack`.
- [x] E0-T3 Zastąpić `inject.js` wywołaniem `chrome.scripting.executeScript({ world: 'MAIN' })`;
      usunąć `web_accessible_resources`.
- [x] E0-T4 Usunąć `host_permissions: <all_urls>` — `activeTab` wystarcza dla obecnego flow.
- [x] E0-T5 `popup.js`: wynik `executeScript` ma odzwierciedlać faktyczny sukces/błąd (zwrot z funkcji),
      nie „pobrano” z góry.
- [x] E0-T6 Ikony: `logo.png` i `logo-640.png` usunięte z dysku i historii (2026-10-21); zostaje test wymiarów/rozmiaru ikon w `dist/*/icons`.
- [x] E0-T7 Smoke test e2e: załaduj rozszerzenie, otwórz stronę testową, kliknij w popupie, sprawdź pobrany plik.
- [x] E0-T8 Unit testy dla `safeJson`, `safeSlice`, `pushLimited`, `deepMerge` (istniejąca logika).
- [x] E0-T9 `web-ext` jako devDependency; `npm run lint` = eslint + `web-ext lint --source-dir dist/firefox` (0 errors).
- [x] E0-T10 Test porównawczy manifestów `dist/chrome` vs `dist/firefox` (identyczne poza dozwolonymi kluczami).
- [x] E0-T11 `scripts/dev-browser.ps1 -Browser chrome|firefox` używa `dist/<target>` po buildzie; Firefox przez `web-ext run`.
- [x] E0-T12 Popup: polski komunikat dla `file://` bez zgody („Zezwalaj na dostęp do adresów URL plików”) i dla stron specjalnych.

Testy / Review / QA / Docs / Release
- [x] E0-Q1 `npm run lint`, `npm test` i `npm run test:e2e` zielone na czystym klonie (e2e headless-capable).
- [x] E0-Q2 QA ręczne Firefox: `web-ext run --source-dir dist/firefox` na fixture'ach — smoke z AC-1.x przechodzi.
- [x] E0-R1 Review: brak sekretów, brak `<all_urls>`, każdy `dist/<target>` < 500 KB.
- [x] E0-R2 Store review (`pds-store-reviewer`): single purpose w `description`, uzasadnienia uprawnień w README,
      brak zdalnego kodu, `gecko.id` poprawny.
- [x] E0-DOC1 README (developer): Node ≥ 20, komendy, build/pack, unpacked w Chrome, tymczasowe w Firefoksie,
      sekcja „Uprawnienia” z uzasadnieniem każdego, „klucz `.pem` trzymamy poza repo”.

---

## E1 — Model nagrywania: dane od startu strony

**Problem:** hooki na console/fetch/XHR/error startują w tej samej milisekundzie co zrzut.
`consoleLogs`, `runtimeErrors`, `network` są zawsze puste w trybie rozszerzenia.
**Efekt:** zgłaszający klika *Nagrywaj*, przeładowuje stronę (automatycznie), odtwarza problem,
klika *Zapisz*. Paczka zawiera wszystko od pierwszego bajtu strony.

Spec
- [ ] E1-S1 User story zgłaszającego: 3 stany popupu (Gotowy → Nagrywam od HH:MM:SS → Zapisano).
- [ ] E1-S2 User story developera: w paczce widzę błędy i zapytania z całego życia strony, z czasem względem `timeOrigin`.
- [ ] E1-S3 Kryteria akceptacji: błąd rzucony w `<head>` przed DOMContentLoaded jest w paczce.

Design
- [ ] E1-D1 Mechanizm: `chrome.scripting.registerContentScripts` z `world: 'MAIN'`, `runAt: 'document_start'`,
      scope ograniczony do origin aktywnej karty na czas nagrywania; po *Zapisz* wyrejestrowanie.
- [ ] E1-D2 Stan nagrywania w `chrome.storage.session` (per tabId): start, origin, status.
- [ ] E1-D7 (store review E0) Uprawnienia: **bez `tabs`** (`activeTab` daje `tab.url`, `tabs.reload` nie wymaga `tabs`,
      a `tabs` dodaje ostrzeżenie „Read your browsing history”); `permissions.request` tylko o origin bieżącej karty;
      jedno zdanie uzasadnienia EN per nowe uprawnienie (szkice w docs/epics/E0/store-review.md).
- [ ] E1-D3 Most MAIN ↔ ISOLATED: `window.postMessage` z nonce; ISOLATED przekazuje do popupu/SW.
- [ ] E1-D4 Bufor między nawigacjami w obrębie karty (SPA i pełne przeładowania) — co trzymamy, co gubimy, limity.
- [ ] E1-D5 Hooki: `Proxy` na `XMLHttpRequest` i `fetch` zamiast podmiany konstruktora; `console` hook
      zapisuje `new Error().stack` i nie psuje źródła logu w DevTools (użyć `console[level].bind` + stack z hooka).
- [ ] E1-D6 Tło cross-browser: jeden `background.js` jako `service_worker` (Chrome) **i** `scripts` (Firefox event page);
      bez `importScripts`, stan tylko w `storage.session`; host permissions zawsze przez `permissions.request` z popupu
      (w Firefoksie MV3 są opcjonalne z definicji).

Implementacja
- [ ] E1-T1 Tło (SW / event page): komendy `startRecording(tabId)`, `stopAndCollect(tabId)`, `getStatus(tabId)`.
- [ ] E1-T2 Rejestracja/wyrejestrowanie content scriptu MAIN dla origin karty; auto-reload karty po starcie.
- [ ] E1-T3 Refaktor `page-debug-snapshot.js` → `recorder.js` (hooki, bufor) + `collector.js` (zrzut DOM/perf/storage).
- [ ] E1-T4 Proxy-hooki XHR/fetch zachowujące `instanceof`, stałe statyczne, `withCredentials`, `responseType`.
- [ ] E1-T5 Hooki `error`/`unhandledrejection` z `destroy()` zdejmującym listenery.
- [ ] E1-T6 Popup z trzema stanami i czasem nagrywania; komunikaty po polsku. **(store review E0 — blocker CWS)**
      Ujawnienie w UI przed zbieraniem: krótka lista PL, co trafia do pliku (cookies, dane stron, treść strony, zapytania,
      pola formularzy) + „Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła”; klik pod tekstem = zgoda; test na tekst.
      Przy każdym poszerzeniu zakresu danych (E2) — ponowne ujawnienie po aktualizacji (wymóg CWS 2026).
- [ ] E1-T7 `console-snapshot.js` (fallback bez instalacji) ma działać na tym samym `recorder.js`
      i jasno mówić: „zbieram od teraz; odtwórz problem i wywołaj `PageDebugSnapshot.download()`”.
- [ ] E1-T8 (z review E0, **HIGH — potwierdzone re-QA: 3× „Gotowe” bez pliku**) Prawdziwy wynik zapisu: pobieranie przez `chrome.downloads.download` w tle (permission `downloads` —
      **zatwierdzone przez użytkownika 2026-10-22**) i sukces dopiero po `onChanged.state === 'complete'`; dziś `<a download>` w stronie daje fałszywy
      sukces przy zablokowanych automatycznych pobraniach.
- [ ] E1-T9 (z review E0) `runInPage` weryfikuje `pds.version` (z `args`) zamiast ufać dowolnemu `window.PageDebugSnapshot`;
      marker instalacji pod `Symbol.for('pds.installed')`.
- [ ] E1-T10 (z review E0) Timeout na `executeScript` (~15 s) → `failed` z komunikatem „strona jeszcze się ładuje”.
- [ ] E1-T11 (z review E0) Walker builda: rzucać na `url(`/`chrome.runtime.getURL(`/import z template literal, których nie
      umie rozwiązać (fail-safe), gdy pojawi się pierwszy CSS lub tło.

Testy / Review / QA / Docs / Release
- [ ] E1-TEST1 Unit: proxy XHR przechodzi `instanceof`, `XMLHttpRequest.DONE === 4`, axios-like użycie.
- [ ] E1-TEST2 E2E: strona testowa rzuca błąd w `<head>` i robi fetch 500 przed DCL → oba są w paczce.
- [ ] E1-TEST3 E2E: SPA z `history.pushState` — nagranie nie urywa się.
- [ ] E1-R1 Review: brak wycieku `chrome.*` do MAIN world; nonce w postMessage; limity buforów.
- [ ] E1-Q1 QA: scenariusz zgłaszającego od instalacji do pliku na dysku, z nagraniem ekranu jako dowodem.
- [ ] E1-DOC1 Instrukcja dla zgłaszającego (PL, 5 kroków, zrzuty ekranu).

---

## E2 — Kompletność danych

**Problem:** brak CWV, kodów HTTP, treści odpowiedzi, zrzutu ekranu i kroków użytkownika.
Developer wie, że „coś było wolno”, ale nie wie co, i nie wie, co zgłaszający kliknął.
**Efekt:** paczka odpowiada na pytania: *co kliknął, co się zepsuło, co było wolne, jak to wyglądało*.

Spec
- [ ] E2-S1 Lista pól wymaganych vs opcjonalnych w paczce; co developer czyta najpierw.
- [ ] E2-S2 Kryteria: LCP/CLS/INP/FCP/TTFB z atrybucją; status każdego zapytania; ≥1 zrzut ekranu
      z momentu *Zapisz*; lista kroków (klik/input/nawigacja) z selektorami i czasem.

Design
- [ ] E2-D1 CWV: `web-vitals` (attribution build) wbudowane w `recorder.js` lub własne `PerformanceObserver`
      z `buffered: true` na `largest-contentful-paint`, `layout-shift`, `event`, `long-animation-frame`,
      `paint`, `resource`. Decyzja z uzasadnieniem (rozmiar vs utrzymanie). Firefox nie daje CLS/INP/LoAF —
      paczka i `summary.md` mówią „niedostępne w tej przeglądarce”.
- [ ] E2-D2 Kody HTTP i rozmiary: `chrome.webRequest` (observational, permission `webRequest`) w SW,
      korelacja z wpisami z MAIN world po URL+czasie. Alternatywa: tylko fetch/XHR z MAIN. Decyzja.
- [ ] E2-D3 Treść odpowiedzi: klon odpowiedzi fetch/XHR tylko dla `content-type` tekstowych, limit N KB,
      tylko dla statusów ≥ 400 domyślnie (konfigurowalne).
- [ ] E2-D4 Kroki użytkownika: listener `click`/`input`/`submit`/`popstate` w ISOLATED world,
      selektor CSS stabilny (id > data-* > ścieżka), wartości inputów **nie** zapisywane (tylko typ i długość).
- [ ] E2-D5 Zrzut ekranu: `chrome.tabs.captureVisibleTab` przy *Zapisz*; opcjonalnie przy każdym błędzie
      (throttle). Format JPEG, jakość 60.
- [ ] E2-D6 Iframe'y same-origin: zbierać podstawowe dane; cross-origin: tylko lista `src`.

Implementacja
- [ ] E2-T1 Moduł `vitals.js` — zbiera metryki z atrybucją (element LCP, źródła CLS, target INP).
- [ ] E2-T2 webRequest w SW: mapa requestId → {url, status, size, type, timing}, filtr do tabId nagrywania.
- [ ] E2-T3 Korelacja webRequest ↔ hooki MAIN; pole `network[].status` i `network[].sizeBytes`.
- [ ] E2-T4 Treść odpowiedzi dla błędów (limit, content-type).
- [ ] E2-T5 Rejestrator kroków użytkownika w ISOLATED world.
- [ ] E2-T6 Zrzut ekranu i osadzenie w paczce (base64 w JSON lub osobny plik — zależnie od E3-D2).
- [ ] E2-T7 Stack trace dla `console.error` i błędów runtime zachowany w pełnej postaci.

Testy / Review / QA / Docs / Release
- [ ] E2-TEST1 Unit: korelacja webRequest ↔ MAIN przy wielu identycznych URL w krótkim czasie.
- [ ] E2-TEST2 E2E: strona testowa z wymuszonym CLS i wolnym LCP → metryki i atrybucja w paczce.
- [ ] E2-TEST3 E2E: 404 na obrazku i 500 na fetch → oba mają status w paczce.
- [ ] E2-R1 Review: permission `webRequest` uzasadnione w manifeście i README; brak wartości inputów w krokach.
- [ ] E2-Q1 QA: na realnej stronie (np. dowolny portal) paczka ma CWV, statusy, screenshot, kroki.
- [ ] E2-DOC1 Aktualizacja `docs/snapshot-schema.md` (schemaVersion 2).

---

## E3 — Prywatność i rozmiar paczki

**Problem:** paczka zawiera jawne cookies, localStorage, sessionStorage, wartości pól formularzy
(poza password/hidden). Zgłaszający wyśle Ci swój token sesji mailem. Plik ma 1,2 MB, z czego
większość to `outerHTML`.
**Efekt:** paczka jest bezpieczna do wysłania przez e-mail/Slack i mieści się w załączniku.

Spec
- [ ] E3-S1 Polityka redakcji: co zawsze maskujemy, co maskujemy domyślnie z możliwością wyłączenia
      przez developera (nie przez zgłaszającego), co zostaje. Patrz skill `privacy-redaction`.
- [ ] E3-S2 Limit rozmiaru paczki: cel ≤ 2 MB skompresowane; wyjątki jawnie opisane.

Design
- [ ] E3-D1 Warstwa `redact.js` uruchamiana na gotowym obiekcie snapshotu przed serializacją,
      z raportem: ile wartości zamaskowano i w jakich sekcjach (bez samych wartości).
- [ ] E3-D2 Format paczki: `.zip` (`CompressionStream`) z `snapshot.json`, `summary.md`, `screenshot.jpg`;
      zgłaszający widzi jeden plik.
- [ ] E3-D3 HTML: zamiast pełnego `outerHTML` — struktura bez tekstów (tagi, atrybuty id/class/data-*,
      bez `value`, bez treści `<script>`), limit 300 KB; pełny HTML jako opcja developerska.
- [ ] E3-D4 Cookies: nazwa, rozmiar, domena/flagi jeśli dostępne; wartość zastąpiona hashem (SHA-256, 8 znaków)
      — pozwala porównać dwa zrzuty bez ujawniania wartości.

Implementacja
- [ ] E3-T1 `redact.js` z regułami: wzorce (JWT, `Bearer`, e-mail, karta, IBAN, PESEL), klucze
      (`token|secret|session|auth|password|key|csrf`), nagłówki (`Authorization`, `Cookie`, `Set-Cookie`).
- [ ] E3-T2 Zastosowanie redakcji do: storage, cookies, nagłówków request/response, body odpowiedzi,
      argumentów console, URL-i (query string z kluczami wrażliwymi), kroków użytkownika.
- [ ] E3-T3 Strukturalny zrzut DOM zamiast `outerHTML`.
- [ ] E3-T4 Pakowanie do `.zip` + nazwa pliku `snapshot-<host>-<YYYYMMDD-HHMMSS>.zip`.
- [ ] E3-T5 Raport redakcji w `summary.md` („zamaskowano 14 wartości w 3 sekcjach”).
- [ ] E3-T6 (z review E0) Usunąć global `window.__PAGE_DEBUG_SNAPSHOT__` — pełna paczka (cookies, storage, DOM) nie może
      być dostępna skryptom firm trzecich na stronie ani zalegać w pamięci.

Testy / Review / QA / Docs / Release
- [ ] E3-TEST1 Unit: korpus 50 przykładów wrażliwych/niewrażliwych → 0 wycieków, ≤ 2 fałszywie dodatnie.
- [ ] E3-TEST2 Unit: redakcja jest idempotentna i nie zmienia struktury (klucze/typy) obiektu.
- [ ] E3-TEST3 E2E: strona z tokenem w localStorage i formularzem z e-mailem → paczka bez wartości.
- [ ] E3-R1 Review bezpieczeństwa: ręczny przegląd paczki z realnej strony przez reviewera z listą kontrolną.
- [ ] E3-Q1 QA: paczka z portalu ≤ 2 MB, otwiera się, `summary.md` ma raport redakcji.
- [ ] E3-DOC1 Sekcja „Co jest w paczce, a czego nie ma” w instrukcji dla zgłaszającego.

---

## E4 — Wyjście: podsumowanie, przeglądarka paczki, przekazanie, dostęp dla agenta

**Problem:** surowy JSON bez podsumowania. Developer scrolluje 1 MB. Zgłaszający nie wie, co zrobić z plikiem.
**Efekt:** zgłaszający widzi „Zapisano. Wyślij ten plik do …”. Developer otwiera `summary.md`
albo lokalny viewer i widzi: błędy, nieudane zapytania, CWV, kroki. Agent AI odpytuje paczkę przez MCP.

Spec
- [ ] E4-S1 Zawartość `summary.md` (kolejność: środowisko → kroki → błędy → nieudane zapytania → CWV →
      najwolniejsze zasoby → ciasteczka/rozmiar → raport redakcji).
- [ ] E4-S2 Flow „Wyślij”: konfigurowalny przez developera adres/kanał (mailto, link do formularza, Jira
      Service Desk URL) pokazany zgłaszającemu po zapisie. Bez własnego backendu w tym epiku.
      **Ograniczenie (store review E0):** wysyłkę wykonuje użytkownik (mailto/link), nigdy rozszerzenie — inaczej
      deklaracje AMO `data_collection_permissions: none` i CWS „no transfer” przestają być prawdziwe.
- [ ] E4-S3 Viewer: pojedynczy `viewer.html` (offline, drag&drop zip) z zakładkami i filtrem.
- [ ] E4-S4 MCP: narzędzia `list_snapshots`, `get_summary`, `get_errors`, `get_network(filter)`,
      `get_vitals`, `get_steps`, `diff_snapshots(a, b)`.

Design
- [ ] E4-D1 Generator `summary.md` w rozszerzeniu (ten sam kod użyty przez viewer i MCP) — moduł `summarize.js`.
- [ ] E4-D2 `viewer.html`: vanilla JS, bez CDN (offline), czyta zip przez `DecompressionStream`.
- [ ] E4-D3 Pakiet `page-debug-mcp` (Node, `@modelcontextprotocol/sdk`), czyta katalog ze snapshotami,
      zwraca małe odpowiedzi zamiast całego JSON-a.
- [ ] E4-D4 Konfiguracja developerska (`chrome.storage.managed` lub plik w paczce rozszerzenia):
      adres do wysyłki, czy pełny HTML, progi redakcji.

Implementacja
- [ ] E4-T1 `summarize.js` + testy snapshotowe wyjścia.
- [ ] E4-T2 Ekran „Zapisano” w popupie z instrukcją wysyłki i przyciskiem „Pokaż plik”.
- [ ] E4-T3 `viewer.html` z zakładkami: Podsumowanie, Kroki, Błędy, Sieć, CWV, DOM, Storage.
- [ ] E4-T4 `page-debug-mcp` z 7 narzędziami i README jak dodać do Claude Code / Cursor.
- [ ] E4-T5 `diff_snapshots`: różnice w błędach, statusach, CWV, liczbie/rozmiarze ciasteczek.

Testy / Review / QA / Docs / Release
- [ ] E4-TEST1 Snapshot testy `summary.md` na 3 przykładowych paczkach.
- [ ] E4-TEST2 E2E viewer: wczytaj zip, przełącz zakładki, filtr sieci po statusie.
- [ ] E4-TEST3 MCP: testy integracyjne każdego narzędzia na przykładowym katalogu.
- [ ] E4-R1 Review: viewer nie wykonuje niczego z paczki (XSS przez `outerHTML`/console args) — tylko tekst.
- [ ] E4-Q1 QA: pełna ścieżka zgłaszający → plik → developer otwiera viewer → agent odpytuje MCP.
- [ ] E4-DOC1 README developera: viewer, MCP, konfiguracja wysyłki.

---

## E5 — Release i dystrybucja

**Problem:** rozszerzenie trzeba dostarczyć zgłaszającym bez tłumaczenia „tryb developera → load unpacked”.
**Efekt:** zgłaszający dostaje link, instaluje w 2 kliknięcia; developer ma powtarzalny release.

Spec
- [ ] E5-S1 Decyzja użytkownika — Chrome: Web Store (unlisted) vs polityka enterprise (`ExtensionInstallForcelist`)
      vs `.crx` self-hosted; Firefox: AMO listed/unlisted (podpis **wymagany** nawet do self-hostingu `.xpi`)
      vs polityka enterprise. Orkiestrator **zatrzymuje się** i pyta.
- [ ] E5-S2 Wersjonowanie (semver), CHANGELOG, min. wersje: Chrome (`minimum_chrome_version`), Firefox (`strict_min_version`).
- [ ] E5-S3 Materiały sklepowe: polityka prywatności (publiczny URL), deklaracja danych CWS „Privacy practices”
      i AMO (deklaracja zbieranych danych w manifeście/na AMO — zweryfikować aktualny wymóg), uzasadnienia uprawnień.
      **Checklista 10 punktów i gotowe teksty: docs/epics/E0/store-review.md.** Bramka twarda: E1-T6 (ujawnienie) i E3 (redakcja).
- [ ] E5-S4 (store review E0) Decyzje użytkownika: URL polityki prywatności; konto wydawcy (niezależne — plugin bez brandingu organizacji);
      ID Chrome z `.pem` czy nowe; `strict_min_version` 140 (usuwa warnings, ESR 140) czy 128; ostateczne `gecko.id`.

Design
- [ ] E5-D1 Pipeline: lint → test → e2e → build → pack → (opcjonalnie) upload. GitHub Actions lub lokalny skrypt.
- [ ] E5-D2 Strona/README dla zgłaszającego z linkiem instalacyjnym i 5-krokową instrukcją.
- [ ] E5-D3 Polityka prywatności (wymagana przez Web Store) — co zbieramy, gdzie trafia (nigdzie poza plikiem).

Implementacja
- [ ] E5-T1 Skrypt release: podbicie wersji w `manifest.json` i `package.json`, tag, zip w `dist/`.
- [ ] E5-T2 CI (jeśli repo zdalne) — pipeline z E5-D1.
- [ ] E5-T3 Materiały do sklepów: opis, zrzuty ekranu (1280×800), polityka prywatności, teksty PL/EN.
      **Small promo 440×280** (obowiązkowe w CWS) i zrzuty — ikony są generowane skryptem `scripts/icons.mjs` (neutralne, bez brandingu; E0 grupa F).
- [ ] E5-T4 Telemetria **zero** — jawnie w README i polityce.
- [ ] E5-T5 Podpis Firefox: `web-ext sign` (kanał wg E5-S1) z kluczami AMO poza repo; artefakt `.xpi` w `dist/`.
- [ ] E5-T6 Automatyczny smoke Firefox: Selenium + geckodriver, `installAddon(zip, temporary)`, 3 scenariusze z AC-1.x.

Testy / Review / QA / Docs / Release
- [ ] E5-Q1 Instalacja z wybranego kanału na czystym profilu Chrome **i** Firefox przez osobę nietechniczną (lub symulacja).
- [ ] E5-R1 Pełny audyt `pds-store-reviewer` (CWS + AMO) z werdyktem *publishable* przed wysłaniem do review.
- [ ] E5-DOC1 CHANGELOG 1.0.0, instrukcja aktualizacji.

---

## Poza zakresem (świadomie)

- Nagrywanie wideo sesji (session replay) — duży koszt, rozwiązuje to Jam/Sentry; nasze kroki + screenshoty wystarczą.
- Własny backend do odbioru paczek — na razie e-mail/Slack/Jira; wrócić po E5, jeśli wolumen uzasadni.
- Safari (Firefox jest w zakresie od E0).
- Specjalizacja branżowa (reklamy, consent) — nie w tym narzędziu.
