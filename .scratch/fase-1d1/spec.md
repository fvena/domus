# Fase 1d1: cola y tareas programadas

Status: ready-for-agent

Esta spec sale del grilling de la fase 1d ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-12, preguntas Q1–Q20, y del acuerdo posterior sobre los puntos de prueba y el alcance de la 1d1. Las decisiones duraderas están en el [ADR 0025](../../docs/architecture/adr/0025-segundo-plano.md), que precisa los ADR 0003, 0015 y 0022. Si esta spec y el ADR no coinciden, manda el ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): trabajo, tarea programada, mantenimiento, registro de acciones, anotación, clave de idempotencia, inversa, confirmación pendiente, comprobante, área y permiso.

## Problema

Después de la 1c, todo lo que hace Domus ocurre dentro de una petición. Nada corre solo, a una hora, ni después de responder. Eso deja varias cosas sin hacer:

- El contenido del registro de acciones (entradas e inversas) caduca a los 30 días, pero sigue guardado en la base. Hoy solo se oculta al consultarlo, aunque el ADR 0022 prometía borrarlo en la 1d. Pasa lo mismo con la operación guardada de las confirmaciones pendientes y con los comprobantes que ya no sirven.
- La 1d2 necesita hacer una copia de seguridad cada madrugada sin congelar la API, y las fases siguientes necesitan trabajos que corran después de una escritura (avisos) o tras una petición larga (Kira).
- Si algo programado deja de correr, nadie se entera.

La casa necesita que Domus haga su propio mantenimiento a una hora fija, que no lo repita ni lo pierda si la Pi se apaga o cambia la hora, y que el admin pueda ver y ajustar esas tareas.

## Solución

`platform` gana un motor de segundo plano dentro de `api`, sin proceso ni contenedor nuevos. Los trabajos se guardan en la base y corren en dos carriles: uno corto y otro de mantenimiento, cada uno de uno en uno. Cada trabajo tiene un tiempo máximo con cancelación cooperativa, reintentos solo para los errores pasajeros, y recuperación de lo que quedó a medias al arrancar.

Encima del motor, un planificador lanza las tareas programadas de la plataforma a una hora local de la casa (`Europe/Madrid`), cada día o cada semana, con `@domus/utils/date-time`, que tiene aquí su primer uso. Cada ejecución prevista ocurre una sola vez, con un registro de ejecuciones y un vigilante que informa en `/health`.

El primer caso real es la limpieza: una tarea diaria borra el contenido caducado del registro de acciones (conservando sus anotaciones y sus claves de idempotencia), la operación guardada de las confirmaciones caducadas, los comprobantes que ya no deciden ninguna respuesta, y los trabajos y ejecuciones antiguos. La limpieza nunca cambia lo que responde Domus.

El admin lista las tareas y cambia su hora, las pausa o las lanza con operaciones del área de la plataforma servidas por HTTP. Las pantallas siguen siendo de la fase 3.

En la 1d1, todo trabajo es mantenimiento de la plataforma: no tiene actor ni pasa por acciones, y ningún módulo puede encolar nada.

## Historias de usuario

