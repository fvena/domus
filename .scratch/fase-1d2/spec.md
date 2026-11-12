# Fase 1d2: copias de seguridad y restaurar

Status: ready-for-agent

Esta spec sale del grilling de la fase 1d2 ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-12, preguntas Q1–Q15, y del acuerdo posterior sobre los puntos de prueba. Las decisiones duraderas están en el [ADR 0026](../../docs/architecture/adr/0026-copias-de-seguridad-y-restaurar.md), que precisa el [ADR 0025](../../docs/architecture/adr/0025-segundo-plano.md). Si esta spec y los ADR no coinciden, mandan los ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): copia de seguridad, restaurar, mantenimiento, trabajo, tarea programada, registro de ejecuciones, sesión, confirmación pendiente, comprobante y clave de idempotencia.

## Problema

Después de la 1d1, Domus guarda todo en un solo fichero SQLite y no tiene ninguna copia. Un borrado por error, un fallo de la aplicación que estropee datos o una actualización que salga mal no tienen vuelta atrás. `despliegue.md` lo dice tal cual: «no borres el volumen».

Hacer una copia no basta. La casa necesita:

- que se haga sola cada noche sin que la API deje de responder;
- saber si las copias están al día, y no descubrirlo el día que hace falta una;
- poder restaurar sin que lo restaurado repita avisos antiguos, devuelva la vida a una sesión revocada o deje la base peor de lo que estaba si algo se corta a mitad.

## Solución

`platform` gana dos tareas de mantenimiento. `backup`, cada noche, saca una instantánea coherente de la base, la comprueba en un proceso hijo y la sube con restic a un repositorio cifrado en `/srv/backups/domus`, en el mismo NVMe de forma provisional. Después aplica la retención 7/4/3. `backup-check`, cada domingo, comprueba que el repositorio se puede leer entero.

Las copias dejan sus propias marcas, y el vigilante de `/health` dice si están al día, contando desde cuándo se capturaron los datos.

Restaurar es un comando de la imagen de `api` que solo corre con la base libre: un cerrojo sobre el volumen lo garantiza. Prepara la copia aparte (la comprueba, la migra y la sanea, descartando los trabajos pendientes y cerrando todas las sesiones) y la instala con un intercambio que, se corte donde se corte, deja la base anterior entera o la restaurada saneada.

La 1d2 termina con una restauración real en un entorno aislado de la Pi y con una medición de que la API responde durante la copia.

## Historias de usuario

