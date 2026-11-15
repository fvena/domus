# 01. Las garantías vía el agente, en la autorización

Status: ready-for-agent
Blocked by: —

Spec: [`../spec.md`](../spec.md), sección «La autorización» y costura 1. ADR 0034 y ADR 0010.

## Qué construir

Antes de quitar el mandato, las garantías que hoy se cumplen por su canal `contexto` y por la lista de la puerta pasan a decidirse por `via` en `platform/authorization`. Así siguen valiendo para cualquier agente futuro cuando el mandato ya no exista. El mandato sigue funcionando durante este ticket.

- **Un comprobante no cuenta con `via`.** Vía el agente, una operación que pide comprobante solo se completa cuando la persona confirma desde la app, como hoy.
- **Un contexto con `via` no confirma ni rechaza.** Es un cambio de comportamiento, no solo de lugar: hoy el cierre depende de que el mandato lleve siempre el canal `contexto`, y un contexto con `via` que declara el canal `app` no está cerrado. Este ticket lo cierra y lo prueba.
- **La lista de operaciones de la plataforma que admiten `via`**, hoy `log/read` y `log/undo`, pasa de la puerta a la decisión. Cualquier otra operación de la plataforma, también una desconocida o una nueva, se deniega vía el agente. La puerta deja de llevar esa lista.
- **Quien confirma no es quien pide.** Una pendiente nacida vía el agente y confirmada por la persona desde la app conserva el `via` de origen para la delegación y para el registro, pero la persona que confirma no pasa a ser el agente: la confirmación es suya, por el canal `app` y sin `via`.
- **Las pruebas de obligaciones** de `mandates-http` y `platform-mandates-http` se reescriben sobre el contexto sintético con `via` (`test.context` y `test.member`), por el camino de las acciones, y la confirmación de la persona va con `browser()` por HTTP. Las que solo prueban el mecanismo se quedan hasta la 03.

## Criterios de aceptación

- [ ] Vía el agente, con un comprobante válido y el canal `app`, una operación que lo pide no se completa; confirmada después por la persona desde la app, sí.
- [ ] Un contexto con `via` no confirma ni rechaza una pendiente, con el canal `app` y también con `contexto`; la pendiente sigue sin consumir.
- [ ] Vía el agente, `log/read` y `log/undo` funcionan dentro de la delegación, y `log/undo` se deniega al retirarla.
- [ ] Vía el agente, cada otra operación de la plataforma se deniega, también un nombre desconocido.
- [ ] Una pendiente nacida vía el agente y confirmada por la persona con `browser()` desde otra sesión suya conserva la delegación de entonces, y su entrada en el registro lleva el `via` de origen.
- [ ] Siguen probadas sobre el contexto sintético: la delegación en «no», «sí» y «pedir confirmación»; un área sin fila; la delegación que no supera el permiso; una acción `manage` que no se completa; la clave de idempotencia por cuenta y `via`; `via` en el registro.
- [ ] Las pruebas del mandato por HTTP siguen pasando.
- [ ] `docs/agents/packages.md` describe dónde vive ahora la lista de operaciones que admiten `via`.
- [ ] `pnpm check` pasa.
