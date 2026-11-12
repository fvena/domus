# 03. `defineModule` y tablas con prefijo en `module-sdk`

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), sección «Forma del módulo».

La forma mínima de un módulo en la 1a, sin contexto ni cliente de base de datos para producción.

## Qué hacer

- `@domus/module-sdk` exporta `defineModule({ id, testOnly?, schema, migrations })` y los tipos `ModuleDefinition` y `ModuleMigration` (`{ tag, position, hash, statements }`, la forma que escribe la tarea 05).
- `@domus/module-sdk/db` (un punto de entrada aparte en `package.json`) reexporta de Drizzle lo que un módulo necesita para declarar tablas (columnas de `sqlite-core`, `sql`) y añade:
    - `moduleTables(id)`, que devuelve `{ table }` y pone el prefijo `<id>_` a cada tabla;
    - `id()`, la columna `INTEGER PRIMARY KEY AUTOINCREMENT`.

    Nota de la revisión: la tarea 06 añadió `eq`, que ya usa una prueba de almacenamiento de `probe`; sin él, la prueba tendría que importar `drizzle-orm`, que la regla prohíbe. Se queda.

- Una comprobación de definiciones que usarán `createPlatform` (tarea 04) y el generador de la lista (tarea 07). Rechaza, con un mensaje que nombra el módulo:
    - un id que no cumple `[a-z][a-z0-9]*`;
    - el id `platform`;
    - dos módulos con el mismo id;
    - una tabla del esquema sin el prefijo de su propio módulo.
- Ni `instant()` ni `localDate()`: la convención está en el ADR 0021 y cada helper entra con su primer uso.
- Ningún campo reservado para la 1b, la 1d o la fase 5.

## Aceptación

- Pruebas en `packages/module-sdk` de cada rechazo y de que `moduleTables("probe").table("notes", …)` se llama `probe_notes`.
- Un módulo solo necesita importar `@domus/module-sdk` y `@domus/module-sdk/db`; la regla de dependencias sigue impidiéndole importar `drizzle-orm` directamente.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

## Comments

- Hecha en `0265729`; `406d6ee` añadió al Dockerfile lo que necesita `better-sqlite3` al instalarse. En la revisión (`fdc0c41`) el id reservado pasó a ser `PLATFORM_ID`, exportado una sola vez.
