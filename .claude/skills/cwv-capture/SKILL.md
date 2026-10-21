---
name: cwv-capture
description: Jak zbierać Core Web Vitals (LCP, CLS, INP, FCP, TTFB) i long tasks w Page Debug Snapshot — PerformanceObserver z buffered, atrybucja (który element, co przesunęło layout, który event był wolny), decyzja web-vitals vs własny kod, pułapki (BFCache, tło, wielokrotne LCP). Czytaj przy E2 i wszędzie, gdzie raportujesz wydajność.
---

# Zbieranie Core Web Vitals w recorderze

## Co i skąd

| Metryka | Źródło | `buffered: true` działa wstecz? | Kiedy finalna |
|---|---|---|---|
| **TTFB** | `performance.getEntriesByType('navigation')[0].responseStart` | tak (zawsze dostępne) | od razu |
| **FCP** | `PerformanceObserver` type `paint`, entry `first-contentful-paint` | tak | od razu po pojawieniu |
| **LCP** | type `largest-contentful-paint` — **ostatni** wpis wygrywa | tak | po pierwszej interakcji użytkownika lub przy ukryciu strony |
| **CLS** | type `layout-shift`, suma wpisów bez `hadRecentInput`, w oknach sesyjnych (5 s gap / 1 s max) — **największe okno** | tak | przy ukryciu strony (raportuj bieżącą wartość przy zapisie) |
| **INP** | type `event` z `durationThreshold: 16`, bierz ~p98 (dla < 50 interakcji: max) z `interactionId > 0` | tak (tylko w Chrome ≥ 96; bufor ograniczony) | przy ukryciu; raportuj bieżącą |
| **Long tasks / LoAF** | type `long-animation-frame` (Chrome ≥ 123) lub `longtask` | `long-animation-frame` tak | — |

Progi (good / needs-improvement / poor): LCP 2500/4000 ms · CLS 0.1/0.25 · INP 200/500 ms ·
FCP 1800/3000 ms · TTFB 800/1800 ms. Zawsze zapisuj `rating`, nie tylko wartość.

## Decyzja: `web-vitals` czy własny kod

**Rekomendacja: `web-vitals` (attribution build, ~3–4 KB gz).** Powody: poprawna logika okien CLS
i percentyla INP jest nietrywialna, biblioteka obsługuje BFCache i `visibilitychange`, daje atrybucję
(element LCP, źródła CLS, target i fazy INP) za darmo. Własny kod ma sens tylko jeśli zależność runtime
jest nie do przyjęcia — wtedy skopiuj logikę okien CLS 1:1 z biblioteki i udokumentuj.

Osadzenie: skopiuj zbudowany plik do `src/vendor/web-vitals.attribution.js` (brak bundlera, brak CDN —
rozszerzenie musi działać offline i bez zdalnego kodu). Wersja w nazwie pliku lub komentarzu.

## Jak używać w recorderze (MAIN world, `document_start`)

```js
import { onLCP, onCLS, onINP, onFCP, onTTFB } from './vendor/web-vitals.attribution.js';

const vitals = {};
const record = (m) => {
  vitals[m.name] = {
    value: Math.round(m.name === 'CLS' ? m.value * 1000) / 1000 : m.value),
    rating: m.rating,
    // atrybucja — tylko to, co developer przeczyta:
    element: m.attribution?.element ?? m.attribution?.largestShiftTarget ?? m.attribution?.interactionTarget,
    url: m.attribution?.url,
    eventType: m.attribution?.interactionType,
    phases: m.name === 'INP' ? {
      inputDelay: m.attribution.inputDelay, processing: m.attribution.processingDuration,
      presentation: m.attribution.presentationDelay } : undefined,
    sources: m.name === 'CLS' ? m.attribution.largestShiftSource?.node ? [m.attribution.largestShiftTarget] : [] : undefined,
    t: performance.now()
  };
};
// reportAllChanges: true — chcemy bieżącą wartość przy zapisie, nie tylko finalną
[onLCP, onCLS, onINP, onFCP, onTTFB].forEach(fn => fn(record, { reportAllChanges: true }));
```

Przy `stopAndCollect`: `snapshot.vitals = { ...vitals, finalized: document.visibilityState === 'hidden' }`.
Jeśli `finalized === false`, dopisz do `notes`: „LCP/CLS/INP to wartości w chwili zapisu; mogły jeszcze
rosnąć.” Developer ma to wiedzieć.

## Fallback jednoplikowy (`console-snapshot.js`)

Wklejany po załadowaniu strony. `buffered: true` nadal da LCP/CLS/FCP z przeszłości (bufor Chrome
trzyma wpisy od startu), INP tylko dla interakcji po wklejeniu. Zapisz w `notes`.

## Long tasks — co zapisywać

Z `long-animation-frame`: `{ t: startTime, duration, blockingDuration, scripts: [{ sourceURL,
sourceFunctionName, duration }] }` — top 20 po `blockingDuration`. To odpowiada na „który skrypt
zamroził stronę”. Bez LoAF (starszy Chrome): `longtask` z `attribution[0].containerSrc`.

## Pułapki

- **Wiele wpisów LCP** — każdy większy element nadpisuje. Bierz ostatni, nie pierwszy.
- **CLS nie jest sumą wszystkiego** — okna sesyjne. Suma bez okien zawyża na stronach długo otwartych.
- **Karta w tle od startu** — metryki paint/LCP są nieważne (`web-vitals` je pomija). Zapisz
  `visibilityState` przy starcie nagrywania do `environment`.
- **BFCache** — po powrocie wstecz strona nie przeładowuje się; `web-vitals` restartuje pomiar,
  własny kod musi nasłuchiwać `pageshow` z `persisted === true`.
- **`performance.now()` vs `timeOrigin`** — wszystkie `t` w paczce względem `timeOrigin` (patrz
  `snapshot-schema`). Po reloadzie w E1 `timeOrigin` jest nowy — to oczekiwane.
- **Nie licz CWV w ISOLATED world** — tam `PerformanceObserver` też działa, ale `element` z atrybucji
  wskazuje na węzły DOM, których nie da się przesłać przez `postMessage`; serializuj do selektora w MAIN.

## Co pokazać w `summary.md`

Tabela 5 wierszy: metryka · wartość · ocena · atrybucja (element/URL/event) · uwaga („w chwili zapisu”).
Pod spodem top 5 long tasks ze skryptem. Jeśli którejś metryki brak — napisz dlaczego
(„INP: brak interakcji po starcie nagrywania”), nie zostawiaj pustej komórki.
