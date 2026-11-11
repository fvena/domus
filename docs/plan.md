# Plan por fases

Única fuente del plan de Domus: qué entra en cada fase, cuándo se da por terminada y en qué estado está. Se construye solo lo que pide la fase en curso, y cada funcionalidad entra después de su propia revisión en grilling ([ADR 0001](architecture/adr/0001-domus-con-kira-dentro.md)). Al terminar cada fase, lo que ya funciona se publica en la Pi. Cuando una fase cambia de estado, o su grilling fija qué incluye o cuándo termina, se corrige aquí. Las decisiones que la justifican están en [`architecture/README.md`](architecture/README.md) y en los ADR.

| Fase | Qué                            | Estado             |
| ---- | ------------------------------ | ------------------ |
| 0    | Esqueleto                      | hecha (2026-11-11) |
| 1    | Núcleo                         | en curso (1a)      |
| 2    | Sistema de diseño              | pendiente          |
| 3    | Personas, cuentas y aparatos   | pendiente          |
| 4    | Módulo piloto: listas y compra | pendiente          |
| 5    | Kira básica                    | pendiente          |
| 6    | Los demás módulos, uno a uno   | pendiente          |
| 7    | Memoria de Kira                | pendiente          |
| 8    | Especialistas                  | pendiente          |
| 9    | Iniciativa y domótica por voz  | pendiente          |

## 0. Esqueleto

**Estado:** hecha el 2026-11-11. La Pi corre `main` ([`despliegue.md`](despliegue.md)).

**Incluye:** las herramientas, las reglas de dependencias, la CI y Docker con los tres programas vacíos; la puerta en `platform/http` con `status` y los tres estados de conexión de `assistant` y `voice-gateway` ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)); las decisiones en `docs/architecture` y en los ADR; los `AGENTS.md`.

**Terminada cuando** las comprobaciones pasan y una app vacía corre en la Pi.

## 1. Núcleo

**Estado:** en curso. La 1a pasó su grilling el 2026-11-12 y se está construyendo.

**Terminada cuando** un módulo de prueba cubre todos los casos de permiso, confirmación y visibilidad. Cada subfase fija en su grilling cuándo termina ella. El tema `date-time` de `utils` (`date-fns` e `Intl`) entra en esta fase, con su primer uso.

- **1a. Base de datos y módulos.** Decidida en su grilling ([spec de la 1a](../.scratch/fase-1a/spec.md), [ADR 0021](architecture/adr/0021-datos-de-los-modulos-y-migraciones.md)). Incluye SQLite en un solo fichero con `better-sqlite3` en `platform`, y una `platform` en memoria en `test-utils` ([ADR 0002](architecture/adr/0002-vue-spa-sqlite-y-pwa.md)); la forma mínima de `module-sdk`, `defineModule` y tablas con prefijo sobre Drizzle ([ADR 0017](architecture/adr/0017-estructura-del-repositorio.md)); las migraciones, generadas con `drizzle-kit` y aplicadas al arrancar por un ejecutor propio en una sola transacción; el módulo de prueba `probe`; la lista de módulos de `api`, generada, guardada en git y comprobada; la puerta recibe `platform` y la lista, y `apps/api` las compone ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)); y el binario nativo de SQLite en la imagen de la Pi. No trae rutas HTTP nuevas: `status` sigue siendo la única RPC. **Terminada cuando** `probe` existe con su tabla y sus migraciones, entra en las pruebas y queda fuera de la lista de producción; las pruebas de `platform`, `test-utils` y `tooling` cubren las migraciones, el historial, los prefijos y la lista; la CI no deja cambios tras `pnpm db:generate` y `pnpm modules:generate`; pasan todas las comprobaciones y el build; y en la Pi la fila de `platform/0000` es la misma antes y después de reiniciar y de recrear `api`.
- **1b. Acciones.** Cada módulo declara sus acciones en sus `contracts/` (contratos primero, [ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)). Hasta la 1c las acciones no se montan en HTTP, y la llamada desde la web con `clientFor` queda aplazada hasta entonces; ninguna acción se ejecuta sin autorización, y su grilling decide cómo se cubre el hueco ([ADR 0021](architecture/adr/0021-datos-de-los-modulos-y-migraciones.md)). Su grilling decide si la acción es el único camino de cambio, el mismo para la web, Kira, lo compartido y las tareas programadas, con la confirmación y la auditoría de las dos identidades en un solo sitio.
- **1c. Identidad y autorización.** La identidad con Better Auth, con assurance y step-up ligado a la operación exacta ([ADR 0002](architecture/adr/0002-vue-spa-sqlite-y-pwa.md)), y la decisión única en `platform/authorization` ([ADR 0010](architecture/adr/0010-una-sola-decision-de-autorizacion.md)): permisos sí o no por área y nivel, expresados con Permix ([ADR 0007](architecture/adr/0007-perfiles-y-permisos-si-o-no.md)); la tabla de la IA ([ADR 0008](architecture/adr/0008-la-ia-como-filtro-de-delegacion.md)); privado o público ([ADR 0009](architecture/adr/0009-visibilidad-privado-o-publico.md)); y las confirmaciones pendientes. Su grilling decide si Permix queda como pieza interna de ese módulo. Las pantallas (iniciar sesión, ajustes, emparejar) son la fase 3.
- **1d. Segundo plano:** cola, tareas programadas ([ADR 0015](architecture/adr/0015-tareas-programadas-generales.md)), eventos en directo hacia la app, avisos al móvil y archivos; y las copias de seguridad, fuera de la Pi, con retención y una restauración probada.
- **1e. Llaves de API.** La de Kira y las de otras apps, con «de parte de». Entre sus criterios de aceptación: el mismo cliente funciona con llave y da error sin ella ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)).

