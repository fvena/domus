# 07. `pnpm modules:generate`, la lista y las pruebas de `tooling`

Status: ready-for-agent
Blocked by: 05, 06

Spec: [`../spec.md`](../spec.md), sección «Lista de módulos».

La lista fija de módulos de `api`, generada y guardada en git, y las pruebas que recorren todos los módulos reales.

## Qué hacer

- `pnpm modules:generate` escribe la lista de `api`, por ejemplo `apps/api/src/modules.ts`, nunca dentro de una carpeta `generated/` (dependency-cruiser las excluye). Importa el `server/index.ts` de cada módulo de `modules/` y exporta las definiciones en un orden estable (alfabético por id).
- Deja fuera los módulos `testOnly` antes de escribir las importaciones: `probe` no aparece en el fichero. Comprueba que el id de cada definición coincide con su carpeta.
- Formateado con Oxfmt; generar dos veces no cambia nada.
- Solo la lista de `api`, con su fichero, su entrada y su tipo fijos en el código. El generador queda sencillo de ampliar cuando llegue la web, sin un sistema de salidas configurable antes de tiempo.
- Añadir `pnpm modules:generate` al paso de la CI de la tarea 05, antes de `git status --porcelain`.
- Pruebas de `tooling/scripts` sobre los módulos reales de `modules/`, `probe` incluido:
    - la lista regenerada en memoria es igual al fichero, sin escribirlo;
    - la lista no importa `probe`;
    - todas las migraciones reales se aplican sobre un fichero temporal con `createPlatform`;
    - ninguna clave ajena (`PRAGMA foreign_key_list`) apunta a una tabla de otro módulo;
    - cada tabla de `sqlite_master`, salvo las `sqlite_*`, empieza por `platform_` o por el prefijo de un módulo registrado.

    `tooling` puede componer los módulos reales; `platform` y `test-utils` no.

## Aceptación

- Las pruebas anteriores pasan, y un id que no coincide con su carpeta hace fallar el generador.
- `api-reaches-modules-through-server-entry` revisa la lista generada: una importación a algo interno de un módulo salta.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.
