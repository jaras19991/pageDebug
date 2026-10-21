---
name: mv3-extension-rules
description: Reguły Manifest V3 dla Page Debug Snapshot — światy MAIN/ISOLATED, komunikacja postMessage z nonce, service worker bez stanu, minimalne uprawnienia, registerContentScripts, pułapki hooków na fetch/XHR/console. Czytaj przed projektowaniem lub implementacją czegokolwiek w rozszerzeniu.
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
- Z MAIN do SW idzie się przez ISOLATED: `window.postMessage` → listener w ISOLATED → `chrome.runtime.sendMessage`.
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

## postMessage między MAIN a ISOLATED — wzorzec

```js
// ISOLATED (ustawia nonce w DOM zanim MAIN wystartuje — oba są document_start, ISOLATED pierwszy
// jeśli zarejestrowany pierwszy; nie polegaj na tym: MAIN czeka na handshake)
const nonce = crypto.randomUUID();
document.documentElement.dataset.pdsNonce = nonce; // MAIN odczyta i usunie

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__pds !== nonce) return;
  chrome.runtime.sendMessage(e.data.payload);
});
```
Zawsze: `e.source === window`, porównanie nonce, brak `'*'` jako targetOrigin bez powodu (tu jest OK,
bo wysyłamy do własnego `window`, ale sprawdzamy nonce).

## Service worker nie ma pamięci

SW jest ubijany po ~30 s bezczynności. Każdy stan → `chrome.storage.session` (znika z zamknięciem
przeglądarki — dokładnie to, czego chcemy). Mapy `requestId → dane` z webRequest też tam, batched.
Nie trzymaj listenerów rejestrowanych warunkowo — rejestruj na top-level SW.

## Uprawnienia — co i dlaczego

| Permission | Potrzebne do | Kiedy |
|---|---|---|
| `activeTab` | dostęp do bieżącej karty po kliknięciu, `captureVisibleTab` | zawsze |
| `scripting` | `executeScript`, `registerContentScripts` | zawsze |
| `storage` | `storage.session` dla stanu nagrywania | E1+ |
| `tabs` | `tabs.reload`, odczyt `tab.url` do `matches` | E1+ |
| `webRequest` | kody HTTP i rozmiary zasobów (tylko obserwacja w MV3) | E2 (decyzja) |
| `downloads` | zapis paczki z nazwą i bez okna „zapisz jako” | opcjonalnie E3/E4 |
| `optional_host_permissions: ["https://*/*", "http://*/*"]` | `registerContentScripts` dla origin karty | E1+ |

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

## CSP i strony specjalne

- `chrome://`, `edge://`, Web Store, `file://` bez zgody — `executeScript` rzuci. Popup ma to złapać
  i powiedzieć „Na tej stronie nie da się nagrywać”.
- Strony z `Content-Security-Policy` blokującym `connect-src` nie przeszkadzają hookom (hooki nie robią
  własnych requestów). Nie wysyłaj nic z MAIN world do sieci.
