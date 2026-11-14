# Fase 1d4: eventos en directo y avisos

Status: ready-for-agent

Esta spec sale del grilling de la fase 1d4 ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-14, preguntas Q1–Q24, con las enmiendas de su revisión, y del acuerdo posterior sobre las costuras de prueba. Las decisiones duraderas están en el [ADR 0029](../../docs/architecture/adr/0029-eventos-en-directo-y-avisos.md), que precisa los ADR [0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md) y [0025](../../docs/architecture/adr/0025-segundo-plano.md). Si esta spec y los ADR no coinciden, mandan los ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): invalidación, bandeja de salida, aviso, suscripción, entrega, trabajo, carril, aparato, sesión, contexto verificado, tabla con dueño, tabla de área, visibilidad, captura de escrituras, acción, deshacer y restaurar.

## Problema

Después de la 1d3, Domus guarda notas, archivos y copias, pero lo que ve cada persona solo cambia cuando vuelve a pedirlo. Si Rocío añade «leche» a la lista desde la cocina, el móvil de Paco no se entera hasta que recarga. Y Domus no tiene forma de llamar la atención de nadie: un recordatorio, un aviso de que algo cambió o, en la fase 5, «he terminado lo que me pediste» no tienen por dónde salir.

Avisar sin más no basta. La casa necesita:

- que lo que llega en directo a una sesión sea solo lo que esa sesión puede ver, también cuando una nota pasa de pública a privada o cuando se quita un permiso con la app abierta;
- que cerrar sesión, revocar un aparato o cambiar la contraseña corte el canal en el acto, y que una sesión caducada no siga recibiendo nada;
- que un aviso llegue al móvil de su persona y a ningún otro, aunque Paco y Rocío compartan un portátil o una pantalla de pared;
- que la pantalla bloqueada no diga nada de lo que hay en Domus, porque el móvil se ve en la cocina;
- que deshacer una escritura cancele los avisos que todavía no han salido;
- que un servicio de push que falla, que tarda o que responde raro no atasque el carril corto ni repita lo que ya llegó;
- que la Pi solo hable con servicios de push conocidos, porque la dirección a la que envía la pone el navegador.

## Solución

`platform` gana un canal en directo por sesión, `GET /api/events`, por el que solo viajan invalidaciones: qué registros cambiaron, sin su contenido. Tras confirmar una escritura, `api` reparte en memoria a cada canal abierto los registros que su sesión veía al empezar la escritura o ve al terminarla. Cuando cambian los permisos de una cuenta, sus canales reciben `reset`; cuando termina una sesión, `purge`, y la app borra lo que tiene.

La bandeja de salida deja de ser solo una palabra del glosario: un trabajo guarda sus datos y la entrada del registro de acciones que lo dejó, y deshacer esa entrada cancela lo que aún no ha empezado. Su primer uso son los avisos. Un módulo pide uno con `ctx.notify({ to, about })` dentro de una escritura, siempre sobre uno de sus registros. El trabajo del aviso comprueba que el destinatario ve ese registro, lo reparte en una entrega por cada suscripción habilitada y cada entrega vuelve a autorizar antes de enviarse por Web Push.

Una suscripción la registra la app desde la sesión que el aparato tiene habilitada. Cada aparato tiene como mucho una; entrar con otra cuenta la deja sin efecto en el acto. Las claves VAPID se generan en el primer arranque. La plataforma ofrece además «envíame un aviso de prueba», para que la fase 2 reciba un aviso real antes de que exista ningún módulo que los envíe.

`probe` gana una tabla de área y avisos en sus escrituras para demostrar la integración, y la 1d4 termina comprobando el canal en la Pi, por Tailscale, en el ensayo.

## Historias de usuario

