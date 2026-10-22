# E1-T0 — spike: tło, origin, kanał MAIN↔ISOLATED, pobranie (Chromium + Firefox)

**Wynik: wszystko wykonalne. PB-2 nie jest potrzebne. Handshake D3: `relatedTarget`. Zmiana dla D11/T18: pobrania
nie przez `Browser.setDownloadBehavior({behavior:'allow'})`, bo Chrome gubi wtedy nazwę pliku (S7).**
Data: 2026-10-22, Windows 11. Playwright 1.64.1, Chromium 156.0.8078.4 (`channel: 'chromium'`, headless),
Firefox 158.0.1 (web-ext 10.8.0, headless, Marionette).

Skrypty: `node tests/e2e/spike-e1/run.spike.mjs [--skip-s3] [--no-accept-downloads]` (Chromium, S1–S7),
`node tests/e2e/spike-e1/firefox.spike.mjs` (S8). Rozszerzenie: `tests/e2e/spike-e1/ext/` (MV3, `background.service_worker`
z `type: module`, `activeTab`, `scripting`, `storage`, `downloads`, `optional_host_permissions` http/https/file).
Popup leży w `popup/popup.html`, tak jak w E0. Fixture `/head` to wroga strona: pierwszy skrypt w `<head>` nasłuchuje `pds:*`
na `document`/`window`, podmienia `EventTarget.prototype.dispatchEvent` i getter `CustomEvent.prototype.detail`, a po `load`
podrabia handshake. Drugi skrypt w `<head>` rzuca `head-boom`.

## Wyniki (Chromium)

| # | Punkt | Wynik | Dowód |
|---|---|---|---|
| S1 | uchwyt SW | **działa** | `context.serviceWorkers()` od razu zwraca `chrome-extension://<id>/sw.js`, `evaluate(() => chrome.runtime.id)` = ID z `developerPrivate` |
| S2 | stop SW + `storage.session` | **działa** | `Target.closeTarget` na celu `service_worker` → `{success:true}`, 0 celów SW. `sendMessage` z popupu budzi SW (nowy `bootId`), `storage.session` zachowany. **Zdarzenie Playwrighta `close` na starym `Worker` nie przyszło w 3 s.** Zarejestrowane content scripty działają po stopie SW |
| S3 | `developerPrivate.addHostPermission(id,'http://127.0.0.1/*')` | **nie nadaje wprost** | brak błędu, ale `permissions.contains` = false, `getAll().origins` = [], `runtimeHostPermissions` = []. Działa za to pośrednio (S4) |
| S4 | klik w popupie z `Runtime.evaluate({userGesture:true})` | **działa** | po S3: `granted:true` bez okna, potem `contains` = true. Bez `userGesture`: `This function must be called during a user gesture`. Kontrola `--skip-s3`: z gestem pojawia się natywny bąbel, który zamyka popup (sesja CDP znika). Ten sam efekt dla nienadanego `localhost` |
| S5 | `registerContentScripts` MAIN+ISOLATED `document_start` + `tabs.reload` | **10/10** | MAIN złapał `head-boom` w 10/10, a `t0` MAIN < `t0` skryptu strony. Chrome uruchamia ISOLATED **przed** MAIN niezależnie od kolejności w tablicy (10/10). `js: ['/main.js']` działa, Chrome normalizuje do `main.js`; bez `/` też działa |
| S6 | handshake D3 (`MouseEvent.relatedTarget` + `CustomEvent` ze stringiem) | **działa** | 10/10 związanych, węzeł `isConnected=false` (ten sam węzeł w obu światach). Listenery strony na `document`/`window`: 0 zdarzeń. Podrobiony handshake po związaniu: 0 wiadomości na węźle strony. Wyciek nonce **tylko** ścieżką „naiwną” (patrz T13). Fallback z dopięciem węzła działa (`isConnected=true` w chwili odbioru). Obiekt w `detail` Chrome klonuje |
| S7 | Blob w popupie + `downloads.download` + `onChanged complete` | **działa, ale nie z `setDownloadBehavior allow`** | Z `allow` (globalnie albo z `browserContextId`, z `acceptDownloads` true lub false) Chrome **ignoruje `filename`** i plik nazywa się `<uuid bloba>.json`, tak samo w `downloads.search` i `Browser.downloadWillBegin`. Działa wariant: `behavior:'default'` (globalnie + dla `browserContextId`) i własny `userDataDir` z `Default/Preferences` `{download:{default_directory:<mkdtemp>, prompt_for_download:false}}` → `pds-spike-e1.json`, drugi zapis `pds-spike-e1 (1).json` (uniquify). `onChanged complete` w SW, basename z `search` = plik na dysku, 2,5 MB. Playwrightowe `download` nie przychodzi (popup nie jest `Page`). `~/Downloads` bez zmian (433 → 433) |

## S8 Firefox 158.0.1 (web-ext + Marionette, nakładka `background: {scripts:['sw.js'], type:'module'}`)