1. Como miembro, quiero que el contenido de mis escrituras desaparezca de verdad de la base cuando caduca, para que lo que ya no se puede deshacer no siga guardado.
2. Como miembro, quiero que repetir una escritura antigua siga sin ejecutarse dos veces después de la limpieza, para que borrar contenido no rompa la protección contra duplicados.
3. Como miembro, quiero seguir leyendo las anotaciones de mis escrituras después de la limpieza, para saber qué hice aunque ya no se pueda deshacer.
4. Como miembro, quiero que una entrada cuyo contenido se limpió responda igual que una caducada sin limpiar, para que la limpieza no cambie lo que veo.
5. Como miembro, quiero que la operación guardada de mis confirmaciones caducadas y mis comprobantes inservibles se borren, para que no quede nada mío que ya no sirve, sin que cambie lo que Domus responde si repito algo.
6. Como miembro, quiero que la limpieza nunca toque una entrada que todavía se puede deshacer, para no perder un deshacer que me corresponde.
7. Como admin, quiero que el mantenimiento corra solo cada noche, para no tener que acordarme.
8. Como admin, quiero que una tarea programada a las 02:30 corra a las 03:00 el día que se adelanta la hora, para que no se salte ese día.
9. Como admin, quiero que una tarea programada a las 02:30 corra una sola vez el día que se atrasa la hora, para que no se duplique.
10. Como admin, quiero que, si la Pi estuvo apagada varios días, cada tarea corra una sola vez al volver, para que no se amontonen ejecuciones atrasadas.
11. Como admin, quiero que una tarea no se lance si ya tiene una ejecución pendiente o en curso, para que no corran dos a la vez.
12. Como admin, quiero ver la lista de tareas con su próxima hora, su última ejecución y su resultado, para saber si el mantenimiento funciona.
13. Como admin, quiero cambiar la hora de una tarea, para que corra cuando menos moleste.
14. Como admin, quiero pausar y reanudar una tarea, para pararla mientras arreglo algo.
15. Como admin, quiero lanzar una tarea ahora, para comprobarla sin esperar a su hora.
16. Como admin, quiero que cambiar, pausar o lanzar una tarea me pida el comprobante, como cualquier operación de administrar, para que una sesión robada no pueda tocarlas.
17. Como admin, quiero que esos cambios queden en el registro de acciones y que repetirlos con la misma clave no los repita, para que se comporten como cualquier otra escritura.
18. Como admin, quiero deshacer un cambio de hora o una pausa, para volver atrás si me equivoco.
19. Como miembro, quiero poder ver la lista de tareas sin poder cambiarlas, porque no contiene datos personales y es información de la casa.
20. Como miembro, quiero que Kira no pueda cambiar las tareas, para que el mantenimiento solo lo toque una persona.
21. Como admin, quiero que `/health` diga si el planificador lleva tiempo sin dar señales, para enterarme de que algo se atascó.
22. Como admin, quiero que `/health` no diga nada personal, para que lo pueda consultar cualquier herramienta de vigilancia.
23. Como admin, quiero que, si `api` se congela por completo, lo detecte el healthcheck de Docker, para que el vigilante de dentro no tenga que vigilarse a sí mismo.
24. Como admin, quiero que una tarea que falla deje su error en el registro de ejecuciones y no impida la siguiente, para que un fallo puntual no pare el mantenimiento.
25. Como admin, quiero que un fallo pasajero se reintente con espera creciente hasta un máximo, para que un tropiezo no deje la tarea sin hacer.
26. Como admin, quiero que un fallo definitivo no se reintente, para que no se repita en bucle algo que nunca va a funcionar.
27. Como admin, quiero que una tarea que supera su tiempo máximo se cancele, para que no ocupe su carril para siempre.
28. Como admin, quiero que una tarea que no responde a la cancelación quede como atascada, visible en la lista y en `/health`, y que su carril no admita otro trabajo hasta que termine o se reinicie `api`, para que nunca corran dos trabajos solapados en el mismo carril.
29. Como admin, quiero que un trabajo largo de mantenimiento no retrase uno corto, para que en la 1d4 una copia no retrase un aviso.
30. Como admin, quiero que, si `api` se cae a mitad de un trabajo, al volver ese trabajo se recupere y no quede en ejecución para siempre, para que nada se pierda por un corte de luz.
31. Como admin, quiero que parar `api` cancele los trabajos en curso y espere a que terminen antes de cerrar la base, para que una actualización no deje nada a medias.
32. Como admin, quiero que el planificador arranque solo con `api`, para no tener que lanzarlo a mano.
33. Como admin, quiero que los trabajos y las ejecuciones antiguos se borren, para que la base no crezca sin fin.
34. Como admin, quiero que la hora de las tareas sea la de la casa aunque el contenedor o la Pi tengan otra zona horaria, para que «a las 4» signifique las 4 en Madrid.
35. Como admin, quiero que, si una actualización cambia la hora por defecto de una tarea, la hora que yo elegí se conserve, para no perder mis ajustes.
36. Como admin, quiero que una tarea que el código ya no declara no rompa el arranque, para que retirar una tarea sea seguro.
37. Como desarrollador, quiero probar el cambio de hora, lo perdido, los carriles, los tiempos máximos y las caídas sin esperas reales, para que las pruebas sean rápidas y deterministas.
38. Como desarrollador, quiero que las pruebas ejecuten el mismo motor que producción, para que lo probado sea lo que corre en la Pi.
39. Como desarrollador, quiero que ningún módulo pueda usar el mantenimiento ni encolar trabajos en la 1d1, para que nadie se salte la autorización por el segundo plano.

