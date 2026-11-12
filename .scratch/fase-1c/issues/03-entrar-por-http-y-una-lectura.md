# 03. Entrar por HTTP y una lectura permitida de punta a punta

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Cuentas y Better Auth» (sin el comando), «Aparato y sesión» (alta del aparato), «El contexto verificado», «Áreas, permisos y perfiles» (sin cambiar permisos), «La decisión» (pasos 1 y la denegación), «HTTP y la puerta» y «`module-sdk`, `test-utils` y la entrada de pruebas». ADR 0023.

## Qué construir

El trazador de la 1c: una persona inicia sesión por HTTP y ejecuta una lectura de `probe` por `api-client`, que recorre la autorización real.

Piezas que llegan con esta tarea:

- **Cuentas.**
    - Better Auth en `platform` con correo y contraseña, sus tablas en el esquema de la plataforma, el registro abierto desactivado y la sesión sin caché en la cookie.
    - El perfil de cada cuenta.
    - La única cuenta de aparato, creada al arrancar sin contraseña.
- **Aparato y contexto.**
    - El aparato, con su cookie propia. Nace al iniciar sesión si falta y se conserva al cerrar sesión y volver a entrar. La sesión guarda en el servidor su aparato.
    - El contexto verificado: la puerta lo construye desde la sesión e ignora lo que declare el cliente. Por HTTP, `via` va siempre vacío, el canal es `app` y la identidad es `password`.
- **Permisos.**
    - Las áreas, que declara el módulo, con la de la plataforma.
    - El permiso declarado en cada contrato (área y nivel), comprobado al arrancar.
    - La decisión pura por área y nivel, con los valores por defecto de cada perfil y la sustitución por fila.
    - La autorización de producción, que sustituye a la que lo denegaba todo.
- **Puerta.** Las acciones y las rutas de Better Auth montadas en la puerta. Sin sesión, no autenticado.
- **Pruebas.** `createTestPlatform` con la autorización real por defecto, la preparación privilegiada (cuentas, perfiles y filas de permisos) y los contextos verificados sintéticos. El autorizador programable queda solo para las pruebas internas de `platform`.
- **`probe`.** Declara su área y el permiso de cada acción.

Ningún estado intermedio abre lo que todavía no está protegido: en esta tarea todavía no existen tablas con dueño. La 05 rechaza en producción los módulos que las tengan hasta que la 06 añade la captura.

## Aceptación

- [x] **Unitarias de la decisión:** niveles acumulativos, valores por defecto por perfil, sustitución por fila, el admin no baja de `manage`, y una excepción deniega.
- [x] **Al arrancar** se rechazan: un área no registrada, una escritura con `read` y una acción sin permiso.
- [x] **`probe` con `createTestPlatform`:** `member` lee y escribe; la cuenta de aparato con `read` no escribe; una fila que baja a ninguno deniega.
- [x] **HTTP:**
    - sin sesión, no autenticado;
    - iniciar sesión crea un aparato, y cerrar y volver a entrar lo conserva;
    - el registro abierto está desactivado;
    - una lectura permitida funciona por `api-client` con las cookies gestionadas explícitamente;
    - una escritura denegada falla;
    - cuenta, `via`, aparato, canal, identidad y conversación declarados por el cliente se ignoran o se rechazan.
- [x] **Reglas de dependencias:** producción no alcanza la preparación privilegiada, los contextos sintéticos ni el autorizador programable. `web` no alcanza `platform/authorization` ni por caminos indirectos.
- [x] Pasan todas las comprobaciones y el build, y la generación no deja cambios.

## Comments

