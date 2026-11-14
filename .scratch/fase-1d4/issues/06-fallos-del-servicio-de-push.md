# 06. Fallos del servicio de push

Status: resolved
Blocked by: 05

Spec: [`../spec.md`](../spec.md), sección «La entrega y el envío» (la tabla de respuestas, `Retry-After` y el plazo) y «Servicios de push admitidos». Costura 1 (el servicio falso) y costura 5 (clasificar respuestas y leer `Retry-After`). ADR 0029.

## Qué construir

Lo que hace Domus cuando el servicio de push no responde bien. Que falle un aparato no frena a los demás, un reintento no reenvía lo que ya llegó y el carril corto nunca se queda atascado.

- **La clasificación de cada respuesta**, como función pura: 2xx, 404 y 410, 400 y 413, 401 y 403, 3xx, 429, 5xx, error de red y tiempo agotado.
- **`Retry-After`**, como función pura: segundos y fecha HTTP, y un valor inválido se ignora. El instante mínimo va al motor (la 03). Un reintento que caería después del plazo de la entrega la termina con `DELIVERY_EXPIRED`, sin intentarlo antes.
- **La cancelación**: el tiempo máximo del carril aborta la señal del `fetch`.
- **El endpoint se vuelve a validar** antes de cada envío.
- **El servicio falso** responde lo que pida la prueba, y una petición que no termina respeta `AbortSignal`.

## Criterios de aceptación

- [x] 404 y 410 borran la suscripción, y la entrega termina con `subscription-gone`.
- [x] 400 y 413 son un fallo definitivo, `PUSH_REJECTED`, sin reintentos.
- [x] 401 y 403 son un fallo definitivo, `PUSH_UNAUTHORIZED`, y la suscripción sigue ahí.
- [x] Un 3xx es un fallo definitivo, `PUSH_REDIRECT`, y no se sigue la redirección.
- [x] 429, 5xx y un error de red se reintentan con la espera creciente del reloj de pruebas.
- [x] 429 y 503 con `Retry-After` en segundos y en fecha no se reintentan antes de lo pedido.
- [x] Un `Retry-After` que pasa el plazo de 24 h termina la entrega con `DELIVERY_EXPIRED`, sin intentarlo antes.
- [x] Una petición que no termina recibe la señal al agotarse el tiempo del carril, termina, y el carril queda libre para el trabajo siguiente.
- [x] Un endpoint que deja de estar en la lista entre la suscripción y el envío no recibe nada.
- [x] Con dos suscripciones, una que falla con 500 y otra que responde 201: la segunda llega una sola vez, y el reintento de la primera no la repite.
- [x] Las funciones puras cubren cada estado, `Retry-After` en segundos, en fecha, inválido y más allá del plazo.
- [x] `pnpm check` pasa.

## Comments

- Hecho en `20b8df6`.
- La clasificación y `Retry-After` son `classifyAnswer` y `retryAfterInstant` de `notifications/answers.ts`, puras; los códigos `PUSH_REJECTED`, `PUSH_UNAUTHORIZED` y `PUSH_REDIRECT` viven ahí, y `DELIVERY_EXPIRED` en `notices.ts`. `PushServiceError` desaparece: un fallo pasajero con estado es `PassingJobError HTTP_<estado>`, y un error de red se relanza tal cual.
- El motor da ahora `JobContext.retryAt(notBefore?)`: el instante al que reintentaría un fallo pasajero de ese intento, o nada en el último. Quien construya un `JobContext` a mano (pruebas, `testing/child.ts`) debe pasarlo.
- Decidido sin preguntar, y anotado en la spec: como el motor reintenta un tiempo agotado sin mirar lo que lanza el trabajo, la comprobación antes de cada envío gana un paso, después de la decisión sobre el registro y antes del endpoint: una entrega pasada su plazo termina `DELIVERY_EXPIRED` sin enviar. Un 4xx que la tabla no nombra es `PUSH_REJECTED`; la fecha de `Retry-After` solo en IMF-fixdate.
- La 09: su entrega de prueba pasa por el mismo `send` y la misma clasificación; no hace falta tocarlos. Las pruebas de esta tarea están en `modules/probe/tests/push-answers.test.ts`, aparte de `notices.test.ts`. El servicio falso ofrece `neverAnswers` para una petición que no termina.