## Decisiones de implementación

### El motor de segundo plano (Q4, Q8)

- Vive en `platform`. Lo crea la plataforma y lo arranca y lo para `apps/api` con el resto del programa: arranca después de abrir la base y antes de servir, y para antes de cerrar la base.
- Los trabajos se guardan en una tabla de la plataforma. Cada uno tiene su tipo, su carril, su estado (pendiente, en ejecución, terminado, fallido, cancelado o atascado), sus intentos, el instante a partir del cual puede correr y, si es una ejecución programada, la ejecución a la que pertenece.
- Hay dos carriles: **corto** y **mantenimiento**. Cada carril ejecuta un trabajo a la vez, y los dos carriles corren a la vez. En la 1d1 todas las tareas reales van al carril de mantenimiento. El corto solo lo usan los trabajos sintéticos de las pruebas, hasta la 1d4.
- **Reclamar** un trabajo (pasar de pendiente a en ejecución) es una transacción de la conexión única: dos reclamaciones nunca toman el mismo trabajo.
- **Tiempo máximo.** Cada tipo de trabajo declara el suyo. Para empezar son unos 30 s en el carril corto y 30 min en el de mantenimiento, y se revisan al medir. Al agotarlo, el motor activa la señal de cancelación del trabajo.
- **La cancelación es cooperativa.** Cada trabajo recibe una señal de cancelación y la comprueba entre pasos. Todo el mantenimiento de la plataforma está escrito así, y sus pruebas lo comprueban. Un proceso hijo, que llega en la 1d2, se termina y se espera antes de liberar el carril.
- **Atascado.** Si un trabajo no termina después de cancelarlo, dentro de un margen corto, queda como atascado. Su carril sigue ocupado y no empieza otro trabajo en él mientras siga corriendo. Así nunca hay dos trabajos solapados en un carril. Si termina, el carril se libera. Si no, solo lo libera reiniciar `api`. El estado se ve en la lista de tareas y en `/health`.
- **Errores.** Un trabajo falla de dos formas:
    - **definitiva**: entrada no válida, algo que no existe o un error que el trabajo marca como definitivo. Queda fallido a la primera;
    - **pasajera**: cualquier otra excepción y agotar el tiempo máximo. Se reintenta con espera creciente, empezando por unos 30 s y doblando, hasta 5 intentos. Si los agota, queda fallido.

    Los valores son iniciales.

- **Recuperación al arrancar.** Lo que la base guarda como en ejecución o atascado al arrancar es de un proceso anterior que se cortó. Vuelve a pendiente con un intento más contado, y si ya agotó los intentos, queda fallido. Esto es reiniciar, no restaurar: restaurar es un procedimiento distinto de la 1d2.
- **Parada ordenada.** Al parar, el motor deja de reclamar trabajos, cancela los que corren y espera, como mucho un margen, a que terminen. Lo que no termina queda en ejecución en la base y se recupera al arrancar.
- **Sin temporizadores sueltos.** El motor recibe de la plataforma el reloj y la forma de esperar (cuándo despertar para el siguiente vencimiento). En producción son el reloj y los temporizadores reales. En las pruebas, el mando de segundo plano los controla.
- El motor no es una API de los módulos. `module-sdk` no ofrece encolar ni declarar trabajos en la 1d1, y las reglas de dependencias lo comprueban.

### El planificador y las tareas programadas (Q11, Q12)

- Las tareas programadas de la 1d1 las declara la plataforma en su código, con:
    - un identificador estable;
    - su carril;
    - su frecuencia por defecto: «cada día a las HH:MM» o «cada semana, tal día a las HH:MM». No hay expresiones cron;
    - su tiempo máximo;
    - si se puede lanzar a mano.
