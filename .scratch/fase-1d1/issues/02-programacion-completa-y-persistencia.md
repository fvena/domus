# 02. Programación completa y persistencia

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «El planificador y las tareas programadas» y «`@domus/utils/date-time`» (ocurrencia semanal). ADR 0025.

## Qué construir

El planificador completo sobre lo que dejó la 01: las tareas semanales, lo perdido mientras la Pi estuvo apagada, la pausa, la hora que elige el admin y su persistencia. Las operaciones que cambian todo eso por HTTP son de la 05. Aquí se construye el comportamiento del estado de la tarea, y las pruebas lo cambian por la entrada de pruebas.

- **Frecuencia semanal**, «cada semana, tal día a las HH:MM», en el planificador y en `utils/date-time`, con las mismas reglas del cambio de hora.
- **Lo perdido.** Varias ejecuciones vencidas de una tarea corren una sola vez, la más reciente, y la próxima se calcula desde ahora.
- **No duplicar.** Si la tarea ya tiene una ejecución pendiente o en curso, no se crea otra y esa fecha queda anotada como saltada.
- **Pausa.** Una tarea pausada no crea ejecuciones. Al reanudarla, la próxima se calcula desde ese momento sin recuperar lo saltado.
- **Hora elegida.** Si el admin eligió una hora, se respeta y sobrevive aunque cambie la hora por defecto en el código.
- **Tareas retiradas.** La fila de una tarea que el código ya no declara se conserva y se ignora, sin romper el arranque.

## Criterios de aceptación

- [x] Una tarea semanal corre el día y la hora que declara, también en las semanas del cambio de hora.
- [x] Tras varios días con la plataforma cerrada, al volver cada tarea corre una sola vez.
- [x] Con una ejecución pendiente o en curso no se crea otra, y la fecha queda como saltada en el registro de ejecuciones.
- [x] Pausar detiene las ejecuciones; reanudar no recupera lo saltado.
- [x] Una hora elegida se respeta y sobrevive a otra hora por defecto.
- [x] Una fila de una tarea que ya no se declara no rompe el arranque.
- [x] Con `file`, cerrar y reabrir la plataforma conserva la hora elegida, la pausa y la próxima ejecución.
- [x] `utils/date-time` prueba la ocurrencia semanal, también en marzo y octubre.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `a79f9d7`. Decisiones tomadas al implementar, también en la spec («Notas»): la semanal es `{ every: "week", on: "sunday", at }` con el día en inglés; de lo perdido solo se anota la ejecución que corre; una fecha saltada queda `skipped` sin inicio y con su final al saltarla; pausar lo pausado o reanudar lo no pausado no cambia nada; `setTime(task, null)` vuelve a la hora por defecto; si cambia la hora por defecto sin hora elegida, la próxima ya guardada se mantiene una vez.
- Límites para la 05, en `packages/platform/background/`: `Background` ofrece `pause`, `resume` y `setTime(task, time | null)`, que cambian la fila y despiertan; son síncronos y se pueden llamar dentro de la transacción de una acción. Una tarea no declarada lanza `UnknownTaskError` (→ «no encontrado»); una declarada sin fila todavía se crea al cambiarla. `readTaskStates` da `{ id, time, paused, nextAt }` de cada fila, declarada o no. «Tiene una ejecución en curso» es un trabajo de la tarea en `pending`, `running` o `stuck` (consulta `inProgress` de `scheduler.ts`), que «lanzar ahora» puede reutilizar para su conflicto.
- Para la 03: el planificador ya cuenta `stuck` como en curso; no toca `engine.ts`.
- Mando de pruebas: `background.tasks()`, `pause`, `resume` y `setTime`, por `readTasks` y `changeTask` de `@domus/platform/testing`.
