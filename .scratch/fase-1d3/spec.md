# Fase 1d3: archivos

Status: ready-for-agent

Esta spec sale del grilling de la fase 1d3 ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-13, preguntas Q1–Q14, con las correcciones de su revisión, y del acuerdo posterior sobre las costuras de prueba. Las decisiones duraderas están en el [ADR 0028](../../docs/architecture/adr/0028-archivos.md), que precisa los ADR [0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md), [0025](../../docs/architecture/adr/0025-segundo-plano.md) y [0026](../../docs/architecture/adr/0026-copias-de-seguridad-y-restaurar.md). Si esta spec y los ADR no coinciden, mandan los ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): archivo, referencia de archivo, contenido de archivo, archivo preparado, registro, acción, inversa, deshacer, confirmación pendiente, mantenimiento, copia de seguridad y restaurar. «Contenido» a secas es siempre el de una entrada del registro de acciones.

## Problema

Después de la 1d2, Domus guarda texto y números en SQLite y tiene copias de la base, pero no puede guardar una foto ni un PDF. Los módulos que vienen los necesitan: el ticket de la compra, la factura de la luz, el informe del médico, la foto de la nevera rota para el técnico.

Guardar ficheros sin más no basta. La casa necesita:

- que un archivo se vea solo si se ve el registro del que cuelga, sin un sistema de permisos aparte que se pueda desalinear;
- que borrar por error una nota con su foto se pueda deshacer, y que la foto vuelva;
- que subir no pueda llenar el NVMe de la Pi, ni dejar basura si algo se corta;
- que un corte de luz a mitad de una subida o de una limpieza no deje un registro apuntando a bytes que ya no existen;
- que la copia de cada noche lleve las fotos y los PDF que la base necesita, y que restaurar devuelva las dos cosas juntas.

## Solución

`platform` gana un almacén de contenidos de archivo en el volumen de datos, direccionado por SHA-256, con contenidos que nunca se reescriben y se comparten entre registros sin compartir el acceso.

Subir es una ruta de la puerta que recibe el cuerpo como flujo, reserva espacio antes de leerlo, reconoce el tipo por sus firmas, lo publica sin poder perder bytes y devuelve un archivo preparado, de un solo uso y de la sesión que lo subió.

Un módulo vincula ese archivo preparado a uno de sus registros con `ctx.files`, dentro de una de sus escrituras. Vincular y soltar cambian el registro a efectos de permisos, de la captura y de deshacer. Un borrado deshacible no borra la referencia: la suelta, ligada a su entrada del registro, y el deshacer de esa entrada la vuelve a vincular.

Descargar es ejecutar una lectura del módulo por el camino único de las acciones: solo sale un archivo que esa lectura devolvió marcado con `fileRef()`. Si la lectura pide confirmación, la descarga se queda pendiente y se confirma en su propia ruta.

La limpieza diaria recoge lo que ya nada protege. La copia sube, junto a la base, los contenidos de archivo que su instantánea necesita, y restaurar los instala desde la copia comprobada antes de intercambiar la base.

`probe` gana archivos en sus notas para demostrar la integración, y la 1d3 termina restaurando base y archivos juntos en el ensayo de la Pi.

## Historias de usuario

1. Como miembro, quiero subir una foto o un PDF desde el móvil, para guardarlo en Domus en lugar de en el carrete.
2. Como miembro, quiero que una foto subida cuelgue de un registro concreto (una nota, una factura), para encontrarla donde tiene sentido.
3. Como miembro, quiero que un registro pueda tener varios archivos, para guardar las tres páginas de un informe juntas.
4. Como miembro, quiero que un archivo se vea solo si veo su registro, para que una foto de una nota privada mía no la vea nadie más.
5. Como miembro, quiero que un archivo de un registro público se vea como el registro, para compartir con la casa el ticket de una compra común.
6. Como miembro, quiero que nadie pueda colgar archivos de un registro mío que solo puede ver, para que ser público siga siendo «ver, no editar».
7. Como miembro, quiero que subir el mismo PDF a dos registros no duplique los bytes, para no gastar disco, sin que tener acceso a uno dé acceso al otro.
8. Como miembro, quiero que un archivo se descargue con su nombre original, para reconocerlo al guardarlo.
9. Como miembro, quiero que borrar por error una nota con su foto se pueda deshacer y la foto vuelva, para no perder nada por un dedo torpe.
10. Como miembro, quiero que deshacer un borrado no funcione si alguien cambió después los archivos de esa nota, para no pisar un cambio ajeno sin darme cuenta.
11. Como miembro, quiero que quitar un archivo de una nota también se pueda deshacer, para recuperarlo si me equivoqué.
12. Como miembro, quiero que rehacer y deshacer otra vez funcionen con los archivos igual que con el texto, para no tener casos especiales que recordar.
13. Como miembro, quiero que una subida que se corta a medias no deje nada a medio guardar, para no ver archivos rotos.
14. Como miembro, quiero que una subida que deja de llegar se cancele sola al minuto, para que un móvil sin cobertura no ocupe sitio indefinidamente.
15. Como miembro, quiero saber con un error claro que un archivo es demasiado grande o de un tipo que Domus no admite, para elegir otro.
16. Como miembro, quiero que un archivo preparado y nunca usado desaparezca solo, para no acumular basura por formularios abandonados.
17. Como miembro, quiero que un archivo preparado me sirva un día entero, para terminar un formulario aunque el móvil pase a segundo plano.
18. Como miembro, quiero que cerrar sesión anule mis archivos preparados, para que nadie los use desde una sesión que ya no es mía.
19. Como miembro, quiero que, si una descarga pide confirmación, pueda confirmarla desde cualquiera de mis sesiones, igual que cualquier otra lectura.
20. Como miembro, quiero que confirmar una descarga sirva para una sola descarga de ese archivo, para que una confirmación no se convierta en un enlace permanente.
21. Como miembro, quiero ver las fotos y el texto dentro de la app, para no tener que descargarlos.
22. Como miembro, quiero que un PDF o un HEIC que la app no muestra se guarde en el móvil solo cuando yo lo pido, para que la app no deje copias por su cuenta.
23. Como miembro, quiero saber que lo que guardo en el móvil queda fuera de Domus, para no esperar que revocar un acceso lo borre.
24. Como miembro, quiero que lo descargado no se quede en la caché del navegador, para que otra persona con el mismo móvil no lo encuentre.
25. Como admin, quiero que una sesión no pueda tener más de 20 archivos preparados ni más de 200 MB a la vez, para que un fallo de la app no llene el disco.
26. Como admin, quiero que Domus deje de aceptar subidas si quedan menos de 2 GB libres, para que la base y las copias sigan teniendo sitio.
27. Como admin, quiero que el disco lleno durante una subida acabe en un error controlado sin restos, para que el siguiente intento funcione en cuanto haya sitio.
28. Como admin, quiero que el aparato de la cocina, con la cuenta `device`, no pueda subir archivos, para que nada entre en Domus sin una persona detrás.
29. Como admin, quiero que el tipo de un archivo se decida por sus bytes y no por lo que diga el móvil, para que un ejecutable no entre llamándose foto.
30. Como admin, quiero que el nombre de un archivo no pueda llevar rutas ni caracteres de control, para que no escape de su carpeta ni rompa una cabecera.
31. Como admin, quiero que un corte de luz a mitad de publicar o de borrar un contenido nunca deje un registro apuntando a bytes que no existen, para fiarme del almacén.
32. Como admin, quiero que lo que un corte deja a medias lo recoja solo la limpieza, para no tener que limpiar a mano.
33. Como admin, quiero que la limpieza nunca borre un contenido que una nota acaba de vincular, aunque coincidan en el tiempo, para no perder una foto por mala suerte.
34. Como admin, quiero que una descarga ya empezada termine aunque la limpieza borre después ese contenido, para que nadie reciba un fichero cortado.
35. Como admin, quiero que la copia de cada noche lleve las fotos y los PDF que la base necesita, también los de borrados aún deshacibles, para que restaurar no deje registros sin sus archivos.
36. Como admin, quiero que la copia no lleve archivos preparados ni basura, para no gastar repositorio en lo que nadie necesita.
37. Como admin, quiero que, si falta en disco un contenido que la base necesita, la copia falle y `/health` lo diga, para no creerme protegido cuando no lo estoy.
38. Como admin, quiero que restaurar devuelva base y archivos juntos, comprobados por su hash, para que lo restaurado esté entero.
39. Como admin, quiero que restaurar arregle un contenido vivo dañado con el de la copia, para no arrastrar un fichero estropeado.
40. Como admin, quiero que restaurar se niegue antes de tocar nada si a la copia le falta un contenido necesario, para no cambiar una base buena por una incompleta.
41. Como admin, quiero que una restauración cortada se pueda retomar con los archivos ya instalados, igual que la base, para no depender de que nada se corte.
42. Como admin, quiero que los archivos preparados de la copia no sirvan después de restaurar, para que una sesión ya cerrada no los use.
43. Como admin, quiero comprobar en la Pi que base y archivos se restauran juntos en el ensayo, para saber que funciona antes de necesitarlo.
44. Como quien escribe un módulo, quiero vincular, soltar y listar archivos con `ctx.files` sin tocar rutas de disco, para no poder saltarme la autorización.
45. Como quien escribe un módulo, quiero marcar en mi contrato con `fileRef()` qué parte de una lectura es un archivo, para que la descarga sepa qué puede servir.
46. Como quien escribe un módulo, quiero que vincular un archivo cuente como tocar el registro, sin declararlo aparte, para que deshacer vea los cambios de archivos sin trabajo extra.
47. Como quien escribe un módulo, quiero que un fallo en mi escritura revierta también el vínculo y el consumo del archivo preparado, para poder reintentar con el mismo archivo.
48. Como quien escribe un módulo, quiero que llamar directamente a mi acción de restaurar con el id de un archivo ajeno no lo recupere, para que la inversa no sea una puerta trasera.
49. Como la casa, quiero que las fotos se guarden con sus metadatos originales sabiendo que la ubicación sale con cada descarga, para decidir más adelante si quitarla con un caso real.