- Una tabla de la plataforma guarda el estado de cada tarea: la hora que eligió el admin, si existe; si está pausada; y la próxima ejecución prevista. La hora elegida sobrevive a las actualizaciones aunque cambie la de por defecto. Una fila de una tarea que el código ya no declara se conserva y se ignora: no rompe el arranque.
- **Hora de la casa.** Las horas son locales de `Europe/Madrid`. La zona va fija en el código, sin depender de `TZ` ni de la zona del proceso. Los cálculos los hace `@domus/utils/date-time`, que llega en esta subfase sobre `date-fns` y su soporte de zonas horarias.
- **Cambio de hora.**
    - Si la hora local no existe (el último domingo de marzo, de 02:00 a 03:00), la ejecución va a la primera hora válida: las 03:00 de ese día.
    - Si la hora local se repite (el último domingo de octubre, de 02:00 a 03:00), la ejecución va a la primera aparición.
- **Identidad de una ejecución.** Cada ejecución prevista se identifica por la tarea y su fecha local prevista, de forma única en la base, y guarda también su instante absoluto. Así una misma ejecución no puede crearse dos veces. Un lanzamiento a mano es una ejecución propia, marcada como manual.
- **Marcar y encolar juntos.** Cuando una ejecución vence, el planificador crea su trabajo y marca la próxima ejecución prevista en la misma transacción. Si algo falla entre las dos escrituras, no queda ninguna.
- **Lo perdido.** Si al despertar hay varias ejecuciones vencidas de una tarea (la Pi estuvo apagada), corre una sola: la más reciente. La próxima prevista se calcula desde ahora. No se crea una ejecución si la tarea ya tiene una pendiente o en curso. En ese caso esa fecha queda anotada como saltada.
- Una tarea pausada no crea ejecuciones. Al reanudarla, su próxima ejecución se calcula desde el momento de reanudar, sin recuperar lo que se saltó mientras estuvo pausada.
- **Registro de ejecuciones.** Cada ejecución guarda la tarea, la fecha prevista o «manual», cuándo empezó y terminó, su resultado (bien, fallida, cancelada, atascada o saltada) y, si falló, un mensaje para quien opera el sistema, en inglés y sin datos personales.

### Las tareas de la 1d1 (Q1)

- **Limpieza** (`cleanup`), diaria, para empezar a las 04:30, en el carril de mantenimiento:
    - En el registro de acciones, borra el contenido (entrada e inversa) de las entradas cuyo `expiresAt` ya pasó. Conserva la anotación, la clave de idempotencia y la huella, así que repetir una escritura antigua sigue respondiendo como hoy a una caducada, y cada cuenta sigue leyendo sus anotaciones.
    - **Regla general: la limpieza nunca cambia una respuesta.** Una fila que decide lo que se responde se conserva como marca mínima; solo se borra lo que no decide nada.
    - **Confirmaciones pendientes.** Ninguna fila se borra: una consumida o rechazada responde «ya consumida», una terminada o caducada «caducada», y borrar la fila lo cambiaría a «no encontrado». Pasado su `expiresAt`, sea cual sea su estado, la limpieza vacía la operación guardada (la entrada de la acción) y conserva la marca: id, cuenta, `via`, tipo, huella, clave, origen, sesión, instantes, estado y entrada. Para eso la columna de la operación pasa a admitir vacío.
    - **Comprobantes.** Se borran los que ya no deciden nada: los terminados y los emitidos sin usar pasada su caducidad, que hoy responden «no válido» igual que uno inexistente. Un comprobante usado se conserva, porque valida la repetición de la escritura que probó y su acuse. Solo guarda un hash y no lleva contenido.
    - Borra los trabajos terminados, fallidos o cancelados de más de 30 días y las ejecuciones de más de 90 días. Son valores iniciales.
    - Trabaja por lotes pequeños, cada uno en su propia transacción, y comprueba la señal de cancelación entre lotes. Así no bloquea la API y se puede cancelar. Si se corta a medias, la siguiente ejecución sigue donde quedó: limpiar dos veces no cambia nada.
- La limpieza es mantenimiento: trabaja con la base sin acciones y sin actor. No deja entradas en el registro de acciones.
- La copia de seguridad es de la 1d2. La limpieza de archivos, de la 1d3.

### Las operaciones de ajustes de las tareas (Q13)