1. Como miembro, quiero que lo que veo en la app se actualice solo cuando otro cambia algo que puedo ver, para no tener que recargar.
2. Como miembro, quiero que el canal en directo no me diga qué cambió dentro de un registro, sino solo que cambió, para que lo que llega por él nunca lleve más de lo que la app pediría.
3. Como miembro, quiero que un cambio en una nota privada de la otra persona no me llegue de ninguna forma, ni siquiera como «algo cambió», para que lo oculto no exista.
4. Como miembro, quiero que cuando la otra persona vuelve privada una nota que yo veía, mi app se entere y la retire, para no seguir viendo lo que ya no puedo ver.
5. Como miembro, quiero que cuando una nota pasa a pública me llegue la invalidación, para verla sin recargar.
6. Como miembro, quiero que una nota que pasa a pública y vuelve a privada dentro de la misma escritura no me llegue, porque nunca fue pública para mí.
7. Como miembro, quiero que una escritura que se revierte no invalide nada, para no volver a pedir datos que no cambiaron.
8. Como miembro, quiero que deshacer una escritura invalide lo que vuelve a cambiar, para ver el estado restaurado.
9. Como miembro, quiero que un cambio en un registro de una tabla sin dueño de un área que puedo ver me llegue, para que las listas comunes de la casa también se actualicen.
10. Como miembro, quiero que si el admin me quita el permiso de un área con la app abierta, mi app tire lo que tenía y vuelva a pedirlo con lo que ya puedo ver.
11. Como miembro, quiero que si me dan permiso en un área con la app abierta, mi app vuelva a pedir sus datos, para verlo sin recargar.
12. Como miembro, quiero que cerrar mi sesión en un navegador corte su canal en el acto y le pida borrar lo que tenga.
13. Como miembro, quiero que revocar una de mis sesiones desde otro aparato corte el canal de esa sesión en el acto.
14. Como admin, quiero que revocar el emparejamiento de un aparato corte los canales de todas sus sesiones.
15. Como miembro, quiero que cambiar mi contraseña corte los canales de mis otras sesiones.
16. Como miembro, quiero que una sesión que caduca deje de recibir invalidaciones y avisos aunque nadie la haya revocado.
17. Como miembro, quiero que un cambio de contraseña hecho con `pnpm accounts`, fuera de `api`, también acabe cerrando los canales de mis otras sesiones en poco tiempo.
18. Como miembro, quiero que al reconectar el canal la app vuelva a pedir lo que muestra, para no fiarse de lo que se perdió mientras estaba cortado.
19. Como miembro, quiero que una actualización que llega mientras la app está leyendo no se pierda, para que la pantalla no se quede con el estado antiguo.
20. Como miembro con un móvil lento, quiero que si no doy abasto con las invalidaciones el canal se cierre y se rehaga, en vez de perder algunas en silencio.
21. Como miembro, quiero tener varias pestañas abiertas, cada una con su canal, sin que una sesión pueda abrir canales sin límite en la Pi.
22. Como pantalla de pared con la cuenta `device`, quiero recibir las invalidaciones de lo público que puedo ver, para que lo que muestro esté al día.
23. Como miembro, quiero recibir un aviso en el móvil cuando un módulo tenga algo para mí, para no tener que estar mirando la app.
24. Como miembro, quiero que la pantalla bloqueada diga solo «Tienes un aviso en Domus», para que quien mire mi móvil en la cocina no lea nada.
25. Como miembro, quiero que al tocar el aviso la app abra el registro del que trata, y que vuelva a comprobar que puedo verlo.
26. Como miembro, quiero no recibir un aviso sobre un registro que ya no puedo ver cuando sale, aunque pudiera verlo cuando se pidió.
27. Como miembro, quiero no recibir un aviso sobre un registro que se borró antes de salir.
28. Como miembro, quiero que deshacer la escritura que dejó un aviso lo cancele si todavía no ha salido.
29. Como miembro, quiero que un aviso repetido por un reintento sustituya al anterior en la pantalla en vez de apilarse.
30. Como miembro, quiero recibir el aviso en todos mis aparatos con una suscripción habilitada, y que si uno falla los demás lo reciban igual.
31. Como miembro, quiero que un fallo pasajero del servicio de push se reintente sin volver a mandar el aviso a los aparatos que ya lo recibieron.
32. Como miembro, quiero que si el servicio de push dice que mi suscripción ya no existe, Domus la olvide.
33. Como miembro que comparte un portátil con la otra persona, quiero que cuando ella entra con su cuenta mis avisos dejen de llegar a ese navegador en el acto, aunque ella no active los suyos.
34. Como miembro, quiero que si luego ella cierra su sesión, mis avisos no vuelvan solos a ese navegador hasta que yo entre otra vez.
35. Como miembro, quiero que una pestaña antigua con una sesión anterior no pueda quitarle la suscripción a la sesión vigente del aparato.
36. Como miembro, quiero que los avisos que estaban pendientes para mi sesión no lleguen a la cuenta que entra después en ese aparato.
37. Como pantalla de pared con la cuenta `device`, quiero no poder suscribirme a avisos, porque no tengo una persona detrás.
38. Como miembro, quiero que suscribirme dos veces desde la misma sesión no duplique los avisos.
39. Como miembro, quiero darme de baja de los avisos en un aparato sin cerrar sesión.
40. Como miembro, quiero pedir un aviso de prueba desde la app, para comprobar que mi móvil los recibe.
41. Como miembro, quiero que el aviso de prueba me llegue solo a mí, y que pedirlo sin tener ninguna suscripción no falle.
42. Como admin, quiero que la Pi solo envíe avisos a los servicios de Apple, Google y Mozilla, para que una dirección inventada por un navegador no la use para hacer peticiones a otro sitio.
43. Como admin, quiero que un servicio de push que no responde no deje el carril corto ocupado más allá de su tiempo máximo.
44. Como admin, quiero que si el servicio de push pide esperar, Domus espere al menos eso, y que si la espera supera el plazo del aviso, lo dé por caducado.
45. Como admin, quiero que un rechazo por la firma VAPID quede como fallo visible sin borrar las suscripciones, porque un reloj desfasado los daría en todas.
46. Como admin, quiero que las claves VAPID se generen solas y sobrevivan a reiniciar y a recrear `api`, para que las suscripciones sigan sirviendo.
47. Como admin, quiero que restaurar una copia anule todas las suscripciones y descarte las entregas pendientes de la copia, para que nada antiguo salga después.
48. Como admin, quiero que ninguna respuesta de la API se guarde en la caché del navegador ni de un intermediario, también los errores y el inicio de sesión.
49. Como quien escribe un módulo, quiero pedir un aviso con `ctx.notify({ to, about })` dentro de una escritura, sin saber nada de colas, suscripciones ni Web Push.
50. Como quien escribe un módulo, quiero que un aviso sobre un tipo de registro que no es de mis tablas sea un error que revierta la escritura, para enterarme al probar.
51. Como quien escribe un módulo, quiero declarar una tabla sin dueño como tabla de área, para que sus cambios se invaliden y sus registros puedan tener avisos.
52. Como quien escribe un módulo, quiero que una tabla sin dueño que no declaro no invalide nada y no admita avisos, para que la visibilidad nunca se suponga.
53. Como quien escribe un módulo, quiero que las invalidaciones salgan solas de lo que mis escrituras tocan, sin llamar a nada.
54. Como Kira, en la fase 5, quiero que mis escrituras invaliden igual que las de la app, porque pasan por el mismo camino de las acciones.

