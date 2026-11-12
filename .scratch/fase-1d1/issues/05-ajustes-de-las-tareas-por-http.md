# 05. Ajustes de las tareas por HTTP

Status: ready-for-agent
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

- [ ] Por HTTP, con sesiones reales:
    - [ ] el admin y un miembro listan las tareas, sin comprobante;
    - [ ] el admin cambia la hora, pausa, reanuda y lanza con un comprobante de esa operación;
    - [ ] sin comprobante o con el de otra operación, la puerta lo pide otra vez;
    - [ ] un miembro recibe «no permitido» al cambiar algo;
    - [ ] sin sesión, no autenticado.
- [ ] Repetir con la misma clave devuelve el acuse y no repite el cambio.
- [ ] Deshacer un cambio de hora y una pausa devuelve el estado anterior, y la lista lo muestra.
- [ ] Lanzar con una ejecución pendiente o en curso responde con un conflicto, y la ejecución manual corre y queda en el registro de ejecuciones.
- [ ] Una tarea que no existe responde «no encontrado».
- [ ] La lista muestra el resultado de la última ejecución y un trabajo atascado.
- [ ] `pnpm check` pasa.
