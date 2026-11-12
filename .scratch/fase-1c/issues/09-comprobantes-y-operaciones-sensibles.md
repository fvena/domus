# 09. Comprobantes y operaciones sensibles

Status: ready-for-agent
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

- [ ] **`configure`:** sin comprobante da `STEP_UP_REQUIRED`, y con uno funciona. No valen el comprobante de otra operación, de otra sesión, caducado en el milisegundo exacto o ya usado. Una operación revertida no lo gasta, y un reintento con la misma clave devuelve el acuse.
- [ ] **Denegaciones:** con `voice` o `device` se deniega. Vía Kira, cambiar el acceso o la delegación se deniega aunque haya comprobante.
- [ ] **Permisos y delegación:** el admin cambia los permisos de `member` y de `device` con comprobante; nadie cambia los suyos; un miembro no cambia la delegación de otro; el admin cambia la de la cuenta de aparato. Los cambios quedan en el registro.
- [ ] **Revocación:** revocar otra sesión propia y revocar un aparato de la cuenta de aparato exigen comprobante; revocar un aparato no toca sesiones de otras cuentas en otros aparatos.
- [ ] **Secretos:** la contraseña y el comprobante no aparecen en `log()`, en ninguna pendiente ni en ningún error.
- [ ] **HTTP:** el flujo completo de pedir el comprobante y usarlo. Cambiar la contraseña invalida los comprobantes.
- [ ] Pasan todas las comprobaciones, y la generación no deja cambios.