## Decisiones de implementación

### Almacén de contenidos (Q1, Q2)

- Una carpeta `files/` dentro de la carpeta de datos, con los contenidos de archivo en `files/contents/`, repartidos por los primeros caracteres de su SHA-256, y las subidas en curso en `files/incoming/`. El mismo volumen, para que publicar sea un renombrado. Nunca el `/tmp` del contenedor.
- Un contenido de archivo nunca se reescribe: se crea, se reutiliza o se borra. Dos subidas con el mismo hash comparten uno.
- Tablas nuevas de la plataforma, en una migración generada:
    - los contenidos de archivo: hash, tamaño, tipo detectado, estado (presente o reclamado) e instante de creación;
    - los archivos preparados: id opaco, contenido, nombre, sesión, cuenta, instante de caducidad y si se consumió;
    - las referencias de archivo: id opaco, contenido, nombre, módulo, tabla e id del registro dueño, y, si está soltada, la entrada del registro de acciones que la soltó.
- Los ids de archivo preparado y de referencia son aleatorios y no son el hash: el hash es la dirección interna, nunca una credencial.
- Decidido al implementar la 02:
    - un contenido vive en `files/contents/<dos primeros caracteres del hash>/<hash>`; las carpetas se crean cuando hacen falta, no al abrir;
    - la carpeta `files/` es por defecto la de la carpeta de datos, y `PlatformOptions.filesDirectory` la cambia; en memoria no hay ninguna y subir responde `INTERNAL_SERVER_ERROR`;
    - la referencia guarda el nombre SQL de la tabla del registro y su id entero; `released_by` es una clave ajena a la entrada del registro de acciones; el archivo preparado no tiene clave ajena a su sesión, porque una sesión que termina lo deja inservible y la limpieza lo recoge;
    - el tipo del contenido tiene un `CHECK` con las seis clases.

### Subir (Q4, Q8)

- `POST /api/files`, una ruta de Hono en la puerta, no de oRPC, por el control directo de la recepción, el límite y la cancelación.
- Solo con sesión. La decisión de quién puede subir es una operación de la plataforma que resuelve `platform/authorization` (ADR 0010): las cuentas de persona sí; la cuenta `device` no. Sin llaves de API hasta la 1e.
- `Content-Length` obligatorio, de 1 byte a 25 MB. Un cuerpo más largo o más corto que lo declarado se rechaza.
- El nombre llega en `X-File-Name`, en UTF-8 codificado como URL. Se decodifica y se mide en bytes: de 1 a 255. Se rechaza una codificación inválida, un separador de ruta, un carácter de control, `.` o `..`.
- Un minuto sin bytes, en cualquier momento, cancela la subida con un error controlado. Se cuenta con el reloj y el temporizador de la plataforma, para que las pruebas lo avancen.
- Al terminar de recibir, la misma petición hace el paso 2 y responde con el archivo preparado: `{ id, name, type, size, expiresAt }`.
- Cada causa de error tiene su código y su estado HTTP: «Errores de las rutas de archivos».
- Decidido al implementar la 02:
    - la respuesta buena es un 200 con el JSON del archivo preparado, como las RPC;
    - se comprueba en este orden: la sesión, quién puede subir, `Content-Length`, el nombre y, después, los bytes;
    - 25 MB son 25 × 1024 × 1024 bytes;
    - un `Content-Length` que no es un número decimal cuenta como ausente: `LENGTH_REQUIRED`;
    - Kira, con `via`, tampoco sube, y una cuenta sin perfil no sube.
