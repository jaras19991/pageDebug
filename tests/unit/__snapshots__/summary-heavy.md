# Paczka diagnostyczna — heavy.example.com
Zapisano 2026-10-26T10:00:00.000Z · rozszerzenie 0.5.0 · schemat 4 · źródło: rozszerzenie · błędy JS 1000 · błędy konsoli 1000 · nieudane zapytania 150 · kroki 200 · słabe metryki 1 · zrzut: tak

## Środowisko

- Adres: `https://heavy.example.com/`
- Przeglądarka: `Mozilla/5.0 Heavy`
- Okno: 1280×720, DPR 1
- Język: `pl-PL`

## Kroki

Ostatnie 20 z 200:
- 18,0 s · click · `Dodaj`
- 18,1 s · click · `Dodaj`
- 18,2 s · click · `Dodaj`
- 18,3 s · click · `Dodaj`
- 18,4 s · click · `Dodaj`
- 18,5 s · click · `Dodaj`
- 18,6 s · click · `Dodaj`
- 18,7 s · click · `Dodaj`
- 18,8 s · click · `Dodaj`
- 18,9 s · click · `Dodaj`
- 19,0 s · click · `Dodaj`
- 19,1 s · click · `Dodaj`
- 19,2 s · click · `Dodaj`
- 19,3 s · click · `Dodaj`
- 19,4 s · click · `Dodaj`
- 19,5 s · click · `Dodaj`
- 19,6 s · click · `Dodaj`
- 19,7 s · click · `Dodaj`
- 19,8 s · click · `Dodaj`
- 19,9 s · click · `Dodaj`
- Ostatni krok przed pierwszym błędem (wcześniej niż lista): 0,0 s · click · `Dodaj`

## Błędy

- 1× od 0,0 s · `Uncaught TypeError: item 0 is undefined` · `app.js:100:7`
- 125× od 0,0 s · `promise parse hit invalid null failed network event update json ok payload response queue network submit invalid payload session widget click 617587 script styl…`
- 1× od 0,1 s · `Uncaught TypeError: item 1 is undefined` · `app.js:101:7`
- 125× od 0,1 s · `undefined config ok order status banner field payload network value queue 357039 user miss request fetch layout queue session image user item reject resize null…`
- 1× od 0,1 s · `Uncaught TypeError: item 2 is undefined` · `app.js:102:7`
- 125× od 0,1 s · `queue ok resize config 174137 json event index font latency image total array price payload miss promise loaded latency field click session update array total o…`
- 1× od 0,2 s · `Uncaught TypeError: item 3 is undefined` · `app.js:103:7`
- 125× od 0,2 s · `session field widget length array index length session 936790 resize module network price state cache 519456 344680 request payload undefined state style latenc…`
- 1× od 0,2 s · `Uncaught TypeError: item 4 is undefined` · `app.js:104:7`
- 125× od 0,2 s · `266537 config payload 573111 resolve worker layout order 470542 user invalid update queue scroll invalid json banner 844002 update form user form session scroll…`
- i 998 grup więcej

## Nieudane zapytania (150)

- `GET` `https://heavy.example.com/api/items/0?v=577305118` → błąd: `Failed to fetch` (345 ms)
- `GET` `https://heavy.example.com/static/file/50?v=822967747` → 500 (144 ms)
- `GET` `https://heavy.example.com/static/file/97?v=437089563` → błąd: `Failed to fetch` (172 ms)
- `GET` `https://heavy.example.com/static/file/100?v=180020427` → 500 (33 ms)
- `GET` `https://heavy.example.com/api/items/150?v=943340180` → 500 (498 ms)
- `GET` `https://heavy.example.com/static/file/194?v=154635478` → błąd: `Failed to fetch` (406 ms)
- `GET` `https://heavy.example.com/static/file/200?v=224233402` → 500 (279 ms)
- `GET` `https://heavy.example.com/static/file/250?v=652038166` → 500 (438 ms)
- `GET` `https://heavy.example.com/api/items/291?v=351904350` → błąd: `Failed to fetch` (143 ms)
- `GET` `https://heavy.example.com/api/items/300?v=928074659` → 500 (318 ms)
- `GET` `https://heavy.example.com/static/file/350?v=702267346` → 500 (50 ms)
- `GET` `https://heavy.example.com/static/file/388?v=390728572` → błąd: `Failed to fetch` (53 ms)
- `GET` `https://heavy.example.com/static/file/400?v=238503815` → 500 (43 ms)
- `GET` `https://heavy.example.com/api/items/450?v=491884566` → 500 (411 ms)
- `GET` `https://heavy.example.com/static/file/485?v=688795265` → błąd: `Failed to fetch` (339 ms)
- `GET` `https://heavy.example.com/static/file/500?v=362500828` → 500 (103 ms)
- `GET` `https://heavy.example.com/static/file/550?v=753486635` → 500 (149 ms)
- `GET` `https://heavy.example.com/api/items/582?v=506249925` → błąd: `Failed to fetch` (439 ms)
- `GET` `https://heavy.example.com/api/items/600?v=104332196` → 500 (475 ms)
- `GET` `https://heavy.example.com/static/file/650?v=433462562` → 500 (377 ms)
- i 130 więcej

## CWV

- `https://heavy.example.com/`: TTFB 100 ms (dobrze) · FCP 900 ms (dobrze) · LCP 5000 ms (słabo) · CLS 0,01 (dobrze) · INP niedostępne — brak danych

## Najwolniejsze zasoby

- 500 ms · font · 75 KB · `https://heavy.example.com/static/file/2143?v=717128794`
- 500 ms · fetch · 27 KB · `https://heavy.example.com/api/items/3303?v=290109371`
- 500 ms · fetch · 75 KB · `https://heavy.example.com/api/items/4479?v=821915665`
- 500 ms · css · 39 KB · `https://heavy.example.com/static/file/1897?v=395397735`
- 500 ms · script · 78 KB · `https://heavy.example.com/static/file/4246?v=707012364`

## Ciasteczka i rozmiar

- Ciasteczka: 1, razem 12 B
- Ucięte przez limity: nic

## Prywatność

- Zamaskowano 0 wartości w 0 sekcjach (reguły v1). Hasła, tokeny i dane logowania nie są w tym pliku.
- Zrzut ekranu: jest

## Uwagi

- `Recording started at 2026-10-26T09:50:00.000Z (page reloaded); earlier data is not included.`

Pełne dane: snapshot.json; obraz: screenshot.jpg.
