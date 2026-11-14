# 01. Ajustes previos: la sesión caducada no vive y `no-store` en toda la API

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), secciones «Cuando termina una sesión» (la regla única de que una sesión vive) y «`no-store`». ADR 0029.

## Qué construir

Dos ajustes pequeños que preparan la 1d4 y no dependen de nada.

- **Una sesión caducada ha terminado aunque su fila siga en la base.** La regla única de que una sesión vive pasa a exigir también que no haya caducado, con el reloj de la plataforma. Cambia a la vez en todos sus usos: comprobantes, archivos preparados, la limpieza de preparados y las referencias de archivo. El canal y las entregas la usarán después.
- **Ninguna respuesta de la API se guarda en una caché.** Un middleware en `/api/*` pone `Cache-Control: no-store` en toda respuesta, también en los errores y en las rutas de Better Auth.

## Criterios de aceptación

Caducidad:

- [x] Con el reloj de pruebas pasado de su caducidad y la fila de la sesión todavía en la base, un comprobante de esa sesión ya no sirve.
- [x] En el mismo caso, un archivo preparado de esa sesión ya no se consume y la limpieza lo recoge.
- [x] Un instante antes de caducar, la sesión sigue viva en todos esos usos.
- [x] Las pruebas de la 1c y la 1d3 que ya cubren la sesión revocada siguen pasando.

`no-store`:

- [x] Una respuesta buena y un error de cada familia de rutas llevan `Cache-Control: no-store`: una RPC de la plataforma, una acción de `probe`, `POST /api/files`, `POST /api/files/download` y `/api/auth/*`.
- [x] `/health` y la web compilada no cambian.

- [x] `pnpm check` pasa.

## Comments

- Hecho en `93e898b`.
- La regla única recibe el instante: `sessionLives(connection)` da `(account, session, now)` y `sessionLivesWhere(session, account, now)` toma la expresión SQL del instante. Todos sus usos le pasan el reloj de la plataforma: subir un archivo (en cada trozo y antes de las filas), `ctx.files.attach`, la limpieza de preparados, el cambio de contraseña y los comprobantes. El canal (02) y las entregas (05) deben usarla igual.
- La comprobación de `actions/proofs.ts` que solo miraba si la fila existe se llama ahora `sessionExists`: decide si un comprobante queda atado a su sesión; si vive lo dice la regla. Pedir un comprobante desde una sesión caducada responde `UNAUTHORIZED`.
- Las confirmaciones pendientes siguen mirando solo que su sesión exista (`bound = 0 OR session IS NOT NULL`): no estaban en la lista de usos. Queda abierto si 08 las suma.
- En las pruebas, Better Auth pone la caducidad de las sesiones de `browser()` con la hora real, y la plataforma la mira con el reloj de pruebas. `test-utils` gana `test.sessionExpiresAt(session)` y las pruebas mueven el reloj hasta ella. Las sesiones de `prepare.session` caducan a los 7 días del reloj de pruebas: la prueba de la limpieza de comprobantes que llegaba al día 30 con una sesión preparada usa ahora un contexto sin sesión real. El hijo `hold: "publish"` recibe `now`.
- Para que la limpieza corra justo después de una caducidad: mover el reloj sin despertar (`{ wake: false }`) y después `background.setTime("cleanup", HH:MM)`; el planificador hace una sola pasada por tarea y fecha local.
- `no-store` es un middleware de Hono en `/api/*` de la puerta; la descarga conserva su propia cabecera. Las rutas de 02 y 04 lo heredan sin hacer nada.
- Segunda revisión de código: `replacePassword` recibe el reloj de la plataforma (`clock`), no un instante, y lo lee dentro de su transacción, después del hash; una sesión que se queda y caduca mientras se calcula el hash no cambia la contraseña (`SessionGoneError`, `UNAUTHORIZED` en la puerta). Lo prueba `identity/passwords.test.ts`, con el hash detenido en una compuerta.