- Son operaciones del área de la plataforma, en `@domus/platform/contracts`, servidas por la puerta como las de la 1c:
    - **Listar las tareas** es una lectura de nivel `read`. Devuelve de cada tarea su identificador, su frecuencia efectiva, si está pausada, su próxima ejecución, su última ejecución y su resultado, y si está atascada. No lleva datos personales, así que la puede leer cualquier cuenta con `read` en el área de la plataforma, y no pide comprobante. Esta es la decisión expresa: listar no exige comprobante.
    - **Cambiar la hora**, **pausar** y **reanudar** son escrituras de nivel `manage`: piden comprobante, clave de idempotencia y dejan su entrada en el registro de acciones. Son deshacibles: su inversa devuelve la hora o el estado anterior. Cambiar la hora recalcula la próxima ejecución.
    - **Lanzar ahora** es una escritura de nivel `manage`, irreversible, con comprobante, clave y entrada en el registro. Crea una ejecución manual. Si la tarea ya tiene una ejecución pendiente o en curso, responde con un conflicto y no crea otra.
- Hoy solo el admin tiene `manage` en el área de la plataforma. La delegación de `manage` nace en «no» y Kira no tiene llave hasta la 1e. No se añade una regla de «nunca»: si un día se abre, lo decide la tabla de delegación como en cualquier área.
- Una tarea que no existe responde «no encontrado».

### El vigilante y `/health` (Q12)

- El planificador deja una señal de vida en memoria cada vez que despierta. Despierta como mucho cada minuto, aunque no haya nada que hacer.
- `/health` sigue respondiendo 200 mientras el proceso atiende, y añade un campo de segundo plano sin datos personales:
    - `ok`;
    - `degraded`, con un motivo: el planificador lleva más de unos 5 minutos sin señal, o hay un carril atascado.

    La comprobación de la última copia, con su estado inicial «sin copia todavía», llega con la 1d2.

- El healthcheck de Docker no cambia. Detecta un proceso que no responde, que es lo que el vigilante de dentro no puede ver.
- El estado de `/health` es público, como hoy, y solo dice el estado y el motivo.

### `@domus/utils/date-time`

- Es un tema nuevo de `utils`, sin negocio. Ofrece:
    - la próxima ocurrencia local de «cada día a las HH:MM» y «cada semana, tal día a las HH:MM» en una zona dada, después de un instante dado, con las reglas del cambio de hora de arriba;
    - la fecha local de un instante en una zona.
- Recibe la zona como parámetro, y la plataforma le pasa `Europe/Madrid`.
- Entra la dependencia de zonas horarias de `date-fns`, respetando `minimumReleaseAge`.

### Migraciones

- Las tablas nuevas de la plataforma (trabajos, estado de las tareas y ejecuciones) llegan en una migración generada con `pnpm db:generate`, como las de la 1c.
- La migración solo cambia una tabla existente: la operación guardada de las confirmaciones pasa a admitir vacío. La limpieza borra contenido con escrituras normales, no con cambios de esquema.

### Arranque y parada en `apps/api`

- `apps/api` solo compone: arranca el segundo plano después de crear la plataforma y antes de servir, y lo para en el apagado ordenado, antes de cerrar la plataforma. Escribe en el log, en inglés, cuándo arranca y para el planificador y cuántos trabajos recuperó.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba el comportamiento visible desde fuera:
    - lo que devuelven las operaciones de la plataforma;
    - lo que muestra la lista de tareas;
    - lo que responden `/health` y la puerta;
    - lo que leen después las lecturas del registro;
    - y, solo cuando no hay otra forma de verlo, la instantánea del registro que ya ofrece la entrada de pruebas.

    No comprueba sentencias SQL, nombres de columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla.

