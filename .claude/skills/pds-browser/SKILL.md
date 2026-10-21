---
name: pds-browser
description: Uruchamianie Page Debug Snapshot jako rozszerzenia w Chrome i Firefoksie podczas developmentu — ładowanie unpacked / tymczasowe, start przeglądarki z rozszerzeniem na osobnym profilu, przeładowanie po zmianach, szybkie spakowanie do zipa dla testera, diagnoza „rozszerzenie się nie ładuje”. Użyj gdy użytkownik mówi "/pds-browser", "załaduj wtyczkę", "odpal w Chrome/Firefoksie", "jak zainstalować rozszerzenie", "spakuj dla kolegi", "rozszerzenie nie działa po zmianie".
---

# /pds-browser [start | reload | pack | doctor] [chrome | firefox]

Pętla deweloperska dla rozszerzenia. Nie zastępuje `pds-release` (wersje, changelog, podpisy, sklepy) —
to jest „chcę zobaczyć moją zmianę w przeglądarce w 10 sekund”.

## Który katalog ładować

| Stan repo | Chrome | Firefox |
|---|---|---|
| przed E0 (brak `npm run build`) | `page-debug-extension/` | `page-debug-extension/` (bez `gecko.id` Firefox pozwoli tylko na instalację tymczasową — to OK) |
| po E0 | `dist/chrome/` | `dist/firefox/` |

`scripts/dev-browser.ps1` wybiera to sam. Zip dla kogoś zawsze z `dist/<target>`, nigdy z katalogu z `node_modules`.

## `start` — przeglądarka z rozszerzeniem na osobnym profilu

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Browser chrome  [-Url https://example.com]
powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Browser firefox [-Url https://example.com]
```
- **Chrome**: profil `%LOCALAPPDATA%\pds-dev-profile-chrome`, `--load-extension`, otwiera `chrome://extensions` i URL.
- **Firefox**: jeśli `web-ext` jest zainstalowany (`npx web-ext --version`), skrypt woła
  `web-ext run --source-dir <katalog> --start-url <url>` — świeży profil, rozszerzenie załadowane,
  **auto-reload po zmianie pliku**. Bez `web-ext`: otwiera Firefoksa na `about:debugging#/runtime/this-firefox`
  i wypisuje instrukcję „Załaduj tymczasowy dodatek → wskaż `manifest.json`”.

Ręcznie: Chrome `chrome://extensions` → Tryb dewelopera → Załaduj rozpakowane. Firefox
`about:debugging#/runtime/this-firefox` → Załaduj tymczasowy dodatek → wybierz `manifest.json`.
Dodatek tymczasowy w Firefoksie **znika po restarcie** — to normalne, nie błąd.

## `reload` — po zmianie kodu

| Co zmieniłeś | Chrome | Firefox |
|---|---|---|
| popup, skrypty strony | zamknij/otwórz popup + przeładuj stronę | `web-ext run` przeładowuje sam; ręcznie: about:debugging → „Przeładuj” |
| `manifest.json`, tło (E1+) | `chrome://extensions` → ⟳ | about:debugging → „Przeładuj” (web-ext też) |
| `dist/` nieprzebudowany | `npm run build` | `npm run build` |

Błędy tła: Chrome — karta rozszerzenia → „Service worker” / „Errors”; Firefox — about:debugging → „Zbadaj”
przy dodatku (konsola event page). Konsola popupu i konsola strony to dwa inne miejsca.

## `pack` — zip dla testera (nie release)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-browser.ps1 -Pack [-Browser chrome|firefox]
```
Tworzy `page-debug-snapshot-dev-<target>-<yyyyMMdd-HHmm>.zip` w katalogu głównym (ignorowany przez git),
bez `node_modules`, `*.zip`, `*.pem`, `logo*.png`, `package*.json`.
- Odbiorca Chrome: rozpakuj → `chrome://extensions` → tryb dewelopera → Załaduj rozpakowane.
- Odbiorca Firefox: **nie rozpakowuj** → about:debugging → Załaduj tymczasowy dodatek → wskaż zip.
  Zniknie po restarcie Firefoksa. Instalacja na stałe wymaga podpisu AMO → E5 / `pds-release`.

## `doctor` — gdy nie działa

Zatrzymaj się na pierwszym trafieniu:
1. `manifest.json` parsuje się (`node -e "JSON.parse(require('fs').readFileSync('<ścieżka>'))"`), `manifest_version: 3`,
   każda ścieżka z manifestu istnieje. Firefox: `npx web-ext lint --source-dir <katalog>`.
2. Wersja: Chrome ≥ 102 (`chrome://version`), Firefox ≥ 128 (`about:support`) — oba przez `world: 'MAIN'`.
3. Karta testowa to `http(s)://`. Na `chrome://`, `about:`, sklepach i `file://` (bez zgody) rozszerzenie nie ma prawa
   działać — popup ma to komunikować po polsku.
4. Firefox: host permissions w MV3 są **opcjonalne** — jeśli rozszerzenie nic nie robi na stronie, sprawdź
   about:addons → dodatek → Uprawnienia → czy dostęp do witryny jest przyznany (E1+ pyta o to z popupu).
5. Zmiana nie widoczna → `reload` wyżej.
6. Node: narzędzia (vitest, Playwright, web-ext, build) wymagają **Node ≥ 20 LTS**. nvm-windows: po `nvm use`
   sprawdź `(Get-Item "C:\Program Files\nodejs").Target` — bez uprawnień admina symlink się nie przełącza.

## Czego ten skill nie robi
- Nie podbija wersji, nie pisze CHANGELOG, nie podpisuje `.crx`/`.xpi`, nie wgrywa do CWS/AMO — `pds-release` / E5.
- Nie dotyka `page-debug-extension.pem`.
- Nie uruchamia agentów.
