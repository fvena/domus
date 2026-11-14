# 07. Huérfanos y cortes al publicar y al borrar

Status: resolved
Blocked by: 06

Spec: [`../spec.md`](../spec.md), secciones «Publicar sin perder bytes» y «Limpieza» (los ficheros definitivos sin fila), y costuras 2 y 4 de «Decisiones de prueba». ADR 0028.

## Qué construir

Que un corte de luz a mitad de publicar o de borrar nunca deje un contenido presente sin su fichero, y que lo que deje a medias lo recoja la limpieza.

- **Huérfanos**: la limpieza borra, con el cerrojo de su hash, los ficheros definitivos sin fila con más de una hora. Publicar reutiliza un huérfano con ese hash en vez de escribir otro. Las dos cosas se excluyen.
- **Cortes**: variantes nuevas de `ChildTask` de `startChild` que matan el proceso al publicar (tras el renombrado y antes de las filas) y al borrar (tras marcar reclamado y tras borrar el fichero).

## Criterios de aceptación

- [x] Un fichero definitivo sin fila de más de una hora se borra; uno de menos, no.
- [x] Con el punto de intercalación de la publicación, una subida que reutiliza un huérfano y la limpieza que lo recoge no se pisan: o queda publicado con su fila, o la subida escribe el suyo después.
- [x] Muerto el proceso tras el renombrado, al reabrir no hay contenido presente sin fichero, el huérfano queda y lo recoge la limpieza o lo reutiliza una subida.
- [x] Muerto tras marcar reclamado y tras borrar el fichero, al reabrir el contenido sigue reclamado y la limpieza termina el borrado y elimina su fila.
- [x] En ningún punto de corte queda un contenido presente sin su fichero.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `ea77947`. Costuras para las tareas que siguen:
    - **Dónde está.** El paso de los ficheros sin fila es el cuarto barrido de `contentSweeps` (`packages/platform/files/cleanup.ts`), entre los reclamados y los temporales; recorre `FileStore.stored()` (`files/store.ts`), los nombres de todos los ficheros de las carpetas de dos caracteres de `contents/`. La publicación (`files/index.ts`) sincroniza el fichero sin fila que reutiliza y su carpeta antes de seguir. `syncFolder` se llama ahora `syncToDisk` y vale para ficheros y carpetas.
    - **Para la 09.** Un fichero de `contents/` sin fila de su nombre se borra cuando su fecha de modificación tiene más de una hora frente al instante de la pasada. Lo busca por `contentPath(nombre)`, así que un resto de instalar solo se recoge si su nombre empieza por los dos caracteres de su carpeta (por ejemplo `<hash>.<algo>`); con otro nombre se quedaría para siempre. restic restaura la fecha de modificación de la copia, así que un contenido instalado antes de un corte suele tener ya más de una hora. Las pruebas que necesiten un fichero «viejo» le ponen la fecha con `utimesSync`, porque el reloj de las pruebas empieza en `TEST_START` y la fecha real del fichero queda en su futuro.
    - **Cortes.** `ChildTask` gana `{ hold: "publish", dataDirectory, account, session, content }` (el contenido en base64; sube con un contexto sellado y se queda en `published`, con `Date.now` como reloj) y `{ hold: "delete", dataDirectory, now, at: "claimed" | "removed" }`. Los dos abren la plataforma sin módulos con `openUntil` de `testing/child.ts`, que retiene para siempre el punto de intercalación pedido; la 09 puede seguir el mismo patrón. Pruebas en `packages/test-utils/files-cuts.test.ts`, que preparan la base y la carpeta `files` con `createTestPlatform({ file, files })` en la misma carpeta de datos, la cierran, matan al hijo y la vuelven a abrir.
    - **Puntos de intercalación.** `InterleavePoint` gana `removed`: el fichero de un contenido reclamado ya borrado y su carpeta sincronizada, antes de borrar su fila, en los dos barridos que terminan un borrado.
    - Decisiones tomadas sin preguntar, también en la spec («Publicar sin perder bytes» y «Limpieza»): la edad de un fichero sin fila es su fecha de modificación frente al instante del comienzo de la pasada, y con una hora justa se queda; el cerrojo de su hash cubre la comprobación de fila y edad, el borrado y la sincronización de la carpeta; un lote cuenta solo los que tienen edad para borrarse, para que muchos jóvenes no repitan el paso sin fin; reutilizar un fichero sin fila lo sincroniza antes, porque un proceso muerto entre el renombrado y la sincronización pudo dejarlo solo en memoria (sin prueba: no se ve sin cortar la luz); el hijo de `delete` corre el trabajo de `cleanupTask` directamente y no el segundo plano, para no dejar trabajos en `platform_jobs` que la plataforma reabierta retome por su cuenta antes de lo que comprueba la prueba. La carrera de la publicación en el otro orden (la limpieza gana el cerrojo) se prueba con la subida aún recibiendo bytes, sin un punto de intercalación nuevo en el barrido.
