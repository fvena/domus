# Los archivos

## Qué es

Un archivo es algo que se sube a Domus para guardarlo junto a un registro: la foto de la caldera junto a la nota de su revisión, o la factura de la luz en PDF. Domus admite fotos (JPEG, PNG, WebP y HEIC, la de los iPhone), PDF y texto, de hasta 25 MB cada uno.

Un archivo siempre va con un registro de un módulo, como una nota. No hay una carpeta de archivos sueltos: si se borra la nota, se suelta su archivo, y si se deshace el borrado, vuelve.

## Cómo funciona

Subir un archivo y guardarlo con una nota son dos pasos. Primero se sube, y Domus responde con un archivo preparado: un recibo que dice «esto ha llegado bien». Ese recibo vale un día, solo para la sesión que subió el archivo y una sola vez. Después, una acción del módulo lo vincula a la nota. Si nadie lo vincula, caduca y la limpieza de esa noche lo borra.

Mientras llegan los bytes, Domus mira de qué tipo es el archivo por cómo empieza, no por su nombre: una foto renombrada como `factura.pdf` sigue siendo una foto, y un programa renombrado como `lista.txt` no entra. También pone límites para que una subida no llene el disco: cada sesión puede tener a la vez hasta 20 archivos o 200 MB subiéndose o preparados, siempre quedan 2 GB libres, y si pasa un minuto sin que llegue nada, la subida se corta.

Cada archivo se guarda una vez, con un nombre que sale de su propio contenido, una huella llamada SHA-256. Si Paco y Rocío suben la misma foto, el disco la guarda una sola vez, y dos archivos distintos nunca acaban con el mismo nombre. Lo guardado no se reescribe nunca.

Para descargar un archivo, se pide a través de la lectura que lo devolvió, como la que enseña una nota. Si esa lectura deja ver la nota, se puede bajar su archivo. Si no, Domus contesta como si no existiera. Cuando la lectura pide que la persona confirme, la descarga espera a esa confirmación.

Cada noche, la limpieza borra lo que ya no protege nada: los archivos preparados que caducaron, los contenidos a los que ya no apunta ningún registro y los restos de una subida que se cortó. La copia de seguridad lleva los archivos que la base necesita, también los de una nota borrada que aún se puede deshacer, y al restaurar vuelven juntos la base y sus archivos.

En el ensayo de la Pi subimos una foto, una factura y una lista. Vinculamos las dos primeras a una nota y la lista a otra, y borramos la segunda. Después de copiar, vaciar el ensayo y restaurar, las tres descargas eran idénticas a los originales, deshacer devolvió la nota borrada con su lista, y el recibo de un archivo que no se había vinculado ya no valía.

## Por qué es así

Separar subir de vincular deja que el archivo llegue entero antes de tocar ningún registro. Si la subida se corta, la nota no cambia. Y como el recibo solo vale para quien subió y una vez, nadie puede colgar el archivo de otro en su nota.

El tipo se mira por los bytes porque el nombre lo elige quien sube. Si saliera del nombre, un programa llamado `lista.txt` entraría como texto.

La descarga pasa por una lectura para que un archivo siga las mismas reglas que su registro. Si Rocío no puede ver una nota privada de Paco, tampoco puede bajar su foto, y no hace falta una segunda regla que pueda equivocarse por su cuenta.

Como lo guardado no se reescribe, un corte de luz a mitad de una subida no estropea un archivo que ya estaba. Y como cada uno se llama por su huella, al restaurar se puede comprobar que está entero.

## En el código

- El almacén: `packages/platform/files/`, con `store.ts` (en la Pi, `/data/files/contents/<2 caracteres>/<sha256>` y `incoming/`), `type.ts` y `name.ts` (el tipo por sus bytes y el nombre), `index.ts` (la subida, publicada con un cerrojo por hash), `reservations.ts` (los límites por sesión y del disco), `references.ts` (`ctx.files`) y `cleanup.ts`.
- Las rutas: `POST /api/files` para subir y `POST /api/files/download` para descargar, en `packages/platform/http/index.ts`, las dos solo con sesión.
- Un módulo usa los archivos solo con `ctx.files` (`of`, `attach`, `detach` y `reattach`) y marca los de sus lecturas con `fileRef()` de `@domus/module-sdk/contracts`. Una regla de dependencias le impide llegar al almacén.
- `probe` los usa en sus notas: `attachFile`, `detachFile`, `reattachFile` y `deleteNote`.
- La copia y restaurar: `packages/platform/files/needed.ts` dice qué contenidos lleva la copia y cuáles comprueba restaurar ([Las copias de seguridad y restaurar](copias.md)).
- Decisión: [ADR 0028](../architecture/adr/0028-archivos.md). Los límites, las comprobaciones en la Pi y el ensayo con archivos: [`docs/despliegue.md`](../despliegue.md).
