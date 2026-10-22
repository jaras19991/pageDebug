# E1 — Audyt sklepowy (pds-store-reviewer, 2026-10-22/23)

Werdykt: **would-be-rejected** (bez zmian wobec E0) — blokery należą do E3 (redakcja) i E5 (polityka prywatności, formularz, grafiki).
E1 zamknął 3 z 13 findings E0, 3 częściowo, nie wprowadził nowego blokera. Polityki zweryfikowane online
(CWS Program Policies 2025-05-22, User Data FAQ, policy updates 2026-07-01, Extension Workshop built-in data consent 2026-03-12, source code submission).

## Status findings z E0

| E0 | Waga | Finding | Po E1 |
|---|---|---|---|
| 1 | blocker | Brak ujawnienia w UI | **Częściowo** — lista jest, ale niepełna i bez zdania o zgodzie → **F1, F2 (domknięte w E1, grupa H)** |
| 2 | blocker | Dane uwierzytelniające jawnie w pliku | Otwarty → **E3** (E1 wydłuża okno zbierania) |
| 3 | high | Global `__PAGE_DEBUG_SNAPSHOT__`, hooki po zrzucie | **Zamknięty** (AC-5.3/5.4/5.6, isolation.spec) |
| 4 | high | Brak polityki prywatności | Otwarty → **E5** (+ opis nagrywania do 10 min i danych podstron w pamięci sesji) |
| 5 | high | Formularz Privacy practices | Otwarty → E5 |
| 6 | high | Ikona / promo / zrzuty | Ikony zamknięte (E0); promo 440×280 i zrzuty → E5 |
| 7 | medium | Hooki / `instanceof` | `instanceof` **zamknięty** (Proxy); tekst listingu → E5 |
| 8 | medium | Uzasadnienia PL/EN | **Zamknięty**; tekst `storage` nieprawdziwy → **F5 (E1)** |
| 9 | medium | `tabs` / szerokie host | **Zamknięty** (bez `tabs`, prośba o jeden origin); ryzyko dłuższego review → F7 (notatka dla reviewera) |
| 10 | medium | `data_collection_permissions: none` | Nadal prawdziwe; zależne od E4-S2 |
| 11 | medium | `gecko.id` | **Zamknięty** (GUID) |
| 12 | low | Wersja | E1 → **0.3.0** (F11) |
| 13 | low | `strict_min_version` 128 | Otwarty → E5 (zalecane 140) |

## Findings E1

| Waga | # | Finding | Gdzie naprawiamy |
|---|---|---|---|
| blocker | F3 | Dane wrażliwe jawnie w pliku **i w `storage.session`** (cookies, storage, `Authorization`, body do 5000 zn., outerHTML 2 MB, wartości pól). | **E3** — redakcja także **przed `putDoc`** (w MAIN, przed `flush`), nie dopiero w `assemblePackage`; test: `pds:doc:*` bez wartości z korpusu. |
| blocker | F4 | Brak polityki prywatności + formularza. | **E5-D3** — dopisać: nagrywanie od przeładowania do zapisu, maks. 10 min; dane podstron tymczasowo w pamięci sesji do zapisu. |
| high | F1 | Lista ujawnienia niepełna: brak `requestBody`, `referrer`, adresów podstron (`documents[].url`), adresów zasobów (`performance.resources`), sygnału o danych logowania w nagłówkach/ciasteczkach, informacji o maskowaniu haseł. | **E1 grupa H** — `disclosureItems` (messages.js + popup.html): teksty niżej. |
| high | F2 | Brak zdania wiążącego klik *Nagrywaj* ze zgodą i brak informacji, że plik może zawierać dane osobowe. | **E1 grupa H** — `consentNotice` pod `noUpload`, nad przyciskiem: „Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.” + test unit i e2e. |
| high (AMO) | F6 | Bundle `content/*.js` są generowane → AMO wymaga **przesłania źródeł** z instrukcją builda (`npm ci && npm run gen && npm run build`, wersja Node). CWS bez zmian (kod czytelny). | **E5** — zip źródeł + `package-lock.json` + notatka: „`content/*.js` are concatenations of `src/page/*.js` produced by `scripts/gen-content.mjs`; no minification.” |
| medium | F5 | Uzasadnienie `storage` w README mówi tylko o „stanie”, a store trzyma do 8 MB danych podstron. | **E1 grupa H** — README PL/EN (teksty niżej). |
| medium | F7 | Szerokie `optional_host_permissions` → prawdopodobnie dłuższy review (nie odrzucenie). Wzorzec per-origin jest udokumentowany, nie jest obejściem. | **E5** — notatka dla reviewera (EN, niżej). |
| medium | F8 | `storage.session` (RAM, `TRUSTED_CONTEXTS`) — dla sesji wystarcza; problem to plik (F3). | E3 |
| low | F9 | `file:///*` może wywołać pytanie. | E5 — dopisać przypadek użycia do uzasadnienia EN. |
| low | F10 | `strict_min_version` 128 → 2 warnings; 128 to twarde minimum (`world: MAIN`), zalecane 140 (ESR 128 niewspierany). | E5-S2 |
| low | F11 | Zmiana obsługi danych → wersja **0.3.0**; od pierwszej publikacji każda zmiana kategorii danych = aktualizacja listy w popupie + CHANGELOG + polityka. | **E1 Release** |
| low | F12 | Dostęp do witryny zostaje po zapisie; README nie mówi, jak cofnąć. | **E1 Docs** — tekst niżej. |

