# Las cuentas y las sesiones

## Qué es

Cómo entra cada persona en Domus y cómo sabe Domus quién pide cada cosa. Hay tres cuentas: la de Paco, que es el admin; la de Rocío, que es un miembro; y la cuenta de aparato, la de las pantallas que comparte toda la casa.

## Cómo funciona

Se entra con correo y contraseña. Nadie puede darse de alta solo. Las cuentas las crea alguien con acceso a la Pi, con un comando que pide la contraseña dos veces sin mostrarla en pantalla. El mismo comando sirve para cambiarla si se olvida, porque Domus no manda correos de recuperación.

Al entrar nace una sesión: una entrada abierta de una cuenta desde un aparato. Un aparato es un navegador concreto, el del móvil de Rocío o el del portátil de Paco, y no es lo mismo que la sesión: sigue siendo el mismo aparato después de cerrar sesión, y en un mismo navegador puede haber sesiones de las dos personas. Cada una ve y cierra solo las suyas, agrupadas por aparato. Si intenta cerrar una ajena, Domus responde lo mismo que si no existiera.

Domus recuerda la sesión con una cookie, un dato pequeño que el navegador guarda y devuelve en cada petición. Cada vez, Domus mira en la base de datos si esa sesión sigue viva. Por eso cerrar una sesión tiene efecto enseguida: si Paco cierra la sesión que se dejó abierta en otro ordenador, la siguiente petición desde ese ordenador ya no entra. Una sesión dura siete días.

Con esa cookie la puerta monta lo que llamamos el contexto verificado: quién pide la operación, desde qué aparato y con qué sesión. Todo sale de las credenciales y nada de lo que el navegador diga de sí mismo cuenta. Si una petición dice «soy Rocío» con la sesión de Paco, para Domus sigue siendo Paco.

Algunas operaciones son delicadas: cambiar lo que puede hacer otra persona o lo que puede hacer Kira, cerrar otra sesión o quitarle la entrada a un aparato compartido. Para esas no basta con tener la sesión abierta. Hay que volver a dar la contraseña y Domus entrega un comprobante, un permiso de un solo uso para esa operación exacta que caduca a los cinco minutos. Si alguien se deja el móvil desbloqueado en el salón, con la sesión sola no puede quitarle a Rocío el acceso a nada.

Cambiar la contraseña desde el comando cierra todas las sesiones de esa cuenta. Cambiarla desde la app pide la actual y deja abierta solo la sesión desde la que se cambia. En los dos casos se anulan los comprobantes y las confirmaciones que estuvieran esperando.

## Por qué es así

Somos dos personas. Un formulario de alta abierto solo serviría para que entrara quien no debe.

Separar aparato, sesión y cuenta permite cosas normales en una casa: pasarle el móvil a la otra persona, o cerrar la sesión de un ordenador sin tocar el resto.

Mirar la sesión en cada petición cuesta muy poco con una base de datos en la propia Pi, y a cambio cerrar una sesión cierra de verdad.

El comprobante está pensado para el descuido de un momento. Con él, un móvil abierto encima de la mesa no basta para tocar lo importante.

## En el código

- Cuentas y sesiones: Better Auth en `packages/platform/identity/auth.ts`, sobre las tablas `platform_user`, `platform_session` y `platform_account`; los aparatos en `platform_devices` y la cookie `domus.device`.
- El comando: `pnpm accounts create|password` en desarrollo y `node /app/accounts.mjs` en el contenedor `api`, con su núcleo en `packages/platform/identity/command.ts`. Cómo se usa en la Pi está en [`docs/despliegue.md`](../despliegue.md).
- El contexto verificado: `packages/platform/authorization/context.ts`. La puerta lo construye en `packages/platform/http`.
- Por HTTP: `POST /api/auth/sign-in/email` y `/sign-out`; `password/change`, `sessions/list`, `sessions/revoke`, `devices/revoke`, `delegation/read` y `proofs/request` bajo `/api/rpc/`, en `platformContract` de `@domus/platform/contracts`. El comprobante viaja en la cabecera `step-up-proof`.
- Comprobantes: la tabla `platform_proofs`.
- Configuración de `api`: `DOMUS_AUTH_SECRET` firma las sesiones y `DOMUS_ORIGINS` dice desde qué direcciones se sirve la app.
- Decisiones: [ADR 0006](../architecture/adr/0006-identidad-de-kira-y-aparatos.md) y [ADR 0023](../architecture/adr/0023-identidad-y-autorizacion.md).
