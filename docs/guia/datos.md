# Los datos

## Qué es

Todo lo que guarda Domus vive en un solo fichero, una base de datos SQLite. SQLite es una base de datos que cabe entera en un fichero y no necesita ningún programa aparte. El único que la abre es api.

## Cómo funciona

Los datos se ordenan en tablas, parecidas a hojas de cálculo con columnas fijas. Con el tiempo las tablas cambian: aparece una columna nueva, o una tabla se parte en dos. A cada uno de esos cambios lo llamamos migración. Es un conjunto de instrucciones que se escribe una sola vez, se guarda junto al código y lleva la base de datos de una versión a la siguiente.

Cada vez que api arranca, primero lee el historial de migraciones que ya se aplicaron, que vive dentro de la propia base de datos, y lo compara con las que trae el código. Si una migración ya aplicada ha cambiado, ha desaparecido o está en otro orden, se niega a seguir.

Si todo cuadra, aplica las pendientes de una vez. O salen todas o no sale ninguna: si una falla, se deshacen las demás y la base de datos se queda como estaba. Antes de dar el cambio por bueno comprueba también que ningún dato apunta a otro que ya no existe. Al terminar deja anotado cuántas migraciones ha aplicado, que casi siempre son cero.

Cuando algo de esto falla, api no llega a arrancar. Es a propósito: es mejor que Domus no abra a que trabaje con datos a medias.

Casi todos los registros llevan un número. Si uno se borra, su número no se le vuelve a dar a ningún otro, ni siquiera cuando una migración rehace la tabla entera.

## Por qué es así

Un solo fichero es fácil de entender y de copiar, y para una casa es más que suficiente.

Lo de todas o ninguna lo decidimos porque una actualización a medias deja la base de datos en un estado que nadie ha previsto.

El historial evita un error que no se vería a simple vista: que alguien retoque una migración vieja y la base de datos acabe siendo distinta de lo que el código cree. Y no reutilizar números evita que algo que apuntaba a un registro borrado acabe apuntando, sin que nadie se entere, a otro distinto.

## En el código

- El fichero: `<DOMUS_DATA_DIR>/domus.db`. En Docker es `/data/domus.db`, dentro del volumen `domus_domus-data`; con `pnpm dev`, `data/domus.db` en la raíz del repositorio.
- Abrirla: `createPlatform({ databaseFile, modules })` en `packages/platform/platform.ts`, con `better-sqlite3`, modo WAL y claves ajenas activadas.
- El ejecutor: `packages/platform/migrator.ts`. El historial es la tabla `platform_migrations`. La primera migración de la plataforma, `platform/0000`, está escrita a mano en `packages/platform/migrations.ts`.
- Migraciones de un módulo: las genera `pnpm db:generate` con drizzle-kit en `modules/<id>/server/migrations/`, y el mismo comando escribe `server/migrations.ts`.
- En el registro de api: `database at <ruta>: <N> migrations applied`.
- Decisiones: [ADR 0002](../architecture/adr/0002-vue-spa-sqlite-y-pwa.md) y [ADR 0021](../architecture/adr/0021-datos-de-los-modulos-y-migraciones.md).
