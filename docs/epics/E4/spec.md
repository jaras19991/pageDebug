# E4 — Wyjście: podsumowanie, przeglądarka paczki, przekazanie, dostęp dla agenta

## Problem
Po zapisie popup pokazuje jedną linię statusu „Zapisano plik … — znajdziesz go w pobranych plikach.” (`MESSAGES.saved`,
`src/popup/view.js`) i wraca do stanu *gotowe*: zgłaszający nie wie, co zrobić z plikiem ani gdzie on jest. `summary.md`
(`src/lib/summary.js`, minimalny z E3-T5) ma tylko środowisko, liczby z `overview`, linię redakcji i 10 notatek — nie wymienia
kroków, błędów, nieudanych zapytań ani CWV (QA E3 F-5/F-1), więc developer i tak przewija `snapshot.json` (do 10 MB). Nie ma
viewera ani narzędzia dla agenta AI. Z E3 zostały znane luki redakcji (E4-IN1..IN5) i drobne braki notatek i maski zrzutu (IN6, IN7, IN11).

## Non-goals
- **Wysyłka przez rozszerzenie** — żadnego POST, uploadu, API Jiry/Slacka ani SMTP. Inaczej deklaracje AMO
  `data_collection_permissions: none` i CWS „no transfer” przestają być prawdziwe (E4-S2, store E0).
- **Wysyłka z popupu (mailto, link do formularza/Jira): odrzucone przez użytkownika 2026-10-26.** Zgłaszający wysyła plik sam,
  kanałem, który zna; popup nie ma przycisku „Wyślij” ani konfigurowalnego kanału/adresata.
- Własny backend, hosting viewera online, linki do udostępniania paczki.
- Podgląd ani edycja paczki przez zgłaszającego przed wysłaniem; pole „opisz problem” w popupie.
- Zapis i modyfikacja paczek przez viewer i MCP (konwersja starych wersji, ponowna redakcja, usuwanie plików).
- E4-IN9 (zip źródeł dla AMO, `strict_min_version` 140) — przeniesione do E5 (E5-S4, E5-T7), decyzja 2026-10-26.
- E4-IN10 (`npm audit` w devDeps: web-ext → node-forge) — tylko obserwacja, bez AC; warunek release jak w E3.
- Ciasteczka HttpOnly, nowe uprawnienia rozszerzenia, nowe sekcje danych zbieranych ze strony.

## User stories

### US-1 (Zgłaszający) Jako zgłaszający chcę po zapisie wiedzieć, gdzie jest plik i co z nim zrobić, żeby wysłać go bez dopytywania
- **AC-1.1** (E4-T2) Given udany zapis, Then popup pokazuje ekran *Zapisano*: nazwę pliku, instrukcję po polsku „Wyślij ten plik
  osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.” i przycisk „Pokaż plik”. Całość widoczna bez
  przewijania w popupie 360×600 (e2e `boundingBox`, Chrome; QA ręczne Firefox; unit: tekst równy w `MESSAGES` i `popup.html`).
- **AC-1.2** „Pokaż plik” otwiera systemowy menedżer plików z zaznaczonym zapisanym plikiem (QA ręczne: Windows 11, macOS,
  Chrome i Firefox; e2e Chrome: akcja dotyczy `downloadId` właśnie zapisanego pliku). Plik przeniesiony/usunięty → komunikat PL
  „Nie znaleziono pliku. Zapisz paczkę ponownie.”, bez wyjątku w konsoli popupu (unit).
- **AC-1.3** (usunięte — decyzja 2026-10-26)
- **AC-1.4** (usunięte — decyzja 2026-10-26)
- **AC-1.5** (usunięte — decyzja 2026-10-26)
- **AC-1.6** Ekran *Zapisano* wraca po zamknięciu i ponownym otwarciu popupu na tej karcie, dopóki zgłaszający nie kliknie
  *Nagrywaj*; po restarcie przeglądarki nie musi (e2e Chrome).
- **AC-1.7** Teksty nowego ekranu bez słów `JSON`, `zip`, `MCP`, `snapshot`, `hash`, `redakcja` (unit na `MESSAGES`).
- **AC-1.8** (E4-IN8) Zdanie zgody w stanie *gotowe* brzmi: „Mimo automatycznego usuwania haseł i tokenów plik może zawierać Twoje
  dane osobowe (np. adresy stron, treść logów) — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych
  danych w pliku.” — równe w `messages.js` i `popup.html` (unit).

