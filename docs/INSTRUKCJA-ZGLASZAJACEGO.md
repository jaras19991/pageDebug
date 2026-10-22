# Jak zapisać plik z opisem problemu na stronie

Ten dodatek do przeglądarki zapisuje na Twoim komputerze jeden plik z informacjami o stronie, na której coś nie działa.
Plik wysyłasz osobie, która ma problem naprawić. Dodatek sam nic nie wysyła.

## Co jest w pliku, a czego nie ma

Uczciwie: plik zawiera dane ze strony, na której jesteś, także to, co jest w niej zapisane na Twoim komputerze
(na przykład ciasteczka i zapamiętane dane logowania do tej strony) oraz treść strony razem z wpisanymi w formularze wartościami.
Dane te **nie są jeszcze zamaskowane** — dlatego wysyłaj plik tylko osobie, która ma naprawić problem,
i nie zapisuj go na stronie, na której widać cudze dane. Dodatek zapisuje błędy dopiero od chwili kliknięcia,
więc to, co wydarzyło się wcześniej, w pliku się nie pojawi.

## Zanim zaczniesz (jednorazowo)

Pomoże Ci w tym osoba, która dała Ci ten dodatek. Dostaniesz od niej folder (w Chrome) albo plik z dopiskiem `firefox` (w Firefoksie).

- **Chrome:** wpisz w pasku adresu `chrome://extensions`, włącz u góry przełącznik „Tryb programisty”,
  kliknij „Załaduj rozpakowane” i wskaż dostany folder.
- **Firefox:** wpisz w pasku adresu `about:debugging`, kliknij „Ten Firefox”, potem „Załaduj tymczasowy dodatek”
  i wskaż dostany plik. **W Firefoksie dodatek znika po zamknięciu przeglądarki** — następnego dnia trzeba go dodać ponownie.

## Kroki

1. Otwórz stronę, na której widzisz problem, i zostań na niej.
   ![krok 1](img/krok-1.png)
2. Kliknij ikonę układanki (puzzla) w prawym górnym rogu przeglądarki.
   ![krok 2](img/krok-2.png)
3. Kliknij na liście „Page Debug Snapshot”. (Możesz kliknąć też pinezkę obok, żeby ikona została na wierzchu.)
   ![krok 3](img/krok-3.png)
4. Kliknij czarny przycisk „Debug snapshot”.
   ![krok 4](img/krok-4.png)
5. Przeczytaj komunikat pod przyciskiem. Zielony tekst „Gotowe. Zapisano plik … — znajdziesz go w pobranych plikach.” oznacza, że się udało.
   ![krok 5](img/krok-5.png)
6. Otwórz folder z pobranymi plikami i znajdź plik, którego nazwa zaczyna się od `page-debug-snapshot-`.
   ![krok 6](img/krok-6.png)
7. Wyślij ten plik tak, jak opisano niżej w części „Gdzie wysłać”.
   ![krok 7](img/krok-7.png)

## Co, jeśli coś nie działa

Komunikaty, które możesz zobaczyć pod przyciskiem:

- „Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.”
  — jesteś na stronie, na której dodatek nie ma prawa działać (na przykład pusta karta albo strona ustawień przeglądarki).
  Przejdź na zwykłą stronę, na której jest problem, i zacznij od kroku 2.
- „To jest plik z dysku. Żeby zapisać paczkę, wpisz w pasku adresu chrome://extensions, kliknij „Szczegóły” przy Page Debug Snapshot
  i włącz „Zezwalaj na dostęp do adresów URL plików”. Potem odśwież stronę i kliknij ponownie.”
  — otwierasz stronę zapisaną na komputerze. Zrób dokładnie to, co jest w komunikacie.
- „Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki.”
  — odśwież stronę (klawisz F5) i spróbuj jeszcze raz od kroku 2. Jeśli nadal tak jest, opisz problem własnymi słowami
  i dopisz, że zapisanie pliku się nie udało.

Inne sytuacje:

- „Nie widzę otwartej strony. Kliknij kartę ze stroną i spróbuj ponownie.” — kliknij kartę ze stroną i zacznij od kroku 2.
- Nie widzisz ikony dodatku w Firefoksie — dodatek zniknął po zamknięciu przeglądarki; dodaj go ponownie według części „Zanim zaczniesz”.
- Nie możesz znaleźć pliku — w przeglądarce użyj skrótu `Ctrl+J` (otwiera listę pobranych plików).

## Gdzie wysłać

`<adres lub sposób wysyłki — uzupełnia osoba prowadząca projekt>`