## Decisiones de implementación

### Dónde vive (estructura)

- Dos partes nuevas de `platform`, las que el README ya anunciaba: `events` (el canal y el reparto de invalidaciones) y `notifications` (suscripciones, claves VAPID, el aviso, el reparto en entregas y el envío).
- `module-sdk` solo expone `ctx.notify`, y solo en el contexto de una escritura. Una regla de dependencias impide que los módulos y `module-sdk` alcancen `events` y `notifications`, y una prueba de arquitectura prueba que salta.
- `web-push` entra como dependencia de `platform`. Solo se usa su `generateRequestDetails`; la petición la hace `fetch`.

### Lo que la escritura recuerda (Q12, Q13)

- Durante la transacción de una escritura, la plataforma conserva en memoria, por registro capturado, el área de su tabla, el primer «antes» (existía o no, dueño, visibilidad) y el último «después». Los estados intermedios no cuentan. Esto se toma de la captura antes de `capture.clear()` y no cambia lo que la captura comprueba.
    - Decidido al implementar (02): la lista de cada escritura se guarda en una tabla temporal de la conexión, dentro de la transacción de la escritura, así que un rollback, de la escritura entera o de un savepoint, también la deshace. El reparto lee lo confirmado en orden en cuanto no queda ninguna transacción abierta (una microtarea), y también antes de cada latido y de abrir un canal, para que un latido nunca adelante a una escritura confirmada antes. El reparto a los canales sigue en memoria.
- Los registros tocados que el manejador declara en una tabla de área entran con su área y sin dueño ni visibilidad.
- Un tipo de registro de una tabla que no es con dueño ni de área no se recuerda: no invalida a nadie.
- Al confirmar, la lista pasa al reparto de invalidaciones. Si la transacción se revierte, se descarta sin publicar nada. Deshacer recorre el mismo camino y publica lo suyo.

### Tabla de área (Q13)

- `moduleTables` gana `areaTable(name, { type, area }, columns)`: una tabla sin dueño ni visibilidad que declara su tipo de registro y su área, con `id` entero como única clave, como las tablas con dueño. Su regla de visibilidad es toda ella: la ve quien tiene `read` en su área.
- La `table` de siempre sigue existiendo y queda desconocida para la plataforma: no invalida y no admite avisos.
- El tipo de registro es único dentro de un módulo entre sus tablas con dueño y de área; `start` rechaza un tipo repetido.
- Término nuevo del glosario: **Tabla de área**.

### El reparto de invalidaciones (Q1, Q12, Q15)

- Tras confirmar, para cada canal abierto, `platform/authorization` decide con una función pura, alimentada con los permisos vigentes de la cuenta del canal y el antes y el después de cada registro, si le llega:
    - tabla con dueño: tiene `read` en el área ahora, y (antes existía y era suyo o público) o (después existe y es suyo o público);
    - tabla de área: tiene `read` en el área ahora.
- Cada canal recibe un solo `invalidate` por escritura, con la lista de los registros que le llegan, sin repetidos. Si no le llega ninguno, no recibe nada.
- El contexto del canal es el que la puerta selló al abrirlo: cuenta, aparato, sesión, canal `app`, sin `via`. La delegación no cuenta.
- Las tablas de la plataforma (confirmaciones, registro de acciones, tareas, sesiones) no invalidan en esta fase.
- Cambiar el permiso de una cuenta (`permissions/set`) manda, tras confirmar, `reset` a todos sus canales. Si con el cambio pierde `read` en algún área, además se cierra cada canal después del `reset`. Hoy no hay otra operación que cambie el perfil ni los permisos dentro de `api`.
- La cola de cada canal tiene un tope de 100 eventos pendientes de escribir. Al superarlo, el canal se cierra sin `purge`, y el navegador reconecta. La cola nunca crece por encima del tope.
    - Decidido al implementar (02): el canal que se corta, por el tope o por el séptimo canal, tira lo que tenía en cola; el latido también ocupa sitio en ella. Cada reparto comprueba además que la sesión de cada canal vive, y si no, le escribe `purge` y lo cierra, sin esperar al latido: una sesión caducada no recibe ni una invalidación más.

### El canal (Q16, Q20)

- `GET /api/events`, una ruta de Hono con `streamSSE`, solo con sesión. Sin sesión, `401` en JSON, con la regla de errores de las rutas de archivos.
- Al abrir, el canal se registra y después escribe `ready`. Desde ese momento recibe todo lo que se confirme. Los eventos de un canal salen en el orden en que se confirmaron sus escrituras.
- Eventos, cada uno con `event:` y `data:` en JSON:
    - `ready`, `{}`;
    - `invalidate`, `{ "records": [{ "module", "type", "id" }] }`;
    - `reset`, `{}`;
    - `purge`, `{}`.
- Sin `id:` de evento ni repetición de lo perdido.
- Un latido cada 25 s, un comentario SSE, con el reloj y el temporizador de la plataforma. Cada latido comprueba que la sesión vive. Si no, escribe `purge` y cierra. El comentario es `: heartbeat`.
- Como mucho 6 canales por sesión. Abrir el séptimo cierra el más antiguo, sin `purge`.
- Lo que hace la app (fase 2): abrir el canal antes de leer, volver a pedir todo lo que muestra tras cada `ready`, marcar como pendiente la lectura en curso que reciba una invalidación de lo que lee y repetirla al terminar, tirar y volver a pedir con `reset`, y con `purge` borrar lo que tiene y cerrar su `EventSource`.