1. Como admin, quiero que Domus haga una copia de la base cada noche sin que yo lo pida, para no depender de acordarme.
2. Como miembro, quiero que la app siga respondiendo mientras se hace la copia, para no notar el mantenimiento.
3. Como admin, quiero que la copia sea una instantánea coherente de un solo instante, para que restaurarla no mezcle datos de dos momentos.
4. Como admin, quiero que una instantánea estropeada no se suba, para no guardar como buena una copia que no sirve.
5. Como admin, quiero que las copias vayan cifradas, para que el repositorio no deje leer los datos de la casa sin su contraseña.
6. Como admin, quiero que se conserven 7 diarias, 4 semanales y 3 mensuales, para poder volver a un punto de hace días o meses sin llenar el disco.
7. Como admin, quiero que cada semana se lea el repositorio entero, para enterarme si una copia guardada se ha estropeado.
8. Como admin, quiero que la primera copia cree el repositorio sola si el destino está vacío, para no tener un paso manual más.
9. Como admin, quiero que un repositorio que no abre nunca se reinicialice, para no perder las copias que tenía por un error de contraseña o de montaje.
10. Como admin, quiero que la copia no deje ficheros sueltos de la base en el volumen después de terminar, fallar o cortarse, para no tener copias en claro olvidadas.
11. Como admin, quiero que una copia que restic no pudo leer entera no cuente como buena ni dispare la retención, para no borrar copias buenas por culpa de una mala.
12. Como admin, quiero que, si alguien más está usando el repositorio, la copia se reintente más tarde, para que un choque pasajero no la pierda.
13. Como admin, quiero que una copia que se pasa de tiempo se cancele de verdad, sin dejar procesos colgados, para que el carril de mantenimiento quede libre.
14. Como admin, quiero que `/health` diga si las copias están al día, para saberlo sin entrar en la Pi.
15. Como admin, quiero que `/health` avise si la última copia guardada tiene más de 48 h desde que se capturaron sus datos, para enterarme de que se han parado.
16. Como admin, quiero que, si la primera copia falla, `/health` lo diga en vez de «sin copia todavía», para no confundir «aún no toca» con «nunca funcionó».
17. Como admin, quiero que una retención fallida avise por su cuenta sin hacer pasar por fallida la copia guardada, para saber qué está mal de verdad.
18. Como admin, quiero que un `check` semanal fallido avise hasta que otro pase, para no olvidarme de un repositorio dañado.
19. Como admin, quiero ver a la vez todos los motivos por los que el segundo plano está degradado, para no arreglar uno y descubrir otro después.
20. Como admin, quiero que el estado de las copias no se olvide al purgar las ejecuciones antiguas ni al reiniciar, para que una tarea pausada mucho tiempo no vuelva a parecer nueva.
21. Como admin, quiero que `/health` siga sin decir nada personal, para que sea público sin riesgo.
22. Como desarrollador, quiero que en mi ordenador las copias estén apagadas si no las configuro, y que una configuración a medias no arranque, para no tener copias a medio configurar.
23. Como admin, quiero que en la Pi las copias solo se apaguen con un interruptor explícito, para que nunca queden apagadas por olvido.
24. Como admin, quiero listar las instantáneas del repositorio, para elegir a qué punto vuelvo.
25. Como admin, quiero restaurar la última instantánea o una concreta con un solo comando, para no improvisar en un mal día.
26. Como admin, quiero que restaurar se niegue mientras `api` o `accounts` usan la base, también si `api` está congelada, para no estropear la base que están usando.
27. Como admin, quiero que `api` no arranque mientras se restaura, para que no abra una base a medio cambiar.
28. Como admin, quiero que restaurar descarte los trabajos pendientes, en curso o atascados de la copia, para no repetir avisos ni efectos que ya salieron.
29. Como admin, quiero que un reinicio normal siga recuperando los trabajos a medias, para que restaurar y reiniciar no se confundan.
30. Como admin, quiero que, tras restaurar, las tareas programadas calculen su próxima ejecución desde ese momento, para que no se disparen de golpe las atrasadas.
31. Como miembro, quiero que restaurar cierre todas las sesiones, para que una sesión que revoqué después de la copia no vuelva a valer.
32. Como miembro, quiero que restaurar anule las confirmaciones pendientes y los comprobantes, para que nada aprobado antes de la copia se ejecute después.
33. Como admin, quiero saber que tras restaurar vuelven las contraseñas, los permisos, la delegación y los ajustes de las tareas de la copia, y que se pierden las claves de idempotencia posteriores, para revisarlo después.
34. Como admin, quiero que una copia hecha con un código más nuevo se rechace antes de tocar la base activa, para no instalar algo que este código no entiende.
35. Como admin, quiero que una copia antigua reciba las migraciones que le faltan antes de instalarse, y que una migración que falla no toque la base activa, para no quedarme sin ninguna de las dos.
36. Como admin, quiero poder restaurar aunque la base actual esté dañada o no exista, porque esos son justo los casos en los que hace falta.
37. Como admin, quiero que la base anterior se conserve entera, con su WAL, en una carpeta aparte, para poder volver atrás o investigar qué pasó.
38. Como admin, quiero que un corte de luz a mitad de restaurar deje la base anterior entera o la restaurada saneada, nunca una vacía ni una mezcla, para que restaurar no sea otro riesgo.
39. Como admin, quiero que, si restaurar se corta a mitad, `api` y `accounts` se nieguen a abrir la base y volver a ejecutar el comando lo termine, para no tener que arreglarlo a mano.
40. Como admin, quiero que una marca de restauración ilegible lo bloquee todo con un mensaje claro, para que nunca se tome por una base normal.
41. Como admin, quiero que restaurar una copia de hace diez días siga diciendo que las copias no están al día, para no tomar una restauración por una copia reciente.
42. Como admin, quiero ensayar una restauración en la Pi sin tocar producción y sin chocar con su retención, para saber que funciona antes de necesitarla.
43. Como admin, quiero una medición en la Pi de cómo responde la API durante una copia grande, para revisar los tiempos con números y no con suposiciones.
44. Como desarrollador, quiero que `pnpm test` falle con un mensaje claro si falta restic, para no creer que las copias están probadas cuando se han saltado.

