# 04. Suscripciones y la sesión habilitada del aparato

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Suscripciones», «Servicios de push admitidos» y las filas de suscribirse en «Errores de las rutas nuevas». Punto `entering` de la costura 2. ADR 0029.

## Qué construir

La app pide la clave pública, se suscribe a los avisos desde la sesión vigente del aparato y puede darse de baja. Cuando otra persona entra en ese navegador, la suscripción anterior deja de valer en el acto.

Garantías, antes que el mecanismo:

- Cada aparato tiene como mucho una sesión habilitada para avisos. Deja de estarlo en cuanto entra otra sesión en el aparato o termina la suya, y nunca vuelve a habilitarse una sesión anterior.
- Si falla la creación de una sesión, el aparato se queda sin sesión habilitada: no hay avisos, pero nunca de otra cuenta.
- Registrar una suscripción comprueba, en la misma transacción que la escribe, que su sesión es la habilitada. Una sesión antigua o un inicio de sesión concurrente no sustituyen a la vigente.
- Un endpoint pertenece a una sola suscripción y un aparato tiene como mucho una suscripción. Pasar un endpoint a otra sesión crea una suscripción nueva, con otro id.
- La suscripción muere con su sesión, sea cual sea la forma en que termina.

El mecanismo, el par `entry` del aparato y `deviceEntry` de la sesión escrito en `session.create.before`, está en la spec.

- **Migración generada de la plataforma**: `platform_push_subscriptions`, `platform_push_keys` y `entry` en `platform_devices`. La sesión gana `deviceEntry`, sin entrada del cliente.
- **Claves VAPID**: se generan al abrir la plataforma si no hay. El `subject` es el primer origen `https` de `DOMUS_ORIGINS`.
- **Rutas**: `GET /api/notifications/key`, `PUT /api/notifications/subscription` y `DELETE /api/notifications/subscription`, solo con sesión, con los errores en JSON sin el sobre RPC.
- **Autorización**: la decide `platform/authorization`. Las personas pueden; la cuenta `device`, `via` o una cuenta sin perfil, no.
- **Servicios admitidos**: una función pura valida el endpoint con la lista de la spec. La lista es una opción de la plataforma.
- **`notifications`**: la regla de dependencias de la plataforma deja fuera a los módulos y a `module-sdk`.

## Criterios de aceptación

- [ ] `GET /api/notifications/key` responde la clave pública, que es la misma tras cerrar y reabrir la plataforma sobre el mismo fichero.
- [ ] Una persona se suscribe y queda una suscripción de su aparato y su sesión. Suscribirse otra vez con lo mismo no cambia nada.
- [ ] La cuenta `device`, `via` y una sesión inexistente o caducada reciben `FORBIDDEN` o `UNAUTHORIZED`, según la tabla de errores.
- [ ] Un endpoint fuera de la lista responde `BAD_REQUEST` con `push-endpoint-not-allowed`. La función pura cubre cada host admitido, mayúsculas, sufijos y prefijos parecidos, IP, puerto explícito 443 y otro puerto, usuario, contraseña y esquema.
- [ ] Darse de baja borra la suscripción del aparato si es de esa sesión, y responde `204` también si no había.
- [ ] Paco se suscribe y Rocío entra en el mismo navegador sin suscribirse: la suscripción de Paco ya no está habilitada. Después Rocío cierra sesión, y la de Paco sigue sin estar habilitada.
- [ ] Una petición de suscribirse desde la sesión anterior del aparato responde `CONFLICT` con `session-not-enabled` y no toca la vigente.
- [ ] Con `entering`, en los dos órdenes de dos entradas en el mismo aparato, solo puede suscribirse la última en escribir su `entry`.
- [ ] Una creación de sesión que falla después de `entering` deja el aparato sin sesión habilitada.
- [ ] Pasar el mismo endpoint a otra sesión crea una suscripción con otro id y borra la anterior.
- [ ] Revocar la sesión borra su suscripción.
- [ ] La regla de dependencias de `notifications` salta en su prueba de arquitectura.
- [ ] La migración se aplica sobre una base de la 1d3, y dos generaciones seguidas no dejan cambios.
- [ ] `pnpm check` pasa.

Si la 03 o la 05 llegan antes a `main` con su propia migración, esta tarea regenera la suya encima.
