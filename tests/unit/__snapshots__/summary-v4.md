# Paczka diagnostyczna — 127.0.0.1
Zapisano 2026-01-15T10:01:05.000Z · rozszerzenie 0.5.0 · schemat 4 · źródło: rozszerzenie · błędy JS 2 · błędy konsoli 1 · nieudane zapytania 3 · kroki 10 · słabe metryki 1 · zrzut: tak

## Środowisko

- Adres: `http://127.0.0.1:8080/result.html?access_token=[redacted:key-token]`
- Przeglądarka: `Mozilla/5.0 (Synthetic) Test/1.0`
- Okno: 1280×720, DPR 1
- Język: `pl-PL`

## Kroki

Ostatnie 10 z 10:
- 0,1 s · navigate · `http://127.0.0.1:8080/form.html`
- 0,9 s · click · `Zacznij`
- 1,1 s · input · `form > input:nth-of-type(1)`
- 1,3 s · input · `#pass`
- 1,4 s · change · `[data-testid="terms"]`
- 1,5 s · change · `#avatar`
- 1,5 s · key · `#pass`
- 1,5 s · submit · `#loginForm`
- 4,2 s · navigate · `http://127.0.0.1:8080/result.html` ← ostatni krok przed pierwszym błędem
- 6,3 s · click · `Zapisz`

## Błędy

- 1× od 4,2 s · `Uncaught TypeError: x is undefined` · `result.html:3:9`
- 1× od 4,2 s · `Uncaught Error: frame failed` · `inner.html:1:1`
- 1× od 4,2 s · `TypeError: x is undefined` · `result.js:12:9`

## Nieudane zapytania (3)

- `GET` `http://127.0.0.1:8080/img/missing.png` → 404 (2 ms)
- `POST` `http://127.0.0.1:8080/api/fail` → 500 (3 ms)
- `GET` `http://127.0.0.1:8080/missing.js` → 404 (2 ms)

## CWV

- `http://127.0.0.1:8080/form.html`: TTFB 47 ms (dobrze) · FCP 820 ms (dobrze) · LCP 1712 ms (dobrze) · CLS niedostępne — przeglądarka tego nie mierzy · INP niedostępne — przeglądarka tego nie mierzy
- `http://127.0.0.1:8080/result.html`: TTFB 52 ms (dobrze) · FCP 910 ms (dobrze) · LCP 4300 ms (słabo) · CLS 0,18 (do poprawy) · INP 336 ms (do poprawy)

## Najwolniejsze zasoby

- 3 ms · fetch · 23 B · `http://127.0.0.1:8080/api/fail`
- 2 ms · img · 9 B · `http://127.0.0.1:8080/img/missing.png`
- 2 ms · img · rozmiar nieznany · `https://cdn.example/logo.png`
- 2 ms · script · 9 B · `http://127.0.0.1:8080/missing.js`
- 2 ms · css · 9 B · `http://127.0.0.1:8080/style.css`

## Ciasteczka i rozmiar

- Ciasteczka: 3, razem 45 B
- Ucięte przez limity: nic

## Prywatność

- Zamaskowano 10 wartości w 5 sekcjach (reguły v1). Hasła, tokeny i dane logowania nie są w tym pliku.
- Zrzut ekranu: jest

## Uwagi

- `Recording started at 2026-01-15T10:00:00.000Z (page reloaded); earlier data is not included.`
- `LCP, CLS and INP are values at the time of saving; they could still grow.`

Pełne dane: snapshot.json; obraz: screenshot.jpg.
