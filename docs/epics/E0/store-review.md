# E0 — Audyt sklepowy (pds-store-reviewer, 2026-10-22)

Werdykt: **would-be-rejected** dla obecnego `dist/*` wysłanego do review. **Żadna decyzja E0 nie blokuje
publikacji** — manifesty, uprawnienia, build bez zdalnego kodu i bez minifikacji są poprawne. Blokery należą
do E1-T6, E1-T3, E3 i E5. Polityki zweryfikowane online 2026-10-22 (CWS Program Policies 2025-05-22,
CWS policy updates 2026-07-01 / egzekwowanie od 2026-08-01, CWS User Data FAQ, AMO Add-on Policies 2026-04-30).

## Findings → gdzie naprawiamy

| Waga | Finding | Polityka | Epik / zadanie |
|---|---|---|---|
| blocker | Popup nie ujawnia, co trafia do pliku (cookies, storage, HTML, formularze, nagłówki). Opis w sklepie i polityka prywatności **nie** zastępują ujawnienia w UI; przed zbieraniem wymagana afirmatywna akcja. | CWS User Data → Disclosure (2026), FAQ 10 | **E1-T6** — lista PL przy przycisku + „plik zostaje na Twoim dysku, nic nie wysyłamy”; test na obecność tekstu. Przy E2 (screenshot, webRequest) ponowne ujawnienie zmiany. |
| blocker | Dane uwierzytelniające i finansowe jawnie w pliku: `document.cookie`, storage, `Authorization`, body fetch/XHR, wartości pól (karta, CVV, PESEL), `outerHTML` 2 MB. | CWS Limited Use 2026, Handling Requirements, FAQ 4 | **E3** — twarda bramka przed E5 (korpus `sensitive.json` = 0 przecieków). |
| high | Po zrzucie `window.__PAGE_DEBUG_SNAPSHOT__` i `PageDebugSnapshot.state` zostają w MAIN; hooki zbierają dalej; skrypty firm trzecich mogą czytać. | CWS Handling („securely”), Limited Use | **E1-T3** — bufor w domknięciu, zbieranie tylko w trakcie nagrywania, `destroy()` po stop, most ISOLATED z nonce. **E3-T6** usuwa global. |
| high | Brak polityki prywatności. Wymagana także dla unlisted; przetwarzanie lokalne nie zwalnia. | CWS Privacy Policy, FAQ 2/3/14 | **E5-D3** — `docs/store/privacy-policy.md` pod publicznym URL (kategorie danych, tylko po kliknięciu, tylko plik lokalny, zero telemetrii, zgłaszający decyduje komu wyśle, opis redakcji, oświadczenie Limited Use, kontakt). |
| high | Formularz CWS „Privacy practices” nieprzygotowany. | CWS User Data FAQ | **E5-S3** — kategorie: Website content, Web history, User activity, Authentication information, PII, Financial (do czasu E3), Personal communications. Certyfikaty: nie sprzedajemy, nie używamy poza funkcją, nie do oceny kredytowej. |
| high | `icon128.png` miała napis „AGORA S.A. / PLUGIN DEV MODE”, brak 16 px marginesu, znak towarowy. Brak small promo 440×280 (obowiązkowe) i zrzutów 1280×800. | CWS Listing Requirements, Images, Impersonation/IP | **Ikony: naprawione w E0 grupa F** (decyzja użytkownika 2026-10-22: plugin niezależny, bez brandingu; ikony generowane skryptem, neutralne, z marginesem). **E5-T3** — promo 440×280, 1–5 zrzutów. |
| medium | Hooki na console/fetch/XHR nie naruszają polityk (funkcja podstawowa, kod w paczce), ale muszą być ujawnione; `DebugXHR` jako funkcja łamie `instanceof`. | CWS „Be Honest”, AMO 1.1 | **E1-T4** (Proxy/subclass); tekst do listingu — niżej. |
| medium | Uzasadnienia uprawnień w README są techniczne i tylko PL. | CWS Use of Permissions | Teksty niżej → README (faza Docs E0). |
| medium | E1/E2: `optional_host_permissions` z szerokimi wzorcami może wydłużyć review; `tabs` prawdopodobnie zbędne (`activeTab` daje `tab.url`, `tabs.reload` nie wymaga `tabs`, a `tabs` dodaje ostrzeżenie „Read your browsing history”); `webRequest` wymaga osobnego uzasadnienia. | CWS „narrowest permissions” | **E1 design** — bez `tabs`, request tylko o origin bieżącej karty, zdanie uzasadnienia per uprawnienie. |
| medium | `data_collection_permissions: {required:["none"]}` jest **dziś prawdziwe** (AMO: „transmit” = poza dodatek/przeglądarkę; plik lokalny na akcję użytkownika się nie liczy). Przestanie być, jeśli rozszerzenie samo wyśle paczkę (Jira API, POST). | AMO 6.2.1, CWS Disclosure 2026 | **E4-S2** — ograniczenie: „wysyłkę wykonuje użytkownik (mailto/link), nie rozszerzenie”, albo zmiana deklaracji. |
| medium | `gecko.id` placeholder. Zmiana darmowa do pierwszego `web-ext sign` (także unlisted); potem = nowy dodatek (brak aktualizacji, utrata `storage.local`). Domena w ID musi należeć do wydawcy. | Extension Workshop: add-on ID | **Użytkownik** podaje ostateczne ID przed E5-T5. |
| low | Manifest `1.0.0`, a plan release `0.2.0`. Sklepy wymagają wersji rosnącej; po wysłaniu 1.0.0 nie ma powrotu do 0.x. | CWS/AMO upload | **E0-REL** — nic nie było wysłane, więc manifest = wersja release (0.2.0). |
| low | `strict_min_version: 128` → 2 warnings web-ext; nie blokują podpisu. ESR 128 już niewspierany, aktualny ESR 140. | AMO 6.2.1/6.2.2 | **E5-S2** — opcjonalnie podnieść do `140.0` (zerowy koszt, usuwa warnings, Firefox pokaże „nie zbiera danych”). |

