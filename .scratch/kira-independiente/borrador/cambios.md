# Cambios en los demás documentos

Borrador. Todo se aplica en un solo commit junto con los ADR 0031, 0032 y 0033. Hasta la fase 5 lo construido sigue vigente, así que los ADR antiguos dicen «será sustituido en la fase 5» o «a partir de la fase 5», nunca «sustituido».

## Líneas al final de los ADR afectados

Cada «Precisado por» es la línea que pide `tooling/scripts/adr.test.ts` para cada ADR que nombra el «Precisa…» de los nuevos.

| ADR  | Línea que se añade                                                                                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | Será sustituido en la fase 5 por el ADR 0031: Domus y Kira pasan a ser productos independientes, y Domus admite un agente conectado opcional.                                                                                                                                                                                            |
| 0003 | Precisado por el ADR 0031: a partir de la fase 5, `assistant` y `voice-gateway` salen hacia Kira, y Domus queda con `api` y la web.                                                                                                                                                                                                      |
| 0004 | Precisado por el ADR 0033: a partir de la fase 5, la puerta no autentica canales externos ni reconoce el «sí»; la conversación con el agente es la conversación alojada.                                                                                                                                                                 |
| 0005 | Precisado por el ADR 0031: a partir de la fase 5, el aislamiento es entre productos; el agente solo llega a Domus por MCP con sus autorizaciones, y en la página de Domus no corre código suyo (ADR 0033).                                                                                                                               |
| 0006 | Precisado por el ADR 0033: a partir de la fase 5, los satélites, las huellas y el reconocimiento de quién habla son del agente; en una pantalla de Domus con la cuenta `device`, reconocer una voz no cambia la cuenta.                                                                                                                  |
| 0008 | Precisado por el ADR 0032: a partir de la fase 5, la tabla es la del agente conectado y nace denegada entera, y toda confirmación se hace en Domus.                                                                                                                                                                                      |
| 0011 | Será sustituido en la fase 5 por el ADR 0031: la configuración de IA es de Kira.                                                                                                                                                                                                                                                         |
| 0012 | Precisado por el ADR 0033: a partir de la fase 5, lo compartido llega al agente por sus canales o como adjunto de la conversación alojada, y lo que propone para Domus se confirma en Domus.                                                                                                                                             |
| 0014 | Será sustituido en la fase 5 por el ADR 0031: la memoria es de Kira.                                                                                                                                                                                                                                                                     |
| 0015 | Precisado por el ADR 0031: la revisión nocturna de la memoria se va con la memoria hacia Kira.                                                                                                                                                                                                                                           |
| 0016 | Precisado por el ADR 0031: a partir de la fase 5, el material de `assistant/` se sirve por la interfaz pública a cualquier agente; los avisos para la iniciativa son material que el agente consulta, y Domus no los envía.                                                                                                              |
| 0017 | Precisado por el ADR 0031: a partir de la fase 5, `apps/assistant` y `apps/voice-gateway` salen del repositorio, y sus reglas de dependencias con ellos.                                                                                                                                                                                 |
| 0018 | Precisado por el ADR 0031: los patrones del agent (skills como carpetas, el formato de cada canal, los escenarios con modelo falso, el prompt estable entre turnos) pasan a Kira; en Domus quedan los `AGENTS.md` y la escalera.                                                                                                         |
| 0020 | Precisado por el ADR 0031: a partir de la fase 5, la comprobación de versión al conectar pasa a ser la de la interfaz pública, y salen los clientes de `assistant` y `voice-gateway`.                                                                                                                                                    |
| 0022 | Precisado por el ADR 0032: las tools MCP recorren el mismo camino que cualquier acción, y una lectura confirmada vía el agente se aprueba y se ejecuta después.                                                                                                                                                                          |
| 0023 | Precisado por el ADR 0032: a partir de la fase 5, la delegación nace denegada entera, el agente se autoriza con su enlace y el mandato de la conversación alojada, la lectura confirmada vía el agente se aprueba, el canal `contexto` desaparece, y la regla de la salud en un aparato `device` da paso a la de la salud vía el agente. |
| 0026 | Precisado por el ADR 0032: a partir de la fase 5, restaurar revoca también los enlaces, los mandatos y el secreto del cliente del agente.                                                                                                                                                                                                |
| 0028 | Precisado por el ADR 0032: a partir de la fase 5, el agente guarda archivos en Domus con los dos pasos de siempre, y una descarga confirmada se aprueba como una lectura. Precisado por el ADR 0033: los adjuntos de la conversación alojada son del agente.                                                                             |
| 0030 | Precisado por el ADR 0032: en la fase 5, la llave y los mandatos se sustituyen por el perfil OAuth de MCP; el mandato sigue como autorización de la conversación alojada.                                                                                                                                                                |

