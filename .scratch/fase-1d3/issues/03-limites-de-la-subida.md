# 03. Límites de la subida

Status: ready-for-agent
Blocked by: 02

Spec: [`../spec.md`](../spec.md), secciones «Subir» (el minuto sin bytes y el cuerpo que no coincide), «Reservas de espacio» y las filas de límites de «Errores de las rutas de archivos». Costura 1 de «Decisiones de prueba».

## Qué construir

Que subir no pueda llenar el NVMe ni dejar una subida colgada. Todo con un cuerpo que controla la prueba y el reloj de pruebas, sin esperar tiempo real.

- **Reservas** en memoria de `api`, tomadas antes del primer byte con el `Content-Length`: contra la sesión (20 archivos o 200 MB, sumando subidas en curso y archivos preparados vigentes y sin consumir) y contra el espacio libre leído con `statfs` menos todas las reservas vivas (tienen que quedar 2 GB). Se liberan al terminar, fallar, cancelar o cortarse la conexión.
- **Errores**: `UPLOAD_LIMIT`, `INSUFFICIENT_STORAGE`, `DISK_FULL` (con `ENOSPC` al escribir: temporal borrado y reserva liberada), `BODY_MISMATCH` (cuerpo más corto o más largo que lo declarado) y `UPLOAD_TIMEOUT` (un minuto sin bytes en cualquier momento, contado con el reloj y el temporizador de la plataforma). Una sesión revocada durante la recepción termina con `UNAUTHORIZED`.
- **Costura**, solo en la entrada de pruebas: un cuerpo de subida que entrega trozos cuando la prueba quiere, la función de espacio libre y el fallo `ENOSPC` inyectado en la escritura del temporal, sin abstraer el sistema de ficheros.

## Criterios de aceptación

- [ ] La reserva se toma antes de recibir un byte: una segunda subida que no cabe se rechaza mientras la primera aún no ha enviado nada.
- [ ] Subidas simultáneas de una sesión no superan juntas los 20 archivos ni los 200 MB; consumir o dejar caducar un archivo preparado devuelve el hueco.
- [ ] Con poco espacio libre, una subida que dejaría menos de 2 GB responde `INSUFFICIENT_STORAGE`, contando las reservas de las demás.
- [ ] Un `ENOSPC` responde `DISK_FULL`, borra el temporal, libera la reserva y deja que la siguiente subida funcione.
- [ ] Un cuerpo más corto y uno más largo que lo declarado responden `BODY_MISMATCH` sin restos.
- [ ] Un minuto sin bytes, al principio y tras recibir parte, responde `UPLOAD_TIMEOUT`, sin esperar tiempo real; 59 s no.
- [ ] La cancelación del cliente y la sesión revocada durante la recepción liberan la reserva y no dejan temporal ni archivo preparado.
- [ ] `pnpm check` pasa.
