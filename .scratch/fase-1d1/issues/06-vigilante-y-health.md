# 06. Vigilante y `/health`

Status: resolved
Blocked by: 03

Spec: [`../spec.md`](../spec.md), sección «El vigilante y `/health`». ADR 0025.

## Qué construir

El estado del segundo plano, visible desde fuera sin datos personales.

- El planificador deja una señal de vida en memoria cada vez que despierta, y despierta como mucho cada minuto aunque no haya nada que hacer.
- `/health` sigue respondiendo 200 mientras el proceso atiende, y añade un campo de segundo plano:
    - `ok`;
    - `degraded`, con un motivo: el planificador lleva más de unos 5 minutos sin señal, o hay un carril atascado.
- El healthcheck de Docker no cambia: es quien detecta un proceso que no responde.
- La copia de seguridad en `/health` llega con la 1d2.

## Criterios de aceptación

- [x] Con el planificador en marcha, `/health` dice `ok`.
- [x] Sin señal del planificador durante más del umbral, dice `degraded` con su motivo, y vuelve a `ok` cuando la señal regresa.
- [x] Con un carril atascado, dice `degraded` con su motivo, y vuelve a `ok` cuando el trabajo termina.
- [x] `/health` sigue respondiendo 200 y su cuerpo no lleva datos personales ni identificadores de cuentas.
- [x] Todo se prueba con el mando, sin esperas reales.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `ca45967`. Decisiones tomadas al implementar, también en la spec («Notas»): `/health` responde `{ status: "ok", background: { status: "ok" } }` o `background: { status: "degraded", reason: "scheduler-silent" | "lane-stuck" }`, con el del planificador primero si se dan los dos; degradado a partir de 5 min y 1 ms sin despertar, contados desde que se crea el segundo plano (uno que nunca arranca también se degrada); el carril atascado se lee del motor en memoria (`engine.stuck()`), no de `platform_jobs`.
- Para la 07: el healthcheck de Docker no cambia (solo mira el 200); `docs/despliegue.md` debe contar el campo `background` y sus dos motivos. Mando: `clock.advance(ms, { wake: false })` y `clock.set(instant, { wake: false })` mueven el reloj sin despertar, como un planificador callado. `Background.health()` está en `packages/platform/background/index.ts` y la puerta lo lee con `backgroundOf`.
