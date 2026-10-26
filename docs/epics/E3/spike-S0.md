# E3-S0 — spike: dopasowanie maski do zrzutu i API Firefoksa

**Wynik: D6 działa w obu przeglądarkach. Skala `szerokośćObrazu / innerWidth` wystarcza (TAK), a margines `max(2 px CSS, 8 px obrazu)`
wystarcza (TAK). Potrzebne są dwie poprawki w treści zadań (nie w architekturze). (1) IN1a: przesunięcie pól w iframe musi
uwzględniać **padding** ramki, nie tylko `clientLeft/Top`. (2) IN1a/T8: w Firefoksie `openOrClosedShadowRoot` jest **getterem**, a nie
metodą. Wykrywanie przez `typeof Element.prototype.openOrClosedShadowRoot` rzuca `TypeError`.**

Data: 2026-10-26. Chromium 156.0.8078.4 (Playwright 1.64.1, `channel: 'chromium'`, nowy headless, Linux/WSL).
Firefox 158.0.1 (web-ext 10.8.0, headless, Marionette, Windows 11).

Skrypt: `node tests/e2e/spike-e3/run.spike.mjs` (Chromium: S1 w 4 wariantach i S2) oraz `node tests/e2e/spike-e3/run.spike.mjs --firefox [--dpr2]`
(S3 i S1 w Firefoksie). Rozszerzenie `tests/e2e/spike-e3/ext/` (MV3, `scripting`, `tabs`, `host_permissions: <all_urls>`) jest kopiowane do katalogu
tymczasowego. Kopia dla Firefoksa dostaje `background.scripts` i `gecko.id`, a `<all_urls>` nadaje `ExtensionPermissions` (jak w E2-T0).
Spike używa `<all_urls>` zamiast `activeTab`, żeby nie otwierać popupu. Ścieżka `activeTab` → `captureVisibleTab` jest potwierdzona w E2-T0.
Geometria maski nie zależy od uprawnienia. `src/`, `dist/` i manifesty nie były dotykane.

Strona testowa (serwer w skrypcie, `127.0.0.1:0`) ma tło niebieskie i 7 pól w kolorze `rgb(230,20,20)` z czarnym tekstem:
`input` (numer karty), `textarea`, `input` w przewiniętym kontenerze (`overflow:auto`, `scrollTop` 220), `input` z `position: fixed`,
`input` w same-origin iframe (ramka z `border: 6px` i `padding: 4px`), `div contenteditable`, `input` w **zamkniętym** shadow root.
Strona jest przewinięta o 400 px.

Przebieg pomiaru w tle (SW / event page): R1 = `executeScript(collectFieldRects)` w ISOLATED → `captureVisibleTab` (JPEG 60) → R2 →
`createImageBitmap` + `OffscreenCanvas`. Dla każdego pola: bbox pikseli w kolorze pola vs prostokąt × skala (błąd krawędzi w px obrazu).
Potem `fillRect('#9e9e9e')` na sumie R1 ∪ R2 z marginesem 0 i z marginesem D6 → `convertToBlob` JPEG 0,6 → dekodowanie →
liczba pozostałych pikseli w kolorze pola w **całym** obrazie, odsetek pikseli odbiegających o > 24 od szarości (w prostokącie pola)
i najciemniejsza luminancja w prostokącie (tusz tekstu < 100).

## Wyniki

| Wariant | Przeglądarka | `innerWidth`×`innerHeight`, DPR | Obraz | Skala X / Y | Najgorszy błąd krawędzi | Margines 0: kolor pola / niejednolitość | Margines D6 (8 px): kolor pola / niejednolitość / min. luminancja | Werdykt |
|---|---|---|---|---|---|---|---|---|
| DPR 1 | Chromium 156 | 1280×720, 1 | 1280×720 | 1 / 1 | 0 px | 0 / 5,7% | 0 / 0% / 157 | **PASS** |
| zoom 125% (`tabs.setZoom`) | Chromium 156 | 1024×576, 1,25 | 1280×720 | 1,25 / 1,25 | 1 px | 0 / 4,5% | 0 / 0% / 157 | **PASS** |
| DPR 2 (prawdziwy, `--force-device-scale-factor=2`) | Chromium 156 | 1280×713, 2 | 2560×1426 | 2 / 2 | 0 px | 0 / 3,0% | 0 / 0,02% / 157 | **PASS** |
| DPR 2 + zoom 125% | Chromium 156 | 1024×570, 2,5 | 2560×1426 | 2,5 / 2,5018 (różnica 0,07%) | 1 px | 0 / 3,1% | 0 / 0,005% / 157 | **PASS** |
| zoom 100% | Firefox 158 | 1280×715, 1 | 1280×715 | 1 / 1 | 1 px | 0 / 8,0% | 0 / 0% / 157 | **PASS** |
| zoom 125% | Firefox 158 | 1024×572, 1,25 | 1280×715 | 1,25 / 1,25 | 1 px | 0 / 4,5% | 0 / 0% / 157 | **PASS** |
| DPR 2 (`layout.css.devPixelsPerPx=2`) | Firefox 158 | 1280×715, 2 | 2560×1430 | 2 / 2 | 0 px | 0 / 3,0% | 0 / 0,02% / 157 | **PASS** |
| DPR 2 + zoom 125% | Firefox 158 | 1024×572, 2,5 | 2560×1430 | 2,5 / 2,5 | 1 px | 0 / 2,4% | 0 / 0,01% / 157 | **PASS** |

