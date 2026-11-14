# Despliegue en la Raspberry Pi

La Pi se llama `kira`: `kira.local` en casa y `kira.taildd967b.ts.net` por Tailscale. Se entra con `ssh kira`.

| Qué          | Dónde                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Código       | `/home/fvena/domus`, un clon de `fvena/domus` en la rama `main`                                                                                 |
| Contenedores | `api`, `assistant` y `voice-gateway`, del proyecto de compose `domus`                                                                           |
| Datos        | el volumen `domus_domus-data`, montado solo en `api`                                                                                            |
| Archivos     | `/data/files` en ese volumen: los contenidos en `contents/` y las subidas en curso en `incoming/` (ver «Los archivos»)                          |
| Secretos     | `/home/fvena/domus/.env`, fuera de git (ver «Secretos»)                                                                                         |
| Copias       | el repositorio de restic en `/srv/backups/domus` y su contraseña en `/home/fvena/.config/domus/backup-password` (ver «Las copias de seguridad») |
| Acceso       | `http://kira.local:3000` en casa; `https://kira.taildd967b.ts.net` por Tailscale, solo dentro de la red (`tailscale serve` → `:3000`)           |

Las imágenes se construyen en la propia Pi, que es arm64, en unos 30 segundos. Docker arranca con el sistema y los contenedores tienen `restart: unless-stopped`, así que vuelven solos tras un corte de luz.

## Actualizar

```bash
ssh kira 'cd ~/domus && git pull --ff-only && docker compose up -d --build'
```

Se construyen y reinician los tres a la vez. Si `api` cambia de `protocol` y los otros dos no, se quedan en «incompatible» y no hacen nada hasta tener la misma versión (ADR 0020).

Desde la 1c, `docker compose` no arranca sin `DOMUS_AUTH_SECRET` en `.env`, y desde la 1d2, sin `DOMUS_BACKUP_PASSWORD`. En una Pi nueva, crea ese fichero antes de actualizar, como dicen «Secretos» y «Lo que hay en la Pi».

## Comprobar

```bash
ssh kira 'cd ~/domus && docker compose ps && docker compose logs --no-color assistant voice-gateway | grep "api at"'
```

- Los tres contenedores salen `healthy`.
- `assistant` y `voice-gateway` dicen «api at http://api:3000: ready». Si dicen «does not speak protocol», las imágenes son de versiones distintas: vuelve a construir.
- `curl -s -X POST localhost:3000/api/rpc/status` en la Pi devuelve `{"json":{"service":"domus","protocol":1}}`.
- `curl -s localhost:3000/health` en la Pi devuelve `{"status":"ok","background":{"status":"ok","backups":"saved"}}` (ver «La lista de tareas y `/health`»).
- `status` es la única RPC que responde sin sesión (ADR 0023). En la Pi, esta orden escribe `401` para una operación de la plataforma y `404` para una acción de `probe`, que no está en la lista de producción:

    ```bash
    for rpc in log/read probe/listNotes; do curl -s -o /dev/null -w "$rpc %{http_code}\n" -X POST "localhost:3000/api/rpc/$rpc"; done
    ```

    Las dos rutas de los archivos tampoco responden sin sesión. Esta escribe `files 401` y `files/download 401`:

    ```bash
    for ruta in files files/download; do curl -s -o /dev/null -w "$ruta %{http_code}\n" -X POST "localhost:3000/api/$ruta"; done
    ```

- `docker compose logs --no-color api | grep database` dice `database at /data/domus.db: <N> migrations applied`: las que había pendientes en ese arranque, y `0` si no había ninguna. Si una migración falla, `api` no arranca y la base de datos queda como estaba.

## Las cuentas

No hay registro abierto: las cuentas se crean, y su contraseña se cambia, con el comando `accounts` dentro del contenedor `api` (ADR 0023). Pide la contraseña dos veces sin mostrarla y se niega a recibirla como argumento. Necesita una terminal, así que se ejecuta dentro de `ssh kira` (o con `ssh -t kira '…'`), en `~/domus`:

```bash
docker compose exec api node /app/accounts.mjs create --email <correo> --name Paco --role admin
docker compose exec api node /app/accounts.mjs create --email <correo> --name Rocío --role member
docker compose exec api node /app/accounts.mjs password --email <correo>
```

La contraseña tiene entre 8 y 128 caracteres. `create` responde `created the admin account <correo>`. `password` cierra todas las sesiones de esa cuenta y anula sus comprobantes y confirmaciones pendientes. En un ordenador de desarrollo es `pnpm accounts create …`, sobre `<repo>/data`. El `pnpm` de la raíz imprime la orden antes de ejecutarla, así que nunca escribas una contraseña en ella, ni siquiera por error.

## Las sesiones y su cookie

Una sesión vale 7 días y cada petición la busca en la base de datos, así que una sesión revocada falla en la petición siguiente. Las cookies son dos:

- `__Secure-better-auth.session_token`, la de la sesión, va siempre con `Secure`. Better Auth lo decide una vez al arrancar, no en cada petición: su URL base se resuelve por petición entre los hosts de `DOMUS_ORIGINS`, sin un protocolo fijo, y en ese caso mira `NODE_ENV`, que en la imagen es `production`. Un navegador guarda esa cookie por `https://kira.taildd967b.ts.net` y la rechaza por `http://kira.local:3000`, salvo que la página se abra como `localhost`. `curl` en la propia Pi sí la guarda, porque trata `localhost` como seguro.
- `domus.device`, la del aparato, nunca lleva `Secure`: sigue el protocolo de la petición que llega a `api`, y `tailscale serve` la pasa por http a `:3000`. No es una credencial.

Las pantallas para entrar son de la fase 3. Hasta entonces, la comprobación de abajo usa `curl`.

### Comprobar las cuentas y la autorización

