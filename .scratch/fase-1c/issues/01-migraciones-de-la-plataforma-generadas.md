# 01. Migraciones de la plataforma generadas

Status: ready-for-agent
Blocked by: ninguna (puede empezar ya)

Spec: [`../spec.md`](../spec.md), sección «Migraciones de la plataforma». ADR 0023.

## Qué construir

La plataforma declara su esquema en Drizzle, con prefijo `platform_`, empezando por las tablas que ya crean `0000` y `0001`. `drizzle-kit` genera las migraciones de la plataforma en su propia carpeta. La primera generada es una base que representa `0000` + `0001`: el generador la reconoce, compara su esquema con el de esas dos y no la emite como ejecutable. Las siguientes reciben sus posiciones ejecutables desde la 2, sin cambiar su nombre generado. `0000` y `0001` siguen escritas a mano, intactas. `audit` sigue con sentencias preparadas. `pnpm db:generate` genera también las de la plataforma. Esta tarea no añade tablas nuevas: deja el camino listo para las siguientes.

## Aceptación

- [ ] El esquema de la base generada coincide con el que crean `0000` + `0001`.
- [ ] La base nunca se aplica, tampoco sobre una instalación existente.
- [ ] Los hashes y las posiciones de `0000` y `0001` no cambian.
- [ ] Una migración de prueba generada después de la base recibe la posición 2. El esquema final coincide en una instalación limpia y tras actualizar una base de la 1b.
- [ ] Dos generaciones seguidas no dejan cambios, y la CI lo comprueba con `pnpm db:generate && pnpm modules:generate`.
- [ ] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`.
