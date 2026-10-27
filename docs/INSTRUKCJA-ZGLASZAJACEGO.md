# Jak zapisać plik z opisem problemu na stronie

Ten dodatek do przeglądarki nagrywa to, co dzieje się na stronie, na której coś nie działa, i zapisuje to w jednym pliku
na Twoim komputerze. Plik wysyłasz sam, osobie, która ma problem naprawić (na przykład e-mailem albo przez komunikator). Dodatek sam niczego nie wysyła.

## Co jest w pliku, a czego nie ma

Przed rozpoczęciem nagrywania dodatek pokazuje listę danych. Do pliku trafią:

- adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu
- lista Twoich działań na stronie: w co kliknąłeś i na jakie podstrony przeszedłeś (bez tego, co wpisałeś)
- logi konsoli i błędy
- zapytania sieciowe strony: adresy, nagłówki i wysyłana treść oraz adresy wczytanych plików
- fragmenty odpowiedzi serwera, gdy coś się nie uda
- struktura strony bez tekstów i bez wartości wpisanych w formularze
- zrzut ekranu w chwili zapisu (możesz go wyłączyć) — pola formularzy tej strony są na nim zakryte, ale formularze osadzone z innych serwisów (np. płatność, logowanie) mogą być widoczne
- nazwy i rozmiary ciasteczek oraz dane zapisane przez stronę

**Co jest usuwane.** Hasła i tokeny dodatek usuwa z pliku automatycznie, a wartości ciasteczek zastępuje krótkim skrótem. Plik nadal może
zawierać adresy odwiedzanych stron i treść logów — a także tytuł strony. Plik zostaje na Twoim dysku, dodatek niczego nie wysyła.

**Uwaga na zrzut ekranu.** To zdjęcie tej części strony, którą widzisz na ekranie. Pola do wpisywania na tej stronie (e-mail, numer karty,
hasło i inne) są na nim zakryte szarymi prostokątami — zakryte są też części podpisów tuż nad nimi. **Ale okienka osadzone na stronie
przez inne serwisy (na przykład formularz płatności albo logowania) mogą być widoczne wraz z tym, co w nich wpisałeś.** Jeśli widzisz na
stronie takie okienko, **wyłącz zrzut ekranu** (odznacz „Dołącz zrzut ekranu”, patrz krok 6). Poza polami na zrzucie widać wszystko,
co jest na ekranie — także na przykład imię i nazwisko wyświetlone w nagłówku strony. Zanim klikniesz „Zapisz paczkę”, zamknij lub usuń
z ekranu to, czego nie chcesz pokazywać.

**Kiedy zrzut jest od początku wyłączony.** Gdy dodatek zauważy na stronie okienka innych serwisów, sam odznacza „Dołącz zrzut ekranu”
i pisze o tym pod spodem. Tak samo, gdy nie udało mu się sprawdzić strony. Możesz go włączyć z powrotem, ale rób to tylko wtedy, gdy
w tych okienkach nic nie widać albo nic w nich nie wpisano. Przy każdym następnym otwarciu okna dodatku wybór wraca do domyślnego.

Plik może zawierać Twoje dane osobowe — wyślij go tylko osobie, która ma naprawić problem. Klikając „Nagrywaj”, zgadzasz się na zapisanie
tych danych w pliku. Usuwanie haseł działa według reguł, więc nie jest nieomylne: nie nagrywaj na stronie, na której widać cudze dane.
Nagrywanie obejmuje tylko tę witrynę, na której je zacząłeś, i tylko tę kartę — innych witryn dodatek nie nagrywa.

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
3. Przeczytaj listę danych i zdanie tuż nad przyciskiem „Nagrywaj”. Mówi ono, że plik może zawierać Twoje dane osobowe i że klikając „Nagrywaj”, zgadzasz się
   na ich zapisanie w pliku. Jeśli się zgadzasz, kliknij czarny przycisk „Nagrywaj”.
   ![krok 3](img/krok-3.png)
