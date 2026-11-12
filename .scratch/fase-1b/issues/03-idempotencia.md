# 03. Idempotencia

Status: resolved
Blocked by: 02

Spec: [`../spec.md`](../spec.md), secciones «El recorrido» (pasos de la escritura), «Idempotencia» y «Valores persistidos». ADR 0022.

## Qué construir

Kira, o cualquier llamante, repite una escritura con la misma clave y no se ejecuta dos veces: recibe el mismo resultado y el mismo número de entrada, después de volver a autorizar. La misma clave con otra acción u otra entrada da conflicto `key-reused`.

- La huella: nombre completo de la acción más el SHA-256 de la entrada validada en JSON canónico (claves ordenadas).
- Dentro de la transacción y en una sola sección síncrona: buscar la entrada por cuenta, `via` y clave; otra huella, `key-reused`; misma huella, reautorizar y devolver el resultado guardado sin ejecutar (si se deniega, no permitido y nada entregado); clave nueva, el recorrido de la 02.
- Aquí todavía no hay caducidad: el contenido guardado se considera siempre vigente hasta la 05.

## Aceptación

- [x] Pruebas de `probe`: el reintento devuelve el mismo resultado y número sin ejecutar (los datos no cambian dos veces); misma clave con otra acción y con otra entrada dan `key-reused`; reordenar las propiedades de la entrada no da conflicto; misma clave en otra cuenta, con otra `via` o sin `via` son operaciones distintas; tras un intento revertido, la misma clave se ejecuta; tras cerrar y abrir sobre un fichero con ruta explícita, la misma clave no se ejecuta; tras revocar el permiso, el reintento no entrega el resultado.
- [x] El resultado recuperado en una repetición es igual en profundidad al primero.
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

## Comments

- Hecha en `1bb67de`.
- El motivo de un conflicto va en `data.reason` del `ORPCError` `CONFLICT` (`{ reason: "key-reused" }`); la spec nombra los motivos pero no dónde viajan. La 04 y la 05 añaden los suyos al tipo `ConflictReason` de `platform/actions`.
- `key-reused` se responde antes de autorizar, como ordena «El recorrido»: comparar la huella no entrega nada guardado.
- `platform/audit` gana `findByKey(actor, key)`, que devuelve el número, la huella y el resultado de la entrada; su prueba sobre las migraciones reales cubre la ausencia de `via` frente a una `via` vacía.
- Sin caducidad todavía: el contenido guardado se da siempre por vigente hasta la 05.