- **El punto principal: `createTestPlatform` con un mando de segundo plano.** `test-utils` amplía la plataforma de prueba con un mando que ejecuta el mismo motor y el mismo planificador de producción, con el `TestClock` y una espera controlada en vez de temporizadores reales:
    - avanzar el reloj dispara los vencimientos, incluidos los tiempos máximos y las esperas de los reintentos, sin esperas reales;
    - «ejecuta lo que toca» y «espera a que se asiente» dejan las pruebas deterministas;
    - la entrada de pruebas de `platform` permite registrar **trabajos sintéticos** de cualquiera de los dos carriles, cuyo final controla la prueba con promesas. Los usa la prueba para:
        - mantener un trabajo en curso;
        - comprobar que los dos carriles corren a la vez y que dentro de cada uno solo corre uno;
        - comprobar la cancelación cooperativa y el estado atascado de un trabajo que la ignora.

        Los trabajos sintéticos no son un contrato público para los módulos.
- **Con el mando se prueba:**
    - el cambio de hora en marzo y en octubre;
    - lo perdido tras días apagada, que corre una sola vez;
    - que no se crea una ejecución con otra pendiente o en curso;
    - pausar y reanudar sin recuperar lo saltado;
    - la hora elegida, que sobrevive a otra hora por defecto;
    - una tarea que ya no se declara;
    - los reintentos con espera creciente y su máximo, y el fallo definitivo sin reintento;
    - el tiempo máximo y la cancelación;
    - el estado atascado, sin solapamiento en su carril, y su liberación al terminar;
    - la limpieza: contenido caducado borrado, entrada vigente intacta, repetir con la misma clave tras limpiar, anotaciones legibles, operación de las confirmaciones caducadas vaciada y comprobantes inservibles borrados, y que confirmar otra vez una confirmación consumida, confirmar una caducada, repetir una escritura confirmada y repetir una escritura con su comprobante usado responden igual antes y después de limpiar, trabajos y ejecuciones antiguos borrados, limpieza cortada a medias que sigue después, y limpiar dos veces;
    - la parada ordenada.
- **Persistencia.** Con `file`, cerrar la plataforma y abrirla de nuevo sobre el mismo fichero comprueba que el estado de las tareas, la hora elegida y la próxima ejecución sobreviven a un reinicio. Esto prueba la persistencia, no una caída.
- **Pruebas internas de `platform`**, para lo que no se provoca desde fuera:
    - **Caída a mitad de un trabajo.** Deja en la base un trabajo en ejecución sin pasar por la parada ordenada, abre la plataforma sobre esa base y comprueba que se recupera: vuelve a pendiente con su intento contado, o queda fallido si los agotó.
    - **Fallo entre marcar y encolar.** Provoca un fallo entre las dos escrituras y comprueba que la transacción revierte las dos: ni trabajo ni próxima ejecución movida.
    - **Dos reclamaciones del mismo trabajo**, de las que solo gana una.
- **La puerta por HTTP**, como en la 1c, con sesiones reales:
    - listar como admin y como miembro;
    - cambiar la hora, pausar, reanudar y lanzar como admin con comprobante, sin comprobante, con un comprobante de otra operación, y como miembro, que responde «no permitido»;
    - repetir con la misma clave, que devuelve el acuse;
    - deshacer un cambio de hora;
    - lanzar con una ejecución en curso, que responde con un conflicto;
    - una tarea que no existe;
    - una llamada sin sesión.
- **`/health`**: `ok`; `degraded` por planificador sin señal; `degraded` por carril atascado; y que la respuesta no lleva nada personal.
- **`@domus/utils/date-time`**, por sí solo:
    - la próxima ocurrencia diaria y semanal;
    - la hora que no existe en marzo y la que se repite en octubre;
    - el cambio de año;
    - una zona distinta de la del proceso.
- **Reglas de dependencias**, en `tooling/scripts/architecture.test.ts`: `module-sdk` no expone el motor, el planificador ni el mantenimiento, y un módulo que intente importarlos rompe la regla.
- **Prior art:**
    - las pruebas de la 1b y la 1c con `createTestPlatform` y el `TestClock`, como la caducidad de `expiresAt` y de las confirmaciones;
    - las de la puerta por HTTP con `browser()` y comprobantes de la 1c;
    - las de reapertura sobre fichero de la 1a y la 1b;
    - las de `utils/connection` para un tema de `utils` probado por sí solo.
- **En la Pi**, sin punto de prueba nuevo en `apps/api`:
    - el planificador arranca con `api` y para de forma ordenada al recrear el contenedor, lo que se ve en el log;
    - la limpieza corre a su hora y queda en la lista de tareas con su resultado;
    - después de reiniciar `api`, la próxima ejecución y la hora elegida se conservan;
    - `/health` dice `ok`.

