# 04. `pnpm accounts` y cambiar la contraseña

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Cuentas y Better Auth» y «Aparato y sesión» (mis sesiones). ADR 0023.

## Qué construir

Un único procedimiento para crear cuentas y recuperarlas, y la gestión de las sesiones propias:

- **`pnpm accounts`**, en el contenedor `api`, crea una cuenta (`admin` o `member`) y cambia una contraseña.
    - El secreto se pide de forma interactiva, sin eco. El análisis de argumentos rechaza la contraseña como argumento, y ni la salida ni los errores la incluyen.
    - Cambiar una contraseña con el comando revoca **todas** las sesiones de la cuenta.
    - Su núcleo es una función que recibe la plataforma, una forma de pedir el secreto y una salida.
- **Cambiar la propia contraseña desde la app**: es una operación de la plataforma que pide la actual y conserva **solo** la sesión actual.
- **Mis sesiones**: listar las propias, con su aparato, y cerrar la actual. Revocar otras sesiones exige comprobante y llega con la 09.

Los dos caminos de cambiar la contraseña invalidan también las pendientes y los comprobantes de la cuenta. Esas pruebas se completan en la 08 y la 09, cuando existan esas piezas.

## Aceptación

- [x] **Núcleo del comando,** con un proveedor falso del secreto y una salida capturada: crea `admin` y `member`; rechaza un correo repetido; cambiar la contraseña revoca todas las sesiones; ni la salida ni los errores contienen el secreto.
- [x] **Argumentos:** la prueba del análisis rechaza recibir la contraseña como argumento.
- [x] **HTTP:**
    - cambiar la contraseña desde la app pide la actual y conserva solo la sesión actual;
    - una sesión revocada falla en la petición siguiente;
    - listar sesiones devuelve solo las propias;
    - dos personas en el mismo navegador: al cambiar de cuenta se conserva el aparato y ninguna sesión de la primera pasa a la segunda.
- [x] Pasan todas las comprobaciones y el build.

## Comments

- Hecho en `cdc0e86` (y `63d931d`, que da a la cuenta nueva su delegación inicial con las áreas registradas, tras unir la 07).
- Dónde está cada cosa: `platform/identity/passwords.ts` (crear con contraseña, `replacePassword`, comprobar la actual, listar sesiones), `platform/identity/command.ts` (`parseAccountsArguments` y `runAccounts`, exportados desde `@domus/platform`) y `apps/api/src/accounts.ts`, el envoltorio que pide el secreto sin eco. Cada operación hace primero el hash, asíncrono, y luego escribe todo en una sola transacción síncrona.
- Operaciones de la plataforma por HTTP: este ticket fija el patrón. Van en `platformContract` (`@domus/platform/contracts`), anidadas por tema (`password.change` y `sessions.list`, en `/api/rpc/password/change` y `/api/rpc/sessions/list`), y la puerta las implementa en `http/index.ts` con `signedIn(context)`, que exige sesión y responde `UNAUTHORIZED` sin ella. Un módulo cuyo id coincide con un tema de la plataforma (`password`, `sessions`) se rechaza al arrancar. `test-utils` reexporta `platformContract` para que las pruebas de los módulos lo usen con `clientFor`. Leer la delegación por HTTP (la 07 lo dejó fuera) puede seguir el mismo patrón.
- Para la 08 y la 09: `replacePassword` marca dentro de su transacción dónde caducan las pendientes y los comprobantes de la cuenta; el comando y la app pasan los dos por ahí. Cerrar la sesión actual es el `/sign-out` de Better Auth. Revocar otra sesión (con comprobante) es de la 09 y no existe todavía. `sessions.list` devuelve el id de cada sesión, nunca su token, y su aparato sin su id: la cookie de aparato no es una credencial, pero conocer el id permite atribuir sesiones nuevas a ese aparato.
- Cambiar la contraseña desde la app: si la actual no es la correcta, responde `FORBIDDEN` con `reason: "wrong-password"` (declarado en el contrato); una nueva fuera de 8–128 caracteres responde `BAD_REQUEST` por el esquema. Si la sesión actual se revoca mientras se calcula el hash, no cambia nada y responde `UNAUTHORIZED`. No se usa la ruta de Better Auth, que sustituye también la sesión actual.
- Para la 11: la imagen `api` no tiene pnpm. En la Pi el comando es `docker compose exec api node /app/accounts.mjs create --email … --name … --role admin` (y `password --email …`); `pnpm build` genera `dist/accounts.mjs` junto a `main.mjs`. En desarrollo, `pnpm accounts …` usa `<repo>/data` como `pnpm dev` (los valores por defecto viven ahora en `apps/api/src/dev-env.ts`). Sin terminal (stdin que no es TTY) el comando se niega. Ojo: el `pnpm` de la raíz imprime la línea de la orden antes de ejecutarla, así que un `--password x` escrito por error aparece en esa línea aunque el comando lo rechace.
- La lista de sesiones descarta las caducadas con la hora real, no con el reloj de la plataforma, porque Better Auth decide la caducidad con la hora real.
