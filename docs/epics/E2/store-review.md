# E2 — store review (CWS + AMO)

Data: 2026-10-23 · audytor: pds-store-reviewer (zapis raportu: orkiestrator — agent nie ma narzędzia zapisu).
Źródła zweryfikowane 2026-10-23: CWS Program Policies (akt. 2025-05-22), „CWS policy updates 2026” (2026-07-01, egzekwowane od 2026-08-01),
Extension Workshop „built-in data consent”.

**Werdykt: would-be-rejected — bez nowego blokera z E2.** Odrzucenie wynika z blokerów otwartych od E1 (F3 → E3, F4 → E5).
Sam zakres E2 jest publikowalny.

## Findings

| # | Waga | Status | Opis | Polityka | Poprawka |
|---|---|---|---|---|---|
| F3 (E1) | blocker | otwarte → E3 | Dane wrażliwe jawnie w pliku i `storage.session`. E2 dokłada podglądy odpowiedzi z błędem (maskowanie tylko lista kluczy/Bearer/JWT, 2×: MAIN + `package.js`) i zrzut ekranu, którego nie da się zredagować. | User Data Policy, Limited Use, sensitive data | E3: pełna redakcja; decyzja o zrzucie — przełącznik „dołącz zrzut” albo uzasadnienie „strictly necessary” w polityce |
| F4 (E1) | blocker | otwarte → E5 | Brak `docs/store/`, polityki prywatności i formularza Privacy practices. | User Data Policy, Privacy Policy & disclosure | E5: polityka wymienia też kroki (bez treści), zamaskowane fragmenty odpowiedzi przy błędach, jeden zrzut widocznej części karty przy zapisie |
| F6 (E1) | high (AMO) | otwarte → E5 | `content/main-world.js` generowany (+2291 linii), bez minifikacji. | AMO Source code submission | E5: zip źródeł + instrukcja `npm ci && npm run gen && npm run build` |
| E0 #10 | medium | otwarte → E5/E4-S2 | `data_collection_permissions: ["none"]` — obronialne (dane lokalne), ale zakres rośnie. | AMO Add-on Policies, Data Disclosure | notatka dla reviewera AMO; przy wysyłce (E4) zmienić na `websiteContent`, `websiteActivity`, `authenticationInfo`… |
| F10 | low | otwarte → E5-S2 | web-ext lint: 0 errors, 2 warnings (`strict_min_version` 128 < 140 desktop / 142 Android dla `data_collection_permissions`). | Extension Workshop, built-in consent | `strict_min_version` 140; Androida nie publikować albo `gecko_android.strict_min_version` 142 |
| E2-S1 | low | → Release | Inna obsługa danych niż w 0.3.0, manifest nadal 0.3.0. | CWS 2026 „proactively disclose changes” | wersja 0.4.0 + CHANGELOG; lista w popupie przed *Nagrywaj* spełnia ujawnienie |
| E2-S2 | low (bez wpływu) | info | `npm audit`: 3 high tylko w devDeps (web-ext → adbkit → node-forge); `--omit=dev` = 0. | — | nie uruchamiać `audit fix --force` (cofa web-ext do 5.x) |

## Sprawdzone i OK
- Manifesty `dist/{chrome,firefox}` = `src`; uprawnienia jak w 0.3.0 (activeTab, scripting, storage, downloads, opcjonalne host). Brak `webRequest`, brak `<all_urls>` — warunek bramki Spec (decyzja 4) spełniony.
- Brak zdalnego kodu, `eval`, `new Function`; `web-vitals` nie ma w `dist` (`vitals.js` — własna implementacja).
- Uzasadnienie `activeTab` w `README.md` (PL/EN) aktualne, obejmuje zrzut przy *Zapisz paczkę*.
- Ujawnienie: 8 pozycji w popupie (kroki, odpowiedzi przy błędzie, zrzut) + `consentNotice` przed *Nagrywaj*.
- Kroki bez wartości pól i bez długości haseł (`hooks-steps.js`); zrzut tylko aktywnej karty z nagrywanego originu (`save.js`).
- Single purpose bez zmian.

## Do decyzji użytkownika (E3/E5)
URL polityki prywatności, teksty listingu, listed/unlisted, konto z 2FA, `strict_min_version` 140, przełącznik zrzutu (E3).
