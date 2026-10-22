---
name: mv3-extension-rules
description: Reguły Manifest V3 dla Page Debug Snapshot — światy MAIN/ISOLATED, prywatny kanał MAIN/ISOLATED (bez postMessage), service worker bez stanu, minimalne uprawnienia, registerContentScripts, pułapki hooków na fetch/XHR/console. Czytaj przed projektowaniem lub implementacją czegokolwiek w rozszerzeniu.
---

# Reguły MV3 dla tego projektu

## Trzy światy, trzy zestawy możliwości

| Świat | Widzi `window` strony | Widzi `chrome.*` | Do czego |
|---|---|---|---|
| **MAIN** | tak (ten sam `window`, `fetch`, `XMLHttpRequest`, `console`) | **nie** (tylko `chrome.runtime` może nie istnieć w ogóle) | hooki, odczyt zmiennych strony, Performance API |
| **ISOLATED** (content script) | DOM tak, zmienne JS strony **nie** | `chrome.runtime`, `chrome.storage` | most do SW, rejestracja kliknięć/inputów, screenshot-trigger |
| **Service worker** | nic | wszystko z manifestu | `scripting`, `webRequest`, `tabs.captureVisibleTab`, `storage.session`, stan nagrywania |

Konsekwencje:
- Hooki **muszą** być w MAIN — inaczej podmieniasz `fetch` w izolowanym świecie, którego strona nie używa.
- Z MAIN do SW idzie się przez ISOLATED: prywatny kanał (patrz niżej, **nie** `window.postMessage`) → `chrome.runtime.sendMessage`.
- Nigdy nie wstrzykuj `<script src=chrome-extension://…>` do strony (to robi obecny `inject.js`) —
  wymaga `web_accessible_resources`, ujawnia ID rozszerzenia, łamie CSP niektórych stron.
  Zamiast tego: `chrome.scripting.executeScript({ target, world: 'MAIN', files: [...] })` lub
  `chrome.scripting.registerContentScripts([{ id, matches, js, world: 'MAIN', runAt: 'document_start' }])`.

## Nagrywanie od startu strony

`executeScript` po kliknięciu w popup jest **za późno** — strona już się załadowała. Jedyny sposób na
dane od pierwszego bajtu:

1. Popup → SW: `startRecording(tabId)`.
2. SW: `registerContentScripts` z `matches` = origin karty + `/*`, `runAt: 'document_start'`,
   `world: 'MAIN'` (recorder) **i** osobny wpis `world: 'ISOLATED'` (most + kroki użytkownika).
   `persistAcrossSessions: false`.
3. SW: zapis `{ tabId, origin, startedAt, status: 'recording' }` w `chrome.storage.session`.
4. SW: `chrome.tabs.reload(tabId)`.
5. Przy `stopAndCollect`: komunikat do ISOLATED → MAIN zbiera snapshot → z powrotem → SW dokleja
   webRequest/screenshot → `unregisterContentScripts` → `storage.session` czyścimy.

`registerContentScripts` wymaga permission `scripting` i **host permission** dla `matches`. Przy
`activeTab` + `optional_host_permissions` można poprosić o origin w locie
(`chrome.permissions.request({ origins: [origin + '/*'] })`) z gestu użytkownika w popupie. Preferuj to
nad statycznym `<all_urls>`.

## Kanał MAIN ↔ ISOLATED — nie `postMessage` (E1, D3)

