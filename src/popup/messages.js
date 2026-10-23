// Every text the reporter can see in the popup. Keys form a closed set; technical details
// never reach this dictionary — they go to the popup's console.error for developers only.
// Static texts (disclosure, notices) are duplicated in popup.html; a unit test keeps them equal.
export const MESSAGES = Object.freeze({
  // Ready state: what lands in the file, shown above the "Nagrywaj" button (AC-1.1).
  disclosureTitle: 'Do pliku trafią:',
  disclosureItems: Object.freeze([
    'adresy odwiedzonych podstron tej witryny, adres strony, z której na nią przyszedłeś, oraz dane przeglądarki i ekranu',
    'logi konsoli i błędy',
    'zapytania sieciowe strony: adresy, nagłówki i wysyłana treść (mogą zawierać dane logowania) oraz adresy wczytanych plików',
    'treść i struktura strony, w tym wartości wpisane w formularze (bez haseł i pól ukrytych)',
    'ciasteczka i dane zapisane przez stronę (mogą zawierać dane logowania)',
  ]),
  noUpload: 'Plik zostaje na Twoim dysku, rozszerzenie niczego nie wysyła.',
  // Store review F2: clicking "Nagrywaj" is the consent; the file may hold personal data.
  consentNotice:
    'Plik może zawierać Twoje dane osobowe i dane logowania — wyślij go tylko developerowi. Klikając „Nagrywaj”, zgadzasz się na zapisanie tych danych w pliku.',
  reloadNotice:
    'Po kliknięciu „Nagrywaj” strona odświeży się, a nagrywanie zacznie się od jej początku.',
  otherTabRecording:
    'Trwa nagrywanie w innej karcie. Kliknięcie „Nagrywaj” zakończy je bez zapisu.',

  // Recording flow.
  starting: 'Uruchamiam nagrywanie…',
  recordingSince: (startedAt) => `Nagrywam od ${clockText(startedAt)}`,
  recordingHint: 'Odtwórz problem, a potem kliknij „Zapisz paczkę”.',
  otherOrigin:
    'Ta karta pokazuje teraz inną stronę. Nagranie obejmuje tylko stronę, na której je rozpoczęto — możesz zapisać to, co zebrano.',
  stoppedByLimit: 'Nagrywanie zatrzymane po 10 minutach — zapisz paczkę.',

  // Saving.
  saving: 'Zapisuję paczkę…',
  saved: (fileName) => `Zapisano plik ${fileName} — znajdziesz go w pobranych plikach.`,
  saveCancelled:
    'Zapis został przerwany lub anulowany. Nagrywanie trwa — kliknij „Zapisz paczkę” ponownie.',
  downloadFailed:
    'Nie udało się zapisać pliku na dysku. Nagrywanie trwa — kliknij „Zapisz paczkę” ponownie.',
  pageBusy:
    'Strona jeszcze się ładuje albo nie odpowiada. Poczekaj chwilę i kliknij „Zapisz paczkę” ponownie.',

  // Problems (restricted/fileAccess/noTab/failed unchanged since E0: regression AC-1.3/1.6).
  permissionDenied:
    'Bez Twojej zgody na dostęp do tej strony nie da się jej nagrać. Kliknij „Nagrywaj” ponownie i wybierz „Zezwól”.',
  recordFailed: 'Nie udało się rozpocząć nagrywania. Odśwież stronę i spróbuj ponownie.',
  restricted:
    'Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.',
  fileAccess:
    'To jest plik z dysku. Żeby zapisać paczkę, wpisz w pasku adresu chrome://extensions, kliknij „Szczegóły” przy Page Debug Snapshot i włącz „Zezwalaj na dostęp do adresów URL plików”. Potem odśwież stronę i kliknij ponownie.',
  // Firefox never records file:// pages (QA F-4, decision 2): said before any consent prompt.
  fileUnsupportedFirefox:
    'W Firefoksie nagrywanie plików z dysku nie jest obsługiwane. Otwórz stronę przez http:// lub https://.',
  noTab: 'Nie widzę otwartej strony. Kliknij kartę ze stroną i spróbuj ponownie.',
  failed:
    'Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki.',
});

const CLOCK_RE = /^\d{2}:\d{2}:\d{2}$/;
const UNKNOWN_CLOCK = '--:--:--';

// Local wall-clock time as HH:MM:SS. Formatted by hand (no toLocaleTimeString), so the
// text does not depend on the browser locale. Accepts epoch ms or an ISO string.
export function formatClock(time) {
  const date = new Date(typeof time === 'string' || typeof time === 'number' ? time : NaN);
  if (Number.isNaN(date.getTime())) return UNKNOWN_CLOCK;
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

// An already formatted "HH:MM:SS" passes through; anything else goes through formatClock.
function clockText(startedAt) {
  return typeof startedAt === 'string' && CLOCK_RE.test(startedAt) ? startedAt : formatClock(startedAt);
}

const OUTCOME_KINDS = [
  'saveCancelled',
  'downloadFailed',
  'pageBusy',
  'permissionDenied',
  'recordFailed',
  'restricted',
  'fileAccess',
  'noTab',
  'failed',
];

// Maps an outcome { kind, fileName? } to a reporter-facing text. Anything unexpected
// (unknown kind, saved without a file name) is reported as a plain failure.
export function messageFor(outcome) {
  const kind = outcome && outcome.kind;
  if (kind === 'saved' && typeof outcome.fileName === 'string' && outcome.fileName) {
    return MESSAGES.saved(outcome.fileName);
  }
  return OUTCOME_KINDS.includes(kind) ? MESSAGES[kind] : MESSAGES.failed;
}
