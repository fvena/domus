# 07. La Pi y el cierre de la 1d2

Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06

Spec: [`../spec.md`](../spec.md), secciones «El ensayo y la medición en la Pi», «Decisiones de prueba» («En la Pi») y «Notas». ADR 0026.

## Qué construir

La 1d2 publicada en la Pi, ensayada y cerrada en los documentos.

- **El ensayo**: un fichero de compose del repositorio para el proyecto `domus-restore`, con su propio volumen de datos, `127.0.0.1:3001` sin Tailscale y `DOMUS_BACKUPS_OFF=1` en su `api`. El comando `restore` del ensayo monta el repositorio de producción con escritura y restaura con el bloqueo compartido de restic y `--retry-lock 30m`; la `api` del ensayo nunca lo monta.
- **La medición**: el ensayo, con su propio repositorio desechable y su propia contraseña y las copias encendidas, y un script de medición del repositorio que corre con el Node de la imagen. Llena la base hasta unos 500 MB con entradas sintéticas del registro de acciones; durante una medición base y tres copias enteras lanzadas con `tasks/launch`, pide a cadencia fija, sin esperar a la respuesta anterior, `/health` y una lectura con sesión cada 100 ms, y una escritura real por segundo: pedir un comprobante. Anota la duración de cada fase y los percentiles. Si aparece un límite de frecuencia en esa escritura, se cambia en la spec antes de seguir.
- **En la Pi**: el directorio `/srv/backups/domus` y el fichero de la contraseña (permisos 600, legible por el uid 1000, guardado también en el gestor de contraseñas), el `.env` con `DOMUS_BACKUPS` y `DOMUS_BACKUP_PASSWORD`, la copia a su hora y el ensayo.
- **`docs/despliegue.md`**, escrito a medida que se ejecutan los comandos: el repositorio y su contraseña, el `.env`, el estado de copias de `/health`, listar y restaurar, retomar tras un corte, las carpetas `before-restore` (cómo devolver una y cuándo borrarla), qué vuelve con la copia (contraseñas, permisos, delegación, ajustes de las tareas) y qué se pierde (claves de idempotencia posteriores), el ensayo y la medición con su resultado. Sustituye «no borres el volumen».
- **`docs/plan.md`** marca la 1d2 como hecha, con la fecha.
- **`docs/guia/`** recoge lo construido, según `docs/AGENTS.md`, revisado con la skill `humanizer`.
- **El `AGENTS.md` raíz**: restic como requisito junto a gitleaks y `pnpm restore` en la tabla, dentro de su límite de líneas.
- **Arquitectura, glosario y ADR 0026**: se corrigen solo si la implementación los contradijo; la spec, si la medición cambia algún valor inicial.

Los pasos que piden contraseña o `sudo` los hace la persona, en español y paso a paso (`docs/agents/workflow.md`).

## Criterios de aceptación

- [x] En la Pi, el uid 1000 escribe en `/srv/backups/domus` y lee el secreto.
- [x] La copia corre a su hora en la Pi o, para no esperar, la lanza el admin a mano; `/health` pasa de `none-yet` a `saved` y la lista de tareas muestra el resultado.
- [x] El ensayo restaura en `domus-restore` la última copia de producción sin chocar con su retención, entra una sesión nueva y se ven los datos.
- [x] La medición está hecha y anotada: ninguna respuesta pasa de 500 ms ni da error, o la spec recoge qué se cambia.
- [x] `despliegue.md`, `plan.md`, la guía y el `AGENTS.md` raíz están al día.

## Comments