## Decisiones de implementación

### La tarea `backup` (Q1, Q2, Q3, Q4)

- Es mantenimiento de la plataforma, en el carril de mantenimiento, diaria a las 05:00 para empezar. No tiene actor, no pasa por acciones y no deja entradas en el registro de acciones. No se promete que siempre corra después de la limpieza de las 04:30.
- Pasos de una ejecución:
    1. Vacía la carpeta de preparación de copias, que es una carpeta fija dentro de la carpeta de datos.
    2. Saca la instantánea con `db.backup()` de better-sqlite3 dentro de esa carpeta, con un nombre fijo. Guarda como instante de captura el del final de la copia.
    3. Un proceso hijo de Node abre la instantánea en solo lectura y pasa `PRAGMA quick_check`. Si no da `ok`, la ejecución falla sin reintentos y no sube nada.
    4. `restic unlock` quita solo los bloqueos viejos.
    5. `restic backup` de la carpeta de preparación, con host fijo `domus` y el instante de captura como hora de la instantánea, para que la antigüedad la lea quien restaure.
    6. Si la copia quedó guardada, anota la marca de copia guardada y, después, `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune` con el mismo host, y anota la marca de retención.
    7. Vacía la carpeta de preparación, también si algo falló o se canceló.
- restic corre siempre como proceso hijo, con `--no-cache`, y recibe el repositorio y el fichero de la contraseña por su entorno, nunca por argumentos.
- **Lo que sale de restic:**
    - `0`: bien.
    - `3` en `backup` (no leyó todo el origen): la instantánea es parcial. No cuenta como copia guardada, no da paso a la retención y la ejecución falla sin reintentos.
    - `10` (el repositorio no existe): si la carpeta del repositorio existe y está vacía, `restic init` y se sigue. Si no existe o tiene algo, la ejecución falla sin reintentos: nunca se reinicializa un destino con contenido.
    - `11` (no pudo bloquear el repositorio): error pasajero, que el motor reintenta.
    - `12` (contraseña incorrecta) y cualquier otro: la ejecución falla sin reintentos.
- **Una retención fallida no repite la copia.** Si `forget --prune` falla después de una copia guardada, la ejecución termina como fallida sin reintentos y con el mensaje de la retención. La copia sigue guardada y su marca, anotada. La próxima noche se vuelve a intentar.
- **Cancelación.** Si se agota el tiempo máximo, `db.backup()` se aborta lanzando un error desde su callback de progreso. Un proceso hijo recibe SIGTERM y, si no termina en unos segundos, SIGKILL. El carril se libera solo cuando el hijo ha terminado de verdad.
- El tiempo máximo es el del carril de mantenimiento (30 min), revisable con la medición.
- El mensaje de error de una ejecución sigue la regla de la 1d1: en inglés, sin datos personales y con 200 caracteres como mucho. La salida de restic no se copia entera: solo el paso y el código.

### La tarea `backup-check` (Q2)

- Es mantenimiento, en el carril de mantenimiento, cada domingo a las 05:30.
- Pasos: `restic unlock` y `restic check --read-data`, con `--no-cache`.
- Si el repositorio todavía no existe, termina bien sin comprobar y sin tocar su marca.
- Un bloqueo vigente es un error pasajero. Cualquier otro fallo, también el que agota sus reintentos, anota «check fallido».
- Su tiempo máximo es el del carril, revisable al medir.

### Configuración (Q5)

- **Dentro del contenedor y en desarrollo** hay tres variables:
    - `DOMUS_BACKUP_REPOSITORY`: la ruta absoluta del repositorio.
    - `DOMUS_BACKUP_PASSWORD_FILE`: la ruta absoluta del fichero de la contraseña.
    - `DOMUS_BACKUPS_OFF=1`: el interruptor.
- **Reglas al arrancar:**
    - Con el interruptor, las copias están apagadas aunque haya lo demás.
    - Sin ninguna de las dos rutas, apagadas.
    - Con solo una, `api` no arranca y dice cuál falta.
    - Con las dos, el fichero de la contraseña tiene que poder leerse y no estar vacío; si no, `api` no arranca.
    - La carpeta del repositorio se comprueba en cada ejecución, no al arrancar.