### US-2 (Zgłaszający) Jako zgłaszający chcę, żeby nowe ekrany i narzędzia nie ujawniły niczego więcej niż plik, a znane luki maskowania były domknięte
- **AC-2.1** Od *Zapisz paczkę* do zamknięcia ekranu *Zapisano* (także po „Pokaż plik”) rozszerzenie nie wykonuje żadnego żądania
  sieciowego (e2e Chrome: nasłuch żądań tła i popupu = 0). `permissions` i `optional_host_permissions` w obu manifestach są
  identyczne jak w 0.5.0 (unit porównujący z listą w teście).
- **AC-2.2** Ekran *Zapisano* nie pokazuje żadnych danych z paczki poza nazwą pliku (unit na modelu widoku z fixture z wartościami-pułapkami
  z E3-TEST3 i adresem strony z `?token=`).
- **AC-2.3** (E4-IN1) Korpus redakcji dostaje przypadki: klucz na początku stringu JSON (`{"log":"password: x"}`) → wartość
  zamaskowana; proza `auth: "Invalid credentials"` → bez maskowania. Korpus `sensitive` 0 przecieków, `benign` ≤ 2 FP łącznie (unit).
- **AC-2.4** (E4-IN3) Zamaskowane: `/cb?code=…` (adres względny), `&code=` i `#code=` w tekście, `ticket` analogicznie, JSON-escaped
  `https:\/\/…?code=…`; bez zmian: `{"code":"PL"}`, `country_code=PL` (unit, korpus).
- **AC-2.5** (E4-IN2) Strona podmieniająca `Array.prototype[Symbol.iterator]` przed nagraniem nie wyłącza maskowania u źródła
  (podglądy odpowiedzi, nagłówki, kroki): pułapka JWT w odpowiedzi 500 nie występuje w zipie (unit hostile-realm + e2e).
- **AC-2.6** (E4-IN4) Podgląd argumentu konsoli `{ truncated, preview }` po maskowaniu par tablic (`["token=","x","more"]`) nie ma
  zniekształconej struktury, a `redaction.masked` równa się faktycznej liczbie znaczników (walidator v4, unit).
- **AC-2.7** (E4-IN5) Kontener w parze z kluczem (`console.log('password:', {v: pw})`, `('password', [pw])`) jest maskowany w całości;
  zdanie maskuje następny argument, gdy kończy się słowem-kluczem z listy, opcjonalnie z „is”/„jest” (`'Your password is', pw`).
  Wszystkie formy w korpusie `sensitive` z 0 przecieków; formy spoza zamkniętego korpusu z designu → README „Znane ograniczenia”
  (kryterium stopu: jedna iteracja review redakcji).
- **AC-2.8** Zmiana reguł (AC-2.3–2.7) podbija `redaction.rulesVersion` do `2`; `summary.md` pokazuje „reguły v2” (unit).
- **AC-2.9** `summary.md`, viewer i MCP pokazują tylko dane z już zredagowanego `snapshot.json`: dla zipa z e2e prywatności E3 żadna
  wartość-pułapka nie występuje w `summary.md`, w tekście DOM viewera ani w odpowiedzi żadnego narzędzia MCP (e2e + integracja).

### US-3 (Developer) Jako developer chcę z samego `summary.md` w ≤ 60 s wiedzieć, co kliknięto, co się zepsuło i co było wolne
- **AC-3.1** (E4-S1) Kolejność sekcji: nagłówek (host, czas, wersje, liczby z `overview` w jednej linii) → Środowisko → Kroki →
  Błędy → Nieudane zapytania → CWV → Najwolniejsze zasoby → Ciasteczka i rozmiar → Prywatność (raport redakcji) → Uwagi.
  Sekcja bez danych ma jedną linię „brak” z powodem z `notes`, nie znika (testy snapshotowe na 3 paczkach: `v4.json`, ciężka, fallback konsolowy).
- **AC-3.2** Kroki: ostatnie ≤ 20 kroków z czasem od startu nagrania (s, 1 miejsce po przecinku), typem, `text` lub selektorem, adresem
  dla `navigate`; krok bezpośrednio przed pierwszym błędem jest oznaczony (czas bezwzględny `documents[doc].timeOrigin + t`) (unit).
- **AC-3.3** Błędy: `runtimeErrors` i `consoleLogs` z `level: "error"`, zgrupowane po komunikacie z licznikiem, ≤ 10 grup; każda z czasem,
  komunikatem i pierwszą ramką stosu `plik:linia:kolumna` (unit).
- **AC-3.4** (E4-IN11) Nieudane zapytania (`status` ≥ 400 lub `error`): ≤ 20 pozycji `metoda URL → status (czas ms)`, reszta jako
  „i N więcej”; liczba zgodna z `overview.failedRequests` (unit).
