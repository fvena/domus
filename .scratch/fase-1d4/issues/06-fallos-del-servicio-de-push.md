# 06. Fallos del servicio de push

Status: ready-for-agent
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

- [ ] 404 y 410 borran la suscripción, y la entrega termina con `subscription-gone`.
- [ ] 400 y 413 son un fallo definitivo, `PUSH_REJECTED`, sin reintentos.
- [ ] 401 y 403 son un fallo definitivo, `PUSH_UNAUTHORIZED`, y la suscripción sigue ahí.
- [ ] Un 3xx es un fallo definitivo, `PUSH_REDIRECT`, y no se sigue la redirección.
- [ ] 429, 5xx y un error de red se reintentan con la espera creciente del reloj de pruebas.
- [ ] 429 y 503 con `Retry-After` en segundos y en fecha no se reintentan antes de lo pedido.
- [ ] Un `Retry-After` que pasa el plazo de 24 h termina la entrega con `DELIVERY_EXPIRED`, sin intentarlo antes.
- [ ] Una petición que no termina recibe la señal al agotarse el tiempo del carril, termina, y el carril queda libre para el trabajo siguiente.
- [ ] Un endpoint que deja de estar en la lista entre la suscripción y el envío no recibe nada.
- [ ] Con dos suscripciones, una que falla con 500 y otra que responde 201: la segunda llega una sola vez, y el reintento de la primera no la repite.
- [ ] Las funciones puras cubren cada estado, `Retry-After` en segundos, en fecha, inválido y más allá del plazo.
- [ ] `pnpm check` pasa.
