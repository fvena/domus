# 03. Carriles, cancelación, reintentos y recuperación

Status: resolved
Blocked by: 01

Spec: [`../spec.md`](../spec.md), sección «El motor de segundo plano». ADR 0025.

## Qué construir

El motor completo sobre lo que dejó la 01: dos carriles que no se estorban, trabajos que no pueden quedarse para siempre, fallos que se reintentan solo cuando tiene sentido y recuperación tras una caída.

- **Carril corto** junto al de mantenimiento. Los dos corren a la vez y cada uno ejecuta un trabajo a la vez. En la 1d1 el carril corto solo lo usan los trabajos sintéticos.
- **Trabajos sintéticos** en la entrada de pruebas de `platform`, de cualquiera de los dos carriles, cuyo final controla la prueba con promesas. No son un contrato público para los módulos.
- **Tiempo máximo** por tipo de trabajo: unos 30 s en el corto y 30 min en el de mantenimiento, para empezar. Al agotarlo, el motor activa la señal de cancelación.
- **Atascado.** Un trabajo que no termina dentro de un margen después de cancelarlo queda atascado. Su carril sigue ocupado y no empieza otro trabajo en él mientras siga corriendo. Al terminar, el carril se libera.
- **Errores.**
    - Los definitivos (entrada no válida, algo que no existe o un error marcado como definitivo) quedan fallidos a la primera.
    - Los pasajeros, incluido agotar el tiempo máximo, se reintentan desde unos 30 s, doblando la espera, hasta 5 intentos, y después quedan fallidos.
- **Recuperación al arrancar.** Lo que la base guarda en ejecución o atascado vuelve a pendiente con un intento más contado, o queda fallido si ya los agotó.
- **Parada ordenada completa.** Si un trabajo no termina dentro del margen, queda en ejecución en la base y se recupera al arrancar.

## Criterios de aceptación

- [x] Con trabajos sintéticos, un trabajo largo de mantenimiento no retrasa uno corto, y dentro de cada carril nunca corren dos a la vez.
- [x] Al agotar el tiempo máximo, el trabajo recibe la cancelación. Si la atiende, sale como pasajero y se reintenta.
- [x] Un trabajo que ignora la cancelación queda atascado, su carril no admite otro mientras corra y se libera cuando termina.
- [x] Los reintentos siguen la espera creciente y paran en el máximo. Un error definitivo no se reintenta.
- [x] Prueba interna: un trabajo dejado en ejecución sin parada ordenada se recupera al abrir la plataforma sobre esa base, o queda fallido si agotó sus intentos.
- [x] Prueba interna: de dos reclamaciones del mismo trabajo solo gana una.
- [x] La parada ordenada deja en ejecución lo que no termina a tiempo, y se recupera en el arranque siguiente.
- [x] Todo se prueba con el mando, sin esperas reales.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `573d3f9`. Decisiones tomadas al implementar, también en la spec («Notas»): margen de atascado de 10 s y de parada de 5 s (por debajo de los 10 s de Docker); definitivo es `PermanentJobError` o un tipo no declarado; un trabajo fallido guarda solo el nombre del error y su código (`Error SQLITE_BUSY`), salvo `PermanentJobError` y los motivos del motor, que guardan su texto (200 caracteres como mucho), para no guardar datos personales; recuperar deja el trabajo pendiente para ya, y fallido con «interrupted: the process ended while the job ran» si agotó los intentos.
- Límites para las siguientes, en `packages/platform/background/engine.ts`:
    - `JobKind.timeout` declara el tiempo máximo; sin él vale `LANE_TIMEOUT` del carril. La limpieza por lotes (04) comprueba `signal` entre lotes y lanza al verla abortada: por tiempo máximo sale como pasajero y se reintenta; por la parada queda cancelada.
    - Entre reintentos `onFinish` no se llama: la ejecución sigue sin resultado hasta el final definitivo, y guarda como inicio el del primer intento. Un trabajo atascado tiene `state = 'stuck'` en `platform_jobs` y su ejecución sigue sin resultado: la lista de tareas (05) y `/health` (06) lo leen de ahí. El resultado `stuck` de las ejecuciones queda sin usar por ahora.
    - El planificador (02) debe ver como «en curso» un trabajo `pending` que reintenta, `running` o `stuck`.
    - `engine.nextDue()` incluye ya los tiempos máximos y márgenes de los trabajos en curso, así el despertar llega a tiempo.
    - Mando: opción `jobs` de `createTestPlatform` (tipos sintéticos de cualquier carril), `background.enqueue(kind)`, `background.flush()` (deja terminar lo que la prueba ya soltó sin esperar a lo retenido) y `background.jobs()`. `PermanentJobError` se exporta desde `@domus/test-utils`.