4. Gdy przeglądarka zapyta o zgodę na dostęp do tej strony, kliknij „Zezwól”. Okno z dodatkiem zamknie się samo.
   To pytanie pojawia się tylko za pierwszym razem dla danej strony.
   ![krok 4](img/krok-4.png)
5. Poczekaj, aż strona odświeży się sama. Od tej chwili dodatek nagrywa. Zrób na stronie dokładnie to, po czym pojawia się problem. Dodatek zapamięta, w co klikasz, ale nie to, co wpisujesz.
   Nagrywanie trwa najwyżej 10 minut.
   ![krok 5](img/krok-5.png)
6. Zostań na tej samej stronie i kliknij ponownie ikonę dodatku. Nad przyciskiem „Zapisz paczkę” jest pole „Dołącz zrzut ekranu”.
   Zostaw je zaznaczone, chyba że na stronie widzisz okienko innego serwisu (np. płatność) — wtedy odznacz je. Kliknij „Zapisz paczkę”
   i poczekaj, aż w oknie dodatku pojawi się napis „Zapisano” z nazwą pliku.
   ![krok 6](img/krok-6.png)
7. Kliknij „Pokaż plik” — otworzy się folder z zapisanym plikiem (nazwa zaczyna się od `snapshot-` i kończy na `.zip`; to jeden spakowany
   plik — nie rozpakowuj go). Wyślij go sam, na przykład jako załącznik e-maila albo przez komunikator, tak jak opisano niżej w części „Gdzie wysłać”.
   Dodatek niczego nie wysyła i nie ma przycisku „Wyślij”.
   ![krok 7](img/krok-7.png)

Chcesz nagrać coś jeszcze? W oknie z napisem „Zapisano” kliknij „Nowe nagranie”, a potem „Nagrywaj” — wrócisz do kroku 3.

Dodatek zapisuje jeden plik. Jeśli zapiszesz dwa razy w tej samej sekundzie, drugi dostanie dopisek „ (1)” — dodatek podaje dokładną nazwę na ekranie „Zapisano”.

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
- Po zapisie dodatek dopisuje „Plik nie zawiera zrzutu ekranu.” albo „… nie udało się go bezpiecznie wykonać.” — plik jest w porządku, tylko bez zrzutu. Przyczyną bywa
  powiększenie strony gestem (dwa palce na ekranie dotykowym) albo w Firefoksie odświeżenie strony, gdy okno dodatku było otwarte. Zamknij okno dodatku, wróć do zwykłego
  powiększenia, otwórz okno jeszcze raz i zapisz ponownie (trzeba zacząć od „Nagrywaj”).
- Pod polem „Dołącz zrzut ekranu” jest napis o okienkach innych serwisów albo „Nie udało się sprawdzić strony — zrzut wyłączony.” — to zamierzone zabezpieczenie.
  Zrzut możesz włączyć, ale pamiętaj o ostrzeżeniu wyżej.
- Nie możesz znaleźć pliku — otwórz okno dodatku (po zapisie widać w nim „Zapisano”) i kliknij „Pokaż plik”. Możesz też użyć w przeglądarce skrótu `Ctrl+J`
  (otwiera listę pobranych plików).
- „Nie znaleziono pliku. Zapisz paczkę ponownie.” — plik został w międzyczasie przeniesiony albo usunięty. Zacznij nagranie od nowa (krok 2) i zapisz plik jeszcze raz.

Po zapisaniu pliku dodatek niczego już na tej stronie nie nagrywa. Zgodę na dostęp do strony możesz cofnąć:
w Chrome wpisz w pasku adresu `chrome://extensions`, kliknij „Szczegóły” przy dodatku i zmień „Dostęp do witryn”;
w Firefoksie wpisz `about:addons`, kliknij dodatek i otwórz „Uprawnienia”.

## Gdzie wysłać

Dodatek niczego nie wysyła — plik przekazujesz sam. Wyślij go tylko osobie, która poprosiła Cię o zgłoszenie:

`<adres lub sposób wysyłki — uzupełnia osoba prowadząca projekt>`