`window.postMessage` jest widoczny dla **każdego** listenera `message` strony: po pierwszym komunikacie strona zna nonce, czyta
bufor przy `flush`/`collect` i może podrabiać odpowiedzi. `MessageChannel` przekazany przez `postMessage` też nie pomaga (zdarzenie jest
asynchroniczne, inline'owy skrypt w `<head>` może przechwycić port). Dlatego wzorzec projektu (`src/page/channel.js`):

1. Oba skrypty startują na `document_start`, przed jakimkolwiek skryptem strony. ISOLATED tworzy **odłączony węzeł DOM**
   (poza drzewem, strona nie ma do niego referencji) i nonce (`crypto.getRandomValues` — `randomUUID` wymaga secure context).
2. Węzeł trafia do MAIN synchronicznie: `document.dispatchEvent(new MouseEvent('pds:isolated-ready', { relatedTarget: node }))`.
   Węzły DOM są wspólne dla światów, `dispatchEvent` jest synchroniczny. Kolejność światów nie ma znaczenia: MAIN odpowiada
   `pds:main-ready`, a ISOLATED na to ponownie wysyła `pds:isolated-ready`. Po związaniu oba usuwają listenery z `document`;
   MAIN przyjmuje tylko pierwszy węzeł.
3. Dalej wyłącznie `CustomEvent` na tym węźle, a `detail` to **string** JSON `{ n: nonce, v: protokół, id?, type, payload }`
   (obiekty przez granicę światów zawodzą: Firefox Xray). Odbiorca odrzuca zły `n`; odpowiedź `collect` musi mieć zgodne `id`.
4. **Intrinsics** (`Reflect`, `Proxy`, `JSON`, `Error`, `Date.now`, `addEventListener`/`dispatchEvent`, `CustomEvent`, `MouseEvent`, `WeakMap`)
   przechwytujemy przy instalacji na `document_start` — strona nie zdąży ich podmienić.
5. Z MAIN do tła idzie się tylko przez ISOLATED → `runtime.sendMessage` (w MAIN nie ma `chrome.*`). Jeśli handshake się nie uda,
   most zgłasza `bridgeError` (np. `unbound`), a dokument jest oznaczony jako nienagrany; wynik zapisu i nazwę pliku zawsze ustala tło.

Test akceptacyjny: unit `channel.test.js` i e2e `isolation.spec.js` na wrogiej stronie (`hostile.html`).

## Service worker nie ma pamięci

SW jest ubijany po ~30 s bezczynności. Każdy stan → `chrome.storage.session` (znika z zamknięciem
przeglądarki — dokładnie to, czego chcemy). Mapy `requestId → dane` z webRequest też tam, batched.
Nie trzymaj listenerów rejestrowanych warunkowo — rejestruj na top-level SW.
**Terminy liczymy z `Date.now()`, nie z `performance.now()`** (monotoniczny zegar staje podczas uśpienia komputera, więc limit nagrywania
byłby przedłużony). Uwaga: `setTimeout` też jest monotoniczny — auto-stop po uśpieniu zapada dopiero przy odpaleniu timera, więc przy zbieraniu
odrzucaj wpisy po terminie i sprawdzaj termin leniwie (`getStatus`/`hello`).

## Uprawnienia — co i dlaczego

| Permission | Potrzebne do | Kiedy |
|---|---|---|
| `activeTab` | dostęp do bieżącej karty po kliknięciu, `captureVisibleTab` | zawsze |
| `scripting` | `executeScript`, `registerContentScripts` | zawsze |
| `storage` | `storage.session` dla stanu nagrywania | E1+ |
| ~~`tabs`~~ | **nie** — `activeTab` daje `tab.url` po kliknięciu, `tabs.reload` nie wymaga `tabs`; `tabs` dodaje ostrzeżenie „Read your browsing history” (store review E0) | — |
| `webRequest` | kody HTTP i rozmiary zasobów (tylko obserwacja w MV3) | E2 (decyzja) |
| `downloads` | zapis paczki przez `downloads.download` + sukces dopiero po `onChanged.state === "complete"` (fałszywy sukces z `<a download>` przy zablokowanych pobraniach — re-QA E0) | **E1** (decyzja użytkownika 2026-10-22) |
| `optional_host_permissions: ["https://*/*", "http://*/*", "file:///*"]` | `registerContentScripts` dla origin karty (żądane w locie, jeden wzorzec; `file:///*` tylko dla lokalnego pliku) | E1+ |

**Nie**: `<all_urls>` w `host_permissions` (statycznie), `cookies` (HttpOnly to świadomy brak —
nie chcemy ich w paczce), `tabCapture`/`desktopCapture`.

## Hooki — pułapki, które już nas ugryzły

- Podmiana `window.XMLHttpRequest = function DebugXHR() {...}` psuje `instanceof`, `XMLHttpRequest.DONE`,
  `XMLHttpRequest.prototype`. Użyj `class PdsXHR extends XMLHttpRequest` z nadpisanymi `open/send/
  setRequestHeader` **albo** `new Proxy(XMLHttpRequest, { construct })` zwracającego oryginalną instancję
  z dodanymi listenerami. Test: `new XMLHttpRequest() instanceof XMLHttpRequest`, `XMLHttpRequest.DONE === 4`.
- `fetch` może dostać `Request` jako pierwszy argument — nie zakładaj stringa. Czytanie body odpowiedzi
  wyłącznie z `response.clone()`, i tylko gdy decyzja (E2-D3) na to pozwala.
- `console.*` hook: owijając metodę gubisz źródło logu w DevTools (wszystko wskazuje na recorder).
  Zapisz `new Error().stack` w rekordzie, a oryginał wywołaj przez `Reflect.apply(orig, console, args)`.
  Nie da się w pełni zachować lokalizacji w DevTools — zapisz to jako znane ograniczenie w docs.
- Podwójna instalacja (dwa razy `init`) = podwójne logi. Marker na `window` (`Symbol.for('pds.installed')`).
- `destroy()` przywraca **wszystko**, łącznie z listenerami `error`/`unhandledrejection`
  (trzymaj referencje do handlerów).

## Popup

Popup żyje tylko gdy jest otwarty. Nie trzymaj w nim stanu — pytaj SW (`getStatus`). Każdy komunikat
do zgłaszającego po polsku, bez żargonu. Trzy stany: *Gotowy* / *Nagrywam od HH:MM:SS* / *Zapisano*.

## Firefox — jedna baza kodu, dwa manifesty

Firefox obsługuje MV3, `scripting.executeScript` / `registerContentScripts` z `world: "MAIN"` (od **128**),
`storage.session` (115+), `webRequest` (obserwacyjnie i blokująco), `tabs.captureVisibleTab`, `downloads`.
Różnice, które trzeba obsłużyć:

| Temat | Chrome | Firefox | Co robimy |
|---|---|---|---|
| Tło | `background.service_worker` | `background.scripts` (event page; brak SW) | **oba klucze** w manifeście — Chrome ≥121 i Firefox ≥121 akceptują; jeden plik `background.js` działający w obu modelach |
| Identyfikator | — | `browser_specific_settings.gecko.id`, `strict_min_version: "128.0"` wymagane | tylko w `manifest.firefox.json` |
| Min. wersja | `minimum_chrome_version` | nieznany klucz (lint ostrzega) | tylko w `manifest.chrome.json` |
| Host permissions | `host_permissions` nadawane przy instalacji | w MV3 **wszystkie opcjonalne** — trzeba `permissions.request` z gestu | zawsze flow `optional_host_permissions` + request z popupu; identyczny kod |
| API | `chrome.*` z promisami | `browser.*` i alias `chrome.*`, oba z promisami | `chrome.*` + `await`; zero callbacków; `importScripts` zakazane |
| Instalacja na stałe | unpacked w trybie dev / CWS / policy | **podpis AMO wymagany** nawet do self-hostingu; tymczasowa przez `about:debugging` znika po restarcie | E5 |
| Performance API | pełne | brak `layout-shift`, `interactionId`, `long-animation-frame` | E2: raportować „niedostępne w Firefoksie” |
| Lint | — | `web-ext lint` | w `npm run lint` dla `dist/firefox` |

Build: `src/manifest.base.json` + `manifest.chrome.json` + `manifest.firefox.json` → `dist/chrome/manifest.json`,
`dist/firefox/manifest.json`. Test automatyczny: oba manifesty identyczne poza listą kluczy dozwolonych
do różnienia się (`browser_specific_settings`, `minimum_chrome_version`, `background`).

Reguła kodu tła: pisz tak, jakby proces mógł zniknąć po każdym zdarzeniu (prawda w obu przeglądarkach).
Stan → `storage.session`. Listenery na top-level. Bez `self.importScripts`, bez `window`.

## CSP i strony specjalne

- `chrome://`, `edge://`, `about:`, `moz-extension://`, Web Store/AMO, `file://` bez zgody — `executeScript`
  rzuci. Popup ma to złapać i powiedzieć po polsku „Na tej stronie nie da się zapisać paczki”; dla `file://`
  dodatkowo podpowiedzieć, gdzie włączyć „Zezwalaj na dostęp do adresów URL plików” (decyzja E0 #4).
- Strony z `Content-Security-Policy` blokującym `connect-src` nie przeszkadzają hookom (hooki nie robią
  własnych requestów). Nie wysyłaj nic z MAIN world do sieci.
