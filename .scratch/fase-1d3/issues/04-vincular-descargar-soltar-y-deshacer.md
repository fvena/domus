# 04. Vincular, descargar, soltar y deshacer

Status: ready-for-agent
Blocked by: 02

Spec: [`../spec.md`](../spec.md), secciones «`ctx.files` y `fileRef()`», «Deshacer con referencias soltadas», «Descargar», las filas de descargar sin confirmación y las de `ctx.files` en «Errores de las rutas de archivos», y «`probe`». ADR 0028.

## Qué construir

Una persona vincula su foto a una nota, la ve en la lectura, la descarga, la quita, borra la nota y lo deshace todo, y la foto vuelve. Es el SDK completo de una vez, para que `attachFile` nazca con su inversa y no haya contratos provisionales.

- **`ctx.files`**: `of` (filtra con `visible()`), `attach` (consume el archivo preparado), `detach` y `reattach`, solo sobre tablas del módulo. Las tres que escriben exigen que el registro exista y entre en `editable(table)`, anotan el registro como tocado con el mismo identificador que un cambio de columna, y van en la transacción de la escritura.
- **Referencias soltadas**: en una escritura deshacible, `detach` deja la referencia soltada y ligada a su entrada; en una irreversible, la borra. `reattach` solo dentro del deshacer de la entrada que la soltó. La protección consulta el `expiresAt` fijado y si la entrada sigue sin deshacer.
- **`fileRef()`** en `@domus/module-sdk/contracts`, con su marca en los metadatos de Zod, y el recorrido de la salida que encuentra las posiciones marcadas (en arrays, opcionales y anulables).
- **Descargar**: `POST /api/files/download` con `{ action, input, file }`, por el camino único de las acciones; `openSync` dentro de la transacción tras comprobar que `file` está en una posición marcada, cerrado si la transacción se revierte; los bytes después, con sus cabeceras. Sin confirmación todavía: la 05.
- **`probe`**: `files` en `getNote`, `listNotes` y `searchNotes`; `attachFile`, `detachFile` y `restoreFile`; `deleteNote` suelta los archivos y `restoreNote` los vuelve a vincular.

## Criterios de aceptación

- [ ] Una foto subida se vincula a una nota con `attachFile`, sale en `getNote` como `fileRef()` y se descarga con el mismo hash y las cabeceras de la spec (`no-store`, `nosniff`, tipo detectado, `filename*`).
- [ ] Una nota pública ajena no admite archivos (`FORBIDDEN`), una privada ajena responde `NOT_FOUND` al vincular y al descargar, y un id que no salió de la lectura responde `NOT_FOUND`.
- [ ] Los errores de `ctx.files` de la tabla responden su código, también un archivo preparado caducado, consumido o de otra sesión.
- [ ] Un fallo de la escritura después de `attach`, `detach` o `reattach` revierte la nota, la referencia, el consumo del archivo preparado y la protección, y el archivo preparado sirve para reintentar.
- [ ] Deshacer `attachFile`, deshacer `detachFile` y deshacer `deleteNote` funcionan, y la foto vuelve a descargarse.
- [ ] La cadena soltar, deshacer, rehacer y deshacer el rehacer funciona, y cada suelta queda ligada a su entrada.
- [ ] Deshacer choca con un cambio posterior en los archivos de la nota, igual que con uno en su texto.
- [ ] `restoreFile` llamado directamente, y `restoreNote` con ids de archivos, no recuperan nada (`NOT_FOUND`).
- [ ] Cambiar la retención no cambia la protección de una referencia ya soltada.
- [ ] Una descarga cuya lectura falla no deja ningún descriptor abierto.
- [ ] `pnpm check` pasa.
