# E2-T0 — spike: zrzut ekranu, `responseStatus`, Firefox, `webRequest` bez host permission

**Wynik: D5 i D2 wykonalne w obu przeglądarkach. PB-1 znika, bo Firefox 158 ma `responseStatus` (wariant A nie jest potrzebny).
Firefox `captureVisibleTab` z event page działa po kliknięciu ikony. Korekta D5: w Firefoksie `activeTab` ginie przy każdym
przeładowaniu i nawigacji, w Chrome tylko przy zmianie origin.**
Data: 2026-10-23, Windows 11. Playwright 1.64.1, Chromium 156.0.8078.4 (`channel: 'chromium'`, nowy headless),
Firefox 158.0.1 (web-ext 10.8.0, headless, Marionette z `-remote-allow-system-access`).

Skrypty (Node z Windows, bo `node_modules` są natywne dla Windows):
- `node tests/e2e/spike-e2/run.spike.mjs [--headed] [--dpr2 | --dpr2-real]` (Chromium: S1, S2, S3, S5, S6),
- `node tests/e2e/spike-e2/firefox.spike.mjs [--headed]` (S4 i S3/S6 w Firefoksie).

Rozszerzenie `tests/e2e/spike-e2/ext/` (MV3, `activeTab`, `scripting`, `storage`, `optional_host_permissions` http/https)
jest kopiowane do katalogu tymczasowego. Kopia S5 dostaje dodatkowo `webRequest`, a kopia Firefoksa `background.scripts` + `gecko.id`
+ `action.default_area: navbar`. Serwer: `tests/e2e/spike-e2/server.spike.mjs` (127.0.0.1:0, `localhost:<port>` = drugi origin).
`dist/`, `src/` i manifesty nie były dotykane.

## Wyniki

| # | Punkt | Chromium 156 | Firefox 158 |
|---|---|---|---|
| S1 | `captureVisibleTab(windowId, {jpeg, 60})` z tła po otwarciu popupu (`Extensions.triggerAction` / `browserAction.triggerAction`) | **PASS.** `data:image/jpeg;base64,`, 1280×720 = `innerWidth×innerHeight×dpr` (dpr 1), 4 rogi `[2,127,255]` przy tle `rgb(0,128,255)` (popup nie trafia do obrazu), 6160 B, 10–21 ms. Z prawdziwym DPR 2 (`--force-device-scale-factor=2`): 984×370 = 492×185×2, PASS | **PASS.** 1366×683 = `innerWidth×innerHeight×dpr` (dpr 1), rogi `[2,127,255]`, 15 421 B, 6–7 ms |
| S2 | `activeTab` po przeładowaniu w obrębie origin | **PASS.** Reload: OK. Inna ścieżka tego samego origin: OK. Zamknięcie popupu: OK (uprawnienie zostaje). Origin → `localhost` → origin: **błąd** | **inaczej:** po `tabs.reload` → `Missing activeTab permission`. Po przejściu na inny origin i z powrotem: ten sam błąd |
| S3 | `responseStatus` | **PASS.** Zasoby same-origin: `<img>` 404 → 404, `<script>` 404 → 404, CSS → 200, font → 200 (`initiatorType: css`). `<img>` z `localhost` → `0` (także z `Timing-Allow-Origin: *`, wtedy jest tylko `encodedBodySize`). Zamknięty port → wpis RT z `0`, rozmiary 0 i zdarzenie `error`. Dokument 404 → `navigation.responseStatus` 404 | **takie samo**, z dwiema różnicami: font ma `initiatorType: other` (nie `css`), a cross-origin z TAO ma `encodedBodySize` 0. Dochodzi wpis `/favicon.ico` (`other`, 404). Dokument 404 → 404 |
| S4 | Wykrywanie funkcji i kodek w event page (Firefox) | n.d. | **PASS.** `responseStatus` w `PerformanceResourceTiming.prototype` i `PerformanceNavigationTiming.prototype`: **tak**. `supportedEntryTypes`: `event, first-input, largest-contentful-paint, mark, measure, navigation, paint, resource` (**brak** `layout-shift`, `longtask`, `long-animation-frame`). `interactionId` w `PerformanceEventTiming.prototype`: **tak**. `OffscreenCanvas.convertToBlob({type:'image/jpeg'})` + `createImageBitmap(Blob)` w event page: działa (64×32, `image/jpeg`), na zrzucie też (q 0,45 i skala ×0,75 → 1025×512) |
| S5 | `webRequest` + nadane tylko `http://127.0.0.1/*`, strona z `<img>` z `localhost` | **PASS.** `onBeforeRequest` widzi `/s5` i `ok.png?s5=same`, a `ok.png?s5=cross` (`localhost`) nie. Przed nadaniem: 0 zdarzeń. Potwierdza D2 | nie sprawdzano (D2 nie dodaje `webRequest`) |
| S6 | `fetch` 500 `text/plain` ze strumieniem bez końca: `clone()` + czytnik 2 s + `cancel()` | **PASS.** Klon: 161 znaków, koniec po 2004 ms (timeout), `cancel()` bez błędu. `bodyUsed` = false po klonie i po anulowaniu klonu. Strona czyta dalej swoją gałąź (5 chunków), potem `bodyUsed` = true. Skończony 500 JSON: klon `text()` + strona `r.json()` działają | **PASS.** To samo: 161 znaków, 2034 ms, strona 5 chunków, JSON OK |

