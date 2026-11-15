# Kira independiente y opcional: investigación

Fecha: 2026-11-15. Investigación para preparar el grilling; no cambia el plan, los ADR ni el código. Fuentes oficiales consultadas ese día. «Hecho» describe la documentación; «inferencia» y «propuesta» son conclusiones para Domus, todavía sin decidir.

## Conclusión

**Propuesta:** Domus puede conservar chat y voz dentro de su interfaz y conectar un agente independiente, opcional y sustituible. Hay dos contratos distintos: Domus envía una conversación al agente; el agente llama a acciones de Domus mediante MCP en nombre de una persona. Dar de alta uno no concede acceso al otro. MCP por sí solo no hace que un agente pueda atender el chat de Domus.

Para la primera conexión, elegir **un** contrato de conversación: un HTTP con eventos pequeño si solo se construyen Domus y Kira; AG-UI si el primer agente que se vaya a sustituir ya lo ofrece o su cliente ahorra trabajo comprobable. A2A no parece necesario mientras Domus no delegue tareas a agentes de terceros con ese protocolo. Esta es una recomendación por alcance, no una medición de rendimiento ni una evaluación de seguridad de implementaciones.

## Punto de partida local

El plan mantiene en curso el núcleo y deja Kira para la fase 5. La arquitectura actual ya separa `assistant` de `api`, pero exige el mismo producto y repositorio, y fija tres programas. La conversación, el catálogo de tools y la emisión de mandatos todavía tienen decisiones pendientes en la fase 5. Esta investigación no autoriza adelantarlas. Fuentes locales: [plan](../../docs/plan.md), [arquitectura](../../docs/architecture/README.md), [ADR 0001](../../docs/architecture/adr/0001-domus-con-kira-dentro.md), [ADR 0020](../../docs/architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md).

El [ADR 0030](../../docs/architecture/adr/0030-llaves-y-mandatos.md) distingue llave de la app, atribución de identidad por la puerta, mandato y autorización. Solo Kira recibe mandatos por ahora; añadir una segunda app debe decidir expresamente si la tabla de delegación pasa a ser por app. El catálogo MCP y su autenticación deben encajar con esto o justificar el cambio mediante ADR; no se puede reemplazar el mandato por un `accountId` que declare el agente.

## Qué resuelve cada protocolo

| Frontera                     | Hecho verificado                                                                                                         | Consecuencia para Domus — inferencia                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicación ↔ agente: AG-UI   | Define eventos de conversación, ejecución, tools y estado para aplicaciones con agentes; no exige un framework concreto. | Candidato para conectar el chat a distintos agentes con un adaptador. No obliga a cambiar Vue ni a adoptar una interfaz de chat ajena. |
| Agente ↔ agente: A2A         | Normaliza mensajes, tareas, artefactos, capacidades y descubrimiento del agente remoto.                                  | Tiene sentido cuando exista un agente externo compatible que lo requiera. Que Kira esté en otro proceso no obliga a usarlo.            |
| Agente ↔ acciones/datos: MCP | Publica tools con esquemas y permite descubrirlas y llamarlas.                                                           | Es una fachada de las acciones de Domus; no sustituye al contrato de conversación ni a sus permisos.                                   |