### Cuando termina una sesión (Q14, Q21)

- Un solo camino en `identity` para terminar sesiones, con el motivo: cerrar sesión, revocar una sesión, revocar un aparato, cambiar la contraseña y restaurar. Las cinco operaciones lo usan. Cerrar sesión lo alcanza por el hook de borrado de sesión de Better Auth, si la versión instalada lo ofrece, o envolviendo `/sign-out` en la puerta; se decide al implementar, y la prueba lo cubre igual.
- Dentro de `api`, ese camino escribe `purge` y cierra los canales de las sesiones terminadas, después de confirmar la transacción que las termina, nunca antes.
- Restaurar trabaja con `api` parado y `pnpm accounts` es otro proceso. Sus cambios los recoge el latido.
- La regla única de que una sesión vive (`sessionLivesWhere` y `sessionLives`) pasa a exigir también que no haya caducado, con el reloj de la plataforma. Afecta a todos sus usos: comprobantes, archivos preparados, limpieza de preparados, referencias de archivo, canal y entregas. Las pruebas de la 1c y la 1d3 ganan el caso de la sesión caducada con su fila todavía en la base.
    - La comprobación recibe el instante: `sessionLives(connection)` da `(account, session, now)` y `sessionLivesWhere` toma la expresión SQL del instante, siempre del reloj de la plataforma. La de `actions/proofs.ts`, que solo miraba si la fila existe, pasa a llamarse `sessionExists`: decide si un comprobante queda atado a su sesión, no si la sesión vive.
    - Pedir un comprobante desde una sesión caducada, con su fila todavía ahí, responde `UNAUTHORIZED`, como la que termina mientras se comprueba la contraseña.
    - Las confirmaciones pendientes siguen mirando solo si su sesión existe: no están en la lista de usos.
    - En las pruebas, Better Auth pone la caducidad de las sesiones de `browser()` con la hora real y la plataforma usa el reloj de pruebas. `test-utils` gana `sessionExpiresAt(session)`, que lee la caducidad de la fila, y la prueba mueve el reloj hasta ella. El proceso hijo que sube un archivo (`hold: "publish"`) recibe `now`, como el de la limpieza, para que su sesión preparada viva en él.
- Las suscripciones cuelgan de su sesión con una clave ajena `ON DELETE CASCADE`. Terminar una sesión borra su suscripción, también al restaurar.

### `no-store` (Q17)

- Un middleware en `/api/*` pone `Cache-Control: no-store` en toda respuesta: RPC, rutas de archivos, `/api/events`, las de avisos, Better Auth y los errores de todas ellas. La descarga ya lo llevaba.

### La bandeja de salida (Q11)

- Migración generada de la plataforma. `platform_jobs` gana:
    - `payload`: los datos del trabajo, en JSON; nulo en los trabajos de las tareas programadas;
    - `entry`: la entrada del registro de acciones que lo dejó, con clave ajena; nula en el mantenimiento;
    - `outcome`: el resultado de un trabajo terminado bien que no es solo «hecho», como un aviso omitido y su motivo; nulo si no hace falta.
- Cada tipo de trabajo con datos declara su esquema. El motor valida `payload` con él al reclamar; un `payload` que no lo cumple es un fallo definitivo con su código.
- Un trabajo de la bandeja se inserta en la transacción de la escritura, después de su entrada del registro, así que lleva su `entry`. Despierta el motor solo después de confirmar, con el mismo mecanismo que ya usan los cambios de tareas.
- Para probar la bandeja antes de que existan los avisos, `@domus/platform/testing` ofrece encolar un trabajo sintético en la transacción de la escritura en curso, desde un manejador de `probe` envuelto por la prueba. Ningún módulo ni `module-sdk` lo alcanza.
- Deshacer una entrada cancela, en su misma transacción, los trabajos `pending` con esa `entry`, avisos y entregas incluidos. El estado pasa a `cancelled` con la razón `undone`. Reclamar y cancelar comprueban los dos `state = 'pending'`, así que solo gana uno.
- Un error pasajero puede llevar el instante mínimo de su próximo intento. El motor programa el reintento en el mayor de ese instante y su espera creciente, sin cambiar el número máximo de intentos.
- Detalles de la tarea 03:
    - el código del `payload` que no cumple es `INVALID_PAYLOAD`. Lo es también un `payload` ausente en un tipo con esquema, o uno presente en un tipo sin esquema. Encolar datos para un tipo sin esquema ya falla al encolar, porque es un error del código;
    - un `PermanentJobError` puede llevar un código, y el trabajo guarda `PermanentJobError <código>: <mensaje>`. Lo usarán `PUSH_REJECTED`, `PUSH_UNAUTHORIZED`, `PUSH_REDIRECT` y `DELIVERY_EXPIRED`;
    - el error pasajero con instante mínimo es `PassingJobError`, con `notBefore` y un código opcional. Como cualquier error pasajero, solo guarda su nombre y su código;
    - el trabajo de un tipo deja su `outcome` devolviendo un texto; si no devuelve nada, queda nulo;
    - la razón `undone` va en la columna `error`, como `discarded by restore` al restaurar.

### `ctx.notify` (Q2, Q5)