- **AC-3.5** CWV: na dokument TTFB, FCP, LCP, CLS, INP z wartością i oceną; niedostępne z powodem (`reason`), nigdy `0` (unit).
- **AC-3.6** Najwolniejsze zasoby: 5 wpisów `network` o największym `durationMs` z typem i `sizeBytes`; Ciasteczka: liczba,
  `cookiesTotalBytes`, flagi `truncated` ustawione na `true` (unit).
- **AC-3.7** Rozmiar i czas: `summary.md` ≤ 200 linii i ≤ 16 KB; generowanie ≤ 100 ms na ciężkiej paczce (10 MB JSON; unit perf, mediana z 5).
- **AC-3.8** Wartość ze strony (`# `, `](javascript:…)`, `<img onerror>`, znaki nowej linii, backticki) nie tworzy w `summary.md` nagłówka,
  linku, HTML ani bloku kodu (unit: fixture-pułapka, parsowanie linii).
- **AC-3.9** (E4-IN6) Gdy zrzut wyłączył popup (ramki innych serwisów albo nieudane sprawdzenie strony), `notes` ma notatkę z tym
  powodem, inną niż „turned off by the reporter”; `summary.md` podaje powód po polsku (unit + e2e `screenshot-frames`).
- **AC-3.10** (E4-IN11) Gdy zrzut jest w paczce, a strona miała widoczne ramki innych originów (> 0), `notes` mówi ile i że nie są
  zakryte na obrazie; bez nowego pola w schemacie (e2e na fixture z ramką cross-origin).
- **AC-3.11** (E4-IN7) Maska zrzutu zakrywa całe pole (E3 AC-2.2 nadal spełnione), a etykieta 4 px nad polem pozostaje nienaruszona
  (e2e `screenshot-mask`: piksele obszaru etykiety równe obrazowi bez maski, DPR 1 i 2).

### US-4 (Developer) Jako developer chcę otworzyć paczkę w lokalnym viewerze, żeby przeglądać i filtrować dane bez edytora JSON
- **AC-4.1** (E4-S3) Jeden plik `viewer.html` (w repo i w artefaktach wydania, nie w rozszerzeniu) otwierany z dysku (`file://`)
  w aktualnym Chrome i Firefoksie wczytuje zip v4 (przeciągnij i upuść albo wybór pliku) oraz `snapshot.json` v2–v3 przez migrację
  z `docs/snapshot-schema.md`; v1 best-effort bez testu e2e. UI po polsku. Działa bez sieci: 0 żądań sieciowych (e2e).
- **AC-4.2** (E4-T3) Zakładki: Podsumowanie (ten sam tekst co `summary.md`), Kroki, Błędy, Sieć, Konsola, CWV, DOM, Storage; zrzut
  widoczny, gdy jest w zipie. Przełączenie zakładki ≤ 300 ms (e2e).
- **AC-4.3** Oś czasu w zakładce Kroki: kroki, błędy i nieudane zapytania ze wszystkich dokumentów w jednej kolejności chronologicznej
  (czas bezwzględny), z granicami dokumentów (unit na `v4.json` z 2 dokumentami).
- **AC-4.4** (E4-TEST2) Sieć: filtr po klasie statusu (2xx/3xx/4xx/5xx/błąd/nieznany), typie i fragmencie URL; widoczna liczba wyników;
  na paczce z 5000 wpisami filtr działa ≤ 500 ms (e2e).
- **AC-4.5** (E4-R1) Viewer niczego z paczki nie wykonuje i nie ładuje: fixture z `<script>`, `<img src=x onerror>`, `javascript:` w URL-ach,
  argumentach konsoli, `dom.structure`, `notes`, kluczach storage → flaga-pułapka nieustawiona, brak okien dialogowych, 0 żądań,
  linki z paczki nieklikalne jako `javascript:` (e2e + review).
- **AC-4.6** Ciężka paczka (zip ~1,7 MB, JSON ~10 MB): pierwsza zakładka widoczna ≤ 3 s (e2e Chrome, mediana z 3).
- **AC-4.7** Plik uszkodzony, nie-paczka albo `schemaVersion` > 4 → komunikat po polsku (dla > 4: dane pokazane z ostrzeżeniem
  „nowsza wersja paczki”), bez białego ekranu (e2e).

