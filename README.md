# pageDebug

## Uprawnienia

- `activeTab` — dostęp do bieżącej karty tylko po kliknięciu ikony rozszerzenia; daje adres strony i prawo do uruchomienia zrzutu.
- `scripting` — uruchomienie skryptu zbierającego dane na bieżącej stronie (`scripting.executeScript` w świecie strony).

Rozszerzenie nie prosi o dostęp do wszystkich witryn i niczego nie wysyła do sieci.

> Identyfikator dodatku Firefox (`browser_specific_settings.gecko.id` w `src/manifest.firefox.json`)
> to `{799eb178-df9a-41bb-9775-8fc8aff45926}` (GUID, bez domeny — projekt jest niezależny od organizacji). Można zmienić bez kosztu do pierwszego `web-ext sign` (E5); potem zmiana = nowy dodatek.

## Ikony

Ikony generuje `npm run icons` (skrypt `scripts/icons.mjs`, bez zależności natywnych); nie edytuj PNG ręcznie.
Test `tests/unit/icons-script.test.js` pilnuje, by `src/icons/*.png` były identyczne z wynikiem skryptu.
