# 02. El canal en directo con las invalidaciones de las tablas con dueño

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Dónde vive», «Lo que la escritura recuerda», «El reparto de invalidaciones» (salvo `reset`, que es la 08) y «El canal». Costura 1 y costura 5 de «Decisiones de prueba». ADR 0029.

## Qué construir

Paco y Rocío tienen la app abierta. Rocío añade una nota pública y a los dos les llega en el acto que ha cambiado. Si la nota es privada, solo le llega a ella.

- **`platform/events`**: el registro de canales abiertos por sesión y el reparto tras confirmar. Una regla de dependencias deja fuera a los módulos y a `module-sdk`, con su prueba de arquitectura.
- **Lo que la escritura recuerda**: el primer «antes» y el último «después» de cada registro capturado, con su área, tomados de la captura antes de vaciarla. Si la escritura se revierte, se descarta. Deshacer recorre el mismo camino.
- **La decisión**: una función pura de `platform/authorization` dice si un registro llega a un canal, con los permisos vigentes de su cuenta y el antes y el después del registro.
- **`GET /api/events`**: una ruta de Hono con `streamSSE`, solo con sesión. `ready` cuando el canal ya está registrado, `invalidate` con `{ records }`, el orden de confirmación, un latido cada 25 s con el temporizador de la plataforma que comprueba que la sesión vive (si no, `purge` y cierre), 6 canales por sesión y un tope de 100 eventos en cola.
- **`test-utils`**: un analizador de SSE sobre el `ReadableStream` de la respuesta que no depende de cómo se partan los bytes, y una opción para bajar el tope de la cola.

## Criterios de aceptación

- [x] Dos personas en sesiones distintas, con el canal abierto: una nota pública nueva llega a las dos; una privada solo a su dueño, y la otra no recibe nada.
- [x] Pasar una nota de pública a privada llega al lector anterior. Pasarla de privada a pública llega al nuevo lector.
- [x] Una nota que pasa a pública y vuelve a privada en la misma escritura no llega a la otra persona.
- [x] Una escritura que se revierte no invalida nada.
- [x] Deshacer una escritura invalida los registros que vuelven a cambiar, a quien los veía o los ve.
- [x] Una sesión sin `read` en el área no recibe nada de ella, y la cuenta `device` recibe lo público de las áreas que puede ver.
- [x] Cada canal recibe un solo `invalidate` por escritura, sin registros repetidos y con la forma `{ module, type, id }`.
- [x] `ready` llega antes que cualquier invalidación, y una escritura confirmada después de `ready` siempre llega.
- [x] Los eventos llegan en el orden en que se confirmaron sus escrituras.
- [x] Abrir el séptimo canal de una sesión cierra el más antiguo, sin `purge`.
- [x] Una prueba que deja de leer llega al tope de la cola, comprueba por la puerta que el canal se cierra y que la cola no sigue creciendo.
- [x] El latido sale cada 25 s del reloj de pruebas. Si la sesión ha caducado, escribe `purge` y cierra.
- [x] Sin sesión, `GET /api/events` responde `401` en JSON, sin el sobre RPC.
- [x] La función pura de la decisión tiene sus propias pruebas: con y sin `read`, antes y después, dueño o público, creado y borrado.
- [x] La regla de dependencias de `events` salta en su prueba de arquitectura.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `343974c`.
- La escritura deja sus registros cambiados con `invalidations.remember(changesOf(transitions))` en `perform` de `actions/index.ts`, después de los trabajos de la bandeja y antes de `capture.clear()`. `events` los guarda en una tabla temporal dentro de la transacción (un rollback, también de un savepoint, los deshace) y los reparte cuando no queda ninguna transacción abierta. Anotado en la spec.
- La decisión es `invalidationReaches(view, account, change)` de `authorization/invalidations.ts`, sobre `RecordChange` (`before` y `after` con dueño y visibilidad, `null` si no existía). La 07 añade ahí la variante de la tabla de área, sin dueño, y en `perform` sus registros tocados.
- `events/index.ts` tiene ya `end(channel)` (`purge` y cierre tras lo que tenía) y `cut(channel)` (cierre sin `purge`, tirando la cola), y `share()`, que reparte lo confirmado. La 08 debe llamar a `share()` antes de mandar `reset` o `purge`, para no adelantar a una escritura ya confirmada, y exponer desde `Events` el fin por sesiones y el `reset` por cuenta.
- Decidido sin preguntar, y anotado en la spec: cada reparto comprueba también que la sesión de cada canal vive y, si no, le manda `purge` sin esperar al latido; el corte tira lo que había en cola; el latido ocupa sitio en la cola; su comentario es `: heartbeat`.
- Las pruebas usan el latido como centinela de «no llegó nada más»: lo confirmado antes de un latido sale antes que él. `test-utils` ofrece `openChannel(browser)`, `readEvents(stream)` y la opción `channelQueue`.
- Better Auth pone la caducidad con la hora real: dos navegadores que entran con milisegundos de diferencia caducan con milisegundos de diferencia. Para que uno siga vivo, se hace caducar el que entró antes.