### US-5 (Developer z agentem AI) Jako developer pracujący z agentem chcę, żeby agent odpytywał paczki małymi porcjami, zamiast czytać cały JSON
- **AC-5.1** (E4-T4) Serwer MCP `page-debug-mcp` (stdio, katalog w tym repo, uruchamiany lokalnie, Node ≥ 20) dostaje katalog z paczkami;
  README podaje gotową konfigurację dla Claude Code i Cursor. QA: Claude Code widzi 7 narzędzi i odpowiada na „jakie błędy są w ostatniej paczce?”.
- **AC-5.2** `list_snapshots`: dla każdego zipa/JSON-a w katalogu `id`, nazwa pliku, host, `collectedAt`, `schemaVersion`, liczby z
  `overview`; od najnowszego (integracja na katalogu z fixture v2, v3, v4 i plikiem uszkodzonym — ten ostatni oznaczony, nie wywraca listy).
- **AC-5.3** `get_summary(id)` zwraca tekst identyczny bajtowo z `summary.md` generowanym dla tej paczki (integracja).
- **AC-5.4** `get_errors(id)`: błędy jak w AC-3.3 plus pełny stos ≤ 4000 znaków i ostatni krok przed błędem; `get_steps(id)`, `get_vitals(id)`
  zwracają kroki i metryki z czasem bezwzględnym (integracja na `v4.json` — wartości zgodne z fixture).
- **AC-5.5** `get_network(id, filter)`: filtr po statusie (zakres lub „tylko nieudane” — domyślnie), typie, metodzie, fragmencie URL, z limitem
  (domyślnie 50) i informacją o pozostałych; nagłówki i podgląd treści tylko na żądanie (integracja).
- **AC-5.6** (E4-T5) `diff_snapshots(a, b)`: nowe i zniknięte błędy (po komunikacie), zmiany statusu dla tej samej metody i ścieżki URL,
  zmiany CWV z oceną, liczba i rozmiar ciasteczek oraz nazwy z innym `valueHash` (integracja na parze fixture ze znanymi różnicami).
- **AC-5.7** Każda odpowiedź ≤ 25 000 znaków; większa jest ucięta z informacją, jak zawęzić zapytanie (integracja na ciężkiej paczce).
- **AC-5.8** Serwer tylko czyta: nie zapisuje ani nie usuwa plików, nie otwiera połączeń sieciowych, nie czyta poza wskazanym katalogiem
  (`id` z `../` lub ścieżką bezwzględną → błąd) (integracja). Zły `id`/uszkodzony plik → błąd narzędzia, serwer działa dalej.

### US-6 (Developer) Jako developer chcę ustawić poziom redakcji bez zmiany kodu, żeby dostać potrzebne dane, nie dając tej opcji zgłaszającemu
- **AC-6.1** (E4-D4) Developer wyłącza reguły poziomu *Domyślnie* (`email`, `phone`, `html-structure`) plikiem konfiguracyjnym
  wbudowywanym przy budowaniu; polityka przedsiębiorstwa może go nadpisać. To samo ustawienie działa w Chrome i Firefoksie (unit + e2e Chrome).
- **AC-6.2** Zgłaszający nie ma żadnej kontrolki zmieniającej te ustawienia; rozszerzenie nie ma strony opcji (e2e: popup bez takich elementów,
  manifest bez `options_ui`/`options_page`).
- **AC-6.3** Nieprawidłowa konfiguracja (reguła poziomu *Zawsze*, nieznana reguła lub klucz, zły typ wartości) jest ignorowana w tej części,
  reszta działa; nagrywanie i zapis nigdy nie są blokowane (unit).
- **AC-6.4** Wyłączone reguły trafiają do `redaction.disabledRules` i linii „Wyłączone przez developera” w `summary.md` (unit).
- **AC-6.5** Gdy developer wyłączył `email`/`phone`/`html-structure`, lista „Do pliku trafią:” mówi o tym zgłaszającemu przed *Nagrywaj*
  (np. „pełna treść strony”, „adresy e-mail”) (unit na modelu widoku).

## Wymagania niefunkcjonalne
- **Prywatność:** rozszerzenie, viewer i MCP działają lokalnie, bez telemetrii i bez żądań sieciowych (AC-2.1, 4.1, 5.8). Deklaracje
  AMO `data_collection_permissions: none` i CWS „no transfer” pozostają prawdziwe — weryfikuje store-reviewer.
- **Uprawnienia:** bez nowych `permissions`/`host_permissions` względem 0.5.0 (AC-2.1).
- **Czas:** *Zapisz → Zapisano* ≤ 5 s (mediana z 5) jak E3 AC-1.5; rozbudowany `summary.md` dodaje ≤ 100 ms na ciężkiej paczce.
  Poprawka E4-IN2 nie zwiększa p95 czasu hooka `fetch` o więcej niż 0,1 ms względem 0.5.0 (test perf E3).