## Teksty do wdrożenia w E1 (grupa H)

**`disclosureItems`** (5 pozycji, zastępują obecne):
1. „adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu”
2. „logi konsoli i błędy”
3. „zapytania sieciowe strony: adresy, nagłówki i wysyłana treść (mogą zawierać dane logowania) oraz adresy wczytanych plików”
4. „treść i struktura strony, w tym wartości wpisane w formularze (bez haseł i pól ukrytych)”
5. „ciasteczka i dane zapisane przez stronę (mogą zawierać dane logowania)”

**`consentNotice`:** „Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.”

**README `storage`:**
- PL: „Przechowuje w pamięci sesji przeglądarki (czyszczonej przy jej zamknięciu, niedostępnej dla stron) stan nagrania oraz dane zebrane z podstron przeładowanych w trakcie nagrania, do chwili zapisania pliku; potem je usuwa; nic nie trafia do pamięci trwałej.”
- EN: „Keeps the recording state and the data captured from pages reloaded during the recording in the browser's session memory (cleared on exit, not accessible to websites) until the user saves the file, then deletes it; nothing is written to persistent storage.”

**README — cofanie dostępu (F12, Docs):** „Po zapisaniu paczki rozszerzenie zachowuje zgodę na dostęp do nagranej witryny, ale nic na niej nie uruchamia, dopóki ponownie nie klikniesz „Nagrywaj”. Zgodę cofniesz w Chrome: `chrome://extensions` → Szczegóły → Dostęp do witryn; w Firefoksie: `about:addons` → Page Debug Snapshot → Uprawnienia.”

## Uzasadnienia uprawnień (CWS, finalne po E1)

- **activeTab** — PL: Po kliknięciu ikony rozszerzenie odczytuje wyłącznie adres bieżącej karty, aby zaproponować nagranie tej witryny; bez kliknięcia nie ma dostępu do żadnej strony. EN: When the user clicks the toolbar icon, the extension reads the address of the current tab only, to offer recording of that site; without the click it cannot access any website.
- **scripting** — PL: Rejestruje dołączony do rozszerzenia skrypt nagrywania tylko dla witryny wybranej przez użytkownika, aby działał od początku ładowania strony, i usuwa go po zapisaniu raportu. EN: Registers the bundled recording script only for the site the user chose to record, so it runs from the start of the page load, and removes it after the report is saved.
- **storage** — jak wyżej (F5).
- **downloads** — PL: Zapisuje plik raportu w pobranych plikach użytkownika i sprawdza, że plik naprawdę powstał, zanim poinformuje o zapisie. EN: Saves the report file to the user's downloads and confirms the file was actually written before telling the user it is saved.
- **Host permissions (optional)** — PL: Prośba w trakcie działania wyłącznie o witrynę, którą użytkownik wybrał do nagrania (albo o lokalny plik otwarty w przeglądarce), aby nagrywanie mogło zacząć się od załadowania strony; o dostęp do innych witryn rozszerzenie nigdy nie prosi. EN: Requested at runtime only for the site the user chooses to record (or a local file opened in the browser, e.g. a developer's test page; Chrome additionally requires the user to enable 'Allow access to file URLs'), so recording can start with the page load; access to other sites is never requested.
- **Remote code:** „No, I am not using remote code.”

**Notatka dla reviewera (F7, EN):** „Host access is optional and never granted at install. When the user clicks 'Record', the popup calls permissions.request for exactly one origin – the current tab's (`<scheme>://<host>/*`). Only then the background registers the bundled content scripts (scripting.registerContentScripts, persistAcrossSessions:false) for that one origin and reloads the tab once, so errors from page load are captured. After the user saves the report the scripts are unregistered. Nothing is transmitted; the only output is a local JSON file saved via chrome.downloads on the user's click.”

## Do decyzji użytkownika (zbiorczo przy E5-S1, poza F1/F2 — przy bramce Release E1)

Akceptacja tekstów F1/F2 · URL polityki prywatności · teksty listingu · kanał CWS/AMO · konto + 2FA/2SV + trader · `strict_min_version` 140 · ID Chrome z `.pem` czy nowe · **czy cofać dostęp do witryny po zapisie** (`permissions.remove` — usuwa F12 i wzmacnia pozycję w review; dziś decyzja 3 = zostaje).

## Sprawdzone i OK

MV3; uprawnienia = {activeTab, scripting, storage, downloads}, każde używane; brak `host_permissions`, `tabs`, `webRequest`, `cookies`, WAR, CSP; brak zdalnego kodu/eval/minifikacji w `dist/*`; `background.js`, `lib/*`, `popup/*` = `src`; content scripty `allFrames:false`, `persistAcrossSessions:false`, wyrejestrowywane po zapisie; badge ●/■; po zapisie hooki zdjęte, brak globali; `web-ext lint` 0 errors; zipy 19 plików bez `.pem`/`standalone`; Chrome 121 potwierdzone jako minimum (102 byłoby możliwe); Firefox 128 twarde minimum.
