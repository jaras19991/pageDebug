# pageDebug

## Uprawnienia

- `activeTab` — dostęp do bieżącej karty tylko po kliknięciu ikony rozszerzenia; daje adres strony i prawo do uruchomienia zrzutu.
- `scripting` — uruchomienie skryptu zbierającego dane na bieżącej stronie (`scripting.executeScript` w świecie strony).

Rozszerzenie nie prosi o dostęp do wszystkich witryn i niczego nie wysyła do sieci.

> Identyfikator dodatku Firefox (`browser_specific_settings.gecko.id` w `src/manifest.firefox.json`)
> to na razie `page-debug-snapshot@agora.pl` — wartość tymczasowa, do podmiany przed pierwszą publikacją w AMO (E5).
