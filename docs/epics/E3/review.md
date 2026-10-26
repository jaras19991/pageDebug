# E3 — Review (z E3-R1)

Data: 2026-10-26 · reviewer: pds-reviewer (zapis raportu: orkiestrator — rola reviewera tylko do odczytu).
Zakres: `git diff 3b01fa7 -- src tests scripts` plus nowe pliki w `src/lib` i `src/page`. Bez generowanych bundli (`npm run gen -- --check` = up to date). Manifesty bez zmian.
Werdykt: **request-changes** (jest 1 critical i 1 high).
Artefakty R1 (poza repo): skrypt `scratchpad/r1/r1.mjs` (jsdom + `console-snapshot.js`, ten sam `exportAssembled` co tło), wynik w `scratchpad/r1/out/`.

## Findings (posortowane po wadze)

**F1 [critical] `src/lib/redact-rules.js:178` (JSON_PAIR) i `src/lib/redact-page.js:80`: klucze wrażliwe w JSON-ie zagnieżdżonym w stringu albo zakodowanym encjami nie są maskowane.**
- Scenariusz 1: `localStorage['persist:root']` (redux-persist) = `{"account":"{\"currentUser\":{\"accessToken\":\"9f86d081884c7d659a2feaa0c55ad015\",\"refreshToken\":\"rf8Kq2Lm7Np\",\"password\":\"Pers1stPwd!x\"}}"}`. Wszystkie trzy wartości trafiają do `snapshot.json` jawnie. Maskowany jest tylko e-mail, przez wzorzec. Token hex ma niską entropię, a krótki token jest za krótki, więc `long-secret` żadnego nie łapie.
- Scenariusz 2: `<div data-props="{&quot;apiKey&quot;:&quot;dataApiK3y77&quot;}">` w `dom.structure`. Wartość zostaje, bo `domEscapeAttr` zamienia `"` na `&quot;` i JSON_PAIR, ATTRIBUTE ani COLON_PAIR tego nie dopasowują.
- Oba przypadki potwierdzone w R1 i w `node` na `redact()`. Ten sam problem dotyczy podwójnie serializowanego JSON-u w `consoleLogs` i w `requestBody`.
- Poprawka: przebieg tekstowy obsługuje pary JSON z escape'ami (`\\*"k\\*"\s*:\s*\\*"v`, dowolny poziom) i z `&quot;`. Druga możliwość: wartości storage i stringi, które parsują się jako JSON, redagować strukturalnie (`ctx.deep` na wyniku `JSON.parse`, rekurencyjnie dla stringów-JSON-ów) i serializować z powrotem. Do korpusu `sensitive` dopisać przypadek redux-persist i `data-*` z `&quot;`.

**F2 [high] Cięcie przed redakcją zostawia początek sekretu.**
- Miejsca: `src/page/hooks-network.js:149` (`bodyPreview` → `slice` 5000), `src/page/collector.js:286` (storage `safeSlice` 5000), `src/page/serialize.js:146` (`copyString` / `preview` 40 000), `src/page/dom-structure.js:131` (wartość atrybutu 2000).
- Scenariusz: `console.log('big', '{"x":"<39 950×a>","password":"CutBoundaryPwd123"}')` daje w paczce `\"password\":\"CutBoundaryPwd1`. JSON_PAIR wymaga cudzysłowu zamykającego, a COLON_PAIR wyklucza klucz w cudzysłowie, więc nic go nie maskuje (R1). To samo dzieje się z `requestBody` dłuższym niż 5000 znaków i ze storage. `export.js:6–7` opisuje dokładnie ten problem, ale rozwiązuje go tylko dla cięcia budżetowego w tle.
- Poprawka: JSON_PAIR i XML/ATTRIBUTE akceptują wartość niezamkniętą na końcu tekstu albo przed `... [truncated`, i maskują ją do końca. Alternatywa: w MAIN maskować przed cięciem (`maskSecrets` → cut), tak jak już robią to podglądy odpowiedzi. Test: pułapka na granicy każdego z czterech limitów.

