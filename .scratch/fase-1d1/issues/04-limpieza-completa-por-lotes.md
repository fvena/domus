# 04. Limpieza completa por lotes

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), sección «Las tareas de la 1d1». ADR 0025.

## Qué construir

La limpieza diaria completa, sin cambiar nunca lo que responde Domus.

- **Confirmaciones pendientes.** Ninguna fila se borra. Pasado su `expiresAt`, sea cual sea su estado, se vacía la operación guardada y se conserva la marca mínima que decide la respuesta: id, cuenta, `via`, tipo, huella, clave, origen, sesión, instantes, estado y entrada. La columna de la operación pasa a admitir vacío en una migración generada.
- **Comprobantes.** Se borran los terminados y los emitidos sin usar pasada su caducidad, que ya responden «no válido» como uno inexistente. Los usados se conservan, porque validan la repetición de su escritura.
- **Purga.** Se borran los trabajos terminados, fallidos o cancelados de más de 30 días y las ejecuciones de más de 90 días.
- **Por lotes.** Cada lote va en su propia transacción y la señal de cancelación se comprueba entre lotes. Si se corta a medias, la ejecución siguiente sigue donde quedó, y limpiar dos veces no cambia nada.

## Criterios de aceptación

- [ ] Tras limpiar, la operación de una confirmación caducada está vacía y la de una vigente, intacta.
- [ ] Antes y después de limpiar responden igual:
    - confirmar otra vez una confirmación consumida;
    - rechazar una rechazada;
    - confirmar una caducada;
    - confirmar una terminada por revocar la sesión;
    - repetir con la misma clave una escritura que se confirmó;
    - repetir una escritura sensible con su comprobante usado, que devuelve el acuse.
- [ ] Los comprobantes terminados y los caducados sin usar desaparecen, y presentarlos responde lo mismo que antes.
- [ ] Los trabajos y las ejecuciones antiguos se purgan, y los recientes quedan.
- [ ] Una limpieza cancelada entre lotes deja la base coherente, y la siguiente termina el trabajo.
- [ ] Limpiar dos veces seguidas no cambia nada.
- [ ] Las pruebas de la 1b y la 1c sobre confirmaciones, comprobantes y caducidad siguen pasando sin cambios.
- [ ] `pnpm check` pasa.
