---
title: "Rechazar en un punto de interleave prueba un reintento, no una caída del proceso"
author: Francisco
date: 2026-11-14
branch: docs/fase-1d4
cost: { minutes: 1, tokens: 3244 }
id: l-0143160a
scope: repo
status: active
src: agent
touches:
  - ".scratch/fase-1d4/spec.md"
  - GLOSSARY.md
  - docs/architecture/README.md
  - docs/architecture/adr/0023-identidad-y-autorizacion.md
  - docs/architecture/adr/0025-segundo-plano.md
  - docs/architecture/adr/0029-eventos-en-directo-y-avisos.md
  - docs/plan.md
  - packages/platform/background/engine.ts
---

## Decided
Para probar que un trabajo que se repite tras caer no duplica lo que ya hizo, se mata el proceso con `startChild` y se reabre la base, porque solo así la fila queda `running` y pasa por la recuperación de verdad. El rechazo en un punto de `interleave` se mantiene como prueba rápida del reintento.

## Tried and ruled out
Simular la caída rechazando la promesa del punto: no sirve porque el motor captura ese rechazo y guarda el estado siguiente del trabajo como un reintento, que es un camino distinto de `recover()`.

## Watch out
Las esperas del canal y de las entregas (latido, reintentos, tiempo máximo) tienen que usar el temporizador de la plataforma, porque mover el reloj de pruebas dispara `controlledTimer` pero no un `setTimeout` real; si no, la prueba se queda esperando.

In the code: `packages/platform/background/engine.ts` (manejo de errores y `recover`), `startChild` y `interleave` de `@domus/platform/testing`, y la costura 3 de la spec de la 1d4.
