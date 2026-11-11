# 04. Ejecutor de migraciones y `platform/0000`

Status: ready-for-agent
Blocked by: 02, 03

Spec: [`../spec.md`](../spec.md), sección «Migraciones».

El ejecutor propio de `platform`, que aplica las migraciones de la plataforma y de los módulos en una sola transacción al arrancar.

## Qué hacer

- `createPlatform({ databaseFile, modules })` comprueba las definiciones (tarea 03) y después aplica las migraciones antes de devolver la `platform`. `createTestPlatform` recibe también `modules`.
- `platform/0000`, la primera migración de la plataforma, en la misma forma `ModuleMigration`: crea `platform_migrations (module, position, tag, hash, applied_at)` con `(module, position)` y `(module, tag)` únicos, y se anota a sí misma dentro de la misma transacción. Si la tabla no existe, el historial está vacío.
- El ejecutor, sobre la conexión de `better-sqlite3` y sin nada interno de Drizzle, en este orden:
    1. valida el historial antes de cambiar nada: para cada módulo, lo aplicado es un prefijo exacto de lo que trae el código (mismo `tag`, posición y hash). Si no, rechaza con un mensaje que nombra módulo y migración: hash cambiado, migración que falta en el código u orden distinto, o filas de un módulo que no está en la lista;
    2. `PRAGMA foreign_keys=OFF`, fuera de la transacción;
    3. `BEGIN`; las pendientes de `platform` y después de cada módulo, en el orden de la lista, cada una anotada en el historial;
    4. `PRAGMA foreign_key_check`; cualquier error, del SQL o de esta comprobación, hace `ROLLBACK`; si no, `COMMIT`;
    5. en `finally`, `foreign_keys=ON`. Si algo falló, `createPlatform` cierra la conexión y lanza el error.
- Devuelve cuántas migraciones aplicó, para el log de `apps/api` (tarea 08).
- Estas pruebas usan definiciones escritas dentro de la propia prueba, con SQL a mano: `platform` no puede importar módulos.

## Aceptación

Pruebas en `packages/platform`:

- aplicar todo desde cero, y no aplicar nada la segunda vez;
- actualizar con datos existentes, incluida la reconstrucción de una tabla a la que apunta una clave ajena, como la escribe `drizzle-kit` (con sus `PRAGMA foreign_keys` dentro);
- crear y borrar el id más alto de una tabla con `AUTOINCREMENT`, migrar con una reconstrucción de esa tabla y comprobar que la siguiente inserción no reutiliza el id;
- una migración con un error de SQL detrás de otra correcta: no queda aplicada ninguna; esquema, datos e historial como antes, sin filas nuevas;
- lo mismo con una violación que solo detecta `foreign_key_check`;
- los cuatro rechazos del historial, sin cambiar ningún dato;
- un rechazo de las definiciones (tarea 03) desde `createPlatform`;
- tras cualquier fallo, la conexión está cerrada y `foreign_keys` vuelve a `ON` en una conexión nueva;
- pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.