- `ctx.notify({ to, about })` en el contexto de una escritura: `to` es el id de una cuenta, y `about` es `{ type, id }`, un registro de una tabla con dueño o de área del propio módulo. El módulo lo pone la plataforma.
- Un `about` con un tipo que no es de una tabla con dueño o de área del módulo es un error del módulo: la escritura se revierte con un fallo interno.
- No comprueba en el momento que `to` sea un miembro ni que vea el registro: eso lo decide la entrega, con lo vigente entonces. Un `to` que es la cuenta `device`, o que no existe, deja un aviso que termina omitido.
- Deja un trabajo `notice` del carril corto con `{ to, module, type, id }` en `payload`, nunca texto.
- Una escritura puede dejar varios avisos. Repetirla con la misma clave devuelve el acuse y no deja otros.

### El aviso y su reparto (Q5, Q18, Q19)

- El trabajo `notice`, en una sola transacción:
    1. comprueba que su entrada no está deshecha; si lo está, termina con `outcome` `undone`;
    2. comprueba que `to` es un miembro (no `device`); si no, `not-member`;
    3. reúne los hechos del registro: la tabla del tipo, si existe y, si tiene dueño, su dueño y su visibilidad; si no existe, `record-gone`;
    4. `platform/authorization` decide con una función pura, con los permisos vigentes de `to`, si lo ve; si no, `not-visible`;
    5. crea una entrega por cada suscripción habilitada de `to`, con la restricción única sobre aviso y suscripción, saltando las que ya existen; termina con `outcome` `distributed`.
- Si `api` cae entre esta transacción y la marca de fin, la recuperación vuelve a correr el trabajo. Repetirlo no crea entregas que ya existen. Una suscripción que apareciera entre medias recibe la suya.
- Un tipo o una tabla desconocidos en un `payload` guardado (por ejemplo, de un módulo que ya no está) dejan el aviso como fallo definitivo, sin entregas.

### La entrega y el envío (Q9, Q19)

- Tabla nueva, `platform_deliveries`: el trabajo de la entrega (clave y clave ajena a `platform_jobs`), su aviso (clave ajena a `platform_jobs`), su suscripción (el id, sin clave ajena, porque la suscripción puede desaparecer antes) y su plazo (el instante de creación del aviso más 24 h). Restricción única sobre aviso y suscripción.
- Cada entrega es un trabajo `delivery` del carril corto con la misma `entry` que su aviso.
- Antes de cada envío, también en los reintentos, en este orden: el punto de pruebas `delivering`, después la comprobación (la suscripción existe, su sesión vive y no ha caducado, es la sesión habilitada de su aparato, el registro existe y `to` lo ve), después el envío. Lo que falle termina la entrega bien, con `outcome` `subscription-gone`, `not-enabled`, `session-ended`, `record-gone` o `not-visible`, sin reintentos.
- El endpoint se vuelve a validar antes de cada envío con la regla de «Servicios de push admitidos».
- El contenido cifrado es `{ "module", "type", "id", "notice" }` (el id del trabajo del aviso), o `{ "kind": "test", "notice" }` en el de prueba. Nunca texto, nombres ni datos del registro.
- `generateRequestDetails` de `web-push` cifra (`aes128gcm`) y firma con VAPID, con `TTL: 86400` y `Urgency: normal`. La petición la hace `fetch` con `redirect: "manual"` y la señal del trabajo, que cancela al agotar el tiempo máximo del carril.
- Respuestas:

| Respuesta del servicio                                  | Qué hace Domus                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 201 (o cualquier 2xx)                                   | La entrega termina bien, `outcome` `sent`.                                                     |
| 404 o 410                                               | Borra la suscripción; la entrega termina bien, `outcome` `subscription-gone`.                  |
| 400 o 413                                               | Fallo definitivo, `PUSH_REJECTED`, con el estado.                                              |
| 401 o 403                                               | Fallo definitivo, `PUSH_UNAUTHORIZED`, sin borrar la suscripción.                              |
| 3xx                                                     | Fallo definitivo, `PUSH_REDIRECT`.                                                             |
| 429, 5xx, error de red o tiempo agotado                 | Fallo pasajero, con la espera creciente del motor.                                             |
| 429 o 503 con `Retry-After`                             | Fallo pasajero con su instante mínimo: ni antes de lo pedido, ni antes de la espera creciente. |
| Un reintento que caería después del plazo de la entrega | La entrega termina como fallo definitivo, `DELIVERY_EXPIRED`, sin intentarlo antes.            |

- `Retry-After` admite segundos y fecha HTTP. Un valor inválido se ignora y queda la espera creciente.
- Que una entrega falle no frena a las demás del mismo aviso.

### Suscripciones (Q3, Q4, Q8)

- Tabla nueva, `platform_push_subscriptions`: id aleatorio, aparato (único, clave ajena `ON DELETE CASCADE`), sesión (clave ajena `ON DELETE CASCADE`), endpoint (único), las claves `p256dh` y `auth` del navegador e instante de creación.
- **Qué sesión tiene habilitada cada aparato.** `platform_devices` gana `entry`, un valor aleatorio, y la sesión gana el campo `deviceEntry`, de Better Auth, sin entrada del cliente. En `session.create.before` se escribe un `entry` nuevo en el aparato y el mismo valor en el `deviceEntry` de la sesión que va a nacer. La sesión habilitada del aparato es la que tiene su `deviceEntry` igual al `entry` del aparato. Si la creación falla después, ninguna sesión coincide y el aparato se queda sin avisos. Si termina la sesión habilitada, ninguna otra coincide. Nunca vuelve una anterior.
- En `session.create.after`, la suscripción del aparato que sea de otra sesión se borra. Es limpieza: la garantía la da la coincidencia de `entry`.
- Rutas de Hono, solo con sesión, con la regla de errores de las rutas de archivos:
    - `GET /api/notifications/key`: `{ key }`, la clave pública VAPID en base64url.
    - `PUT /api/notifications/subscription`, con `{ endpoint, keys: { p256dh, auth } }`: `platform/authorization` decide si la cuenta puede (personas sí; `device`, `via` o una cuenta sin perfil, no); se valida el endpoint y, en una transacción, se comprueba que la sesión es la habilitada del aparato y se escribe la suscripción del aparato, sustituyendo la que hubiera. Si es el mismo endpoint, de la misma sesión y con las mismas claves, no cambia nada. En otro caso, la suscripción anterior se borra y nace otra con id nuevo. Responde `{ subscribed: true }`.
    - `DELETE /api/notifications/subscription`: borra la suscripción del aparato si es de esta sesión. Responde `204`, también si no había.