- Decidido al implementar la 03:
    - la reserva se toma después del nombre y antes de crear el temporal;
    - la recepción se corta en el primer trozo que pasa de lo declarado: ni un byte de más llega al disco; un cuerpo que acaba antes de lo declarado se rechaza al acabar;
    - el minuto sin bytes se cuenta desde cada lectura que espera un trozo, la primera incluida;
    - la sesión se vuelve a comprobar con cada trozo recibido, y la transacción de las filas la comprueba otra vez; una subida parada de una sesión revocada termina con su siguiente trozo o con el minuto sin bytes;
    - la cancelación del cliente (la señal de la petición) y el cuerpo que se corta terminan la subida como un fallo interno: nadie lee esa respuesta.

### Errores de las rutas de archivos

Las dos rutas responden sus errores con el estado HTTP de la tabla y, como cuerpo, el JSON de `ORPCError.toJSON()` (`defined`, `code`, `status`, `message` y `data`) tal cual, sin el sobre `{ json }` del serializador RPC: no son procedimientos de oRPC, y así la app lee el mismo `code` y `data` que en una RPC. «Reintento» dice si la misma petición puede salir bien más tarde sin cambiar nada.

| Ruta y causa                                                                          | Código                                           | HTTP            | Reintento                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------- | -------------------------------------- |
| Las dos, sin sesión o con una sesión que terminó durante la subida                    | `UNAUTHORIZED`                                   | 401             | no                                     |
| Subir, con una cuenta que no puede (`device`)                                         | `FORBIDDEN`                                      | 403             | no                                     |
| Subir, sin `Content-Length`                                                           | `LENGTH_REQUIRED`                                | 411             | no                                     |
| Subir, con `Content-Length` 0                                                         | `FILE_EMPTY`                                     | 400             | no                                     |
| Subir, con `Content-Length` de más de 25 MB                                           | `FILE_TOO_LARGE`                                 | 413             | no                                     |
| Subir, con un cuerpo más corto o más largo que lo declarado                           | `BODY_MISMATCH`                                  | 400             | sí, con una subida nueva               |
| Subir, con un nombre ausente o no válido                                              | `INVALID_FILE_NAME`                              | 400             | no                                     |
| Subir, con un tipo no admitido o una cabecera que no se reconoce                      | `FILE_TYPE_NOT_ALLOWED`                          | 415             | no                                     |
| Subir, por encima del límite de la sesión                                             | `UPLOAD_LIMIT`                                   | 429             | sí, al consumirse o caducar preparados |
| Subir, sin 2 GB libres tras las reservas                                              | `INSUFFICIENT_STORAGE`                           | 507             | sí, más tarde                          |
| Subir, con `ENOSPC` al escribir                                                       | `DISK_FULL`                                      | 507             | sí, más tarde                          |
| Subir, tras un minuto sin bytes                                                       | `UPLOAD_TIMEOUT`                                 | 408             | sí                                     |
| Subir, con el contenido reclamado para borrarse                                       | `CONTENT_BUSY`, con `Retry-After: 1`             | 503             | sí, la app reintenta sola              |
| Descargar, con un cuerpo que no es ni `{ action, input, file }` ni `{ confirmation }` | `BAD_REQUEST`                                    | 400             | no                                     |
| Descargar, con una acción que no existe o no es una lectura                           | `NOT_FOUND`                                      | 404             | no                                     |
| Descargar, con una entrada no válida para la lectura                                  | `BAD_REQUEST`                                    | 400             | no                                     |
| Descargar, con lo que responda la autorización de la lectura                          | `FORBIDDEN`, `STEP_UP_REQUIRED`                  | 403             | no                                     |
| Descargar, si la lectura pide confirmación                                            | `CONFIRMATION_REQUIRED`, `data.confirmation`     | 428             | se confirma en la misma ruta           |
| Descargar, con un error que declara el contrato de la lectura                         | el del contrato                                  | el del contrato | el del contrato                        |
| Descargar, con un `file` que no salió de la lectura o no existe                       | `NOT_FOUND`                                      | 404             | no                                     |
| Descargar con `{ confirmation }`, una pendiente fuera de alcance o que no es descarga | `NOT_FOUND`                                      | 404             | no                                     |
| Descargar con `{ confirmation }`, caducada, consumida o rechazada                     | `CONFLICT`, `data.reason` como en `confirm`      | 409             | no                                     |
| `confirmations/confirm` con una pendiente de descarga, sin consumirla                 | `CONFLICT`, `data.reason: "confirm-by-download"` | 409             | no, se confirma en su ruta             |

Y desde `ctx.files`, por el camino de las acciones:

| Causa                                                                                      | Código                                              | HTTP |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---- |
| `attach` con un archivo preparado que no existe, es de otra sesión o de una que ya terminó | `NOT_FOUND`                                         | 404  |
| `attach` con un archivo preparado caducado                                                 | `CONFLICT`, `data.reason: "prepared-file-expired"`  | 409  |
| `attach` con un archivo preparado ya consumido                                             | `CONFLICT`, `data.reason: "prepared-file-consumed"` | 409  |
| `attach`, `detach` o `reattach` sobre un registro que no se ve                             | `NOT_FOUND`                                         | 404  |
| `attach`, `detach` o `reattach` sobre un registro que se ve y no se puede editar           | `FORBIDDEN`                                         | 403  |
| `detach` de un archivo que no es de ese registro                                           | `NOT_FOUND`                                         | 404  |
| `reattach` fuera del deshacer de la entrada que soltó la referencia                        | `NOT_FOUND`                                         | 404  |

Un fichero que falta en disco con su contenido presente es un fallo interno (`INTERNAL_SERVER_ERROR`, 500), que no debería ocurrir nunca.

### Reservas de espacio (Q4)

- Antes de leer un byte, la subida reserva su `Content-Length` en memoria de `api` contra:
    - el límite de la sesión: 20 archivos o 200 MB, sumando las subidas en curso y los archivos preparados vigentes y sin consumir;
    - el espacio libre del volumen, leído con `statfs`, menos todas las reservas vivas: tienen que quedar 2 GB.
