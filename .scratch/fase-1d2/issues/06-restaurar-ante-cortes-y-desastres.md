# 06. Restaurar ante cortes y desastres

Status: resolved
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «Restaurar» (instalar, retomar e invariantes) y, en «Decisiones de prueba», las costuras 2 y 3 (los cortes). ADR 0026.

## Qué construir

La demostración de que el procedimiento de la 05 aguanta lo que tiene que aguantar: un proceso muerto en cada paso delicado, una base actual dañada o ausente, y un conjunto anterior que se conserva entero. Si las pruebas descubren un fallo, esta tarea lo corrige.

- **Cortes con procesos hijos**, con el arnés de la 02 y los puntos de corte de la 05: un hijo restaura y se mata con SIGKILL en cada una de estas posiciones:
    1. con `restore.pending.tmp` escrito y aún sin renombrar;
    2. con la marca ya renombrada a `restore.pending`;
    3. tras borrar `domus.db-wal` y `domus.db-shm`;
    4. tras renombrar la copia en preparación sobre `domus.db`;
    5. con la base instalada y antes de borrar la marca.
- En cada posición, el padre comprueba qué hace abrir (arranca con la base anterior entera en la 1; se niega en la 2–5), que el conjunto conservado sigue intacto y que restaurar otra vez deja la restaurada saneada.
    - En la 2–5, restaurar otra vez retoma desde la marca, sin crear otra carpeta `before-restore`.
    - En la 1 no hay marca: la base anterior sigue en su sitio y `api` puede haber escrito en ella, así que restaurar otra vez empieza de cero y crea una carpeta `before-restore` nueva. La del intento cortado queda sobrante e inofensiva, como en la tabla del grilling para los cortes antes de publicar la marca.
- **Base actual dañada**: restaurar funciona sin abrirla y conserva sus ficheros tal cual.
- **Base actual ausente**: restaurar instala la copia en preparación y no deja una base vacía en ningún momento.
- **Conjunto anterior con WAL**: una base anterior con escrituras confirmadas todavía en su WAL se conserva en `before-restore-…` y, abierta allí, conserva esas escrituras.
- La resistencia a un corte de luz descansa en el orden y los `fsync`, que se revisan en el código; las pruebas comprueban la recuperación.

## Criterios de aceptación

- [x] Las cinco posiciones de corte tienen su prueba con un proceso muerto por SIGKILL, y en cada una abrir hace lo esperado y restaurar otra vez termina la restauración: retomando sin otra carpeta `before-restore` en la 2–5, y empezando de cero en la 1.
- [x] En ninguna posición queda un auxiliar viejo junto a la base restaurada ni una `domus.db` vacía.
- [x] Restaurar sobre una base dañada funciona y conserva sus ficheros.
- [x] Restaurar sin base actual funciona.
- [x] El conjunto conservado con WAL conserva sus escrituras confirmadas.
- [x] Lo que estas pruebas descubran queda corregido en el procedimiento.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `c7fb379`. Las pruebas están en `packages/test-utils/restore.test.ts` («restoring over a database in trouble» y «a restore killed by SIGKILL») y no encontraron ningún fallo: el procedimiento de la 05 queda como estaba. Repasados en el código el orden y los `fsync` de preparar, publicar e instalar.
- El conjunto anterior de las pruebas de corte lleva la segunda nota solo en su WAL (se copian la base y su WAL con la plataforma abierta y se ponen en su sitio tras cerrar), así que en la posición 2 la prueba ve que retomar retira el WAL viejo, y en todas que el conjunto conservado lo guarda.
- En la posición 1 la prueba escribe en la base anterior antes de restaurar otra vez, y la carpeta `before-restore` nueva guarda esa escritura: por eso empezar de cero es lo correcto.
- Quitadas dos pruebas de la 05 que ahora cubren las de esta tarea: el corte en el mismo proceso en `auxiliaries-removed` y el hijo en `marker-published`. Queda la de la marca puesta a mano.
- Revisión del código de `main...feat/fase-1d2`, hecha en la rama `feat/fase-1d2-revision`. Lo que corrigió:
    - Pruebas del `failed` de un tipo de trabajo: se llama una vez con un error permanente y una vez al agotar los reintentos de uno pasajero, y nunca cuando una parada cancela el trabajo. Y una prueba de que parar la plataforma con `backup-check` en marcha deja su marca como estaba (`ccc854d`).
    - La regla `backups-stay-in-platform` cubre también `packages/platform/lock.ts`, con su caso en el fixture de `architecture.test.ts` (`5151f6c`).
    - Restaurar llama a `checkModules(modules)` como abrir la plataforma, antes de tomar el cerrojo (`59a2ccb`).
    - `forget` lleva `--retry-lock 10m`: la retención espera a la restauración del ensayo igual que el ensayo espera a un `prune`, y solo un bloqueo que sigue tras la espera es una retención fallida. Probado con un restic falso y anotado en la spec (`e2678f7`).
    - Limpiezas sin cambio de comportamiento (`c66b8b1`): `emptyFolder` y `SNAPSHOT_FILE` viven en `backups/staging.ts`; `HOST`, `createRestic` y el mensaje `restic <paso> exited with code <n>` (`resticExited`) en `backups/restic.ts`; restaurar construye restic en un solo sitio; `errorCode` (`packages/platform/error-code.ts`) sustituye el molde de `code` en `lock.ts`, `restore.ts` y el motor. El ejecutor de restic se llama `restic` y `Waiting` pasa a `ClockAndTimer`. La copia de restaurar es la copia «en preparación» (`staged` en el código), porque **Archivo preparado** es otra cosa en el glosario. `sanitizeCopy` y `rescheduleTasks` usan los horarios de las tareas (`CLEANUP_SCHEDULE`, `BACKUP_SCHEDULES` y `moveNextRuns` del planificador) en vez de construir las copias o un planificador enteros. Fuera los intermediarios `syncFolder` y `restoreWithRuntime`: la entrada de pruebas reexporta `runRestore`.
- Hallazgos de la revisión que se quedan como están, a propósito:
    - Ningún término nuevo en el glosario: el cerrojo, las marcas y las carpetas de preparación son piezas de la implementación, como se decidió en el grilling de la 1d2. El choque real, «preparada», se ha renombrado.
    - La comprobación de rutas absolutas sigue en la plataforma y en `apps/api`: la plataforma no se fía de quien la llama.
    - El formato de una sola línea por paquete de `packages/AGENTS.md` es anterior a la 1d2; darle otra forma es una limpieza aparte.
    - `restore.mjs` sale con `2` y el texto de uso ante argumentos incorrectos: es la convención para una orden mal escrita.
