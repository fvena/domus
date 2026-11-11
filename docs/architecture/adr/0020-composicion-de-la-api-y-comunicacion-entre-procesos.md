# Composición de la API y comunicación entre procesos

Precisa los ADR 0005 y 0017 sin sustituirlos: dice dónde vive la puerta, cómo se declaran y se llaman las acciones, y cómo hablan con la api los demás programas. Cambia dos cosas: la frase del 0017 sobre `api-client`, y la regla de los ADR 0005 y 0017 de que `assistant` no importa `platform`, que pasa a ser «de `platform` solo importa sus contratos».

**La puerta es la parte `http` de `platform`.** `createHttpHandler()` devuelve un `fetch` que responde en `/health` y en `/api/rpc/**`; desde la fase 1a recibe también `platform` y la lista de módulos, generada en el build (el generador llega con el primer módulo). `apps/api` solo compone: monta la puerta, sirve la web compilada, arranca y para. Así la puerta se puede montar en proceso en las pruebas, que no pueden importar una app.

**Contratos primero.** Cada módulo declara sus acciones en `contracts/` con el contrato de oRPC, y su `server/` las implementa. Hay un solo tipo de contrato: toda acción declarada se puede llamar por HTTP y desde otros módulos, siempre pasando por la autorización. Qué acciones ve Kira lo decide su catálogo de tools (fase 5b), sin dividir los contratos. Si algún día hace falta una acción solo interna, quedará fuera del router HTTP, no solo marcada.

**Los contratos de la plataforma** (estado, conversación, catálogo de tools) viven en `@domus/platform/contracts`, un punto de entrada puro, sin Node y sin otras partes de `platform`. Es lo único de `platform` que pueden importar `web`, `assistant` y `voice-gateway`, y las reglas lo comprueban también por caminos indirectos.

**`api-client` no tiene contratos propios.** `clientFor(contrato, transporte)` es un adaptador fino del enlace RPC de oRPC: quien llama aporta el contrato y recibe un cliente con sus tipos. El transporte (`baseUrl`, `fetch`, `headers`, que puede ser una función) es obligatorio fuera del navegador. La autenticación y los reintentos son cosa de quien llama.

**`assistant` y `voice-gateway` hablan con Domus por un `fetch` inyectado**: HTTP en producción y la puerta en proceso en las pruebas (`test-utils`). El aislamiento de Kira lo da su contenedor (ADR 0005), y las reglas de dependencias lo refuerzan en el código.

**Solo RPC por ahora.** OpenAPI y las llaves de API son decisiones independientes que se toman cuando un cliente las necesite (fase 1e). Una integración que necesite recibir un webhook puede tener su propia ruta.

**Estado y versión del protocolo.** `status` devuelve `{ service: "domus", protocol }`. `protocol` sube con cualquier cambio que `assistant` y `voice-gateway` no puedan entender. Es público por excepción, porque no lleva datos personales; ninguna otra operación es pública por defecto. Al arrancar, cada programa pasa por tres estados (`@domus/utils/connection`, porque no sabe nada del negocio y lo usan los dos): conectando (reintenta con espera creciente hasta 30 s), listo, o incompatible (no ejecuta nada que dependa de la api y vuelve a comprobar cada 30 s). Una comprobación que no responde en 10 s cuenta como sin respuesta. El proceso sigue vivo y su `/health` no cambia. Hoy «actuar solo si está listo» depende de que quien llama compruebe el estado; cuando llegue la primera operación que dependa de la api (fase 5a), el watch entregará el cliente y sus llamadas fallarán al momento si no está listo, para que la regla viva en un solo módulo. Las pruebas de autenticación (mismo cliente: bien con llave, error sin ella) son criterio de aceptación de la fase 1e.

Fecha: 2026-11-11. Preguntas del grilling: P1–P18 de la revisión de arquitectura de la fase 0.
Precisado por el ADR 0021: la lista de módulos ya no se genera en el build; la escribe `pnpm modules:generate`, se guarda en git y se comprueba. `createHttpHandler({ platform, modules })` los recibe sin publicar nada nuevo, y hasta la 1c las acciones de los módulos no se montan en el router HTTP.
