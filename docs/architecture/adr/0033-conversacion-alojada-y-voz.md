# Conversación alojada y voz

Precisa los ADR 0004, 0006, 0012 y 0028: cómo se habla con el agente conectado desde la interfaz de Domus a partir de la fase 5, y de quién es la voz. Hasta entonces siguen vigentes la puerta de la conversación del ADR 0004 y la identidad por voz del ADR 0006.

**La conversación alojada.** La interfaz de Domus puede alojar la conversación con el agente conectado, por chat y por voz. La abre un botón o, con la escucha encendida, la palabra de activación del agente. Sin agente, Domus lo dice sin que fallen las demás pantallas. Los turnos usan AG-UI 1.0, condicionado a un prototipo: texto, adjuntos, el flujo de eventos y cancelar. El historial y las capacidades del agente (texto, adjuntos, voz) pueden ir en una interfaz pequeña aparte, y el prototipo comprueba el conjunto. Si muestra un hueco que AG-UI no cubre, se hace un contrato propio con la misma forma. Un turno nunca corre dentro de una petición HTTP (ADR 0004).

**El contexto lo pone Domus.** Junto con el mandato (ADR 0032), Domus entrega al servicio del agente, por una conexión autenticada y nunca como texto del prompt, el contexto que comprobó la puerta: persona, aparato, cuenta del aparato y canal. Con ese contexto, el servicio decide qué historial, qué memoria y qué tools incorpora antes de llamar al modelo.

**El historial.** La conversación la guarda el agente. Domus no guarda copia, pero puede mostrar el historial que le pide. En un aparato compartido, el servicio del agente filtra el historial y el contexto antes de entregarlos: ocultarlos en pantalla no basta. Domus controla quién entra en su interfaz, y el agente controla qué contenido de la conversación devuelve.

**Los adjuntos.** Una foto o un PDF adjuntos en el chat son del agente. Pueden pasar por la puerta, pero Domus no los guarda. Guardar algo en Domus es una acción del agente, con sus dos pasos (ADR 0032).

**La voz es del agente.** La activación fuera de Domus, la voz a texto, el texto a voz, el reconocimiento de quién habla, las huellas y los satélites son del agente, y `voice-gateway` se va con Kira. En la página de Domus no se ejecuta código del agente, porque podría leer todo lo que ve la sesión. El detector de la palabra de activación es de Domus, y el agente aporta solo su modelo, que tiene que ser compatible con el motor que use Domus. Con la escucha encendida, Domus procesa el micrófono en el aparato y solo envía audio al agente durante el turno activado; al acabar, deja de enviar y vuelve a escuchar en local. Apagar la escucha libera el micrófono. Necesita el permiso del navegador, y no se promete escuchar con la pantalla bloqueada sin haberlo probado en los aparatos de la casa.

**Quién habla.** Dentro de Domus, la persona es la sesión abierta. Reconocer una voz en una pantalla de Domus no cambia su cuenta (ADR 0032). Que el agente reconozca a quien habla no es una identidad que Domus acepte; en sus propios canales, el agente actúa con el enlace de la persona que él identifica, con la confianza que acepta el ADR 0031.

Fecha: 2026-11-15. Preguntas del grilling: Q7, Q9, Q11–Q13 y Q18 de la separación de Kira.
