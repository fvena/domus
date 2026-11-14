# 08. Fin de sesión, cambio de acceso y restaurar

Status: resolved
Blocked by: 02, 05

Spec: [`../spec.md`](../spec.md), secciones «Cuando termina una sesión», «El reparto de invalidaciones» (`reset` y el cierre al perder acceso) y «Restaurar». Costura 4. ADR 0029.

## Qué construir

Cuando termina una sesión, su canal le pide a la app borrar lo que tiene y se cierra, y la sesión no recibe más avisos. Cuando el admin cambia los permisos de una cuenta, sus canales vuelven a pedirlo todo; si pierde acceso, además se cierran. Restaurar no deja nada antiguo que pueda salir.

Garantías:

- Cerrar sesión, revocar una sesión, revocar un aparato y cambiar la contraseña, dentro de `api`, escriben `purge` y cierran los canales de las sesiones terminadas después de confirmar, nunca antes.
- Una sesión que caduca de forma natural, sin que nadie borre su fila, la cierra el latido con `purge`.
- Lo que termina sesiones desde fuera de `api` (`pnpm accounts`, restaurar) lo recoge el latido, sin pasar por el reparto en memoria.
- Ninguna forma de terminar una sesión vuelve a habilitar una suscripción anterior de su aparato.
- `permissions/set` manda `reset` a los canales de la cuenta tras confirmar, y los cierra después si con el cambio perdió `read` en algún área.
- Restaurar deja la base sin suscripciones, con los avisos y entregas de la copia cancelados y con las claves VAPID de la copia.

Cómo se reparte el trabajo entre `identity` y `events` (un camino común con el motivo, el hook de borrado de Better Auth o envolver `/sign-out`) se decide al implementar, dentro de lo que dice la spec.

## Criterios de aceptación

- [x] Cada una de las cuatro formas internas (cerrar sesión por `browser()`, `revokeSession`, `revokeDevice` y cambiar la contraseña) escribe `purge` en los canales de las sesiones que termina y en ningún otro, y los cierra.
- [x] Si la transacción que termina la sesión se revierte, no sale ningún `purge`.
- [x] Una sesión que caduca con su fila en la base recibe `purge` en el siguiente latido.
- [x] Una sesión terminada desde una segunda conexión a la misma base en fichero recibe `purge` en el siguiente latido. La prueba deja escrito que esto demuestra la detección del cambio externo, no que `pnpm accounts` revoque bien, que ya lo cubren sus pruebas de la 1c.
- [x] En cada una de las formas, la suscripción de la sesión terminada desaparece y la de una sesión anterior del aparato sigue sin estar habilitada.
- [x] Quitar `read` en un área con el canal abierto: `reset` y cierre. Al reconectar, `ready`, y lo de esa área ya no llega.
- [x] Dar `read` en un área: `reset` sin cierre, y desde ahí llegan sus invalidaciones.
- [x] Cambiar la delegación de la cuenta no manda nada por el canal.
- [x] Con `restoreBackup`, sobre una copia con suscripciones, avisos y entregas pendientes: tras restaurar no hay suscripciones, los trabajos están cancelados y no salen al arrancar, y `GET /api/notifications/key` responde la clave de la copia.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `ae8e9d0`.
- El camino común es `endSessions(connection, which, why, ended?)` de `identity/sessions.ts`; cerrar sesión llega por `databaseHooks.session.delete.after` de Better Auth, que `createAuth` recibe como `ended`. Dentro de `api`, `ended` es `events.sessionsEnded`, y `permissions/set` llama a `events.accessChanged(account, closes)` con `readLost(before, after)` de `authorization/invalidations.ts`. Las dos dejan su marca en la tabla temporal de las invalidaciones, dentro de su transacción, así que el reparto va en orden de confirmación y un rollback no manda nada. `Events` implementa `IdentityChanges` de `identity/operations.ts`, que `platformOperations` recibe ahora como tercer argumento.
- Decidido sin preguntar, y anotado en la spec: `reset` sale con cada `permissions/set` confirmado, aunque el nivel no cambie; la prueba del rollback hace fallar la entrada del registro de `revokeSession` con un disparador temporal escrito por el cliente en bruto de `probe`; la segunda conexión es otra plataforma de pruebas sobre el mismo fichero; la caducidad con la fila todavía ahí la cubre ya `events.test.ts` (02).
- Restaurar ya cumplía su garantía: `restore-notices.test.ts` lo deja probado, con una entrega retenida en `delivering` para que la otra y un segundo aviso esperen durante la copia.
- Sigue abierto lo que dejó la 01: las confirmaciones pendientes miran solo si su sesión existe, no si vive. Esta tarea no lo cambia.