## Odpowiedzi na pytania orkiestratora

1. **Single purpose** — `description` (114 znaków, jedno zdanie) spełnia wymóg; E1–E4 mieszczą się w celu. Poza celem: własny backend jako usługa, telemetria, MCP w paczce (MCP jest osobnym pakietem Node — OK). Listing musi wymienić kategorie danych.
2. **Uprawnienia** — `activeTab` + `scripting` używane w kodzie, kategoria review minimalna.
3. **Dane** — CWS: lokalne przetwarzanie = „handling” → polityka prywatności, formularz, ujawnienie w UI wymagane także dla unlisted. AMO: `["none"]` zgodne z prawdą (interpretacja; w notatce dla reviewera: „The add-on never transmits data; it only produces a local JSON file on explicit user action.”).
4. **Kod** — grep po `dist/*`: zero `https?://`, `eval(`, `new Function`, `import(`, `importScripts`, `innerHTML`, `document.write`. `dist` = `src` bajt w bajt, brak minifikacji → AMO nie potrzebuje źródeł.
5. **web-ext warnings** — nie blokują; AMO nie wymusi 140.
6. **gecko.id** — patrz finding.

## Teksty do formularza CWS (gotowe do wklejenia)

**Single purpose**
- PL: Zapisuje do jednego pliku na dysku użytkownika dane diagnostyczne bieżącej strony (błędy, logi konsoli, zapytania sieciowe, strukturę strony), aby zgłaszający mógł przekazać je developerowi razem ze zgłoszeniem błędu.
- EN: Saves diagnostic data of the current page (errors, console logs, network requests, page structure) into a single file on the user's disk, so the user can attach it to a bug report for a developer.