- Con las copias apagadas, las dos tareas no se declaran.
- **La imagen de `api`** fija `DOMUS_BACKUP_REPOSITORY=/backups` y `DOMUS_BACKUP_PASSWORD_FILE=/run/secrets/backup-password`. Así en la imagen las copias solo se apagan con el interruptor.
- **compose:**
    - `api` monta `${DOMUS_BACKUPS:-domus-backups}:/backups`. En la Pi, el `.env` pone `/srv/backups/domus` (un bind mount); en otro ordenador queda un volumen con nombre.
    - La contraseña es un secret de compose que sale del fichero `${DOMUS_BACKUP_PASSWORD:?…}`. Sin él, compose no arranca, como pasa con `DOMUS_AUTH_SECRET`.
    - Solo `api` monta el repositorio.
- **restic** entra en la imagen de `api` desde los paquetes de Debian trixie. La construcción falla si `restic version` no responde.
- Fuera de la imagen hay que instalar restic: `brew install restic` en el Mac y apt en la CI. Es necesario para `pnpm test` y para `pnpm check`. El `AGENTS.md` raíz lo dice junto a gitleaks.

### Las marcas de las copias y el vigilante (Q6)

- Una fila única de la plataforma guarda las marcas. La limpieza no la toca y sobrevive a la purga de ejecuciones y a los reinicios:
    - la última copia guardada: su instante de captura y el identificador de la instantánea;
    - el último intento fallido de copia, con su instante;
    - la última retención: instante y resultado;
    - el último `check`: instante y resultado;
    - la procedencia de la última restauración: identificador de la instantánea, su instante de captura y el instante de restaurar.
- El segundo plano carga las marcas al arrancar y las mantiene en memoria al escribirlas. `/health` no lee la base.
- **`/health`** cambia la forma de `background` de la 1d1:
    - `status`: `ok` o `degraded`.
    - `reasons`: solo cuando está `degraded`. Es una lista no vacía, en este orden fijo: `scheduler-silent`, `lane-stuck`, `backup-stale`, `backup-retention-failed`, `backup-check-failed`.
    - `backups`: siempre presente. `off` (apagadas), `none-yet` (ni copia guardada ni intento fallido) o `saved` (hay alguna copia guardada).
- **Cuándo se da cada motivo de las copias:**
    - `backup-stale`: la última copia guardada se capturó hace más de 48 h, o no hay ninguna y hay un intento fallido.
    - `backup-retention-failed`: la última retención falló. Desaparece con una retención buena.
    - `backup-check-failed`: el último `check` falló. Desaparece con uno bueno.
- Con las copias apagadas no hay motivos de copias.
- `none-yet` no degrada.
- Restaurar no rejuvenece la copia ni acredita un `check`: la marca de copia guardada pasa a ser la captura de la instantánea restaurada solo si es más reciente que la que traía la base, y la marca del `check` queda como venía en la copia.

### El cerrojo de la base (Q15)

- En la carpeta de datos, junto a `domus.db`, vive `domus.lock`: una base SQLite en modo `DELETE` (no WAL) con una tabla mínima. Nunca se sustituye ni se borra.
- **Compartido.** El camino común de abrir la plataforma, el mismo para `api`, `accounts` y `createTestPlatform`, toma el cerrojo compartido antes de abrir `domus.db`. Lo toma con una transacción de lectura que lee de esa tabla (`BEGIN` solo o `SELECT 1` no bloquean nada) y lo mantiene hasta `close()`. Cualquier error al tomarlo impide abrir la base.
- **Exclusivo.** Restaurar lo toma con `BEGIN EXCLUSIVE` sin espera al empezar, antes de preparar nada, y lo mantiene hasta terminar. Si no puede, se niega con `the database is in use: stop api and accounts first`.
- Si al abrir la plataforma el cerrojo exclusivo está tomado, falla con `restore in progress`. Docker vuelve a levantar `api` después.
- La plataforma en memoria no usa cerrojo.
- El cerrojo se libera solo cuando el proceso muere, porque SQLite usa los bloqueos `fcntl` del sistema operativo. Funciona entre contenedores sobre el mismo volumen.
- Detalles de la implementación (tarea 02):
    - La tabla se llama `domus_lock`, y el compartido la crea si falta antes de leerla. Si `api` y `accounts` abren a la vez por primera vez sobre un volumen sin `domus.lock`, uno de los dos puede fallar con `restore in progress`; vuelve a abrir bien en el siguiente intento.
    - El exclusivo sobre un `domus.lock` recién creado puede dejar `domus.lock-journal` a su lado. SQLite lo trata solo, y abrir después funciona.
    - El cerrojo dura mientras su asa siga referenciada: el recolector de basura cierra una conexión a la que nadie llega, y con ella se va el cerrojo. Restaurar guarda la suya hasta terminar.
    - Dentro de un proceso, solo SQLite abre `domus.lock`: cerrar cualquier otro descriptor de ese fichero (leerlo con `node:fs`, por ejemplo) suelta los bloqueos `fcntl` del proceso sobre él.

