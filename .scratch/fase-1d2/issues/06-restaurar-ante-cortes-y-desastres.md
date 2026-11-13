# 06. Restaurar ante cortes y desastres

Status: ready-for-agent
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «Restaurar» (instalar, retomar e invariantes) y, en «Decisiones de prueba», las costuras 2 y 3 (los cortes). ADR 0026.

## Qué construir

La demostración de que el procedimiento de la 05 aguanta lo que tiene que aguantar: un proceso muerto en cada paso delicado, una base actual dañada o ausente, y un conjunto anterior que se conserva entero. Si las pruebas descubren un fallo, esta tarea lo corrige.

- **Cortes con procesos hijos**, con el arnés de la 02 y los puntos de corte de la 05: un hijo restaura y se mata con SIGKILL en cada una de estas posiciones:
    1. con `restore.pending.tmp` escrito y aún sin renombrar;
    2. con la marca ya renombrada a `restore.pending`;
    3. tras borrar `domus.db-wal` y `domus.db-shm`;
    4. tras renombrar la preparada sobre `domus.db`;
    5. con la base instalada y antes de borrar la marca.
- En cada posición, el padre comprueba qué hace abrir (arranca con la base anterior entera en la 1; se niega en la 2–5), que el conjunto conservado sigue intacto y que restaurar otra vez deja la restaurada saneada.
    - En la 2–5, restaurar otra vez retoma desde la marca, sin crear otra carpeta `before-restore`.
    - En la 1 no hay marca: la base anterior sigue en su sitio y `api` puede haber escrito en ella, así que restaurar otra vez empieza de cero y crea una carpeta `before-restore` nueva. La del intento cortado queda sobrante e inofensiva, como en la tabla del grilling para los cortes antes de publicar la marca.
- **Base actual dañada**: restaurar funciona sin abrirla y conserva sus ficheros tal cual.
- **Base actual ausente**: restaurar instala la copia preparada y no deja una base vacía en ningún momento.
- **Conjunto anterior con WAL**: una base anterior con escrituras confirmadas todavía en su WAL se conserva en `before-restore-…` y, abierta allí, conserva esas escrituras.
- La resistencia a un corte de luz descansa en el orden y los `fsync`, que se revisan en el código; las pruebas comprueban la recuperación.

## Criterios de aceptación

- [ ] Las cinco posiciones de corte tienen su prueba con un proceso muerto por SIGKILL, y en cada una abrir hace lo esperado y restaurar otra vez termina la restauración: retomando sin otra carpeta `before-restore` en la 2–5, y empezando de cero en la 1.
- [ ] En ninguna posición queda un auxiliar viejo junto a la base restaurada ni una `domus.db` vacía.
- [ ] Restaurar sobre una base dañada funciona y conserva sus ficheros.
- [ ] Restaurar sin base actual funciona.
- [ ] El conjunto conservado con WAL conserva sus escrituras confirmadas.
- [ ] Lo que estas pruebas descubran queda corregido en el procedimiento.
- [ ] `pnpm check` pasa.
