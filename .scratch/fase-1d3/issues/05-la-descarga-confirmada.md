# 05. La descarga confirmada

Status: resolved
Blocked by: 04

Spec: [`../spec.md`](../spec.md), sección «Descarga confirmada» y sus filas de «Errores de las rutas de archivos». ADR 0028 y ADR 0023.

## Qué construir

Que una descarga cuya lectura pide confirmación se quede pendiente y se confirme una sola vez, en su propia ruta, desde cualquier sesión de la misma persona.

- **La pendiente de tipo descarga**, con la lectura, su entrada y el id del archivo en su operación exacta; la ruta responde `CONFIRMATION_REQUIRED` con su id.
- **Confirmar con `{ confirmation }`** en `POST /api/files/download`, reutilizando el mecanismo de `platform/actions`, ampliado para terminar en un descriptor abierto: las reglas del ADR 0023 y la reevaluación de permisos, delegación, visibilidad y comprobante. Ejecutar la lectura, comprobar el archivo, abrir el fichero y consumir la pendiente van en una sola transacción; los bytes salen después.
- **`confirmations/confirm`** rechaza una pendiente de descarga sin consumirla, con `CONFLICT` y `confirm-by-download`. `confirmations/reject` la rechaza como cualquier otra.
- Para provocar la confirmación, el mismo recurso que ya usan las pruebas de confirmación por HTTP de la 1c.

## Criterios de aceptación

- [x] Una descarga que pide confirmación responde `CONFIRMATION_REQUIRED` con su id y no entrega bytes.
- [x] Confirmarla desde otra sesión de la misma persona entrega los bytes con su hash; desde otra persona, `NOT_FOUND`.
- [x] Confirmar dos veces entrega una sola vez; la segunda responde `CONFLICT` con la razón de consumida, también si la primera respuesta se perdió.
- [x] Una pendiente caducada responde `CONFLICT`; una rechazada no se puede confirmar.
- [x] `confirmations/confirm` con una pendiente de descarga responde `CONFLICT` `confirm-by-download` y la pendiente sigue confirmable en su ruta.
- [x] Si entre pedir y confirmar se quita el permiso o el archivo deja de estar en la lectura, confirmar no entrega bytes.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `7f6e665`. Costuras para las tareas que siguen:
    - **Dónde está.** `Actions.confirmDownload(call)` en `actions/index.ts`, que entra por `answering.confirmDownload` (`actions/answering.ts`): en una transacción, `reachable`, la lectura con `confirmed: true` por `authorizeRead` y `openReturned` (el paso común con `download`: `answerRead`, `markedFiles`, `references.live` y `openContent`), y `confirmations.consume`; si algo falla después de abrir, el `catch` cierra el descriptor. El tipo `Download` vive ahora en `answering.ts` y `actions/index.ts` lo reexporta.
    - **Para la 06.** La ruta tiene una sola variable `found` para las dos ramas (`actions.download` o `actions.confirmDownload`), así que el punto de intercalación tras ella y antes de `new Response(found.content.stream(), ...)` cubre también la descarga confirmada.
    - **Pruebas.** «a confirmed download» en `modules/probe/tests/files.test.ts`, con la lectura nueva `probe.getGuardedNote` (como `getNote`, con `alwaysConfirm: true`).
    - Decisiones tomadas sin preguntar, también en la spec («Descarga confirmada», «`probe`» y la tabla de errores): sin migración, la pendiente de descarga guarda `kind` `read` con la operación `{ action, input, file }` (`isDownload` en `confirmations.ts`) y la huella `download:<huella de la lectura>:<id del archivo>`, que nunca coincide con la de una lectura; así no se reconstruye `platform_confirmations` ni se chocan migraciones con la 06 y la 08, y una descarga sigue siendo una lectura. El comprobante es el de la lectura. El cuerpo es exactamente `{ confirmation }` con un texto o exactamente `{ action, input, file }`. En la ruta de la descarga, una pendiente que no es descarga es `NOT_FOUND`, después de las comprobaciones comunes de `reachable` (otra persona `NOT_FOUND`; consumida, rechazada o caducada, su conflicto, también en `confirmations/confirm`). Una reevaluación que falla no consume la pendiente.