- La reserva se libera al terminar, fallar o cancelar, también si se corta la conexión.
- Un `ENOSPC` al escribir el temporal termina la subida con el error de disco lleno, borra el temporal y libera la reserva.
- Los tres números son provisionales: los revisa el primer consumidor real.
- Decidido al implementar la 03:
    - 200 MB son 200 × 1024 × 1024 bytes y 2 GB, 2 × 1024³; el espacio libre es el que `statfs` da a un proceso sin privilegios (`bavail × bsize`) de `files/incoming/`;
    - primero el límite de la sesión (`UPLOAD_LIMIT`) y después el del volumen (`INSUFFICIENT_STORAGE`);
    - un archivo preparado cuenta mientras no se consume y el instante es anterior a su caducidad: en el instante exacto de `expiresAt` ya no cuenta;
    - el límite es de la sesión, no de la persona: otra sesión suya tiene el suyo;
    - una reserva se guarda por el nombre de su temporal, se toma antes de que el fichero exista y se libera después de borrarlo; `files.inProgress(name)` dice si un temporal de `incoming/` es de una subida en curso, para la limpieza;
    - en la entrada de pruebas, `createTestPlatform` gana `freeSpace` (sin valor, `statfs`) y `diskFull`, que se pregunta antes de cada escritura del temporal y la hace fallar con un `ENOSPC` como el de Node; un `ENOSPC` en cualquier paso de la subida responde `DISK_FULL`.

### Reconocer el tipo (Q8)

- Una función pura de `platform`, sin dependencias nuevas, que recibe los primeros bytes y dice cuál de las seis clases es, o ninguna: JPEG, PNG, WebP, HEIC y PDF por sus firmas; HEIC por las marcas `ftyp` propias de HEIC (`heic`, `heix`, `heim`, `heis`, `hevc`, `hevx`), nunca por `mif1` sola, que también usa AVIF. Si no es ninguna de las cinco, es texto plano solo si todo el contenido es UTF-8 válido y no tiene bytes nulos, comprobado mientras llegan los bytes.
- Rechaza firmas desconocidas y cabeceras truncadas o mal formadas que detecte. No promete que el formato esté entero.
- Las clases se nombran por el tipo con que se sirven: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf` y `text/plain`.
- Las cabeceras que se leen, todas desde el byte 0: JPEG, `FF D8 FF`; PNG, su firma de 8 bytes; WebP, `RIFF`, el tamaño, `WEBP` y la primera parte, `VP8 `, `VP8L` o `VP8X`; HEIC, una caja `ftyp` entera al principio, de 16 bytes a 4 KB y con las marcas alineadas, con una marca propia como principal o compatible; PDF, `%PDF-` y la versión, dígito, punto y dígito.
- Un contenido que empieza como una firma (`FF D8`, `89 P N G`, `RIFF`, `ftyp` en el byte 4 o `%PDF-`) es de esa clase o de ninguna, nunca texto: así se rechazan también las cabeceras truncadas o mal formadas que serían UTF-8 válido. Un contenido vacío no es de ninguna clase.
- Una función pura aparte valida y sanea el nombre. El valor crudo de `X-File-Name` solo admite ASCII imprimible; lo demás va codificado. Un carácter de control es uno de la categoría Unicode `Cc` (C0, DEL y C1). El nombre se guarda tal cual llega, sin normalizar. `Content-Disposition` es `attachment` con `filename` en ASCII, cada carácter fuera de ASCII imprimible y cada `"`, `\` o `%` cambiado por `_`, y `filename*` con el nombre entero en UTF-8 (RFC 8187).

### Publicar sin perder bytes (Q2)

- La subida escribe el temporal en `files/incoming/` mientras calcula el SHA-256 y comprueba el tipo, y lo sincroniza a disco al terminar.
- Toma el cerrojo en memoria del hash. Solo `api` publica o borra contenidos, y restaurar corre con `api` parada bajo el cerrojo exclusivo de la base, así que basta un cerrojo dentro del proceso.
- Con el cerrojo tomado:
    - contenido presente: descarta el temporal y lo reutiliza;
    - contenido reclamado: descarta el temporal y responde «contenido ocupado», pasajero;
    - contenido sin fila: si ya hay un fichero definitivo con ese hash (un huérfano de un corte), lo reutiliza, y antes sincroniza a disco el fichero y su carpeta, porque un proceso muerto antes de sincronizarlos pudo dejarlos solo en memoria (decidido al implementar la 07); si no, renombra el temporal a su sitio y sincroniza el fichero y cada carpeta nueva.
- En los tres casos que siguen, una transacción vuelve a comprobar que la sesión sigue válida y que el contenido está presente o no tiene fila, y crea la fila del contenido si falta y la del archivo preparado.
- El cerrojo se suelta al terminar, también tras un error o una cancelación.
- `api` borra todo `files/incoming/` al arrancar, antes de admitir peticiones. Lo hace al crear la puerta (`createHttpHandler`), no al abrir la plataforma: `pnpm accounts` también la abre, con `api` en marcha, y borraría sus subidas en curso.
- Cerrar la plataforma cierra el descriptor de cada subida en curso y cancela la lectura de su cuerpo: la subida falla y borra su temporal sin volver a usar el descriptor.
- Un fichero sin fila es basura recuperable. Nunca hay un contenido presente sin su fichero sincronizado. Uno reclamado puede haber perdido ya su fichero: es un estado del protocolo de borrar, y la limpieza lo retoma y elimina su fila.

### Archivo preparado (Q5)

- Vale 24 h desde que termina su preparación. Es de un solo uso y de la sesión que lo subió.
- Al consumirlo se comprueba que es de la misma sesión, que no ha caducado y que no se consumió, sin esperar a la limpieza.
- Cerrar o revocar la sesión lo deja inservible en el acto, porque su sesión ya no existe. Restaurar los borra todos.

### `ctx.files` y `fileRef()` (Q3)

- El contexto de una acción ofrece `ctx.files` con cuatro operaciones, solo sobre tablas del propio módulo:
    - `of(table, id)`: los archivos del registro, como valores de `fileRef()`, filtrados con `visible()`;
    - `attach(prepared, { table, id })`: consume el archivo preparado y crea la referencia;
    - `detach(file, { table, id })`: suelta la referencia;
    - `reattach(file, { table, id })`: vuelve a vincular una referencia soltada.
