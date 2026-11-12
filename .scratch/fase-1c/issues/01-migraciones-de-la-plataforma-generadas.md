# 01. Migraciones de la plataforma generadas

Status: resolved
Blocked by: ninguna (puede empezar ya)

Spec: [`../spec.md`](../spec.md), sección «Migraciones de la plataforma». ADR 0023.

## Qué construir

La plataforma declara su esquema en Drizzle, con prefijo `platform_`, empezando por las tablas que ya crean `0000` y `0001`. `drizzle-kit` genera las migraciones de la plataforma en su propia carpeta. La primera generada es una base que representa `0000` + `0001`: el generador la reconoce, compara su esquema con el de esas dos y no la emite como ejecutable. Las siguientes reciben sus posiciones ejecutables desde la 2, sin cambiar su nombre generado. `0000` y `0001` siguen escritas a mano, intactas. `audit` sigue con sentencias preparadas. `pnpm db:generate` genera también las de la plataforma. Esta tarea no añade tablas nuevas: deja el camino listo para las siguientes.

## Aceptación

- [x] El esquema de la base generada coincide con el que crean `0000` + `0001`.
- [x] La base nunca se aplica, tampoco sobre una instalación existente.
- [x] Los hashes y las posiciones de `0000` y `0001` no cambian.
- [x] Una migración de prueba generada después de la base recibe la posición 2. El esquema final coincide en una instalación limpia y tras actualizar una base de la 1b.
- [x] Dos generaciones seguidas no dejan cambios, y la CI lo comprueba con `pnpm db:generate && pnpm modules:generate`.
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.

## Comments

- Hecho en `2d15f36`.
- Dónde está cada cosa: el esquema en `packages/platform/schema.ts`; lo que escribe `drizzle-kit` en `packages/platform/migrations/` (la base es `0000_nice_lenny_balinger`); `pnpm db:generate` escribe `packages/platform/generated-migrations.ts` sin la base; `packages/platform/migrations.ts` junta `hand-written-migrations.ts` (`0000` y `0001`, movidas sin tocar su contenido) y las generadas. El generador está en `tooling/scripts/platform-migrations.ts` y compara la base con `0000` + `0001` aplicándolas en memoria y leyendo tablas, columnas, claves, únicos e índices desde SQLite.
- Para los tickets siguientes: una tabla nueva de la plataforma se declara en `schema.ts` con el prefijo `platform_` y se genera con `pnpm db:generate`. La primera generada tendrá el nombre `0001_…` y la posición 2.
- Fallo de `drizzle-kit` 0.31 que hay que conocer: en SQLite junta las columnas de un índice con comas y las vuelve a partir por comas, así que una expresión con coma (`ifnull(via, '')`) sale rota. En `schema.ts` esa expresión va en trozos cortados por su coma (`sql\`ifnull(${via}\``, `sql\` '')\``), que se vuelven a juntar enteros. Cualquier índice nuevo con expresiones con comas necesita lo mismo; el generador lo detectaría en la base, pero no en una migración posterior.
