# 01. Llaves y el comando `keys`

Status: ready-for-agent
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

- [ ] `create kira` escribe en stdout la llave sola, con su salto de línea, y nada más. La llave tiene la forma acordada.
- [ ] `create` con una app fuera de la lista, o sin app, falla con su código, sin escribir nada en stdout.
- [ ] `list` muestra una línea por llave, con su id, su app, cuándo se creó, su último uso o ninguno, y si está revocada. Nunca muestra un secreto, tampoco sin llaves.
- [ ] `revoke` revoca una llave viva sin borrar su fila. Con una ya revocada no cambia nada y lo dice. Un id desconocido es un error.
- [ ] Puede haber dos llaves vivas de la misma app, y revocar una no toca la otra.
- [ ] Ningún error de `create`, `list` ni `revoke` contiene un secreto.
- [ ] La llave funciona contra la función de la plataforma que comprueba llaves, y ni `list` ni el fichero de la base, con su WAL, contienen el secreto.
- [ ] La función pura rechaza cada forma mala: otro prefijo, sin punto, longitudes erróneas y caracteres fuera de base64url.
- [ ] La prueba del bundle de `api` incluye `keys.mjs`: arranca, se para en su configuración y, ante un fallo, no escribe nada en stdout.
- [ ] La migración se aplica sobre una base de la 1d4, y dos generaciones seguidas no dejan cambios.
- [ ] `pnpm check` pasa.