- Hecho en `42ad80a`.
- Dónde está cada cosa en `platform`: `identity/auth.ts` (Better Auth sobre la conexión única con el adaptador de Drizzle, `cookieCache` apagado, la cookie `domus.device` en el hook `session.create.before`), `identity/accounts.ts` (filas de cuenta, rol, contraseña, permisos y la cuenta de aparato creada al arrancar), `identity/access.ts` (la vista que lee la autorización), `authorization/context.ts` (el contexto verificado: solo vale uno sellado con `sealContext`; una copia da error interno) y `authorization/index.ts` (`decide`, puro, con los pasos 2 a 5 marcados en comentarios para la 07, 08 y 09).
- La migración generada es `0002_milky_shen` (posición 3, después de la de la 02, que se integró antes: al unir las ramas borré la mía y la generé de nuevo sobre la suya): tablas `platform_user`, `platform_session` (con `device_id`), `platform_account`, `platform_verification`, `platform_devices`, `platform_roles` (con un índice único parcial que deja una sola cuenta `device`) y `platform_permissions`.
- El perfil se llama `role` en el código, como dice el glosario. Un permiso guardado es `none`, `read`, `write` o `manage`; el admin ignora sus filas.
- Áreas: `defineModule({ areas: { "probe": {}, "probe.x": { alwaysPrivate } } })`; la del módulo existe aunque no se declare. `AreaDefinition` solo tiene `alwaysPrivate` (lo pide el valor por defecto de `device`); la 05 añade el resto. `areaIds` se exporta de `module-sdk` para que la plataforma registre las áreas.
- Contratos: `readAction({ level })` y `writeAction({ undoable, level })`, con `area` opcional. `checkModules` rechaza al arrancar un área sin registrar, una escritura con `read` y una acción sin permiso. La 08 añade «pide confirmación siempre» a la misma metadata.
- `AuthorizationRequest` lleva `context` (el contexto verificado), `action`, `permission` (área y nivel ya resueltos), `input` y `undoes`. `Decision` sigue siendo `"allow" | "deny"`: la 05 añade el motivo `not-found` y la 08 y la 09 las otras dos.
- `ActionCall` y `UndoCall` llevan `context` en vez de `actor`; el manejador sigue recibiendo solo el actor (`actorOf`). No he tocado `once` ni `perform` más allá de eso.
- La puerta sirve cada acción en `/api/rpc/<módulo>/<acción>` con `api-client` y un contrato `{ probe: probeContract }`. La clave de idempotencia viaja en la cabecera `idempotency-key`, que `api-client` pone desde `{ context: { idempotencyKey } }`. De Better Auth solo pasan `POST /api/auth/sign-in/email` y `/sign-out` (lista en `http/index.ts`); el cambio de contraseña de la 04 es una operación propia, no la ruta de Better Auth. Sin sesión, `UNAUTHORIZED` (401).
- Abierto: por HTTP una escritura devuelve el recibo (`{ result, entry }`, o el acuse de la 02), pero el tipo que da `api-client` con el contrato del módulo dice que devuelve el resultado. Hay que decidir el tipo de las escrituras en el cliente antes de que la web las use.
- Abierto para la 11: `api` pide `DOMUS_AUTH_SECRET` (32 caracteres o más) y `DOMUS_ORIGINS`; `docker-compose.yml` los lee de `.env` y `docs/despliegue.md` lo explica. Better Auth usa `baseURL` dinámico con los hosts de `DOMUS_ORIGINS`; falta comprobar en la Pi la cookie `Secure` por Tailscale (https) y por `kira.local` (http).
- `createTestPlatform` ya no tiene `authorize` ni `actor`: usa la autorización real, `prepare.account/password/grant`, `deviceAccount`, `context(cuenta, opciones)`, `member(id, opciones)` (crea el miembro la primera vez) y `browser()`, un navegador de prueba que guarda las cookies a la vista. El autorizador programable queda en `openPlatform(…, { authorizer })`, solo para las pruebas internas de `platform`. Las pruebas de `probe` que lo usaban ahora bajan el permiso con una fila; las que miraban la forma de la petición pasaron a `platform/actions`.
- Regla nueva `production-never-reaches-platform-testing` en `.dependency-cruiser.cjs`, con su caso en los fixtures; la de `web` hacia `platform/authorization` por un camino indirecto también tiene caso.
