# 02. Repetir sin devolver contenido

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), sección «Resultados, registro y deshacer». ADR 0023, que precisa el ADR 0022.

## Qué construir

Una escritura deja de guardar su resultado: el contenido de la entrada pasa a ser la entrada y la inversa, y una migración generada de la plataforma retira la columna del resultado. Las respuestas quedan fijadas para escrituras y para deshacer:

- **La primera ejecución** devuelve el resultado y el número de la entrada.
- **Repetir** la misma clave con la misma huella vuelve a autorizar y devuelve el acuse `{ entry, repeated: true }`, sin contenido y sin ejecutar. Es el mismo acuse si el contenido caducó o si la entrada se deshizo después: «resultado caducado» deja de ser la respuesta a una repetición. La anotación conserva lo necesario para dar el acuse.
- **Con otra huella**, la respuesta sigue siendo `key-reused`.

La entrada y la inversa mantienen su caducidad, y un deshacer de una entrada caducada sigue respondiendo `expired`.

## Aceptación

- [x] Las pruebas de la 1b que comprobaban la devolución del resultado guardado se reescriben con el acuse, sin borrarlas: escritura y deshacer, contenido vigente y caducado, y tras reiniciar sobre fichero.
- [x] Repetir una escritura deshecha devuelve el acuse y no ejecuta.
- [x] `log()` ya no muestra ningún resultado, y la columna no existe tras migrar una base de la 1b.
- [x] Pasan todas las comprobaciones, y la generación no deja cambios.

## Comments

- Hecho en `95f10d3`.
- La migración generada es `platform/0002` (`0001_lively_sharon_carter`, posición 2): `drizzle-kit` 0.31 escribe un solo `ALTER TABLE platform_action_log DROP COLUMN result`, sin reconstruir la tabla, así que el índice único con `ifnull(via, '')` no se vuelve a emitir y no hubo que arreglar nada a mano. Se comprueba que corre sobre una base de la 1b con datos, que la columna desaparece, que la entrada se conserva y que la clave sigue siendo única (`audit.test.ts`), y que deja el mismo esquema que una instalación limpia (`platform-migrations.test.ts`). Cuidado en los tickets siguientes: un cambio que obligue a reconstruir `platform_action_log` (por ejemplo un `CHECK` o cambiar una columna) sí reemitiría ese índice roto, y habría que corregir el SQL generado antes de aplicarlo.
- Tipos: `platform/actions` devuelve `WriteOutcome = WriteReceipt | Acknowledgement` (`{ entry, repeated: true }`) en `invoke` de escrituras y en `undo`; `test-utils` lo refleja en `invoke` y `undo`. `KeyedEntry` ya no lleva `expiresAt`, y el conflicto `result-expired` desapareció del código.
- Para el ticket 10: al repetir un deshacer se vuelve a autorizar con la acción de la inversa (de la anotación de su propia entrada) y el contexto `undoes`; la entrada de la inversa solo va si el contenido de esa entrada sigue vigente, y si caducó la petición lleva `input: undefined`. Cuando el deshacer pase a decidirse por la cuenta representada y la delegación, esa petición puede cambiar.
- Las pruebas que cuentan migraciones de la plataforma (`migrator.test.ts`, `test-utils`, `audit.test.ts`, `platform-migrations.test.ts`) ya cuentan `platform/0002`; las de `platform-migrations.test.ts` leen la base sola y comparan las generadas con `generated-migrations.ts`, así que no hay que tocarlas con cada migración nueva.