## Fuera de alcance

- La bandeja de salida desde las acciones y los avisos: 1d4.
- Los trabajos pedidos por una persona, que rehacen el contexto verificado: 5b, con el primer trabajo de Kira.
- Que un módulo declare tareas programadas o encole trabajos, y el actor `system`: con la primera tarea de un módulo.
- Las tareas que corren por cada persona: fase 7.
- La copia de seguridad, su estado en `/health` («sin copia todavía», 48 h), restaurar y el proceso hijo de restic: 1d2.
- La limpieza de archivos: 1d3.
- Las pantallas de ajustes de las tareas: fase 3.
- Frecuencias más ricas que diaria y semanal, y expresiones cron: con el caso que las pida.
- Un aviso al admin cuando el vigilante detecta un problema: cuando existan los avisos.

## Notas

- El ADR 0025, el glosario y el plan ya están al día en la rama del grilling, también la corrección del área (las operaciones de las tareas son del área de la plataforma, sin un área «sistema») y los destinos de la bandeja de salida (1d4) y los trabajos pedidos (5b). Al cerrar la 1d1 se actualizan `docs/plan.md`, `docs/despliegue.md` (el planificador, la lista de tareas y el campo de `/health`) y `docs/guia/`.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling:
    - la hora inicial de la limpieza (04:30);
    - los plazos de purga (30 y 90 días);
    - los reintentos (30 s doblando, 5 intentos);
    - el margen antes de marcar un trabajo como atascado;
    - el intervalo de la señal de vida y su umbral;
    - que pausar y cambiar la hora sean deshacibles y lanzar sea irreversible;
    - que listar sea `read` sin comprobante.

    Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.

- Decisiones de la tarea 01, tomadas al implementar:
    - Deshacer una entrada caducada sin inversa responde «caducada» si su acción es deshacible según su contrato, e «irreversible» si no. Así la limpieza, que vacía la inversa, no cambia la respuesta: antes de limpiar ya decía «caducada».
    - Una ejecución manual se distingue por no tener fecha prevista (`planned_date` vacío); guarda como instante el de su lanzamiento.
    - Un trabajo que falla después de recibir la cancelación queda cancelado, y su ejecución también. Si termina bien aunque se le cancelara, queda terminado.
    - `close()` de la plataforma lanza un error mientras el segundo plano está activo. La parada ordenada va antes.
    - En `createTestPlatform` el segundo plano no arranca solo: la prueba llama a `background.start()`, como hace `apps/api`. Así las pruebas de la 1b y la 1c, que mueven el reloj días enteros, no ven limpiezas que no pidieron. La opción `tasks` declara tareas de prueba junto a las de la plataforma.
    - El planificador despierta como mucho cada minuto desde ya, aunque la señal de vida y `/health` son de la 06.

- Decisiones de la tarea 02, tomadas al implementar:
    - La frecuencia semanal se escribe `{ every: "week", on: "sunday", at: "02:30" }`, con el día de la semana en inglés.
    - De lo perdido solo queda en el registro la ejecución que corre, la más reciente; las fechas intermedias no se anotan.
    - Una fecha saltada porque la tarea tenía una ejecución pendiente, en curso o atascada queda con resultado «saltada», sin inicio y con su final en el instante en que se saltó.
    - Pausar una tarea pausada o reanudar una que no lo está no cambia nada; en particular, reanudar no mueve la próxima ejecución. Volver a la hora por defecto es elegir «ninguna hora».
    - Cambiar el estado de una tarea que el código no declara lanza `UnknownTaskError`, que la 05 traduce a «no encontrado». Si la tarea aún no tiene fila (el segundo plano no ha arrancado), cambiarla la crea como lo haría el arranque.
    - Si cambia la hora por defecto de una tarea sin hora elegida, la próxima ejecución ya guardada se mantiene una vez; la siguiente ya usa la nueva hora.

