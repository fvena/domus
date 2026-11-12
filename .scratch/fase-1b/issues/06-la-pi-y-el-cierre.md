# 06. La Pi y el cierre de la 1b

Status: resolved
Blocked by: 05

Spec: [`../spec.md`](../spec.md), secciones «Puerta, `apps/api` y la Pi», «Decisiones de prueba» (pruebas de `tooling`) y «Notas». Plan: criterio de «terminada» de la 1b.

## Qué construir

La 1b corre en la Pi con `platform/0001` aplicada y queda cerrada en los documentos.

- `real-modules.test.ts`: la composición completa sigue funcionando y la lista de migraciones aplicadas incluye `platform/0001`. No repite las pruebas del registro.
- `docs/despliegue.md`: la comprobación de la 1a se amplía para leer también la fila de `platform/0001` y para comprobar que `status` sigue siendo la única RPC.
- En la Pi, tras desplegar `main`: la fila de `platform/0001` conserva posición, hash e instante de aplicación después de `docker compose restart api` y de recrear `api` conservando el volumen.
- Cierre: el estado de la 1b en `docs/plan.md` y la revisión de `docs/guia/` según `docs/AGENTS.md` (la 1b no cambia nada que vea la familia; como mucho, una mención en la parte de arquitectura), revisada con la skill `humanizer`.

## Aceptación

- [x] `real-modules.test.ts` comprueba `platform/0001`.
- [x] `docs/despliegue.md` describe la comprobación ampliada.
- [x] En la Pi, la comprobación da la misma fila de `platform/0001` antes y después de reiniciar y de recrear `api`, y `status` es la única RPC. Esta parte la hace una persona con acceso a la Pi.
- [x] `docs/plan.md` marca la 1b como hecha, con su fecha, y `docs/guia/` está al día.
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`.

## Comments

- Hecho en `5145813`: `real-modules.test.ts` comprueba que `platform/0001` (`0001_action_log`) está aplicada en la posición 1, justo después de `platform/0000`; `docs/despliegue.md` lee también esa fila y comprueba con `curl` que `status` es la única RPC (las rutas con forma de acción responden 404); `docs/guia/` gana el tema `acciones.md` y menciones en `README.md`, `arquitectura.md`, `modulos.md` y `datos.md`, revisados con `humanizer`; `docs/plan.md` anota en la 1d el punto abierto de la 05 (con qué petición se reautoriza el reintento de un deshacer cuya inversa caducó).
- Comprobado en local con `apps/api` construida: una base nueva aplica 2 migraciones y 0 al rearrancar, las filas de `platform` son `0000_migration_history` y `0001_action_log`, y las rutas `probe/listNotes`, `probe.listNotes` y `probe/addNote` responden 404.
- Quedan para una persona, después de fusionar en `main`: la comprobación en la Pi con los pasos de `docs/despliegue.md` («Comprobar» y «Comprobar que los datos persisten»), y marcar la 1b como hecha, con su fecha, en `docs/plan.md`.
- Revisión de código en `7d42c83`: cualquier excepción fuera del manejador (un esquema que lanza o responde tarde, el camino de lectura) sale como error interno sin detalle, y un manejador que devuelve una promesa revierte como error interno; un reintento caducado responde `result-expired` sin reautorizar ni leer el contenido, y un reintento de `undo` se reautoriza con la inversa que ejecutó su propia entrada (el punto abierto ya no pasa a la 1d: se quita del plan); nombres del glosario (`ActionLog`, `createActionLog`, `actionLogOf`, `idempotencyKey`); un solo `authorize`, una sola guarda de transacción y una sola conversión de fila en el registro; la acción registrada guarda tipo, esquemas y errores; `writeFingerprint`; `findNote` y `recordId` en probe; `createPlatformWith` es una reexportación; la guía explica «la puerta» y aclara la frase de «cada cambio» del `README.md`.
- Segunda revisión, en `2c0990e`: el registro guarda la entrada de la inversa tal como la da el manejador, y deshacer la valida una sola vez y autoriza y ejecuta esa misma entrada (antes, un `transform` se aplicaba dos veces); los constructores de errores del contrato exigen los datos que pide su esquema, porque los de oRPC dejaban pasar cualquiera con este compilador, y unos datos que no cumplen el esquema salen como error interno.
- Comprobado en la Pi el 2026-11-12 con `main` en `031ce35`: el primer arranque anota `1 migrations applied` y los siguientes `0`; las filas de `platform/0000` y `platform/0001` (`0001_action_log`, hash `1cf2a3b8…`, `applied_at` `1794481424023`) son las mismas tras `restart` y tras recrear `api`; `status` responde `protocol` `1` y `probe/listNotes`, `probe.listNotes` y `probe/addNote` responden 404; los tres contenedores salen `healthy`. La 1b queda hecha en `docs/plan.md`.
