# 04. `backup-check` y el vigilante completo

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «La tarea `backup-check`» y «Las marcas de las copias y el vigilante». ADR 0026.

## Qué construir

Cada domingo Domus lee el repositorio entero, y el vigilante dice a la vez todo lo que va mal, sin olvidarlo con la purga ni con un reinicio.

- **La tarea `backup-check`**, cada domingo a las 05:30, en el carril de mantenimiento: `restic unlock` y `restic check --read-data` con `--no-cache`. Con las copias apagadas no se declara.
- Si el repositorio todavía no existe, termina bien sin comprobar y sin tocar su marca.
- Un bloqueo vigente es un error pasajero. Cualquier otro fallo, también el que agota sus reintentos, anota «check fallido».
- **Marca del `check`** y motivo `backup-check-failed`, que desaparece con un `check` bueno.
- **Varios motivos a la vez**, en el orden fijo de la spec.
- **Las marcas sobreviven** a la purga de ejecuciones de la limpieza y a cerrar y abrir la plataforma.

## Criterios de aceptación

- [x] Con el mando, el domingo a las 05:30 corre `backup-check` sobre un repositorio sano con restic real y anota un `check` bueno.
- [x] Un repositorio dañado (por ejemplo, sin uno de sus packs) da un `check` fallido y `backup-check-failed`; un `check` bueno después quita el motivo.
- [x] Sin repositorio todavía, `backup-check` termina bien y su marca no cambia.
- [x] Un bloqueo vigente se reintenta; agotados los reintentos, cuenta como `check` fallido.
- [x] Con la copia vieja, la retención fallida y el `check` fallido a la vez, `/health` da los tres motivos (y los del planificador si los hay) en su orden.
- [x] Tras purgar las ejecuciones de más de 90 días, las marcas siguen dando el mismo estado; una tarea `backup` pausada más de 90 días no vuelve a `none-yet`.
- [x] Tras cerrar y abrir la plataforma, `/health` da el mismo estado de copias.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `0912814`. Decisiones tomadas al implementar, también en la spec («Notas»): un tipo de trabajo puede declarar `failed(at)`, que el motor llama en la transacción que anota su fin definitivo como fallido (error permanente o reintentos agotados, también por tiempo o por un reinicio en el último intento), porque el trabajo no sabe cuál es su último intento; `backup-check` anota ahí el «check fallido». Una parada no cambia la marca. Un `unlock` que falla cuenta como `check` fallido, y el código `10` en `unlock` o `check` termina bien sin tocarla.
- Para la 05: `marks.check(at, result)` se añadió en `backups/marks.ts` justo después de `retention`; la procedencia de la 05 puede chocar ahí al unir, sin más que juntar las dos. Restaurar no acredita un `check`: la marca del `check` queda como venía en la copia, así que la 05 no la toca. `unlock` en `backups/index.ts` devuelve ahora si el repositorio existe.
- Las pruebas de `backup-check` pausan `backup` cuando no quieren copias nuevas; una base reabierta empieza con su propio reloj, así que la prueba de reabrir lo pone en el instante de antes.
