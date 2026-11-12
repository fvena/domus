# Despliegue en la Raspberry Pi

La Pi se llama `kira`: `kira.local` en casa y `kira.taildd967b.ts.net` por Tailscale. Se entra con `ssh kira`.

| Qué          | Dónde                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Código       | `/home/fvena/domus`, un clon de `fvena/domus` en la rama `main`                                                                       |
| Contenedores | `api`, `assistant` y `voice-gateway`, del proyecto de compose `domus`                                                                 |
| Datos        | el volumen `domus_domus-data`, montado solo en `api`                                                                                  |
| Acceso       | `http://kira.local:3000` en casa; `https://kira.taildd967b.ts.net` por Tailscale, solo dentro de la red (`tailscale serve` → `:3000`) |

Las imágenes se construyen en la propia Pi, que es arm64, en unos 30 segundos. Docker arranca con el sistema y los contenedores tienen `restart: unless-stopped`, así que vuelven solos tras un corte de luz.

## Actualizar

```bash
ssh kira 'cd ~/domus && git pull --ff-only && docker compose up -d --build'
```

Se construyen y reinician los tres a la vez. Si `api` cambia de `protocol` y los otros dos no, se quedan en «incompatible» y no hacen nada hasta tener la misma versión (ADR 0020).

## Comprobar

```bash
ssh kira 'cd ~/domus && docker compose ps && docker compose logs --no-color assistant voice-gateway | grep "api at"'
```

- Los tres contenedores salen `healthy`.
- `assistant` y `voice-gateway` dicen «api at http://api:3000: ready». Si dicen «does not speak protocol», las imágenes son de versiones distintas: vuelve a construir.
- `curl -s -X POST localhost:3000/api/rpc/status` en la Pi devuelve `{"json":{"service":"domus","protocol":1}}`.
- `docker compose logs --no-color api | grep database` dice `database at /data/domus.db: <N> migrations applied`: las que había pendientes en ese arranque, y `0` si no había ninguna. Si una migración falla, `api` no arranca y la base de datos queda como estaba.

## La base de datos

Un solo fichero SQLite, `/data/domus.db`, dentro del volumen `domus_domus-data` (ADR 0021). Junto a él pueden aparecer `domus.db-wal` y `domus.db-shm` mientras `api` está en marcha: forman parte de la base de datos. Las migraciones se aplican solas al arrancar `api`. Las copias de seguridad llegan en la fase 1d; hasta entonces, no borres el volumen.

### Comprobar que los datos persisten

En la Pi, dentro de `~/domus` (`ssh kira`, `cd ~/domus`). Esta orden lee el historial de migraciones abriendo el fichero en solo lectura y sin crearlo si no existe:

```bash
docker compose exec api node -e "const db = new (require('better-sqlite3'))('/data/domus.db', { readonly: true, fileMustExist: true }); console.log(db.prepare('SELECT * FROM platform_migrations ORDER BY module, position').all()); db.close()"
```

1. Ejecútala y apunta la fila de `platform` en `position` `0` (`0000_migration_history`), `hash` y `applied_at` incluidos.
2. `docker compose restart api` y vuelve a ejecutarla.
3. `docker compose up -d --force-recreate api`, que cambia el contenedor y conserva el volumen, y vuelve a ejecutarla.

Las tres lecturas dan la misma fila completa, `applied_at` incluido, y ninguna fila nueva. Si `applied_at` cambia, el contenedor no está usando el volumen.

Aún no hay secretos: llegan con el núcleo (fase 1). Cuando lleguen, este documento dirá dónde viven.
