# 08. La copia lleva los contenidos

Status: resolved
Blocked by: 04

Spec: [`../spec.md`](../spec.md), sección «Copia» y costura 3 de «Decisiones de prueba». ADR 0028 y ADR 0026.

## Qué construir

Que la copia de cada noche suba, en la misma instantánea de restic que la base, los contenidos de archivo que esa base necesita, y ninguno más.

- **La lista**: tras la instantánea y su `quick_check`, el mismo proceso hijo saca de la instantánea los contenidos de las referencias vivas y de las soltadas cuya entrada seguía deshacible en el instante de captura. Sin archivos preparados.
- **Los enlaces**: cada contenido de la lista se enlaza con un enlace duro en la preparación, bajo `files/`. Si falta uno, la copia falla sin reintento, con su motivo, y no se guarda como buena.
- **restic** sube `domus.db` y los enlaces con `--files-from-verbatim`. La preparación, enlaces incluidos, se vacía tras éxito, error, cancelación y caída.

## Criterios de aceptación

- [x] Con restic real, la instantánea tiene `domus.db` y los contenidos de una referencia viva y de una soltada aún deshacible, con rutas que no dependen de la carpeta de datos.
- [x] No tiene el contenido de un archivo preparado ni el de una referencia soltada ya caducada en la captura, aunque caduque mientras restic trabaja.
- [x] Un contenido necesario que falta en disco hace fallar la copia sin reintento, sin marca de copia guardada y con `/health` como en una copia fallida.
- [x] La preparación queda vacía, sin enlaces, tras una copia buena, una fallida y una cancelada.
- [x] Las pruebas de la copia de la 1d2 siguen pasando.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `aba187a`. Costuras para las tareas que siguen:
    - **Rutas en la instantánea (para la 09).** La base sigue en `/domus.db` y cada contenido va en `/files/contents/<dos primeros caracteres del hash>/<hash>`: la carpeta `files/` de la instantánea tiene la misma forma que la carpeta `files` del almacén, así que `createFileStore(join(<preparación>, "files")).contentPath(hash)` da su sitio en la preparación de restaurar con `--include /files`. Nada más entra: la lista de rutas es el fichero `paths` de la preparación, que no se sube.
    - **Cómo se calcula la lista.** `NEEDED_CONTENTS` de `packages/platform/files/needed.ts`, con un instante como único parámetro: los hashes, sin repetir y ordenados, de las referencias vivas y de las soltadas cuya entrada sigue sin `undone_by` y con `expires_at` posterior a ese instante; nunca los archivos preparados. La copia la corre sobre la instantánea, en el hijo de `quick_check` (`checkSnapshot` de `backups/snapshot.ts`), con el instante de captura. Restaurar puede correrla sobre la copia saneada con su propio instante. `CONTENT_HASH` (64 caracteres hexadecimales en minúscula) valida cada hash antes de usarlo como ruta.
    - **Protocolo del hijo.** Primera línea, lo que dice `quick_check`; si es `ok`, un hash por línea. El programa sigue teniendo el literal `quick_check`, del que depende `fakeNode`.
    - **Pruebas con restic y archivos.** En `modules/probe/tests/backup-files.test.ts`; `probe` gana un `globalSetup` de restic (`tests/restic-setup.ts`) y `@domus/test-utils` exporta `requireRestic`, `fakeNode` y el tipo `TestBackups`. Ahí hay helpers que la 09 puede copiar: `backupTarget`, `snapshotFiles` (`restic ls latest`), `staged` y un restic falso que se queda en `backup`.
    - Decisiones tomadas sin preguntar, también en la spec («Copia»): las rutas de arriba; un hash inválido en la lista hace fallar la copia sin reintento; un contenido que falta falla con `a file content the backup needs is missing`, sin el hash en el mensaje; otro error al enlazar (como una carpeta `files` en otro volumen, `EXDEV`) no es permanente y se reintenta como cualquier error. `createBackups` recibe `filesDirectory`, la misma carpeta que usa la plataforma (la opción o `files` junto a la base).
