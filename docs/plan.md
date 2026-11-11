# Plan por fases

Única fuente del plan de Domus: qué entra en cada fase, cuándo se da por terminada y en qué estado está. Se construye solo lo que pide la fase en curso, y cada funcionalidad entra después de su propia revisión en grilling ([ADR 0001](architecture/adr/0001-domus-con-kira-dentro.md)). Cuando una fase cambia de estado, o su grilling fija qué incluye o cuándo termina, se corrige aquí. Las decisiones que la justifican están en [`architecture/README.md`](architecture/README.md) y en los ADR.

| Fase | Qué                            | Estado                  |
| ---- | ------------------------------ | ----------------------- |
| 0    | Esqueleto                      | hecha (2026-11-11)      |
| 1    | Núcleo                         | pendiente; la siguiente |
| 2    | Sistema de diseño              | pendiente               |
| 3    | Personas, cuentas y aparatos   | pendiente               |
| 4    | Módulo piloto: listas y compra | pendiente               |
| 5    | Kira básica                    | pendiente               |
| 6    | Los demás módulos, uno a uno   | pendiente               |
| 7    | Memoria de Kira                | pendiente               |
| 8    | Especialistas                  | pendiente               |
| 9    | Iniciativa y domótica por voz  | pendiente               |

## 0. Esqueleto

**Estado:** hecha el 2026-11-11. La Pi corre `main` ([`despliegue.md`](despliegue.md)) y el despliegue anterior está borrado.

**Incluye:** las herramientas, las reglas de dependencias, la CI y Docker con los tres programas vacíos; las decisiones en `docs/architecture` y en los ADR; los `AGENTS.md`.

**Terminada cuando** las comprobaciones pasan y una app vacía corre en la Pi.

## 1. Núcleo

**Estado:** pendiente; es la siguiente, y empieza por la 1a.

**Terminada cuando** un módulo de prueba cubre todos los casos de permiso, confirmación y visibilidad. Cada subfase fija en su grilling cuándo termina ella.

- **1a. Base de datos y módulos.** La forma de `module-sdk` ([ADR 0017](architecture/adr/0017-estructura-del-repositorio.md)); el generador del registro de módulos, que llega con el primer módulo; la puerta recibe `platform` y la lista de módulos ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)).
- **1b. Acciones.**
- **1c. Identidad y autorización** ([ADR 0010](architecture/adr/0010-una-sola-decision-de-autorizacion.md)).
- **1d. Segundo plano:** cola, tareas programadas ([ADR 0015](architecture/adr/0015-tareas-programadas-generales.md)), eventos en directo, avisos y archivos.
- **1e. Llaves de API.** Entre sus criterios de aceptación: el mismo cliente funciona con llave y da error sin ella ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)).

## 2. Sistema de diseño

**Estado:** pendiente.

**Incluye:** el grilling del aspecto; los componentes Vue, las plantillas, la estructura de la app, claro y oscuro, y la PWA.

**Terminada cuando** la estructura de la app, hecha con esos componentes y plantillas, funciona en claro y en oscuro y se instala como PWA en el móvil.

## 3. Personas, cuentas y aparatos

**Estado:** pendiente.

**Incluye:** el inicio de sesión, los perfiles y permisos ([ADR 0007](architecture/adr/0007-perfiles-y-permisos-si-o-no.md)), la tabla de la IA ([ADR 0008](architecture/adr/0008-la-ia-como-filtro-de-delegacion.md)) y el emparejamiento de aparatos ([ADR 0006](architecture/adr/0006-identidad-de-kira-y-aparatos.md)).

**Terminada cuando** Paco y Rocío entran cada uno con su cuenta, un aparato emparejado entra con la cuenta `device`, y los permisos y la tabla de la IA se cambian desde ajustes.

## 4. Módulo piloto: listas y compra

**Estado:** pendiente.

**Incluye:** el ciclo completo de un módulo: revisión → pantallas → servidor y web → pruebas → Pi.

**Terminada cuando** listas y compra corre en la Pi y la casa lo usa. El ciclo queda como el camino de los módulos de la fase 6.

## 5. Kira básica

**Estado:** pendiente.

- **5a. Puerta de la conversación:** chat en la app y Telegram.
- **5b. Runtime** con dos motores, ventanilla única de tools, confirmaciones, skills, consumo por conversación y escenarios.
- **5c. Voz:** satélites, STT/TTS, reconocer quién habla y huellas.

En esta fase se deciden la forma del agent, el vocabulario, los evals, los parámetros y el afinado de voz, y cómo llega la sesión de Claude al contenedor `assistant` sin montar datos ([ADR 0003](architecture/adr/0003-procesos-y-contenedores.md)).

**Terminada cuando** «añade leche» dicho desde la cocina reconoce a quien habla, pide confirmación y aparece en el móvil.

## 6. Los demás módulos, uno a uno

**Estado:** pendiente.

**Incluye:** calendario (con «compartir con Kira»), tareas de casa, cocina y menú, tablón, documentos, Home Assistant… El orden se decide al llegar.

**Terminada:** cada módulo, cuando completa el ciclo de la fase 4. La fase sigue abierta mientras quede un área de la casa por cubrir.

## 7. Memoria de Kira

**Estado:** pendiente.

**Incluye:** la memoria en Domus, privada de cada persona o pública de la casa, por área, y su revisión nocturna como tarea programada ([ADR 0014](architecture/adr/0014-memoria-en-domus.md)).

**Terminada cuando** Kira guarda lo que aprende, responde a «¿qué sabes de mí?» y cumple «olvida…».

## 8. Especialistas

**Estado:** pendiente.

**Incluye:** el entrenador primero, con AimHarder.

**Terminada cuando** el entrenador funciona con los datos de AimHarder. Los demás especialistas se deciden al llegar.

## 9. Iniciativa y domótica por voz

**Estado:** pendiente.

**Incluye:** los avisos que aporta cada módulo para la iniciativa de Kira ([ADR 0016](architecture/adr/0016-lo-que-un-modulo-aporta-a-kira.md)) y la domótica por voz.

**Terminada cuando** Kira avisa por su cuenta con los avisos de los módulos y la casa se maneja por voz.

## En paralelo, desde ya

Una prueba corta para ver si el reconocimiento de quién habla distingue a Paco de Rocío en la cocina. Es el mayor riesgo del proyecto (P55). **Estado:** pendiente.