Liczby z ostatnich przebiegów: Chromium 5/5 PASS (domyślny, `--dpr2-real`), Firefox 4/4 PASS.
`--dpr2` (emulacja `deviceScaleFactor` Playwrighta): obraz 1280×720 przy `devicePixelRatio` 2, więc FAIL wymiarów. To artefakt emulacji, bo
`captureVisibleTab` bierze prawdziwą powierzchnię okna. **Wniosek dla TEST5:** nie porównywać wymiarów z `dpr` przy emulowanym `deviceScaleFactor`.

## Komunikaty błędów zrzutu → powody dla T6a

| Sytuacja | Chromium 156 | Firefox 158 | Powód w paczce |
|---|---|---|---|
| brak `activeTab` (popup nieotwarty na tej karcie, nawigacja na inny origin, w FF także reload) | `Either the '<all_urls>' or 'activeTab' permission is required.` | `Missing activeTab permission` | `capture-failed` (notatka: „otwórz okienko na tej karcie i zapisz jeszcze raz”) |
| nagrywana karta w tle (aktywna jest inna) | ten sam komunikat co wyżej (API łapie aktywną kartę okna) | n.d. (nie sprawdzano) | D5 zatrzymuje to wcześniej (`tab.active`), czyli brak wywołania i notatka |
| limit wywołań | 3. wywołanie w < 1 s: `This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.` | brak limitu (3/3 OK w serii) | `capture-failed` (wystarczy jedno wywołanie na zapis) |
| strona specjalna (`chrome://version`) z otwartym popupem | **zrzut się udaje** (89 816 B) | n.d. | D5 zatrzymuje to wcześniej (`isSameOrigin`), czyli brak wywołania i notatka |

Wszystkie odmowy są rzucone szybko (0–2 ms), więc `timeout` (3 s) zostaje tylko dla zawieszenia. Komunikatów nie trzeba parsować:
lista powodów z T6a (`capture-failed | timeout | too-large`) wystarcza. Jeśli architekt chce osobnej notatki o braku dostępu, wystarczy test
`/activeTab/i` w komunikacie (oba brzmienia go zawierają) → np. `no-access`.

## Wnioski

- **PB-1: znika.** Firefox 158 ma `responseStatus` w Resource i Navigation Timing, a wartości zgadzają się z Chrome (404/200/0, dokument 404).
  `statusUnavailable: "unsupported-browser"` dla statusów zostaje tylko jako gałąź wykrywania funkcji (Firefox 128–?, nie sprawdzano wersji
  między 128 a 158). Wariant (B) z `webRequest` nie wchodzi.