- `attach`, `detach` y `reattach` exigen que el registro exista, sea del módulo y entre en `editable(table)`. Si no, `forbidden()` o «no encontrado», con las mismas reglas que una edición.
- Las tres anotan el registro dueño como tocado con el mismo identificador que un cambio de columna, sin que el manejador lo declare, para que deshacer y la captura vean las dos clases de cambio como cambios del mismo registro.
- Todo ocurre en la transacción de la escritura: si la escritura falla, se revierten juntos el registro, la referencia, el consumo del archivo preparado y la protección.
- En una escritura deshacible, `detach` deja la referencia soltada y ligada a la entrada de esa escritura. En una irreversible, la borra.
- `reattach` solo se acepta mientras la plataforma ejecuta el deshacer de la entrada que soltó esa referencia, y la referencia sigue soltada. Fuera de ahí responde «no encontrado».
- `@domus/module-sdk/contracts` ofrece `fileRef()`: un esquema de Zod `{ id, name, type, size }` con una marca en sus metadatos. La plataforma reconoce en tiempo de ejecución las posiciones de una salida marcadas con `fileRef()`, también dentro de arrays, objetos opcionales y anulables. Una lectura que devuelve un `fileRef()` con un id que no es una referencia viva del registro del módulo es un error del módulo.
- El módulo no guarda ids de archivo en sus tablas: la referencia apunta a su dueño. Al borrar un registro, el módulo suelta sus referencias en la misma acción.
- `module-sdk` no ofrece rutas, manejadores ni nada del almacén fuera de `ctx.files`.
- Decidido al implementar la 04:
    - `detach` y `reattach` devuelven el `fileRef()` de la referencia, como `attach`, para que una acción pueda responder qué archivo quitó o devolvió;
    - `attach`, `detach` y `reattach` en una lectura son un error del módulo (`INTERNAL_SERVER_ERROR`); `of` vale en las dos y da los archivos más antiguos primero;
    - se comprueba primero el registro (no se ve: «no encontrado»; se ve y no se edita: «prohibido») y después el archivo preparado: no existe, es de otra sesión o su sesión ya no existe, «no encontrado»; consumido, `prepared-file-consumed`; en el instante exacto de `expiresAt` o después, `prepared-file-expired`, la misma frontera que el límite de la sesión de la 03;
    - lo que rechaza `ctx.files` sale de la acción tal cual, como `forbidden()`, aunque el contrato no lo declare;
    - el camino de las acciones da a cada escritura un descriptor de su ejecución: si es deshacible, qué entrada deshace y, para rellenar, los registros que tocó `ctx.files` y las referencias que soltó. Los registros se suman a los que declara el manejador antes de comprobar que una escritura deshacible toca algo; las referencias soltadas se ligan a la entrada justo después de anotarla, en la misma transacción, porque su número no existe antes. Dentro de esa escritura, `of` ya no da una referencia que soltó;
    - `fileRef()` es `{ id, name, type, size }` con textos no vacíos y un tamaño entero no negativo, marcado con `domusFileRef` en el registro global de Zod; `@domus/module-sdk/contracts` exporta también `isFileRef(schema)` y el tipo `FileRef`, y `zod` pasa a dependencia de `module-sdk`. El recorrido entra en objetos, arrays, opcionales, anulables, valores por defecto y de solo lectura; en una unión no busca;
    - que una lectura devuelva en una posición marcada un id que no es una referencia viva de su módulo se descubre solo al descargarlo, y responde `INTERNAL_SERVER_ERROR`.

### Deshacer con referencias soltadas (Q9)

- La protección de una referencia soltada es una consulta: vale mientras su entrada siga sin deshacer y su `expiresAt`, el fijado al escribirla, no haya pasado. Nunca se recalcula con la retención configurada en ese momento.
- La inversa lleva el id de la referencia, nunca el hash.
- Cada vez que se suelta, también al rehacer, la referencia queda ligada a la entrada que acaba de soltarla.

### Descargar (Q7)

