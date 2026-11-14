# 04. Suscripciones y la sesión habilitada del aparato

Status: resolved
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

- [x] `GET /api/notifications/key` responde la clave pública, que es la misma tras cerrar y reabrir la plataforma sobre el mismo fichero.
- [x] Una persona se suscribe y queda una suscripción de su aparato y su sesión. Suscribirse otra vez con lo mismo no cambia nada.
- [x] La cuenta `device`, `via` y una sesión inexistente o caducada reciben `FORBIDDEN` o `UNAUTHORIZED`, según la tabla de errores.
- [x] Un endpoint fuera de la lista responde `BAD_REQUEST` con `push-endpoint-not-allowed`. La función pura cubre cada host admitido, mayúsculas, sufijos y prefijos parecidos, IP, puerto explícito 443 y otro puerto, usuario, contraseña y esquema.
- [x] Darse de baja borra la suscripción del aparato si es de esa sesión, y responde `204` también si no había.
- [x] Paco se suscribe y Rocío entra en el mismo navegador sin suscribirse: la suscripción de Paco ya no está habilitada. Después Rocío cierra sesión, y la de Paco sigue sin estar habilitada.
- [x] Una petición de suscribirse desde la sesión anterior del aparato responde `CONFLICT` con `session-not-enabled` y no toca la vigente.
- [x] Con `entering`, en los dos órdenes de dos entradas en el mismo aparato, solo puede suscribirse la última en escribir su `entry`.
- [x] Una creación de sesión que falla después de `entering` deja el aparato sin sesión habilitada.
- [x] Pasar el mismo endpoint a otra sesión crea una suscripción con otro id y borra la anterior.
- [x] Revocar la sesión borra su suscripción.
- [x] La regla de dependencias de `notifications` salta en su prueba de arquitectura.
- [x] La migración se aplica sobre una base de la 1d3, y dos generaciones seguidas no dejan cambios.
- [x] `pnpm check` pasa.

Si la 03 o la 05 llegan antes a `main` con su propia migración, esta tarea regenera la suya encima.

## Comments

- Hecho en `81f467d`.
- Lo que la 05 usa: `sessionEnabledWhere(session)` en `identity/sessions.ts` es la condición SQL de que una sesión es la habilitada de su aparato (`device_entry` igual al `entry` del aparato); no dice si vive, eso sigue siendo `sessionLivesWhere`. La comprobación antes de cada envío debe usar las dos.
- La lista de servicios admitidos es `pushServices` del `PlatformRuntime` (como el reloj o `interleave`), con `PUSH_SERVICES` por defecto, y `endpointAllowed(endpoint, hosts)` es la función pura. `createPlatformWithClock` y `test-utils` todavía no la pasan: la opción `push` del servicio falso es de la 05. Las pruebas de la 04 usan endpoints de `fcm.googleapis.com`, que no se envían.
- `vapidSubject(origins)` está como función pura con su prueba; la plataforma aún no conoce `DOMUS_ORIGINS` (solo la puerta los tiene), así que llevarlos hasta la entrega es de la 05. Las claves están en `platform_push_keys` y `ensurePushKeys` las crea al abrir la plataforma.
- `notificationsOf(platform)` y `interleaveOf(platform)` son internos de la plataforma. El punto `entering` lo pasa la puerta a `createAuth`, que gana un tercer argumento con `entering` y `entered`.
- Cada inicio de sesión pasa ahora por `interleave("entering")`: una prueba con `interleave` que no mire el punto se para también al iniciar sesión. Dos pruebas de subida se arreglaron así.
- `test.subscriptions()` da cada suscripción como dato con `enabled` (su sesión vive con el reloj de la plataforma y es la habilitada).
- Decidido sin preguntar, y anotado en la spec: el orden de las comprobaciones de las rutas (sesión viva, autorización, cuerpo, endpoint, y en la transacción sesión viva y habilitada); el cuerpo estricto, que rechaza el `expirationTime` de `PushSubscription.toJSON()`; que las sesiones anteriores a la 1d4 no estén habilitadas hasta volver a entrar; y que darse de baja o pedir la clave con una sesión caducada responda `UNAUTHORIZED`.
- En la puerta, `fileRoute` pasó a llamarse `sessionRoute`, porque sirve también a las rutas de avisos.
- Revisión de código: el cuerpo de suscribirse admite el `expirationTime` opcional (número o nulo) de `PushSubscription.toJSON()` y lo ignora, así que la app puede mandar lo que da el navegador; cualquier otro campo, también dentro de `keys`, sigue siendo `BAD_REQUEST`. Cambia lo que decidió esta tarea, y la spec lo dice.
- Revisión de código: `no-store.test.ts` comprueba `Cache-Control: no-store` en `GET /api/notifications/key` y en `PUT` y `DELETE /api/notifications/subscription`, una respuesta buena y un error de cada una.
