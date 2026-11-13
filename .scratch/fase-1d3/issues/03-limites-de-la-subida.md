# 03. Límites de la subida

Status: resolved
Blocked by: 02

Spec: [`../spec.md`](../spec.md), secciones «Subir» (el minuto sin bytes y el cuerpo que no coincide), «Reservas de espacio» y las filas de límites de «Errores de las rutas de archivos». Costura 1 de «Decisiones de prueba».

## Qué construir

Que subir no pueda llenar el NVMe ni dejar una subida colgada. Todo con un cuerpo que controla la prueba y el reloj de pruebas, sin esperar tiempo real.

- **Reservas** en memoria de `api`, tomadas antes del primer byte con el `Content-Length`: contra la sesión (20 archivos o 200 MB, sumando subidas en curso y archivos preparados vigentes y sin consumir) y contra el espacio libre leído con `statfs` menos todas las reservas vivas (tienen que quedar 2 GB). Se liberan al terminar, fallar, cancelar o cortarse la conexión.
- **Errores**: `UPLOAD_LIMIT`, `INSUFFICIENT_STORAGE`, `DISK_FULL` (con `ENOSPC` al escribir: temporal borrado y reserva liberada), `BODY_MISMATCH` (cuerpo más corto o más largo que lo declarado) y `UPLOAD_TIMEOUT` (un minuto sin bytes en cualquier momento, contado con el reloj y el temporizador de la plataforma). Una sesión revocada durante la recepción termina con `UNAUTHORIZED`.
- **Costura**, solo en la entrada de pruebas: un cuerpo de subida que entrega trozos cuando la prueba quiere, la función de espacio libre y el fallo `ENOSPC` inyectado en la escritura del temporal, sin abstraer el sistema de ficheros.

## Criterios de aceptación

- [x] La reserva se toma antes de recibir un byte: una segunda subida que no cabe se rechaza mientras la primera aún no ha enviado nada.
- [x] Subidas simultáneas de una sesión no superan juntas los 20 archivos ni los 200 MB; consumir o dejar caducar un archivo preparado devuelve el hueco.
- [x] Con poco espacio libre, una subida que dejaría menos de 2 GB responde `INSUFFICIENT_STORAGE`, contando las reservas de las demás.
- [x] Un `ENOSPC` responde `DISK_FULL`, borra el temporal, libera la reserva y deja que la siguiente subida funcione.
- [x] Un cuerpo más corto y uno más largo que lo declarado responden `BODY_MISMATCH` sin restos.
- [x] Un minuto sin bytes, al principio y tras recibir parte, responde `UPLOAD_TIMEOUT`, sin esperar tiempo real; 59 s no.
- [x] La cancelación del cliente y la sesión revocada durante la recepción liberan la reserva y no dejan temporal ni archivo preparado.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `f78d40e`. Costuras para las tareas que siguen:
    - **Reservas.** `packages/platform/files/reservations.ts` (`createReservations`), en memoria y dentro de `createFiles`. Cada reserva va por el nombre de su temporal en `incoming/`: se toma antes de crear el fichero y se libera después de borrarlo. **Para la 06:** `files.inProgress(name)` (en `Files`, con `filesOf(platform)`) dice si un temporal es de una subida en curso; uno para el que da `false` es un resto que la limpieza puede borrar.
    - **Lo que cuenta contra la sesión.** Las subidas en curso de la sesión y sus archivos preparados con `consumed = 0` y `expires_at > ahora` (en el instante exacto de `expiresAt` ya no cuentan). **Para la 04:** consumir ya devuelve el hueco por esa consulta, pero la prueba de «consumir devuelve el hueco» no existe aún porque consumir llega con `attach`; la 04 debería añadirla en `packages/test-utils/upload-limits.test.ts` o con `probe`, y alinear su caducidad con esta regla.
    - **Costuras de prueba.** `createTestPlatform` gana `freeSpace: () => number` (sin valor, `statfs` real del volumen; en una máquina con menos de 2 GB libres todas las subidas responden `INSUFFICIENT_STORAGE`) y `diskFull: () => boolean`, preguntado antes de cada escritura del temporal. Llegan como `PlatformRuntime.freeSpace` y `.diskFull` (`TestBackgroundRuntime` en la entrada de pruebas). El cuerpo controlado es un `ReadableStream` normal con `duplex: "half"` por `browser().fetch`; la prueba sabe que la subida espera bytes (y tiene armado el minuto) cuando el temporal tiene el tamaño de lo enviado (`receiving()` en la prueba). El minuto usa `timer.at` de la plataforma: `test.clock.advance(60_000)` lo dispara.
    - **Parar una recepción.** `Receiving.stop(failure)` cancela el lector y la subida falla con ese error en su siguiente lectura; lo usan el minuto sin bytes, la señal de la petición y `close()`. La sesión se comprueba con cada trozo recibido.
    - Decisiones tomadas sin preguntar, también en la spec («Subir» y «Reservas de espacio»): reserva tras el nombre y antes del temporal; primero `UPLOAD_LIMIT` y después `INSUFFICIENT_STORAGE`; el límite es por sesión, no por persona; MB y GB en potencias de 1024 y espacio libre `bavail × bsize`; la recepción se corta en el primer trozo que pasa de lo declarado; la cancelación del cliente y el cuerpo cortado responden `INTERNAL_SERVER_ERROR`, que nadie lee; un `ENOSPC` en cualquier paso de la subida (no solo en la escritura) responde `DISK_FULL`. Las reservas restan el tamaño declarado entero aunque parte ya esté escrita y la vea `statfs`: se cuenta dos veces, del lado seguro, como dice la spec.
