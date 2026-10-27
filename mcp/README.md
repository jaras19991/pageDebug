# page-debug-mcp — paczki Page Debug Snapshot dla agentów AI

Lokalny serwer [MCP](https://modelcontextprotocol.io) (stdio), który udostępnia agentowi (Claude Code, Cursor) paczki
zapisane przez rozszerzenie Page Debug Snapshot. Wskazujesz katalog z paczkami (`*.zip` z rozszerzenia albo `*.json`
z wersji 1–4), a agent może zapytać np. „jakie błędy są w ostatniej paczce?”.

- **Wymagania:** Node.js ≥ 20, klon tego repozytorium. Serwer nie ma zależności npm — nie trzeba `npm install`.
- **Serwer tylko czyta.** Nie zapisuje, nie zmienia i nie usuwa plików, nie otwiera połączeń sieciowych, nie czyta nic
  poza wskazanym katalogiem (identyfikator ze ścieżką, `..` albo dowiązanie symboliczne jest odrzucany).
- Dane w paczkach v4 są już zredagowane przez rozszerzenie (hasła, tokeny, e-maile zamaskowane) — serwer pokazuje je bez zmian. Paczki v1–v3 powstały przed automatyczną redakcją i mogą zawierać jawne dane; serwer ostrzega o tym w `warnings` (`list_snapshots`) i w nocie nad `get_summary`.

## Uruchomienie

```
node <repo>/mcp/server.js <katalog-z-paczkami>
```

Zamiast argumentu można ustawić zmienną `PDS_SNAPSHOTS_DIR`. Serwer rozmawia przez stdin/stdout (JSON-RPC 2.0,
jedna wiadomość na linię); komunikaty diagnostyczne trafiają na stderr. Ręczne uruchomienie w terminalu tylko czeka
na wejście — normalnie uruchamia go klient MCP.

## Claude Code

```
claude mcp add page-debug -- node /ścieżka/do/repo/mcp/server.js /ścieżka/do/paczek
```

Na Windows ścieżki w zwykłej postaci, np. `node C:\repo\mcp\server.js C:\Users\ja\Downloads\paczki`.
Sprawdzenie: `claude mcp list` (serwer `page-debug` powinien być `connected`), a w sesji `/mcp` pokazuje 7 narzędzi.

## Cursor

Plik `.cursor/mcp.json` w projekcie (albo `~/.cursor/mcp.json` globalnie):

```json
{
  "mcpServers": {
    "page-debug": {
      "command": "node",
      "args": ["/ścieżka/do/repo/mcp/server.js", "/ścieżka/do/paczek"]
    }
  }
}
```

Na Windows w JSON-ie ukośniki wsteczne podwajamy: `"C:\\repo\\mcp\\server.js"`.

## Narzędzia

| Narzędzie | Argumenty | Co zwraca |
|---|---|---|
| `list_snapshots` | `limit` (1–200, domyślnie 50) | paczki od najnowszej: `id` (nazwa pliku), `host`, `collectedAt`, `schemaVersion`, liczby z `overview`, `warnings`; nieczytelny plik ma pole `error` |
| `get_summary` | `id` | podsumowanie w markdownie — ten sam tekst co `summary.md` w zipie i zakładka *Podsumowanie* w viewerze; dla paczki v1–v3 z linią „Uwaga: Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny.” na początku |
| `get_errors` | `id`, `limit` (1–200, domyślnie 10) | grupy błędów po komunikacie: liczba, czas pierwszego, pierwsza ramka, stos (≤ 4000 znaków), ostatni krok przed błędem |
| `get_network` | `id`, `status`, `failedOnly`, `type`, `method`, `urlContains`, `limit` (1–500, domyślnie 50), `offset`, `includeHeaders`, `includeBody` | zapytania sieciowe; domyślnie tylko nieudane; `matched`, `returned`, `remaining` |
| `get_vitals` | `id` | CWV (TTFB, FCP, LCP, CLS, INP) per dokument z oceną i atrybucją albo powodem braku wartości; długie zadania |
| `get_steps` | `id`, `limit` (1–2000, domyślnie 50) | ostatnie kroki użytkownika; `beforeFirstError` przy ostatnim kroku przed pierwszym błędem |
| `diff_snapshots` | `a` (wcześniejsza), `b` (późniejsza) | nowe i zniknięte błędy, zmiany statusów, zmiany CWV, różnice w ciasteczkach |

Szczegóły:

- **Czasy** są podawane dwa razy: bezwzględnie (ISO 8601, UTC, np. `firstAt`, `at`) i względnie — w sekundach od startu
  nagrania (`rel`, `firstRel`).
- **`get_network`, `status`:** kod (`404`), klasa (`2xx`…`5xx`, `error` = bez odpowiedzi) albo zakres (`"400-499"`).
  `failedOnly` jest domyślnie `true` tylko wtedy, gdy nie podano `status` — `status: "2xx"` pokazuje udane zapytania.
  Nagłówki i treść (żądanie, podgląd odpowiedzi do 4096 znaków) tylko przy `includeHeaders: true` / `includeBody: true`.
  Kolejną stronę pobiera się przez `offset` = poprzedni `offset` + `returned`.
- **`diff_snapshots`, statusy:** kluczem jest metoda + ścieżka URL **bez hosta**, query i fragmentu
  (`POST /api/fail`). Dzięki temu paczka ze stagingu i z produkcji dają te same klucze; ceną jest to, że te same ścieżki
  na dwóch różnych hostach w jednej paczce zlewają się w jeden wpis (wygrywa ostatnie zapytanie). Porównywane są tylko
  pary obecne w obu paczkach. Błędy są porównywane po komunikacie, CWV — ostatnia dostępna wartość każdej metryki.
- **`warnings` w `list_snapshots`:** polskie noty czytnika przy paczce (do 5, każda ≤ 500 znaków). Dla schematu v1–v3 jest tam
  „Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny” (takie pliki mogą mieć jawne dane), dla v1 dodatkowo uwaga o przybliżonych czasach.
  Paczka v4 zwykle ma `warnings: []`.
- **Starsze paczki** (schemat v1–v3) są przy odczycie przekształcane do kształtu v4; nowszy schemat jest czytany „na ile się da”.

## Limit odpowiedzi

Każda odpowiedź ma najwyżej **25 000 znaków**, żeby nie zapchać kontekstu agenta. Listy (paczki, błędy, zapytania,
kroki) tracą wtedy ostatnie pozycje (w `get_steps` — najstarsze kroki), a odpowiedź dostaje pole `hint`:
„Pominięto N z M pozycji …; zawęź zapytanie: …”. Inny zbyt długi tekst jest ucinany i kończy się linią
„… ucięto N znaków; zawęź zapytanie: <podpowiedź>”.

## Błędy

Zły identyfikator, brak pliku, plik uszkodzony albo większy niż 64 MB, zły parametr — narzędzie zwraca błąd
(`isError: true`) z polskim komunikatem, a serwer działa dalej. Ostatnio czytane paczki są trzymane w pamięci
(do 8, unieważniane po zmianie daty modyfikacji lub rozmiaru pliku).
