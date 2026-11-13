# Las copias de seguridad y restaurar

## Qué es

Una copia de seguridad es una foto de la base de datos, guardada aparte para poder volver a ella. Domus hace una cada noche, sin que nadie la pida. Si un día se borra algo por error, o una actualización estropea los datos, se puede volver a la copia de una noche anterior. Volver a una copia es restaurar.

Las copias se guardan cifradas: sin su contraseña nadie puede leerlas, tampoco quien se llevara el disco. Viven en el mismo disco de la Pi que los datos, así que protegen de un borrado o de un error, no de perder la Pi.

## Cómo funciona

Cada noche, a las cinco, Domus saca una foto de la base. La saca un programa aparte, de usar y tirar, que lee la base de una vez mientras api sigue atendiendo, así que nadie nota la copia. Otro programa comprueba que la foto está sana, y solo entonces se guarda. La hora que se apunta es la del principio de la copia, porque la foto tiene los datos de ese momento.

Las copias van a un almacén, el repositorio, que de cada copia solo guarda lo que cambió desde la anterior. Allí se quedan las de los últimos siete días, una por semana de las últimas cuatro y una por mes de los últimos tres. Las demás se borran solas. Cada domingo, media hora después, Domus lee el almacén entero para comprobar que ninguna copia se ha estropeado.

La página de salud de Domus dice si las copias están al día. Si la última copia buena tiene más de dos días, avisa. Si borrar las copias viejas o la comprobación del domingo fallan, avisa también, cada cosa por su lado, hasta que vuelvan a salir bien.

Restaurar se hace con un comando en la Pi, con api parada. Lo garantiza un cerrojo, una marca que un programa pone sobre la base mientras la usa: api lo tiene puesto mientras corre, y restaurar no empieza mientras alguien lo tenga. Primero prepara la copia aparte: la comprueba, le aplica las migraciones que le falten (los cambios de forma de la base que llegaron después) y la sanea. Solo después la pone en lugar de la base actual, que no se borra: se guarda en una carpeta al lado, por si hay que volver a ella.

Sanear quiere decir que nada de la copia se repite. Los trabajos que estaban pendientes o a medias en la copia se descartan, porque pudieron hacerse ya una vez. Se cierran todas las sesiones y se anula lo que alguien hubiera aprobado y aún no se hubiera hecho. Si Rocío cerró la sesión de un móvil perdido después de la copia, esa sesión no vuelve a valer.

Lo que sí vuelve es lo que había en la copia: los datos, las contraseñas, los permisos y lo que cada uno deja hacer a Kira. Si Paco cambió su contraseña después de la copia, vuelve la de antes.

Si se va la luz a mitad, al volver queda la base anterior entera o la restaurada saneada, nunca una vacía ni una mezcla. Hasta que se termine, api no arranca y avisa de que hay que volver a lanzar el comando, que acaba lo que quedó a medias.

Para estar seguros de que restaurar funciona antes de necesitarlo, en la Pi se ensaya en un segundo Domus, aparte del real, con sus propios datos y en otro puerto. Ahí restauramos la copia del Domus real, entramos con una sesión nueva y estaban los datos. También medimos la copia: con una base de 500 MB y tres copias seguidas, Domus respondió siempre en menos de medio segundo.

## Por qué es así

Todo lo de la casa está en un solo fichero, y un fichero se pierde entero. Con una copia cada noche, lo perdido es como mucho un día.

La copia la saca otro programa porque, hecha dentro de api, lo dejaba parado más de un segundo al terminar, y con una base grande eso se notaría al usar Domus. La primera medición en la Pi lo encontró.

Restaurar exige api parada porque cambiar la base debajo de un programa que la está usando la estropearía. Preguntar a api si está en marcha no basta: un programa colgado no contesta y sigue teniendo la base abierta. El cerrojo lo sabe aunque el programa no conteste.

La copia se prepara aparte para que, si algo falla al prepararla, la base de la casa siga como estaba. Y se sanea porque una copia es el pasado: repetir un trabajo que ya se hizo, o dar por buena una sesión cerrada después, sería peor que no restaurar.

Las copias viven en la misma Pi porque todavía no hay otro sitio en casa donde guardarlas. La casa acepta ese riesgo.

## En el código

- Las copias: `packages/platform/backups/` (`index.ts`, `snapshot.ts`, `restic.ts`, `marks.ts`, `staging.ts`). La instantánea la saca un proceso hijo con `VACUUM INTO`, y otro le pasa `quick_check`. restic, en la imagen de api, sube la instantánea con el host `domus`; la retención es `forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune`, y el domingo corre `check --read-data`.
- Las tareas: `backup`, cada día a las 05:00, y `backup-check`, cada domingo a las 05:30, en el carril de mantenimiento ([El trabajo en segundo plano](segundo-plano.md)). Sus marcas viven en `platform_backup_marks`.
- La salud: `/health` añade `backups` (`off`, `none-yet`, `none` o `saved`) y los motivos `backup-stale`, `backup-retention-failed` y `backup-check-failed`.
- La configuración: `DOMUS_BACKUP_REPOSITORY`, `DOMUS_BACKUP_PASSWORD_FILE` y `DOMUS_BACKUPS_OFF`, leídas en `apps/api/src/config.ts`. En la Pi, el repositorio es `/srv/backups/domus` y la contraseña, un secret de compose.
- El cerrojo: `packages/platform/lock.ts`, sobre `domus.lock` junto a la base.
- Restaurar: `packages/platform/backups/restore.ts` y `command.ts`. En la Pi, `docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs list` y `… /app/restore.mjs [--snapshot <id>]`; en desarrollo, `pnpm restore`. La base anterior queda en `before-restore-<instante>`, y la marca de una restauración a medias es `restore.pending`.
- El ensayo y la medición: `docker/ensayo/compose.yml` y `docker/ensayo/medir.mjs`.
- Los módulos no pueden usar nada de esto: una regla de dependencias lo impide.
- Decisiones: [ADR 0026](../architecture/adr/0026-copias-de-seguridad-y-restaurar.md) y [ADR 0027](../architecture/adr/0027-la-instantanea-en-un-proceso-hijo.md). Los pasos en la Pi, la medición con sus números y cómo devolver la base anterior: [`docs/despliegue.md`](../despliegue.md).
