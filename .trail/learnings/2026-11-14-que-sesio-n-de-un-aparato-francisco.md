---
title: "Qué sesión de un aparato recibe avisos se anota, no se calcula entre las sesiones vivas"
author: Francisco
date: 2026-11-14
branch: docs/fase-1d4
cost: { minutes: 25, tokens: 216116 }
id: l-f22bca49
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
  - packages/platform/identity/auth.ts
---

## Decided
El aparato guarda qué sesión suya está habilitada para avisos. Esa marca se cambia cada vez que entra una sesión, antes de crearla, y nunca vuelve a una anterior. Si la creación falla, el aparato se queda sin avisos: se prefiere perder un aviso a mandarlo a otra cuenta. La garantía la sostiene la comprobación antes de cada envío y al registrar la suscripción (en la misma transacción), no la limpieza posterior.

## Tried and ruled out
- "La suscripción es de la sesión, y muere con ella": no basta, porque un navegador tiene un solo endpoint y un aparato guarda sesiones de varias cuentas, así que dos personas en un portátil compartido registrarían el mismo endpoint.
- "Recibe la última sesión que entró, buscada entre las que existen": si la sesión nueva termina y la limpieza de la antigua había fallado, la antigua vuelve a ser la última y recupera los avisos.
- Apoyarse solo en un hook para anular la suscripción: si falla tras crear la sesión, quedan avisos de la cuenta anterior.

## Watch out
Hoy no se puede cambiar a una sesión ya existente sin volver a entrar (no hay plugin multi-session). Si la fase 3 lo añade, ese cambio también tiene que mover la marca.

In the code: ADR 0029 («Una suscripción habilitada por aparato»); la spec de la 1d4 fija el par `platform_devices.entry` / `deviceEntry` de la sesión, escrito en `session.create.before` de `packages/platform/identity/auth.ts`.
