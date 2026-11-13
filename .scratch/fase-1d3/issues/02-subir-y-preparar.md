# 02. Subir y preparar

Status: resolved
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

- [x] Por `browser()`, una sesión de persona sube un JPEG y recibe su archivo preparado; el fichero está en el almacén con su hash como nombre y `incoming/` queda vacía.
- [x] Sin sesión responde `UNAUTHORIZED`, y con la cuenta `device`, `FORBIDDEN`, sin dejar nada en disco.
- [x] Cada error de subir de esta tarea responde su código y su estado de la tabla, sin restos en `incoming/`.
- [x] Dos subidas del mismo contenido, en secuencia, comparten un solo fichero y dan dos archivos preparados.
- [x] Con el punto de intercalación, dos subidas simultáneas del mismo hash dejan un fichero, una fila de contenido y dos archivos preparados.
- [x] Una sesión revocada justo antes de crear las filas responde `UNAUTHORIZED` y no deja archivo preparado.
- [x] Al arrancar sobre una carpeta de datos con restos en `incoming/`, `api` los borra antes de admitir peticiones.
- [x] La carpeta de contenidos del arnés desaparece al cerrar, y la de la prueba se conserva para reabrir.
- [x] `architecture.test.ts` prueba que un módulo no puede importar el almacén.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `1bd944a`. Costuras para las tareas que siguen:
    - **Carpeta de contenidos.** `PlatformOptions.filesDirectory` (absoluta); sin ella, `files` junto a la base; en memoria no hay y subir responde `INTERNAL_SERVER_ERROR`. `createTestPlatform` gana la opción `files`: sin valor, una carpeta temporal del arnés (también con `file: true` o una ruta de base) que se borra al cerrar, después de que `platform.close()` cierre los descriptores y cancele la lectura de cada subida en curso; con una ruta, se conserva. `test.filesDirectory` dice cuál es. Para reabrir, procesos hijos o restaurar, la prueba pasa la misma ruta en `files`. Dentro: `contents/<2 primeros del hash>/<hash>` e `incoming/`, creadas cuando hacen falta.
    - **Punto de intercalación.** Una sola función: `createTestPlatform({ interleave })`, que llega como `PlatformRuntime.interleave` (`TestBackgroundRuntime.interleave` en la entrada de pruebas). Recibe un `InterleavePoint` y devuelve la promesa que lo retiene. El de la publicación es `published`: salta con el cerrojo del hash tomado y el fichero en su sitio, en los tres casos (nuevo, huérfano reutilizado, presente), antes de la transacción de las filas. La 06 y la 04 añaden sus nombres al mismo tipo.
    - **Errores de las rutas.** `ORPCError`, con `fileError(code)` de `packages/platform/files/failures.ts` para los códigos que oRPC no conoce (tabla `STATUS`, ahí se añaden los de la 03); `errorResponse(error)` responde el JSON de `toJSON()` con su estado, `Retry-After: 1` para `CONTENT_BUSY`, y cualquier otro error como `INTERNAL_SERVER_ERROR`. La descarga de la 04 puede usar el mismo `errorResponse`.
    - **Sesión de un `browser()`.** No hay helper todavía. La 04 lo necesita para `attach` con `invoke`: un `test.contextOf(browser)` que lea la cookie `better-auth.session_token`, tome el token (lo de antes del primer `.`, tras decodificarla), busque su fila en `platform_session` desde la entrada de pruebas y selle el contexto como la puerta (`deviceAccount` = la cuenta, canal `app`, `password`).
    - **Dónde va cada cosa.** `packages/platform/files/index.ts` (`createFiles`: recibir y publicar; `filesOf(platform)` lo da dentro de platform), `store.ts` (rutas, `syncFolder` y `createHashLocks`, que la limpieza de la 06 debe compartir: el cerrojo está en `createFiles` y aún no se expone), la ruta en `http/index.ts`. Quién sube lo decide `mayUpload` en `platform/authorization`. La regla `files-stay-in-platform` cubre `packages/platform/files/`: las rutas de la puerta viven en `http/`, que los módulos ya no alcanzan.
    - **Para la 03.** `declaredSize` ya da el tamaño declarado sin usarlo; la recepción lee el cuerpo con `getReader()` y escribe con `writeSync`, comprobando `upload.open` antes de tocar el descriptor. Faltan la discrepancia de longitud, el minuto sin bytes, las reservas y la señal de cancelación de la petición.
    - Decisiones tomadas sin preguntar, también en la spec: `incoming/` se vacía al crear la puerta y no al abrir la plataforma, porque `pnpm accounts` la abre con `api` en marcha y borraría sus subidas; respuesta 200; orden sesión, autorización, `Content-Length`, nombre, bytes; 25 MB = 25 × 1024 × 1024; un `Content-Length` no decimal es `LENGTH_REQUIRED`; Kira (`via`) no sube; las tablas guardan el nombre SQL de la tabla y el id entero del registro, `released_by` con clave ajena al registro de acciones, y el archivo preparado sin clave ajena a su sesión. `CONTENT_BUSY` está programado y sin probar hasta la 06.
