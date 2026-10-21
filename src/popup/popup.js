const runButton = document.getElementById('runSnapshot');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', !!isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  setStatus('Uruchamianie snapshotu...');

  try {
    const tab = await getActiveTab();

    if (!tab?.id) {
      throw new Error('Nie udało się pobrać aktywnej karty.');
    }

    if (!tab.url || !/^https?:|^file:/.test(tab.url)) {
      throw new Error('Ta karta nie obsługuje uruchomienia rozszerzenia.');
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['inject.js']
    });

    setStatus('Snapshot został uruchomiony i pobrany.');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Wystąpił błąd.', true);
  } finally {
    runButton.disabled = false;
  }
});