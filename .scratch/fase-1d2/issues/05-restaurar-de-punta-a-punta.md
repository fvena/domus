# 05. Restaurar de punta a punta, con retomar

Status: ready-for-agent
Blocked by: 01, 02, 03

Spec: [`../spec.md`](../spec.md), sección «Restaurar» entera, «Las marcas de las copias y el vigilante» (procedencia y antigüedad), «`apps/api` y la CI» (el comando y `restore.mjs list`) y, en «Decisiones de prueba», la costura 2. ADR 0026.

## Qué construir

El procedimiento entero de restaurar, seguro desde el primer día: un solo comando prepara, comprueba, migra y sanea la copia aparte, la instala con el intercambio de la spec y, si algo lo corta, la siguiente ejecución lo termina. Mientras la marca esté puesta, nada abre la base. La 06 lo demuestra con procesos cortados y casos de desastre; esta tarea no deja ninguna parte del procedimiento para después.

- **La función de restaurar** en `platform`, sin actor ni acciones, con la lista de módulos para sus migraciones. `module-sdk` no la ofrece.
- **El comando** `restore.mjs` en el build de `apps/api` y `pnpm restore` en la raíz: `list` (instantáneas del host `domus` con identificador y captura, sin cerrojo ni base) y restaurar la última o `--snapshot <id>`. Mensajes en inglés.
- **Cerrojo exclusivo** de la 02 durante todo el procedimiento, o se niega.
- **Preparar**: vaciar la carpeta de preparación de restaurar, dejar allí la base de la instantánea con restic, `quick_check`, validar el prefijo de migraciones con la misma validación del migrador y aplicar las que faltan, sanear en una transacción (trabajos `pending`, `running` y `stuck` a `cancelled` con `discarded by restore` y sus ejecuciones también; próximas ejecuciones desde ahora, las pausadas siguen pausadas; todas las sesiones cerradas; confirmaciones pendientes y comprobantes anulados como el cambio de contraseña, para todas las cuentas; procedencia y, si es más reciente, la copia guardada en las marcas), `journal_mode=DELETE`, cerrar sin WAL y `fsync` del fichero y su carpeta.
- **Instalar**, en el orden de la spec: carpeta `before-restore-<instante>` con enlaces duros de los ficheros que existan y `fsync` de cada fichero y de las dos carpetas; marca publicada de forma atómica (`restore.pending.tmp`, `fsync`, renombrado, `fsync` de la carpeta); borrar los auxiliares y `fsync`; renombrar la preparada sobre `domus.db` y `fsync` de las dos carpetas; borrar la marca y `fsync`; soltar el cerrojo.
- **Retomar**: con la marca puesta, repetir desde borrar los auxiliares con la carpeta que nombra la marca, sin volver a enlazar, y deducir por la presencia de la preparada si falta el renombrado.
- **La marca al abrir**: el camino común de abrir la plataforma, tras el cerrojo compartido y antes de `domus.db`, falla con `restore incomplete: run restore again` si hay marca, y con `restore marker unreadable` si no se puede leer. Restaurar también se niega con una marca ilegible.
- **Las invariantes** de la spec, escritas en el código donde se cumplen.
- **Puntos de corte** solo en la entrada de pruebas, sin forma de activarlos desde el comando de producción (los usa la 06).
- **CI**: el job `containers` ejecuta `restore.mjs list` con `--entrypoint node` y responde sin error con el repositorio vacío.

## Criterios de aceptación

Cada prueba usa una ruta temporal propia: preparar datos, copiar, cerrar, restaurar y volver a abrir sobre la misma ruta.

- [ ] Los datos de la copia vuelven y los posteriores no.
- [ ] Los trabajos pendientes, en curso y atascados de la copia quedan descartados y no corren; el mismo estado, reabierto sin restaurar, se recupera.
- [ ] Las próximas ejecuciones se calculan desde la restauración, y una tarea pausada sigue pausada.
- [ ] Las cookies de un `browser()` con sesión de antes de la copia y de después dejan de servir por HTTP.
- [ ] Una confirmación pendiente y un comprobante guardados antes ya no autorizan su operación.
- [ ] Una copia antigua recibe sus migraciones; una más nueva que el código y una migración que falla se rechazan sin tocar la base activa.
- [ ] Restaurar con la plataforma abierta se niega.
- [ ] Tras restaurar queda `before-restore-…` con el conjunto anterior, y no queda ningún auxiliar viejo junto a la base restaurada.
- [ ] Restaurar una copia de hace diez días deja `backup-stale` y no cambia la marca del `check`; la procedencia queda anotada.
- [ ] Con una marca válida puesta a mano en un estado intermedio, abrir se niega y restaurar otra vez termina sin volver a enlazar.
- [ ] Una marca ilegible bloquea abrir y restaurar.
- [ ] `restore list` muestra las instantáneas con su captura.
- [ ] El job `containers` ejecuta `restore.mjs list` sin error.
- [ ] `pnpm check` pasa.