- **Las claves VAPID.** Una fila de una tabla nueva, `platform_push_keys`, con la pública y la privada, generadas al abrir la plataforma si no hay. El `subject` de VAPID es el primer origen `https` de `DOMUS_ORIGINS`, nunca un correo personal; sin ninguno, la plataforma no envía y la entrega falla como definitiva, `PUSH_NOT_CONFIGURED`.
    - La 04 deja la función pura `vapidSubject(origins)`; llevar los orígenes hasta la entrega es de la 05.
- **Detalles de la tarea 04.**
    - Las rutas comprueban, en este orden: que la sesión vive con el reloj de la plataforma (`UNAUTHORIZED`, también al pedir la clave y al darse de baja), la autorización (`FORBIDDEN`), la forma del cuerpo (`BAD_REQUEST`), el endpoint (`push-endpoint-not-allowed`) y, ya en la transacción, otra vez que la sesión vive y que es la habilitada (`CONFLICT`).
    - El cuerpo es exactamente `{ endpoint, keys: { p256dh, auth } }`, con textos no vacíos: el `expirationTime` que añade `PushSubscription.toJSON()` se rechaza, así que la app de la fase 2 manda solo esos campos.
    - Las sesiones anteriores a la 1d4 no tienen `deviceEntry`: ninguna está habilitada hasta que se vuelva a entrar en el aparato.
    - Un fallo en el punto `entering` (una promesa rechazada o un error) hace fallar el inicio de sesión, con el `entry` ya escrito.
    - `test-utils` gana `test.subscriptions()`, cada suscripción como dato con su aparato, sesión, cuenta y si está habilitada (su sesión vive y es la habilitada del aparato).

### Servicios de push admitidos (Q9)

- Un endpoint se acepta solo si es una URL `https`, sin usuario ni contraseña, en el puerto 443 (explícito o implícito) y con un hostname, en minúsculas, exactamente igual a uno de `web.push.apple.com`, `fcm.googleapis.com` y `updates.push.services.mozilla.com`. Una IP o cualquier otro host se rechaza.
- La lista la recibe `notifications` como opción de la plataforma. Producción usa la de arriba; solo la composición de pruebas pone la del servicio falso.
    - Es `pushServices` del `PlatformRuntime`, como el reloj o `interleave`, no de `PlatformOptions`: producción no puede cambiarla. La opción `push` de `test-utils` la pone la 05 con el servicio falso.

### El aviso de prueba (Q7, Q22)

- `notifications/test`, una escritura irreversible de la plataforma, con clave de idempotencia y su entrada en el registro de acciones, en `platformContract` como `notifications: { test }`.
- `platform/authorization`: solo una sesión de la app, sin `via`, de una cuenta de persona; sin nivel de ningún área y sin comprobante.
- Deja un trabajo `notice` con `{ kind: "test", to: <el actor> }`. Su reparto se salta los pasos 3 y 4 y su entrega no comprueba registro. El destino en la app son los ajustes.
- Sin suscripción habilitada, el aviso termina `distributed` sin entregas, y la escritura responde bien.

### Restaurar (Q3, Q14)

- Restaurar ya cierra todas las sesiones y descarta los trabajos sin terminar. Con la clave ajena, cerrar las sesiones borra todas las suscripciones, y descartar los trabajos cancela avisos y entregas. `platform_push_keys` se restaura con la base.

### Errores de las rutas nuevas

Mismo formato que las rutas de archivos: el estado HTTP y, como cuerpo, el JSON de `ORPCError.toJSON()` sin el sobre RPC.

| Ruta y causa                                                                | Código                                                    | HTTP |
| --------------------------------------------------------------------------- | --------------------------------------------------------- | ---- |
| Todas, sin sesión o con una que caducó                                      | `UNAUTHORIZED`                                            | 401  |
| Suscribirse, con la cuenta `device`, con `via` o sin perfil                 | `FORBIDDEN`                                               | 403  |
| Suscribirse, con un cuerpo que no es `{ endpoint, keys: { p256dh, auth } }` | `BAD_REQUEST`                                             | 400  |
| Suscribirse, con un endpoint fuera de «Servicios de push admitidos»         | `BAD_REQUEST`, `data.reason: "push-endpoint-not-allowed"` | 400  |
| Suscribirse, desde una sesión que no es la habilitada del aparato           | `CONFLICT`, `data.reason: "session-not-enabled"`          | 409  |
| `notifications/test`, con la cuenta `device` o con `via`                    | `FORBIDDEN`                                               | 403  |

### `probe` (Q13)

