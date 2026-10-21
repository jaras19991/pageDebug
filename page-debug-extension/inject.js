(() => {
  const SCRIPT_ID = '__page_debug_snapshot_injected_script__';

  function injectPageScript() {
    return new Promise((resolve, reject) => {
      if (document.getElementById(SCRIPT_ID)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = chrome.runtime.getURL('page-debug-snapshot.js');

      script.onload = () => {
        script.remove();
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Nie udało się załadować page-debug-snapshot.js'));
      };

      (document.head || document.documentElement).appendChild(script);
    });
  }

  async function run() {
    await injectPageScript();

    if (!window.PageDebugSnapshot) {
      throw new Error('window.PageDebugSnapshot nie istnieje po wstrzyknięciu.');
    }

    if (!window.PageDebugSnapshot.initialized) {
      window.PageDebugSnapshot.init({
        createFloatingButton: false
      });
    }

    window.PageDebugSnapshot.download();
  }

  run().catch((error) => {
    console.error('[PageDebugSnapshot Extension]', error);
  });
})();