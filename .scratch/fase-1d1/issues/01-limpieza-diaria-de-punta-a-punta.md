# 01. Limpieza diaria de punta a punta

Status: resolved
Blocked by: None (can start immediately)

Spec: [`../spec.md`](../spec.md), secciones «El motor de segundo plano» (lo básico), «El planificador y las tareas programadas» (tarea diaria, cambio de hora, identidad, marcar y encolar), «Las tareas de la 1d1» (solo el registro de acciones), «`@domus/utils/date-time`» (ocurrencia diaria), «Migraciones» y «Arranque y parada en `apps/api`». ADR 0025.

## Qué construir

El trazador de la 1d1: una tarea de mantenimiento corre sola cada día a la hora de la casa y borra el contenido caducado del registro de acciones. Las tareas 02 y 03 pueden empezar sobre lo que esta deja, así que los límites entre motor, planificador y mando de pruebas quedan definidos aquí.

Piezas que llegan con esta tarea:

- **Tablas.** Trabajos, estado de las tareas y ejecuciones, en una migración generada con `pnpm db:generate`.
- **Motor, carril de mantenimiento.**
    - Reclamar un trabajo en una transacción.
    - Ejecutarlo con una señal de cancelación.
    - Terminarlo bien o como fallido.
- **Arranque y parada mínimos, pero seguros.** La plataforma ofrece arrancar y parar el segundo plano. Al parar deja de reclamar, cancela lo que corre y espera a que termine. La base no se cierra mientras un trabajo pueda seguir usándola. Los tiempos máximos, el estado atascado y la recuperación al arrancar son de la 03.
- **Planificador.**
    - Una tarea diaria declarada por la plataforma, a la hora local de `Europe/Madrid`, con el cambio de hora ya respetado: una hora que no existe va a la primera válida y una que se repite, a la primera aparición.
    - La identidad única de cada ejecución por tarea y fecha local prevista, con su instante absoluto.
    - Marcar la próxima ejecución y encolar el trabajo en la misma transacción.
- **`@domus/utils/date-time`**, tema nuevo con la próxima ocurrencia diaria en una zona dada y la fecha local de un instante, sobre `date-fns` y su soporte de zonas.
- **Registro de ejecuciones**, con su resultado.
- **Limpieza** (`cleanup`), diaria a las 04:30. En esta tarea solo vacía el contenido (entrada e inversa) de las entradas del registro de acciones cuyo `expiresAt` pasó, y conserva anotación, clave y huella. Las confirmaciones, los comprobantes, la purga y los lotes son de la 04.
- **Mando de segundo plano** en `createTestPlatform`: el mismo motor y el mismo planificador de producción, con el `TestClock` y una espera controlada. Avanzar el reloj dispara los vencimientos, «ejecuta lo que toca» y «espera a que se asiente», sin temporizadores reales.
- **`apps/api`** arranca el segundo plano después de crear la plataforma y antes de servir, y lo para antes de cerrar la plataforma, con su línea en el log.
- **Regla de dependencias.** `module-sdk` no expone el motor, el planificador ni el mantenimiento, y un módulo que los importe rompe la regla. Llega aquí, con el motor.

## Criterios de aceptación

- [x] Con el mando, al llegar las 04:30 hora de Madrid se crea una ejecución, corre la limpieza y queda en el registro de ejecuciones con su resultado.
- [x] Después de limpiar, una entrada caducada ya no guarda entrada ni inversa; una vigente queda intacta. Las pruebas de caducidad de la 1b y la 1c siguen pasando sin cambios.
- [x] Repetir con la misma clave una escritura cuyo contenido se limpió responde lo mismo que antes de limpiar, y la cuenta sigue leyendo su anotación.
- [x] El último domingo de marzo, una tarea de las 02:30 corre a las 03:00, y el último domingo de octubre corre una sola vez, en la primera aparición.
- [x] La misma ejecución prevista no puede crearse dos veces.
- [x] Prueba interna: un fallo entre marcar la próxima ejecución y encolar revierte las dos escrituras.
- [x] Parar el segundo plano con un trabajo en curso cancela, espera a que termine y solo entonces deja cerrar la base.
- [x] `utils/date-time` tiene sus propias pruebas: ocurrencia diaria, marzo, octubre, cambio de año y una zona distinta de la del proceso.
- [x] `architecture.test.ts` prueba que un módulo no puede importar el motor, el planificador ni el mantenimiento.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `07c6708`. Decisiones tomadas al implementar, también en la spec («Notas»): deshacer una entrada caducada sin inversa responde «caducada» si su acción es deshacible por contrato, así la limpieza no cambia la respuesta; un trabajo que falla tras la cancelación queda cancelado, y su ejecución también; `close()` lanza un error mientras el segundo plano está activo; en `createTestPlatform` el segundo plano no arranca solo; una ejecución manual es la que no tiene `planned_date`.
- Límites que usan la 02 y la 03, todo en `packages/platform/background/`:
    - **Motor** (`engine.ts`, `createEngine`): `enqueue(NewJob)` se une a la transacción de quien llama; `pump()` reclama (`claim`, una transacción) y arranca un trabajo por carril libre; `nextDue()` solo mira trabajos futuros (los vencidos esperan a que se libere su carril); `inFlight()`; `stop()` aborta y espera, sin margen todavía. El final de un trabajo se escribe en una transacción que llama a `onFinish` (el planificador anota la ejecución) y después a `onIdle` (vuelve a despertar). La 03 añade aquí el tiempo máximo, los reintentos (hoy un fallo queda `failed` a la primera; `attempts` ya se cuenta al reclamar), el estado atascado y la recuperación: `start()` devuelve `{ recovered }`, hoy siempre 0.
    - **Planificador** (`scheduler.ts`, `createScheduler`): recibe `enqueue` como dependencia, y así la prueba interna fuerza el fallo entre marcar y encolar. `sync()` crea al arrancar la fila de cada tarea declarada con `INSERT OR IGNORE` y deja las demás. `enqueueDue()` hoy corre la ejecución de `next_at` y calcula la siguiente desde ahora, sin «lo perdido» ni «saltada» (02). `platform_tasks.time` ya existe para la hora elegida, y `paused` para la pausa. `Frequency` solo tiene `every: "day"`: la 02 añade la semanal aquí y en `utils/date-time`.
    - **Despertar** (`index.ts`, `createBackground`): cada despertar encola lo vencido, arranca lo que toca y pide al `Timer` despertar en el siguiente vencimiento o, como mucho, en un minuto. No hay temporizadores sueltos: el `Timer` lo da la plataforma (`realTimer` en producción).
    - **Mando de pruebas**: `createTestPlatform` usa `controlledTimer`, y `clock.set` y `clock.advance` despiertan lo vencido. Ofrece `background.start`, `stop`, `runDue`, `settled` y `runs()`. La opción `tasks` declara tareas de prueba con su propio `job.run({ signal })`, base de los trabajos sintéticos de la 03 (por ahora solo como tareas programadas). `settled()` espera a los trabajos en curso: si la prueba deja uno bloqueado, se queda esperando.
