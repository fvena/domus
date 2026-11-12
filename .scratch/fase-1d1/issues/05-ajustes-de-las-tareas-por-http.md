# 05. Ajustes de las tareas por HTTP

Status: resolved
Blocked by: 02, 03

Spec: [`../spec.md`](../spec.md), sección «Las operaciones de ajustes de las tareas». ADR 0025, ADR 0023.

## Qué construir

El admin ve y ajusta las tareas programadas por HTTP, con las mismas reglas que cualquier operación de la plataforma. Son operaciones del área de la plataforma, en `@domus/platform/contracts`, servidas por la puerta.

- **Listar.** Es una lectura de nivel `read` sin comprobante. Devuelve de cada tarea:
    - su identificador;
    - su frecuencia efectiva;
    - si está pausada;
    - su próxima ejecución;
    - su última ejecución y su resultado;
    - si su trabajo está atascado.

    No lleva datos personales.

- **Cambiar la hora**, **pausar** y **reanudar** son escrituras de nivel `manage`, con comprobante, clave de idempotencia y entrada en el registro de acciones. Son deshacibles: la inversa devuelve la hora o el estado anterior. Cambiar la hora recalcula la próxima ejecución.
- **Lanzar ahora** es una escritura de nivel `manage`, irreversible, con comprobante, clave y entrada. Crea una ejecución manual. Si la tarea ya tiene una ejecución pendiente o en curso, responde con un conflicto.
- Una tarea que no existe responde «no encontrado».

## Criterios de aceptación

- [x] Por HTTP, con sesiones reales:
    - [x] el admin y un miembro listan las tareas, sin comprobante;
    - [x] el admin cambia la hora, pausa, reanuda y lanza con un comprobante de esa operación;
    - [x] sin comprobante o con el de otra operación, la puerta lo pide otra vez;
    - [x] un miembro recibe «no permitido» al cambiar algo;
    - [x] sin sesión, no autenticado.
- [x] Repetir con la misma clave devuelve el acuse y no repite el cambio.
- [x] Deshacer un cambio de hora y una pausa devuelve el estado anterior, y la lista lo muestra.
- [x] Lanzar con una ejecución pendiente o en curso responde con un conflicto, y la ejecución manual corre y queda en el registro de ejecuciones.
- [x] Una tarea que no existe responde «no encontrado».
- [x] La lista muestra el resultado de la última ejecución y un trabajo atascado.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `1cad8ad`. Decisiones tomadas al implementar, también en la spec («Notas»): rutas `tasks/list|setTime|pause|resume|launch` y operaciones `platform.listTasks|setTaskTime|pauseTask|resumeTask|launchTask`; la última ejecución de la lista es la última anotada, sea cual sea su resultado (también «saltada»); deshacer una pausa reanuda con la próxima ejecución desde ese momento; una tarea no declarada responde «no encontrado» antes del comprobante, también a un miembro; lanzar con una ejecución pendiente, en curso o atascada responde `CONFLICT` con `task-busy`; ninguna tarea declara aún si se puede lanzar a mano.
- Límites para las siguientes: `PlatformOperation` admite ya `level: "manage"` y `undoable` (su `run` devuelve `{ result, inverse }`), y `platformOperation` vive en `actions/platform-operations.ts`. `Background` ofrece `launch`, `state` y `overview` (la lista, solo lectura). Un cambio de una tarea dentro de la transacción de una acción despierta el segundo plano con `queueMicrotask`, al acabar esa transacción: en las pruebas, `background.flush()` deja que arranque el trabajo lanzado.
- Revisión en `e8bbf67`: una tarea no declarada responde «no encontrado» después de la autorización y del comprobante (sin `find`; lo comprueba `run` con `Background.has`): un miembro recibe «no permitido» exista o no la tarea, y el admin sin comprobante `STEP_UP_REQUIRED`. La puerta llama `platformWrite` a lo que antes era `sensitive`. La lista ya no admite `stuck` como resultado.
- Segunda revisión: las escrituras de las tareas declaran `touches` (`{ type: "scheduledTask", id }`), una opción nueva de `PlatformOperation`; deshacer un cambio seguido de otro de la misma tarea responde `changed-since`.
