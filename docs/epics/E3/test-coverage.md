# E3 — Pokrycie AC testami (faza Testy, 2026-10-26)

Przebieg na wyłączność (Chromium; przeglądarka poza sandboxem): `npx vitest run` 1294/1294 w 63 plikach (~124 s) · `npm run lint` exit 0 (eslint 0; web-ext 0 errors / 0 notices / 2 warnings `strict_min_version`, jak w E0/E1) · `npm run gen -- --check` up to date · `npm run build` dist/chrome 422,4 KB, dist/firefox 422,6 KB (30 plików; największy `main-world.js` 186 649 B ≤ 500 KB) · e2e pełny `PDS_E2E_NO_BUILD=1` 97/97 ×2 przebiegi (2,4 min każdy, 0 flaky, 0 retry) · `--repeat-each=10 --retries=0` dla privacy + screenshot-mask + package-v4: 210/210 (3,8 min) = 10/10 dla TEST3, TEST4, TEST5 · `npm audit --omit=dev`: 0 vulnerabilities.
Skróty: U = vitest (`tests/unit/<plik>`), E = Playwright (`tests/e2e/<plik>`), FQ = scenariusz QA ręcznego Firefox (design.md), Q1 = QA ręczne.

| AC | Pokrycie |
|---|---|
| 1.1 | U file-name (host bez portu, czas lokalny); U popup-controller::zipBase64 becomes application/zip Blob; U save::zipBase64 decodes…fileName snapshot-<host>-<time>.zip; E package-v4::zip entries order… exactly one file in downloads; FQ-E3-1 |
| 1.2 | U zip::fflate.unzipSync and zlib.inflateRawSync read identical bytes, crc32, stored fallback; E package-v4::unzip -t "No errors"; Q1 Eksplorator Windows 11 / Archiwizator macOS (FQ-E3-6) |
| 1.3 | U popup-html::static texts equal MESSAGES, no JSON/zip/hash/redakcja in popup, consent order; U messages; docs DOC1 (README) |
| 1.4 | U popup-html::checkbox above #save; E package-v4::popup 360×600 visible with checkbox; FQ-E3-1 |
| 1.5 | U export::5000 console logs end to end ≤ 1,5 s; E perf::save→Zapisano ≤ 5 s median of 5 na basic.html i flood; FQ-E3-1 |
| 2.1 | U popup-controller::save sends includeScreenshot; U save::includeScreenshot false → no fieldRects/no capture, missing → true; U export::screenshot off; E screenshot-mask::checkbox off; FQ-E3-2 |
| 2.2 | U field-rects::every editable type, iframe, shadow, contenteditable; U screenshot::rect scaled ×2/×1.25, mask applied before fit; E screenshot-mask::dpr 1 / dpr 2 (stddev maski ≤ 0,019, kontrola ≈ 60); E same-origin iframe masked, cross-origin not (PB-1 B); FQ-E3-2/5 |
| 2.3 | E screenshot-mask::values, activeElement and scrollY identical, no DOM mutation; U save::capture between two fieldRects; FQ-E3-2 (mignięcie wzrokowo) |
| 2.4 | U screenshot::non-empty mask without codec → error, never the original; U save::fieldRects hangs / second fails / codec.mask throws; E screenshot-mask::bridge gone |
| 3.1 | U redact-rules::sensitive corpus 0 leaks, covers every Always pattern and IN2 case |
| 3.2 | U redact::per sekcja (network, console, runtimeErrors, steps, documents, vitals); U redact-page::localStorage, sessionStorage, cookies, forms, meta, dom, location, performance; U collector::forms; U serialize (T0a) |
| 3.3 | U redact-rules::maskUrl…; U redact::same URL trap in every URL field → 0 hits; U redact-page url-pola |
| 3.4 | U hooks-steps::file change fileCount; U collector::file input; U snapshot-validator (valueLength odrzucone); E privacy::file input |
| 3.5 | U export::trap values absent from every zip entry; U save::trap values redacted in every zip entry; U hooks-network (u źródła); E privacy::grep -c każdej pułapki po rozpakowaniu = 0 (z screenshot.jpg); FQ-E3-3 |
| 3.6 | U serialize::page overriding JSON.stringify/parse; U redact::page-patched String.prototype.replace; U hostile-realm; E privacy::hostile page (valid JSON, validator, 0 trafień, dane nadal zapisane) |
| 3.7 | U console-entry::console package redacted (validator v4); E privacy::console fallback 0 trap hits; FQ-E3-4 |
| 4.1 | U redact::masked value is `[redacted:<rule>]`; U redact-property (marker, nie null) |
| 4.2 | U redact::second pass reports 0; U redact-property::redact(redact(x)) deep-equals; U redact-rules::maskText idempotent |
| 4.3 | U redact::total equals occurrences; U export::sum redaction.masked == count; U summary::contains line; walidator v4 w każdym zapisie e2e; Q1 summary.md |
| 4.4 | U redact-page::cookies [{name,sizeBytes,valueHash}], vectors, same value → same hash; U sha256 (NIST); E privacy (sid nie występuje) |
| 4.5 | U redact::disabling email removes… jwt ignored; U summary::lists disabled rules; U export::fullHtml in disabledRules |
| 5.1 | U redact-rules::benign corpus ≤ 2 FP (aktualnie 1: „123 456 789 zł”); Q1 < 20% URL-i ze znacznikiem |
| 5.2 | U dom-structure::no text…, 10 000 elements ≤ 300 000; U collector::dom has structure ≤ limit; E package-v4::dom-10k |
| 5.3 | U dom-structure::20 selectors from fixture match exactly 1 element |
| 5.4 | U redact::statuses, methods, t, durations, sizes, overview, vitals, error messages unchanged |
| 5.5 | Q1 (developer ≤ 60 s na realnym portalu) |
| 6.1 | U budget::heavy fits ≤ 2 097 152; U export::heavy package → zip ≤ 2 MB; E package-v4::basic/privacy/network ≤ 2 MB (16,7 / 28,7 / 20,0 KB), heavy-e3 1,65 MB; Q1 portal |
| 6.2 | U budget::never removes…, cut order, only as much as needed, truncated + note; E package-v4::heavy-e3 truncated flags + notes, never-cut sections intact |
| 6.3 | U budget::fullHtml limit 10 MB, never throws; U export::fullHtml…, never throws on oversized input; U save::devOptions html-structure |
| 6.4 | U zip (kolejność, stored JPEG, deflate JSON); U export::zip entries; E package-v4::zip entries order |
| 6.5 | U serialize-perf::console.log(5 MB) p95 ≤ 5 ms; U background-recording::101st document trims…removes pds:doc; U background-lib::removeDocs |
| NFR rozmiar/czas | U export::redaction + compression 5 MB ≤ 1,5 s; U zip::5 MB ≤ 500 ms; U redact-rules::5 MB ≤ 700 ms; E package-v4 / perf |
| NFR prywatność | U save::storage.session dump; E privacy::storage.session after save |
| NFR uprawnienia / dist | E package-v4::manifests equal 0.4.0 except version; E dist ≤ 500 KB; WL 0 nowych ostrzeżeń (2 stare) |

