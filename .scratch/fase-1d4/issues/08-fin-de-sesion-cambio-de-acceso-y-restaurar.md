# 08. Fin de sesión, cambio de acceso y restaurar

Status: ready-for-agent
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

- [ ] Cada una de las cuatro formas internas (cerrar sesión por `browser()`, `revokeSession`, `revokeDevice` y cambiar la contraseña) escribe `purge` en los canales de las sesiones que termina y en ningún otro, y los cierra.
- [ ] Si la transacción que termina la sesión se revierte, no sale ningún `purge`.
- [ ] Una sesión que caduca con su fila en la base recibe `purge` en el siguiente latido.
- [ ] Una sesión terminada desde una segunda conexión a la misma base en fichero recibe `purge` en el siguiente latido. La prueba deja escrito que esto demuestra la detección del cambio externo, no que `pnpm accounts` revoque bien, que ya lo cubren sus pruebas de la 1c.
- [ ] En cada una de las formas, la suscripción de la sesión terminada desaparece y la de una sesión anterior del aparato sigue sin estar habilitada.
- [ ] Quitar `read` en un área con el canal abierto: `reset` y cierre. Al reconectar, `ready`, y lo de esa área ya no llega.
- [ ] Dar `read` en un área: `reset` sin cierre, y desde ahí llegan sus invalidaciones.
- [ ] Cambiar la delegación de la cuenta no manda nada por el canal.
- [ ] Con `restoreBackup`, sobre una copia con suscripciones, avisos y entregas pendientes: tras restaurar no hay suscripciones, los trabajos están cancelados y no salen al arrancar, y `GET /api/notifications/key` responde la clave de la copia.
- [ ] `pnpm check` pasa.