No cambian: 0002, 0007, 0009, 0010, 0013, 0019, 0021, 0024, 0025, 0027 y 0029.

## `docs/architecture/README.md`

- Índice: filas 0031 «Domus con un agente opcional», 0032 «Autorización del agente» y 0033 «Conversación alojada y voz».
- Arriba, una nota: lo que describe es lo vigente; a partir de la fase 5 rigen los ADR 0031–0033.
- Secciones 1–4: en cada viñeta afectada (un solo producto, procesos, puerta, Kira aislada, identidad, IA como filtro, una configuración de IA, lo compartido, memoria, lo que un módulo aporta) se añade a qué pasa en la fase 5, con su enlace.
- Sección 7, «Abierto»: «Se deciden en la fase 5: la forma del agent…» se va al plan de Kira.

## `docs/plan.md`

Tabla: la fase 5 pasa a ser «Domus con un agente opcional»; las fases 7, 8 y 9 se quitan de la tabla y su contenido pasa a la sección nueva «Trasladado al plan de Kira».

Fase 3: «la tabla de la IA» pasa a ser «la delegación al agente conectado».

Fase 6: «calendario (con "compartir con Kira")» pasa a ser «calendario (con "compartir con el agente": poner información a su disposición con autorización, sin cambiar la visibilidad del registro para otras personas)».

Fase 5, nueva:

> ## 5. Domus con un agente opcional
>
> **Estado:** pendiente.
>
> **Incluye:** lo que necesita Domus para tener un agente conectado opcional, Kira u otro ([ADR 0031](architecture/adr/0031-domus-con-un-agente-opcional.md)). El servidor MCP en la puerta, con las tools generadas de los contratos, el material de los módulos y la versión de la interfaz. El perfil OAuth de MCP: el alta del cliente, el consentimiento, el enlace del agente y su revocación, el mandato de la conversación alojada, la vigencia en cada petición y la rotación del token de renovación; la delegación que nace cerrada con su preajuste; la confirmación siempre en Domus y la lectura aprobada ([ADR 0032](architecture/adr/0032-autorizacion-del-agente.md)). La conversación alojada por chat y por voz, con su botón, su escucha con palabra de activación y el historial que se pide al agente, tras un prototipo que fija AG-UI 1.0 o un contrato propio ([ADR 0033](architecture/adr/0033-conversacion-alojada-y-voz.md)). Los ajustes para conectar, sustituir y desconectar el agente. Retirar `apps/assistant`, `voice-gateway`, la llave y los mandatos cuando lo nuevo está comprobado. No incluye nada interno de Kira: su runtime, su memoria, su voz y sus especialistas van en su propio plan.
>
> **Terminada cuando** Domus funciona sin agente y sus pruebas no necesitan a Kira; con datos sintéticos, Kira y después un segundo agente de prueba, configurados uno tras otro, atienden el chat sin tocar el núcleo, con los mismos límites por persona y la auditoría correcta; sustituir el agente invalida al anterior y deja la delegación cerrada; una confirmación vía el agente solo cuenta hecha en Domus; y revocar un enlace corta la siguiente petición.