**activeTab**
- PL: Po kliknięciu ikony rozszerzenie uzyskuje dostęp wyłącznie do bieżącej karty, aby zapisać z niej plik diagnostyczny; bez kliknięcia nie ma dostępu do żadnej strony.
- EN: When the user clicks the toolbar icon, the extension gets access to the current tab only, to save a diagnostic file from it; without that click it cannot access any website.

**scripting**
- PL: Uruchamia na bieżącej karcie, po kliknięciu użytkownika, dołączony do rozszerzenia skrypt, który zbiera błędy, logi konsoli, zapytania sieciowe i strukturę strony do pliku zapisywanego lokalnie.
- EN: After the user's click, runs a script bundled with the extension on the current tab to gather errors, console logs, network requests and page structure into a locally saved file.

**Remote code**: „No, I am not using remote code” — all JavaScript is included in the package; nothing is downloaded or evaluated at runtime.

**Hooki (do listingu i notatki dla reviewera)**
- EN: After you click the toolbar button, the extension temporarily wraps the page's console, fetch and XMLHttpRequest on the current tab only, to record errors and requests until you save the report; nothing is sent anywhere.
- PL: Po kliknięciu przycisku rozszerzenie na bieżącej karcie tymczasowo nasłuchuje konsoli i zapytań sieciowych strony, aby zapisać błędy do raportu; nic nie jest wysyłane.

**Szkice na E1/E2** (do potwierdzenia w ich design): `storage` — „Keeps the recording state of the current tab in session storage until the user saves the report.”; `webRequest` — „Reads HTTP status codes and sizes of requests made by the tab being recorded, to show failed requests in the report; requests are observed, never modified.”; `optional_host_permissions` — „Requested at runtime only for the site the user chooses to record, so recording can start with the page load.”

## Czego brakuje do E5 (checklista)

1. `docs/store/privacy-policy.md` pod publicznym URL, z oświadczeniem Limited Use.
2. Formularz CWS Privacy practices: kategorie, certyfikaty, pole single purpose.
3. Uzasadnienia uprawnień EN w dashboardzie i odpowiedź „No remote code”.
4. Ujawnienie w UI (E1-T6) i redakcja (E3) jako bramka.
5. Ikona sklepowa 128 z marginesem, small promo 440×280 (obowiązkowe), 1–5 zrzutów 1280×800.
6. Teksty listingu PL i EN (opis z listą danych, akapit o hookach, „nic nie wysyła”, opis redakcji).
7. Konto CWS na adres firmowy (e-maila nie da się później zmienić), opłata jednorazowa (5 USD wg stanu wiedzy), 2SV, deklaracja trader/non-trader (DSA).
8. Konto AMO z 2FA, ostateczne `gecko.id`, `web-ext sign` (listed/unlisted), notatki dla reviewera.
9. Decyzja: zachować ID Chrome z `.pem` (dołączyć `key.pem` do zipa przy pierwszym uploadzie) czy nowe ID ze sklepu.
10. Ujednolicenie wersji (manifest = release).

## Do decyzji użytkownika (zbiorczo, przy E5-S1)

URL polityki prywatności · teksty listingu · kanał CWS (listed/unlisted/enterprise) i AMO · konto wydawcy (niezależne, bez brandingu organizacji) · ostateczne `gecko.id` · ID Chrome z `.pem` czy nowe · nowa grafika · `strict_min_version` 140 czy 128.

## Sprawdzone i OK

`manifest_version: 3`; ikony 16/48/128 poprawne; manifesty różnią się tylko `minimum_chrome_version` i `browser_specific_settings`; uprawnienia minimalne i używane; brak `host_permissions`, `<all_urls>`, WAR, nadpisanego CSP; brak zdalnego kodu, `eval`, minifikacji; popup bez sieci; `description` 114 znaków; `web-ext lint` 0 errors; zipy = 11 plików runtime.
