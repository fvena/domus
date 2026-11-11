# 02. SQLite en `platform` y `test-utils`

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Base de datos» y «Composición».

Abre y cierra la base de datos. Las migraciones son la tarea 04: aquí `createPlatform` todavía no recibe módulos.

## Qué hacer

- `better-sqlite3` como dependencia de `platform`. Permitir su build en pnpm (la configuración que use la versión de `packageManager`).
- `drizzle-orm` y `better-sqlite3` en `DATA_AND_AI_LIBS` de `.dependency-cruiser.cjs` (`better-sqlite3` ya está). Comprobar que las reglas siguen dejando a `platform` y `module-sdk` usarlos, y que `tooling/scripts/architecture.test.ts` prueba que la regla salta para `drizzle-orm` desde una app.
- `createPlatform({ databaseFile })`, con `databaseFile` una ruta absoluta o `":memory:"`:
    - abre la conexión, pone `journal_mode=WAL` (sobre fichero) y `foreign_keys=ON`;
    - si algo falla al inicializar, cierra la conexión antes de lanzar el error;
    - `platform.close()` cierra la conexión y se puede llamar varias veces.
- `createTestPlatform({ file? })` en `test-utils`:
    - sin `file`, `:memory:`; con `file: true`, un fichero dentro de un directorio temporal que crea y luego borra; con `file: "<ruta>"`, usa esa ruta y no la borra;
    - devuelve la `platform` y la puerta (`createHttpHandler`, que en esta tarea sigue sin recibir nada);
    - implementa `Symbol.asyncDispose` (`await using`) y `close()`, los dos idempotentes.
- Actualizar los comentarios de `packages/platform/index.ts` y `packages/test-utils/index.ts`.

## Aceptación

Pruebas en `packages/platform` y `packages/test-utils`:

- sobre fichero, `PRAGMA journal_mode` es `wal` y `PRAGMA foreign_keys` es `1` tras inicializar;
- un dato escrito sobrevive a cerrar y reabrir el mismo fichero;
- si la inicialización falla (por ejemplo, una ruta en un directorio que no existe), no queda la conexión abierta;
- `close()` dos veces no lanza;
- `createTestPlatform` borra el directorio temporal que creó y conserva una ruta ajena;
- pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.
