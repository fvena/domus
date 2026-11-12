# Identidad de Kira y de los aparatos

Kira actúa como la cuenta con la que entró el aparato. En un aparato con la cuenta compartida `device`, si reconoce la voz de un miembro, actúa como ese miembro mientras dure la conversación; si no la reconoce, actúa como `device`. «Soy Paco» solo vale si la voz coincide. Las huellas de voz son datos personales y viven en Domus; `voice-gateway` guarda solo una copia para trabajar. Los aparatos se emparejan en Domus con un código y eligen con qué cuenta entran. No hay tipos de aparato: una pantalla de pared es un aparato que entra con la cuenta `device`.

Fecha: 2026-11-11. Preguntas del grilling: P4, P20, P21, P22b, P24, P26.
Precisado por el ADR 0023: aparato, sesión y cuenta van separados; quién habla, que acredita la voz, es distinto de quién ejecuta (`via`); y una voz no reconocida en la cuenta `device` no deja memoria ni conversación, aunque lo que ejecuta conserva su entrada en el registro.