Kryterium PASS: wszystkie 7 pól znalezione, błąd krawędzi ≤ 2 px obrazu, różnica skali X/Y ≤ 2%, R1 i R2 mają ten sam viewport, a po masce D6
zostaje 0 pikseli w kolorze pola i ≤ 2% niejednolitości.
We wszystkich przebiegach R1 = R2 (`scrollX/Y`, `innerWidth/Height`), `frames.sameOrigin` = 1, `frames.crossOrigin` = 0.

| # | Punkt | Chromium 156 | Firefox 158 |
|---|---|---|---|
| S1 | maska pokrywa pola przy DPR 1, DPR 2, zoomie 125%, `fixed`, przewiniętym kontenerze, przewiniętej stronie, iframe, `contenteditable`, zamkniętym shadow | **PASS** (4/4 warianty) | **PASS** (4/4 warianty) |
| S2 | zamknięty shadow root w ISOLATED | **PASS** przez `chrome.dom.openOrClosedShadowRoot(el)`. `Element.prototype.openOrClosedShadowRoot`: **brak** | n.d. (`chrome.dom` w content scripcie Firefoksa: **brak**) |
| S3 | `CompressionStream('deflate-raw')` w tle (round trip z `DecompressionStream`) | PASS (20 000 → 71 B) | **PASS** (20 000 → 141 B) w event page |
| S3 | `OffscreenCanvas.fillRect` + `convertToBlob({type:'image/jpeg'})` w tle | PASS | **PASS** w event page (także na pełnym zrzucie 2560×1430) |
| S3 | `openOrClosedShadowRoot` w content scripcie | n.d. | **PASS**, ale to **getter** na `Element.prototype` (`el.openOrClosedShadowRoot`, nie `el.openOrClosedShadowRoot()`) |
| S3 | `getBoundingClientRect` w same-origin iframe z content scriptu ramki nadrzędnej (`contentDocument`) | PASS | **PASS** (błąd ≤ 1 px) |

## Werdykty

- **Skala z `szerokośćObrazu / innerWidth` wystarcza: TAK.** Pokrywa DPR 1, DPR 2, zoom 125% i DPR 2 + zoom (ułamkowy DPR 2,5) w obu
  przeglądarkach. Błąd krawędzi wynosi 0–1 px obrazu. `getBoundingClientRect` w ISOLATED i `innerWidth` są w tych samych jednostkach CSS
  także przy zoomie. Największa różnica proporcji X/Y to 0,07% (zaokrąglenie `innerHeight` przy DPR 2,5), więc próg 2% w `planMask` ma duży zapas.
- **Margines `max(2 px CSS, 8 px obrazu)` wystarcza: TAK.** Po masce D6 i ponownym kodowaniu JPEG 60 nie zostaje żaden piksel w kolorze pola.
  Wnętrze prostokąta jest jednolite (≤ 0,02% odchyleń, min. luminancja 157, czyli brak tuszu). **Margines jest potrzebny:** bez niego też nie
  zostaje kolor pola, ale 2,4–8% pikseli przy krawędziach odbiega od szarości (dzwonienie bloków 8×8 i podpróbkowanie chrominancji). To nie jest
  treść pola, tylko nie spełnia kryterium ≤ 2%.
- **`chrome.dom.openOrClosedShadowRoot`: TAK w Chrome (ISOLATED), NIE w Firefoksie.** **`Element.prototype.openOrClosedShadowRoot`: TAK w
  Firefoksie (getter, Xray), NIE w Chrome.** Wykrywanie funkcji rozdziela je jednoznacznie, bez UA.
- **`OffscreenCanvas` (`fillRect`, `convertToBlob`, `createImageBitmap`) w tle: TAK w obu** (SW Chrome, event page Firefoksa).
- **`CompressionStream('deflate-raw')` w tle: TAK w obu** (dla D7).

## Wpływ na zadania

