# 06. El módulo `probe`

Status: ready-for-agent
Blocked by: 04, 05

Spec: [`../spec.md`](../spec.md), secciones «Forma del módulo» y «Módulo de prueba».

El módulo de prueba de toda la fase 1. En la 1a solo guarda datos.

## Qué hacer

- `modules/probe/` con `package.json`, `tsconfig.json`, `server/schema.ts`, `server/index.ts`, `server/migrations/` y `server/migrations.ts` (generados con `pnpm db:generate`), `tests/` y, si la estructura de los módulos lo pide, un `contracts/` vacío.
- El esquema usa `moduleTables("probe")` e `id()`. Dos tablas con una clave ajena entre ellas, para que las pruebas de `tooling` (tarea 07) tengan una clave ajena real.
- `defineModule({ id: "probe", testOnly: true, schema, migrations })`.
- Pruebas de almacenamiento en `modules/probe/tests/`: importan `probe`, lo inyectan en `createTestPlatform({ modules: [probe] })` y escriben y leen con `dbFor(probe)`. `dbFor` llega en esta tarea a `test-utils`: devuelve un cliente Drizzle tipado con el esquema del módulo y solo existe ahí.
- Un `AGENTS.md` (con su `CLAUDE.md`) solo si la carpeta lo necesita; `modules/AGENTS.md` ya explica las partes.

## Aceptación

- Las pruebas de `probe` pasan en memoria y sobre fichero.
- `probe` cumple todas las reglas de dependencias de un módulo (`pnpm lint`).
- `pnpm db:generate` no cambia nada en `modules/probe`.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.