- **D2 potwierdzone (S5).** `webRequest` z nadanym jednym origin nie widzi zasobu z innego origin. Cross-origin daje `responseStatus` 0 także
  z `Timing-Allow-Origin`, więc `statusUnavailable: "cross-origin"` dla każdego cross-origin `0` jest poprawne. Zamknięty port daje wpis RT z `0`
  **i** zdarzenie `error` elementu, ale same-origin `0` → `network-error` zgodnie z D2. Cross-origin `0` z `error` (np. 404 z innego hosta)
  jest nie do odróżnienia od braku sieci, więc zostaje `cross-origin`.
- **T3a (`resourceKind`):** font ma `initiatorType` `css` w Chrome i `other` w Firefoksie, więc rodzaj trzeba brać z rozszerzenia
  pliku przed `initiatorType` (tak jak w D2). Firefox dodaje wpis `/favicon.ico` (`other`). To szum, ale zgodny z „type: other”.
- **D5: wymaga korekty w jednym zdaniu.** Mechanizm działa w obu przeglądarkach bez nowego uprawnienia. Różnica: Firefox cofa `activeTab` przy
  każdym przeładowaniu i nawigacji (nawet w tym samym origin), Chrome tylko przy zmianie origin. Przepływ D5 (zrzut przy *Zapisz paczkę*
  z popupu otwartego na bieżącym dokumencie) jest bezpieczny, bo otwarcie popupu nadaje `activeTab` od nowa. Nie działa scenariusz, w którym
  popup jest otwarty, strona się przeładuje, a potem klikamy *Zapisz*. W Firefoksie wynikiem jest brak zrzutu z notatką `capture-failed`,
  a zapis idzie dalej (AC-6.4). Proponuję dopisać to do D5 i do QA ręcznego. Zdanie „sprawdza spike S1/S4” w „Pytaniach do bramki” jest potwierdzone.
- **Firefox `captureVisibleTab`: działa** z event page po `browserAction.triggerAction(window)` (ta sama ścieżka co klik ikony/skrót,
  `tabManager.hasActiveTabPermission` false → true). Wymiary i rogi poprawne. `OffscreenCanvas` + `createImageBitmap` w event page działają,
  więc `createCanvasCodec` z T6a może być wspólny. AC-6.6 nie idzie do bramki.
- **PB-3 / cwv-capture:** Firefox 158 ma `event` + `first-input` i `interactionId`, więc INP może dać prawdziwą wartość w Firefoksie (PB-3).
  CLS i long tasks: brak typów wpisów → `unsupported-browser`. Skill `cwv-capture` mówi, że Firefox „nie dostarcza `interactionId`”.
  Dla FF 158 to już nieaktualne (notatka dla `pds-docs`).
- **S6 / D3 potwierdzone** w obu przeglądarkach: `clone()` nie ustawia `bodyUsed`, `cancel()` klonu nie zatrzymuje gałęzi strony,
  timeout 2 s się trzyma (2004/2034 ms).

## Anomalia (poza zakresem D2)
W Chromium 156 listenery `webRequest.onCompleted`/`onErrorOccurred` zarejestrowane na górnym poziomie SW nie dostały żadnego zdarzenia
w 6 przebiegach. `onBeforeRequest` dodany po nadaniu origin działał (4 zdarzenia), a raz razem z dodanym obok `onCompleted` też milczał.
Przyczyny nie badałem (timebox). D2 nie używa `webRequest`, więc nie ma to wpływu na E2. Gdyby PB-1 (B) wróciło, trzeba to zbadać przed decyzją.

## Czego nie sprawdzono (QA ręczne)
- Prawdziwy klik ikony w Firefoksie z widocznym panelem popupu i kliknięciem *Zapisz* w panelu (spike użył `triggerAction` z kontekstu chrome
  i wywołał zrzut z karty rozszerzenia w innym oknie).
- Firefox: karta w tle i strony specjalne (`about:`), limit wywołań przy dłuższej serii.
- Firefox 128–157: obecność `responseStatus` (sprawdzony tylko 158).
- Zrzut na fizycznym ekranie HiDPI (sprawdzony tylko `--force-device-scale-factor=2` w headless).
