# Los módulos

## Qué es

Un módulo es una parte de la vida de casa con su propio código y sus propias tablas. Hoy solo hay uno, probe, que existe para las pruebas y no se usa en casa.

## Cómo funciona

Cada módulo tiene un nombre corto en minúsculas, que es también el nombre de su carpeta, y ese nombre va delante de cada una de sus tablas. Las de probe se llaman `probe_notes` y `probe_comments`. Así dos módulos pueden tener cada uno su tabla de notas sin pisarse.

Un módulo se declara con su nombre, sus tablas y sus migraciones. Al arrancar, la plataforma revisa que todo cuadre: que los nombres sean válidos y no se repitan, que nadie use `platform`, que está reservado, y que cada tabla lleve el prefijo de su módulo.

Una tabla solo puede apuntar a otra de su mismo módulo. Hay una prueba que lo comprueba sobre todos los módulos.

api no va a buscar los módulos cuando arranca. Usa una lista fija que escribe un comando a partir de la carpeta de módulos y que se guarda con el código. Si alguien añade un módulo y se olvida de actualizarla, una comprobación automática lo avisa. Los módulos de prueba como probe no entran nunca en esa lista; las pruebas los cargan aparte.

## Por qué es así

Repartir la casa en partes permite añadir una sin tocar las demás.

Con la lista fija, en la Pi corre exactamente lo que se ha revisado y nada más. Ninguna pieza aparece por su cuenta.

Cómo se protegen los módulos unos de otros está contado en [Seguridad y privacidad](seguridad.md).

## En el código

- La forma de un módulo: `modules/probe/` tiene `package.json`, `server/schema.ts` (las tablas), `server/index.ts` (`defineModule`), `server/migrations.ts` y `tests/`.
- `@domus/module-sdk`: `defineModule`, `checkModules` y `PLATFORM_ID`. `@domus/module-sdk/db` ofrece `moduleTables(id)`, `id()`, las columnas, `sql` y `eq`. Un módulo no puede importar drizzle-orm directamente.
- La lista: `apps/api/src/modules.ts`, que escribe `pnpm modules:generate` (`tooling/scripts/module-list.ts`).
- Probar un módulo: `createTestPlatform({ modules })` y `dbFor(módulo)` de `@domus/test-utils`.
- Decisiones: [ADR 0017](../architecture/adr/0017-estructura-del-repositorio.md) y [ADR 0021](../architecture/adr/0021-datos-de-los-modulos-y-migraciones.md).
