# 02. Programación completa y persistencia

Status: ready-for-agent
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

- [ ] Una tarea semanal corre el día y la hora que declara, también en las semanas del cambio de hora.
- [ ] Tras varios días con la plataforma cerrada, al volver cada tarea corre una sola vez.
- [ ] Con una ejecución pendiente o en curso no se crea otra, y la fecha queda como saltada en el registro de ejecuciones.
- [ ] Pausar detiene las ejecuciones; reanudar no recupera lo saltado.
- [ ] Una hora elegida se respeta y sobrevive a otra hora por defecto.
- [ ] Una fila de una tarea que ya no se declara no rompe el arranque.
- [ ] Con `file`, cerrar y reabrir la plataforma conserva la hora elegida, la pausa y la próxima ejecución.
- [ ] `utils/date-time` prueba la ocurrencia semanal, también en marzo y octubre.
- [ ] `pnpm check` pasa.
