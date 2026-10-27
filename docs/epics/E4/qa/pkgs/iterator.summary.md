# Paczka diagnostyczna — 127.0.0.1
Zapisano 2026-10-27T08:50:42.361Z · rozszerzenie 0.5.0 · schemat 4 · źródło: rozszerzenie · błędy JS 1 · błędy konsoli 1 · nieudane zapytania 1 · kroki 5 · słabe metryki 0 · zrzut: tak

## Środowisko

- Adres: `http://127.0.0.1:54697/privacy-iterator.html?access_token=[redacted:key-token]`
- Przeglądarka: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36`
- Okno: 1280×720, DPR 1
- Język: `pl-PL`

## Kroki

Ostatnie 5 z 5:
- 0,0 s · navigate · `http://127.0.0.1:54697/privacy-iterator.html`
- 0,3 s · click · `Pobierz`
- 0,3 s · click · `Dalej`
- 0,3 s · navigate · `http://127.0.0.1:54697/privacy-iterator.html?access_token=[redacted:key-token]`
- 0,4 s · click · `Błąd` ← ostatni krok przed pierwszym błędem

## Błędy

- 2× od 0,4 s · `Uncaught Error: password: [redacted:key-password]` · `privacy-iterator.html:39:17`

## Nieudane zapytania (1)

- `GET` `http://127.0.0.1:54697/status/500?body=token` → 500 (3 ms)

## CWV

- `http://127.0.0.1:54697/privacy-iterator.html?access_token=[redacted:key-token]`: TTFB 2 ms (dobrze) · FCP 20 ms (dobrze) · LCP 20 ms (dobrze) · CLS 0,00 (dobrze) · INP 8 ms (dobrze)

## Najwolniejsze zasoby

- 3 ms · fetch · 230 B · `http://127.0.0.1:54697/status/500?body=token`

## Ciasteczka i rozmiar

- Ciasteczka: 0, razem 0 B
- Ucięte przez limity: nic

## Prywatność

- Zamaskowano 10 wartości w 6 sekcjach (reguły v2). Hasła, tokeny i dane logowania nie są w tym pliku.
- Zrzut ekranu: jest

## Uwagi

- `Recording started at 2026-10-27T08:50:41.195Z (page reloaded); earlier data is not included.`
- `LCP, CLS and INP are values at the time of saving; they could still grow.`

Pełne dane: snapshot.json; obraz: screenshot.jpg.