- La primera medición en la Pi, con una base de unos 500 MB, encontró un parón de 1,1 a 1,4 s en cada copia: todas las peticiones esperaban a la vez, sin errores. Al terminar, `db.backup()` forzaba a disco el fichero de destino de una vez, en el único hilo de `api`. El ADR 0027 saca la instantánea a un proceso hijo con su propia conexión, que toma el cerrojo compartido y hace `VACUUM INTO`; el instante de captura pasa a ser el de antes de empezar la copia. Hecho en `4871529`. Una copia que el hijo no termina bien falla ahora sin reintentos (`the snapshot could not be taken`), y las pruebas detienen el hijo en su copia con `fakeNode`. Falta repetir la medición, con el mismo umbral de 500 ms y las tres copias enteras.
- Hecho en la Pi el 2026-11-13. El directorio `/srv/backups/domus` (700) y el fichero de la contraseña (600) son del uid 1000, que es `fvena` en la Pi y `node` en el contenedor; la contraseña está también en el gestor de contraseñas de casa. El `.env` lleva `DOMUS_BACKUPS` y `DOMUS_BACKUP_PASSWORD`, y sin la segunda `docker compose up` no arranca. Dentro de `api`: `1000`, `backups-writable`, `secret-readable` y restic 0.18.0 arm64. El log dice `backups to /backups`, y `platform_tasks` tiene `cleanup` a las 04:30, `backup` a las 05:00 y `backup-check` el domingo a las 05:30.
- La primera copia la lanzó Paco a mano con `tasks/launch`: acabó `ok` en unos 4 s, `/health` pasó de `none-yet` a `saved`, la carpeta de preparación quedó vacía y la fila de las marcas tiene la captura, la instantánea y `retention_result: ok`. `restic snapshots` lista `80a41abd`, de 212 KiB, con host `domus`.
- El ensayo (`docker/ensayo/compose.yml`, proyecto `domus-restore`) restauró `80a41abd` del repositorio de producción. Su `api` arrancó con `0 migrations applied` y `backups off`; el trabajo `backup` que corría dentro de la copia quedó `cancelled` con `discarded by restore`, con 0 sesiones y las mismas 3 cuentas y 5 entradas del registro que el real. Una sesión nueva entró (`200`), leyó las 5 entradas y vio solo su sesión, y la cookie del Domus real dio `401` en el ensayo.
- La medición, sobre unos 500 MB sintéticos (353 000 entradas, 501 MB), con un minuto de base y tres copias enteras. Con `db.backup()` dentro de `api` no pasó: máximo 1410 ms, 0 errores. Medido aparte, del último paso de `db.backup` al final pasaban 1386 ms en el único hilo de `api`; de ahí el ADR 0027. Con la instantánea en un proceso hijo con `VACUUM INTO` (imagen de la rama, con `DOMUS_ENSAYO_IMAGE`) pasó: copias de 10,3, 5,1 y 5,0 s, máximo 162 ms (una escritura, cuya base ya llega a 137 ms porque verifica la contraseña) y 0 errores. El umbral de 500 ms no cambia y la spec tampoco. Los números completos están en `docs/despliegue.md` («Medir la copia»).
- `docs/despliegue.md` sustituye «no borres el volumen» por «Las copias de seguridad», «Restaurar» (también retomar, las carpetas `before-restore` y qué vuelve y qué se pierde) y «Ensayar una restauración» con la medición. La guía gana `copias.md` y cambian `README.md`, `segundo-plano.md`, `la-pi.md`, `seguridad.md`, `datos.md` y `arquitectura.md`, revisados con `humanizer`. `docs/plan.md` marca la 1d2 como hecha y el `AGENTS.md` raíz añade `pnpm restore`.
- Falta ver, una vez fusionada y desplegada esta rama, la copia nocturna de las 05:00 y el `backup-check` del domingo a las 05:30 en la Pi: es lo único que no está probado allí. Hasta entonces, la `api` real sigue con la instantánea de `db.backup()`; la del proceso hijo le llega con el despliegue.
- Las órdenes de emergencia de «Restaurar» en `despliegue.md`, escritas desde el código, se ejecutaron el 2026-11-13 sobre un ensayo desechable en la Pi (las mismas órdenes, con `-f docker/ensayo/compose.yml`), no sobre el Domus real. Dos restauraciones seguidas dejaron dos carpetas `before-restore`, la segunda con una fila puesta a mano. El bloque de devolverla dejó `apartada-…` y la base con esa fila (de 0 a 1 filas), y la `api` arrancó sana. Con `restore.pending` ilegible, la `api` no arrancó y restaurar respondió `error: restore marker unreadable`; tras `run --entrypoint rm api /data/restore.pending`, arrancó sana. `run --entrypoint ls api -l /data` lista la carpeta y `exec api rm -r /data/before-restore-…` borra solo la indicada. El ensayo se desmontó después con `down -v`.
