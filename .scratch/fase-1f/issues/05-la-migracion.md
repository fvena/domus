# 05. La migración

Status: resolved
Blocked by: 03, 04

Spec: [`../spec.md`](../spec.md), sección «La migración» y costura 2. ADR 0034 y ADR 0021.

## Qué construir

Una sola migración nueva de la plataforma deja la base sin rastro de las apps conectadas, conserva lo que la casa necesita y vale también para restaurar las copias hechas antes de la 1f.

- Fuera del esquema: la tabla de las llaves, la de los mandatos, y las columnas de «solo por `contexto`» y del cierre de su ventana de las confirmaciones. Con ellas desaparecen los restos de compatibilidad que dejó la 04.
- La migración se genera como las demás desde el esquema y lleva además, antes de quitar las columnas, la sentencia que borra las pendientes «solo por `contexto`». El generador no la deduce: se añade a la migración nueva antes de su commit, y dos generaciones seguidas siguen sin dejar cambios.
- Las migraciones anteriores no cambian.
- **La base anterior a la 1f** se prepara dentro de las pruebas, con el ejecutor de migraciones y solo hasta las de la 1e, sin abrir `createTestPlatform`, que aplicaría las actuales.

## Criterios de aceptación

- [x] Una instalación limpia y una base de la 1e actualizada quedan con el mismo esquema.
- [x] En esa actualización, una pendiente ordinaria sigue con sus datos y su caducidad, y una «solo por `contexto`» ya no está.
- [x] Los hashes de las migraciones anteriores no cambian, la base generada nunca se aplica, y dos generaciones seguidas no dejan cambios.
- [x] Con restic real, una base de la 1e con notas de `probe`, cerrada y copiada en el formato que espera restaurar, se restaura con `restoreBackup` y el código actual: la plataforma se abre, la migración nueva está aplicada y las notas siguen.
- [x] La plataforma de pruebas no gana ninguna opción para arrancar con migraciones a medias.
- [x] `pnpm check` pasa, y la CI no deja cambios tras `pnpm db:generate`.

## Comments

- Hecho en el commit «feat(platform): migrate away the keys, the mandates and the confirmation in context».
- La migración es `packages/platform/migrations/0017_damp_carlie_cooper.sql` (posición 18): borra `platform_keys` y `platform_mandates`, y luego, escrita a mano con un comentario que lo dice, `DELETE FROM platform_confirmations WHERE context_only = 1`, justo antes de quitar `window_closes_at` y `context_only`. drizzle-kit genera `DROP COLUMN` sin reconstruir la tabla. Dos `pnpm db:generate` seguidos no dejan cambios, y las migraciones anteriores (SQL, journal y `generated-migrations.ts`) solo ganan la nueva al final.
- Salen con ella los restos de la 04: el campo `contextOnly` de `PendingConfirmation`, su comprobación en `reachable`, las dos columnas del `INSERT` y la prueba que preparaba una pendiente antigua con un `UPDATE` (`actions/confirmations.test.ts`); `background/cleanup.test.ts` deja de escribir `window_closes_at`. `docs/agents/packages.md` queda al día.
- Las pruebas, en `tooling/scripts/phase-1e-database.test.ts`: es el único sitio que puede juntar el ejecutor de migraciones de la plataforma con `probe` y `test-utils` sin saltarse una regla de dependencias. La base de la 1e se escribe con `migrate` hasta `0016_complete_tomorrow_man` (la última de la 1e, por su tag) y las de `probe`, con la cuenta `ana`, notas y pendientes tal como las guardaba la 1e; luego la abre `createTestPlatform`, que aplica la migración nueva (una sola). La pendiente ordinaria se compara, columna a columna, con la fila escrita menos las dos que salen.
- Restaurar: la copia de la 1e, cerrada, se guarda con restic real desde su carpeta (`domus.db` en la raíz, host `domus`), y se restaura sobre una base viva de ahora que tiene una nota posterior; tras restaurar solo quedan las notas de la copia, la plataforma se abre sin migraciones pendientes y la historia de la plataforma termina en la nueva.
- «La base generada nunca se aplica» y los hashes ya los cubren `platform-migrations.test.ts` y `migrations.test.ts`, que siguen pasando.
- Revisión de código de la 1f, en el commit «fix(platform): act on the phase 1f code review»: deshacer vía el agente una entrada propia de los ajustes de las tareas (inversa `platform.setTaskTime`, `manage`) no se completa por sí mismo: sin fila se deniega, con `yes` pide un comprobante que el agente no puede traer, y con `confirm` espera a que la persona confirme desde la app con su comprobante; no era un fallo, y la historia 31 lo dice así. La inversa de un deshacer se autoriza ya como la misma escritura, con su `sensitive` y su `subject`, probado con una operación de la plataforma de prueba (`operations` del runtime de `openPlatform`). Además: una prueba `@ts-expect-error` de que el canal `contexto` y la identidad `voice` no compilan, el tipo `ProofAndConfirmation`, `proofBringer` y la JSDoc de `confirmed`, comentarios reajustados al ancho, el pasaje de Kira en `permisos.md`, el 401 de rutas desconocidas en «La puerta» y «la conversación» del glosario en la tarea 06.
