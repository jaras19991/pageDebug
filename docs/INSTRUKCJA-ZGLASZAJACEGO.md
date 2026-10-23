# Jak zapisać plik z opisem problemu na stronie

Ten dodatek do przeglądarki nagrywa to, co dzieje się na stronie, na której coś nie działa, i zapisuje to w jednym pliku
na Twoim komputerze. Plik wysyłasz osobie, która ma problem naprawić. Dodatek sam niczego nie wysyła.

## Co jest w pliku, a czego nie ma

Przed rozpoczęciem nagrywania dodatek pokazuje listę danych. Do pliku trafią:

- adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu
- lista Twoich działań na stronie: w co kliknąłeś i na jakie podstrony przeszedłeś (bez tego, co wpisałeś)
- logi konsoli i błędy
- zapytania sieciowe strony: adresy, nagłówki i wysyłana treść (mogą zawierać dane logowania) oraz adresy wczytanych plików
- fragmenty odpowiedzi serwera, gdy coś się nie uda
- treść i struktura strony, w tym wartości wpisane w formularze (bez haseł i pól ukrytych)
- zdjęcie ekranu w chwili zapisu (patrz niżej)
- ciasteczka i dane zapisane przez stronę (mogą zawierać dane logowania)

Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła.

**Uwaga na zdjęcie ekranu.** Przy zapisie dodatek robi jedno zdjęcie tej części strony, którą widzisz na ekranie. Widać na nim wszystko,
co tam jest — także to, co wpisałeś w pola (na przykład adres e-mail albo numer karty). Hasła są na nim ukryte (kropki). Zanim klikniesz
„Zapisz paczkę”, zamknij lub usuń z ekranu rzeczy, których nie chcesz pokazywać. Zdjęcie robi się tylko wtedy, gdy oglądasz stronę,
którą nagrywałeś; w przeciwnym razie plik powstanie bez zdjęcia.

Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.

Uczciwie: te dane **nie są jeszcze zamaskowane**. Hasło wpisane w formularzu logowania lub wysłane razem z zapytaniem może
znaleźć się w pliku wprost. Dlatego wysyłaj plik tylko osobie, która ma naprawić problem, i nie nagrywaj na stronie, na której
widać cudze dane. Maskowanie haseł i danych logowania dopiero planujemy. Nagrywanie obejmuje tylko tę witrynę, na której
je zacząłeś, i tylko tę kartę — innych witryn dodatek nie nagrywa.

## Zanim zaczniesz (jednorazowo)

Pomoże Ci w tym osoba, która dała Ci ten dodatek. Dostaniesz od niej folder (w Chrome) albo plik z dopiskiem `firefox` (w Firefoksie).

- **Chrome:** wpisz w pasku adresu `chrome://extensions`, włącz u góry przełącznik „Tryb programisty”,
  kliknij „Załaduj rozpakowane” i wskaż dostany folder.
- **Firefox:** wpisz w pasku adresu `about:debugging`, kliknij „Ten Firefox”, potem „Załaduj tymczasowy dodatek”
  i wskaż dostany plik. **W Firefoksie dodatek znika po zamknięciu przeglądarki** — następnego dnia trzeba go dodać ponownie.

## Kroki

1. Otwórz stronę, na której widzisz problem, i zostań na niej.
   ![krok 1](img/krok-1.png)
2. Kliknij ikonę układanki (puzzla) w prawym górnym rogu przeglądarki, a na liście — „Page Debug Snapshot”.
   (Pinezka obok sprawi, że ikona zostanie na wierzchu.)
   ![krok 2](img/krok-2.png)
3. Przeczytaj listę danych i kliknij czarny przycisk „Nagrywaj”.
   ![krok 3](img/krok-3.png)
4. Gdy przeglądarka zapyta o zgodę na dostęp do tej strony, kliknij „Zezwól”. Okno z dodatkiem zamknie się samo.
   To pytanie pojawia się tylko za pierwszym razem dla danej strony.
   ![krok 4](img/krok-4.png)
5. Poczekaj, aż strona odświeży się sama. Od tej chwili dodatek nagrywa. Zrób na stronie dokładnie to, po czym pojawia się problem. Dodatek zapamięta, w co klikasz, ale nie to, co wpisujesz.
   Nagrywanie trwa najwyżej 10 minut.
   ![krok 5](img/krok-5.png)
