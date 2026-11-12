# 01. Copia diaria de punta a punta

Status: resolved
Blocked by: None (can start immediately)

Spec: [`../spec.md`](../spec.md), secciones «La tarea `backup`» (camino feliz), «Configuración», «Las marcas de las copias y el vigilante» (la forma completa), «`apps/api` y la CI» y «Migraciones». ADR 0026.

## Qué construir

El trazador de la 1d2: cada noche, con restic de verdad, Domus guarda una copia cifrada de la base y `/health` dice que hay una. Esta tarea fija los límites que usan las demás: la forma completa de las marcas y de `/health`, y la costura de copias en `createTestPlatform`.

Piezas que llegan con esta tarea:

- **La fila de las marcas** completa, en una migración generada con `pnpm db:generate`: copia guardada (captura e identificador), intento fallido, retención (instante y resultado), `check` (instante y resultado) y procedencia de una restauración. Esta tarea solo rellena la copia guardada; las demás añaden comportamiento sobre la misma fila sin cambiar su forma.
- **`/health` con la forma nueva**: `background` con `status`, `reasons` solo cuando está `degraded` (en su orden fijo, con los cinco motivos ya declarados) y `backups` (`off`, `none-yet`, `saved`). Esta tarea calcula `scheduler-silent`, `lane-stuck` y `backups`; los motivos de copias llegan con la 03 y la 04. Las pruebas de `/health` de la 1d1 se ajustan a la forma nueva sin perder casos. El segundo plano carga las marcas al arrancar y `/health` no lee la base.
- **Configuración** en `apps/api`: `DOMUS_BACKUP_REPOSITORY`, `DOMUS_BACKUP_PASSWORD_FILE` y `DOMUS_BACKUPS_OFF`, con sus reglas al arrancar. Con las copias apagadas, la tarea no se declara. La configuración entra en la plataforma por las opciones de abrirla, que es el punto donde se integra con la 02.
- **La tarea `backup`**, diaria a las 05:00, en el carril de mantenimiento: vaciar la preparación, `db.backup()` con su instante de captura, `quick_check` en un proceso hijo de Node, `restic backup` con `--host domus`, el instante de captura como hora de la instantánea y `--no-cache`, `init` si la carpeta del repositorio existe y está vacía, la marca de copia guardada y vaciar la preparación al terminar. Repositorio y contraseña van a restic por su entorno, nunca por argumentos.
- **Costura de pruebas**: `createTestPlatform` sobre un fichero acepta un repositorio y un fichero de contraseña temporales, y, solo en la entrada de pruebas, la ruta del ejecutable de restic (la usa la 03).
- **restic obligatorio en las pruebas**: si falta, la suite falla con `restic is required: brew install restic`.
- **Imagen y compose**: restic desde los paquetes de Debian trixie, con la construcción fallando si `restic version` no responde; la imagen fija las dos rutas; `api` monta `${DOMUS_BACKUPS:-domus-backups}:/backups` y el secret `backup-password` desde `${DOMUS_BACKUP_PASSWORD:?…}`.
- **CI**: el job `unit` instala restic con apt; el job `containers` crea el fichero de la contraseña con permisos 600 y propietario uid 1000 y apunta `DOMUS_BACKUP_PASSWORD` a él. La prueba de compose de `tooling/scripts` cubre las variables nuevas.
- **Regla de dependencias**: `module-sdk` no expone las copias, y un módulo que las importe rompe la regla.

## Criterios de aceptación

- [x] Con el mando, a las 05:00 hora de Madrid corre `backup`, queda en el registro de ejecuciones como `ok` y restic lista una instantánea del host `domus` con la hora de captura.
- [x] Un destino vacío se inicia en la primera copia.
- [x] Una instantánea que no pasa `quick_check` no se sube y la ejecución falla sin reintentos.
- [x] La carpeta de preparación queda vacía tras una copia buena.
- [x] `/health` dice `backups: none-yet` antes de la primera copia, `saved` después y `off` con las copias apagadas, sin motivos de copias en ninguno; los casos de la 1d1 siguen cubiertos con la forma nueva, y la respuesta no lleva nada personal.
- [x] Con las copias apagadas no se declara `backup`.
- [x] La prueba de configuración de `api` cubre apagadas, completas, a medias, con el interruptor y una contraseña ilegible o vacía.
- [x] Sin restic instalado, `pnpm test` falla con el mensaje claro.
- [x] `architecture.test.ts` prueba que un módulo no puede importar las copias.
- [x] La imagen de `api` trae restic, y el job `containers` arranca con el secret montado.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `67a7189`. Decisiones tomadas al implementar, también en la spec («Notas»): las copias viven en `packages/platform/backups/` con su propia regla, `backups-stay-in-platform`; la preparación es `backup-staging/` en la carpeta de datos y restic solo nombra `domus.db`, que queda en la raíz de cada instantánea (`/domus.db`); restic recibe un entorno mínimo con `TZ=UTC`; `DOMUS_BACKUPS_OFF` distinto de `1` no arranca; `/health` lista ya varios motivos de la 1d1 a la vez; el job `unit` corre en `node:22-trixie` porque el restic de Ubuntu 24.04 (0.16) no tiene el código `10`.
- Límites para las siguientes:
    - **Marcas** (`backups/marks.ts`): `createMarkStore` carga la fila al abrir la plataforma y guarda en memoria; hoy solo escribe `saved(capturedAt, snapshot)` con un `INSERT … ON CONFLICT`. La 03 y la 04 añaden aquí el intento fallido, la retención y el `check`; la 05, la procedencia. `BackupMarks` ya tiene todas las partes.
    - **Vigilante**: el segundo plano recibe `BackupsWatch` (`background/index.ts`): `tasks` y `health()`, que devuelve `{ state, reasons }`. Hoy `reasons` es siempre `[]` (`createBackups` en `backups/index.ts`); la 03 y la 04 lo calculan desde las marcas, y el segundo plano los ordena con `BACKGROUND_REASONS`.
    - **restic** (`backups/restic.ts`): `restic(executable, config).run(args, cwd?)` da `{ code, stdout }` y añade `--no-cache`; no pasa la señal ni mata al hijo todavía (03). `REPOSITORY_MISSING = 10`. Hoy todo código distinto de `0` es `PermanentJobError` con el paso y el código; la 03 separa el `3`, el `11` y el `10` con destino ausente o con contenido.
    - **Tarea**: `backupTask` vacía la preparación al empezar y en un `finally`; no comprueba la señal entre pasos ni aborta `db.backup()` (03). La retención y `restic unlock` faltan (03).
    - **Costura**: `createTestPlatform({ file, backups: { repository, passwordFile, restic? } })`; `restic` llega a la plataforma por `PlatformRuntime.restic`, solo desde la entrada de pruebas. Con `backups` y la base en memoria, abrir falla. Las pruebas de copias usan 30 s de tiempo máximo: restic deriva su clave en cada apertura.
    - **Configuración de `api`**: `readConfig(env).backups` es `{ repository, passwordFile } | undefined`; `main.ts` lo pasa a `createPlatform` y escribe `backups off` o `backups to <repositorio>`.
- La imagen se construyó en local con restic 0.18.0 de trixie, y un contenedor de solo lectura con el secret montado arrancó con `backups to /backups` y `/health` en `none-yet`; allí restic hizo `init` y `backup` con el entorno mínimo, y better-sqlite3 se resuelve en `/app/node_modules`. El job `containers` de la CI no se ha ejecutado: lo comprueba el PR.
