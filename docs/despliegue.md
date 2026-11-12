# Despliegue en la Raspberry Pi

La Pi se llama `kira`: `kira.local` en casa y `kira.taildd967b.ts.net` por Tailscale. Se entra con `ssh kira`.

| Qué          | Dónde                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Código       | `/home/fvena/domus`, un clon de `fvena/domus` en la rama `main`                                                                       |
| Contenedores | `api`, `assistant` y `voice-gateway`, del proyecto de compose `domus`                                                                 |
| Datos        | el volumen `domus_domus-data`, montado solo en `api`                                                                                  |
| Secretos     | `/home/fvena/domus/.env`, fuera de git (ver «Secretos»)                                                                               |
| Acceso       | `http://kira.local:3000` en casa; `https://kira.taildd967b.ts.net` por Tailscale, solo dentro de la red (`tailscale serve` → `:3000`) |

Las imágenes se construyen en la propia Pi, que es arm64, en unos 30 segundos. Docker arranca con el sistema y los contenedores tienen `restart: unless-stopped`, así que vuelven solos tras un corte de luz.

## Actualizar

```bash
ssh kira 'cd ~/domus && git pull --ff-only && docker compose up -d --build'
```

Se construyen y reinician los tres a la vez. Si `api` cambia de `protocol` y los otros dos no, se quedan en «incompatible» y no hacen nada hasta tener la misma versión (ADR 0020).

Desde la 1c, `docker compose` no arranca sin `DOMUS_AUTH_SECRET` en `.env`. La primera vez, crea ese fichero antes de actualizar, como dice «Secretos».

## Comprobar

```bash
ssh kira 'cd ~/domus && docker compose ps && docker compose logs --no-color assistant voice-gateway | grep "api at"'
```

- Los tres contenedores salen `healthy`.
- `assistant` y `voice-gateway` dicen «api at http://api:3000: ready». Si dicen «does not speak protocol», las imágenes son de versiones distintas: vuelve a construir.
- `curl -s -X POST localhost:3000/api/rpc/status` en la Pi devuelve `{"json":{"service":"domus","protocol":1}}`.
- `status` es la única RPC que responde sin sesión (ADR 0023). En la Pi, esta orden escribe `401` para una operación de la plataforma y `404` para una acción de `probe`, que no está en la lista de producción:

    ```bash
    for rpc in log/read probe/listNotes; do curl -s -o /dev/null -w "$rpc %{http_code}\n" -X POST "localhost:3000/api/rpc/$rpc"; done
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

4. Revoca la segunda sesión de Paco desde la primera. Guarda su id, la de `"current":false` en el paso 2, en `S`, y pide un comprobante para esa operación exacta con la contraseña de Paco:

    ```bash
    S=<id de la sesión>
    read -rsp 'Contraseña de Paco: ' pw; echo
    printf '{"json":{"password":"%s","operation":{"action":"platform.revokeSession","input":{"session":"%s"}}}}' "$pw" "$S" \
      | rpc -b "$D/paco" --data-binary @- localhost:3000/api/rpc/proofs/request; unset pw
    ```

    Devuelve `{"json":{"proof":"…","expiresAt":…}}` y `200`. Con ese comprobante, en los 5 minutos siguientes:

    ```bash
    rpc -b "$D/paco" -H 'idempotency-key: revocar-1' -H 'step-up-proof: <comprobante>' -d "{\"json\":{\"session\":\"$S\"}}" localhost:3000/api/rpc/sessions/revoke
    ```

    Devuelve `{"json":{"result":{"session":"…"},"entry":…}}` y `200`. Sin la cabecera `step-up-proof`, la misma orden responde `STEP_UP_REQUIRED` y `403`.

5. `sesiones` escribe `paco 200`, `paco2 401` y `rocio 200`.

Al terminar, `rm -rf "$D"`: las cookies son sesiones abiertas. Para cerrarlas antes, `rpc -b "$D/<nombre>" -X POST localhost:3000/api/auth/sign-out`.

## La base de datos

Un solo fichero SQLite, `/data/domus.db`, dentro del volumen `domus_domus-data` (ADR 0021). Junto a él pueden aparecer `domus.db-wal` y `domus.db-shm` mientras `api` está en marcha: forman parte de la base de datos. Las migraciones se aplican solas al arrancar `api`. Las copias de seguridad llegan en la fase 1d; hasta entonces, no borres el volumen.

### Comprobar que los datos persisten

En la Pi, dentro de `~/domus` (`ssh kira`, `cd ~/domus`). Esta orden lee el historial de migraciones abriendo el fichero en solo lectura y sin crearlo si no existe:

```bash
docker compose exec api node -e "const db = new (require('better-sqlite3'))('/data/domus.db', { readonly: true, fileMustExist: true }); console.log(db.prepare('SELECT * FROM platform_migrations ORDER BY module, position').all()); db.close()"
```

1. Ejecútala y apunta las filas de `platform`, `hash` y `applied_at` incluidos. Las dos primeras están escritas a mano: `position` `0` (`0000_migration_history`) y `position` `1` (`0001_action_log`, el registro de acciones). Desde `position` `2` son las generadas por `drizzle-kit` (ADR 0023), cuyo nombre empieza por su propio número: `0001_lively_sharon_carter`, `0002_milky_shen` (cuentas, sesiones, aparatos y permisos), `0003_open_tarot` (delegación), `0004_vengeful_the_leader` (confirmaciones pendientes) y `0005_perfect_ultragirl` (comprobantes).
2. `docker compose restart api` y vuelve a ejecutarla.
3. `docker compose up -d --force-recreate api`, que cambia el contenedor y conserva el volumen, y vuelve a ejecutarla.
4. Tras el paso 2 y tras el 3, `sesiones` (de «Comprobar las cuentas y la autorización», en la misma terminal) sigue escribiendo `paco 200`, `paco2 401` y `rocio 200`, y la orden `curl` de «Comprobar» sigue dando `401` y `404`.

Las tres lecturas dan las mismas filas completas, `applied_at` incluido, y ninguna fila nueva. Si `applied_at` cambia, el contenedor no está usando el volumen. La primera vez que `api` arranca con la 1c sobre la base de la 1b, su registro dice `5 migrations applied` y las filas `0` y `1` no cambian; en los arranques siguientes, `0`.

## Secretos

`api` firma las sesiones con `DOMUS_AUTH_SECRET` y acepta peticiones con cookies solo desde los orígenes de `DOMUS_ORIGINS`. Los dos viven en el fichero `.env` junto a `docker-compose.yml` en la Pi, fuera de git, y `docker compose` no arranca sin el secreto:

```sh
DOMUS_AUTH_SECRET=<salida de: openssl rand -base64 32>
DOMUS_ORIGINS=http://kira.local:3000,https://kira.taildd967b.ts.net
```

Cambiar el secreto cierra todas las sesiones.