### Restaurar (Q7, Q8, Q13, Q14)

- Es una función de la plataforma, sin actor y sin acciones. `module-sdk` no la ofrece, y la compone un comando nuevo de `apps/api`, empaquetado como `restore.mjs` junto a `main.mjs` y `accounts.mjs`. Recibe la lista de módulos, para validar y aplicar sus migraciones, igual que `createPlatform`.
- **Uso en la Pi**, con `api` parada:

    ```bash
    docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs list
    docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs [--snapshot <id>]
    ```

    - `list` muestra las instantáneas del host `domus` con su identificador y su instante de captura. No toca la base ni toma el cerrojo.
    - Sin `--snapshot`, restaura la última.
    - En desarrollo es `pnpm restore …`, sobre `<repo>/data`.
    - Los mensajes van en inglés.

- **Preparar**, con el cerrojo exclusivo ya tomado:
    1. Si existe la marca `restore.pending`, salta a **retomar**.
    2. Vacía la carpeta de preparación de restaurar, una carpeta fija dentro de la carpeta de datos.
    3. restic deja allí la base de la instantánea.
    4. Comprueba con `quick_check`.
    5. Valida que el historial de migraciones de la copia es un prefijo exacto del código (la misma validación del migrador) y aplica las que faltan. Si la copia es más nueva o una migración falla, se para aquí con el mensaje del migrador. La base activa sigue sin tocar.
    6. Sanea, en una transacción:
        - los trabajos `pending`, `running` y `stuck` pasan a `cancelled` con el error `discarded by restore`, y sus ejecuciones también;
        - cada tarea recalcula su próxima ejecución desde ese momento (una pausada sigue pausada);
        - se cierran todas las sesiones;
        - se anulan las confirmaciones pendientes y los comprobantes, con el mismo efecto que el cambio de contraseña de la 1c, pero para todas las cuentas;
        - se anota la procedencia y, si toca, la marca de copia guardada.
    7. Pasa la copia a `journal_mode=DELETE`, la cierra sin WAL y hace `fsync` del fichero y de su carpeta.
- **Instalar.** Se escriben los nombres tal cual porque forman parte del procedimiento:
    1. Crea `before-restore-<instante UTC compacto>/` en la carpeta de datos. Enlaza con enlaces duros `domus.db`, `domus.db-wal` y `domus.db-shm`, los que existan y sin abrirlos. Hace `fsync` de cada fichero, de esa carpeta y de la de datos. Así vale igual con una base sana, dañada o ausente.
    2. Publica la marca: escribe `restore.pending.tmp` con la carpeta del paso anterior, el identificador de la instantánea y el instante, hace `fsync`, lo renombra a `restore.pending` y hace `fsync` de la carpeta de datos.
    3. Borra `domus.db-wal` y `domus.db-shm` y hace `fsync` de la carpeta de datos.
    4. Renombra la copia preparada sobre `domus.db` y hace `fsync` de la carpeta de preparación y de la de datos.
    5. Borra la marca y hace `fsync` de la carpeta de datos.
    6. Suelta el cerrojo.
- **Retomar** repite los pasos 3–5 con la carpeta que nombra la marca, sin volver a enlazar. Si la copia preparada sigue en su carpeta, falta el renombrado; si no está, ya se hizo y solo quedan las sincronizaciones y borrar la marca.
- **Invariantes:**
    - La copia preparada está sincronizada antes de publicar la marca.
    - El cerrojo exclusivo dura todo el procedimiento, también al retomar.
    - Mientras exista la marca, nada vacía la carpeta de preparación de restaurar ni crea otra carpeta `before-restore`.
    - Desde el primer borrado de un auxiliar, la marca ya está en disco.
