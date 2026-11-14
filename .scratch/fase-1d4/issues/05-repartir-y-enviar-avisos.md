# 05. `ctx.notify`, repartir y enviar avisos por Web Push

Status: ready-for-agent
Blocked by: 03, 04

Spec: [`../spec.md`](../spec.md), secciones «`ctx.notify`», «El aviso y su reparto», «La entrega y el envío» (la respuesta buena; el resto es la 06) y «`probe`» (`notify` en las notas). Costuras 1, 2 (`distributing`, `distributed` y `delivering`) y 3. ADR 0029.

## Qué construir

Rocío añade una nota pública y pide avisar a Paco. El móvil de Paco recibe «Tienes un aviso en Domus», y al abrirlo la app sabe que trata de esa nota. Si Rocío lo deshace antes de que salga, no sale.

- **`ctx.notify({ to, about })`** en el contexto de una escritura, solo sobre un tipo de una tabla con dueño del propio módulo (las tablas de área llegan con la 07). Un tipo desconocido revierte la escritura con un fallo interno. Deja un trabajo `notice` en la bandeja de la 03.
- **El trabajo `notice`**: en una sola transacción, la entrada no deshecha, `to` es un miembro, el registro existe, `to` lo ve (función pura de `platform/authorization`), y una entrega por cada suscripción habilitada, sin repetir las que ya existen. Cada resultado queda en `outcome`.
- **`platform_deliveries`**, con migración generada y la restricción única sobre aviso y suscripción, y el plazo de 24 h.
- **El trabajo `delivery`**: el punto `delivering`, después la comprobación (la suscripción existe, su sesión vive y no ha caducado, es la habilitada de su aparato, el registro existe y `to` lo ve, y el endpoint está admitido), después el envío. `generateRequestDetails` de `web-push` y `fetch` con `redirect: "manual"` y la señal del trabajo. Un 2xx termina con `outcome` `sent`.
- **El contenido cifrado** es solo `{ module, type, id, notice }`.
- **`probe`**: `addNote` y `editNote` aceptan `notify`.
- **`test-utils`**: la opción `push`, con el servicio de push falso (hosts admitidos y `fetch` inyectado que anota cada petición), y la ayuda para generar claves reales de suscripción y descifrar.

## Criterios de aceptación

- [ ] Una nota con `notify` a la otra persona deja un aviso. Con `background.runDue()` llega una petición al servicio falso por cada suscripción habilitada del destinatario y por ninguna otra.
- [ ] La prueba descifra el contenido, comprueba que solo lleva el destino, verifica la firma VAPID con la clave pública de la 04 y las cabeceras `TTL: 86400` y `Urgency: normal`.
- [ ] El aviso termina con `outcome` `distributed` y cada entrega con `sent`.
- [ ] Destinatario `device` o inexistente: `not-member`. Nota borrada antes de repartir: `record-gone`. Nota privada de otra persona o permiso quitado: `not-visible`. En ninguno de los casos hay entregas.
- [ ] Un `about` con un tipo que no es de una tabla con dueño del módulo revierte la escritura.
- [ ] Repetir la escritura con la misma clave no deja otro aviso.
- [ ] Deshacer antes de repartir: el aviso no corre. Con `distributing`, deshacer frente al reparto en los dos órdenes: o no hay entregas, o las entregas pendientes quedan canceladas.
- [ ] Un rechazo en `distributed` reintenta el aviso sin una segunda tanda de entregas.
- [ ] Con `startChild`, el proceso muere con el reparto confirmado y antes de marcar el fin. Al reabrir la misma base, la recuperación vuelve a correr el aviso y no duplica las entregas.
- [ ] Con `delivering`, entre la pausa y el envío la prueba quita el permiso, borra la nota, la vuelve privada, termina o hace caducar la sesión, o entra otra cuenta en el aparato. En cada caso no sale nada y la entrega termina con su `outcome`.
- [ ] Las entregas pendientes de una sesión no pasan a la cuenta que entra después en el aparato.
- [ ] La decisión de si `to` ve el registro tiene sus propias pruebas puras.
- [ ] `pnpm check` pasa.

Si la 03 o la 04 llegan antes a `main` con su propia migración, esta tarea regenera la suya encima.
