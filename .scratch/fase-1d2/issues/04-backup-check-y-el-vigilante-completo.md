# 04. `backup-check` y el vigilante completo

Status: ready-for-agent
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

- [ ] Con el mando, el domingo a las 05:30 corre `backup-check` sobre un repositorio sano con restic real y anota un `check` bueno.
- [ ] Un repositorio dañado (por ejemplo, sin uno de sus packs) da un `check` fallido y `backup-check-failed`; un `check` bueno después quita el motivo.
- [ ] Sin repositorio todavía, `backup-check` termina bien y su marca no cambia.
- [ ] Un bloqueo vigente se reintenta; agotados los reintentos, cuenta como `check` fallido.
- [ ] Con la copia vieja, la retención fallida y el `check` fallido a la vez, `/health` da los tres motivos (y los del planificador si los hay) en su orden.
- [ ] Tras purgar las ejecuciones de más de 90 días, las marcas siguen dando el mismo estado; una tarea `backup` pausada más de 90 días no vuelve a `none-yet`.
- [ ] Tras cerrar y abrir la plataforma, `/health` da el mismo estado de copias.
- [ ] `pnpm check` pasa.