- Tabla de área nueva, `labels`, en el área `probe`: un nombre por etiqueta, de la casa, sin dueño.
- Acciones nuevas: `listLabels` (lectura), `addLabel({ name, notify? })` (deshacible, con inversa `deleteLabel`) y `deleteLabel({ id })` (irreversible).
- `addNote`, `editNote` y `addLabel` aceptan `notify`, una lista opcional de cuentas; dejan un aviso por cada una sobre el registro que escriben.
- Las áreas de salud y secretas no envían avisos en `probe`.

### La comprobación en la Pi (Q10)

- En el ensayo con `domus-api:ensayo`, por Tailscale (https), con dos cuentas y `curl` sobre `/api/events`:
    - una nota pública nueva llega a las dos en menos de 1 s (objetivo nuevo, se anota la medida);
    - una privada llega solo a su dueño;
    - pasar una nota pública a privada llega al lector anterior, que al volver a pedirla ya no la ve;
    - revocar una sesión cierra su canal con `purge`;
    - las claves VAPID son las mismas tras reiniciar y tras recrear `api`.
- En el Domus real: `/api/events` sin sesión responde `401` con `no-store`, y `GET /api/notifications/key` con sesión responde una clave.

### Reglas y documentación

- La regla de dependencias de `events` y `notifications`, con su prueba de arquitectura.
- `docs/despliegue.md`, la guía, `packages/AGENTS.md` y el plan se actualizan al cerrar la 1d4.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba lo visible desde fuera: los eventos que lee cada sesión del flujo de `/api/events`, en orden; lo que responden las rutas y las acciones; las peticiones que recibe el servicio de push falso, con sus cabeceras y su contenido descifrado; los trabajos y su resultado tal como los da `background.jobs()`; y lo que se ve al reabrir la plataforma sobre los mismos datos. No comprueba sentencias SQL, columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla, y cada variante que esta spec permite tiene su prueba.
- **Costura 1, la principal: `createTestPlatform` con `probe`, su puerta y `browser()`.**
    - El canal se abre por la puerta en el mismo proceso, y la prueba lee el `ReadableStream` de la respuesta con un analizador de SSE que no depende de cómo se partan los bytes. Para el cliente lento deja de leer, y comprueba por la puerta que se alcanza el tope, que el canal se cierra y que la cola no sigue creciendo.
    - Escrituras y deshacer con `invoke` y `undo`; permisos con `setPermission`; sesiones con `revokeSession`, `revokeDevice`, el cambio de contraseña, cerrar sesión por `browser()` y el reloj para la caducidad; bandeja y entregas con `background.runDue()`; latido, reintentos y tiempo máximo con el reloj de pruebas, que dispara el temporizador controlado. Ninguna de estas esperas usa `setTimeout` ni `setInterval` directos.
    - Opción nueva, `push`: un **servicio de push falso** con su lista de hosts admitidos y un `fetch` inyectado que anota cada petición y responde lo que la prueba pida: 201, 404, 410, 400, 413, 401, 403, 3xx, 429 y 503 con y sin `Retry-After`, 5xx, error de red, o una petición que no termina. Esta última respeta `AbortSignal`: queda pendiente hasta la cancelación y entonces rechaza. La prueba comprueba que llegó la señal, que la petición terminó y que el carril quedó libre.
    - La prueba genera **claves reales para cada suscripción**, descifra lo que llega y comprueba que solo lleva el destino. Comprueba también la firma VAPID con la clave pública de `GET /api/notifications/key` y las cabeceras `TTL` y `Urgency`.
    - Opción nueva, el tope de la cola del canal, para no tener que generar cien eventos.
    - Encolar un trabajo sintético en la escritura en curso, para la bandeja de salida sin avisos (tarea 03).
    - Las suscripciones se registran por su ruta, con `browser()`, como hará la app.
- **Costura 2: puntos nuevos de `interleave`**, en la misma función y el mismo tipo `InterleavePoint` de la 1d3:
    - `distributing`: el aviso reclamado, antes de su transacción de reparto. Deshacer frente al reparto, en los dos órdenes.
    - `distributed`: el reparto confirmado, antes de que el motor marque el fin. Un rechazo prueba el reintento sin una segunda tanda.
    - `delivering`: antes de la comprobación de cada envío. La prueba quita el permiso, borra la nota, vuelve privada la nota, deshabilita la suscripción, termina o hace caducar la sesión, o entra otra cuenta en el aparato, y comprueba que no sale nada.
    - `entering`: en `session.create.before`, después de escribir el `entry` del aparato y antes de devolver el control a Better Auth, sin ninguna transacción abierta. Dos entradas en el mismo aparato en los dos órdenes, una creación que falla, el registro de la suscripción y la entrega posterior.