- **IN1a (`collectFieldRects`) — dwie zmiany:**
  1. Przesunięcie dla pól w same-origin iframe = `rect ramki + clientLeft/Top + padding-left/top` (content box, jak w tekście D6).
     Tekst IN1a mówi tylko o „`clientLeft/Top` + rect ramki”. Bez paddingu błąd wynosi `padding × skala`: zmierzono 4 / 5 / 8 / 10 px obrazu przy
     paddingu 4 px CSS i skali 1 / 1,25 / 2 / 2,5. Przy skali ≥ 2 przekracza to margines 8 px i zostawia pasek pola na zrzucie. Padding brać
     z `getComputedStyle(frame)` w ISOLATED. Proponuję test w `field-rects.test.js`: `iframe with border and padding → offset by content box`.
  2. Domyślny `openShadowRoot` (wstrzykiwany przez T8/most): `chrome.dom?.openOrClosedShadowRoot` → `(el) => chrome.dom.openOrClosedShadowRoot(el)`.
     Jeśli tego nie ma, a `'openOrClosedShadowRoot' in Element.prototype` → `(el) => el.openOrClosedShadowRoot` (**odczyt właściwości**).
     W przeciwnym razie `(el) => el.shadowRoot`. **Nie** używać `typeof Element.prototype.openOrClosedShadowRoot` ani
     `Element.prototype.openOrClosedShadowRoot.call(el)`: odczyt gettera na samym prototypie rzuca `TypeError` („called on an object that does not
     implement interface Element”). W spike'u ten błąd wywrócił cały `collectFieldRects`, a w produkcji dałby fail-closed (brak zrzutu) w każdym
     zapisie w Firefoksie. Tabela „Chrome vs Firefox” w design.md już opisuje to jako `el.openOrClosedShadowRoot` (Xray) i to jest poprawne.
- **IN1b (`planMask`, `maskScreenshot`):** bez zmian. Skala `imageWidth / innerWidth`, margines `max(2 × skala, 8)`, przycięcie do obrazu i próg 2%
  potwierdzone. Zaokrąglanie: `floor` lewej/górnej krawędzi i `ceil` prawej/dolnej (tak liczył spike) przy ułamkowej skali 1,25 i 2,5.
- **IN1c (zapis w tle):** bez zmian. Przepływ R1 → capture → R2 działa, a viewport R1 = R2 na stronie statycznej. Ponowne kodowanie na zamaskowanej
  bitmapie daje 12–82 KB (JPEG 60, 1280×720 do 2560×1430), więc mieści się w `fitJpeg`.
- **D6: nie wymaga zmian w architekturze.** Zmienia się tylko tekst IN1a (punkt 1 i 2 wyżej).

## Czego nie sprawdzono (QA ręczne)

- **Pinch-zoom** (gest na touchpadzie, `visualViewport.scale ≠ 1`). Spike nie testował tego wariantu. `getBoundingClientRect` jest liczony względem
  layout viewportu, a zrzut pokazuje visual viewport, więc maska by się rozjechała. **Propozycja (fail-closed, bez zmiany architektury):**
  `collectFieldRects` zwraca `viewport.vvScale`, a `planMask` przy `vvScale ≠ 1` (±1%) zwraca `null` → `mask-failed`. Do decyzji architekta przed IN1b/IN1c.
- Iframe z transformacją CSS (`transform: scale(...)` na ramce lub przodku). Prostokąty z wnętrza ramki nie uwzględniają transformacji.
  To przypadek brzegowy, nieobjęty pytaniem 2.
- Fizyczny ekran HiDPI i skalowanie Windows (sprawdzony tylko `--force-device-scale-factor=2` w headless i `layout.css.devPixelsPerPx=2`).
  Klasyczne paski przewijania (headless Chromium ma `--hide-scrollbars`, Firefox headless ma paski nakładkowe). `innerWidth` obejmuje pasek,
  zrzut też, więc proporcja powinna się zgadzać. Sprawdzić w FQ-E3 na Windows z widocznym paskiem.
- Firefox z prawdziwym `activeTab` (klik ikony) i maską w jednym przebiegu. Oba elementy są sprawdzone osobno (E2-T0 i ten spike).

## Uwagi o środowisku (dla kolejnych spike'ów i QA w WSL)

- Linuxowy Chromium z `~/.cache/ms-playwright/chromium-1248` nie startował bez `libnspr4`, `libnss3` i `libasound2`. Biblioteki zostały pobrane przez
  `apt-get download` i rozpakowane do katalogu tymczasowego (`LD_LIBRARY_PATH`), bez instalacji w systemie. Trzeba też ustawić
  `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` i `XDG_CONFIG_HOME/XDG_CACHE_HOME`. Sandbox Bash blokuje `socket()` (process singleton
  Chromium), więc przeglądarka uruchamia się tylko poza sandboxem.
- Firefox działał przez `node.exe` z Windows (jak E2-T0), bo w WSL nie ma Firefoksa, a interop z Windows jest zablokowany w sandboxie.