- **La marca al abrir.** El camino común de abrir la plataforma, después de tomar el cerrojo compartido y antes de abrir `domus.db`, comprueba la marca. Si existe, falla con `restore incomplete: run restore again`. Si existe pero no se puede leer, abrir falla con `restore marker unreadable` y restaurar también. Nunca se toma por ausente.
- Las carpetas `before-restore-…` no se borran solas. `despliegue.md` explica cómo devolver una a mano y cuándo borrarla.
- Los puntos de corte de las pruebas existen solo en la entrada de pruebas de `platform`. El comando de producción no tiene forma de activarlos, tampoco por variables de entorno.

### El ensayo y la medición en la Pi (Q9, Q10, Q12)

- El ensayo es un proyecto de compose aparte, `domus-restore`, desde un fichero de compose del repositorio:
    - tiene su propio volumen de datos;
    - escucha en `127.0.0.1:3001`, sin Tailscale;
    - su `api` corre con `DOMUS_BACKUPS_OFF=1`.
- **Restaurar en el ensayo.** El comando `restore` monta el repositorio de producción con escritura y restaura con el bloqueo compartido de restic y `--retry-lock 30m`. Así nunca coincide con un `prune` de producción, y si coincide espera. La `api` del ensayo nunca monta el repositorio de producción.
- **La medición** usa en el ensayo su propio repositorio, en un volumen desechable y con su propia contraseña, con las copias encendidas.
    - Un script de medición del repositorio, que corre con el Node de la imagen dentro del ensayo, llena la base hasta unos 500 MB con entradas sintéticas del registro de acciones, que es lo que más crecerá.
    - Durante la medición base y durante tres copias enteras lanzadas con `tasks/launch` (instantánea, comprobación, restic y retención), pide a cadencia fija, sin esperar a la respuesta anterior, `/health` y una lectura con sesión cada 100 ms, y hace una escritura real por segundo: pedir un comprobante.
    - Anota la duración de cada fase y los percentiles.
    - El criterio del ensayo es que ninguna respuesta pase de 500 ms y que no haya errores. Es un valor para revisar el tiempo máximo del carril, no una garantía general.

### `apps/api` y la CI

- `apps/api` solo compone:
    - lee la configuración de las copias;
    - se la pasa a la plataforma;
    - añade la entrada `restore.mjs` al build y el script `restore` a la raíz.
- **El job `unit` de la CI** instala restic con apt antes de `pnpm test`.
- **El job `containers`:**
    - crea el fichero de la contraseña con permisos 600 y propietario uid 1000, el de `node` en el contenedor (el runner no es el 1000), y apunta `DOMUS_BACKUP_PASSWORD` a él;
    - tras arrancar, ejecuta `restore.mjs list` con `--entrypoint node`, que tiene que responder sin error aunque el repositorio esté vacío. Así cubre el bundle, el secret montado y su lectura.

### Migraciones

- La fila de las marcas llega en una migración generada con `pnpm db:generate`, como las de la 1d1.
- `/health` cambia de forma (`reason` pasa a `reasons`, y se añade `backups`). Las pruebas de la 1d1 sobre `/health` se ajustan a la forma nueva sin perder ningún caso.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba el comportamiento visible desde fuera:
    - lo que muestran la lista de tareas y `/health`;
    - lo que hay en el repositorio según restic;
    - lo que responden la puerta y las operaciones;
    - lo que se ve al volver a abrir la plataforma sobre el fichero.

    No comprueba sentencias SQL, nombres de columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla.

