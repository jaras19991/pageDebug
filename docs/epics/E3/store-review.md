# E3 — store review (CWS + AMO)

Data: 2026-10-26 · audytor: pds-store-reviewer (zapis raportu: orkiestrator — agent nie ma narzędzia zapisu).
Źródła zweryfikowane 2026-10-26: CWS Program Policies → Disclosure Requirements (akt. 2022-11-01), „Chrome Web Store policy updates 2026” (2026-07-01, egzekwowane od 2026-08-01: Limited Use „strictly necessary to the extension's disclosed single purpose”, „all data collection be prominently disclosed”, „proactively disclose … changes”), Extension Workshop „firefox-builtin-data-consent” (wymagane dla nowych dodatków od 2025-11-03; transmisja = poza dodatkiem i lokalną przeglądarką).
Zakres: `git diff 3b01fa7 -- src` + nowe pliki `src/lib/{budget,export,file-name,redact*,sha256,summary,zip}.js`, `src/page/{dom-structure,field-rects}.js`; `dist/chrome`, `dist/firefox` (identyczne z `src`).

**Werdykt: would-be-rejected — bez nowego blokera z E3.** Odrzucenie wynika z F4 (E1 → E5). Zakres E3: publishable-with-fixes (1 high).

## Findings

| # | Waga | Artefakt | Opis | Polityka | Poprawka |
|---|---|---|---|---|---|
| S1 | high | `src/popup/messages.js:15`, `src/popup/popup.html` (7. `<li>`) | PB-1 (B): iframe'y cross-origin (płatności, SSO) nie są maskowane, a ujawnienie mówi „pola formularzy są na nim zakryte”. Zrzut domyślnie włączony → numer karty może trafić do pliku wbrew temu, co widzi użytkownik. Dane płatnicze nie są „strictly necessary” do zgłoszenia błędu. | CWS Disclosure Requirements („no surprises”, prominent disclosure 2026); Limited Use 2026 (strictly necessary); User Data — sensitive (financial) | Minimum przy (B): pozycja → „…pola formularzy tej strony są na nim zakryte, ale nie w okienkach innych serwisów osadzonych na stronie (np. płatność, logowanie) — wyłącz zrzut, jeśli je widać”; to samo w polityce prywatności (E5) i README „Co jest w paczce”. Opcjonalnie: przy `frames.crossOrigin > 0` przełącznik domyślnie wyłączony + notatka; najpewniej (A). |
| F3 (E1/E2) | — | — | Zamknięte przez E3 poza S1: redakcja całej paczki w tle przed zapisem, `summary.md` z danych po redakcji, ciasteczka → nazwa/rozmiar/hash, struktura DOM bez tekstów i wartości, maska pól na zrzucie (fail-closed), przełącznik „Dołącz zrzut ekranu”. | Limited Use, User Data | — |
| S2 | medium | `src/lib/redact-rules.js` (state.md T1, T2a) | Znane luki: klucze AWS `AKIA…`, OAuth `?code=` < 32 znaków bez słowa-klucza; `maskText` połyka resztę po `;jsessionid=`. | User Data Policy — handling of sensitive data (authentication) | E3-R1: dopisać reguły i korpus; `consentNotice` („dane logowania”) zostawić. |
| F4 (E1) | blocker | brak `docs/store/` | Bez zmian: brak polityki prywatności, listingu i Privacy practices. | User Data Policy → Privacy Policy, Disclosure | E5: polityka opisuje redakcję (co usuwamy), hash ciasteczek, strukturę DOM, zrzut z maską i lukę S1, lokalny zip, brak wysyłki. |
| F6/E0#10 | medium (AMO) | `dist/firefox/manifest.json`, `content/main-world.js` | `data_collection_permissions: ["none"]` obronialne (plik lokalny, brak transmisji). `web-ext lint`: 0 errors, 2 warnings (`strict_min_version` 128 < 140/142); `unknownMinifiedFiles`: 8 czytelnych plików (`lib/redact*.js`, `lib/save.js`, `content/isolated-world.js` …) — fałszywie dodatnie, ale prowokują prośbę o źródła; `main-world.js` 187 KB generowany. | AMO Add-on Policies — Source Code Submission; Data Disclosure | E5: zip źródeł + `npm ci && npm run gen && npm run build`, notatka dla reviewera; `strict_min_version` 140. |
| S3 | low | `README.md:5,92,256` | README opisuje v3/`.json` i „Dane nie są redagowane” — sprzeczne z ujawnieniem po E3. | CWS „Be Honest” / spójność ujawnień | DOC1. |
| S4 | low | `privacyNote`, `src/lib/sha256.js` | „wartości ciasteczek są usuwane” — w pliku zostaje 8 hex SHA-256 bez soli (słabe wartości odgadywalne). | Limited Use / Disclosure (dokładność) | Polityka: „zastępowane krótkim skrótem, z którego nie da się odczytać długich wartości”. |
| S5 | low | `src/manifest.base.json` | Zmiana obsługi danych (zip, redakcja, przełącznik) przy `version` 0.4.0. | CWS 2026 „proactively disclose changes” | Release: 0.5.0 + CHANGELOG; ujawnienie w popupie przed *Nagrywaj* wystarcza. |
| S6 | info | `src/lib/session-store.js` | Surowe dane do chwili zapisu w `storage.session`; redakcja przy eksporcie. Zgodne z uzasadnieniem `storage`. | Limited Use | Polityka: opisać kolejność „lokalnie → redakcja → plik”. |

## Ocena PB-1 (B)
Sama decyzja jest dopuszczalna, bo dane zostają lokalnie, rozszerzenie nic nie wysyła, a użytkownik może wyłączyć zrzut. Niedopuszczalne jest obecne ujawnienie, które sugeruje pełne zakrycie pól. Wymagane:
1. Dokładne zdanie w popupie przed *Nagrywaj*/przy przełączniku.
2. Akapit w polityce prywatności: „zrzut może pokazać dane wpisane w osadzone formularze innych serwisów, np. płatności”.
3. Wpis w README „Znane ograniczenia”.

Z tym S1 spada do low. Bez tego ryzyko odrzucenia w CWS z powodu wprowadzającego w błąd ujawnienia albo zbierania danych finansowych ponad potrzebę.

## Sprawdzone i OK
- Manifesty: `src` = `dist/{chrome,firefox}`, bez zmian względem 0.4.0. Uprawnienia `activeTab` (`captureVisibleTab`), `scripting` (`registerContentScripts`), `storage` (`storage.session`), `downloads` (`download`/`onChanged`/`cancel`), opcjonalne hosty — wszystkie użyte. Brak `cookies`/`<all_urls>`/`offscreen`/`webRequest`. Uzasadnienia PL/EN w `README.md` §Uprawnienia nadal aktualne (`downloads` → plik `.zip`, bez zmiany sensu).
- Zdalny kod: brak `eval`/`new Function`/`import()`/zdalnych `<script>`. Writer ZIP, `CompressionStream('deflate-raw')`, `OffscreenCanvas`, SHA-256 w JS — natywne API lub czytelny kod w paczce, bez zastrzeżeń (MV3 remote code, Code Readability).
- Pełny HTML nieosiągalny dla zgłaszającego (`devOptions: {}` w tle). `summary.md` budowany ze zredagowanego snapshotu.
- Ikony 16/48/128 poprawnych wymiarów; `manifest_version` 3.
- Single purpose bez zmian; brak telemetrii i wysyłki.

## Do decyzji użytkownika (E5)
Formuła ujawnienia dla PB-1, URL polityki prywatności, teksty listingu, listed/unlisted, konto z 2FA, `strict_min_version` 140.