- Decisiones de la tarea 03, tomadas al implementar:
    - El margen antes de marcar un trabajo como atascado es de 10 s después de cancelarlo. El de la parada ordenada es de 5 s, por debajo de los 10 s que Docker espera antes de matar el contenedor.
    - Un error es definitivo si el trabajo lanza `PermanentJobError` o si su tipo no está declarado. En la 1d1 ningún trabajo tiene entrada ni actor; los trabajos que llamen a acciones (5b) traducirán sus errores a definitivos.
    - El mensaje que guarda un trabajo fallido (en su fila y en su ejecución) no lleva datos personales: el nombre del error y, si lo tiene, su código (`SQLITE_BUSY`). Solo `PermanentJobError` y los motivos del propio motor (tiempo agotado, ejecución interrumpida) guardan su texto, escrito en inglés por la plataforma, de 200 caracteres como mucho. Cualquier otro mensaje puede citar los datos con los que falló.
    - Entre reintentos el trabajo vuelve a pendiente con su último error; su ejecución sigue abierta hasta el final definitivo y guarda como inicio el del primer intento.
    - Recuperar al arrancar deja el trabajo pendiente para ya, sin espera: el reinicio ya fue la espera. Si agotó los intentos queda fallido con «interrupted: the process ended while the job ran», y su ejecución también.
    - Mientras un trabajo está atascado, su ejecución sigue sin resultado; al terminar recibe el suyo. Si un reinicio lo recupera, vuelve a pendiente como uno en ejecución.
    - Si un trabajo cancelado por la parada termina después del margen, su final no se escribe: queda en ejecución en la base hasta el siguiente arranque.

- Decisiones de la tarea 05, tomadas al implementar:
    - Las rutas son `tasks/list`, `tasks/setTime`, `tasks/pause`, `tasks/resume` y `tasks/launch`; en el camino de las acciones, `platform.listTasks`, `platform.setTaskTime`, `platform.pauseTask`, `platform.resumeTask` y `platform.launchTask`, que es lo que nombra un comprobante. La hora es `HH:MM`, y `null` vuelve a la de por defecto.
    - La última ejecución de la lista es la última que anotó el registro, sea cual sea su resultado (también «saltada»), con `manual`, sus instantes, su resultado (vacío mientras corre) y su mensaje de error para quien opera. La lista solo muestra las tareas que el código declara, en su orden.
    - La inversa de pausar o reanudar devuelve el estado de pausa anterior: deshacer una pausa reanuda, con la próxima ejecución calculada desde ese momento. Deshacer un cambio de hora vuelve a la hora elegida antes, o a la de por defecto.
    - Una tarea que no existe responde «no encontrado» antes de la autorización y del comprobante, también a un miembro.
    - Lanzar con una ejecución pendiente, en curso o atascada responde `CONFLICT` con el motivo `task-busy`.
    - Un cambio hecho dentro de la transacción de una acción despierta el segundo plano cuando esa transacción ha terminado: ningún trabajo empieza dentro de una transacción que aún puede revertirse.
    - Ninguna tarea declara todavía si se puede lanzar a mano: en la 1d1 todas se pueden. El campo llega con la primera que no deba.

- La limpieza cambia lo que guarda la base, no lo que responde la API: las pruebas de la caducidad de la 1b y la 1c tienen que seguir pasando sin cambios después de limpiar.

## Tareas

| Tarea                                                             | Qué                                              | Bloqueada por |
| ----------------------------------------------------------------- | ------------------------------------------------ | ------------- |
| [01](issues/01-limpieza-diaria-de-punta-a-punta.md)               | Limpieza diaria de punta a punta                 | —             |
| [02](issues/02-programacion-completa-y-persistencia.md)           | Programación completa y persistencia             | 01            |
| [03](issues/03-carriles-cancelacion-reintentos-y-recuperacion.md) | Carriles, cancelación, reintentos y recuperación | 01            |
| [04](issues/04-limpieza-completa-por-lotes.md)                    | Limpieza completa por lotes                      | 03            |
| [05](issues/05-ajustes-de-las-tareas-por-http.md)                 | Ajustes de las tareas por HTTP                   | 02, 03        |
| [06](issues/06-vigilante-y-health.md)                             | Vigilante y `/health`                            | 03            |
| [07](issues/07-la-pi-y-el-cierre.md)                              | La Pi y el cierre de la 1d1                      | todas         |