- `POST /api/files/download`, con `{ action, input, file }` en JSON. Solo con sesión. La entrada nunca va en la URL.
- Ejecuta la lectura `action` con `input` por el camino único de `platform/actions`, con su autorización. Dentro de su transacción, después de comprobar que `file` está en una posición marcada con `fileRef()` de la salida, abre el fichero con `openSync`. Si la transacción se revierte, lo cierra.
- Los bytes salen después, como flujo desde el descriptor, con `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, el tipo detectado y `Content-Disposition` con el nombre saneado (`filename*` en UTF-8). Sin peticiones por rangos.
- Un `file` que no salió de esa lectura responde «no encontrado», igual que uno que no existe.
- Las descargas no entran en el registro de acciones, como cualquier lectura.
- Decidido al implementar la 04:
    - las lecturas siguen fuera de toda transacción; la descarga autoriza la lectura antes, fuera de la transacción, para que una pendiente que guarde la autorización no se revierta, y después ejecuta la lectura con `query_only`, comprueba el archivo y abre el fichero en una transacción. Así lo amplía la 05 para la pendiente de tipo descarga;
    - el cuerpo es exactamente `{ action, input, file }`: otra clave, también `confirmation` hasta la 05, es `BAD_REQUEST`. Un comprobante va en la cabecera `step-up-proof`, como en las RPC;
    - la respuesta lleva también `Content-Length`, y `Content-Type` es el tipo detectado tal cual, sin `charset`;
    - cerrar la plataforma cierra el descriptor de cada descarga sin terminar, que acaba con un error.

### Descarga confirmada (Q7)

- Si la lectura pide confirmación, se guarda una pendiente de tipo descarga, cuya operación exacta incluye la lectura, su entrada y el id del archivo, y se responde `CONFIRMATION_REQUIRED` con su id, como una lectura.
- Se confirma solo con `POST /api/files/download` y `{ confirmation }`. Reutiliza el mecanismo de confirmación de `platform/actions`, ampliado para terminar en un descriptor abierto: las reglas del ADR 0023 (la misma persona, desde cualquiera de sus sesiones válidas, la vigencia del origen) y la reevaluación de permisos, delegación, visibilidad y comprobante.
- Ejecutar la lectura, comprobar que devuelve el archivo pedido, abrir el fichero y consumir la pendiente van en una sola transacción. Si se pierde la respuesta, la pendiente queda consumida y repetir responde «ya consumida».
- `confirmations/confirm` rechaza una pendiente de descarga sin consumirla, con un error que dice que se confirma en su ruta. `confirmations/reject` la rechaza como cualquier otra.
- Decidido al implementar la 05:
    - la pendiente de descarga se guarda con `kind` `read`, sin migración: el `CHECK` de `platform_confirmations.kind` sigue en `('read', 'write')`. Lo que la distingue es su operación, `{ action, input, file }`, y su huella, `download:<huella de la lectura>:<id del archivo>`, que nunca coincide con la de una lectura, cuyo nombre de acción lleva siempre un punto antes de los dos puntos. Así una descarga y la misma lectura pedida como lectura esperan en pendientes distintas, y repetir la misma descarga desde la misma sesión encuentra la suya. Una descarga es una lectura, y una columna nueva habría pedido reconstruir la tabla y chocar con las migraciones de las tareas en paralelo;
    - el comprobante de una descarga sensible es el de su lectura, con la misma huella que `fingerprintOf` da a la lectura y su entrada;
    - el cuerpo es exactamente `{ action, input, file }` o exactamente `{ confirmation }`, con un texto; cualquier otra forma es `BAD_REQUEST`;
    - en la ruta de la descarga, una pendiente que no es una descarga es «no encontrada»; antes, como en `confirm`, se responde la de otra persona como no encontrada y una consumida, rechazada o caducada con su conflicto, también en `confirmations/confirm` para una de descarga;
    - si la reevaluación falla (sin permiso, o un archivo que la lectura ya no devuelve), la transacción se revierte y la pendiente no se consume: sigue confirmable si se arregla antes de caducar.

### Mostrar en la app (Q7)

- No hay pantallas en la 1d3 (fase 3), pero lo que sigue queda fijado para ellas y para `api-client`.
- La app pide los bytes con `fetch` y los guarda en un `blob:` en memoria. Nunca navega a un documento `blob:`. Muestra las imágenes en `<img>` y el texto como texto. Un PDF, o un HEIC que el navegador no muestra, se guarda en el aparato solo cuando la persona lo pide. La app libera cada URL `blob:` al dejar de usarla.

### Limpieza (Q10)

- Pasos nuevos de la tarea `cleanup`, en lotes con su propia transacción, como los de la 1d1:
    - archivos preparados caducados, consumidos o de sesiones que ya no existen;
    - referencias soltadas cuya entrada caducó o ya no se puede deshacer;
    - contenidos de archivo sin protección (ni referencia viva, ni soltada protegida, ni archivo preparado vigente);
    - contenidos reclamados de una pasada cortada, aunque su fichero ya no exista;
    - ficheros definitivos sin fila con más de una hora, con el cerrojo de su hash;
    - temporales de `files/incoming/` que no estén en una reserva viva.
- Borrar un contenido: con el cerrojo de su hash, una transacción comprueba que nada lo protege y lo marca reclamado; después se borra el fichero y se sincroniza su carpeta; por último se borra su fila.
- «Presente» quiere decir disponible y no reclamado. `attach`, `reattach` y crear un archivo preparado lo comprueban en su transacción.
- Limpiar dos veces no cambia nada, y un corte a mitad deja cada lote entero.
- Decidido al implementar la 06:
    - los pasos van en este orden, todos con el instante del comienzo de la pasada: archivos preparados, referencias soltadas, contenidos, contenidos reclamados y temporales. Los dos primeros son sentencias, como los de la 1d1; los otros tres tocan el disco y van por lotes de contenidos o de temporales, con una transacción por contenido;
    - un archivo preparado es de una sesión que ya no existe cuando no hay una sesión con su id y su cuenta, la misma regla que `attach`; una referencia soltada se recoge cuando su entrada está deshecha o su `expiresAt` llegó;
    - «nada lo protege» se comprueba como «nada lo apunta»: ni un archivo preparado ni una referencia, de ninguna clase. Las filas que ya no protegen las quitan los dos pasos anteriores de la misma pasada; una que quede (una sesión que terminó a mitad de la pasada) aplaza el borrado a la noche siguiente. Así nunca queda una fila con clave ajena a un contenido borrado;
    - el cerrojo del hash cubre solo la transacción que marca reclamado. Borrar el fichero, sincronizar su carpeta y borrar la fila van después, sin el cerrojo: el estado reclamado aparta a la publicación, que responde `CONTENT_BUSY`. La carpeta de dos caracteres se queda aunque se vacíe;
    - `attach` y `reattach` sobre un contenido reclamado responden «no encontrado», como si no existiera. Con la regla anterior no se alcanza, porque un contenido reclamado no tiene filas que lo apunten: queda como guarda;
    - una limpieza que falla se reintenta a los 30 s, como cualquier trabajo, y ese reintento ya termina un contenido que dejó reclamado;
    - los puntos de intercalación son `claimed` (con el contenido marcado y el cerrojo suelto, antes de borrar el fichero) y `opened` (en la puerta, con el descriptor de la descarga abierto y antes del primer byte). Si la promesa que devuelve la prueba se rechaza, el trabajo falla en ese punto: así se simula un corte sin matar el proceso.
- Decidido al implementar la 07:
    - los ficheros sin fila van en un paso entre los contenidos reclamados y los temporales. Un fichero sin fila es cualquiera de una carpeta de dos caracteres de `files/contents/` cuyo nombre no es el hash de ninguna fila, en cualquier estado. Su edad es la de su fecha de modificación frente al instante del comienzo de la pasada, y se borra cuando la diferencia pasa de una hora: con una hora justa se queda;
    - con el cerrojo de su hash se vuelve a comprobar que sigue sin fila y que tiene esa edad, se borra y se sincroniza su carpeta, todo antes de soltarlo; así una publicación que lo reutiliza escribe su fila antes o escribe su propio fichero después. Un lote cuenta solo los que tienen edad para borrarse, y los más jóvenes no lo alargan;
    - el punto de intercalación `removed` salta con el fichero de un contenido reclamado ya borrado y su carpeta sincronizada, antes de borrar su fila, en los dos pasos que terminan un borrado;
    - los cortes de la costura 4 son dos variantes de `ChildTask`: `publish` (sube un contenido para una sesión y una cuenta y se queda en `published`) y `delete` (corre la limpieza en un instante dado y se queda en `claimed` o en `removed`). El hijo de `delete` corre el trabajo de la tarea `cleanup` directamente, sin el segundo plano, para no dejar trabajos ni ejecuciones que la plataforma reabierta retome por su cuenta.

### Copia (Q11)

- Tras la instantánea y su `quick_check`, el mismo proceso hijo saca de la instantánea la lista de contenidos que necesita: los de las referencias vivas y los de las soltadas cuya entrada seguía deshacible en el instante de captura. Sin archivos preparados.
- Cada contenido de la lista se enlaza con un enlace duro dentro de la carpeta de preparación, bajo `files/`, así que la ruta guardada en restic no depende de la carpeta de datos. Si falta uno, la copia falla sin reintento, con su motivo, y no se guarda como buena.
- restic sube `domus.db` y esos enlaces en una sola instantánea suya, con `--files-from-verbatim`. La preparación, enlaces incluidos, se vacía al terminar, también tras un error, una cancelación o una caída, como en la 1d2: un enlace olvidado conservaría unos bytes que la limpieza ya retiró del almacén.
- Una copia parcial no cuenta como buena ni da paso a la retención (ADR 0026).
- Decidido al implementar la 08:
    - en la instantánea de restic, la base sigue en `/domus.db` y cada contenido va en `/files/contents/<dos primeros caracteres del hash>/<hash>`, la misma forma que la carpeta `files` del almacén;
    - el hijo de `quick_check` escribe en la primera línea lo que dice `quick_check` y, solo si es `ok`, el hash de un contenido necesario por línea, sacado de la instantánea con el instante de captura como argumento. La consulta es `NEEDED_CONTENTS` de `packages/platform/files/needed.ts`, con el instante como único parámetro, para que restaurar use la misma;
    - un hash de la lista que no sean 64 caracteres hexadecimales en minúscula hace fallar la copia sin reintento: es una ruta del almacén;
    - la lista de rutas para `--files-from-verbatim` es el fichero `paths` de la preparación, que no se sube;
    - un contenido que falta falla con `a file content the backup needs is missing`, sin el hash. Otro error al enlazar (una carpeta `files` en otro volumen, por ejemplo) se reintenta como cualquier error.

### Restaurar (Q12)

- restic deja la base y sus contenidos en la preparación de restaurar. Antes de tocar nada:
    - se comprueba el SHA-256 de cada contenido que la base restaurada necesita; si falta uno o no coincide, la restauración se niega;
    - al sanear, además de lo de la 1d2, se borran todos los archivos preparados, las referencias soltadas ya caducadas y las filas de contenidos que el conjunto restaurado ya no necesita.
- Después, todos los contenidos necesarios se instalan en el almacén vivo desde la preparación, sobrescribiendo con un renombrado, y se sincronizan el fichero y su carpeta. Así un fichero vivo dañado se arregla sin leer el almacén.
- Solo entonces se publica la marca de restauración pendiente y se intercambia la base. Retomar desde la marca da los contenidos por instalados. Un corte antes de la marca repite la preparación.
- Restaurar nunca borra un contenido vivo. Lo que sobra, también lo instalado antes de un corte, son huérfanos que recoge la limpieza.

### `probe` (Q13)

- Las notas pueden tener varios archivos. `getNote`, `listNotes` y `searchNotes` devuelven `files`, una lista de `fileRef()`.
- Acciones nuevas:
    - `attachFile({ noteId, prepared })`: deshacible, con inversa `detachFile`;
    - `detachFile({ noteId, file })`: deshacible, con inversa `restoreFile`;
    - `restoreFile({ noteId, file })`: deshacible, con inversa `detachFile`, que solo funciona como inversa.
- `deleteNote` suelta los archivos de la nota y su inversa, `restoreNote`, lleva sus ids y los vuelve a vincular.
- Las áreas de salud y secretas no tienen archivos.
- Decidido al implementar la 04:
    - solo las lecturas de notas devuelven `files`; las escrituras siguen respondiendo la nota sin ellos, y `notesWithComments` también;
    - las tres acciones nuevas responden el `fileRef()` del archivo;
    - `deleteNote` suelta los archivos después del bloqueo por comentarios, y su inversa lleva siempre `files`, vacía si no había; en `restoreNote`, `files` es opcional, porque deshacer valida la inversa guardada con el contrato de ahora;
    - para provocar un fallo después de `attach`, `detach` o `reattach`, la prueba envuelve el manejador de `probe` antes de abrir la plataforma, como ya hacían las pruebas de permisos con `listNotes`; `probe` no gana acciones para fallar;
    - `test-utils` gana `test.contextOf(browser)`: el contexto que la puerta sella para la sesión del navegador, para vincular con `invoke` lo que ese navegador subió.
- Decidido al implementar la 05: `probe` gana la lectura `getGuardedNote({ id })`, que responde como `getNote` con `alwaysConfirm: true`, el mismo recurso que usan las pruebas de confirmación por HTTP de la 1c con `deleteComment`. Ninguna lectura de `probe` pedía confirmación por la app.

### El ensayo y la comprobación en la Pi (Q14)

- Una imagen `domus-api:ensayo`, con una composición explícita de módulos que incluye `probe` sin quitarle su `testOnly`. La lista de producción no cambia y su prueba sigue dejando fuera los módulos `testOnly`. Cómo se elige la composición al construir se decide en la tarea de la Pi.
- El ensayo vacía solo el volumen de `domus-restore`.

### Reglas y documentación

- Una regla de dependencias impide que `module-sdk` y los módulos alcancen el almacén, la publicación, la limpieza y las rutas de archivos, y una prueba de arquitectura prueba que salta. No demuestra por sí sola que ningún código construya una ruta de disco: eso lo cubre que `module-sdk` solo exponga `ctx.files`.
- `docs/despliegue.md`, la guía, `packages/AGENTS.md` y el plan se actualizan al cerrar la 1d3.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba el comportamiento visible desde fuera:
    - lo que responde la puerta, con su estado, sus cabeceras y sus bytes;
    - el hash de lo descargado;
    - qué ficheros quedan en la carpeta de contenidos y en la de subidas;
    - lo que devuelven las lecturas y el registro de acciones;
    - lo que hay en el repositorio según restic;
    - y lo que se ve al volver a abrir la plataforma sobre los mismos datos.

    No comprueba sentencias SQL, nombres de columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla.

- **Costura 1: `createTestPlatform` con `probe`, su puerta y `browser()`.** Es la principal. La subida y la descarga van por HTTP de verdad, por el manejador de la puerta en el mismo proceso, sin servidor TCP. Vincular, soltar, deshacer y confirmar van con `invoke`, `undo` y `confirm`, y la limpieza con `background.runDue()`. Opciones nuevas, solo de pruebas:
    - **Carpeta de contenidos**, también en memoria, con el patrón de `file`: sin valor, una carpeta temporal del arnés que se borra al cerrar, después de cancelar las subidas y cerrar los descriptores; con una ruta, la de la prueba, que se conserva para reabrir, procesos hijos y restaurar. Es la opción `files` de `createTestPlatform`, y `test.filesDirectory` dice cuál es; sin valor no es la carpeta `files` de `file`, aunque la base esté en un fichero.
    - **El espacio libre**, una función que la prueba controla, para el rechazo previo y las reservas concurrentes.
    - **Un fallo `ENOSPC`** en la escritura del temporal, inyectado de forma estrecha, sin abstraer el sistema de ficheros.
    - **Un cuerpo de subida controlado por la prueba**, un flujo que entrega trozos cuando ella quiere, para la reserva antes del primer byte, subidas que compiten, el exceso de tamaño, la discrepancia con `Content-Length`, el minuto sin bytes también tras recibir parte (avanzando el reloj y el temporizador de pruebas), la cancelación y la sesión revocada durante la recepción.
- **Costura 2: puntos de intercalación de la entrada de pruebas**, que avisan a la prueba y esperan a que los suelte. Es una sola función, la opción `interleave(point)` de `createTestPlatform` (`PlatformRuntime.interleave` por dentro), que recibe el nombre del punto y devuelve la promesa que lo retiene; cada tarea añade su nombre a `InterleavePoint`. El de la publicación es `published` y salta en los tres casos que siguen al cerrojo (fichero nuevo, huérfano reutilizado y contenido presente), con el cerrojo tomado:
    - en la publicación, entre el renombrado y sus filas: dos subidas del mismo hash y reutilizar un huérfano;
    - en la limpieza, entre marcar reclamado y borrar el fichero: la carrera con `attach`, `reattach` y crear un archivo preparado, en los dos órdenes;
    - en la descarga, con el descriptor abierto y antes de transmitir: se suelta la referencia, corre la limpieza, se comprueba que el fichero ya no está y la descarga termina con el hash correcto.
- **Costura 3: `restoreBackup` y `listBackups` con `backups` sobre fichero y restic real**, como en la 1d2:
    - la preparación de la copia y la de restaurar quedan vacías, sin enlaces, tras éxito, error y cancelación;
    - qué contenidos entran en la copia (vivos, soltados deshacibles en la captura, y no los preparados ni los soltados caducados);
    - un contenido que falta hace fallar la copia, que no cuenta como buena;
    - restaurar devuelve base y contenidos, y las descargas coinciden por hash;
    - deshacer tras restaurar recupera el archivo de un borrado aún deshacible en la copia;
    - un contenido vivo dañado queda arreglado;
    - un contenido necesario ausente o dañado en la copia niega la restauración sin tocar la base ni el almacén;
    - los archivos preparados de la copia no sirven después.
- **Costura 4: `startChild` con variantes nuevas de `ChildTask`**, solo para los cortes que piden matar el proceso: al publicar (tras el renombrado y antes de las filas), al borrar (tras marcar reclamado y tras borrar el fichero) y al restaurar (tras instalar parte de los contenidos, tras instalarlos todos y antes de la marca, y la retoma desde la marca). Los puntos de corte del intercambio de la base de la 1d2 siguen pasando. Al reabrir, la prueba comprueba que nunca queda un contenido presente sin fichero, que uno reclamado sin fichero lo retoma la limpieza y que la restauración se retoma o se repite.
- **Costura 5: pruebas internas de `platform`** para las funciones puras de reconocer el tipo y validar el nombre, sin ampliar `test-utils`: cada firma, cabeceras truncadas, HEIC frente a AVIF, texto UTF-8 válido, inválido y con nulos, nombres mal codificados, largos, con rutas y con caracteres de control.
- **Con `probe` sobre la costura 1:**
    - la autorización: una nota pública ajena no admite archivos, una privada ajena no se descarga, un id que no salió de la lectura responde «no encontrado», la cuenta `device` no sube;
    - la atomicidad: un fallo después de `attach`, `detach` o `reattach` revierte la nota, la referencia, el consumo del archivo preparado y la protección, y el archivo preparado sirve para reintentar;
    - deshacer: un borrado con archivo, un deshacer que choca con un cambio posterior en los archivos, la cadena soltar, deshacer, rehacer y deshacer el rehacer, `restoreFile` llamado directamente, y una retención cambiada que no mueve la protección;
    - el archivo preparado: caducidad exacta, de otra sesión, consumido dos veces, sesión cerrada o revocada durante la subida y después;
    - la descarga confirmada: desde otra sesión de la misma persona, con respuesta perdida, rechazada por el `confirm` genérico sin consumirla y que no sirve dos veces;
    - las cabeceras de la descarga.
- **Reglas de dependencias:** la regla nueva salta si un módulo o `module-sdk` alcanzan el almacén.
- **Prior art:**
    - las pruebas de `probe` con `invoke`, `undo` y `confirm` de la 1b y la 1c;
    - las de la puerta con `browser()`, comprobantes y confirmaciones de la 1c;
    - las de la limpieza y el mando del segundo plano de la 1d1;
    - las de copiar y restaurar con restic real, y los cortes con `startChild`, de la 1d2.
- **En la Pi**, escrito en `despliegue.md`:
    - en el Domus real, una subida se prepara, un tipo no admitido y un exceso de tamaño se rechazan, el archivo preparado sin usar desaparece con la limpieza tras caducar y la copia de esa noche sale bien;
    - en el ensayo con `domus-api:ensayo`, se suben archivos, se vinculan a notas y una se borra con su deshacer vigente; tras copiar, vaciar solo el volumen de `domus-restore` y restaurar, las descargas coinciden por hash, deshacer recupera el archivo y los archivos preparados de la copia no sirven.

## Fuera de alcance

- Quitar metadatos, convertir HEIC, miniaturas y un visor de PDF: el primer módulo que muestre fotos o PDF.
- Las pantallas de subir, ver y descargar: fase 3.
- Que Kira o una app conectada suban o lean archivos: con sus llaves (1e) y la fase 5. Cómo llega lo compartido a Kira (ADR 0012) también.
- Avisos de que un archivo cambió: la 1d4 con las invalidaciones.
- Peticiones por rangos, subidas reanudables y subidas de varios archivos en una petición.
- Archivos en las áreas siempre privadas (salud, secretos) y cómo afecta borrar datos privados a los contenidos en las copias: el punto abierto «Borrar datos privados».
- Más de una instancia de `api`: el cerrojo por hash da por hecho una sola.
- Comprobar periódicamente que cada contenido vivo coincide con su hash.

## Notas

- El ADR 0028, sus enlaces de vuelta, el README de arquitectura, el glosario y el plan ya están al día en la rama del grilling.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling: la carpeta `files/` y sus subcarpetas, las tres tablas, las marcas `ftyp` de HEIC, la forma de `ctx.files`, las acciones nuevas de `probe`, que las descargas no entren en el registro, el enlace duro en la preparación de la copia y la lista desde el mismo hijo de `quick_check`. Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.
- La copia necesita además, en la preparación, enlaces duros, que no ocupan espacio de datos.

## Tareas

| Tarea                                                    | Qué                                        | Bloqueada por |
| -------------------------------------------------------- | ------------------------------------------ | ------------- |
| [01](issues/01-reconocer-el-tipo-y-validar-el-nombre.md) | Reconocer el tipo y validar el nombre      | —             |
| [02](issues/02-subir-y-preparar.md)                      | Subir y preparar                           | 01            |
| [03](issues/03-limites-de-la-subida.md)                  | Límites de la subida                       | 02            |
| [04](issues/04-vincular-descargar-soltar-y-deshacer.md)  | Vincular, descargar, soltar y deshacer     | 02            |
| [05](issues/05-la-descarga-confirmada.md)                | La descarga confirmada                     | 04            |
| [06](issues/06-la-limpieza-de-archivos.md)               | La limpieza de archivos                    | 03, 04        |
| [07](issues/07-huerfanos-y-cortes.md)                    | Huérfanos y cortes al publicar y al borrar | 06            |
| [08](issues/08-la-copia-lleva-los-contenidos.md)         | La copia lleva los contenidos              | 04            |
| [09](issues/09-restaurar-base-y-archivos-juntos.md)      | Restaurar base y archivos juntos           | 07, 08        |
| [10](issues/10-la-pi-y-el-cierre.md)                     | La Pi y el cierre de la 1d3                | todas         |
