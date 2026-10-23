# E2 — Kompletność danych — stan

faza: test
rozpoczęto: 2026-10-23
ostatnia aktualizacja: 2026-10-23 (bramka spec)

## Zadania (z backlogu; design doprecyzuje)
- [ ] E2-IN1..IN5 wejście z E1 (LOW / nice-to-have)
- [x] E2-S1..S2 spec.md (pds-analyst): 7 US, 43 AC, 8 otwartych pytań — bramka zatwierdzona
- [x] E2-D1..D9 design.md (pds-architect): 30 zadań / 5 grup (A–E), bez zmian uprawnień, E2-T2 [-] — bramka zatwierdzona
- [x] E2-T1..T7 implementacja (2026-10-23; npm test 975/975, lint 0, gen --check 0) — grupy wg design.md:
  - A: [x] T0 spike · [x] T7a · [x] T5a · [x] T1a · [x] T3a(+TEST1) · [x] T4a · [x] T6a · [x] T12 · [x] T11 · [x] IN2 · [x] IN4 · [x] IN5 · [x] T13
  - T12/T11 ✓ (15 testów): ujawnienie 8 pozycji; otherOrigin z tabs.get; popup tabs.onUpdated → refresh. **Dla T9b:** tło→ISOLATED `{type:'stop',reason:'time-limit'}` (frameId 0, best-effort, raz na nagranie; MAIN idempotentny). Odstępstwo: zakazane słowa case-insensitive tylko w ujawnieniu (fileUnsupportedFirefox ma „http://”). Docs: README l.233 „kroki/zrzuty — dopiero E2” do poprawy.
  - T3a/T4a/T6a ✓ (60 testów). API: network-merge {resourceKind, resourceRecord(entry,{docOrigin,supportsStatus}), correlateSizes, mergeLoadErrors, documentStatus, MERGE_LIMITS}; mask-secrets {maskSecrets(text)→{text,masked}, cutPreview(text,max)→{preview,truncated}, MASK_LIMITS}; screenshot {captureScreenshot({tabs,tab,codec,now,maxBytes,timeoutMs})→{shot}|{error:'capture-failed'|'timeout'|'too-large'}, fitJpeg, createCanvasCodec, FAILURE_REASONS/screenshotErrorReason — korekta po T0}.
    Odstępstwa (orkiestrator: akceptuję): drabina 45→30→×0,75; timeout 3 s na całość; wymiary z nagłówka JPEG; brak dekodera → 'too-large' (zostaje). T3b: przechwycić URL/Set/Map/RegExp na document_start.
    Do E3 (privacy): maskSecrets nie maskuje `klucz: wartość` ani liczb JSON przy kluczach wrażliwych (`"pin":1234`).
  - IN2/IN4/IN5/T13 ✓ (19 testów). pack() woła checkRelease (bundle aktualne, RECORDER_VERSION==manifest) — pack.test czerwony do gen w T9b. web-vitals ^6.2.3 devDep (nie w dist).
    Trasy fixture: /status/<code>?body=json|text|token|png|page&type=; /seq/<name> 200→500→404 (?reset); /stream/500; /echo/headers, /echo/last; /vendor/web-vitals*.js; /img/hero.png?delay=; ?delay=ms wszędzie; otherOrigin=http://localhost:<port>; FIXTURE_SECRETS.{jwt,bearer}. Bez Timing-Allow-Origin → cross-origin status 0 (AC-4.3).
    Do tester/release: `npm install` zgłasza 3 high w devDeps — sprawdzić `npm audit`.
  - T7a/T5a/T1a ✓ (33 testy). serialize: Error → {name,message,stack≤16000,cause?} (5 poziomów); STACK_MAX_CHARS 16000; LIMITS.entryChars 40000 (package.js DEFAULT_LIMITS nadal 10000 → T10a).
    selector.js: createSelectorOf({doc,intrinsics?}) → selectorOf(el)→string|null; captureSelectorIntrinsics(win) (closest,getTagName,getParentElement,getId,apply); SELECTOR_MAX_CHARS 1000, SELECTOR_DATA_MAX_ELEMENTS 5000.
    vitals-math.js: THRESHOLDS, LONG_TASKS_MAX 20, rate, clsFromShifts, inpFromEvents, inpPhases, topLongTasks, unavailable(reason).
    Uwaga tester: hooks-errors.test „uses add/removeEventListener captured…” zostawia no-op removeEventListener na oknie jsdom (wyciek między testami).
  - T0 ✓ (docs/epics/E2/spike-T0.md; Chromium 156, Firefox 158): S1–S6 PASS. **PB-1 znika** — FF 158 ma responseStatus (unsupported-browser tylko jako gałąź wykrywania). FF: brak layout-shift/longtask/LoAF, jest event+interactionId (skill cwv-capture do korekty w Docs). captureVisibleTab działa w obu (AC-6.6 bez bramki).
    Decyzje orkiestratora: brak activeTab / quota → zostaje `capture-failed` (bez osobnego powodu); D5 uzupełnione o cofanie activeTab w FF przy każdym przeładowaniu (→ notatka AC-6.4, scenariusz QA FF). TEST5: nie porównywać wymiarów z emulowanym deviceScaleFactor. Rodzaj fontu z rozszerzenia pliku (FF initiatorType 'other'); FF dodaje /favicon.ico.
  - B: [x] T5b · [x] T1b · [x] T3b · [x] T4b · [x] T8 · [x] T10a
  - T3b/T4b ✓ (60 testów). installResourceHooks({win,now,record,enabled?,intrinsics?}) → {adjust(items), documentStatus(), sync(), restore()}; RESOURCE_LIMITS {rtEntries 500, loadErrors 200, urlChars 4000}.
    hooks-network: ctx.attach(entry,{responseBodyPreview,responseBodyTruncated},chars) — bez attach brak klonowania; sizeBytes:null po durationMs; isTextual(ct); NETWORK_LIMITS.responseBodyChars 4096/responseReadChars 8192/bodyTimeoutMs 2000. Budżet 256 KB + truncated.responseBodies → T9a.
    **Dla T9a (decyzja orkiestratora):** dodać opcjonalne `intrinsics` (URL/Set/Map) do network-merge.js, przechwycone na document_start. gen-content test ESLint ma timeout 5 s na /mnt/c (środowisko — tester).
  - T5b/T1b ✓ (51 testów). installStepsHook({win,doc,now,record,selectorOf,intrinsics}) → restore (record('steps',…); click/input/change/submit/key/navigate; koalescencja input mutuje obiekt w buforze); installVitals({win,doc,now,selectorOf,intrinsics,accept,options:{interactionsSince}}) → {snapshot({final}), restore}. CLS bez przesunięć: value 0, t null (T10b dopuszcza).
  - T8/T10a ✓ (32 testy). schemaVersion 3, attachments po dom; assemblePackage przyjmuje steps/vitals/documentStatus/truncated.responseBodies, meta.screenshots (shot z captureScreenshot), meta.screenshotNote; 2. przebieg maskSecrets + budżet 262 144. installFrameHooks({win,doc,now,record,json,intrinsics}) → restore (MutationObserver w intrinsics). Poprawione save/popup-background-integration (schemaVersion 3).
    **Decyzje orkiestratora dla T9a:** (1) intrinsics URL/Set/Map w network-merge.js; (2) MutationObserver przechwycony na document_start; (3) serialize.js: rozpoznawanie Error cross-realm przez Object.prototype.toString (ramki); (4) `accept` po terminie nie może odrzucać wpisów z `startTime` sprzed terminu dobieranych przez takeRecords.
  - Środowisko: w repo widoczne „nieśledzone” .bashrc/.profile/.gitconfig/.claude/settings.json/boot/etc… — to atrapy /dev/null montowane przez sandbox (char 1,3), nie pliki. **Nigdy `git add -A`/`git add .`** — dodawać jawne ścieżki.
  - C: [x] T9a · [x] T10b · [x] T6b
  - T6b ✓ (12 testów). collect: tabs.get → zrzut tylko same-origin i tab.active → captureScreenshot 3 s → ponowne tabs.get (zmiana originu → odrzuć zrzut, bez collect) → sendMessage collect z resztą z 15 s. RESULT_PROTOCOL = 2 (PROTOCOL w constants.js musi być 2). Notatki: outside recorded site / tab not visible / capture failed (…) / could not be made smaller than 300 KB; błąd zrzutu → ok:true. TEST5: popup otwarty na nagrywanej karcie.
    Drobne: captureScreenshot używa globalnego setTimeout (nie api.setTimeout) — do review.
  - T10b ✓ (43 testy). tests/helpers/snapshot-validator.js: validateSnapshot(pkg)→{ok,errors}, assertValidSnapshot(pkg); fixture v3.json z assemblePackage (PDS_UPDATE_FIXTURES=1); docs/snapshot-schema.md v3.
    **E2-F1 (nowe, przed T9b; decyzja orkiestratora):** (a) fetch no-cors (opaque) → `status:null` + `statusUnavailable:'cross-origin'` w hooks-network.js (dziś gołe 0); (b) package.js: brak klucza sekcji przy pustym errors[] → notatka. package.test.js: nieaktualny komentarz „until T10b adds v3.json”.
    Docs: skill snapshot-schema nadal opisuje v2 i „screenshot → osobny plik” — `.claude/skills` zablokowane do zapisu dla agentów → do zrobienia przez użytkownika lub za jego zgodą.
  - T9a ✓ (13 testów). PROTOCOL 2; LIMITS +steps/stackChars/responseBodyChars/responseBodyTotalChars 262144/longTasks. Decyzje (1)–(4) wdrożone. Recorder dla T9b: createRecorder({win,options:{onStopped,limits,configTimeoutMs,interactionsSince}}) → install/setConfig/stop(reason) idempotentny/destroy; snapshot({final}) (final:true przy flush i collect na ukrytej stronie); exportBuffers bez korekt RT — T9b używa snapshot.
    Odstępstwa: budżet podglądów odjęty z limitu znaków bufora sieci z góry. Do review: load errors z mergeLoadErrors (≤200) nie liczone w counts.network/limits.network. Test E1 „records after deadline…timer late” odwrócony zgodnie z D8.
  - E2-F1 ✓ (7 testów): opaque → cross-origin, inne gołe 0 → 'unknown' (fetch/XHR); brakująca sekcja → notatka „Section <name> was not received from the page.” Uwaga tester: fixture current() w package.test.js ma rekord sieci v2 (bez sizeBytes).
  - D: [x] T9b → [x] T7b
  - T9b ✓ (8 testów): stop I2M (tylko od tła), flush snapshot({final:true}), collect final gdy hidden (visibilityState z Document.prototype); gen-content ESLint timeout 60 s. npm test 969/971 (2 × console-entry → T7b), lint 0 (2 ostrzeżenia web-ext strict_min_version vs data_collection_permissions — store review), build: dist ~266 KB. Bundle: main-world 59→143 KB, console-snapshot 58→150 KB.
    Do review: stopped po stop od tła (idempotencja), stop przed config.
  - T7b ✓ (4 testy): konsola v3 (interactionsSince, screenshots [] + notatka, notatka INP), console-snapshot.js 147 KB.
  - E: [ ] TEST2 · [ ] TEST3 · [ ] TEST4 · [ ] TEST5 · [ ] TEST6
  - [-] E2-T2 webRequest (odrzucone, D2)
- [ ] E2-TEST1..TEST3 testy
- [ ] E2-R1 review, E2-Q1 QA, store review
- [ ] E2-DOC1 docs (schemaVersion 3)

## Blokery
- (brak)

## Decyzje użytkownika
- 2026-10-23: bramka Spec — przyjęte wszystkie 8 rekomendacji (zrzut tylko przy Zapisz, JPEG w JSON ≤300 KB; body ≥400 tekst 4 KB/256 KB; webRequest warunkowo bez ostrzeżenia i bez host permissions; schemaVersion 3; overview; etykieta ≤80; iframe tylko błędy)
- 2026-10-23: bramka Design — PB-1 (A) unsupported-browser w FF bez webRequest; PB-2 (A) attachments po dom; PB-3 PASS; D1, D4, entryChars 40k zaakceptowane

## Historia faz
- 2026-10-23 init → spec
- 2026-10-23 spec → design (bramka: zatwierdzono)
- 2026-10-23 design → implement (bramka: zatwierdzono)
- 2026-10-23 implement → test (grupy A–D + F1; grupa E = e2e TEST2..6 → pds-tester)

## Retro
- …