| Punkt | Wynik | Dowód |
|---|---|---|
| tło jako moduł event page | działa | `ping` z karty rozszerzenia → `bootId`, `id` |
| `storage.session` | działa | set/get `ff-value` |
| origin | nadany z kontekstu chrome | `ExtensionPermissions.add(id, {origins:['http://127.0.0.1/*']})` → `permissions.contains` = true |
| S5 `registerContentScripts` MAIN + `tabs.reload` | 10/10 w 10 z 11 przebiegów (łącznie 109/110) | `head-boom` złapany, MAIN przed stroną. Jeden przebieg dał 9/10 i nie udało się go odtworzyć w 9 kolejnych. Szczegóły nie zostały zapisane: kryterium to „złapany i `t0` MAIN < `t0` strony”, a w FF zegar ma niską rozdzielczość. Teraz skrypt loguje `SUMMARY S5 miss`. Do obserwacji w T19 (ryzyko 1 spec). Kolejność światów jest zmienna |
| S6 handshake `relatedTarget` | 10/10 | strona widzi 0 zdarzeń, wycieki tylko w ścieżce naiwnej, fallback działa. **Obiekt w `detail` → `Permission denied to access property "toJSON"`** (Xray), więc string jest konieczny |
| `downloads.download` z bloba strony rozszerzenia | działa | `complete`, prawdziwa nazwa w katalogu tymczasowym |

Uwagi: Marionette w kontekście chrome wymaga w FF 158 flagi `-remote-allow-system-access`. Preferencje `browser.download.dir`/`folderList`
z opcji `pref` web-ext **nie zadziałały**: w pierwszym przebiegu plik trafił do `~/Downloads`, skąd go usunąłem. Teraz skrypt ustawia je przez
`Services.prefs` i przerywa, jeśli `Downloads.getPreferredDownloadsDirectory()` nie jest katalogiem tymczasowym. Nie sprawdzałem
`permissions.request` z prawdziwego panelu popupu (czy panel się zamyka) ani restartu event page. To zostaje dla QA ręcznego.

## Rekomendacja dla T13 (kanał)
- Wariant **(c) z `relatedTarget`** potwierdzony w obu przeglądarkach. Fallback `attachNode` jest zbędny, ale można go zostawić za przełącznikiem.
- **Warunek AC-5.6:** MAIN musi przechwycić intrynsyki na `document_start` i po związaniu nie używać żywych API strony:
  `Reflect.apply`, `EventTarget.prototype.addEventListener/removeEventListener/dispatchEvent`, konstruktor `CustomEvent`,
  getter `CustomEvent.prototype.detail`, getter `MouseEvent.prototype.relatedTarget`, `JSON.parse/stringify`. Dowód: strona,
  która po handshake'u podmieniła `dispatchEvent` i getter `detail`, przeczytała nonce i treść tylko z wiadomości wysłanej/odczytanej
  naiwnie (`node.dispatchEvent(new CustomEvent…)`, `e.detail`). Przy intrynsykach odczytała 0. Proponowany test unit:
  „page patching dispatchEvent/detail after binding sees nothing”.
- Oba światy słuchają na tym samym węźle, więc każdy dostaje też **własne** wiadomości. Potrzebne pole nadawcy (np. `from`) albo inny typ zdarzenia na kierunek.
- Nonce przekazywany w pierwszej wiadomości `init` od ISOLATED po `pds:isolated-ready` sprawdził się przy obu kolejnościach startu.

## Rekomendacja dla T18 (harness)
- `serviceWorker(ext)`: `context.serviceWorkers()`, potem `waitForEvent('serviceworker')`. `stopServiceWorker`: `Target.closeTarget`
  i odpytywanie `Target.getTargets` do zera celów `service_worker`. Nie czekać na zdarzenie Playwrighta `close`.
- `grantOrigin(ext, 'http://127.0.0.1/*')`: `developerPrivate.addHostPermission` na `chrome://extensions`. Samo nie nadaje uprawnienia.
  Pierwszy `permissions.request` z popupu (klik z `userGesture:true`) zwraca `true` bez okna. Testy, które potrzebują uprawnienia bez
  popupu, muszą przejść przez klik *Nagrywaj*.
- `click(selector)` w popupie zawsze przez `Runtime.evaluate({ userGesture: true })`.
- Naraz otwarty jest tylko jeden popup: `triggerAction` dla innej karty zamyka poprzedni.
- **Pobrania (zmiana D11):** zamiast `Browser.setDownloadBehavior({behavior:'allow'})` trzeba użyć `launchPersistentContext(<mkdtemp>)` z `Default/Preferences`
  (`download.default_directory` = podkatalog tymczasowy, `prompt_for_download: false`) i `Browser.setDownloadBehavior({behavior:'default'})`
  globalnie oraz z `browserContextId` strony (to nadpisuje ustawienie Playwrighta). Nazwę pliku bierzemy z komunikatu, plik czytamy z tego katalogu.
- Rejestrowane ścieżki mogą mieć `/` na początku (obie przeglądarki).

## PB-2
**Niepotrzebne.** Plan główny działa (`addHostPermission` + prawdziwy `permissions.request` w geście). Kopia z `host_permissions` nie jest wymagana.
