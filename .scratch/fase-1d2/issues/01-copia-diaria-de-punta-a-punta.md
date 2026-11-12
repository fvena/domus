# 01. Copia diaria de punta a punta

Status: ready-for-agent
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

- [ ] Con el mando, a las 05:00 hora de Madrid corre `backup`, queda en el registro de ejecuciones como `ok` y restic lista una instantánea del host `domus` con la hora de captura.
- [ ] Un destino vacío se inicia en la primera copia.
- [ ] Una instantánea que no pasa `quick_check` no se sube y la ejecución falla sin reintentos.
- [ ] La carpeta de preparación queda vacía tras una copia buena.
- [ ] `/health` dice `backups: none-yet` antes de la primera copia, `saved` después y `off` con las copias apagadas, sin motivos de copias en ninguno; los casos de la 1d1 siguen cubiertos con la forma nueva, y la respuesta no lleva nada personal.
- [ ] Con las copias apagadas no se declara `backup`.
- [ ] La prueba de configuración de `api` cubre apagadas, completas, a medias, con el interruptor y una contraseña ilegible o vacía.
- [ ] Sin restic instalado, `pnpm test` falla con el mensaje claro.
- [ ] `architecture.test.ts` prueba que un módulo no puede importar las copias.
- [ ] La imagen de `api` trae restic, y el job `containers` arranca con el secret montado.
- [ ] `pnpm check` pasa.
