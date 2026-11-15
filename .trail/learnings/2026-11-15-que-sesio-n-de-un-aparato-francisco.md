---
title: "Qué sesión de un aparato recibe avisos se anota en platform_devices.entry, no se elige al enviar"
author: Francisco
date: 2026-11-15
branch: chore/cierre-fase-1e
cost: { minutes: 1, tokens: 0 }
id: l-9951a59a
scope: repo
status: active
replaces: l-f22bca49
src: agent
touches:
  - ".scratch/fase-1d4/spec.md"
  - docs/architecture/adr/0029-eventos-en-directo-y-avisos.md
  - packages/platform/identity/auth.ts
---

## Decided
El aparato guarda qué sesión suya está habilitada para avisos (`platform_devices.entry`, con el `deviceEntry` de la sesión). Se cambia cada vez que entra una sesión, antes de crearla, y nunca vuelve a una anterior, porque elegirla al enviar puede devolver los avisos a otra cuenta. Si la creación falla, el aparato se queda sin avisos: se prefiere perder un aviso a mandarlo a otra cuenta. La garantía la sostiene la comprobación antes de cada envío y al registrar la suscripción, en la misma transacción, porque la limpieza posterior puede fallar.

## Tried and ruled out
- Una suscripción ligada solo a su `session_id`: no basta, porque un navegador tiene un único endpoint y un aparato guarda sesiones de varias cuentas, así que dos personas en un portátil compartido registrarían el mismo endpoint.
- Elegir al enviar la sesión más reciente del aparato por `created_at`: si la nueva termina y su limpieza había fallado, la antigua recupera los avisos.
- Anular la suscripción solo desde un hook de Better Auth: si falla tras crear la sesión, quedan avisos de la cuenta anterior.

## Watch out
Cambiar a una sesión ya existente sin volver a entrar (un plugin multi-session, en la fase 3) también tiene que mover la marca, porque si no la sesión cambiada no recibiría avisos.

In the code: ADR 0029 («Una suscripción habilitada por aparato»); `session.create.before` en `packages/platform/identity/auth.ts`.