- **Rozmiar:** zip rozszerzenia rośnie o ≤ 30 KB; paczka snapshotu nadal ≤ 2 MB (domyślna konfiguracja); `viewer.html` ≤ 300 KB, jeden plik.
- **Wersje:** rozszerzenie jak w 0.5.0 (Chrome 128+, Firefox wg `strict_min_version`, bez zmian do E5). Viewer: aktualny stabilny
  Chrome, Edge, Firefox. MCP: Node ≥ 20 LTS; `npm audit --omit=dev` = 0 high także dla pakietu MCP; publikacja w npm — E5.
- **Spójność:** `summary.md`, zakładka Podsumowanie i `get_summary` dają identyczny tekst (AC-5.3) — jeden kontrakt dla trzech konsumentów.

## Dane — zmiany w schemacie paczki
Bez zmiany łamiącej: `schemaVersion` zostaje **4**. Zmiany do wpisania w `docs/snapshot-schema.md`:
- `redaction.rulesVersion` = `2` (AC-2.8); `redaction.disabledRules` może być niepuste (źródło: konfiguracja z AC-6.1, pola istnieją od v4).
- Nowe treści `notes`: powód wyłączenia zrzutu przez popup (AC-3.9), ramki innych originów na zrzucie (AC-3.10) — bez nowych pól.
- Wpis zipa `summary.md` — nowa, stała struktura sekcji (AC-3.1); nadal budowany wyłącznie ze zredagowanego `snapshot.json`.

## Decyzje (2026-10-26)
1. **Q-1** Konfiguracja reguł redakcji: plik wbudowywany przy budowaniu, nadpisywalny polityką przedsiębiorstwa; bez strony opcji (AC-6.1, 6.2).
2. **Q-2** Tekst instrukcji na ekranie *Zapisano*: „Wyślij ten plik osobie, która poprosiła Cię o zgłoszenie — jako załącznik e-maila lub w zgłoszeniu.” (AC-1.1).
3. **Q-3** Temat i treść e-maila — **bezprzedmiotowe**: wysyłka mailem odrzucona (non-goals).
4. **Q-4** (IN5) Kontener w parze maskowany w całości; zdanie kończące się słowem-kluczem maskuje następny argument; zamknięty korpus i jedna iteracja review (AC-2.7).
5. **Q-5** (IN8) Nowe zdanie zgody przyjęte (AC-1.8).
6. **Q-6** (IN9) Przeniesione do E5 (non-goals).
7. **Q-7** (IN11) Ramki cross-origin tylko notatką, bez pola (AC-3.10).
8. **Q-8** Viewer w repo i w artefaktach wydania, nie w rozszerzeniu (AC-4.1).
9. **Q-9** Viewer i MCP: v4 w pełni, v2–v3 przez migrację, v1 best-effort (AC-4.1, 5.2).
10. **Q-10** MCP w tym repo, uruchamiany lokalnie, Node ≥ 20; npm — E5 (AC-5.1).
11. **Q-11** Viewer po polsku (AC-4.1).
12. Wysyłka z popupu (mailto, link do formularza/Jira) odrzucona; usunięte AC-1.3, 1.4, 1.5.

## Otwarte pytania do użytkownika
Brak — wszystkie rozstrzygnięte w sekcji „Decyzje (2026-10-26)”.

## Ryzyka
1. **Ogon wariantów redakcji (IN1–IN5) znowu rośnie.** Sygnał: review znajduje > 2 nowe formy zapisu po pierwszej poprawce albo `benign` FP > 2.
2. **XSS w viewerze przez dane strony.** Sygnał: w kodzie viewera pojawia się wstawianie HTML z danych paczki; pułapka AC-4.5 odpala choć raz.
3. **Odpowiedzi MCP zapychają kontekst agenta.** Sygnał: odpowiedź na ciężkiej paczce zbliża się do limitu AC-5.7 przy domyślnych filtrach,
   agent w QA prosi o kolejne strony zamiast odpowiedzieć.
4. **Zgłaszający nadal nie wie, komu wysłać plik** (instrukcja ogólna, bez adresata). Sygnał: w QA osoba nietechniczna pyta „do kogo?”
   albo zgłoszenia przychodzą bez pliku.
5. **Rozjazd trzech konsumentów (summary, viewer, MCP).** Sygnał: test równości AC-5.3 albo zakładki Podsumowanie pada po zmianie w jednym z nich.
