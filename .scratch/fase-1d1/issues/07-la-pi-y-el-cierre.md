# 07. La Pi y el cierre de la 1d1

Status: ready-for-agent
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

- [ ] En la Pi, el log muestra que el planificador arranca y para con `api`.
- [ ] La limpieza corre a su hora en la Pi o, para no esperar, la lanza el admin a mano, y la lista de tareas muestra su resultado.
- [ ] Tras `restart` y tras recrear `api`, la hora elegida y la próxima ejecución se conservan.
- [ ] `/health` en la Pi dice `ok`.
- [ ] `despliegue.md`, `plan.md` y la guía están al día.
- [ ] `pnpm check` pasa.
