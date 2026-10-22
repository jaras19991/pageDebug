# Page Debug Snapshot

Rozszerzenie przeglądarkowe (MV3, Chrome i Firefox z jednej bazy kodu). Po kliknięciu ikony zapisuje
do jednego pliku `.json` dane diagnostyczne bieżącej karty (środowisko, DOM, wydajność, storage, logi konsoli,
błędy, zapytania sieciowe), żeby zgłaszający mógł przekazać je developerowi. Niczego nie wysyła do sieci.
Instrukcja dla osoby zgłaszającej: [docs/INSTRUKCJA-ZGLASZAJACEGO.md](docs/INSTRUKCJA-ZGLASZAJACEGO.md).

## Szybki start

Wymagany Node: `^22.22.2 || ^24.15.0 || >=26.0.0` (pole `engines` w `package.json`; rozwijane na Node 26).

```
git clone <repo-url> && cd <repo>
npm ci
npx playwright install chromium     # jednorazowo, dla testów e2e
npm run lint && npm test && npm run test:e2e
npm run build
```

Wszystkie komendy z katalogu głównego repo:

| Komenda | Co robi |
|---|---|
| `npm run build` | składa `dist/chrome/` i `dist/firefox/` od zera (manifesty z `src/manifest.*.json`) |
| `npm run pack` | build + po jednym `dist/page-debug-snapshot-<target>-<wersja>.zip` na target |
| `npm run icons` | generuje `src/icons/icon{16,48,128}.png` (patrz „Ikony”) |
| `npm run lint` | build + `eslint` + `web-ext lint` na `dist/firefox` (2 warnings o `data_collection_permissions` są znane) |
| `npm test` | vitest + jsdom; bez przeglądarki i sieci |
| `npm run test:e2e` | Playwright, Chromium z `dist/chrome`, headless; `PDS_E2E_HEADED=1` pokazuje okno |
| `npm run dev:chrome` / `npm run dev:firefox` | build + przeglądarka na tymczasowym profilu z załadowanym rozszerzeniem (przez `web-ext`) |
| `npm run check:history` | sprawdza, że w historii gita nie ma `*.pem`, `*.crx`, `*.xpi`, `*.zip`, logo ani prawdziwych snapshotów |
| `npm run fixtures` | lokalny serwer stron testowych z `tests/fixtures/pages` |

`npm run dev:chrome` używa domyślnie Chrome znalezionego przez `web-ext` (bywa to Canary). Konkretną binarkę
wskaż zmienną `PDS_CHROMIUM_BINARY`:

```
PDS_CHROMIUM_BINARY="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run dev:chrome   # Git Bash
$env:PDS_CHROMIUM_BINARY = "C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run dev:chrome   # PowerShell
```

Adres startowy: `npm run dev:chrome -- --url http://127.0.0.1:8080/basic.html`. Na Windows jest też nakładka
`scripts/dev-browser.ps1 -Browser chrome|firefox [-Url ...]`; `-Pack` robi to samo co `npm run pack`.

### Ręczne ładowanie rozszerzenia

- **Chrome:** `npm run build`, potem `chrome://extensions` → włącz „Tryb programisty” → „Załaduj rozpakowane” → wskaż `dist/chrome`.
  Po zmianie kodu: `npm run build` i przycisk odświeżania przy rozszerzeniu.
- **Firefox:** `npm run build`, potem `about:debugging` → „Ten Firefox” → „Załaduj tymczasowy dodatek” → wskaż
  `dist/firefox/manifest.json` (albo zip z `npm run pack`, nierozpakowany). Dodatek tymczasowy **znika po restarcie przeglądarki**
  — to normalne; trwała instalacja wymaga podpisu AMO (E5).

Dla testera: `npm run pack` i wysłać zip właściwego targetu (Chrome: rozpakować i „Załaduj rozpakowane”; Firefox: nie rozpakowywać).

