---
name: pds-browser
description: Uruchamianie Page Debug Snapshot jako rozszerzenia w Chrome i Firefoksie podczas developmentu — ładowanie unpacked / tymczasowe, start przeglądarki z rozszerzeniem na osobnym profilu, przeładowanie po zmianach, szybkie spakowanie do zipa dla testera, diagnoza „rozszerzenie się nie ładuje”. Użyj gdy użytkownik mówi "/pds-browser", "załaduj wtyczkę", "odpal w Chrome/Firefoksie", "jak zainstalować rozszerzenie", "spakuj dla kolegi", "rozszerzenie nie działa po zmianie".
---

# /pds-browser [start | reload | pack | doctor] [chrome | firefox]

Pętla deweloperska dla rozszerzenia. Nie zastępuje `pds-release` (wersje, changelog, podpisy, sklepy) —
to jest „chcę zobaczyć moją zmianę w przeglądarce w 10 sekund”.

## Który katalog ładować

| Target | Katalog | Źródło |
|---|---|---|
| Chrome | `dist/chrome/` | `src/` po `npm run build` |
| Firefox | `dist/firefox/` | `src/` po `npm run build` |

Zawsze ładuj `dist/<target>`, nigdy `src/` (brak manifestu). Zip dla kogoś: `npm run pack` (patrz niżej).

## `start` — przeglądarka z rozszerzeniem na tymczasowym profilu

```powershell
npm run dev:chrome  [-- --url https://example.com]
npm run dev:firefox [-- --url https://example.com]
# Windows, nakładka: powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Browser chrome|firefox [-Url ...]
```
Oba robią `build` i wołają `scripts/dev-browser.mjs` → `web-ext run` (tymczasowy profil, auto-reload po zmianie).
- **Chrome**: web-ext ładuje rozszerzenie przez CDP (`Extensions.loadUnpacked`), więc blokada `--load-extension`
  w Chrome ≥ 137 nie dotyczy. Binarkę wybiera `PDS_CHROMIUM_BINARY` (bez niej web-ext może wziąć Canary); gdy
  domyślny Chrome nie wystartuje, skrypt raz próbuje Chromium z Playwright.
- **Firefox**: `web-ext run` na `dist/firefox`, świeży profil (po wymuszonym zamknięciu mogą zostać `%TEMP%irefox-profile*`).

Ręcznie: Chrome `chrome://extensions` → Tryb dewelopera → Załaduj rozpakowane → `dist/chrome`. Firefox
`about:debugging#/runtime/this-firefox` → Załaduj tymczasowy dodatek → `dist/firefox/manifest.json`.
Dodatek tymczasowy w Firefoksie **znika po restarcie** — to normalne, nie błąd.

## `reload` — po zmianie kodu

**Zmiana w `src/page` (recorder, hooki, kanał, collector) = najpierw `npm run gen`**, potem `npm run build`. Przeglądarka ładuje
wygenerowane `src/content/*.js` (trafiają do `dist/`), nie moduły z `src/page`; bez `gen` zmiana jest niewidoczna, a `npm run gen -- --check`
i test `gen-content` padają. Pętla: edycja `src/page` → `npm run gen` → `npm run build` (albo `dev:*` robi build) → odśwież rozszerzenie → przeładuj kartę.

| Co zmieniłeś | Chrome | Firefox |
|---|---|---|
| popup, skrypty strony | zamknij/otwórz popup + przeładuj stronę | `web-ext run` przeładowuje sam; ręcznie: about:debugging → „Przeładuj” |
| `manifest.json`, tło (E1+) | `chrome://extensions` → ⟳ | about:debugging → „Przeładuj” (web-ext też) |
| `dist/` nieprzebudowany | `npm run build` | `npm run build` |

Błędy tła: Chrome — karta rozszerzenia → „Service worker” / „Errors”; Firefox — about:debugging → „Zbadaj”
przy dodatku (konsola event page). Konsola popupu i konsola strony to dwa inne miejsca.

## `pack` — zip dla testera (nie release)

```powershell
npm run pack
# albo: powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Pack -Browser chrome|firefox   (= npm run pack)
```
Tworzy `dist/page-debug-snapshot-<target>-<wersja>.zip` dla obu targetów (ignorowane przez git); w zipie tylko
pliki osiągalne z manifestu.
- Odbiorca Chrome: rozpakuj → `chrome://extensions` → tryb dewelopera → Załaduj rozpakowane.
- Odbiorca Firefox: **nie rozpakowuj** → about:debugging → Załaduj tymczasowy dodatek → wskaż zip.
  Zniknie po restarcie Firefoksa. Instalacja na stałe wymaga podpisu AMO → E5 / `pds-release`.

## `doctor` — gdy nie działa

Zatrzymaj się na pierwszym trafieniu:
1. `manifest.json` parsuje się (`node -e "JSON.parse(require('fs').readFileSync('<ścieżka>'))"`), `manifest_version: 3`,
   każda ścieżka z manifestu istnieje. Firefox: `npx web-ext lint --source-dir <katalog>`.
2. Wersja: Chrome ≥ 121 (`minimum_chrome_version`) (`chrome://version`), Firefox ≥ 128 (`about:support`) — oba przez `world: 'MAIN'`.
3. Karta testowa to `http(s)://`. Na `chrome://`, `about:`, sklepach i `file://` (bez zgody) rozszerzenie nie ma prawa
   działać — popup ma to komunikować po polsku.
4. Firefox: host permissions w MV3 są **opcjonalne** — jeśli rozszerzenie nic nie robi na stronie, sprawdź
   about:addons → dodatek → Uprawnienia → czy dostęp do witryny jest przyznany (E1+ pyta o to z popupu).
5. Zmiana nie widoczna → `reload` wyżej.
6. Node: narzędzia wymagają wersji z `engines` w `package.json` (`^22.22.2 || ^24.15.0 || >=26`). nvm-windows: po `nvm use`
   sprawdź `(Get-Item "C:\Program Files\nodejs").Target` — bez uprawnień admina symlink się nie przełącza.

## Czego ten skill nie robi
- Nie podbija wersji, nie pisze CHANGELOG, nie podpisuje `.crx`/`.xpi`, nie wgrywa do CWS/AMO — `pds-release` / E5.
- Nie dotyka `page-debug-extension.pem`.
- Nie uruchamia agentów.
