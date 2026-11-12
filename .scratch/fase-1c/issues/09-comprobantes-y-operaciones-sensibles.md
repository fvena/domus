# 09. Comprobantes y operaciones sensibles

Status: resolved
Blocked by: 04, 07, 08

Spec: [`../spec.md`](../spec.md), secciones «Comprobantes», «Áreas, permisos y perfiles» (cambiar permisos), «Delegación» (quién la cambia), «Aparato y sesión» (revocar) y «La decisión» (paso 3). ADR 0023.

## Qué construir

Un mecanismo común de comprobantes y las operaciones sensibles que lo usan:

- **Pedir un comprobante** es una operación de la plataforma. Recibe la contraseña y la operación (acción y entrada, u operación de la plataforma con su entrada), y devuelve un comprobante aleatorio ligado a la cuenta, la sesión, el aparato y la huella. Es de un solo uso, vale 5 minutos y en la base solo se guarda su hash.
- **Usarlo:** se valida y se consume en la misma transacción que la operación. Una operación revertida no lo gasta, y un reintento idempotente devuelve el acuse. Si falta o no coincide, la respuesta es `STEP_UP_REQUIRED`.
- **Operaciones sensibles:**
    - cambiar permisos (solo el admin, sobre `member` y `device`);
    - cambiar la delegación (cada persona la suya; la de la cuenta de aparato, el admin);
    - revocar otras sesiones propias;
    - revocar sesiones o un aparato de la cuenta de aparato. Revocar un aparato cierra todas sus sesiones e invalida sus pendientes y comprobantes, y es distinto de revocar mis sesiones en un navegador;
    - la acción `manage` de `probe` (`configure`).
- **Denegaciones:** con identidad `voice` o `device`, una operación sensible se deniega. Vía Kira, cambiar el acceso o la delegación se deniega siempre, aunque traiga comprobante.
- **Con confirmación:** una operación sensible que también pide confirmación exige el comprobante al confirmar.
- **Invalidación:** cambiar la contraseña o revocar la sesión invalida los comprobantes. Aquí se completan las pruebas que la 04 dejó pendientes.

## Aceptación

- [x] **`configure`:** sin comprobante da `STEP_UP_REQUIRED`, y con uno funciona. No valen el comprobante de otra operación, de otra sesión, caducado en el milisegundo exacto o ya usado. Una operación revertida no lo gasta, y un reintento con la misma clave devuelve el acuse.
- [x] **Denegaciones:** con `voice` o `device` se deniega. Vía Kira, cambiar el acceso o la delegación se deniega aunque haya comprobante.
- [x] **Permisos y delegación:** el admin cambia los permisos de `member` y de `device` con comprobante; nadie cambia los suyos; un miembro no cambia la delegación de otro; el admin cambia la de la cuenta de aparato. Los cambios quedan en el registro.
- [x] **Revocación:** revocar otra sesión propia y revocar un aparato de la cuenta de aparato exigen comprobante; revocar un aparato no toca sesiones de otras cuentas en otros aparatos.
- [x] **Secretos:** la contraseña y el comprobante no aparecen en `log()`, en ninguna pendiente ni en ningún error.
- [x] **HTTP:** el flujo completo de pedir el comprobante y usarlo. Cambiar la contraseña invalida los comprobantes.
- [x] Pasan todas las comprobaciones, y la generación no deja cambios.

## Comments

- Hecho en `17d3f78`.
- Dónde está cada cosa: `platform_proofs` (migración `0005_perfect_ultragirl`, posición 6) guarda solo el SHA-256 del comprobante, ligado a la cuenta, la sesión de origen (`origin_session`, y `session` con FK `ON DELETE SET NULL` y `bound`, el mismo patrón que las pendientes), el aparato y la huella; estado `issued`/`used`/`ended` y `entry`, la entrada que lo usó. `platform/actions/proofs.ts` lo emite, lo comprueba, lo usa y lo termina (`endProofsOf`, que llama `replacePassword`, y `endProofsOnDevice`); `platform/identity/proofs.ts` tiene `requestProof` (comprueba la contraseña de forma asíncrona y lo guarda en una transacción síncrona; con `voice`/`device`, `FORBIDDEN`; contraseña mala, `WrongPasswordError`, que la puerta da como `FORBIDDEN` con `reason: "wrong-password"`).
- `decide` devuelve también `"step-up"`. `AuthorizationRequest` gana `sensitive` (`permissions`, `delegation`, `sessions`) y `proof` (`valid`/`invalid`, lo que valió; el comprobante nunca llega a la autorización). Paso 3: nivel `manage` o `sensitive` → con `voice`/`device` deniega; vía Kira, `permissions` y `delegation` deniegan siempre; sin comprobante válido, `step-up`. Un comprobante que «sobra» (operación no sensible) también da `step-up`. La confirmación va primero: con las dos, pide confirmar y el comprobante se exige al confirmar (`Actions.confirm` recibe `proof`). Cambiar permisos tiene su regla: solo el admin, con `subject` de rol `member` o `device`.
- Las operaciones sensibles de la plataforma (`identity/operations.ts`: `setPermission`, `setDelegation`, `revokeSession`, `revokeDevice`) se registran en el mismo registro de acciones como `platform.<nombre>`, escrituras del área `platform` de nivel `write`, con clave, sin registros tocados y no deshacibles; quedan en el registro con `module = "platform"`. Su entrada se declara en `SENSITIVE_INPUTS` de `@domus/platform/contracts`. Por HTTP: `permissions/set`, `delegation/set`, `sessions/revoke`, `devices/revoke` y `proofs/request`. El comprobante viaja en la cabecera `step-up-proof`, que `api-client` pone desde `{ context: { proof } }`. `STEP_UP_REQUIRED` sale con estado 403 y sin datos.
- Uso: en una escritura el comprobante se marca usado antes del manejador y se enlaza a su entrada después, todo en la transacción, así que una escritura revertida lo deja sin usar. Un reintento con la misma clave vuelve a autorizar con el comprobante: vale el que usó esa misma entrada; sin comprobante da `STEP_UP_REQUIRED`. En una lectura sensible se marca tras validar el resultado. Para pedir uno de un deshacer, la operación es `{ undo: entrada }`.
- Revocar un aparato: se nombra por una sesión de la cuenta de aparato (la lista de sesiones no da ids de aparato). Cierra todas las sesiones de ese aparato, de cualquier cuenta, termina sus comprobantes y pendientes (estas por `json_extract(origin, '$.device')`) y borra la fila del aparato, así que un inicio de sesión con su cookie crea uno nuevo. Revocar la sesión actual con `sessions/revoke` da `BAD_REQUEST` (se cierra con `/sign-out`).
- `probe.configure` (nivel `manage`, no deshacible) pone todas las notas propias en privado o público; sin notas propias da `NO_NOTES`, que sirve para probar que una operación revertida no gasta el comprobante.
- `test-utils`: `requestProof`, `setPermission`, `setDelegation`, `revokeSession`, `revokeDevice`, `hasSession`, `prepare.session(cuenta, aparato?)` (abre una sesión real, para contextos sintéticos ligados a ella), `proof` en las opciones de `invoke`, `undo` y `confirm`.
- Abierto: el admin no puede listar por HTTP las sesiones de la cuenta de aparato (`sessions/list` solo da las propias); en la 1c la cuenta de aparato no inicia sesión por HTTP, así que no hay ninguna. Entra con el emparejamiento (fase 3). Tampoco hay forma de que la prueba lea una pendiente: que el comprobante no entra en ella se comprueba porque confirmarla vuelve a pedirlo.
