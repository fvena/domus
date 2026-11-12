# 04. Limpieza completa por lotes

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), sección «Las tareas de la 1d1». ADR 0025.

## Qué construir

La limpieza diaria completa, sin cambiar nunca lo que responde Domus.

- **Confirmaciones pendientes.** Ninguna fila se borra. Pasado su `expiresAt`, sea cual sea su estado, se vacía la operación guardada y se conserva la marca mínima que decide la respuesta: id, cuenta, `via`, tipo, huella, clave, origen, sesión, instantes, estado y entrada. La columna de la operación pasa a admitir vacío en una migración generada.
- **Comprobantes.** Se borran los terminados y los emitidos sin usar pasada su caducidad, que ya responden «no válido» como uno inexistente. Los usados se conservan, porque validan la repetición de su escritura.
- **Purga.** Se borran los trabajos terminados, fallidos o cancelados de más de 30 días y las ejecuciones de más de 90 días.
- **Por lotes.** Cada lote va en su propia transacción y la señal de cancelación se comprueba entre lotes. Si se corta a medias, la ejecución siguiente sigue donde quedó, y limpiar dos veces no cambia nada.

## Criterios de aceptación

- [x] Tras limpiar, la operación de una confirmación caducada está vacía y la de una vigente, intacta.
- [x] Antes y después de limpiar responden igual:
    - confirmar otra vez una confirmación consumida;
    - rechazar una rechazada;
    - confirmar una caducada;
    - confirmar una terminada por revocar la sesión;
    - repetir con la misma clave una escritura que se confirmó;
    - repetir una escritura sensible con su comprobante usado, que devuelve el acuse.
- [x] Los comprobantes terminados y los caducados sin usar desaparecen, y presentarlos responde lo mismo que antes.
- [x] Los trabajos y las ejecuciones antiguos se purgan, y los recientes quedan.
- [x] Una limpieza cancelada entre lotes deja la base coherente, y la siguiente termina el trabajo.
- [x] Limpiar dos veces seguidas no cambia nada.
- [x] Las pruebas de la 1b y la 1c sobre confirmaciones, comprobantes y caducidad siguen pasando sin cambios.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `0e1be0c`. Decisiones tomadas al implementar, también en la spec («Notas»): lotes de 500 filas, y tras un lote lleno la limpieza cede el turno al bucle de eventos (`setImmediate`, no espera tiempo) para que la API, el tiempo máximo y la parada lleguen entre lotes; la antigüedad de trabajos y ejecuciones se mide por `finished_at`, con el límite incluido; una ejecución sin resultado o a la que aún apunta un trabajo no se purga; «comprobantes terminados» son los de estado `ended`, y uno emitido de una sesión revocada se va al caducar; la purga no guarda la última ejecución de una tarea pausada más de 90 días.
- Límites para las siguientes: la migración `platform/0008` deja `platform_confirmations.operation` admitiendo vacío; `PendingConfirmation.operation` es opcional, y `answering.ts` responde error interno si llega a una vacía (no pasa: `reachable` ya respondió «caducada»). `cleanupTask(connection, clock, { batchSize })` acepta el tamaño del lote solo para las pruebas internas (`background/cleanup.test.ts`). La lista de tareas (05) y `/health` (06) no deben suponer que existen ejecuciones de más de 90 días ni trabajos terminados de más de 30.
- Revisión en `e8bbf67`: `packages/AGENTS.md` describe la limpieza por lotes y lo que vacía y borra.