6. Zostań na tej samej stronie, kliknij ponownie ikonę dodatku, potem „Zapisz paczkę”. Poczekaj na zielony tekst
   „Zapisano plik … — znajdziesz go w pobranych plikach.”
   ![krok 6](img/krok-6.png)
7. Otwórz folder z pobranymi plikami, znajdź plik, którego nazwa zaczyna się od `page-debug-snapshot-`, i wyślij go tak,
   jak opisano niżej w części „Gdzie wysłać”.
   ![krok 7](img/krok-7.png)

Jeśli minie 10 minut, nagrywanie zatrzyma się samo i dodatek napisze „Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.”
Nic się nie traci — kliknij „Zapisz paczkę”; w pliku będzie to, co udało się nagrać.

## Co, jeśli coś nie działa

- „Bez Twojej zgody na dostęp do tej strony nie da się jej nagrać. Kliknij „Nagrywaj” ponownie i wybierz „Zezwól”.”
  — okno z pytaniem o zgodę zniknęło lub kliknięto „Nie zezwalaj”. Otwórz ikonę dodatku, kliknij „Nagrywaj” jeszcze raz
  i tym razem wybierz „Zezwól”.
- „Strona jeszcze się ładuje albo nie odpowiada. Poczekaj chwilę i kliknij „Zapisz paczkę” ponownie.”
  — zaczekaj, aż strona się załaduje, i kliknij „Zapisz paczkę” jeszcze raz. Nagrywanie cały czas trwa, nic nie przepadło.
- „Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.”
  — jesteś na stronie, na której dodatek nie ma prawa działać (na przykład pusta karta, strona ustawień przeglądarki
  albo sklep z dodatkami). Przejdź na zwykłą stronę, na której jest problem, i zacznij od kroku 2.

Inne komunikaty:

- „Trwa nagrywanie w innej karcie. Kliknięcie „Nagrywaj” zakończy je bez zapisu.” — nagrywać można w jednej karcie naraz.
  Jeśli chcesz zachować tamto nagranie, najpierw wróć do tamtej karty i kliknij „Zapisz paczkę”.
- „Zapis został przerwany lub anulowany. Nagrywanie trwa — kliknij „Zapisz paczkę” ponownie.” — spróbuj jeszcze raz.
- „W Firefoksie nagrywanie plików z dysku nie jest obsługiwane. Otwórz stronę przez http:// lub https://.” — w Firefoksie strony zapisane na komputerze nie da się nagrać; otwórz ją inną drogą albo poproś o pomoc.
- „To jest plik z dysku. Żeby zapisać paczkę, wpisz w pasku adresu chrome://extensions, kliknij „Szczegóły” przy Page Debug Snapshot
  i włącz „Zezwalaj na dostęp do adresów URL plików”. Potem odśwież stronę i kliknij ponownie.” — otwierasz stronę zapisaną
  na komputerze. Zrób dokładnie to, co jest w komunikacie.
- „Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki.”
  — odśwież stronę (klawisz F5) i spróbuj jeszcze raz od kroku 2. Jeśli nadal tak jest, opisz problem własnymi słowami
  i dopisz, że zapisanie pliku się nie udało.
- Nie widzisz ikony dodatku w Firefoksie — dodatek zniknął po zamknięciu przeglądarki; dodaj go ponownie według części „Zanim zaczniesz”.
- W Firefoksie plik jest bez zdjęcia ekranu, jeśli strona odświeżyła się, gdy okno dodatku było otwarte — zamknij okno dodatku, otwórz je jeszcze raz i kliknij „Zapisz paczkę”.
- Nie możesz znaleźć pliku — w przeglądarce użyj skrótu `Ctrl+J` (otwiera listę pobranych plików).

Po zapisaniu pliku dodatek niczego już na tej stronie nie nagrywa. Zgodę na dostęp do strony możesz cofnąć:
w Chrome wpisz w pasku adresu `chrome://extensions`, kliknij „Szczegóły” przy dodatku i zmień „Dostęp do witryn”;
w Firefoksie wpisz `about:addons`, kliknij dodatek i otwórz „Uprawnienia”.

## Gdzie wysłać

`<adres lub sposób wysyłki — uzupełnia osoba prowadząca projekt>`
