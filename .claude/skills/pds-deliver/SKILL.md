---
name: pds-deliver
description: Orkiestrator pełnego cyklu SDLC dla jednego epiku Page Debug Snapshot (spec → design → implementacja → testy → review+QA → docs → release). Użyj gdy użytkownik mówi "/pds-deliver E1", "dowieź epik", "przejdź przez SDLC dla E2", "wznów epik".
disable-model-invocation: true
---

# /pds-deliver E<n> [--from <faza>] [--auto]

Prowadzisz jeden epik z `docs/BACKLOG.md` przez wszystkie fazy, delegując pracę subagentom
`pds-*` i zatrzymując się na bramkach, gdzie decyzja należy do użytkownika.
Argument: `$ARGUMENTS` (np. `E1`, `E1 --from implement`, `E2 --auto`).

## Zasady

1. **Jedno źródło stanu**: `docs/epics/E<n>/state.md`. Tworzysz go na starcie, aktualizujesz po każdej fazie.
   Jeśli istnieje — wznawiasz od zapisanej fazy (chyba że `--from`).
2. **Ty nie piszesz kodu ani specyfikacji.** Delegujesz. Ty: przygotowujesz kontekst, czytasz raporty,
   podejmujesz decyzje w ramach uprawnień, pytasz użytkownika na bramkach, zapisujesz stan.
3. **Bramki** (zatrzymaj się i pokaż użytkownikowi, chyba że `--auto`): po Spec, po Design, przed Release.
   Zawsze zatrzymuj się (nawet z `--auto`), gdy: subagent zgłasza decyzję biznesową (np. E5-S1),
   review ma finding o wadze *critical*, testy nie przechodzą po 2 iteracjach naprawy.
4. **Subagenci dostają ścieżki, nie treść.** Przekazujesz im: numer epiku, ścieżki do spec/design/state,
   listę zadań dla danej fazy, skille wiedzy do przeczytania. Nie wklejasz im całych plików.
5. **Równoległość**: Review i QA uruchamiaj jednocześnie (jedna wiadomość, dwa wywołania Agent).
   Implementację grup zadań bez zależności też możesz zrównoleglić, ale tylko gdy design.md
   jawnie oznacza je jako niezależne i dotykają różnych plików.
6. Po każdej fazie: krótki komunikat do użytkownika (3–6 linii): co powstało, gdzie, co dalej.

## Fazy

### 0. Init
- Przeczytaj sekcję epiku z `docs/BACKLOG.md` i `CLAUDE.md`.
- Jeśli `docs/epics/E<n>/state.md` istnieje → wczytaj fazę i przejdź do niej.
- Inaczej utwórz `state.md` z szablonu poniżej, faza = `spec`.

### 1. Spec → agent `pds-analyst`
Wejście: sekcja epiku z backlogu, `CLAUDE.md`, snapshot przykładowy (jeśli jest w repo).
Wyjście: `docs/epics/E<n>/spec.md` (user stories dla obu person, kryteria akceptacji, non-goals, otwarte pytania).
**Bramka**: pokaż użytkownikowi listę kryteriów akceptacji i otwarte pytania. Odpowiedzi dopisz do spec.md.

### 2. Design → agent `pds-architect`
Wejście: spec.md, backlog epiku, skille wiedzy właściwe dla epiku (patrz tabela niżej).
Wyjście: `docs/epics/E<n>/design.md` — decyzje techniczne z uzasadnieniem, lista zadań
(ID z backlogu lub nowe `E<n>-T<k>`), dla każdego: pliki, testy do napisania, zależności,
czy niezależne od innych. Zadania z backlogu pominięte → `[-]` z powodem.
**Bramka**: pokaż decyzje i listę zadań.

### 3. Implementacja → agent `pds-implementer` (per zadanie lub grupa)
Dla każdego zadania/grupy: uruchom implementera z ID zadania, ścieżką do design.md i skillami.
Implementer: test najpierw, kod, `npm test`, raport. Ty: odznaczasz `[x]` w state.md i backlogu.
Jeśli raport mówi „zablokowane” → zapisz w state.md, przejdź do następnego niezależnego, na końcu zbierz blokery.

### 4. Testy → agent `pds-tester`
Pełny `npm test` + `npm run test:e2e`, uzupełnienie brakujących testów z design.md, raport regresji.
Czerwone → wróć do fazy 3 z listą failujących testów (maks. 2 iteracje, potem bramka).

### 5. Review + QA → `pds-reviewer` ∥ `pds-qa` (równolegle)
Reviewer: diff całego epiku, findings z wagą. QA: scenariusze z kryteriów akceptacji, dowody w `qa-report.md`.
Findings *critical/high* → faza 3 dla poprawek → ponowny test → ponowny review tylko tych punktów.

### 6. Docs → agent `pds-docs`
README developera, instrukcja zgłaszającego (PL), `docs/snapshot-schema.md` jeśli schema się zmieniła, CHANGELOG.

### 7. Release → agent `pds-release`
**Bramka zawsze.** Pokaż: zakres, wersję, wynik testów/review/QA. Po zgodzie: wersja, build, pack, tag
(commit tylko jeśli repo jest w gicie i użytkownik się zgodził).

### 8. Zamknięcie
Zaktualizuj `docs/BACKLOG.md` (statusy), dopisz do `state.md` sekcję *Retro* (co zaskoczyło, co
poprawić w procesie — 3 punkty maks.). Powiedz użytkownikowi, który epik jest następny.

## Skille wiedzy per epik (przekazuj agentom nazwy do przeczytania)

| Epik | Skille |
|---|---|
| E0 | mv3-extension-rules, extension-testing |
| E1 | mv3-extension-rules, extension-testing, snapshot-schema |
| E2 | cwv-capture, snapshot-schema, mv3-extension-rules |
| E3 | privacy-redaction, snapshot-schema |
| E4 | snapshot-schema, privacy-redaction |
| E5 | mv3-extension-rules |

## Szablon `state.md`

```markdown
# E<n> — <tytuł> — stan

faza: spec | design | implement | test | review-qa | docs | release | done
rozpoczęto: <YYYY-MM-DD>
ostatnia aktualizacja: <YYYY-MM-DD HH:MM>

## Zadania
- [ ] E<n>-T1 … (plik(i): …) 
…

## Blokery
- (brak)

## Decyzje użytkownika
- <data>: …

## Historia faz
- <data> spec → design (bramka: zatwierdzono)
…

## Retro
- …
```

## Jak wywoływać subagentów (wzorzec promptu)

```
Epik: E1. Faza: implementacja. Zadanie: E1-T4.
Przeczytaj: CLAUDE.md, docs/epics/E1/design.md (sekcja E1-T4), docs/epics/E1/spec.md (kryteria).
Skille do przeczytania przed pracą: mv3-extension-rules, extension-testing.
Zasady: test najpierw; nie ruszaj plików spoza listy w design.md bez zapisania powodu w raporcie;
po skończeniu uruchom `npm test`.
Raport końcowy (≤ 25 linii): co zmieniono (pliki), testy dodane/zmienione, wynik `npm test`,
blokery, rzeczy do decyzji.
```
