# 01. Reconocer el tipo y validar el nombre

Status: resolved
Blocked by: None (can start immediately)

Spec: [`../spec.md`](../spec.md), sección «Reconocer el tipo» y la fila de `INVALID_FILE_NAME` en «Errores de las rutas de archivos». ADR 0028, «Qué promete el tipo».

## Qué construir

El trabajo previo de la 1d3: las dos funciones puras de `platform` que la subida usará desde la 02, para que el trazador no nazca con un detector provisional. No tocan disco, base ni HTTP.

- **Reconocer el tipo.** Recibe los bytes conforme llegan y dice, al terminar, cuál de las seis clases admitidas es, o que no se admite. JPEG, PNG, WebP, HEIC y PDF se reconocen por sus firmas. HEIC, por las marcas `ftyp` propias de HEIC (`heic`, `heix`, `heim`, `heis`, `hevc`, `hevx`), nunca por `mif1` sola, que también usa AVIF. Si no es ninguna de las cinco, es texto plano solo si todo el contenido es UTF-8 válido y no tiene bytes nulos, también cuando un carácter queda partido entre dos trozos.
- **Validar el nombre.** Recibe el valor de `X-File-Name`, lo decodifica como URL en UTF-8, lo mide en bytes (de 1 a 255) y rechaza una codificación inválida, un separador de ruta, un carácter de control, `.` y `..`. Devuelve el nombre que se guarda y el que irá saneado en `Content-Disposition`.
- Las dos funciones prometen solo lo que dice la spec: se rechazan las firmas desconocidas y las cabeceras truncadas o mal formadas que detectan; no se garantiza que el formato esté entero.

## Criterios de aceptación

- [x] Cada una de las cinco firmas se reconoce, también con la cabecera justa y nada más.
- [x] Una cabecera truncada o mal formada de cada clase se rechaza con un resultado controlado, nunca con una excepción.
- [x] Un HEIC con marca propia se reconoce; un AVIF, y un fichero con solo `mif1`, no.
- [x] Un texto UTF-8 válido se acepta aunque un carácter quede partido entre trozos; uno inválido o con un byte nulo, en cualquier posición, se rechaza.
- [x] Un fichero de bytes al azar no es de ninguna clase.
- [x] El nombre: válido con acentos y emojis; rechazado vacío, de 256 bytes tras decodificar (aceptado de 255), mal codificado, con `/`, `\`, un carácter de control, `.` o `..`.
- [x] Las pruebas son internas de `platform`; `test-utils` no cambia.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `98453a3`. Las dos funciones viven en `packages/platform/files/`: `detectFileType()` en `type.ts`, con `push(chunk)` por cada trozo y `finish()`, que da el tipo o `undefined`, y `readFileName(header)` en `name.ts`, que da `{ name, disposition }` o `undefined`. `contentDisposition(name)` se exporta aparte para que la descarga la construya desde el nombre guardado. Todavía no hay `files/index.ts`: lo abre la 02 al usarlas. Decisiones tomadas al implementar, también en la spec («Reconocer el tipo»): las clases se nombran por su tipo MIME, que es lo que se sirve y lo que responde la subida en `type`; un contenido que empieza como una firma es de esa clase o de ninguna, nunca texto, porque si no un PDF o un WebP truncados con bytes ASCII pasarían por texto; la caja `ftyp` se lee entera y hasta 4 KB, porque el detector guarda solo los primeros 4 KB y no crece con la subida; un contenido vacío no es de ninguna clase (la subida lo rechaza antes con `FILE_EMPTY`); el valor crudo de `X-File-Name` solo admite ASCII imprimible, porque un carácter crudo fuera de ASCII llega a Hono leído como latin1 y no se puede interpretar bien; el nombre no se normaliza a NFC; `Content-Disposition` es `attachment`, con `filename` en ASCII y `filename*` en UTF-8.
