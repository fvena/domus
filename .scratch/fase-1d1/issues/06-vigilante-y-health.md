# 06. Vigilante y `/health`

Status: ready-for-agent
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

- [ ] Con el planificador en marcha, `/health` dice `ok`.
- [ ] Sin señal del planificador durante más del umbral, dice `degraded` con su motivo, y vuelve a `ok` cuando la señal regresa.
- [ ] Con un carril atascado, dice `degraded` con su motivo, y vuelve a `ok` cuando el trabajo termina.
- [ ] `/health` sigue respondiendo 200 y su cuerpo no lleva datos personales ni identificadores de cuentas.
- [ ] Todo se prueba con el mando, sin esperas reales.
- [ ] `pnpm check` pasa.
