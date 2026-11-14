# 01. Llaves y el comando `keys`

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), secciones «Apps conectadas», «Llaves» y «El comando `keys`». ADR 0030.

## Qué construir

La llave de una app conectada, de punta a punta, antes de que la puerta la use. El admin crea la llave de Kira con un comando en el contenedor `api`, la redirige a un fichero sin verla, la lista y la revoca. La base guarda solo su hash.

- **La lista fija de apps** en la plataforma, cada una con su nombre (el futuro `via`) y si puede recibir mandatos. En producción solo `kira`, que puede.
- **La tabla de llaves**, en una migración generada de la plataforma: el id, la app, el SHA-256 del secreto, cuándo se creó, el último uso y cuándo se revocó. Nunca el secreto.
- **La forma** `domus_<id>.<secreto>`: el id son 8 bytes aleatorios en base64url y el secreto 32 bytes en base64url. Leer y validar esa forma es una función pura.
- **El núcleo del comando**, como el de `accounts`: `parseKeysArguments` y `runKeys(platform, orden, terminal)`, con su texto de uso, para `create <app>`, `list` y `revoke <id>`. Los códigos de salida son 0, 1 y 2.
- **El cableado** en `api` (`pnpm keys` en desarrollo, `node /app/keys.mjs` en el contenedor) y `keys.mjs` en el bundle. Abre la plataforma con el cerrojo compartido y no pide TTY.

## Criterios de aceptación

- [x] `create kira` escribe en stdout la llave sola, con su salto de línea, y nada más. La llave tiene la forma acordada.
- [x] `create` con una app fuera de la lista, o sin app, falla con su código, sin escribir nada en stdout.
- [x] `list` muestra una línea por llave, con su id, su app, cuándo se creó, su último uso o ninguno, y si está revocada. Nunca muestra un secreto, tampoco sin llaves.
- [x] `revoke` revoca una llave viva sin borrar su fila. Con una ya revocada no cambia nada y lo dice. Un id desconocido es un error.
- [x] Puede haber dos llaves vivas de la misma app, y revocar una no toca la otra.
- [x] Ningún error de `create`, `list` ni `revoke` contiene un secreto.
- [x] La llave funciona contra la función de la plataforma que comprueba llaves, y ni `list` ni el fichero de la base, con su WAL, contienen el secreto.
- [x] La función pura rechaza cada forma mala: otro prefijo, sin punto, longitudes erróneas y caracteres fuera de base64url.
- [x] La prueba del bundle de `api` incluye `keys.mjs`: arranca, se para en su configuración y, ante un fallo, no escribe nada en stdout.
- [x] La migración se aplica sobre una base de la 1d4, y dos generaciones seguidas no dejan cambios.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `SHA`.
- El núcleo está en `platform/identity/keys.ts` (la lista `CONNECTED_APPS`, `parseKey`, `createKey`, `listKeys`, `revokeKey` y `checkKey`) y en `identity/keys-command.ts` (`parseKeysArguments`, `runKeys`, `KEYS_USAGE`). `runKeys` es síncrono; su terminal tiene `print` (stdout), `inform` y `fail` (stderr).
- `createKey` y `checkKey` reciben la lista de apps como argumento: la 02 puede pasarles la lista con las apps de prueba (`test.prepare.key(app)` y la opción `apps`) sin tocar la de producción. `runKeys` usa siempre `CONNECTED_APPS`.
- `checkKey` devuelve `{ ok: true, id, app }` o `{ ok: false, reason }`, con `reason` entre `malformed`, `unknown`, `wrong-secret`, `revoked` y `unknown-app`, solo para el log de quien opera. No anota el último uso: lo hace la 02. La columna es `last_used_at`; la prueba de `list` la rellena por SQL como preparación hasta entonces.
- La tabla es `platform_keys` (`id`, `app`, `secret_hash` en hex, `created_at`, `last_used_at`, `revoked_at`), en la migración `0015`, sola. La spec decía que los mandatos iban en la misma migración, pero la 03 los trae en la suya, como dicen los tickets.
- Decisiones de detalle, también en la spec («El comando `keys`»): `create` dice en stderr el id de la llave creada; el formato de `list`; revocar una ya revocada sale con 0; los argumentos se validan por forma con el código 2, y `revoke` exige un id de 11 caracteres, así que una llave entera pegada por error se rechaza sin repetirla; un nombre de app solo se repite si tiene forma de nombre, y una app fuera de la lista sale con 1.
- `pnpm keys` (dotenv y `pnpm --silent`) deja stdout limpio: la línea `$ dotenv …` va a stderr. Su código de salida es el de pnpm (1), no el 2 del comando; en el contenedor, `node /app/keys.mjs`, sí es el 2.
