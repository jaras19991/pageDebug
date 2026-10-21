---
name: pds-status
description: Pokazuje stan wszystkich epików Page Debug Snapshot (faza, postęp zadań, blokery) na podstawie docs/BACKLOG.md i docs/epics/*/state.md. Użyj gdy użytkownik pyta "gdzie jesteśmy", "/pds-status", "co zostało", "jaki następny epik".
---

# /pds-status

1. Przeczytaj `docs/BACKLOG.md` i każdy `docs/epics/E*/state.md`, który istnieje.
2. Policz zadania `[x]` / wszystkie per epik (z backlogu).
3. Wypisz tabelę:

| Epik | Faza | Zadania | Blokery | Ostatnia zmiana |
|---|---|---|---|---|

4. Pod tabelą: jeden akapit — co jest następnym krokiem (który epik, która faza, czy czeka na bramkę użytkownika).
5. Jeśli jakiś `state.md` ma fazę inną niż `done`, a `BACKLOG.md` ma wszystkie zadania epiku `[x]` (lub odwrotnie)
   — zgłoś niespójność.

Nie uruchamiaj żadnych agentów. Tylko czytaj i raportuj.