Klucz `.pem` trzymamy poza repo (jest w `.gitignore`; nie kopiujemy go, nie commitujemy). Prawdziwych snapshotów
(`page-debug-snapshot-*.json`) też nie commitujemy.

## Jak to działa

```
klik ikony  ->  popup (src/popup)  ->  scripting.executeScript, world MAIN  ->  strona
                  |                          wstrzykuje src/page/page-debug-snapshot.js
                  |                          i uruchamia zrzut na stronie
                  v                                   |
        komunikat PL z messages.js  <-- wynik / błąd --+--> plik page-debug-snapshot-<timestamp>.json
```

W E0 nie ma service workera ani content scriptów: całość dzieje się po kliknięciu, w popupie, na bieżącej karcie
(dzięki `activeTab`). Skrypt zbiera dane dopiero od wstrzyknięcia — błędy i zapytania sprzed kliknięcia nie trafiają
do paczki (zmieni to E1). Popup pokazuje sukces tylko wtedy, gdy zrzut faktycznie powstał; wynik to jeden z pięciu
rodzajów (`success`, `restricted`, `fileAccess`, `noTab`, `failed`) ze słownika `src/popup/messages.js`.
Szczegóły techniczne i uzasadnienia decyzji: `docs/epics/E0/design.md`.

## Struktura repo

```
src/
  manifest.base.json, manifest.chrome.json, manifest.firefox.json   wspólna baza + różnice targetów
  popup/       popup.html, popup.js, snapshot-tab.js, target.js, run-in-page.js, messages.js
  page/        page-debug-snapshot.js   skrypt wstrzykiwany na stronę
  icons/       icon16/48/128.png        generowane przez npm run icons
  standalone/  console-snapshot.js      wersja do wklejenia w konsolę; nie trafia do dist
scripts/       build.mjs, pack.mjs, icons.mjs, dev-browser.mjs/.ps1, check-repo.mjs, lib/
tests/         unit/ (vitest), e2e/ (Playwright + helpers/), fixtures/pages/ (strony testowe)
dist/          wynik build/pack (ignorowany)
docs/          BACKLOG.md, snapshot-schema.md, INSTRUKCJA-ZGLASZAJACEGO.md, epics/E*/
```

## Konfiguracja developerska

- Zmienne: `PDS_CHROMIUM_BINARY` (binarka Chrome/Chromium dla `dev:chrome`), `PDS_E2E_HEADED=1` (e2e z widocznym oknem).
- e2e ładuje rozszerzenie z `dist/chrome`, nie ze źródeł; `globalSetup` buduje projekt, `globalTeardown` failuje, gdy
  testy zmieniły `git status`. Popup nie jest w Playwright zwykłą stroną — steruje nim `openPopupFor` z `tests/e2e/helpers/launch.js`
  (więcej: skill `extension-testing`).
- Firefox nie ma automatycznego e2e w E0: `web-ext lint` + ręczne QA przez `npm run dev:firefox`.
- Nowa logika = test najpierw. Konwencje: `CLAUDE.md`.

## Viewer / MCP

Nie istnieją jeszcze (planowane w kolejnych epikach, patrz `docs/BACKLOG.md`).

## Uprawnienia

- `activeTab` — dostęp do bieżącej karty tylko po kliknięciu ikony rozszerzenia; daje adres strony i prawo do uruchomienia zrzutu.
- `scripting` — uruchomienie skryptu zbierającego dane na bieżącej stronie (`scripting.executeScript` w świecie strony).

Rozszerzenie nie prosi o dostęp do wszystkich witryn i niczego nie wysyła do sieci.

Wersje do formularzy sklepów (Chrome Web Store, AMO):

- `activeTab`
  - PL: Po kliknięciu ikony rozszerzenie uzyskuje dostęp wyłącznie do bieżącej karty, aby zapisać z niej plik diagnostyczny; bez kliknięcia nie ma dostępu do żadnej strony.
  - EN: When the user clicks the toolbar icon, the extension gets access to the current tab only, to save a diagnostic file from it; without that click it cannot access any website.
