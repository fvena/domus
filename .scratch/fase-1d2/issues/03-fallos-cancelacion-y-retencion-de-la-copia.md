# 03. Fallos, cancelación y retención de la copia

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «La tarea `backup`» (lo que sale de restic, retención, cancelación) y «Las marcas de las copias y el vigilante» (`backup-stale` y `backup-retention-failed`). ADR 0026.

## Qué construir

La copia que se porta bien cuando algo sale mal: aplica la retención, distingue los fallos de restic, se cancela de verdad y nunca deja la preparación llena. El vigilante avisa si las copias se paran o la retención falla.

- **`restic unlock`** antes de la copia, que solo quita bloqueos viejos.
- **Retención**: `forget --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune` con `--host domus`, después de una copia guardada, y su marca.
- **Lo que sale de restic**: `3` (copia parcial: no cuenta, no retiene, falla sin reintentos), `10` con un destino ausente o con contenido (falla sin reintentos y nunca reinicializa), `11` (error pasajero que el motor reintenta), `12` y los demás (fallan sin reintentos). El mensaje guardado lleva solo el paso y el código.
- **Retención fallida**: la ejecución termina fallida sin reintentos y con el mensaje de la retención; la copia sigue guardada con su marca.
- **Cancelación**: al agotar el tiempo máximo, `db.backup()` se aborta desde su callback de progreso; un hijo recibe SIGTERM y, si no termina en unos segundos, SIGKILL; el carril se libera solo cuando el hijo terminó.
- **La preparación** se vacía tras un fallo y una cancelación, y al empezar la ejecución siguiente tras una caída.
- **Marcas**: el intento fallido de copia y el resultado de la retención.
- **`/health`**: `backup-stale` (la última copia guardada se capturó hace más de 48 h, o no hay ninguna y hay un intento fallido) y `backup-retention-failed` (desaparece con una retención buena).
- **Ejecutables falsos de restic** en las pruebas, por la ruta que dejó la 01: copia parcial, bloqueo vigente, retención fallida y un proceso que ignora SIGTERM y avisa a la prueba cuando ya instaló su manejador.

## Criterios de aceptación

- [x] Con restic real, la retención deja 7 diarias, 4 semanales y 3 mensuales sobre instantáneas de días distintos.
- [x] Una copia parcial (código 3) no cuenta como guardada, no aplica la retención y falla sin reintentos.
- [x] Un destino con contenido, uno ausente y una contraseña incorrecta fallan sin reintentos, y el destino con contenido no se toca.
- [x] Un bloqueo vigente se reintenta y, cuando se libera, la copia se guarda.
- [x] Con la retención fallida, la copia queda guardada, la ejecución falla con su mensaje, `/health` dice `backup-retention-failed` y reintentar no crea otra instantánea; una retención buena después quita el motivo.
- [x] Un restic que ignora SIGTERM muere tras SIGKILL al agotar el tiempo máximo, y el carril queda libre solo entonces.
- [x] Abortar durante `db.backup()` cancela la ejecución y deja la preparación vacía.
- [x] La preparación queda vacía tras un fallo, una cancelación y una caída (al empezar la siguiente ejecución).
- [x] `backup-stale` no aparece justo antes de las 48 h ni exactamente a las 48 h desde la captura, y sí justo después.
- [x] Un primer intento fallido sin ninguna copia guardada da `backup-stale` y deja de dar `none-yet`.
- [x] `pnpm check` pasa.
