# 08. Confirmaciones pendientes

Status: resolved
Blocked by: 02, 06, 07

Spec: [`../spec.md`](../spec.md), secciones «Confirmaciones pendientes» y «La decisión» (pasos 2, 4 y 5). ADR 0023.

## Qué construir

La decisión «pedir confirmación» y las confirmaciones pendientes:

- **Cuándo se pide confirmación:** por la delegación (`confirmar`), por una acción que declara «pide confirmación siempre» (una sola vez, nunca dos) y por la regla del aparato compartido. Esa regla aplica a las áreas con `confirmOnSharedDevice`, no a todas las `alwaysPrivate`: con un miembro reconocido pide confirmación, y sin él se deniega.
- **La pendiente** se guarda en su propia transacción con la huella exacta, el tipo, la clave, el contexto de origen y los plazos absolutos (ventana de voz de 60 s y caducidad de 24 h, como opciones). Después se responde `CONFIRMATION_REQUIRED` con su id. La misma petición repetida devuelve la misma pendiente: una escritura por cuenta, `via` y clave, y una lectura por su huella y su sesión o conversación.
- **Confirmar** puede hacerse por `app` (la misma cuenta, cualquiera de sus sesiones) o por `contexto` (mismo aparato, misma conversación no vacía y ventana abierta; solo con contexto sintético). Al confirmar:
    - se vuelve a evaluar todo, con la delegación del origen;
    - una escritura se ejecuta con su clave y consume la pendiente en la misma transacción;
    - una lectura se ejecuta como mucho una vez, y su resultado sale solo en esa respuesta.
- **Rechazar.**
- **Errores:** `window-closed`, `confirmation-expired` y `confirmation-consumed`. Una pendiente ajena es «no encontrado».
- **Invalidación:** revocar la sesión de origen y cambiar la contraseña invalidan las pendientes. Aquí se completan las pruebas que la 04 dejó pendientes.
- **`probe`:** `deleteComment` declara que pide confirmación siempre, y `probe.health` usa la regla del aparato compartido.

## Aceptación

- [x] **Unitarias de la decisión:** «siempre» una sola vez aunque la delegación diga `confirmar`; la regla del aparato compartido con y sin miembro reconocido; un área `alwaysPrivate` sin `confirmOnSharedDevice` no la aplica.
- [x] **Pedir y confirmar con `probe`:**
    - la misma escritura y la misma lectura repetidas devuelven la misma pendiente;
    - la misma clave con otra entrada da `key-reused`;
    - por `app` funciona desde otra sesión propia, y desde otra cuenta da «no encontrado»;
    - por `contexto` fallan otro aparato, otra conversación, una conversación vacía y la ventana cerrada en el milisegundo exacto;
    - la caducidad se cumple en el milisegundo exacto;
    - rechazar funciona.
- [x] **Una sola ejecución:** dos confirmaciones dan una ejecución; una lectura confirmada se ejecuta una vez, y repetir la confirmación da `confirmation-consumed`.
- [x] **Persistencia:** tras cerrar y abrir sobre el mismo fichero, la pendiente sigue con sus plazos, y cambiar los plazos no altera las existentes.
- [x] **Reevaluación:** quitar la delegación entre pedir y confirmar deniega; confirmar desde la app algo nacido vía Kira aplica la delegación del origen.
- [x] **Operación exacta:** otra acción, otra entrada o un esquema que transforma la entrada no confirman la pendiente de otra operación.
- [x] **Salud en el aparato compartido:** sin miembro reconocido no se lee `probe.health`; con miembro reconocido se lee una vez tras confirmar; una pendiente de salud confirmada desde la app no abre una lectura posterior por voz.
- [x] **HTTP:** una escritura responde `CONFIRMATION_REQUIRED` y se confirma por `app`. Revocar la sesión o cambiar la contraseña invalidan las pendientes.
- [x] Pasan todas las comprobaciones, y la generación no deja cambios.

## Comments

