# 05. `ctx.notify`, repartir y enviar avisos por Web Push

Status: resolved
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

- [x] Una nota con `notify` a la otra persona deja un aviso. Con `background.runDue()` llega una petición al servicio falso por cada suscripción habilitada del destinatario y por ninguna otra.
- [x] La prueba descifra el contenido, comprueba que solo lleva el destino, verifica la firma VAPID con la clave pública de la 04 y las cabeceras `TTL: 86400` y `Urgency: normal`.
- [x] El aviso termina con `outcome` `distributed` y cada entrega con `sent`.
- [x] Destinatario `device` o inexistente: `not-member`. Nota borrada antes de repartir: `record-gone`. Nota privada de otra persona o permiso quitado: `not-visible`. En ninguno de los casos hay entregas.
- [x] Un `about` con un tipo que no es de una tabla con dueño del módulo revierte la escritura.
- [x] Repetir la escritura con la misma clave no deja otro aviso.
- [x] Deshacer antes de repartir: el aviso no corre. Con `distributing`, deshacer frente al reparto en los dos órdenes: o no hay entregas, o las entregas pendientes quedan canceladas.
- [x] Un rechazo en `distributed` reintenta el aviso sin una segunda tanda de entregas.
- [x] Con `startChild`, el proceso muere con el reparto confirmado y antes de marcar el fin. Al reabrir la misma base, la recuperación vuelve a correr el aviso y no duplica las entregas.
- [x] Con `delivering`, entre la pausa y el envío la prueba quita el permiso, borra la nota, la vuelve privada, termina o hace caducar la sesión, o entra otra cuenta en el aparato. En cada caso no sale nada y la entrega termina con su `outcome`.
- [x] Las entregas pendientes de una sesión no pasan a la cuenta que entra después en el aparato.
- [x] La decisión de si `to` ve el registro tiene sus propias pruebas puras.
- [x] `pnpm check` pasa.

Si la 03 o la 04 llegan antes a `main` con su propia migración, esta tarea regenera la suya encima.

## Comments

- Hecho en `cf8b059`.
- Las costuras que dejo: `noticeDecision(view, to, record)` de `authorization/notices.ts` (pura; `record` es `{ area, owner, visibility }` o `null`) y `recordFacts(connection, modules)` de `notifications/records.ts`, que encuentra los hechos por módulo y tipo. La 07 añade ahí la tabla de área: una variante de `NoticeRecord` sin dueño y sus tablas en `recordFacts`. El trabajo `notice` y el `delivery` están en `notifications/notices.ts` (`noticeJobs`), y `createNotifications` los da en `jobs`, que el segundo plano recibe en su opción nueva `kinds`.
- Para la 06: el envío está al final del `run` de `DELIVERY`. Hoy, cualquier respuesta que no sea 2xx lanza `PushServiceError` con código `HTTP_<estado>`, un fallo pasajero: ahí entra la clasificación y `Retry-After` (con `PassingJobError` y `notBefore`). El plazo está en `platform_deliveries.deadline` (la creación del aviso más `NOTICE_LIFETIME`, 24 h), que `prepare` aún no lee. El servicio falso responde con `push.answer(responder)` (201 por defecto) y su `fetch` recibe la señal del trabajo, pero aún no simula una petición que no termina. La revalidación del endpoint ya está, como fallo definitivo `PUSH_ENDPOINT_NOT_ALLOWED`, y su prueba cambia `push.hosts`.
- Para la 08: terminar una sesión borra su suscripción (clave ajena), así que sus entregas pendientes terminan `subscription-gone`; la caducidad da `session-ended`. Restaurar cancela avisos y entregas porque son trabajos de `platform_jobs`.
- Para la 09: el `payload` de `notice` es un `z.strictObject({ to, module, type, id })`; el de prueba necesita una unión con `{ kind: "test", to }`, que se salte `records` y `noticeDecision` en el reparto y en la entrega, y un contenido `{ kind: "test", notice }`. El aviso se deja con `NOTICE` de `actions` y el mismo `leave` de la escritura en curso.
- `JobContext` lleva ahora `id`, y `Outbox.enqueue` devuelve el id del trabajo. `PlatformOptions` gana `origins` (`apps/api` pasa `DOMUS_ORIGINS`) y `PlatformRuntime` gana `fetch` (solo pruebas). `test-utils`: opciones `push` y `origins`, `fakePushService`, `pushClient`, `vapidClaims`, `TEST_PUSH_SUBJECT`; sin `push`, una entrega que enviaría falla.
- Decidido sin preguntar, y anotado en la spec: `web-push` 3.6.7 (la 4.0.0 tiene una semana, es ESM y sin tipos); los códigos `UNKNOWN_RECORD`, `PUSH_ENDPOINT_NOT_ALLOWED` y `PUSH_KEYS_INVALID`; el orden de la comprobación de la entrega; `ctx.notify` desde una lectura como fallo interno; las claves ajenas de `platform_deliveries` con `ON DELETE CASCADE`, porque la limpieza borra los trabajos terminados.
- En las pruebas, mover el reloj meses (a la caducidad de una sesión de `browser()`) despertando corre la limpieza, que borra el aviso terminado y, en cascada, las filas de sus entregas: se mueve con `{ wake: false }` y se espera con `settled()`. Lo guarda una nota de trail.
- Revisión de código: `ctx.notify` comprueba que `about.id` es un número entero, como la 07 con los registros tocados de tablas de área (`isRecordId` en `actions/index.ts`): `"1"` o `1.5` revierten la escritura con un fallo interno. La entrega retenida en `delivering` cubre también darse de baja con `DELETE /api/notifications/subscription`: no envía y termina `subscription-gone`.
- Revisión de código: `isPerson(view, account)` de `authorization/index.ts` es la única regla de «la cuenta es de una persona» (`personByItself`, `noticeDecision`, `testNoticeDecision`), e `isVisibleTo(record, account)` de `authorization/visibility.ts`, junto a `visibleTo`, la de «suyo o público» en memoria (`invalidations.ts` y `notices.ts`). `RecordKey` (`{ module, type, id }`, en `authorization/invalidations.ts`) es la base de `AreaRecordChange`, lo que lee `RecordFacts` y, con `to`, `NoticePayload` de `actions`; `LoggedRecord` no servía porque su `id` es texto. La visibilidad es `Visibility`, no `string`, en `Ownership` (antes `RecordState`), `OwnedNoticeRecord`, `RowTransition` y la fila de la captura. `recordTablesOf(module)` de `module-sdk` lista las tablas con dueño y de área con su nombre, tipo y área, y lo usan `actions/index.ts`, `capture.ts`, `notifications/records.ts` y `checkTables`; `references.ts` busca el tipo de una tabla dada, no lista, y sigue con `ownedTableOf`. `records.ts` cita los nombres con `quoted` de `capture.ts`. En `probe`, `notifyAbout` recibe el tipo y `addLabel` lo usa.
- Revisión de código, se queda así: `PermanentJobError` y `PassingJobError` no tienen una base común, porque solo comparten un campo (`code`); las dos ramas `"kind" in notice` de `notices.ts` (la decisión y el contenido) siguen separadas, porque son solo dos sitios; `createActions` sigue recibiendo la bandeja de salida, las invalidaciones y lo que hace `notify`, porque el ADR 0022 lo hace el único camino de toda acción.