## Pomiary (E2E, Chromium)
zip: basic 16,7 KB · privacy 28,7 KB · network 20,0 KB · heavy-e3 1,65 MB (screenshot 304 KB, snapshot.json 2,66 MB, zapis ≈ 1,6 s; cięte: consoleLogs, network, html, resources; zostało 55 logów / 20 zapytań / 200 resources). Maska zrzutu: stddev pól ≤ 0,019 (próg 5,1), kontrola ≈ 60.

## Brak testu automatycznego (lista dla QA, `qa-report.md`)
- Firefox (niedostępny w WSL): FQ-E3-1 (AC-1.1, 1.4, 1.5), FQ-E3-2 (AC-2.1–2.3), FQ-E3-3 (AC-3.5), FQ-E3-4 (AC-3.7), FQ-E3-5 (zamknięty shadow DOM, `openOrClosedShadowRoot` jako getter), FQ-E3-6 (zip z Firefoksa w Eksploratorze Windows 11 i `unzip -t`), `web-ext lint` (0 errors, 2 stare warnings).
- Pinch-zoom (`vvScale ≠ 1` → brak zrzutu z notatką): tylko unit (screenshot, save), brak e2e.
- Otwieranie zipa w Eksploratorze Windows 11 i Archiwizatorze macOS (AC-1.2).
- Realny portal: AC-5.1 (< 20% URL-i ze znacznikiem), AC-5.5 (developer ≤ 60 s), AC-6.1 (zip ≤ 2 MB).
- Mignięcie strony przy zrzucie (AC-2.3, wzrokowo); strona logowania z realnym polem hasła.
- Dwa zapisy w tej samej sekundzie → ta sama nazwa, Chrome dopisuje „ (1)” (do oceny QA).
- Ryzyko zaakceptowane PB-1 (B): iframe cross-origin (np. płatność) niezakryty na zrzucie — ocena QA/DOC1.

## Błędy produktu / uwagi (bez zmian w src/)
Brak nowych. Znane, z state.md (nie blokują): FP „123 456 789 zł” → phone; niewychwycone AWS `AKIA…` i OAuth `?code=` < 32 zn. bez słowa-klucza; `maskText` połyka resztę po znaczniku w parze k=v; w MAIN nadal metody stron (slice/trim/includes/sort… — do R1); `Object.prototype.toJSON` poza AC-3.6; heavy 222 mln zn. wymaga cięcia przed redakcją (zrealizowane w T6/T4b).

