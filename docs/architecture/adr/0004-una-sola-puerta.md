# Una sola puerta: api

`api` autentica todos los canales (la app, Telegram, la voz y las apps conectadas) y pasa las conversaciones a `assistant`. Kira habla con Domus por la API como cualquier cliente y nunca abre el núcleo por dentro; tiene una sola llave y en cada petición dice de parte de quién habla. Un turno de conversación nunca corre dentro de una petición HTTP. El contrato de conversación recibe texto con adjuntos y quién habla, y devuelve un flujo de eventos cancelable (trozo, tarjeta, acción a la espera de «sí», fin), con salidas `hablada`, `texto` y `estructurada`.

Fecha: 2026-11-11. Preguntas del grilling: P2, P7, P8, P33.
