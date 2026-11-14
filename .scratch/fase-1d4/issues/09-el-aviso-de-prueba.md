# 09. El aviso de prueba

Status: ready-for-agent
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «El aviso de prueba» y la fila de `notifications/test` en «Errores de las rutas nuevas». ADR 0029.

## Qué construir

Una persona pide «envíame un aviso de prueba» y le llega al móvil. Existe para que la fase 2 reciba un aviso real antes de que haya un módulo que los envíe.

- **`notifications/test`** en `platformContract` como `notifications: { test }`: una escritura irreversible de la plataforma, con clave de idempotencia y su entrada en el registro de acciones.
- **Autorización**: solo una sesión de la app, sin `via`, de una cuenta de persona; sin nivel de ningún área y sin comprobante.
- **El aviso**: un `notice` con `{ kind: "test", to: <el actor> }`, cuyo reparto no comprueba registro y cuyas entregas llevan `{ kind: "test", notice }`.

## Criterios de aceptación

- [ ] Con suscripción, la petición llega al servicio falso y su contenido descifrado es `{ kind: "test", notice }`. Solo llega a las suscripciones habilitadas de quien lo pide.
- [ ] Sin ninguna suscripción, la escritura responde bien y el aviso termina `distributed` sin entregas, sin dejar nada pendiente.
- [ ] La escritura deja su entrada en el registro, y repetirla con la misma clave devuelve el acuse y no envía otro.
- [ ] Es irreversible: deshacerla no se puede.
- [ ] La cuenta `device` y `via` reciben `FORBIDDEN`. No pide comprobante ni nivel de ningún área.
- [ ] `pnpm check` pasa.