## Regresje poza epikiem
Brak: 97/97 e2e (w tym specy E0–E2) ×2, unit 1294/1294.

---

## Ponowny test po poprawkach z review (iteracja 1, 2026-10-26)

Przebieg: unit 1349/1349 (orkiestrator) · `npm run build` dist/chrome 447,9 KB · e2e Chromium pełny `PDS_E2E_NO_BUILD=1`: przebieg 1 = 100/102 (1 flaky-kandydat `vitals::reload during recording` — LCP 44 ms zamiast ≥ 1500, test E2, 3× `--repeat-each` po 18/18 zielone, nie powtórzył się w przebiegu 2; 1 czerwony nowy test F5), przebieg 2 = 101/102 (czerwony tylko F5). `--repeat-each=10 --retries=0` dla privacy + privacy-traps + screenshot-mask + screenshot-frames: 160/170 zielone; 10/10 czerwone wyłącznie test F5 (deterministyczny błąd produktu E3-PD2), reszta 10/10.

Zmiany w istniejących testach (nie osłabiają asercji): `screenshot-mask.spec.js` — `screenshot-mask.html` ma widoczny iframe cross-origin, więc od S1 przełącznik startuje wyłączony; testy AC-2.3 i „same-origin iframe masked” włączają go ręcznie (`saveWithCheckbox(page, true, { frames: true })`), a test AC-2.1 (checkbox off) przeniesiono na `privacy.html` (bez ramek cross-origin).

| Nowy test | Pokrycie |
|---|---|
| `screenshot-frames.spec.js` — widoczny iframe cross-origin: przełącznik odznaczony + `#screenshotNote` = `MESSAGES.screenshotFramesNote`, `frameCheck` = `{ok:true, crossOriginFrames:1}`, zapis bez zrzutu, status zawiera „Plik nie zawiera zrzutu ekranu.”, brak screenshot.jpg | S1, QA F-5, AC-2.1 |
| `screenshot-frames.spec.js` — ramki cross-origin 1×1, poza viewportem, display:none, visibility:hidden, opacity:0 (`frames-hidden.html`): `frameCheck` = 0, przełącznik zaznaczony, notatka pusta, zrzut jest | S1 (crossOriginVisible) |
| `screenshot-frames.spec.js` — ręczne zaznaczenie przy widocznej ramce → screenshot.jpg w paczce, status bez dopisku | S1, AC-2.1 |
| `privacy-traps.spec.js` — `traps-e3.html`: F1 (redux-persist, `data-props`), F2 (sekret na granicy cięcia requestBody 5000 i wpisu konsoli 40 000; grep także 6 zachowanych znaków), F3 (`password: "x"` w console.log), F6 (`cvv=`), F5 (`?code=`, `?ticket=` poza stack) → 0 trafień w całym zipie z screenshot.jpg + dane zapisane (znaczniki `[redacted:`) | AC-3.1–3.5, F1–F3, F5, F6 |
| `privacy-traps.spec.js` — F5: wartość `?code=` nigdzie w zipie, także w `consoleLogs[].stack` — **CZERWONY** (E3-PD2) | AC-3.3, F5 |

## Błędy produktu (opis z repro, bez zmian w src/)
- **E3-PD1** (niski): po redakcji ucięty podgląd wpisu konsoli (`consoleLogs[].args.preview`, 40 000 zn.) rośnie ponad `limits.entryChars` (kilka znaków sekretu zastąpione `[redacted:key-password]`), więc walidator v4 odrzuca paczkę (`consoleLogs[1].args.preview: longer than limits.entryChars`). Repro: `traps-e3.html` (`console.log` stringa JSON z `"password":"<sekret>"` tak, że cięcie przypada 6 znaków w sekret). Do decyzji: ponowne przycięcie po redakcji albo poluzowanie reguły w schemacie/walidatorze. Test `privacy-traps` wyłącza `validate` w `saveRecording` i sprawdza ręcznie, że to jedyny błąd schematu.
- **E3-PD2** (średni, F5 niedomknięte): `?code=<wartość>` strony pozostaje jawnie w `consoleLogs[].stack` (`at http://host/traps-e3.html?code=acf7b294aea5fb:44:15`); w `environment.location`, `network[].url` i steps zamaskowane. Repro: `npx playwright test tests/e2e/privacy-traps.spec.js` (ostatni test), strona `/traps-e3.html?code=<hex>` + `console.log`.

---

## Ponowny test po poprawkach iteracji 2 (PD1, PD2, N1–N4, N6, 2026-10-26)

