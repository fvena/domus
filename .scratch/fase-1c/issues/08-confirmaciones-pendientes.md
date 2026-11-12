# 08. Confirmaciones pendientes

Status: ready-for-agent
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

- [ ] **Unitarias de la decisión:** «siempre» una sola vez aunque la delegación diga `confirmar`; la regla del aparato compartido con y sin miembro reconocido; un área `alwaysPrivate` sin `confirmOnSharedDevice` no la aplica.
- [ ] **Pedir y confirmar con `probe`:**
    - la misma escritura y la misma lectura repetidas devuelven la misma pendiente;
    - la misma clave con otra entrada da `key-reused`;
    - por `app` funciona desde otra sesión propia, y desde otra cuenta da «no encontrado»;
    - por `contexto` fallan otro aparato, otra conversación, una conversación vacía y la ventana cerrada en el milisegundo exacto;
    - la caducidad se cumple en el milisegundo exacto;
    - rechazar funciona.
- [ ] **Una sola ejecución:** dos confirmaciones dan una ejecución; una lectura confirmada se ejecuta una vez, y repetir la confirmación da `confirmation-consumed`.
- [ ] **Persistencia:** tras cerrar y abrir sobre el mismo fichero, la pendiente sigue con sus plazos, y cambiar los plazos no altera las existentes.
- [ ] **Reevaluación:** quitar la delegación entre pedir y confirmar deniega; confirmar desde la app algo nacido vía Kira aplica la delegación del origen.
- [ ] **Operación exacta:** otra acción, otra entrada o un esquema que transforma la entrada no confirman la pendiente de otra operación.
- [ ] **Salud en el aparato compartido:** sin miembro reconocido no se lee `probe.health`; con miembro reconocido se lee una vez tras confirmar; una pendiente de salud confirmada desde la app no abre una lectura posterior por voz.
- [ ] **HTTP:** una escritura responde `CONFIRMATION_REQUIRED` y se confirma por `app`. Revocar la sesión o cambiar la contraseña invalidan las pendientes.
- [ ] Pasan todas las comprobaciones, y la generación no deja cambios.