- `scripting`
  - PL: Uruchamia na bieżącej karcie, po kliknięciu użytkownika, dołączony do rozszerzenia skrypt, który zbiera błędy, logi konsoli, zapytania sieciowe i strukturę strony do pliku zapisywanego lokalnie.
  - EN: After the user's click, runs a script bundled with the extension on the current tab to gather errors, console logs, network requests and page structure into a locally saved file.
- Zdalny kod: nie. Cały JavaScript jest w paczce; nic nie jest pobierane ani wykonywane z sieci (EN: "No, I am not using remote code").

> Identyfikator dodatku Firefox (`browser_specific_settings.gecko.id` w `src/manifest.firefox.json`)
> to `{799eb178-df9a-41bb-9775-8fc8aff45926}` (GUID, bez domeny — projekt jest niezależny od organizacji). Można zmienić bez kosztu do pierwszego `web-ext sign` (E5); potem zmiana = nowy dodatek.

## Ikony

Ikony generuje `npm run icons` (skrypt `scripts/icons.mjs`, bez zależności natywnych); nie edytuj PNG ręcznie.
Test `tests/unit/icons-script.test.js` pilnuje, by `src/icons/*.png` były identyczne z wynikiem skryptu.

## Jak dodać nowe pole do paczki

1. Napisz test (`tests/unit/page-debug-snapshot.test.js`), potem zmień `src/page/page-debug-snapshot.js`.
2. Zmiana łamiąca (usunięcie/zmiana nazwy lub typu pola) = podbicie `schemaVersion`; pole opcjonalne = tylko wpis w dokumentacji.
   Reguły: skill `snapshot-schema`.
3. Opisz pole w [docs/snapshot-schema.md](docs/snapshot-schema.md) i dopisz wpis do [CHANGELOG.md](CHANGELOG.md).
4. Jeśli pole może zawierać dane użytkownika — redakcja (skill `privacy-redaction`, E3). Test e2e `smoke` pilnuje listy kluczy najwyższego poziomu.

## Troubleshooting

- **Popup: „Na tej stronie nie da się zapisać paczki.”** — karta to strona specjalna (`chrome://`, `about:`, sklep z rozszerzeniami, nowa karta).
  Otwórz zwykłą stronę `http(s)://`.
- **`file://` w Chrome** — wymaga zgody: `chrome://extensions` → Szczegóły → „Zezwalaj na dostęp do adresów URL plików”. Bez niej popup pokazuje instrukcję.
- **Firefox: dodatek zniknął** — tymczasowy dodatek znika po restarcie; załaduj ponownie (`npm run dev:firefox`).
  W Firefoksie ikona bywa pod „puzzlem” (panel rozszerzeń), nie na pasku.
- **Chrome: ikona niewidoczna** — jest pod „puzzlem”; przypnij ją.
- **`dev:chrome` otwiera zły Chrome (np. Canary)** — ustaw `PDS_CHROMIUM_BINARY`. Pasek „nieobsługiwana flaga `--disable-blink-features=AutomationControlled`” pochodzi z `web-ext` i jest nieszkodliwy.
- **Zmiana nie jest widoczna** — `dist/` jest nieprzebudowany: `npm run build` i odśwież rozszerzenie.
- **Rozszerzenie się nie ładuje** — sprawdź, czy `dist/<target>/manifest.json` istnieje i `npx web-ext lint --source-dir dist/firefox` nie ma errors.
- **`npm run test:e2e` nie startuje przeglądarki** — `npx playwright install chromium`. Po przerwanych `dev:firefox` mogą zostać profile `%TEMP%\firefox-profile*` — można usunąć.
- **Wersja Node** — komendy wymagają wersji z `engines`; w nvm-windows po `nvm use` sprawdź, czy `node -v` pokazuje właściwą.