Fuentes: [visión de AG-UI y fronteras](https://docs.ag-ui.com/introduction), [especificación A2A](https://a2a-protocol.org/v1.0.0/specification/), [tools MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/tools). No se deduce que haya que implementar los tres.

### AG-UI

**Hechos:** el cliente HTTP acepta un `POST` con `RunAgentInput` y recibe eventos; admite SSE y un transporte binario. La arquitectura también contempla una puerta que actúa como proxy. El cliente TypeScript y la interfaz de eventos permiten construir un adaptador independiente de la presentación. Fuente: [arquitectura de AG-UI](https://docs.ag-ui.com/concepts/architecture).

AG-UI dispone ya de una versión 1.0 con esquema normativo y reglas de comportamiento; su guía describe compatibilidad y migración desde 0.x. Hay publicaciones recientes de paquetes, pero sus versiones no son todas iguales. Por tanto, no debe describirse todo AG-UI como experimental ni darse por garantizada la estabilidad de cualquier integración. Fuentes: [migración a 1.0](https://docs.ag-ui.com/migrating-to-1-0), [publicaciones oficiales](https://github.com/ag-ui-protocol/ag-ui/releases).

El catálogo distingue eventos vigentes, obsoletos y propuestas. Las interrupciones permiten terminar una ejecución esperando entrada y reanudar con otra. Fuentes: [eventos](https://docs.ag-ui.com/concepts/events), [interrupciones](https://docs.ag-ui.com/concepts/interrupts). La página general de arquitectura conserva una cifra antigua de eventos: no usar ese número como contrato.

**Inferencia:** encaja mejor que A2A en la frontera del chat. Aun así, Domus debe definir qué mensajes, archivos y eventos admite; qué guarda; cómo cancela y recupera una conversación; y qué significa una tarjeta. Adoptar AG-UI no resuelve reconocimiento de voz, transporte de audio de baja latencia, historial durable ni autorización de acciones. Una interrupción de AG-UI puede mostrar una confirmación pendiente de Domus, pero su respuesta no reemplaza la confirmación que comprueba la puerta.

### A2A

**Hechos:** la especificación publicada es 1.0.0. Incluye Agent Card, capacidades, operaciones para enviar mensajes, consultar y cancelar tareas, suscribirse a su evolución y mecanismos de seguridad; ofrece bindings HTTP/JSON, JSON-RPC y gRPC. El streaming es una capacidad que se declara, no una garantía de todo agente A2A. Fuente: [especificación A2A 1.0.0](https://a2a-protocol.org/v1.0.0/specification/).

**Inferencia:** es una alternativa real si el producto necesita consumir agentes A2A ya existentes, trabajos independientes o descubrimiento entre proveedores. Para dos componentes propios añade un modelo de tareas y su ciclo de vida que quizá no aporte valor inicial. No ofrece automáticamente las pantallas, la voz ni la atribución a una cuenta de Domus. No se propone una pila AG-UI → A2A → MCP por anticipado.

### Un contrato HTTP con eventos pequeño

**Hecho:** Hono ofrece respuestas en flujo, SSE y aviso de cancelación. Fuente: [streaming de Hono](https://hono.dev/docs/helpers/streaming).

**Propuesta, sin implementar:** una frontera versionada entre la puerta y el agente con operaciones para crear/enviar un turno, observar eventos y cancelar. Identificadores opacos de conversación y turno; entrada de texto y referencias a archivos autorizadas; eventos de texto, estado, tarjeta tipada, confirmación pendiente, error y fin. No transportar la sesión de la persona como credencial del agente ni aceptar identidades declaradas por este.

El trabajo de un turno sigue fuera de la petición, como exige el ADR 0004: el flujo observa una ejecución, no mantiene viva su lógica. Debe fijarse qué ocurre tras desconexión o reinicio, cómo se evita repetir una escritura y si reabrir el chat recupera estado o empieza una nueva conversación. SSE no aporta esas garantías por sí solo. Cancelar el flujo tampoco demuestra que una acción ya confirmada se haya deshecho.

**Inferencia:** es la opción de menor superficie para un solo agente propio; la familia asume mantener su contrato y escribir adaptadores cuando cambie de agente. La independencia depende de una frontera documentada y comprobada, no de inventar un formato. Si aparece un segundo agente con AG-UI nativo, conviene comparar el coste de adaptar el pequeño contrato con usar AG-UI directamente.

## MCP y autorización por persona

**Hechos:** MCP separa descubrimiento (`tools/list`) de ejecución (`tools/call`). El catálogo puede variar según la autorización presentada; las anotaciones descriptivas de las tools no son una política de permisos. Puede devolver resultados estructurados. Fuente: [tools MCP](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

La revisión MCP 2026-07-28 cambió Streamable HTTP: un `POST` por mensaje, respuesta JSON o SSE de esa petición y desaparición de sesiones de protocolo y del antiguo flujo `GET`. Hay compatibilidad con revisiones previas que comprobar en cada SDK y agente elegido. Fuente: [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http). Esta es una revisión del protocolo, distinta de las sesiones de personas que conserva Domus.

La autorización HTTP de MCP es opcional en el protocolo; cuando se ofrece, recomienda seguir su perfil basado en OAuth. Ese perfil exige validar credenciales destinadas al recurso MCP y proporciona descubrimiento del servidor de autorización. Fuente: [autorización MCP](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). Aceptar y reenviar sin validar credenciales emitidas para otro recurso está expresamente prohibido por ese perfil. Fuente: [seguridad MCP](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices).

**Propuesta para el grilling:** montar la fachada MCP en la puerta de Domus para que una tool entre en el mismo recorrido de validación, autorización, transacción y registro que las demás llamadas. No dar a un servidor lateral acceso directo a SQLite ni una credencial administrativa compartida.

Conservar dos identidades: la persona representada y la app autenticada que la representa. Cada ejecución vuelve a comprobar la sesión/origen, la tabla de delegación y la visibilidad. El catálogo puede ocultar lo no permitido, pero la llamada debe comprobarlo siempre. Cambiar el nombre visible de Kira no debe hacer que otra app aparezca en auditoría como Kira. No incluir mandatos ni secretos en mensajes del modelo o eventos de interfaz.

Las confirmaciones siguen siendo pendientes de una operación exacta bajo `platform/authorization`. El agente puede mostrarlas y recibir su resultado; no confirmar sus propias acciones. Las credenciales de MCP deben expirar o revocarse conforme a la sesión y la app acordadas; conectar un asistente no da acceso a datos de las dos personas.

Que el chat esté dentro de Domus no convierte una acción del agente en una petición directa de la persona. Si una tool de frontend ejecuta con la cookie de la web y omite `via` y el mandato, eludiría la tabla de delegación de la IA. Mantener esa atribución en cualquier adaptador y no entregar la cookie de sesión al agente ni al modelo.

**Límite de compatibilidad:** una fachada MCP con llave y mandato propios puede funcionar con clientes que acepten ese transporte y esas cabeceras, pero no equivale a implementar el perfil OAuth interoperable. El grilling debe escoger entre cliente controlado con adaptación de credenciales y compatibilidad con clientes MCP externos mediante ese perfil. No presentar «cualquier agente MCP» como promesa: necesita además un contrato de conversación compatible y soportar la autenticación elegida. Evitar un proxy que reenvíe credenciales ajenas sin validarlas; es diferente de validar credenciales propias dentro de la misma puerta.

## Chat y voz dentro de Domus

**Hechos:** Home Assistant documenta un botón que abre el asistente configurado con escucha o texto, y su pipeline separa activación, STT, agente de conversación y TTS. Fuentes: [botón Assist](https://www.home-assistant.io/voice_control/start_assist_from_dashboard/), [pipeline Assist](https://contributors.home-assistant.io/core/internals/assist-pipelines/). Es precedente de separación de responsabilidades, no una prueba de que sus contratos encajen directamente con Domus.

Home Assistant distingue asimismo ofrecer sus propias herramientas a agentes externos de consumir herramientas MCP externas desde su agente. Fuentes: [servidor MCP](https://www.home-assistant.io/integrations/mcp_server/), [cliente MCP](https://www.home-assistant.io/integrations/mcp/). Son dos direcciones independientes; no se propone copiar su política de permisos.

El navegador exige contexto seguro y permiso para capturar el micrófono. Chrome documenta que una página puede congelarse o descartarse. Fuentes: [captura del micrófono](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [ciclo de vida de páginas](https://developer.chrome.com/docs/web-platform/page-lifecycle-api). Esto no demuestra que toda captura activa se suspenda ni describe todos los sistemas operativos.

**Inferencia:** un botón para hablar y texto son el punto de entrada más verificable. «Kira» como activación requiere probar un detector con esa palabra y los aparatos reales; cambiar el nombre del agente no crea el detector. Reconocer la palabra tampoco identifica quién habla. No prometer escucha permanente con pantalla bloqueada en cualquier PWA sin ensayar navegador y sistema; un satélite o app nativa se evalúan si ese requisito es necesario. La voz puede seguir conectada al producto aunque el agente que razona cambie.

## Añadido tras contrastar las dos revisiones

Comprobado el 2026-11-15 contra la documentación de MCP 2026-07-28, Better Auth y AG-UI.

### La vida del token del agente

**Hechos:** el [ADR 0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md) exige que lo que nace de una sesión muera con ella en la siguiente petición, y el [ADR 0030](../../docs/architecture/adr/0030-llaves-y-mandatos.md) guarda el mandato en la base y no como token firmado precisamente por eso. En MCP el cliente debe enviar siempre el parámetro `resource` ([autorización MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization)), y el OAuth Provider de Better Auth emite el token de acceso como JWT cuando la petición nombra un recurso y está el plugin JWT, que el plugin MCP exige. El proveedor ofrece introspección (RFC 7662) y revocación (RFC 7009); su página no dice si cerrar la sesión de la persona invalida los tokens ya emitidos. Fuentes: [OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider), [plugin MCP](https://better-auth.com/docs/plugins/mcp).

**Inferencia:** un JWT comprobado solo por su firma sigue valiendo hasta caducar, aunque la sesión, la contraseña o el aparato de origen ya no valgan. Para conservar la regla del ADR 0023 hay dos caminos: comprobar en la base cada llamada (barato, porque el servidor MCP vive en el mismo proceso que la puerta) o tokens tan cortos que el intervalo sea aceptable, lo que cambia la regla y necesita ADR.

**Pregunta:** qué invalida el enlace persistente de una persona con un agente (cambio de contraseña, revocar un aparato, retirar la delegación, restaurar una copia) y con qué rapidez.

### El registro de clientes

**Hechos:** MCP admite tres vías por orden de preferencia: cliente dado de alta de antemano, CIMD y registro dinámico, este último obsoleto en 2026-07-28. Con CIMD el servidor de autorización descarga el documento del cliente desde su URL, y la especificación advierte del riesgo de SSRF. Better Auth permite dar de alta clientes con su API de administración y deja el registro dinámico apagado por defecto.

**Propuesta:** para una sola casa, dar de alta de antemano encaja con la lista fija de apps conectadas del ADR 0030, por ejemplo con el comando `keys` o uno hermano. CIMD se abre solo si se decide admitir clientes que la familia no controla; no hace falta para «cualquier agente» que se configure a mano.

### La autorización de la conversación alojada en Domus

**Propuesta, candidata:** cuando la conversación empieza en Domus, Domus, como servidor de autorización, emite al agente un token corto para la terna agente, persona y conversación, y lo entrega con el turno. Muere con la sesión de origen, como el mandato actual: es el mandato con forma OAuth. La alternativa es que el agente use su enlace persistente también dentro de Domus, y entonces el agente decide a qué persona corresponde cada turno. Esto desarrolla la pregunta 5.

### De quién es la voz

**Inferencia:** el patrón de Home Assistant separa la voz del agente, de modo que cambiar de agente conserva los aparatos. Que Kira tenga voz propia fuera de Domus tira en sentido contrario. Hay tres sitios posibles para la voz (activación, STT, TTS y quién habla): Domus, Kira o una pieza propia que hable con ambos. La elección decide adónde va `voice-gateway` y quién acredita la voz ante Domus en la cuenta `device`.

### La iniciativa

**Hueco:** ninguna de las dos revisiones cubre la iniciativa de la fase 9. Si el agente quiere avisar por su cuenta, puede usar los avisos de Domus ([ADR 0029](../../docs/architecture/adr/0029-eventos-en-directo-y-avisos.md)), sus propios canales o ambos, y en cada caso cambia quién decide las horas de silencio y el límite diario y con qué credencial actúa el agente sin conversación abierta. Enlaza con la pregunta 5.

### Dos matices

- La opción «cliente controlado con llave y mandato» de la pregunta 6 choca con que el agente pueda ser cualquiera. El grilling puede cerrarla pronto a favor del perfil OAuth.
- AG-UI 1.0 tiene especificación normativa, versión declarada en `RUN_STARTED` y partes de imagen, audio, vídeo y documento ([migración a 1.0](https://docs.ag-ui.com/migrating-to-1-0)). Eso le da peso frente al contrato propio pequeño; la comparación sigue en pie, pero no parten igual.

## Invariantes y preguntas para el grilling

**Propuestas de invariantes:** Domus funciona sin agente; el chat informa de desconectado sin romper las demás pantallas. Conectar el agente para conversar y autorizar su acceso a acciones son decisiones separadas, revocables por separado. La cuenta, app, conversación y contexto se conservan por turno sin mezclar personas. Un cambio de agente no amplía permisos. Solo una implementación compatible o un adaptador satisface el contrato elegido.

1. ¿Independiente significa otro proceso, despliegue, repositorio o producto con vida propia? ¿Debe Kira servir también a otros productos?
2. ¿El segundo agente concreto ya ofrece AG-UI, A2A o solo MCP? ¿Qué sustitución real probará la independencia?
3. ¿Quién conserva conversaciones, archivos y memoria: Domus, el agente o ambos? ¿Qué migra al sustituirlo y qué se borra?
4. ¿Hay un agente configurado para la casa, uno por persona o selección por conversación? ¿La tabla de delegación debe distinguir cada app?
5. ¿Puede un agente externo leer datos solo durante un turno autenticado o también iniciar trabajo después? El segundo caso necesita un origen y vigencia propios.
6. ¿Se necesita compatibilidad OAuth con clientes MCP de terceros desde el principio, o basta un cliente controlado que adapte llave y mandato?
7. ¿La voz responde después de transcribir o se exige audio en tiempo real con interrupciones? ¿Dónde ocurren STT/TTS y qué audio sale de casa?
8. ¿Activación en la pantalla abierta basta o debe funcionar con pantalla apagada? ¿Qué aparatos y navegadores son el criterio de aceptación?
9. ¿Qué pasa con un turno, pendiente o trabajo en curso al desconectar el agente, revocar acceso o cambiar de cuenta?
10. ¿Qué prueba demuestra que Kira y un segundo agente, con datos sintéticos, reciben los mismos límites por persona y la auditoría correcta?
11. ¿Cada llamada MCP consulta la base para saber si su origen sigue vivo, o se aceptan tokens cortos con un intervalo? ¿Qué invalida el enlace de una persona?
12. ¿Los clientes se dan de alta de antemano, o se admite CIMD para clientes que la familia no controla?
13. ¿En la conversación alojada, el agente recibe un token por conversación o usa su enlace persistente?
14. ¿La voz vive en Domus, en Kira o en una pieza propia?
15. ¿Por dónde avisa el agente cuando actúa por iniciativa propia, y con qué credencial?

No se han medido memoria, latencia ni carga en la Raspberry Pi ni comprobado un adaptador Vue concreto. No se ha ensayado un segundo agente ni afirmado que un SDK dado soporte toda la revisión actual. Esas comprobaciones deben preceder a fijar dependencias y compromisos de producto.