**F3 [medium] `src/lib/redact-rules.js:189` (COLON_PAIR): para `klucz: "wartość"` (klucz bez cudzysłowu, wartość w podwójnym cudzysłowie) nie jest maskowana.**
- Scenariusz: `console.log('config: {password: "QuotedPwd77"}')` zostawia hasło jawnie (R1). To samo w YAML (`password: "x"`) i w źródle JS w podglądach odpowiedzi. Wartość w apostrofach jest maskowana, w cudzysłowie nie.
- Poprawka: w COLON_PAIR dopuścić wartość w `"…"` (z escape'ami) i maskować jej wnętrze. Przypadek dodać do korpusu.

**F4 [medium] `src/popup/messages.js:15,19` i `src/popup/popup.html:127`: tekst ujawnienia mówi „pola formularzy są na nim zakryte”, a według PB-1 = B pola w ramkach cross-origin (płatności, SSO) nie są zakrywane.** (= store S1, high)
- Scenariusz: zgłaszający wpisał numer karty w iframe Stripe/PayU, czyta „pola formularzy są zakryte” i wysyła paczkę. Na `screenshot.jpg` numer karty jest widoczny.
- Poprawka: na przykład „pola formularzy tej strony są zakryte; formularze osadzone z innych serwisów (np. płatności) mogą być widoczne” (AC-1.3 pozwala na jedno zdanie o ograniczeniach). Treść zatwierdza użytkownik.

**F5 [low] `src/lib/redact-rules.js:80` (lista kluczy): `?code=` (kod autoryzacji OAuth) i `?ticket=` (CAS) zostają w URL-ach.**
- Scenariusz: R1 `https://…/reset?code=oAuthC0deQ9w8` daje jawny kod w `steps[].url`, `documents[].url` i `environment.location`. Wykorzystać go trudno (jednorazowy, krótko ważny, zwykle PKCE).
- Poprawka: dodać `code` i `ticket` tylko do kluczy query w polach-URL. Ryzyko FP (`?code=PL`) jest w sekcji „Do decyzji”.

**F6 [low] Luki w liście kluczy skilla: `cvv`, `cvc`, `pass`, `pw`.**
- Scenariusz: `sessionStorage.checkout = "card=…&cvv=737"` daje `cvv=737` jawnie (R1; numer karty zamaskowany wzorcem). `{"pass":"hunter22"}` i `{"pw":…}` też zostają.
- Poprawka: dopisać klucze do `rulesVersion` (zmiana skilla należy do użytkownika). AWS `AKIA…` to sam identyfikator klucza, a sekret (40 znaków, mixed case) łapie `long-secret` (sprawdzone), więc to tylko informacja.

**F7 [low] `src/page/collector.js:77,184,190`: dane osobowe w `environment.document.title`, `dom.images[].alt` i `dom.iframes[].title`.**
- Scenariusz: tytuł „Konto: Zenobia Pulapkowska” i alt „Avatar Zenobii Pulapkowskiej” trafiają do paczki jawnie (R1). D5 wyklucza `alt`/`title` ze struktury, ale listy `dom.*` je zachowują, co jest niespójne z „struktura DOM bez tekstów”.
- Poprawka: `alt` i `title` w listach zamienić na długość albo na znacznik. Tytuł dokumentu to decyzja użytkownika.

**F8 [low] `src/lib/redact-rules.js:187` (FORM_PAIR): w zwykłym tekście wartość pochłania `?` i dalszą część adresu.**
- Scenariusz: stack `https://a.pl/app;jsessionid=ABC123?x=1&y=2` daje `;jsessionid=[redacted:key-session]&y=2`, więc `?x=1` znika. To utrata danych, nie wyciek.
- Poprawka: wykluczyć `?` i `/` z wartości FORM_PAIR, kiedy klucz poprzedza `;`, albo przepuścić URL-e w tekście przez `maskUrl`.

**F9 [low] `src/lib/redact-rules.js:106,108` (`toLowerCase`) i inne metody prototypów strony w MAIN (`slice`, `includes`, `sort`, iterator tablic; `serialize.js` `ancestors.includes`).**
- Scenariusz: strona podmienia `String.prototype.toLowerCase`. Wtedy `secretKeyRule('Authorization')` = null i `requestHeaderValue` zapisuje jawny nagłówek w buforze i w `pds:doc:*` (`storage.session`) do czasu `finalize`. Do pliku nie trafi, bo tło redaguje w swoim realmie. Obrona w głąb z D1 przestaje jednak działać.
- Poprawka: przechwycić `toLowerCase` i `slice` tak jak `RegExp` (`Reflect.apply` na zapamiętanych metodach) w `secretKeyRule` i w `urlField`.

**F10 [low] `src/lib/redact-page.js:17`: nazwa `local${'Storage'}` sklejana z części, żeby ominąć test `background-router.test.js:66`.**
- Scenariusz: przyszły kod tła `globalThis[`local${'Storage'}`]` przejdzie strażnika i padnie w SW (brak `localStorage`). W `budget.js` jest drugie, inne obejście tego samego (wykrywanie po kształcie).
- Poprawka: test zabrania użycia identyfikatora (`\blocalStorage\s*[.[(]` i gołego `localStorage` poza literałem string). Wtedy klucz schematu można pisać wprost.

**F11 [low] `scripts/lib/reachability.mjs:13–17`: walker osiągalności traktuje `x.url(` i `files:` w komentarzach jako odwołania do plików.**
- Scenariusz: implementer musiał zmienić `ctx.url` na `ctx.urlValue` i omijać słowa w komentarzach. Każda taka obrona tylko wymusza nazewnictwo.
- Poprawka: walker pomija komentarze i wywołania metod (`\.url\(`). Do retro albo do CLAUDE.md.

**I1 [info]** `valueHash` ciasteczek bez soli: wartość o niskiej entropii (`uid=12345`) da się odgadnąć. Akceptowane w D4/AC-4.4.
**I2 [info]** Sekcje v1 `dom` (`meta`/`scripts`/`iframes`/`rootMarkers`) czytają żywe gettery strony. Wroga strona może co najwyżej sfałszować dane albo wyzerować sekcję. Nie ma wycieku, bo redaguje tło.

## Sprawdzone i OK
- Zrzut działa fail-closed. `maskScreenshot`/`takeScreenshot` (`save.js:198–224`, `screenshot.js`) nie zwracają niezamaskowanego obrazu przy żadnym błędzie: brak kodeka, wyjątek, zła skala, pinch-zoom, brak odpowiedzi R1 albo R2, przesunięcie widoku, timeout. Obraz bez maski żyje tylko w pamięci tła. `fieldRects` przyjmuje tylko komunikaty od tła i liczy w ISOLATED.
- Ciasteczka: wartości nie opuszczają `parseCookies`. `sid` i `PHPSESSID` są nieobecne w paczce (R1). Nagłówki żądań są maskowane u źródła (Authorization, X-Session-Id), URL-e w hookach przez `maskUrl` z fail-closed `[redacted:url]`.
- Potok: kolejność `assemble → cięcie całych wpisów → redact (kopia w realmie tła) → budżet → countMarkers → summary z obiektu zredagowanego → zip`. Paczka nie trafia do `storage.*`. `pds:doc:*` są czyszczone w `finalize` i przy przycinaniu do 100 (z obsługą wyścigu `flush`).
- IN4: `input[type=file]` daje tylko `fileCount`, bez `valueLength` i `fakepath`. Formularze dają `valueLength`, hasło bez długości. W `dom.structure` nie ma `value` ani tekstów.
- `npm run gen -- --check` jest czysty. Manifesty bez zmian względem v0.4.0. Teksty UI są po polsku.

## E3-R1 lista kontrolna (skill privacy-redaction, „Gdzie stosować”)
Źródło: realistyczna strona w jsdom, wklejony `console-snapshot.js`, czyli ten sam `exportAssembled` co tło. Na stronie: redux-persist, JWT, profil, `checkout` w storage, ciasteczka `sid`/`PHPSESSID`/`_ga`, URL z `?code=`, `&email=` i `#access_token=`, referrer z `?token=`, formularz (email, hasło, hidden token, tel, karta, PESEL w textarea, IBAN w contenteditable), `meta csrf-token`, `data-props`, logi konsoli, `Error`, `pushState`, 2× XHR. Wyniki: grep pełnej wartości oraz pierwszych i ostatnich 8 znaków po rozpakowaniu.

| # | Punkt | Wynik |
|---|---|---|
| 1 | `storage.localStorage`/`sessionStorage` | **FAIL**: zagnieżdżony JSON (F1), `cvv` (F6). JWT, e-mail, telefon, IBAN, karta są maskowane. |
| 2 | `storage.cookies` | PASS: `[{name,sizeBytes,valueHash}]`, brak wartości. |
| 3 | `requestHeaders`/`responseHeaders` | PASS |
| 4 | `network[].url` (query, fragment) | PASS dla `session_id`, `token` i fragmentu; `?code=` w URL-ach nawigacji (F5). |
| 5 | `responseBodyPreview` | N/T w jsdom (XHR status 0). Pokryte przez unit i e2e. |
| 6 | `consoleLogs[].args` | **FAIL**: `k: "v"` (F3), ucięty preview (F2). Klucze obiektów, e-mail, Bearer i `Error` są OK. |
| 7 | `runtimeErrors` / `Error` w konsoli | PASS (e-mail i PESEL zamaskowane). |
| 8 | `steps[]` | PASS dla wartości (nie są zbierane); URL z `?code=` (F5). |
| 9 | `dom.structure` / `forms` | **FAIL** dla `data-*` z JSON w `&quot;` (F1). Bez tekstów, `valueLength`, ukryty token nieobecny, `meta csrf` zamaskowane: PASS. |
| 10 | `environment.location`/`referrer` | PASS dla tokenów, fragmentu i e-maila; `?code=` (F5); tytuł z imieniem i nazwiskiem (F7). |
| 11 | `summary.md` | PASS: powstaje ze zredagowanego obiektu, bez sekretów; linia „Zamaskowano 26 wartości w 7 sekcjach (reguły v1)…”. |
| — | `screenshot.jpg` | Nie sprawdzony ponownie (fallback nie robi zrzutu, przeglądarkę zajmuje QA). Pokrywa e2e TEST4 10/10. Ryzyko PB-1 opisane w F4. |

**Werdykt R1: FAIL.** Do poprawy przed release: F1 i F2. F3 jest zalecana w tej samej iteracji, bo jest tani i dotyczy tej samej funkcji.

## Do decyzji użytkownika
- F4: brzmienie zdania o iframe'ach płatności w ujawnieniu (wynika z PB-1 = B).
- F5 i F6: rozszerzenie listy kluczy `rulesVersion 1` (`code` i `ticket` tylko w query; `cvv`, `cvc`, `pass`, `pw`) w skillu i w korpusie, w zamian za ryzyko FP (`?code=PL`).
- F7: czy `document.title`, `img alt` i `iframe title` zamieniać na długość albo znacznik.

## Re-review iteracja 1 (2026-10-26)

Zakres: poprawki grup A i B (F1–F11, S1, S4, QA F-2/F-3/F-5). R1 powtórzone w jsdom na aktualnym `console-snapshot.js` (skrypty `scratchpad/r1/r1.mjs`, `r1b.mjs`; wyniki `out-it1/`, `out-it1b/`). Przeglądarki nie uruchamiano.
Werdykt: **approve** — brak critical/high. N1 zalecane przed release (regresja reguły Always). N2–N4, N6, N7 do decyzji użytkownika.

### Status poprzednich findings

| Finding | Status | Weryfikacja |
|---|---|---|
| F1 [critical] | **zamknięty** | `maskQuotedPairs`/`quotedValueEnd`: dowolny poziom escape, `&quot;`/`&#34;`/`&#x22;`. R1: redux-persist i `data-props` zamaskowane. `&amp;quot;` nieobsługiwane (I3). |
| F2 [high] | **zamknięty** | `TRUNCATED_TAIL` + wartości niezamknięte maskowane do końca; R1: konsola 40 000, `requestBody` 5000, atrybut 2000 OK. |
| F3 [medium] | **zamknięty** | `BARE_KEY`; efekt uboczny N7. |
| F4/S1 | **zamknięty** | Tekst w `messages.js`/`popup.html`; `frameCheck` + `crossOriginVisible`; fail-open przy błędzie (N6). |
| F5 [low] | **zamknięty w polach URL** | W wolnym tekście nie (N5; = test E3-PD2). |
| F6 [low] | **zamknięty** | `pw` tylko cały klucz; `passenger`/`passport`/`compass`/`bypass` nietknięte. |
| F7 [low] | **zamknięty** | `altLength`/`titleLength`; `document.title` zostaje (decyzja). |
| F8 [low] | **zamknięty** | `PATH_PAIR`. |
| F9 [low] | **częściowo** | `toLowerCase`/`slice`/`lastIndexOf` przechwycone; iterator tablic strony (N8). |
| F10 [low] | **zamknięty** | Klucze wprost; strażnik łapie identyfikator, sklejanie, `globalThis[...]`. |
| F11 [low] | **zamknięty** | `blankJsComments`. |
| S4 [low] | **zamknięty** | „zastępowane krótkim skrótem”. |
| QA F-2 | **zamknięty** | `recordLossNotes`. |
| QA F-3 | **zamknięty, z regresją** | N1. |
| QA F-5 | **zamknięty** | `screenshot: 'included'|'off'|'failed'`. |

### Nowe findings

- **N1 [medium] `redact-rules.js:409` (CARD):** lookbehind/lookahead z poprawki F-3 przepuszczają kartę po `<hex>-` (`order-id-5555555555554444`, `card-4111…`, `4111…-a`). Poprawka: granice `(?<![\dA-Za-z])`/`(?![\dA-Za-z])`, a w callbacku pomijać tylko dopasowanie wewnątrz tokenu UUID; korpus `order-id-<PAN>`.
- **N2 [medium] `redact.js:177`, `redact-rules.js:241` (FORM_PAIR):** JSON zakodowany procentami w treści formularza (`payload=%7B%22password%22…`) jawny. Poprawka: w `formPair` dla wartości z `%` logika jak `maskQuery` (dekoduj → `maskText` → przy trafieniu maskuj całość).
- **N3 [medium] `redact.js:113–125` (`keyed`):** pary `{name|key, value}` i `[string, scalar]` (`serializeArray`, `[...formData]`) — wartość jawna. Poprawka: rozpoznawać te kształty w `keyed`/`deep` i maskować `value`/`[1]`.
- **N4 [medium] `dom-structure.js:29` + `redact-rules.js:233`:** XML w `data-*` po `<` → `&lt;` jawny. Poprawka: token `(?:<|&lt;|&#0*60;)` w `XML_ELEMENT`/`XML_OPEN_END` albo nie escapować `<` w wartości atrybutu.
- **N5 [low] `redact-rules.js:114/241`:** `?code=`/`?ticket=` w URL-ach w wolnym tekście (= E3-PD2 z retestu).
- **N6 [low] `popup/controller.js:199`:** `frameCheck` fail-open (timeout/błąd/klik przed odpowiedzią → zrzut włączony). Do decyzji: fail-open vs fail-closed.
- **N7 [low] `redact-rules.js:225/245`:** FP w prozie (`auth: "Invalid credentials"`) oraz przeciek, gdy klucz stoi na początku stringu JSON (`{"log":"password: Lg1nPwd7"}`). Poprawka: dopuścić `"` przed kluczem, jeśli nie jest to `"k":`.
- **N8 [low] `redact-rules.js:137`:** `for…of` na iteratorze strony — podmiana `Array.prototype[Symbol.iterator]` wyłącza `secretKeyRule` w MAIN (tło nadal redaguje). Poprawka: pętle indeksowe.
- **I3 [info]** `&amp;quot;` i base64 < 32 znaków nie są maskowane.
- **I4 [info]** Skaner ~150 ms/MB JSON-u z wieloma kluczami; przypadki patologiczne liniowe (< 200 ms).

### Sprawdzone i OK
- Maskowanie „do końca” ograniczone (nowa linia, surowy `"` przy encjach, mniej backslashy) — gubi najwyżej jedną linię; obiekty/tablice nie są zjadane.
- `crossOriginVisible` liczone w ISOLATED, odpowiedź przez `tabs.sendMessage` `frameId: 0` — strona nie podrobi; wyjątek → widoczna.
- `applyModel` nie nadpisuje kliknięcia; brak zapamiętywania.
- `maskSecrets` w MAIN (kontrakt E2) bez zmian; `summary.md` ze zredagowanego obiektu; `altLength` w obrębie niewydanej v4.

### E3-R1, powtórka (iteracja 1)

| # | Punkt | Wynik |
|---|---|---|
| 1 | storage | PASS (redux-persist, cvv, cvc, pass, base64 JSON, JWT, e-mail, telefon, IBAN, karta); uwaga N7 |
| 2 | cookies | PASS |
| 3 | nagłówki | PASS |
| 4 | `network[].url` | PASS |
| 4b | `requestBody` | PASS; **FAIL N2** |
| 5 | `responseBodyPreview` | N/T w jsdom (unit) |
| 6 | `consoleLogs[].args` | PASS (F2, F3, pw, Bearer, e-mail); **FAIL N3, N1**; uwaga N5 |
| 7 | `runtimeErrors` | PASS |
| 8 | `steps[]` | PASS |
| 9 | `dom.structure`/forms/listy | PASS; **FAIL N4** |
| 10 | environment | PASS (`title` zostaje — decyzja) |
| 11 | `summary.md` | PASS |
| — | FP benign | zachowane `passenger`, `country_code=PL`, `promo_code`, `{"code":"PL"}`; FP N7 |

**Werdykt R1: PASS z uwagami.** Przecieki z iteracji 0 zamknięte; nowe: N1 (regresja), N2–N4 (formy wcześniej nietestowane).

## Re-review iteracja 2 (2026-10-26)

Zakres: E3-PD1, E3-PD2/N5, N1, N2, N3, N4, N6 (fail-closed). R1 powtórzone w jsdom na aktualnym `console-snapshot.js` (`scratchpad/r1/out-it2-review/{r1,r1b}`; sondy `scratchpad/it2rev/t1–t6.mjs`). Przeglądarki nie uruchamiano.
Werdykt: **request-changes** — jeden high (N9), nie regresja; luka obok N3. N10–N12 low.

### Status findings

| Finding | Status | Weryfikacja |
|---|---|---|
| E3-PD1 | **zamknięty** | `capStrings` + `cutText` bez przecinania znacznika; `args.preview` 39 985/40 000; uwaga I5. |
| E3-PD2 / N5 | **zamknięty dla adresów bezwzględnych** | `maskTextUrls`: Chrome/Firefox stack, `(…)`, `?ticket=` w środku, `webpack-internal://`, `chrome-extension://`; `:line:col` zachowane; idempotentne. Pozostałe warianty: N12. |
| N1 | **zamknięty** | `order-id-<PAN>`, `card-<PAN>`, `<PAN>-a`; UUID z cyframi Luhna nietknięty. |
| N2 | **zamknięty** | `payload=%7B%22password%22…` maskowane; `q=%C5%BC…`, `next=%2Fhome…` nietknięte; `%257B` — I7. |
| N3 | **zamknięty dla zgłoszonych kształtów** | Luka N9, FP N10. |
| N4 | **zamknięty** | `&lt;`, mieszane, `&#60;`, ucięte na końcu. |
| N6 | **zamknięty (fail-closed)** | Zaznaczony bez „0 ramek” tylko gdy `disabled` przed pierwszym statusem albo po kliknięciu; uwaga I8. |
| N7, N8 | backlog E4 | bez zmian (decyzja). |

### Nowe findings

- **N9 [high] `redact.js:150` (`deep`, `[nazwa, skalar]`) i `redact.js:207` (`redactConsole`):** para w argumentach konsoli rozpoznawana tylko dla tablicy 2-elementowej z gołym kluczem. `console.log('password:', pw)`, `console.log('token=', t)`, `console.log('login', 'jan', 'password', pw)` — hasło jawne; podgląd `{truncated, preview}` `["password","…",…` też. Poprawka: w `redactConsole` iść parami (i, i+1), klucz normalizować przez obcięcie `\s*[:=]\s*$`; w `maskPairs` forma `"klucz:?"\s*,\s*"wartość"` dla podglądu.
- **N10 [low] `redact.js:150`:** ta sama reguła maskuje zwykłe logi (`('key','Enter')`, `('Pressed key','Enter')`, `('token count',5)`, `('session','started')`). Poprawka razem z N9: klucz tylko jako jeden token bez spacji albo z końcowym `:`/`=`; pojedyncze słowa-klucze zostają FP (fail-closed) — do decyzji.
- **N11 [low] `export.js:159–165`:** `responseBodyTotalChars` skraca najnowsze podglądy (zwykle odpowiedź z błędem), odwrotnie niż `package.js:178`/`recorder.js:192`; komentarz nieprawdziwy. Poprawka: iterować od najstarszego.
- **N12 [low] `redact-rules.js:585` (`TEXT_URL`):** `code`/`ticket` jawne w: `https:\/\/…` (JSON-escaped), adresach względnych (`/cb?code=`), fragmencie (`#code=…`), `&code=`. Poprawka: `:\\/\\/` w `TEXT_URL`, fragment przez `fragmentIsSensitive`; względne do decyzji.
- **I5 [info]** `cutText` po redakcji usuwa znacznik na granicy cięcia (utrata informacji, bez przecieku).
- **I6 [info]** `maskTextUrls`/`formPair`/`encodedValueRule` używają nieprzechwyconych `indexOf`/`includes` — dotyczy tylko przebiegu MAIN; tło redaguje ponownie.
- **I7 [info]** Podwójne kodowanie procentowe nie jest maskowane.
- **I8 [info]** `frameCheck` raz na otwarcie popupu (zgodne z S1 / PB-1 = B).

### Sprawdzone i OK
- Idempotencja (`applied: 0`); `[redacted:key-code]:44:15` nie jest parą `k: v`.
- Wydajność nowych regexów liniowa (83–428 ms/MB; daleko poniżej limitów pól).
- `capStrings` tylko dla pól z limitem i tylko po wydłużeniu przez redakcję; schemat bez zmian.
- N6: jedyne przypisanie `status` w `applyStatus`; `touchedBoxes` tylko po `change`.
- N3 `{name, value, type:'password'}` — `value` zamaskowane; `{name:'username', value}` nietknięte.

### E3-R1, powtórka (iteracja 2)

| # | Punkt | Wynik |
|---|---|---|
| 1 | storage | PASS; LEAK `jsonLeadKey` = N7 (backlog) |
| 2 | cookies | PASS |
| 3 | nagłówki | PASS |
| 4 | `network[].url` / `documents` | PASS |
| 4b | `requestBody` | PASS |
| 5 | `responseBodyPreview` | N/T w jsdom (unit) |
| 6 | `consoleLogs[].args` / `stack` | PASS; luka N9 poza korpusem R1 |
| 7 | `runtimeErrors` | PASS |
| 8 | `steps[]` | PASS |
| 9 | `dom.structure` / forms / listy | PASS |
| 10 | environment | PASS (`title` — decyzja; AWS `AKIA…` — identyfikator) |
| 11 | `summary.md` | PASS |
| — | FP benign | zachowane `passenger`, `country_code=PL`, `promo_code`, `{"code":"PL"}`, `status: "ok"`; FP N7 bez zmian |

**Werdykt R1: PASS z uwagami.** Przecieki z iteracji 1 zamknięte; w korpusie tylko N7 (backlog); poza korpusem N9.

## Re-review iteracja 3 (2026-10-26)

Zakres: N9, N10, N11. Sondy w node na `redact()`: `scratchpad/it3rev/p1–p3.mjs`. Przeglądarki nie uruchamiano.
Werdykt: **request-changes** — jeden high (N13), ta sama klasa co N9. N14, N15 low.

### Status findings

| Finding | Status | Weryfikacja |
|---|---|---|
| N9 | **zamknięty dla zgłoszonych kształtów; luka N13** | Maskowane m.in. `('password:', pw)`, `('token=', t)`, `('PASSWORD:', pw)`, `('user.password=', pw)`, `('login','jan','password',pw)`, `('%s: %s','password',pw)`, `({}, 'password', pw)`, `('pin:', 1234)`; podgląd — pary w każdej tablicy, także ucięte. Idempotentne. |
| N10 | **zamknięty** | `('Pressed key','Enter')`, `('token count',5)`, `('auth ok',true)` nietknięte; pojedyncze słowa-klucze fail-closed (zamierzone). |
| N11 | **zamknięty** | `capStrings` od indeksu 0 (najstarsze); `responseBodyTruncated` ustawiane. |

### Nowe findings

- **N13 [high] `redact.js:226–229` (`redactConsoleArgs`), `redact.js:261–264` (`maskPreviewPairs`):** klucze w łańcuchu przesuwają parę — `console.log('[Auth]', 'Token:', t)` → `t` jawny; też `('auth:', 'token', t)`, `('session', 'token=', t)`, podgląd. Poprawka (fail-closed): gdy argument i+1 sam jest kluczem — maskować go, ale jego `argKeyRule` użyć jako klucza dla i+2; w podglądzie `top.pending = argKeyRule(value)`.
- **N14 [low] `redact.js:164` (`deep`):** w tablicy zagnieżdżonej w argumentach pary tylko przy 2 elementach; podgląd rozpoznaje w każdej — niespójne. Poprawka: to samo przejście parami w kontekście konsoli.
- **N15 [low] `redact-rules.js:235` (`ATTRIBUTE`) po `maskPreviewPairs`:** `["token=","x","more"]` → przecinek zamieniony w drugi marker; `masked` zawyżone, JSON podglądu zniekształcony; bez przecieku.
- **I9 [info]** FP fail-closed: `('%cAuth','color:red')`, `('token',1,2,3)`.

### Sprawdzone i OK
- `maskPreviewPairs` liniowe (20 000 par 164 ms; głębokie zagnieżdżenie 6 ms).
- `argKeyRule`: markery i długie teksty nie są kluczami; separator obcinany; bez rozróżniania wielkości liter.
- `console.table` poprawnie; standalone zawiera nowe funkcje; odstępstwo implementera (łatka w `redact.js`, nie w `maskPairs`) słuszne.

### Do decyzji użytkownika
- `console.log('Your password is', pw)` — tekst ze spacjami bez `:`/`=` nie jest kluczem (koszt N10).
- `console.log('password:', {v: pw})` / `[pw]` — kontener w parze nie jest wymuszany (decydują jego własne klucze).
