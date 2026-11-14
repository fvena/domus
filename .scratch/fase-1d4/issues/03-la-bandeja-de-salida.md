# 03. La bandeja de salida

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), sección «La bandeja de salida». ADR 0025 y ADR 0029.

## Qué construir

La parte general de la bandeja de salida: un trabajo que deja una escritura dentro de su transacción, que solo existe si ella se confirma y que deshacer cancela mientras no haya empezado. Todavía no hay avisos: `ctx.notify` y el trabajo `notice` llegan con la 05, para que ningún aviso se dé por terminado sin sus entregas.

- **Migración generada de la plataforma**: `platform_jobs` gana `payload`, `entry` y `outcome`.
- **Tipos con datos**: cada tipo de trabajo que lleva `payload` declara su esquema, y el motor lo valida al reclamar. Uno que no cumple el esquema es un fallo definitivo con su código.
- **Encolar en la transacción de una escritura**: después de su entrada del registro de acciones, con su `entry`, y despertando el motor solo tras confirmar.
- **Deshacer**: cancela en su misma transacción los trabajos `pending` de la entrada, con la razón `undone`. Reclamar y cancelar no ocurren los dos.
- **El instante mínimo de un reintento**: un error pasajero puede llevarlo, y el motor reintenta en el mayor entre ese instante y su espera creciente, sin cambiar el número máximo de intentos.
- **Para probarlo**: `@domus/platform/testing` ofrece encolar un trabajo sintético en la transacción de la escritura en curso. Se usa desde un manejador de `probe` envuelto por la prueba, como en la 1d3. Ningún módulo ni `module-sdk` lo alcanza.

## Criterios de aceptación

- [x] Un trabajo encolado en una escritura que se confirma existe, lleva su `entry` y su `payload`, y corre después de confirmar.
- [x] Un trabajo encolado en una escritura que se revierte no existe.
- [x] Repetir la escritura con la misma clave devuelve el acuse y no encola otro.
- [x] Deshacer la escritura cancela su trabajo pendiente, que queda `cancelled` con la razón `undone`, y no corre.
- [x] Deshacer frente a reclamar: si gana deshacer, el trabajo no corre; si gana reclamar, deshacer no lo cancela y el trabajo termina.
- [x] Un `payload` que no cumple el esquema de su tipo es un fallo definitivo, sin reintentos.
- [x] Un error pasajero con instante mínimo se reintenta en ese instante si es posterior a la espera creciente, y en la espera si es anterior. El número de intentos no cambia.
- [x] Los trabajos de las tareas programadas siguen igual, con `payload` y `entry` nulos, y la limpieza de trabajos antiguos los sigue recogiendo.
- [x] La migración se aplica sobre una base de la 1d3, y dos generaciones seguidas no dejan cambios.
- [x] `pnpm check` pasa.

Si la 04 o la 05 llegan antes a `main` con su propia migración, esta tarea regenera la suya encima.

## Comments

- Hecho en `09b9ea7`.
- La 05 deja sus trabajos con `actions.enqueueInWrite({ kind, payload })` desde `ctx.notify`. Solo vale mientras corre el manejador de una escritura, y el trabajo se guarda después de su entrada, con su `entry`. Deshacer llama a `outbox.cancel(entry)`, que solo toca los `pending`.
- Un tipo con datos declara `payload` (un Standard Schema, como zod) en su `JobKind`, y su trabajo lo recibe en `JobContext.payload` tal como lo devuelve el esquema. Sin esquema no se puede encolar con datos.
- Un fallo definitivo con código es `new PermanentJobError(mensaje, { code })`, y se guarda como `PermanentJobError <código>: <mensaje>`. El reintento con instante mínimo es `new PassingJobError(mensaje, { notBefore, code? })`. La 06 los usa para `Retry-After` y sus códigos.
- `outcome`: el trabajo lo deja devolviendo un texto desde `run`. `background.jobs()` da `payload`, `entry` y `outcome`.
- Decidido sin preguntar, y anotado en la spec: el código `INVALID_PAYLOAD`, el formato del error con código, el nombre `PassingJobError` y la razón `undone` en la columna `error`.