En la Pi, dentro de `~/domus`, con las dos cuentas creadas. Todas las órdenes van en la misma terminal de `bash`, porque comparten las funciones y un directorio temporal para las cookies. Las peticiones con cookie necesitan una cabecera `Origin` de `DOMUS_ORIGINS`. Las contraseñas se piden sin eco y viajan a `curl` por la entrada estándar, no en la línea de la orden; si una lleva `"` o `\`, escápala con `\`.

```bash
D=$(mktemp -d)
rpc() { curl -s -w ' %{http_code}\n' -H 'Origin: http://kira.local:3000' -H 'content-type: application/json' "$@"; }
entrar() { # entrar <correo> <nombre>: abre una sesión y enseña sus cookies sin su valor
  local pw; read -rsp "Contraseña de $1: " pw; echo
  printf '{"email":"%s","password":"%s"}' "$1" "$pw" \
    | curl -s -D - -o /dev/null -c "$D/$2" -H 'Origin: http://kira.local:3000' -H 'content-type: application/json' \
      --data-binary @- localhost:3000/api/auth/sign-in/email | grep -i '^set-cookie' | sed 's/=[^;]*;/=…;/'
}
sesiones() { for n in paco paco2 rocio; do curl -s -o /dev/null -w "$n %{http_code}\n" -b "$D/$n" -H 'Origin: http://kira.local:3000' -X POST localhost:3000/api/rpc/sessions/list; done; }
```

1. Entra tres veces: `entrar <correo de Paco> paco`, `entrar <correo de Paco> paco2` y `entrar <correo de Rocío> rocio`. Cada una escribe las dos cookies, la de sesión con `Secure`. Si responde `429`, Better Auth ha frenado los intentos: espera diez segundos.
2. Una operación permitida funciona: `rpc -b "$D/paco" -X POST localhost:3000/api/rpc/sessions/list` devuelve las dos sesiones de Paco, la actual con `"current":true`, y `200`. `rpc -b "$D/paco" -X POST localhost:3000/api/rpc/log/read` devuelve las anotaciones de sus entradas y `200`.
3. Una denegada falla: Rocío no puede leer la delegación de otra cuenta.

    ```bash
    rpc -b "$D/rocio" -d '{"json":{"account":"nadie"}}' localhost:3000/api/rpc/delegation/read
    ```

    Responde `FORBIDDEN` y `403`.

4. Revoca la segunda sesión de Paco desde la primera. Esta orden guarda en `S` el id de la sesión de Paco que no es la actual, y lo escribe:

    ```bash
    S=$(curl -s -b "$D/paco" -H 'Origin: http://kira.local:3000' -X POST localhost:3000/api/rpc/sessions/list | jq -r '.json[] | select(.current | not) | .id'); echo "$S"
    ```

    Sin comprobante, revocarla falla con `STEP_UP_REQUIRED` y `403`:

    ```bash
    rpc -b "$D/paco" -H 'idempotency-key: revocar-1' -d "{\"json\":{\"session\":\"$S\"}}" localhost:3000/api/rpc/sessions/revoke
    ```

    Pide un comprobante para esa operación exacta. Pega esta línea sola, pulsa Enter y escribe la contraseña de Paco, que no se ve; si la pegas junto con la siguiente, `read` se queda con esa línea en vez de la contraseña:

    ```bash
    read -rsp 'Contraseña de Paco: ' pw; echo
    ```

    Esta guarda el comprobante en `P` y escribe `200`:

    ```bash
    P=$(printf '{"json":{"password":"%s","operation":{"action":"platform.revokeSession","input":{"session":"%s"}}}}' "$pw" "$S" | rpc -b "$D/paco" --data-binary @- localhost:3000/api/rpc/proofs/request | tee /dev/stderr | sed 's/ [0-9]*$//' | jq -r '.json.proof'); unset pw
    ```

    Con él, en los 5 minutos siguientes, la revocación responde `{"json":{"result":{"session":"…"},"entry":…}}` y `200`:

    ```bash
    rpc -b "$D/paco" -H 'idempotency-key: revocar-1' -H "step-up-proof: $P" -d "{\"json\":{\"session\":\"$S\"}}" localhost:3000/api/rpc/sessions/revoke
    ```

5. `sesiones` escribe `paco 200`, `paco2 401` y `rocio 200`.

Al terminar, `rm -rf "$D"`: las cookies son sesiones abiertas. Para cerrarlas antes, `rpc -b "$D/<nombre>" -d '{}' localhost:3000/api/auth/sign-out`: sin el `-d '{}'`, `rpc` manda `content-type: application/json` sin cuerpo y Better Auth responde `400`.

## La base de datos

Un solo fichero SQLite, `/data/domus.db`, dentro del volumen `domus_domus-data` (ADR 0021). Junto a él pueden aparecer `domus.db-wal` y `domus.db-shm` mientras `api` está en marcha: forman parte de la base de datos. Las migraciones se aplican solas al arrancar `api`. Cada noche se copia en un repositorio cifrado fuera del volumen (ver «Las copias de seguridad»), y se vuelve a una copia con «Restaurar».

### Comprobar que los datos persisten

En la Pi, dentro de `~/domus` (`ssh kira`, `cd ~/domus`). Esta orden lee el historial de migraciones abriendo el fichero en solo lectura y sin crearlo si no existe:

```bash
docker compose exec api node -e "const db = new (require('better-sqlite3'))('/data/domus.db', { readonly: true, fileMustExist: true }); console.log(db.prepare('SELECT * FROM platform_migrations ORDER BY module, position').all()); db.close()"
```

1. Ejecútala y apunta las filas de `platform`, `hash` y `applied_at` incluidos. Las dos primeras están escritas a mano: `position` `0` (`0000_migration_history`) y `position` `1` (`0001_action_log`, el registro de acciones). Desde `position` `2` son las generadas por `drizzle-kit` (ADR 0023), una por cada fichero `.sql` de `packages/platform/migrations/` en orden, salvo `0000`, la base que nunca se ejecuta; su nombre lleva su propio número, uno menos que su posición.
2. `docker compose restart api` y vuelve a ejecutarla.
3. `docker compose up -d --force-recreate api`, que cambia el contenedor y conserva el volumen, y vuelve a ejecutarla.
4. Tras el paso 2 y tras el 3, `sesiones` (de «Comprobar las cuentas y la autorización», en la misma terminal) sigue escribiendo `paco 200`, `paco2 401` y `rocio 200`, y la orden `curl` de «Comprobar» sigue dando `401` y `404`.

Las tres lecturas dan las mismas filas completas, `applied_at` incluido, y ninguna fila nueva. Si `applied_at` cambia, el contenedor no está usando el volumen. Tras una actualización que trae migraciones, el primer arranque de `api` dice `<N> migrations applied`, con `<N>` las que faltaban, y las filas que ya había no cambian; en los arranques siguientes, `0`. Si `docker compose up` recrea `api` justo después, esa línea queda en el registro del contenedor anterior: las filas nuevas, con el mismo `applied_at` o casi, dicen lo mismo.

## El segundo plano

`api` lleva dentro un motor de trabajos y un planificador (ADR 0025): no hay contenedor aparte. Arrancan después de abrir la base y antes de servir, y paran antes de cerrarla, esperando como mucho 5 s a lo que esté corriendo. El log de `api` lo dice:

```text
database at /data/domus.db: <N> migrations applied
scheduler started: <N> jobs recovered
api listening on port 3000
…
scheduler stopped
```

`jobs recovered` cuenta los trabajos que un proceso anterior dejó a medias, por un corte o una parada que no esperó; vuelven a la cola. Las horas son de `Europe/Madrid`, sea cual sea la zona del contenedor.

Hay tres tareas, todas en el carril de mantenimiento:

- `cleanup`, cada día a las 04:30. Borra el contenido caducado del registro de acciones y de las confirmaciones, los comprobantes que ya no deciden nada, y los trabajos de más de 30 días y las ejecuciones de más de 90. No cambia ninguna respuesta de la API.
- `backup`, cada día a las 05:00: la copia de seguridad de la base (ver «Las copias de seguridad»).
- `backup-check`, cada domingo a las 05:30: lee entero el repositorio de las copias.

Con las copias apagadas, las dos últimas no existen.

### La lista de tareas y `/health`

La lista es `tasks/list`, una lectura con sesión y sin comprobante. Con las funciones de «Comprobar las cuentas y la autorización»:

```bash
rpc -b "$D/paco" -X POST localhost:3000/api/rpc/tasks/list
```

De cada tarea devuelve `frequency` (la hora elegida o, si no hay, la de por defecto), `paused`, `nextAt` (la próxima ejecución, en milisegundos), `lastRun` (`manual`, `plannedAt`, `startedAt`, `finishedAt`, `result` y `error`) y `stuck`. `result` es `ok`, `failed`, `cancelled` o `skipped`, y `null` mientras corre. `error` está en inglés y sin datos personales.

`tasks/setTime`, `tasks/pause`, `tasks/resume` y `tasks/launch` son escrituras de nivel `manage`: solo el admin, con clave y comprobante de esa operación exacta. Las tres primeras se deshacen con `log/undo` si son el último cambio de la tarea; si no, `changed-since`. `tasks/launch` con una ejecución pendiente o en curso responde `CONFLICT` con `task-busy`.

`/health` responde `200` mientras `api` atiende, con `background`. No dice nada personal. Si `api` se congela del todo, lo detecta el healthcheck de Docker.

- `status` es `ok` o `degraded`.
- `reasons` sale solo con `degraded`: todos los motivos que se dan a la vez, en este orden:
    - `scheduler-silent`: el planificador lleva más de 5 minutos sin despertar; despierta al menos cada minuto.
    - `lane-stuck`: un trabajo no paró tras cancelarlo y ocupa su carril hasta que termine o se reinicie `api`.
    - `backup-stale`: la última copia guardada se capturó hace más de 48 h, o no hay ninguna y algún intento falló.
    - `backup-retention-failed`: la última retención falló. Se va con una retención buena.
    - `backup-check-failed`: el último `backup-check` falló. Se va con uno bueno.
- `backups` sale siempre: `off` (copias apagadas), `none-yet` (ni copia guardada ni intento fallido), `none` (ninguna guardada y algún intento fallido) o `saved` (hay alguna guardada). `none-yet` no degrada.

Las marcas de las copias viven en su propia fila, que la limpieza no borra, así que `/health` las recuerda tras un reinicio o tras purgar las ejecuciones antiguas.

### Comprobar el segundo plano

En la Pi, dentro de `~/domus`. Esta orden lee el estado de las tareas en solo lectura:

```bash
docker compose exec api node -e "const db = new (require('better-sqlite3'))('/data/domus.db', { readonly: true, fileMustExist: true }); console.log(db.prepare('SELECT * FROM platform_tasks').all()); db.close()"
```

1. Tras actualizar, el log de `api` dice `scheduler started` y `/health` dice `ok`. `docker compose restart api` deja en el log `scheduler stopped` y después otro `scheduler started`.
2. La orden de arriba muestra `cleanup` con `next_at` en las 04:30 de la próxima noche, `backup` en las 05:00 y `backup-check` en las 05:30 del próximo domingo (`TZ=Europe/Madrid date -r <next_at sin los tres últimos dígitos>` en el Mac lo traduce).
3. Para no esperar a la noche, el admin lanza la limpieza a mano. Pide un comprobante de `{"action":"platform.launchTask","input":{"task":"cleanup"}}` como en el paso 4 de «Comprobar las cuentas y la autorización», y con él:

    ```bash
    rpc -b "$D/paco" -H 'idempotency-key: lanzar-limpieza-1' -H "step-up-proof: $P" -d '{"json":{"task":"cleanup"}}' localhost:3000/api/rpc/tasks/launch
    ```

    Responde `{"json":{"result":{"task":"cleanup","run":<id>},"entry":<n>}}` y `200`. Después, la lista muestra en `lastRun` `"manual":true` y `"result":"ok"`.

4. Con otro comprobante, de `platform.setTaskTime` con `{"task":"cleanup","time":"05:00"}`, cambia la hora con `tasks/setTime`. Tras `docker compose restart api` y tras `docker compose up -d --force-recreate api`, la orden de arriba sigue dando `time` `05:00` y el mismo `next_at`. Para volver, deshaz esa entrada con `log/undo` y un comprobante de `{"undo":<n>}`: la lista vuelve a `04:30`.

## Los archivos

Los archivos que se suben a Domus viven en `/data/files`, dentro del volumen de datos (ADR 0028). Cada contenido se guarda una sola vez, con su SHA-256 por nombre, en `contents/<dos primeros caracteres>/<hash>`, y nunca se reescribe: dos subidas con los mismos bytes comparten el contenido. `incoming/` guarda las subidas en curso. La carpeta nace con la primera subida.

Subir es `POST /api/files`, con sesión, con el archivo tal cual en el cuerpo, su `Content-Length` y su nombre en `X-File-Name`, en UTF-8 codificado como en una URL y de 255 bytes como mucho. Domus acepta:

- hasta 25 MB por archivo (`413 FILE_TOO_LARGE`);
- JPEG, PNG, WebP, HEIC, PDF y texto en UTF-8, reconocidos por sus bytes y no por el nombre (`415 FILE_TYPE_NOT_ALLOWED`);
- hasta 20 archivos o 200 MB subiéndose o preparados a la vez en cada sesión (`429 UPLOAD_LIMIT`), y siempre que queden 2 GB libres en el disco (`507 INSUFFICIENT_STORAGE`);
- un minuto sin recibir bytes corta la subida (`408 UPLOAD_TIMEOUT`).

Una subida buena responde con un archivo preparado: un id que vale 24 h, solo para la sesión que lo subió y una sola vez, para vincularlo a un registro con una acción de su módulo. Hasta que llegue un módulo real con archivos, en el Domus real solo se puede subir; vincular, descargar y deshacer se comprueban en el ensayo, con `probe` (ver «Ensayar con archivos»).

La limpieza de las 04:30 borra los archivos preparados caducados o de sesiones cerradas, los contenidos a los que ya no apunta nada, los ficheros sin fila de más de una hora y lo que quedó en `incoming/` sin una subida en curso.

### Comprobar los archivos

En la terminal de «Comprobar las cuentas y la autorización» (con `D` y `entrar`), entra como Paco con `entrar <correo de Paco> paco`. Después, estas órdenes crean tres archivos de prueba y los suben. El nombre va tal cual porque es ASCII; uno con tildes o espacios tiene que ir codificado.

```bash
subir() { curl -s -w ' %{http_code}\n' -b "$D/paco" -H 'Origin: http://kira.local:3000' -H "X-File-Name: $(basename "$1")" --data-binary @"$1" localhost:3000/api/files; }
printf 'Pilas para el mando, café y jabón.\n' > "$D/lista-compra.txt"
head -c 128 /dev/zero > "$D/programa.bin"
head -c 27262976 /dev/zero | tr '\0' a > "$D/grande.txt"
subir "$D/lista-compra.txt"; subir "$D/programa.bin"; subir "$D/grande.txt"
```

El 2026-11-14 escribieron:

```text
{"id":"…","name":"lista-compra.txt","type":"text/plain","size":37,"expiresAt":1794746330632} 200
{"defined":false,"code":"FILE_TYPE_NOT_ALLOWED","status":415,"message":"FILE_TYPE_NOT_ALLOWED"} 415
{"defined":false,"code":"FILE_TOO_LARGE","status":413,"message":"FILE_TOO_LARGE"} 413
```

El contenido de la primera está en el almacén, con el nombre que da `sha256sum "$D/lista-compra.txt"`:

```bash
docker compose exec -T api find /data/files -type f
```

Escribió `/data/files/contents/ae/aec5af8ea8339032b725746103d6a76ab89b5e383a82ddf949133850602180ca`. Ese archivo preparado no se vincula a nada: caduca a las 24 h, y la limpieza de la noche siguiente lo borra con su contenido, así que la misma orden ya no escribe ninguno.

## Las copias de seguridad

Cada noche, la tarea `backup` saca una instantánea de la base, la comprueba y la guarda con restic en un repositorio cifrado (ADR 0026 y ADR 0027). Un proceso hijo de Node, con su propia conexión y el cerrojo compartido de la base, la copia con `VACUUM INTO` en `/data/backup-staging/domus.db`; otro proceso hijo le pasa `quick_check`; restic la sube con el host `domus` y el instante de captura, que es el de antes de empezar la copia. Después aplica la retención: 7 diarias, 4 semanales y 3 mensuales. La carpeta de preparación se vacía al terminar, también si algo falla. La copia necesita en el NVMe un espacio libre del tamaño de la base, además del repositorio.

La copia lleva también los contenidos de archivo que la base necesita en el instante de captura: los de las referencias vivas y los de las soltadas que todavía se pueden deshacer (ADR 0028). El mismo proceso hijo de `quick_check` los saca de la instantánea, y entran en `/data/backup-staging/files/` como enlaces duros, sin ocupar más espacio. En la instantánea quedan en `/files/contents/…`, junto a `/domus.db`. Los archivos preparados no entran. Si falta uno de los contenidos necesarios, la copia falla sin subir nada.

El repositorio está en el mismo NVMe que los datos, de forma provisional: protege de borrados y errores, no de perder el disco o la Pi. Sin su contraseña no se puede leer ni restaurar.

### Lo que hay en la Pi

| Qué              | Dónde                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositorio      | `/srv/backups/domus`, carpeta `700` de `fvena` (uid 1000, el mismo que `node` en el contenedor); en `api` es `/backups`                                          |
| Contraseña       | `/home/fvena/.config/domus/backup-password`, fichero `600` de `fvena`, y también en el gestor de contraseñas de casa; en `api` es `/run/secrets/backup-password` |
| Lo que lo enlaza | dos líneas de `/home/fvena/domus/.env`                                                                                                                           |

Se prepararon así, en la Pi y con `sudo`:

```bash
sudo install -d -m 700 -o 1000 -g 1000 /srv/backups/domus
umask 077 && mkdir -p ~/.config/domus && openssl rand -base64 32 | tr -d '\n' > ~/.config/domus/backup-password
chmod 600 ~/.config/domus/backup-password
ls -ldn /srv/backups/domus ~/.config/domus/backup-password
```

La última orden escribe `-rw------- 1 1000 1000 44 … /home/fvena/.config/domus/backup-password` y `drwx------ 2 1000 1000 4096 … /srv/backups/domus`. Para guardar la contraseña en el gestor, se lee desde el Mac (las comillas importan: sin ellas, el Mac expande `~`):

```bash
ssh kira 'cat ~/.config/domus/backup-password'; echo
```

Si se pierde la contraseña, las copias no se pueden leer. `backup` falla con una contraseña incorrecta y nunca reinicializa un repositorio que tiene algo, así que cambiar el fichero no empieza un repositorio nuevo: lo deja sin copias.

Las dos líneas del `.env`:

```sh
DOMUS_BACKUPS=/srv/backups/domus
DOMUS_BACKUP_PASSWORD=/home/fvena/.config/domus/backup-password
```

Sin `DOMUS_BACKUP_PASSWORD`, `docker compose up` no arranca. Con ellas, tras `git pull --ff-only` y `docker compose up -d --build`, el log de `api` dice:

```text
database at /data/domus.db: 1 migrations applied
backups to /backups
scheduler started: 0 jobs recovered
api listening on port 3000
```

y `/health`, antes de la primera copia, `{"status":"ok","background":{"status":"ok","backups":"none-yet"}}`.

Esta orden comprueba desde dentro del contenedor que `api` corre como el uid 1000, escribe en el repositorio y lee la contraseña:

```bash
docker compose exec -T api sh -c "id -u; test -w /backups && echo backups-writable; test -r /run/secrets/backup-password && echo secret-readable; restic version"
```

Escribe `1000`, `backups-writable`, `secret-readable` y `restic 0.18.0 … linux/arm64`.

### Las tareas y su estado

`backup` corre cada día a las 05:00 y `backup-check` cada domingo a las 05:30, hora de `Europe/Madrid`. Las dos aparecen en `tasks/list` y se pausan, se cambian de hora o se lanzan como cualquier tarea (ver «El segundo plano»).

- Una copia guardada pone `/health` en `"backups":"saved"`. Si la última se capturó hace más de 48 h, `background` pasa a `degraded` con `backup-stale`.
- Una copia que restic no leyó entera (código `3`), un repositorio que no abre o una contraseña incorrecta hacen fallar la ejecución sin reintentos, con el paso y el código en `error`. Un bloqueo del repositorio por otro proceso (código `11`) se reintenta.
- La primera copia inicia el repositorio solo si `/srv/backups/domus` está vacío.
- Si la retención falla, la copia queda guardada, la ejecución acaba `failed` y `/health` dice `backup-retention-failed` hasta la siguiente retención buena. La retención espera hasta 10 min a que otro proceso suelte el repositorio, como la restauración del ensayo.
- Un `backup-check` fallido deja `backup-check-failed` hasta el siguiente bueno.

### Lanzar una copia a mano

En la terminal de «Comprobar las cuentas y la autorización» (con `D`, `rpc` y `entrar`), entra como el admin con `entrar <correo de Paco> paco`. Pega esta línea sola, pulsa Enter y escribe la contraseña de Paco:

```bash
read -rsp 'Contraseña de Paco: ' pw; echo
```

Después, el comprobante y la copia:

```bash
P=$(printf '{"json":{"password":"%s","operation":{"action":"platform.launchTask","input":{"task":"backup"}}}}' "$pw" | rpc -b "$D/paco" --data-binary @- localhost:3000/api/rpc/proofs/request | tee /dev/stderr | sed 's/ [0-9]*$//' | jq -r '.json.proof'); unset pw
rpc -b "$D/paco" -H 'idempotency-key: primera-copia-1' -H "step-up-proof: $P" -d '{"json":{"task":"backup"}}' localhost:3000/api/rpc/tasks/launch
```

Responden `{"json":{"proof":"…","expiresAt":…}} 200` y `{"json":{"result":{"task":"backup","run":<id>},"entry":<n>}} 200`. Cada lanzamiento lleva su propia clave de idempotencia: cambia `primera-copia-1` la próxima vez. La primera copia en la Pi acabó `ok` en unos 4 s, `/health` pasó a `"backups":"saved"` y `/data/backup-staging` quedó vacía.

### Listar el repositorio

Con `api` en marcha, restic dentro de su contenedor:

```bash
docker compose exec -T -e RESTIC_REPOSITORY=/backups -e RESTIC_PASSWORD_FILE=/run/secrets/backup-password api restic snapshots --no-cache --compact
```

Escribe una línea por instantánea, como `80a41abd  2026-11-13 10:28:27  domus  212.000 KiB`, con la hora de captura en la zona del contenedor. La lista de restaurar, que sirve también con `api` parada, da el identificador entero y la captura en UTC:

```bash
docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs list
```

Escribe `<id>  captured <instante UTC>` por instantánea, o `no snapshots of host domus yet`.

## Restaurar

Restaurar pone la base de una instantánea del repositorio en lugar de la actual (ADR 0026). Es el comando `restore.mjs` de la imagen de `api`, y solo corre con la base libre: `api` y `accounts` toman un cerrojo compartido de `/data/domus.lock`, y restaurar lo necesita exclusivo. Si no puede tomarlo, se niega con `the database is in use: stop api and accounts first`. Mientras restaura, `api` no arranca (`restore in progress`).

Antes de tocar la base activa, prepara la copia aparte, en `/data/restore-staging`: la comprueba, le aplica las migraciones que le falten y la sanea. Una copia hecha con un código más nuevo, o una migración que falla, se paran ahí con el mensaje del migrador, y la base activa sigue igual. Sirve también si la base actual está dañada o no existe.

Los contenidos de archivo vuelven con la base (ADR 0028). Restaurar prepara también los que la copia necesita y comprueba el SHA-256 de cada uno. Si falta uno, se niega con `the backup lacks a file content its database needs`, y si uno no coincide, con `a file content of the backup does not match its hash`; en los dos casos no toca nada. Después los pone en `/data/files/contents`, antes de cambiar la base, y nunca borra un contenido del almacén. Si una restauración se corta antes de cambiar la base, los contenidos que ya puso los recoge la limpieza.

### Restaurar el Domus real

En la Pi, dentro de `~/domus`:

1. Para `api`. `assistant` y `voice-gateway` siguen en marcha, esperando a que vuelva:

    ```bash
    docker compose stop api
    ```

2. Elige la instantánea:

    ```bash
    docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs list
    ```

3. Restaura la última, o una concreta con `--snapshot` y su identificador o su comienzo, si solo uno empieza así:

    ```bash
    docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs
    ```

    ```bash
    docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs --snapshot <id>
    ```

    Termina con `restored <id>, captured <instante UTC>` y `the previous database is kept in /data/before-restore-<instante UTC>`. Apunta esa carpeta.

4. Arranca `api`:

    ```bash
    docker compose start api
    ```

    El log dice `0 migrations applied`: la copia recibió al prepararla las que le faltaban. `/health` sigue contando las 48 h desde la captura de la copia restaurada, así que restaurar una copia de hace diez días deja `backup-stale` hasta la próxima copia.

En un ordenador de desarrollo es `pnpm restore list` o `pnpm restore [--snapshot <id>]`, sobre `<repo>/data`, con `pnpm dev` parado.

### Retomar tras un corte

Si restaurar se corta a mitad (un corte de luz, un `docker compose run` que muere), queda en `/data` la marca `restore.pending`. Mientras exista, `api` y `accounts` se niegan a abrir la base con `restore incomplete: run restore again`. Vuelve a ejecutar la misma orden, con `api` parada:

```bash
docker compose stop api
docker compose run --rm --no-deps --entrypoint node api /app/restore.mjs
docker compose start api
```

Lee la marca y termina el intercambio sin volver a preparar ni a crear otra carpeta `before-restore`. Escribe `ended the restore of <id>, captured <instante UTC>, that was cut` y la misma carpeta. Tras un corte queda la base anterior entera o la restaurada saneada, nunca una vacía ni una mezcla.

Si la marca no se puede leer, `api` y restaurar se niegan con `restore marker unreadable`: nunca la toman por ausente. Entonces devuelve a mano la carpeta `before-restore` más reciente, como dice el apartado siguiente, y borra la marca antes de arrancar `api`:

```bash
docker compose run --rm --no-deps --entrypoint rm api /data/restore.pending
```

La carpeta `before-restore` está completa y sincronizada antes de que se escriba la marca, así que guarda la base de antes de restaurar.

### Las carpetas `before-restore`

Cada restauración guarda la base que había, con su `-wal` y su `-shm` si existían, en `/data/before-restore-<instante UTC>` (por ejemplo, `before-restore-20261113T093113Z`). Son enlaces duros, hechos sin abrir los ficheros, así que valen igual si la base estaba dañada o no existía. Nunca se borran solas, y no entran en las copias. Los archivos no van en ellas, porque restaurar no borra ningún contenido del almacén: la base devuelta encuentra los suyos donde estaban, salvo los que la limpieza ya hubiera recogido.

Para ver cuáles hay:

```bash
docker compose run --rm --no-deps --entrypoint ls api -l /data
```

Para devolver una a mano, con `api` parada, pon su nombre en `B`. La orden aparta la base actual a `/data/apartada-<nombre>` y copia la conservada en su sitio, sin tocar la carpeta `before-restore`:

```bash
docker compose stop api
B=before-restore-20261113T093113Z
docker compose run --rm --no-deps -e B="$B" --entrypoint sh api -c '
set -e; cd /data; test -d "$B"
mkdir "apartada-$B"
for f in domus.db domus.db-wal domus.db-shm; do if [ -e "$f" ]; then mv "$f" "apartada-$B/"; fi; done
for f in domus.db domus.db-wal domus.db-shm; do if [ -e "$B/$f" ]; then cp -p "$B/$f" .; fi; done
ls -l'
docker compose start api
```

`api` arranca con la base de antes de restaurar, tal como estaba, sesiones y trabajos pendientes incluidos, que recupera como tras un reinicio. Lo escrito después de restaurar queda en `apartada-…`. Se copia y no se enlaza porque `api` escribe en `domus.db`: con un enlace, cambiaría también la conservada.

Borra una carpeta `before-restore`, o una `apartada-…`, cuando la base restaurada lleve unos días funcionando bien o cuando ya hayas investigado lo que querías: guarda en claro una base entera y ocupa su tamaño en el NVMe. Con `api` en marcha:

```bash
docker compose exec api rm -r /data/before-restore-20261113T093113Z
```

### Qué vuelve con la copia y qué se pierde

Vuelve todo lo que había en la base al capturar la copia: los datos, las contraseñas, los permisos, la delegación de cada cuenta, los ajustes de las tareas (horas y pausas) y los archivos vinculados, también los soltados que todavía se pueden deshacer. Una contraseña cambiada o un permiso quitado después de la copia vuelven a como estaban: revísalos.

Al sanear, la restauración:

- cierra todas las sesiones: todo el mundo vuelve a entrar;
- anula las confirmaciones pendientes y los comprobantes;
- descarta los archivos preparados y las referencias soltadas cuyo deshacer ya caducó, y olvida los contenidos a los que no apunta nada, que la limpieza borra del almacén;
- descarta los trabajos pendientes, en curso o atascados de la copia, que quedan `cancelled` con `discarded by restore`, para no repetir lo que ya salió;
- calcula la próxima ejecución de cada tarea desde el momento de restaurar, sin lanzar de golpe las atrasadas, y una pausada sigue pausada;
- y anota de qué instantánea viene la base.

Se pierden las claves de idempotencia de las escrituras posteriores a la copia: repetir una de esas escrituras con su clave la ejecuta otra vez, en vez de responder lo de entonces.

## Ensayar una restauración

El ensayo es un segundo Domus junto al real, el proyecto de compose `domus-restore` de `docker/ensayo/compose.yml`: su propio volumen de datos, `127.0.0.1:3001` sin Tailscale, las copias apagadas y la imagen que construyó el compose real (`domus-api:local`). Lee el `.env` real, así que no necesita secretos propios. Solo la orden de restaurar monta el repositorio de producción, y restic lo usa con un bloqueo compartido que espera hasta 30 min (`--retry-lock 30m`): nunca coincide con una retención de producción, y si coincide espera. La `api` del ensayo nunca lo monta.

En la Pi, dentro de `~/domus` y en `bash`:

```bash
E="docker compose -f docker/ensayo/compose.yml --env-file .env"
DOMUS_ENSAYO_BACKUPS=/srv/backups/domus $E run --rm --no-deps --entrypoint node api /app/restore.mjs list
DOMUS_ENSAYO_BACKUPS=/srv/backups/domus $E run --rm --no-deps --entrypoint node api /app/restore.mjs
$E up -d
```

En el ensayo del 2026-11-13, `list` escribió `80a41abd…  captured 2026-11-13T09:28:27.000Z`, y restaurar, `restored 80a41abd…, captured …` y `the previous database is kept in /data/before-restore-20261113T093113Z`. El log de su `api` dijo `0 migrations applied`, `backups off` y `scheduler started: 0 jobs recovered`, y su `/health` en `localhost:3001`, `backups: off`. En su base, el trabajo `backup` que corría dentro de la copia quedó `cancelled` con `discarded by restore`; había 0 sesiones (el real tenía 4), y las mismas 3 cuentas y 5 entradas del registro de acciones que el real.

Para entrar en el ensayo, en la terminal de «Comprobar las cuentas y la autorización» (con `D`), pega estas dos líneas, una a una, y escribe el correo y la contraseña de una cuenta:

```bash
read -rp 'Correo: ' correo
```

```bash
read -rsp 'Contraseña: ' pw; echo
```

Después:

```bash
printf '{"email":"%s","password":"%s"}' "$correo" "$pw" | curl -s -o /dev/null -w 'entrar en el ensayo %{http_code}\n' -c "$D/ensayo" -H 'Origin: http://localhost:3001' -H 'content-type: application/json' --data-binary @- localhost:3001/api/auth/sign-in/email
curl -s -b "$D/ensayo" -H 'Origin: http://localhost:3001' -X POST localhost:3001/api/rpc/log/read | jq '.json | length'
curl -s -b "$D/ensayo" -H 'Origin: http://localhost:3001' -X POST localhost:3001/api/rpc/sessions/list | jq '.json | length'
curl -s -o /dev/null -w 'sesión del Domus real en el ensayo %{http_code}\n' -b "$D/paco" -H 'Origin: http://localhost:3001' -X POST localhost:3001/api/rpc/sessions/list
```

Escribieron `entrar en el ensayo 200`, `5` (las entradas del registro), `1` (solo la sesión nueva) y `sesión del Domus real en el ensayo 401`: la sesión de antes de la copia ya no vale. Un correo mal escrito da `400` (`INVALID_EMAIL`), y uno que no existe, `401`.

Para salir, cierra las dos sesiones, que responden `200`, y borra las cookies:

```bash
rpc -b "$D/paco" -d '{}' localhost:3000/api/auth/sign-out
curl -s -w ' %{http_code}\n' -b "$D/ensayo" -H 'Origin: http://localhost:3001' -H 'content-type: application/json' -d '{}' localhost:3001/api/auth/sign-out
unset pw correo; rm -rf "$D"
```

### Ensayar con archivos

El ensayo con archivos comprueba que base y archivos se restauran juntos. Como el Domus real todavía no tiene módulos con archivos, usa una imagen con `probe`, `domus-api:ensayo`, construida con `DOMUS_MODULES=rehearsal`: la lista de módulos de esa imagen lleva también los de prueba, y la de producción no cambia. En la Pi, dentro de `~/domus`:

```bash
docker build -f docker/Dockerfile --target api --build-arg DOMUS_MODULES=rehearsal -t domus-api:ensayo .
```

Con `E` como arriba, restaura en el ensayo la última copia real con esa imagen y arráncalo con las copias encendidas, sobre su propio repositorio:

```bash
export DOMUS_ENSAYO_IMAGE=domus-api:ensayo
DOMUS_ENSAYO_BACKUPS=/srv/backups/domus $E run --rm --no-deps --entrypoint node api /app/restore.mjs
DOMUS_ENSAYO_BACKUPS_OFF= $E up -d
```

Al restaurar, la copia real recibe las migraciones de `probe`. Sin sesión, `curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/rpc/probe/listNotes` escribe `401`, y no `404` como en el Domus real. Entra en el ensayo como dice el apartado de arriba, con la cookie en `$D/ensayo`, y define estas funciones y los cuatro archivos de prueba:

```bash
O='Origin: http://localhost:3001'
subir() { curl -s -b "$D/ensayo" -H "$O" -H "X-File-Name: $(basename "$1")" --data-binary @"$1" localhost:3001/api/files | jq -r .id; }
probe() { curl -s -b "$D/ensayo" -H "$O" -H 'content-type: application/json' -H "idempotency-key: $1" -d "{\"json\":$3}" "localhost:3001/api/rpc/probe/$2"; echo; }
bajar() { curl -s -b "$D/ensayo" -H "$O" -H 'content-type: application/json' -d "{\"action\":\"probe.getNote\",\"input\":{\"id\":$1},\"file\":\"$2\"}" localhost:3001/api/files/download | sha256sum; }
printf '\x89PNG\r\n\x1a\n\0\0\0\rIHDR' > "$D/foto-caldera.png"
printf '%%PDF-1.4\n%%%%EOF\n' > "$D/factura-luz.pdf"
printf 'Pilas para el mando, café y jabón.\n' > "$D/lista-compra.txt"
printf 'Este archivo se prepara y no se vincula.\n' > "$D/sin-usar.txt"
sha256sum "$D"/*.png "$D"/*.pdf "$D"/*.txt
```

Sube los cuatro, crea dos notas, vincula la foto y la factura a la primera y la lista a la segunda, y borra la segunda. Su deshacer sigue vigente:

```bash
F=$(subir "$D/foto-caldera.png"); P=$(subir "$D/factura-luz.pdf"); L=$(subir "$D/lista-compra.txt"); S=$(subir "$D/sin-usar.txt")
probe nota-1 addNote '{"body":"Revisión de la caldera"}'
probe nota-2 addNote '{"body":"Compra del sábado"}'
probe vincular-1 attachFile "{\"noteId\":1,\"prepared\":\"$F\"}"
probe vincular-2 attachFile "{\"noteId\":1,\"prepared\":\"$P\"}"
probe vincular-3 attachFile "{\"noteId\":2,\"prepared\":\"$L\"}"
probe borrar-1 deleteNote '{"id":2}'
probe leer getNote '{"id":1}'
```

Cada escritura responde su resultado y su `entry`. Las tres de `attachFile` devuelven el id de su archivo, y `getNote` devuelve la nota 1 con sus dos archivos en `files`. Apunta el `entry` de `deleteNote` y el id de cada archivo. `bajar 1 <id>` escribe el mismo hash que su original.

Lanza la copia del ensayo con un comprobante, como en «Lanzar una copia a mano» pero en `localhost:3001`. Pega la primera línea sola y escribe la contraseña de Paco:

```bash
read -rsp 'Contraseña de Paco: ' pw; echo
```

```bash
K=$(printf '{"json":{"password":"%s","operation":{"action":"platform.launchTask","input":{"task":"backup"}}}}' "$pw" | curl -s -b "$D/ensayo" -H "$O" -H 'content-type: application/json' --data-binary @- localhost:3001/api/rpc/proofs/request | jq -r '.json.proof'); unset pw
curl -s -b "$D/ensayo" -H "$O" -H 'content-type: application/json' -H 'idempotency-key: copia-ensayo-1' -H "step-up-proof: $K" -d '{"json":{"task":"backup"}}' localhost:3001/api/rpc/tasks/launch; echo
```

Esta orden enseña lo que guardó la copia:

```bash
$E exec -T -e RESTIC_REPOSITORY=/backups -e RESTIC_PASSWORD_FILE=/run/secrets/backup-password api restic ls --no-cache latest
```

Después, vacía solo el volumen de datos del ensayo y restaura en él la copia que acaba de guardar, desde el repositorio del ensayo (sin `DOMUS_ENSAYO_BACKUPS`):

```bash
$E down
docker volume rm domus-restore_data
$E run --rm --no-deps --entrypoint node api /app/restore.mjs
DOMUS_ENSAYO_BACKUPS_OFF= $E up -d
```

La sesión de antes ya no vale: vuelve a entrar en el ensayo y comprueba lo restaurado. Con `S` y el `entry` de `deleteNote` en `U`:

```bash
bajar 1 <id de la foto>; bajar 1 <id de la factura>
probe tras-1 attachFile "{\"noteId\":1,\"prepared\":\"$S\"}"
curl -s -b "$D/ensayo" -H "$O" -H 'content-type: application/json' -H 'idempotency-key: deshacer-1' -d "{\"json\":{\"entry\":$U}}" localhost:3001/api/rpc/log/undo; echo
probe leer-2 getNote '{"id":2}'
bajar 2 <id de la lista>
```

En el ensayo del 2026-11-14, con la última copia real (`d1dd591a…`, de las 05:00):

- la nota 1 devolvió en `files` `foto-caldera.png` (`image/png`) y `factura-luz.pdf` (`application/pdf`), y las dos descargas llevaron `cache-control: no-store`, `x-content-type-options: nosniff` y `content-disposition: attachment; filename="…"; filename*=UTF-8''…`;
- `tasks/launch` respondió `200` y la copia `8c402530`, de 272 KiB, guardó `/domus.db` y tres contenidos en `/files/contents/…`: la foto, la factura y la lista, soltada con su deshacer vigente; el archivo preparado sin usar no entró;
- tras vaciar el volumen, restaurar escribió `restored 8c402530…, captured 2026-11-14T12:41:59.000Z`, el log de su `api` dijo `0 migrations applied`, el almacén tenía los tres contenidos y la cookie de antes respondió `401`;
- con la sesión nueva, la foto y la factura se descargaron con el mismo hash que sus originales;
- el archivo preparado de antes de la copia respondió `NOT_FOUND` y `404`;
- deshacer el borrado respondió `200`, la nota 2 volvió con `lista-compra.txt` en `files`, y su descarga dio el mismo hash que el original.

Para salir, cierra la sesión del ensayo y desmonta el ensayo como dice «Desmontar el ensayo», con `docker image rm domus-api:ensayo`.

### Medir la copia

La medición comprueba que `api` sigue respondiendo durante una copia grande. Corre en el ensayo, con las copias encendidas sobre su propio repositorio, en un volumen desechable con la misma contraseña del `.env`, nunca sobre el real. El script `docker/ensayo/medir.mjs` corre con el Node de la imagen, dentro de la `api` del ensayo:

- `llenar [MB]` llena la base hasta unos MB megabytes (500 si no se dice) con entradas sintéticas del registro de acciones, de una cuenta que no existe. Si la base ya llega, no añade nada.
- `medir <correo>`, con la contraseña en `MEDIR_PASSWORD`, entra con esa cuenta, que tiene que ser la del admin, y hace un minuto de base y después tres copias enteras lanzadas con `tasks/launch`. Mientras, pide `/health` y `tasks/list` cada 100 ms y un comprobante (una escritura que verifica la contraseña) cada segundo, a cadencia fija, sin esperar a la respuesta anterior. Escribe cuánto tardó cada copia y, por periodo y petición, el número, los errores y los percentiles. Pasa si ninguna respuesta tarda más de 500 ms y no hay errores.

Con el ensayo ya restaurado, en la misma terminal (con `E`):

```bash
DOMUS_ENSAYO_BACKUPS_OFF= $E up -d
$E exec -T api node --input-type=module - llenar 500 < docker/ensayo/medir.mjs
```

`DOMUS_ENSAYO_BACKUPS_OFF` vacía enciende las copias. `llenar` escribió `353000 entries added, database at 501 MB`, en 15 s. Lee el correo y la contraseña del admin con las dos líneas `read` de arriba, y mide:

```bash
MEDIR_PASSWORD="$pw" $E exec -T -e MEDIR_PASSWORD api node --input-type=module - medir "$correo" < docker/ensayo/medir.mjs; unset pw correo
```

La primera medición, el 2026-11-13, con la instantánea de `db.backup()` dentro de `api`, no pasó:

```text
copia 1: ok en 12.1 s · copia 2: ok en 4.9 s · copia 3: ok en 4.9 s
base   health p99 4 máx 12 · read p99 11 máx 26 · write p99 138 máx 138
copia 1 health p95 743 máx 1307 · read p95 748 máx 1312 · write máx 1410
copia 2 health p95 1135 máx 1320 · read máx 1325 · write máx 933
copia 3 health p95 1087 máx 1276 · read máx 1279 · write máx 1196
NO PASA: máximo 1410 ms (límite 500), 0 errores
```

Medido aparte en el mismo contenedor y sobre los mismos 500 MB, `db.backup` tardaba 2,1 s en 1223 pasos, con 3 ms como mucho entre uno y otro, pero del último paso al final pasaban 1386 ms: SQLite forzaba a disco el fichero de destino entero, de forma síncrona, en el único hilo de `api`. Borrar la instantánea tardaba 30 ms. De ahí el ADR 0027: la instantánea la saca un proceso hijo con `VACUUM INTO`.

La segunda medición, con la imagen de la rama de ese cambio, pasó:

```text
copia 1: ok en 10.3 s · copia 2: ok en 5.1 s · copia 3: ok en 5.0 s
periodo  petición  n    errores  p50  p95  p99  máx (ms)
base     health    599  0        1    2    4    12
base     read      599  0        4    7    11   27
base     write     59   0        98   133  137  137
copia 1  health    103  0        3    10   16   20
copia 1  read      103  0        10   26   32   33
copia 1  write     11   0        112  162  162  162
copia 2  health    57   0        1    7    7    7
copia 2  read      57   0        5    13   15   15
copia 2  write     6    0        98   112  112  112
copia 3  health    51   0        2    7    25   25
copia 3  read      51   0        5    12   27   27
copia 3  write     5    0        98   112  112  112
PASA: máximo 162 ms (límite 500), 0 errores
```

El máximo es la escritura, que ya tarda de 100 a 137 ms en la base porque verifica la contraseña. La primera copia tarda más porque inicia el repositorio del ensayo y lo sube todo; las siguientes deduplican.

### Medir una rama antes de fusionarla

El ensayo corre la imagen del Domus real. Para medir un cambio que aún no está en `main`, construye su imagen en la Pi con otro nombre y pásala en `DOMUS_ENSAYO_IMAGE`. Desde el Mac, en la rama:

```bash
git archive HEAD | ssh kira 'mkdir -p ~/domus-ensayo-src && tar -x -C ~/domus-ensayo-src'
```

En la Pi:

```bash
cd ~/domus-ensayo-src && docker build -f docker/Dockerfile --target api -t domus-api:ensayo .
```

Y desde `~/domus`, con `E` como arriba:

```bash
DOMUS_ENSAYO_IMAGE=domus-api:ensayo DOMUS_ENSAYO_BACKUPS_OFF= $E up -d
```

Sigue con `llenar` y `medir` como arriba.

### Desmontar el ensayo

```bash
$E down -v
docker image rm domus-api:ensayo
```

`down -v` borra los volúmenes `domus-restore_data` y `domus-restore_backups`. La segunda orden solo hace falta si construiste una imagen de rama o la del ensayo con archivos. El Domus real no se toca: su `/health` sigue en `ok` con `backups: saved`.

## Secretos

`api` firma las sesiones con `DOMUS_AUTH_SECRET` y acepta peticiones con cookies solo desde los orígenes de `DOMUS_ORIGINS`. Los dos viven en el fichero `.env` junto a `docker-compose.yml` en la Pi, fuera de git, y `docker compose` no arranca sin el secreto:

```sh
DOMUS_AUTH_SECRET=<salida de: openssl rand -base64 32>
DOMUS_ORIGINS=http://kira.local:3000,https://kira.taildd967b.ts.net
```

Cambiar el secreto cierra todas las sesiones.

La contraseña de las copias no va dentro del `.env`: es un fichero aparte, que `docker-compose.yml` monta como secret en `/run/secrets/backup-password`. El `.env` solo dice dónde está, y `docker compose` tampoco arranca sin él (ver «Las copias de seguridad»).