- **Costura 3: `startChild` con una variante nueva de `ChildTask`**, para un solo corte: el proceso muere con el reparto confirmado y antes de marcar el fin. Al reabrir la misma base, la recuperación vuelve a correr el aviso y no duplica entregas.
- **Costura 4: `restoreBackup`**, como en la 1d2: tras restaurar no queda ninguna suscripción, las entregas y avisos pendientes de la copia quedan cancelados y no salen al arrancar, y las claves VAPID son las de la copia.
- **Costura 5: pruebas internas de `platform`** para las funciones puras: validar el endpoint (cada host, mayúsculas, sufijos y prefijos parecidos, IP, puerto, usuario, esquema), clasificar cada respuesta del servicio, leer `Retry-After` (segundos, fecha, inválido, más allá del plazo), quedarse con el primer «antes» y el último «después», y las dos decisiones de `authorization`: a quién llega una invalidación y si se puede entregar un aviso.
- **Con `probe` sobre la costura 1:**
    - visibilidad en directo: dos personas en sesiones distintas, nota pública, privada, el paso a privada y a pública, el paso y vuelta en una misma escritura, la escritura revertida, deshacer, la tabla de área, una tabla sin declarar, la cuenta `device`;
    - permisos: quitar `read` con el canal abierto (`reset` y cierre), darlo (`reset` sin cierre);
    - sesiones: las cinco formas de terminar y la caducidad, cada una con su `purge` o su cierre por el latido; la sesión terminada desde una segunda conexión a la misma base en fichero, que demuestra que el latido detecta un cambio externo, no que `pnpm accounts` revoque bien (eso lo cubren sus pruebas de la 1c);
    - el canal: `ready` antes de cualquier invalidación, el orden, el séptimo canal, el tope de la cola, reconectar;
    - avisos: llega a cada suscripción habilitada de su destinatario y a ninguna otra; registro borrado, acceso perdido, destinatario `device` o inexistente; deshacer antes de repartir y antes de entregar; la entrega a medias con una suscripción que falla; cada fila de la tabla de respuestas; el tipo desconocido en `ctx.notify`; repetir la escritura con la misma clave;
    - suscripciones: la cuenta `device`, `via`, el endpoint no admitido, la sesión que no es la habilitada, suscribirse dos veces, darse de baja, cambiar de cuenta sin que la nueva se suscriba, terminar la sesión nueva sin que la antigua recupere los avisos, y las entregas pendientes que no pasan a la cuenta nueva;
    - el aviso de prueba: con y sin suscripción, la cuenta `device`, con `via`;
    - `no-store` en una respuesta buena y en un error de cada familia de rutas, Better Auth incluido;
    - la caducidad en `sessionLives` para comprobantes y archivos preparados.
- **Prior art:**
    - las pruebas de `probe` con `invoke`, `undo` y `confirm` de la 1b y la 1c;
    - las de la puerta con `browser()`, comprobantes y sesiones de la 1c, y las rutas de Hono de la 1d3;
    - las del motor, la limpieza y el temporizador controlado de la 1d1;
    - `interleave`, `startChild` y `restoreBackup` de la 1d2 y la 1d3.

## Fuera de alcance

- El service worker, el manifest y las reglas del cliente (abrir antes de leer, marca de lectura pendiente, `purge`, volver a suscribirse cuando cambia la clave): fase 2, que también recibe el primer aviso real en el iPhone.
- Las pantallas de suscribirse, darse de baja y pedir el aviso de prueba: fases 2 y 3.
- Avisos de la iniciativa de Kira, horas de silencio y límite diario: fase 9.
- Avisar al admin cuando falla una copia o el vigilante se degrada: su propio grilling.
- Que un módulo declare sus propios efectos externos en la bandeja de salida, y la entrega idempotente en destino o con resultado incierto: con Home Assistant o AimHarder.
- Edge y cualquier otro servicio de push fuera de la lista.
- Invalidaciones de las tablas de la plataforma (confirmaciones, registro de acciones, tareas, sesiones).
- El canal para Kira o las apps conectadas: con sus llaves (1e) y la fase 5.
- Repetir eventos perdidos, ids de evento y `Last-Event-ID`.
- Más de una instancia de `api`: el reparto en memoria da por hecho una sola.

## Notas

- El ADR 0029, sus enlaces de vuelta, el README de arquitectura, el glosario y el plan ya están al día en la rama del grilling. Esta spec añade al glosario **Tabla de área**.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling: `areaTable` y su nombre; la columna `outcome` y sus valores; `platform_deliveries`, `platform_push_subscriptions` y `platform_push_keys`; el par `entry` y `deviceEntry` para la sesión habilitada; el tope de 100 eventos; las rutas y sus errores; el `subject` de VAPID desde `DOMUS_ORIGINS`; el plazo de 24 h como horizonte de `Retry-After`; y las acciones nuevas de `probe`. Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.
- La 1d3 sigue en curso hasta comprobar la copia del 2026-11-15 y la limpieza del 2026-11-16 en la Pi. La 1d4 puede empezar a construirse antes, pero no se cierra antes que ella.

## Tareas

| Tarea                                                         | Qué                                                      | Bloqueada por            |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------ |
| [01](issues/01-ajustes-previos.md)                            | Ajustes previos: la sesión caducada no vive y `no-store` | —                        |
| [02](issues/02-el-canal-en-directo.md)                        | El canal en directo con las tablas con dueño             | 01                       |
| [03](issues/03-la-bandeja-de-salida.md)                       | La bandeja de salida                                     | —                        |
| [04](issues/04-suscripciones.md)                              | Suscripciones y la sesión habilitada del aparato         | 01                       |
| [05](issues/05-repartir-y-enviar-avisos.md)                   | `ctx.notify`, repartir y enviar por Web Push             | 03, 04                   |
| [06](issues/06-fallos-del-servicio-de-push.md)                | Fallos del servicio de push                              | 05                       |
| [07](issues/07-tablas-de-area.md)                             | Tablas de área                                           | 02, 05                   |
| [08](issues/08-fin-de-sesion-cambio-de-acceso-y-restaurar.md) | Fin de sesión, cambio de acceso y restaurar              | 02, 05                   |
| [09](issues/09-el-aviso-de-prueba.md)                         | El aviso de prueba                                       | 05                       |
| [10](issues/10-la-pi-y-el-cierre.md)                          | La Pi y el cierre de la 1d4                              | todas y el cierre de 1d3 |

La 03, la 04 y la 05 generan migraciones de la plataforma: si van en ramas a la vez, la que llega después a `main` regenera la suya encima.