## 2. Sistema de diseño

**Estado:** pendiente.

**Incluye:** el grilling del aspecto con Paco (colores, letra, tono y referencias); los componentes Vue, las plantillas de página, la estructura de la app (menú y ajustes), claro y oscuro, y la PWA.

**Terminada cuando** hay un catálogo de componentes y una página de ejemplo que Paco aprueba, y la estructura de la app, hecha con ellos, funciona en claro y en oscuro y se instala como PWA en el móvil.

## 3. Personas, cuentas y aparatos

**Estado:** pendiente.

**Incluye:** las pantallas y los flujos sobre lo que construye la 1c: el inicio de sesión, los perfiles y permisos ([ADR 0007](architecture/adr/0007-perfiles-y-permisos-si-o-no.md)), la tabla de la IA ([ADR 0008](architecture/adr/0008-la-ia-como-filtro-de-delegacion.md)) y el emparejamiento de aparatos ([ADR 0006](architecture/adr/0006-identidad-de-kira-y-aparatos.md)).

**Terminada cuando** Paco y Rocío entran desde el móvil cada uno con su cuenta, un aparato emparejado entra con la cuenta `device`, y los permisos y la tabla de la IA se cambian desde ajustes. Antes del uso real, las copias de seguridad de la 1d funcionan y hay una restauración probada.

## 4. Módulo piloto: listas y compra

**Estado:** pendiente.

**Incluye:** el ciclo completo de un módulo: revisión → pantallas → servidor y web → pruebas → Pi.

**Terminada cuando** listas y compra corre en la Pi y la casa lo usa. El ciclo queda como el camino de los módulos de la fase 6.

## 5. Kira básica

**Estado:** pendiente.

- **5a. Puerta de la conversación:** entra texto con adjuntos (fotos, PDF, correos) y quién habla; sale la respuesta por trozos, y se puede cortar a medias ([ADR 0004](architecture/adr/0004-una-sola-puerta.md), [ADR 0012](architecture/adr/0012-lo-compartido-llega-a-kira.md)). Chat en la app y Telegram. Antes de la primera operación que dependa de la api, el seguimiento de la conexión de `assistant` entrega el cliente, y sus llamadas fallan al momento si no está listo ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)). Su grilling decide si Kira pide los turnos a la api, para que `assistant` no acepte conexiones.
- **5b. Runtime** con dos motores (la suscripción de Claude y modelos por API), ventanilla única de tools, confirmaciones, skills, consumo por conversación y escenarios. Una sola configuración de IA en ajustes ([ADR 0011](architecture/adr/0011-una-configuracion-de-ia.md)).
- **5c. Voz:** satélites, STT/TTS, reconocer quién habla y huellas.

En esta fase se deciden la forma del agent, el vocabulario, los evals, los parámetros y el afinado de voz, y cómo llega la sesión de Claude al contenedor `assistant` sin montar datos ([ADR 0003](architecture/adr/0003-procesos-y-contenedores.md)).

**Terminada cuando** «añade leche» dicho desde la cocina reconoce a quien habla, pide confirmación y aparece en el móvil.

## 6. Los demás módulos, uno a uno

**Estado:** pendiente.

**Incluye:** calendario (con «compartir con Kira»), tareas de casa, cocina y menú, tablón, documentos, Home Assistant… El orden se decide al llegar.

**Terminada:** cada módulo, cuando completa el ciclo de la fase 4. La lista de módulos de la fase se fija al empezarla, y la fase termina cuando están todos.

## 7. Memoria de Kira

**Estado:** pendiente.

**Incluye:** la memoria en Domus, privada de cada persona o pública de la casa, por área, y su revisión nocturna como tarea programada ([ADR 0014](architecture/adr/0014-memoria-en-domus.md)).

**Terminada cuando** Kira guarda lo que aprende, responde a «¿qué sabes de mí?» y cumple «olvida…».

## 8. Especialistas

**Estado:** pendiente.

**Incluye:** el entrenador primero, con AimHarder; después la nutricionista y el coach.

**Terminada cuando** los tres funcionan. El entrenador, con los datos de AimHarder. Cada especialista se revisa en su propio grilling al llegar.

## 9. Iniciativa y domótica por voz

**Estado:** pendiente.

**Incluye:** la iniciativa de Kira con los avisos que aporta cada módulo ([ADR 0016](architecture/adr/0016-lo-que-un-modulo-aporta-a-kira.md)), con horas de silencio por persona, y la domótica por voz.

**Terminada cuando** Kira avisa por su cuenta con los avisos de los módulos, respeta las horas de silencio y la casa se maneja por voz.

## En paralelo, desde ya

Una prueba corta para ver si el reconocimiento de quién habla distingue a Paco de Rocío en la cocina. Es el mayor riesgo del proyecto (P55). **Estado:** en curso, esperando las grabaciones de Paco y Rocío.
