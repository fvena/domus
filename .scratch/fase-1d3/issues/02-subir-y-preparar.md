# 02. Subir y preparar

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Almacén de contenidos», «Subir» (sin los límites), «Errores de las rutas de archivos» (las filas de subir que no son de límites), «Publicar sin perder bytes», «Archivo preparado» y «Reglas y documentación». ADR 0028.

## Qué construir

El trazador de la 1d3: una persona con sesión sube una foto por `POST /api/files` y recibe un archivo preparado, con sus bytes publicados en el almacén sin que un error pueda dejar una fila sin fichero. Esta tarea fija los límites que usan las demás: las tres tablas completas, el almacén y la costura de la carpeta de contenidos.

- **Las tres tablas** completas, en una migración generada con `pnpm db:generate`: contenidos de archivo, archivos preparados y referencias de archivo (con su dueño y la entrada que la soltó). Esta tarea solo escribe contenidos y archivos preparados; las referencias llegan con la 04 sin cambiar la forma.
- **El almacén**: `files/contents/` repartido por hash y `files/incoming/`, en la carpeta de datos. `api` vacía `incoming/` al arrancar, antes de admitir peticiones.
- **La ruta**, en Hono: sesión obligatoria; quién puede subir lo decide `platform/authorization` (persona sí, `device` no); `Content-Length` de 1 a 25 MB; el nombre con la función de la 01; el tipo y el SHA-256 calculados mientras llegan los bytes; la respuesta `{ id, name, type, size, expiresAt }` y los errores de la tabla que no son de límites (`UNAUTHORIZED`, `FORBIDDEN`, `LENGTH_REQUIRED`, `FILE_EMPTY`, `FILE_TOO_LARGE` por lo declarado, `INVALID_FILE_NAME`, `FILE_TYPE_NOT_ALLOWED`). `CONTENT_BUSY` se programa aquí, pero se prueba en la 06, cuando la limpieza ya reclama contenidos.
- **Publicar**: temporal sincronizado, cerrojo en memoria por hash, y con él reutilizar un contenido presente, responder `CONTENT_BUSY` a uno reclamado, o renombrar y sincronizar fichero y carpetas nuevas; después, una transacción que vuelve a comprobar la sesión y crea las filas. El cerrojo se suelta también tras un error o una cancelación.
- **El archivo preparado**: 24 h desde que termina la preparación, de su sesión, sin consumir. Consumirlo llega con la 04.
- **Costura**: `createTestPlatform` gana la carpeta de contenidos con el patrón de `file` (la del arnés se borra al cerrar, después de cancelar subidas y cerrar descriptores; la de la prueba se conserva) y, solo en la entrada de pruebas, el punto de intercalación de la publicación entre el renombrado y sus filas.
- **Regla de dependencias**: `module-sdk` y los módulos no alcanzan el almacén, la publicación ni las rutas de archivos.

## Criterios de aceptación

- [ ] Por `browser()`, una sesión de persona sube un JPEG y recibe su archivo preparado; el fichero está en el almacén con su hash como nombre y `incoming/` queda vacía.
- [ ] Sin sesión responde `UNAUTHORIZED`, y con la cuenta `device`, `FORBIDDEN`, sin dejar nada en disco.
- [ ] Cada error de subir de esta tarea responde su código y su estado de la tabla, sin restos en `incoming/`.
- [ ] Dos subidas del mismo contenido, en secuencia, comparten un solo fichero y dan dos archivos preparados.
- [ ] Con el punto de intercalación, dos subidas simultáneas del mismo hash dejan un fichero, una fila de contenido y dos archivos preparados.
- [ ] Una sesión revocada justo antes de crear las filas responde `UNAUTHORIZED` y no deja archivo preparado.
- [ ] Al arrancar sobre una carpeta de datos con restos en `incoming/`, `api` los borra antes de admitir peticiones.
- [ ] La carpeta de contenidos del arnés desaparece al cerrar, y la de la prueba se conserva para reabrir.
- [ ] `architecture.test.ts` prueba que un módulo no puede importar el almacén.
- [ ] `pnpm check` pasa.