Przebieg: unit 1360/1360 (orkiestrator) · `npm run build` dist/chrome 461,9 KB · e2e Chromium pełny `PDS_E2E_NO_BUILD=1`: przebieg 1 = 104/104, przebieg 2 = 104/104 (0 flaky; `vitals.spec.js:123` nie padł ani razu). `--repeat-each=10 --retries=0` dla privacy, privacy-traps, screenshot-mask, screenshot-frames, package-v4: 280/280. Dawny czerwony test F5 (PD2) i błąd PD1 (walidator) są zielone.

Dostosowanie do N6 (fail-closed), bez osłabiania asercji:
- `helpers/recording.js::saveRecording` — przed kliknięciem „Zapisz paczkę” czeka na rozstrzygnięcie frameCheck (przełącznik zaznaczony LUB niepusta notatka); opcje `awaitFrameCheck` (domyślnie true) i `forceScreenshot` (ręczne zaznaczenie po notatce).
- `screenshot-mask.spec.js` — gałąź bez ramek czeka na `checked === true` i pustą notatkę; gałąź z ramkami czeka na dokładny tekst `screenshotFramesNote` (test „bridge gone” po limicie: dokładnie jeden z dwóch tekstów, ramki lub `screenshotCheckFailedNote`, i ręczne zaznaczenie).
- `screenshot-frames.spec.js` — ramki niewidoczne: czeka na `checked === true` (zamiast stałego sleepa 1,5 s); ramki widoczne: dokładny tekst notatki zamiast „dowolna niepusta”.
- `screenshot.spec.js` (AC-6.3, karta poza origin nagrania): frameCheck kończy się błędem → przełącznik wyłączony, więc test zaznacza go ręcznie (`forceScreenshot`), by nadal sprawdzać ścieżkę „outside the recorded origin”.
- `package-v4.spec.js:185` — test układu popupu otwartego jako karta (bez nagrywania), bez frameCheck → domyślnie zaznaczony; bez zmian, zielony.

| Nowy test | Pokrycie |
|---|---|
| `screenshot-frames.spec.js` — N6: zapis przed odpowiedzią frameCheck (SW wstrzymuje `tabs.sendMessage(fieldRects)` o 1,5 s) → przełącznik odznaczony, notatka pusta, paczka bez zrzutu, status „Plik nie zawiera zrzutu ekranu.” | N6 |
| `privacy-traps.spec.js` + `fixtures/pages/traps-e3b.html` — N1 (`order-id-<karta Luhn>` w konsoli, URL, atrybucie DOM), N2 (`payload=` + JSON %-enc w requestBody; grep także postaci zakodowanej), N3 (`console.log([{name:'password',value}])`, `[...new FormData(form)]`), N4 (`data-xml="&lt;password&gt;…"`) → 0 trafień w całym zipie ze screenshot.jpg; dane zapisane (`[redacted:`, `payload=`, `data-xml`) | N1–N4 |

Uwagi (nie błędy blokujące):
- Po zapisie z N6 (zapis przed odpowiedzią) późna odpowiedź frameCheck = 0 nie zaznacza już przełącznika w tym popupie (obserwacja, popup po zapisie i tak się zamyka; nie jest asertowane).
- Przy fail-closed z powodu błędu frameCheck (np. karta poza origin nagrania) paczka niesie notatkę „Screenshot not included (turned off by the reporter)” — treść nieprecyzyjna, bo to nie wybór zgłaszającego, tylko wyłączenie po nieudanym sprawdzeniu. Do oceny reviewera/QA.
- Błędy produktu: brak nowych.

---

## Ponowny test po poprawkach iteracji 3 (N9, N10, N11, 2026-10-26)

Przebieg: unit 1365/1365 (orkiestrator) · `npm run build` dist/chrome 465,7 KB · e2e Chromium pełny `PDS_E2E_NO_BUILD=1`: 105/105 (0 flaky). `--repeat-each=5 --retries=0` dla privacy, privacy-traps, package-v4: 95/95. Jednorazowo w pierwszym przebiegu repeat globalTeardown zgłosił „e2e changed the working tree” (po 95/95 zielonych); powtórzenie z porównaniem `git status` przed/po: bez zmian, 95/95, nie odtworzone.

| Nowy test | Pokrycie |
|---|---|
| `privacy-traps.spec.js` — N9 + `fixtures/pages/traps-e3c.html`: `console.log('password:', pw)`, `console.log('token=', t)`, `console.log('login','jan','password', pw)` oraz długi wpis (> 40 000 zn., `{truncated, preview}`) z parami `'password', pw` na początku i na końcu → 0 trafień w całym zipie ze screenshot.jpg; znaczniki `[redacted:` obecne, wpis `truncated` obecny; kontrola `console.log('Pressed key', 'Enter')` → `Pressed key` i `Enter` w paczce | N9 (N10 argKeyRule, N11 maskPreviewPairs pośrednio) |

Błędy produktu: brak nowych. Cięcie `capStrings` od najstarszych (N11) pokrywa istniejący `heavy-e3` (package-v4/E3-TEST5, zielony).
