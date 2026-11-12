# 07. La Pi y el cierre de la 1d1

Status: resolved
Blocked by: 01, 02, 03, 04, 05, 06

Spec: [`../spec.md`](../spec.md), secciones «Decisiones de prueba» («En la Pi») y «Notas». ADR 0025.

## Qué construir

La 1d1 publicada en la Pi y cerrada en los documentos.

- **`docs/despliegue.md`** explica qué es el planificador, cómo leer la lista de tareas y el campo de segundo plano de `/health`, y cómo comprobar la 1d1 en la Pi:
    - el planificador arranca con `api` y para de forma ordenada al recrear el contenedor, como se ve en el log;
    - la limpieza corre a su hora y queda en la lista con su resultado;
    - tras `restart` y tras recrear `api`, la hora elegida y la próxima ejecución se conservan;
    - `/health` dice `ok`;
    - la migración nueva de la plataforma se aplica sobre la base existente, y las filas anteriores conservan posición, hash e instante.
- **`docs/plan.md`** marca la 1d1 como hecha, con la fecha.
- **`docs/guia/`** recoge lo construido, según `docs/AGENTS.md`, revisado con la skill `humanizer`.
- **Arquitectura, glosario y ADR 0025**: se corrigen solo si la implementación los contradijo.

Los pasos que piden contraseña (iniciar sesión, pedir un comprobante para lanzar la limpieza a mano) los hace la persona, en español y paso a paso (`docs/agents/workflow.md`).

## Criterios de aceptación

- [x] En la Pi, el log muestra que el planificador arranca y para con `api`.
- [x] La limpieza corre a su hora en la Pi o, para no esperar, la lanza el admin a mano, y la lista de tareas muestra su resultado.
- [x] Tras `restart` y tras recrear `api`, la hora elegida y la próxima ejecución se conservan.
- [x] `/health` en la Pi dice `ok`.
- [x] `despliegue.md`, `plan.md` y la guía están al día.
- [x] `pnpm check` pasa.

## Comments

- Comprobado en la Pi el 2026-11-12 con `main` en `b4fcd2b`:
    - El primer arranque aplicó 3 migraciones (`0007`–`0009`); las 8 filas anteriores de `platform` conservan posición, hash y `applied_at`.
    - El log dice `scheduler started: 0 jobs recovered`; `docker compose restart api` deja `scheduler stopped` y otro `scheduler started`.
    - `cleanup` tiene su próxima ejecución el 2026-11-13 a las 04:30 de Madrid. Paco la lanzó a mano con comprobante: ejecución 1, manual, `ok`, en el carril de mantenimiento al primer intento; la lista la muestra en `lastRun`.
    - Con la hora cambiada a las 05:00, tras `restart` y tras `--force-recreate` de `api`, `time` y `next_at` se conservan. Deshacer el cambio la devolvió a las 04:30.
    - `/health` dice `{"status":"ok","background":{"status":"ok"}}` y los tres contenedores están `healthy`; sin sesión, `tasks/list` responde `401`.
- `despliegue.md` decía cerrar la sesión con `rpc … -X POST …/sign-out`, que manda `content-type: application/json` sin cuerpo y Better Auth responde `400`. Ahora lleva `-d '{}'`. La sesión de Paco de esta comprobación queda abierta hasta caducar, sin cookie que la use.
- Arquitectura, glosario y ADR 0025 no necesitan cambios: la implementación no los contradijo.
