# 04. Vincular, descargar, soltar y deshacer

Status: resolved
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

- [x] Una foto subida se vincula a una nota con `attachFile`, sale en `getNote` como `fileRef()` y se descarga con el mismo hash y las cabeceras de la spec (`no-store`, `nosniff`, tipo detectado, `filename*`).
- [x] Una nota pública ajena no admite archivos (`FORBIDDEN`), una privada ajena responde `NOT_FOUND` al vincular y al descargar, y un id que no salió de la lectura responde `NOT_FOUND`.
- [x] Los errores de `ctx.files` de la tabla responden su código, también un archivo preparado caducado, consumido o de otra sesión.
- [x] Un fallo de la escritura después de `attach`, `detach` o `reattach` revierte la nota, la referencia, el consumo del archivo preparado y la protección, y el archivo preparado sirve para reintentar.
- [x] Deshacer `attachFile`, deshacer `detachFile` y deshacer `deleteNote` funcionan, y la foto vuelve a descargarse.
- [x] La cadena soltar, deshacer, rehacer y deshacer el rehacer funciona, y cada suelta queda ligada a su entrada.
- [x] Deshacer choca con un cambio posterior en los archivos de la nota, igual que con uno en su texto.
- [x] `restoreFile` llamado directamente, y `restoreNote` con ids de archivos, no recuperan nada (`NOT_FOUND`).
- [x] Cambiar la retención no cambia la protección de una referencia ya soltada.
- [x] Una descarga cuya lectura falla no deja ningún descriptor abierto.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `1a30ad7`. Costuras para las tareas que siguen:
    - **Dónde está.** `packages/platform/files/references.ts` (`createReferences`: el `ctx.files` de cada ejecución, `linkReleased` y `live`, solo filas, también en memoria), `files/marked.ts` (`markedFiles(schema, valor)`, el recorrido de `fileRef()`), `Files.open(hash)` en `files/index.ts` (el descriptor, con `stream()` y `close()`, y `OpenedContent` en `store.ts`), `actions.download(...)` en `actions/index.ts` y la ruta en `http/index.ts`. `fileRef()`, `isFileRef()` y el tipo `FileRef` en `@domus/module-sdk/contracts`; `ModuleFiles` y `RecordOf` en `@domus/module-sdk`.
    - **Descriptor de la ejecución.** `RegisteredAction.execute(context, input, now, write?)`; `perform` crea un `WriteRun` (`undoable`, `undoes`, `touched`, `released`), suma `touched` antes de `checkOutcome` y liga `released` tras `actionLog.record`. Los rechazos de `ctx.files` son `FilesRefusal`, que `runHandler` deja pasar como `HandlerForbidden`.
    - **Para la 05.** La descarga autoriza con `authorizeRead` fuera de la transacción (hoy una lectura que pide confirmación guarda una pendiente de lectura corriente: la 05 la cambia por la de tipo descarga) y, dentro de `connection.transaction`, `answerRead`, `markedFiles`, `references.live` y `openContent`; si algo falla después de abrir, el `catch` cierra el descriptor. Ahí entra consumir la pendiente. El cuerpo `{ confirmation }` responde hoy `BAD_REQUEST` en `downloadRequest` de la puerta.
    - **Para la 06.** El punto de intercalación de la descarga va en la ruta de `http/index.ts`, tras `actions.download(...)` y antes de `new Response(found.content.stream(), ...)`: ahí el descriptor está abierto y la transacción ya cerró (el punto es asíncrono y la transacción no). `attach` y `reattach` aún no comprueban que el contenido esté presente y no reclamado: lo añade la 06 en `references.ts`, con su error. Un `detach` irreversible borra la fila en el acto, sin prueba propia porque `probe` no tiene ninguno: la limpieza de la 06 lo hará visible.
    - **Para la 08.** Una referencia soltada protegida es la de `released_by` cuya entrada sigue sin `undone_by` y con `expires_at` posterior al instante; la retención no cuenta.
    - **Pruebas.** `modules/probe/tests/files.test.ts`; `test.contextOf(browser)` en `test-utils` (lee la cookie `better-auth.session_token` y busca la sesión con `sessionOfToken` de la entrada de pruebas). Los fallos después de `attach`, `detach` o `reattach` se provocan envolviendo el manejador de `probe` con `vi.spyOn(...).mockImplementationOnce` antes de abrir la plataforma. Las pruebas de archivos con `probe` pasan `freeSpace` para no depender del disco libre de la máquina. Pedida por la 03: consumir con `attach` devuelve el hueco del límite de la sesión, también probada ahí.
    - Decisiones tomadas sin preguntar, también en la spec («`ctx.files` y `fileRef()`», «Descargar», «`probe`» y la tabla de errores): `detach` y `reattach` devuelven el `fileRef()`; `attach` en una sesión que ya terminó responde «no encontrado» y caduca en el instante exacto de `expiresAt`, la frontera de la 03; primero se comprueba el registro y después el archivo preparado; las lecturas siguen sin transacción y solo la descarga abre una, con la autorización fuera para que una pendiente sobreviva; el cuerpo de la descarga admite solo `action`, `input` y `file`, y el comprobante va en `step-up-proof`; la respuesta lleva `Content-Length` y el tipo sin `charset`; una posición marcada con un id que no es referencia viva del módulo se descubre al descargar y es `INTERNAL_SERVER_ERROR`; el recorrido no entra en uniones; las escrituras de `probe` siguen respondiendo la nota sin `files` y solo sus lecturas los llevan (las pruebas que comparaban lecturas ganan `files: []`); la inversa de `deleteNote` lleva siempre `files`, y en `restoreNote` es opcional; `deleteNote` suelta tras el bloqueo por comentarios.
