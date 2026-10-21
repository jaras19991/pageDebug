// Every text the reporter can see in the popup. Outcomes form a closed set
// (success | restricted | fileAccess | noTab | failed); technical details never reach
// this dictionary — they go to the popup's console.error for developers only.
export const MESSAGES = Object.freeze({
  working: 'Zapisuję paczkę…',
  success: (fileName) =>
    `Gotowe. Zapisano plik ${fileName} — znajdziesz go w pobranych plikach.`,
  restricted:
    'Na tej stronie nie da się zapisać paczki. Otwórz stronę, na której widzisz problem, i kliknij ponownie.',
  fileAccess:
    'To jest plik z dysku. Żeby zapisać paczkę, wpisz w pasku adresu chrome://extensions, kliknij „Szczegóły” przy Page Debug Snapshot i włącz „Zezwalaj na dostęp do adresów URL plików”. Potem odśwież stronę i kliknij ponownie.',
  noTab: 'Nie widzę otwartej strony. Kliknij kartę ze stroną i spróbuj ponownie.',
  failed:
    'Nie udało się zapisać paczki. Odśwież stronę i spróbuj ponownie. Jeśli to się powtarza, opisz problem developerowi bez paczki.',
});

const OUTCOME_KINDS = ['restricted', 'fileAccess', 'noTab', 'failed'];

// Maps an outcome { kind, fileName? } to a reporter-facing text. Anything unexpected
// (unknown kind, success without a file name) is reported as a plain failure.
export function messageFor(outcome) {
  const kind = outcome && outcome.kind;
  if (kind === 'success' && typeof outcome.fileName === 'string' && outcome.fileName) {
    return MESSAGES.success(outcome.fileName);
  }
  return OUTCOME_KINDS.includes(kind) ? MESSAGES[kind] : MESSAGES.failed;
}
