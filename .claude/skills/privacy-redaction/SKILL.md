---
name: privacy-redaction
description: Polityka i reguły maskowania danych wrażliwych w paczce Page Debug Snapshot — co zawsze maskujemy, co domyślnie, jakie wzorce i klucze, jak wygląda ślad redakcji, jak to testować. Czytaj gdy dotykasz czegokolwiek, co trafia do pliku: storage, cookies, nagłówki, console, URL-e, kroki użytkownika, HTML.
---

# Redakcja danych wrażliwych

Założenie: **zgłaszający wyśle paczkę e-mailem, wrzuci na Slacka albo do Jiry. Nie przeczyta jej
przed wysłaniem.** Każda wartość, która może go skompromitować lub umożliwić przejęcie sesji,
ma zniknąć zanim plik powstanie. Lepiej zamaskować za dużo niż za mało — developer może poprosić
o drugą paczkę z poluzowaną konfiguracją; nie może cofnąć wysłanego tokena.

## Trzy poziomy

| Poziom | Co | Czy developer może wyłączyć |
|---|---|---|
| **Zawsze** | wartości cookies, nagłówki `Authorization`/`Cookie`/`Set-Cookie`/`X-Api-Key`/`X-Auth-*`, wartości inputów (poza typem i długością), wzorce JWT/Bearer/kart/IBAN/PESEL | **nie** |
| **Domyślnie** | wartości localStorage/sessionStorage dla kluczy pasujących do listy, query stringi z kluczami z listy, e-maile i numery telefonów w argumentach console i body odpowiedzi, pełny `outerHTML` | tak, w konfiguracji developerskiej (nigdy w UI zgłaszającego) |
| **Zostaje** | nazwy i rozmiary cookies, klucze storage, URL-e bez wrażliwych parametrów, kody HTTP, nagłówki niewrażliwe, metryki, struktura DOM bez tekstów, komunikaty błędów | — |

## Reguły (wersja `rulesVersion: 1`)

### Klucze (case-insensitive, dopasowanie do nazwy klucza/parametru/nagłówka)
```
token, access_token, refresh_token, id_token, auth, authorization, session, sessionid, sid, jwt,
secret, api_key, apikey, key, password, passwd, pwd, csrf, xsrf, cookie, set-cookie, bearer,
credential, private, signature, sig, otp, pin
```
Dopasowanie: klucz **zawiera** którykolwiek z tokenów jako wyraz (`user_token` tak, `tokenizer` — nie;
użyj granic `[_\-.]|^|$`). Fałszywie dodatnie są akceptowalne, fałszywie ujemne nie.

### Wzorce wartości (niezależnie od klucza)
| Nazwa reguły | Regex (szkic — implementer dopracowuje i testuje) |
|---|---|
| `jwt` | `\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b` |
| `bearer` | `\bBearer\s+[A-Za-z0-9._~+/=-]{16,}` |
| `email` | `\b[\w.+-]+@[\w-]+\.[\w.-]+\b` |
| `card` | 13–19 cyfr z opcjonalnymi spacjami/myślnikami, **plus walidacja Luhna** (inaczej maskuje timestampy) |
| `iban` | `\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b` |
| `pesel` | `\b\d{11}\b` z walidacją sumy kontrolnej |
| `phone` | `\b(\+48\s?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b` (tylko w console/body, nie w URL-ach — za dużo FP) |
| `long-secret` | ciąg ≥ 32 znaków `[A-Za-z0-9+/=_-]` bez spacji o wysokiej entropii (Shannon > 4.0) — łapie klucze API bez znanego formatu |

### Gdzie stosować (każde miejsce = osobny test)
1. `storage.localStorage`, `storage.sessionStorage` — po kluczu i po wartości.
2. `storage.cookies` — wartość **zawsze** → `valueHash` (SHA-256 → pierwsze 8 hex). Nazwa zostaje.
3. `network[].requestHeaders`, `responseHeaders` — po kluczu.
4. `network[].url` — parametry query po kluczu; fragment `#…` z tokenem (OAuth implicit) → cały fragment.
5. `network[].responseBodyPreview` — po wzorcach.
6. `consoleLogs[].args` — rekurencyjnie po kluczach obiektów i wzorcach w stringach.
7. `runtimeErrors[].message/stack` — po wzorcach (stack może zawierać URL z tokenem).
8. `steps[]` — wartości inputów nigdy nie są zbierane (redakcja u źródła, nie post-factum).
9. `dom.structure` — bez tekstów i `value`; `dom.forms[].elements[].value` → tylko `valueLength`.
10. `environment.location.href/search/hash` — jak URL-e.
11. `summary.md` — generowany **z już zredagowanego** snapshotu. Nigdy z surowego.

## Ślad redakcji

- Wartość → string `"[redacted:<reguła>]"`, np. `"[redacted:key-token]"`, `"[redacted:jwt]"`.
  Nigdy `null`, nigdy pusty string, nigdy usunięcie klucza (developer ma wiedzieć, że coś tam było).
- Dla cookies: `{ name, sizeBytes, valueHash }` — hash pozwala porównać dwa zrzuty („czy to ta sama sesja”).
- `snapshot.redaction = { rulesVersion, masked: { "<sekcja>": <liczba> } }`.
- `summary.md` ma linię: „Zamaskowano N wartości w M sekcjach (reguły v1). Hasła, tokeny i dane logowania
  nie są w tym pliku.”

## Architektura

`redact.js` — czysta funkcja `redact(snapshot, options) → { snapshot, report }`. Bez dostępu do DOM.
Uruchamiana w ISOLATED lub SW (nie w MAIN — strona mogłaby ją podmienić). Idempotentna:
`redact(redact(x)) ≡ redact(x)`. Nie zmienia kształtu obiektu (klucze, typy kontenerów).

## Testy obowiązkowe

- Korpus `tests/fixtures/redaction/sensitive.json` (≥ 30 przykładów: JWT, Bearer, klucze AWS/Stripe-like,
  e-maile, karty z Luhnem, PESEL, IBAN, tokeny w URL, w stacku, w zagnieżdżonym obiekcie console)
  → **0** przecieków (grep po oryginalnych wartościach w wyniku).
- Korpus `benign.json` (≥ 30: timestampy, UUID-y w URL-ach, hashe commitów, base64 małych obrazków,
  liczby, zwykły tekst) → ≤ 2 fałszywie dodatnie. Każdy FP udokumentowany.
- Idempotencja i zachowanie kształtu.
- E2E: strona fixture z tokenem w localStorage, cookie `sid`, formularzem z e-mailem i hasłem →
  po zapisie `grep -c <wartość> snapshot.json summary.md` = 0 dla każdej.

## Czego nie robimy

- Nie zbieramy ciasteczek HttpOnly (brak `cookies` permission) — celowo.
- Nie wysyłamy niczego nigdzie. Redakcja jest lokalna; paczka zostaje na dysku zgłaszającego, dopóki
  sam jej nie wyśle.
- Nie dajemy zgłaszającemu przełącznika „pokaż pełne dane” — to decyzja developera w jego konfiguracji.
