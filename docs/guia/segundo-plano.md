# El trabajo en segundo plano

## Qué es

Casi todo lo que hace Domus ocurre porque alguien lo pide. Pero hay trabajo que nadie pide en el momento: limpiar lo que ya no sirve cada noche, por ejemplo. Ese trabajo corre en segundo plano, dentro del mismo programa api, sin que nadie espere la respuesta.

Hoy hay una sola tarea programada, la limpieza, que corre cada noche a las 04:30, hora de Madrid. La pieza que la lanza a su hora es el planificador.

## Cómo funciona

Cada cosa que hay que hacer es un trabajo, y se apunta en la base de datos antes de empezar. Así, si la Pi se apaga a mitad, al volver sabe qué quedó a medias y lo retoma.

Los trabajos corren en dos carriles, uno para lo corto y otro para el mantenimiento. En cada carril corre un trabajo a la vez, y los dos carriles corren a la vez, así que una limpieza larga nunca retrasa algo corto.

Cada trabajo tiene un tiempo máximo. Si lo agota, se le pide que pare, y el trabajo lo comprueba entre un paso y el siguiente. Si aun así no para, queda atascado: su carril no admite otro trabajo hasta que termine o se reinicie api, para que nunca corran dos a la vez en el mismo carril. Si un trabajo falla por un tropiezo, se reintenta pasado medio minuto, luego un minuto, luego dos, hasta cinco intentos. Si falla por algo que nunca va a funcionar, no se reintenta.

El planificador mira la hora de la casa, no la del ordenador. El día que se adelanta la hora, una tarea de las 02:30 corre a las 03:00, porque las 02:30 no existen. El día que se atrasa, corre una sola vez, aunque las 02:30 pasen dos veces. Si la Pi estuvo apagada tres días, la tarea corre una vez al volver, no tres. Y si una ejecución todavía no ha terminado, no empieza otra: esa fecha queda como saltada.

Cada ejecución queda anotada, con cuándo empezó, cuándo terminó y cómo acabó.

La limpieza borra de verdad lo que ya caducó: lo que entró en cada acción y su inversa pasados 30 días, lo guardado de las confirmaciones caducadas, los comprobantes que ya no sirven, y los trabajos y ejecuciones antiguos. Va por tandas pequeñas para no frenar a quien esté usando Domus. Nunca cambia lo que responde Domus: la anotación de lo que hizo cada persona se queda, y repetir una escritura antigua con su clave sigue respondiendo lo mismo que antes de limpiar.

Cualquier cuenta puede ver la lista de tareas: a qué hora corren, si están pausadas y cómo fue la última vez. Solo el admin puede cambiar la hora, pausarlas, reanudarlas o lanzarlas en el momento, y para eso pide la contraseña otra vez, como cualquier operación de administrar. Esos cambios quedan en el registro de acciones. Un cambio de hora o una pausa se pueden deshacer, siempre que sean el último cambio de esa tarea.

El planificador se despierta al menos una vez por minuto. Si lleva más de cinco minutos sin hacerlo, o hay un carril atascado, la página de salud de Domus lo dice.

## Por qué es así

Un programa aparte para esto sería uno más que arrancar y vigilar en la Pi. Dentro de api usa la misma base de datos y arranca con ella.

Los trabajos se apuntan en la base porque un corte de luz no avisa. Lo que estaba apuntado se recupera; lo que solo estaba en memoria se perdería.

Hay dos carriles para que un trabajo largo no haga esperar a uno corto. Con uno solo, una limpieza de varios minutos lo retendría todo.

La hora es la de Madrid porque «a las 4» tiene que significar las 4 en casa, sea cual sea la zona del ordenador.

Y la limpieza borra lo caducado porque guardar lo que ya no se puede deshacer es guardar datos privados que nadie necesita.

## En el código

- El motor, el planificador, la limpieza y el vigilante: `packages/platform/background/` (`engine.ts`, `scheduler.ts`, `cleanup.ts`, `index.ts`). Las tablas son `platform_jobs`, `platform_tasks` y `platform_task_runs`, de las migraciones `platform/0007` a `platform/0009`.
- La hora de la casa: `@domus/utils/date-time`, sobre `date-fns` y `@date-fns/tz`, con la zona `Europe/Madrid` que le pasa la plataforma.
- El arranque y la parada: `apps/api/src/main.ts`, con `startBackground` y `stopBackground`. El log dice `scheduler started: <N> jobs recovered` y `scheduler stopped`.
- Por HTTP: `tasks/list` (lectura) y `tasks/setTime`, `tasks/pause`, `tasks/resume` y `tasks/launch` (de nivel `manage`, con comprobante), en `packages/platform/background/operations.ts`.
- La salud: `GET /health` añade `background`, que es `ok` o `degraded` con `scheduler-silent` o `lane-stuck`.
- Probar: `createTestPlatform` ofrece `background`, que mueve el mismo motor con el reloj de pruebas; las opciones `tasks` y `jobs` declaran tareas y trabajos de prueba.
- Los módulos no pueden usar nada de esto: una regla de dependencias lo impide.
- Decisiones: [ADR 0025](../architecture/adr/0025-segundo-plano.md). Cómo comprobarlo en la Pi: [`docs/despliegue.md`](../despliegue.md).
