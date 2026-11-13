# 05. La descarga confirmada

Status: ready-for-agent
Blocked by: 04

Spec: [`../spec.md`](../spec.md), sección «Descarga confirmada» y sus filas de «Errores de las rutas de archivos». ADR 0028 y ADR 0023.

## Qué construir

Que una descarga cuya lectura pide confirmación se quede pendiente y se confirme una sola vez, en su propia ruta, desde cualquier sesión de la misma persona.

- **La pendiente de tipo descarga**, con la lectura, su entrada y el id del archivo en su operación exacta; la ruta responde `CONFIRMATION_REQUIRED` con su id.
- **Confirmar con `{ confirmation }`** en `POST /api/files/download`, reutilizando el mecanismo de `platform/actions`, ampliado para terminar en un descriptor abierto: las reglas del ADR 0023 y la reevaluación de permisos, delegación, visibilidad y comprobante. Ejecutar la lectura, comprobar el archivo, abrir el fichero y consumir la pendiente van en una sola transacción; los bytes salen después.
- **`confirmations/confirm`** rechaza una pendiente de descarga sin consumirla, con `CONFLICT` y `confirm-by-download`. `confirmations/reject` la rechaza como cualquier otra.
- Para provocar la confirmación, el mismo recurso que ya usan las pruebas de confirmación por HTTP de la 1c.

## Criterios de aceptación

- [ ] Una descarga que pide confirmación responde `CONFIRMATION_REQUIRED` con su id y no entrega bytes.
- [ ] Confirmarla desde otra sesión de la misma persona entrega los bytes con su hash; desde otra persona, `NOT_FOUND`.
- [ ] Confirmar dos veces entrega una sola vez; la segunda responde `CONFLICT` con la razón de consumida, también si la primera respuesta se perdió.
- [ ] Una pendiente caducada responde `CONFLICT`; una rechazada no se puede confirmar.
- [ ] `confirmations/confirm` con una pendiente de descarga responde `CONFLICT` `confirm-by-download` y la pendiente sigue confirmable en su ruta.
- [ ] Si entre pedir y confirmar se quita el permiso o el archivo deja de estar en la lectura, confirmar no entrega bytes.
- [ ] `pnpm check` pasa.