Sección nueva, al final, «Trasladado al plan de Kira». Recoge los requisitos para no perderlos mientras no exista su repositorio, y se borra cuando su plan los tenga:

- De la antigua fase 5: la forma del agent, el vocabulario, los evals, los parámetros, las trazas, el clasificador local y los modelos locales; el runtime con dos motores, la ventanilla única de tools, el consumo por turno y los escenarios; cambiar de motor conserva la personalidad y los recuerdos; sin internet, lo local sigue y lo demás falla de forma controlada; lo que tarda más de unos 15 s va en segundo plano y avisa; las reglas de las muletillas; Telegram; la voz (satélites, STT/TTS, quién habla, huellas, «¿Paco o Rocío?», el afinado); el criterio «añade leche» desde la cocina, ahora con la confirmación en Domus, y los objetivos de latencia.
- Lo privado en lo compartido: el servicio de Kira impide incorporar información privada a respuestas destinadas a altavoces o conversaciones compartidas, con controles de contexto y de salida ajenos al modelo. La política cubre también el historial, los recuerdos y los datos de otras integraciones (ADR 0032, «La salud vía el agente»).
- La antigua fase 7, memoria: privada o pública por área, la revisión nocturna, el recuerdo deducido como hipótesis, que lo privado de una persona no llegue a la otra, el contexto con tope, «¿qué sabes de mí?» y «olvida…».
- La antigua fase 8, especialistas, completa, con AimHarder como integración de Kira salvo que su grilling diga otra cosa.
- La antigua fase 9, iniciativa y domótica por voz: horas de silencio, límite diario, lo privado al móvil de su persona y lo de la casa a la cocina, cada persona ajusta o apaga la suya. El camino hasta Home Assistant lo decide Kira; si va directo, esas operaciones tienen los controles y el registro de Home Assistant y de Kira, no los de Domus.
- De «Después de la fase 9»: la voz desde el móvil fuera de casa, el audio directo (voz a voz) y la música. Vehículos, mascotas y finanzas (solo lectura) siguen en Domus, como «Después de la fase 6».
- «En paralelo»: la prueba de reconocimiento de quién habla en la cocina pasa a Kira; sigue siendo el mayor riesgo de la voz.

## `GLOSSARY.md`

Mejora del modelo respecto a Q25: no hace falta un término «token de conversación». El **mandato** del glosario ya es exactamente eso, lo que la puerta da al agente a partir de una interacción que ella autenticó, que muere con su origen. Se conserva, y «token de conversación» se añade a su _Evitar_.

Términos nuevos:

- **Agente conectado** (`agent`): la app conectada que conversa con las personas y actúa en su nombre, Kira u otro. Domus admite uno para toda la casa, opcional. _Evitar_: asistente (para esto), bot, IA.
- **Enlace del agente** (`agent link`): la autorización que una persona da al agente conectado para que actúe en su nombre fuera de Domus, hasta que se revoca. No da permisos: lo que pide sigue pasando por la autorización y la delegación vigentes. _Evitar_: conexión, token, cuenta de Kira.
- **Conversación alojada** (`hosted conversation`): la conversación con el agente conectado dentro de la interfaz de Domus, por chat o por voz. El agente la guarda; Domus la muestra. _Evitar_: chat de Domus, sesión de Kira.

Se retocan: la introducción («con Kira dentro» pasa a «con un agente opcional»), **Vía Kira** (a partir de la fase 5, «vía el agente», con el mismo nombre en el código) y **Llave** (dice que vale hasta la fase 5).

## Lo que no se toca ahora

`AGENTS.md`, `docs/guia/` y `despliegue.md` describen lo que existe, y lo que existe no cambia hasta la fase 5. Se corrigen al cerrarla.
