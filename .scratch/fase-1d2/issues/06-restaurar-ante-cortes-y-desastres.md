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
