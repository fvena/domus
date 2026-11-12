# 05. Visibilidad al leer

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Áreas, permisos y perfiles» (lo que declara cada área), «Visibilidad en las lecturas» y «`probe`». ADR 0023, ADR 0009.

## Qué construir

Las tablas con dueño y el filtro de visibilidad en las lecturas:

- **`module-sdk/db`** declara una tabla con dueño: columnas de dueño y visibilidad, tipo de registro y área. La clave es la columna `id` entera, y la plataforma rechaza al arrancar una tabla con dueño con clave compuesta.
- **Cada área declara** su visibilidad por defecto, si lo público lo edita quien tenga `write`, `alwaysPrivate` y `confirmOnSharedDevice`. Un área `alwaysPrivate` pone un `CHECK` en sus tablas que rechaza lo público.
- **El contexto del manejador** da el predicado de visibilidad por tabla con dueño. Un registro que el predicado oculta responde «no encontrado».
- **`probe`:**
    - notas y comentarios con dueño;
    - las áreas `probe.board`, `probe.health` y `probe.secret`, con sus tablas;
    - un conteo, una búsqueda y un join de notas con comentarios, con un predicado por tabla.
- **Las formas de consulta admitidas** quedan escritas en el `AGENTS.md` de `modules/`.

Hasta que la 06 añada la captura de escrituras, `createPlatform` rechaza un módulo con tablas con dueño. Así producción no puede escribir en ellas sin protección, y las pruebas siguen funcionando con `createTestPlatform`.

## Aceptación

- [x] Lo privado ajeno da «no encontrado» en la lectura, el conteo, la búsqueda y el join, y lo público se ve.
- [x] Crear deja como dueño a la cuenta representada, con la visibilidad por defecto del área.
- [x] `probe.health` y `probe.secret` no admiten un registro público, por el `CHECK`.
- [x] Al arrancar se rechaza una tabla con dueño con clave compuesta, y `createPlatform` rechaza un módulo con tablas con dueño.
- [x] Las pruebas de la 1b sobre notas y comentarios siguen pasando, con dueño.
- [x] Pasan todas las comprobaciones, y la generación no deja cambios.

## Comments

- Hecho en `21a117f`.
- Dónde está cada cosa: `module-sdk/areas.ts` (`AreaDefinition` con `defaultVisibility`, `publicEditable`, `alwaysPrivate` y `confirmOnSharedDevice`, y `Visibility`); `module-sdk/db` (`moduleTables(id, areas).ownedTable(name, { type, area }, columns, extra?)`, que añade `id`, `owner` y `visibility` y un `CHECK` de visibilidad; la marca se lee con `ownedTableOf(tabla)` → `{ type, area, alwaysPrivate }`); `checkModules` rechaza una tabla con dueño sin el `id` entero como única clave, en un área que el módulo no declara, construida con otro `alwaysPrivate` que el del módulo, o con un tipo de registro repetido, y un área `alwaysPrivate` pública por defecto. `platform/authorization/visibility.ts` tiene la regla (`visibleTo`, `newOwnership`); `AreaPolicy` ya lleva los cuatro campos con sus valores por defecto (`identity/access.ts`), y `createActions` recibe `areas`.
- El contexto del manejador gana `visible(tabla)` (el predicado) y `ownership(tabla)` (`{ owner, visibility }` para el insert). Una tabla que no es con dueño de su módulo da error interno.
- Para la 06: cada tabla con dueño tiene `id` entero como única clave, columnas `owner` y `visibility`, y un tipo de registro único en su módulo, el mismo que van en `touched` (`note`, `comment`, `board`, `health`, `secret`). Los triggers se pueden crear recorriendo `module.schema` con `ownedTableOf`. Al terminar hay que quitar el rechazo de `createPlatform` (`platform.ts`, con su prueba en `platform.test.ts`) y volver a `createPlatform` en `tooling/scripts/real-modules.test.ts`, que ahora usa `createPlatformWithClock` de la entrada de pruebas. `probe.board` ya existe (pública por defecto, `publicEditable`) con su tabla, sin acciones; `restoreNote` recibe ahora la visibilidad. Hoy un miembro edita o borra una nota pública ajena de `probe`: lo impedirá la captura.
- Para la 08: `probe.health` declara `confirmOnSharedDevice` y tiene `readHealth`/`recordHealth`; `probe.secret`, `readSecret`/`recordSecret`. `AreaPolicy.confirmOnSharedDevice` ya llega a `decide` por la vista.
- `Decision` sigue siendo `"allow" | "deny"`: el «no encontrado» de la visibilidad lo da cada manejador con su error (`NOTE_NOT_FOUND`, `null`…), no la autorización.
- Migración `probe/0001_broad_namor`: `drizzle-kit` reconstruye notas y comentarios copiando `owner` y `visibility` de la tabla vieja, que no los tiene; corregí el SQL generado para copiar `''` y `'private'` (las filas de la 1b quedan sin dueño y ocultas). El `CHECK` usa la columna sin calificar (`sql.identifier`), porque `drizzle-kit` la calificaba con el nombre temporal `__new_…` de la reconstrucción.
- `module-sdk/db` exporta además `and`, `asc` y `count`.