- Hecho en `f6d8f7d`.
- Dónde está cada cosa: `decide` devuelve ahora `"allow" | "deny" | "confirm"`; `AuthorizationRequest` gana `kind` (`read`/`write`, la regla del aparato compartido solo mira lecturas) y `confirmed` (el requisito de confirmar cuenta como cumplido, y solo ese). Cada paso puede denegar o pedir; una denegación gana y se pide una sola vez. `decisionOf` falla cerrado como `isAllowed`, que sigue tratando `confirm` como no permitido: leer la delegación por Kira con `confirm` deniega (no hay pendientes de operaciones de la plataforma). `alwaysConfirm: true` va en el permiso de `readAction`/`writeAction` y llega como `RequiredPermission.alwaysConfirm`.
- Miembro reconocido: el aparato es compartido cuando el rol de `deviceAccount` es `device`; la cuenta representada distinta de `deviceAccount` es el miembro reconocido, y la propia cuenta de aparato se deniega.
- Pendientes: tabla `platform_confirmations` (migración `0004_vengeful_the_leader`, posición 5) y `platform/actions/confirmations.ts`. Guarda la operación (`{ action, input validado }` o `{ undo: entrada }`), la huella, la clave, el contexto de origen en JSON, los dos plazos absolutos y el estado (`pending`, `consumed`, `rejected`, `ended`). Plazos como opción `confirmation: { window, expiry }` de `createPlatform` y de `createTestPlatform`.
- Invalidación: la columna `session` tiene FK a `platform_session` con `ON DELETE SET NULL`, y `bound` dice si nació en una sesión real; si esa sesión desaparece (cerrar sesión, cambiar contraseña, la revocación de la 09, el borrado en cascada) la pendiente vale `ended` sin hacer nada más. Los contextos sintéticos con una sesión que no existe no quedan ligados. `replacePassword` marca `ended` todas las de la cuenta en su transacción (también las de la sesión que se conserva). Una pendiente `ended` o caducada responde `confirmation-expired`. **Para la 09:** revocar sesiones ya invalida sus pendientes por la FK; los comprobantes pueden seguir el mismo patrón, y `replacePassword` deja marcado dónde caducan.
- Confirmar/rechazar: `Actions.confirm`/`reject`, por HTTP en `/api/rpc/confirmations/confirm` y `/reject` (`platformContract.confirmations`, con `verifiedSession`, que pasa el contexto sellado; `signedIn` ya no copia el contexto). Por `app`: misma cuenta y sin `via` (Kira no se confirma a sí misma por la app). Por `contexto`: misma cuenta, mismo aparato y misma conversación no vacía; si no, «no encontrado». La reevaluación usa el contexto de ahora con la cuenta y el `via` del origen. Una escritura se ejecuta con su clave dentro de la transacción que consume la pendiente; una lectura, con `query_only` y la marca después. Una denegación al confirmar deja la pendiente esperando.
- `CONFIRMATION_REQUIRED` sale con estado 428 y `data: { confirmation: id }` (`confirmationRequiredData` en los contratos). Una clave que tiene una pendiente con otra huella da `key-reused` aunque la decisión fuera permitir. Una repetición de una escritura ya hecha devuelve el acuse aunque ahora se pidiera confirmación (no ejecuta ni enseña nada). Repetir la clave de una pendiente rechazada o caducada devuelve esa misma pendiente; hace falta otra clave.
- Deshacer también puede pedir confirmación: deshacer `addComment` corre `deleteComment`, que siempre pide, y la pendiente guarda `{ undo: entrada }` con su clave.
- La entrada que se ejecuta al confirmar es la ya validada, sin volver a validarla, para que un esquema que transforma no cambie la operación (`platform/actions/confirmations.test.ts`).
- `test-utils`: `confirm(contexto, id)`, `reject(contexto, id)` y `pendingFrom(() => …)`, que devuelve el id de la pendiente. `probe.deleteComment` pide siempre: las pruebas de 1b que lo usaban lo confirman ahora.
- No hay prueba propia de que `pnpm accounts password` invalide las pendientes: pasa por el mismo `replacePassword` que la prueba HTTP del cambio de contraseña.