- **restic de verdad.** Las pruebas de copiar, retener, comprobar y restaurar usan el restic instalado. Si falta, la suite falla con `restic is required: brew install restic`, nunca se salta.
- **Costura 1: `createTestPlatform` sobre un fichero, con copias.** Recibe un repositorio y un fichero de contraseña temporales y, solo en la entrada de pruebas, la ruta del ejecutable de restic. Con el mando de la 1d1 se lanzan `backup` y `backup-check` y se prueba:
    - una copia guardada que restic lista, con host `domus` y su instante de captura;
    - el `init` de un destino vacío, y que un destino con contenido, uno ausente o una contraseña incorrecta fallan sin reintento y sin reinicializar;
    - la retención 7/4/3 sobre instantáneas de días distintos;
    - una instantánea estropeada que no se sube;
    - la carpeta de preparación vacía tras éxito, fallo, cancelación y caída;
    - `backup-check` bueno, fallido y con el repositorio aún inexistente;
    - las copias apagadas, sin tareas y con `backups: off`;
    - y, con ejecutables falsos de restic:
        - copia parcial (código 3), que no cuenta ni retiene;
        - bloqueo vigente (código 11), que se reintenta;
        - retención fallida, con la copia guardada y su motivo propio;
        - un proceso que ignora SIGTERM: el falso avisa a la prueba cuando ya instaló su manejador, la prueba avanza el reloj hasta el tiempo máximo y comprueba que el hijo muere y el carril se libera.
- **Las marcas y `/health`:**
    - `none-yet`, `saved`, `off`;
    - `backup-stale` a las 48 h desde la captura (justo antes y justo después) y con un primer intento fallido;
    - `backup-retention-failed` y `backup-check-failed`, y que desaparecen con un éxito;
    - varios motivos a la vez y en su orden;
    - que las marcas sobreviven a la purga de ejecuciones de 90 días y a cerrar y abrir la plataforma;
    - que la respuesta no lleva nada personal;
    - y los casos de la 1d1 con la forma nueva.
- **Costura 2: restaurar como función de la plataforma.** Cada prueba usa una ruta temporal propia, no `file: true`, porque `close()` borra la carpeta que creó `createTestPlatform`. El ciclo es: preparar datos, copiar, cerrar, restaurar y volver a abrir sobre la misma ruta. Se prueba:
    - que los datos de la copia vuelven y los posteriores no;
    - que los trabajos pendientes, en curso y atascados de la copia quedan descartados y no corren, mientras que el mismo estado sin restaurar, al reabrir, se recupera;
    - la próxima ejecución calculada desde la restauración y una tarea pausada que sigue pausada;
    - las cookies de un `browser()` de antes de la copia y de después, que dejan de servir por HTTP. Un navegador nuevo puede iniciar sesión, pero eso solo prueba que se puede entrar otra vez;
    - una confirmación pendiente y un comprobante guardados antes, cuyo uso ya no autoriza la operación;
    - una copia antigua, que recibe sus migraciones; una más nueva que el código y una migración que falla, que dejan la base activa intacta;
    - la base actual dañada y ausente;
    - la carpeta `before-restore` con el conjunto anterior, WAL con escrituras confirmadas incluido, que se abre y las conserva;
    - restaurar con la plataforma abierta, que se niega;
    - restaurar una copia de hace diez días, que deja `backup-stale` y no acredita el `check`;
    - una marca ilegible, que bloquea abrir y restaurar.
- **Costura 3: procesos hijos de prueba**, solo para lo que demuestra la muerte de un proceso. Los lanza la entrada de pruebas, que es la única que tiene puntos de corte:
    - **El arnés** es `startChild(task)` de `@domus/platform/testing`: lanza `testing/child.ts` con tsx, que es dependencia de desarrollo de `platform`. El hijo avisa por IPC cuando tiene su tarea, o manda su mensaje de error y termina, y la prueba lo recibe como rechazo. Sale solo si el proceso de la prueba desaparece. Las tareas de restaurar y sus puntos de corte (05 y 06) se añaden como variantes nuevas de `ChildTask`.
    - **El cerrojo:** un hijo con la plataforma abierta impide restaurar al padre; un hijo restaurando impide abrir; muerto el hijo con SIGKILL, el cerrojo queda libre; y el cerrojo se toma antes de abrir los datos.
    - **Los cortes:** un hijo restaura y se mata con SIGKILL al publicar la marca (antes y después del renombrado del temporal), tras retirar el WAL, tras el renombrado de la base y antes de borrar la marca. En cada caso el padre comprueba que abrir se niega o arranca con la base anterior entera, según el punto; que el conjunto conservado sigue intacto; y que retomar deja la restaurada saneada.
