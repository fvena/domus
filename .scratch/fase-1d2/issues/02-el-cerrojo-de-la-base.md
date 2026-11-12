# 02. El cerrojo de la base

Status: resolved
Blocked by: None (can start immediately)

Spec: [`../spec.md`](../spec.md), sección «El cerrojo de la base» y, en «Decisiones de prueba», la costura 3 (el cerrojo). ADR 0026.

## Qué construir

Nadie restaura mientras alguien usa la base, y nadie abre la base mientras se restaura. Esta tarea pone el cerrojo y el arnés de procesos hijos que reutilizan la 05 y la 06; no restaura nada todavía.

- **`domus.lock`** junto a `domus.db`, en la carpeta de datos: una base SQLite en modo `DELETE` con una tabla mínima, que nunca se sustituye ni se borra.
- **Compartido al abrir.** El camino común de abrir la plataforma, el de `api`, `accounts` y `createTestPlatform`, toma el cerrojo compartido con una transacción de lectura que lee de esa tabla antes de abrir `domus.db`, y lo suelta en `close()`. Si abrir falla después de tomarlo (migraciones, base dañada), lo suelta también. Cualquier error al tomarlo impide abrir la base. Es el punto donde se integra con la 01, que añade la configuración de las copias a esas mismas opciones.
- **Exclusivo**, ofrecido solo dentro de `platform` para restaurar (la 05): `BEGIN EXCLUSIVE` sin espera. Si alguien tiene el compartido, falla con `the database is in use: stop api and accounts first`.
- **Abrir con el exclusivo tomado** falla con `restore in progress`.
- La plataforma en memoria no usa cerrojo.
- **Arnés de procesos hijos** en la entrada de pruebas: lanza un proceso que abre la plataforma o toma el exclusivo sobre una carpeta dada, avisa a la prueba cuando lo tiene y espera hasta que la prueba lo mata con SIGKILL. Es solo para pruebas; nada de producción lo alcanza.

## Criterios de aceptación

- [x] Un hijo con la plataforma abierta impide al padre tomar el exclusivo, con el mensaje de la spec.
- [x] Un hijo con el exclusivo impide al padre abrir la plataforma, con `restore in progress`.
- [x] Muerto el hijo con SIGKILL, el padre toma el cerrojo que el hijo tenía.
- [x] El cerrojo se toma antes de abrir los datos: con el exclusivo tomado, abrir falla sin crear ni tocar `domus.db`.
- [x] Si abrir falla después de tomar el cerrojo, el cerrojo queda libre.
- [x] Dentro de un mismo proceso, una plataforma abierta también impide el exclusivo.
- [x] `api` y `accounts` pueden tener la base abierta a la vez.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `06ce496`. Decisiones tomadas al implementar, también en la spec («El cerrojo de la base» y costura 3): la tabla es `domus_lock` y el compartido la crea si falta; si `api` y `accounts` abren a la vez por primera vez sin `domus.lock`, uno puede fallar con `restore in progress` y abre en el siguiente intento; el exclusivo sobre un `domus.lock` recién creado puede dejar `domus.lock-journal`, que SQLite trata solo.
- Para la 05 y la 06, en `packages/platform/lock.ts`: `takeExclusiveLock(dataDirectory)` y `takeSharedLock(dataDirectory)` devuelven un `DatabaseLock` con `release()`. Restaurar debe guardar referenciada su asa hasta terminar: el recolector de basura cierra una conexión a la que nadie llega y se lleva el cerrojo (era la causa de una prueba intermitente). Dentro de un proceso, nunca abrir `domus.lock` con `node:fs`: cerrar ese descriptor suelta los bloqueos `fcntl` del proceso. `openPlatform` toma el compartido antes de abrir `domus.db` (en `dirname(databaseFile)`) y lo suelta en `close()` o si abrir falla.
- Arnés: `startChild(task)` de `@domus/platform/testing` lanza `testing/child.ts` con tsx (dependencia de desarrollo de `platform`) y se usa con `await using`; `kill()` manda SIGKILL y espera a que salga. Si el hijo no consigue su tarea, `startChild` rechaza con el mensaje del hijo. Las tareas de restaurar y sus puntos de corte entran como variantes nuevas de `ChildTask` en `children.ts` y `child.ts`.
- Las pruebas que espían `Database.prototype.close` (`platform.test.ts`, `migrator.test.ts`) filtran ahora por la conexión de `domus.db`, porque la del cerrojo también se cierra.
