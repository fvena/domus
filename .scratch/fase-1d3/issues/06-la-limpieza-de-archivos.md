# 06. La limpieza de archivos

Status: resolved
Blocked by: 03, 04

Spec: [`../spec.md`](../spec.md), sección «Limpieza» y costura 2 de «Decisiones de prueba». ADR 0028.

## Qué construir

Que la limpieza de cada noche recoja lo que ya nada protege, sin poder borrar un contenido que algo acaba de vincular ni cortar una descarga ya empezada.

- **Pasos nuevos de `cleanup`**, en lotes con su propia transacción: archivos preparados caducados, consumidos o de sesiones que ya no existen; referencias soltadas cuya entrada caducó o ya no se puede deshacer; contenidos sin protección; contenidos reclamados de una pasada cortada, aunque su fichero ya no exista; y temporales de `incoming/` que no estén en una reserva viva.
- **Borrar un contenido**: con el cerrojo de su hash, una transacción comprueba que nada lo protege y lo marca reclamado; después se borra el fichero y se sincroniza su carpeta; por último se borra su fila. «Presente» es disponible y no reclamado, y `attach`, `reattach` y crear un archivo preparado lo comprueban en su transacción.
- **Puntos de intercalación**, solo en la entrada de pruebas: en la limpieza, entre marcar reclamado y borrar el fichero; en la descarga, con el descriptor abierto y antes de transmitir.

## Criterios de aceptación

- [x] Con `background.runDue()`, la limpieza borra el contenido de un archivo preparado caducado y nunca usado, y el de una referencia soltada cuya entrada caducó.
- [x] No borra un contenido con una referencia viva, una soltada aún deshacible o un archivo preparado vigente.
- [x] Un temporal de una subida en curso sobrevive a la limpieza; uno abandonado no.
- [x] La carrera con `attach`, `reattach` y crear un archivo preparado, en sus dos órdenes: o la escritura gana y el contenido sigue, o la limpieza gana y la escritura falla sin vincular nada a un contenido que se borra.
- [x] Con el descriptor de una descarga abierto, soltar la referencia y limpiar borran el fichero, y la descarga termina con el hash correcto.
- [x] Una subida de un hash reclamado responde `CONTENT_BUSY` con `Retry-After: 1` y no deja temporal.
- [x] Un contenido reclamado que ya perdió su fichero lo retoma la siguiente limpieza y elimina su fila.
- [x] Limpiar dos veces no cambia nada.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `6cbf0e2`. Costuras para las tareas que siguen:
    - **Dónde está.** Los dos pasos de filas (archivos preparados y referencias soltadas) son sentencias en `STEPS` de `packages/platform/background/cleanup.ts`. Los pasos que tocan el disco son `CleanupSweep` (`(now, batchSize) => Promise<number>`, lo que encontró; se repite mientras encuentre un lote entero) y viven en `packages/platform/files/cleanup.ts` (`contentSweeps`), dentro de `createFiles`, que comparte con ellos el cerrojo del hash (`locks`) y las reservas; salen como `Files.sweeps` y llegan a `cleanupTask` por `createBackground({ sweeps })`. Por eso `openPlatform` crea ahora `files` (y `view`) antes del segundo plano. Orden: preparados, soltadas, contenidos sin nada que los apunte, reclamados, temporales.
    - **Para la 07, los tres pasos de borrar** (primer barrido de `contentSweeps`): marcar reclamado es `locks.hold(hash, ...)` con la transacción de `claim` (devuelve si ganó); al soltar el cerrojo salta `claimed?.()` (el punto `claimed`); después `finish(hash)`, que hace `rmSync` del fichero y `syncFolder` de su carpeta (fichero borrado) y por último la transacción de `forget`, que borra la fila solo si sigue reclamada. Los cortes de `startChild` van tras `claim` (donde está `claimed?.()`) y entre `syncFolder` y `forget` dentro de `finish`. El segundo barrido (reclamados de una pasada cortada) llama a `finish` sin cerrojo; los huérfanos de más de una hora irían como un barrido nuevo entre los reclamados y los temporales, con `locks.hold`.
    - **Puntos de intercalación.** `InterleavePoint` gana `claimed` (contenido marcado, cerrojo suelto, fichero aún en su sitio) y `opened` (en la ruta de descarga de `http/index.ts`, por `Files.opened()`, con el descriptor abierto y la transacción cerrada). Una promesa rechazada falla el trabajo en ese punto y cierra el descriptor de la descarga: las pruebas lo usan para simular un corte sin matar el proceso. `InterleavePoint` se exporta ahora desde `@domus/test-utils`.
    - **Pruebas.** `modules/probe/tests/files-cleanup.test.ts`, con `holdAt(point, skip)` para retener un punto. Una limpieza fallida se reintenta a los 30 s, y la prueba del reclamado sin fichero usa ese reintento como «la siguiente limpieza».
    - Decisiones tomadas sin preguntar, también en la spec («Limpieza»): «nada lo protege» se comprueba como «nada lo apunta» (ni archivo preparado ni referencia de ninguna clase), porque los pasos de filas de la misma pasada ya quitaron los que no protegen y así nunca queda una clave ajena a un contenido borrado; el cerrojo cubre solo la transacción de marcar, y borrar fichero y fila van sin él, apartando la publicación con `CONTENT_BUSY`, que es lo que hace visible el reclamado durante el borrado; un preparado es de una sesión que ya no existe si no hay sesión con su id y su cuenta, como en `attach`; `attach` y `reattach` sobre un contenido reclamado responden «no encontrado», una guarda que con la regla anterior no se alcanza (un contenido reclamado no tiene filas que lo apunten), así que su carrera «gana la limpieza» falla por la regla de siempre (el preparado ya se borró, la entrada ya caducó); la carpeta de dos caracteres no se borra al vaciarse.