- Las pruebas cortan el proceso y comprueban la recuperación. La resistencia a un corte de luz descansa en el orden de las operaciones y los `fsync`, que se revisan en el código, no en una prueba.
- **Costura 4: la configuración de `api`**, en su prueba de configuración: apagadas, completas, a medias, con el interruptor, y una contraseña ilegible o vacía.
- **Reglas de dependencias:** `module-sdk` no expone las copias, restaurar ni el cerrojo, y un módulo que intente importarlos rompe la regla.
- **CI de contenedores:** el arranque real con el secret montado y `restore.mjs list`. La prueba de compose que ya comprueba las variables declaradas cubre también las nuevas.
- **Prior art:**
    - las pruebas del segundo plano de la 1d1 con el mando, los trabajos sintéticos y `/health`;
    - las de reapertura sobre fichero de la 1a, la 1b y la 1d1;
    - las de la puerta con `browser()`, comprobantes y confirmaciones de la 1c;
    - la prueba de configuración de `apps/api`;
    - y la prueba de compose de `tooling/scripts`.
- **En la Pi**, escrito en `despliegue.md`:
    - el uid 1000 escribe en `/srv/backups/domus` y lee el secreto;
    - la copia corre a su hora y `/health` pasa de `none-yet` a `saved`;
    - el ensayo restaura en `domus-restore`, entra una sesión nueva y se ven los datos;
    - la medición, con su resultado anotado.

## Fuera de alcance

- Los contenidos de archivos en la copia y restaurar base y archivos juntos: 1d3.
- El NAS como destino por SFTP: cuando haya NAS.
- Un aviso al admin cuando las copias se degradan: con los avisos (1d4) o las pantallas (fase 3).
- Las pantallas de copias y de restaurar: fase 3.
- Cómo afecta borrar datos privados a las copias: el punto abierto «Borrar datos privados», antes de admitir datos privados reales.
- Restaurar solo una parte (un módulo, una cuenta) o abandonar una restauración a medias con un comando: si se pide.
- Borrado seguro del soporte de la carpeta de preparación.

## Notas

- El ADR 0026, el ADR 0025, el README de arquitectura y el plan ya están al día en la rama del grilling. Al cerrar la 1d2 se actualizan:
    - `docs/plan.md`;
    - `docs/despliegue.md`: el repositorio y su contraseña, el `.env`, `/health`, restaurar, retomar, las carpetas `before-restore`, el ensayo, la medición y qué vuelve con la copia;
    - `docs/guia/`;
    - y el `AGENTS.md` raíz (restic, `pnpm restore`), dentro de su límite de líneas.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling:
    - las horas iniciales (05:00 y domingo 05:30);
    - los nombres de las variables;
    - los códigos de restic y cómo se tratan;
    - que una retención fallida no repita la copia;
    - que `backup-check` sin repositorio termine sin comprobar;
    - la forma de `/health`;
    - los nombres `domus.lock`, `restore.pending` y `before-restore-…`;
    - y la escritura de la medición.

    Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.

- La copia necesita en el NVMe un espacio libre del tamaño de la base, para la instantánea, además del repositorio.
- Al repartir las tareas se acordó que la fila de las marcas y la forma de `/health` nacen completas en la 01, que la 05 entrega el procedimiento entero de restaurar (retomar y la marca al abrir incluidos) y que la 06 lo demuestra con procesos cortados y casos de desastre.

## Tareas

| Tarea                                                         | Qué                                         | Bloqueada por |
| ------------------------------------------------------------- | ------------------------------------------- | ------------- |
| [01](issues/01-copia-diaria-de-punta-a-punta.md)              | Copia diaria de punta a punta               | —             |
| [02](issues/02-el-cerrojo-de-la-base.md)                      | El cerrojo de la base                       | —             |
| [03](issues/03-fallos-cancelacion-y-retencion-de-la-copia.md) | Fallos, cancelación y retención de la copia | 01            |
| [04](issues/04-backup-check-y-el-vigilante-completo.md)       | `backup-check` y el vigilante completo      | 03            |
| [05](issues/05-restaurar-de-punta-a-punta.md)                 | Restaurar de punta a punta, con retomar     | 01, 02, 03    |
| [06](issues/06-restaurar-ante-cortes-y-desastres.md)          | Restaurar ante cortes y desastres           | 05            |
| [07](issues/07-la-pi-y-el-cierre.md)                          | La Pi y el cierre de la 1d2                 | todas         |
