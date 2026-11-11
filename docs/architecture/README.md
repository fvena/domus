# Arquitectura de Domus

Domus es el organizador privado de una casa de dos adultos en España, alojado en una Raspberry Pi 5, con Kira (el asistente de voz y texto) dentro del mismo producto. Este documento recoge las decisiones de arquitectura tomadas en grilling el 2026-11-11 (preguntas P1–P55). Cada decisión importante tiene su ADR en [`adr/`](adr/); si este documento y un ADR no coinciden, manda el ADR más reciente, y se corrigen los dos en el mismo commit.

Idioma: documentos, conversación y el texto que ve la familia en español; código, identificadores, commits y los mensajes de log para quien opera el sistema en inglés. Las instrucciones para agentes (`AGENTS.md`, `docs/agents/`) van en inglés, como el código que describen. El vocabulario compartido está en [`GLOSSARY.md`](../../GLOSSARY.md).

## 1. Producto y forma de trabajar

Ver [ADR 0001](adr/0001-domus-con-kira-dentro.md) y [ADR 0002](adr/0002-vue-spa-sqlite-y-pwa.md).

- **Un solo producto:** Kira vive en el mismo repositorio y en el mismo producto que Domus.
- **Cada funcionalidad entra después de su propia revisión en grilling** (P41).
- **Tecnología:** SQLite (P37), interfaz en Vue como SPA sin SSR (P38), primero PWA y Capacitor sobre la misma SPA solo si se queda corta (P39). La API son procedimientos oRPC servidos con Hono.
- **Inicio de sesión y permisos:** Better Auth, con assurance y step-up ligado a la operación exacta; los permisos se expresan con Permix (P36).
- **Sistema de diseño:** se hace justo después del núcleo y antes de las funcionalidades (P45).

## 2. Procesos, puertas e identidad

**Procesos** ([ADR 0003](adr/0003-procesos-y-contenedores.md)): tres programas además de la web, cada uno en su contenedor Docker y con reinicio independiente (P1, P28):

| Programa        | Qué hace                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `api`           | La puerta: autentica, sirve la API y la web compilada, arranca `platform` y los módulos. Único contenedor con el volumen de datos. |
| `assistant`     | Kira, la parte que piensa. Solo habla con `api`.                                                                                   |
| `voice-gateway` | Satélites, palabra de activación, STT/TTS y quién habla. Solo habla con `api`.                                                     |

**Una sola puerta** ([ADR 0004](adr/0004-una-sola-puerta.md)):

- `api` autentica todos los canales (app, Telegram, voz, apps conectadas) y pasa las conversaciones a `assistant` (P2, P33). Un turno nunca corre dentro de una petición HTTP.
- La puerta es la parte `http` de `platform`; `apps/api` solo la monta. `assistant` y `voice-gateway` hablan con ella por un `fetch` inyectado, y al arrancar comprueban la versión del protocolo: conectando, listo o incompatible ([ADR 0020](adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)).
- Kira habla con Domus por la API, como cualquier cliente, y nunca abre el núcleo por dentro (P7). Tiene una sola llave, y en cada petición dice de parte de quién habla (P8).
- **Contrato de conversación:** entra texto con adjuntos y quién habla; sale un flujo de eventos cancelable (trozo, tarjeta, acción a la espera de «sí», fin), con salidas `hablada`, `texto` y `estructurada`.

**Kira aislada por construcción** ([ADR 0005](adr/0005-kira-aislada.md), P51): su contenedor no monta el volumen de datos, la sesión de Claude Code arranca sin herramientas propias (terminal y ficheros) y solo tiene su llave para la API.

**Identidad** ([ADR 0006](adr/0006-identidad-de-kira-y-aparatos.md)):

- Kira actúa como la cuenta con la que entró el aparato. En un aparato con la cuenta `device`, si reconoce la voz de un miembro, actúa como ese miembro mientras dure la conversación; si no, actúa como `device` (P20, P21, P22b).
- «Soy Paco» solo vale si la voz coincide (P24).
- Las huellas de voz son datos personales y viven en Domus; la voz guarda solo una copia para trabajar (P4).
- Los aparatos se emparejan en Domus con un código y eligen con qué cuenta entran (P26). No hay tipos de aparato: una pantalla de pared es un aparato con la cuenta `device`.

## 3. Permisos, IA y visibilidad

- **Perfiles solo para personas** ([ADR 0007](adr/0007-perfiles-y-permisos-si-o-no.md)): `admin` (Paco), `member` (Rocío) y `device` (cuenta compartida). Los permisos son **sí o no**, por área y nivel, unos 50 (P14), sin permisos por acción suelta.
- **La IA no es un perfil** ([ADR 0008](adr/0008-la-ia-como-filtro-de-delegacion.md)): es una tabla de delegación que solo rebaja los permisos de la persona por la que habla (P11) y añade «pedir confirmación» a cada permiso (P18).
    - Las tareas de administrador por la IA empiezan en «no» y se pueden abrir. Contraseñas, PIN, llaves y emparejamiento no son acciones y quedan siempre fuera (P12).
    - Algunas acciones declaran en su definición que siempre piden confirmación, caso por caso, y nunca se confirma dos veces (P18).
    - La columna «ver» de la tabla decide qué ve la IA: lo que la IA no ve no sale hacia el modelo (P17).
    - No hay aprobación de lo que propone otra persona, ni aprobación automática, ni modo «solo sugerir» para las apps conectadas.
- **Visibilidad** ([ADR 0009](adr/0009-visibilidad-privado-o-publico.md)): solo privado o público, con dueño por registro (P19). Cada área elige su valor por defecto; la salud es siempre privada.
- **Una sola decisión** ([ADR 0010](adr/0010-una-sola-decision-de-autorizacion.md), P48): `platform/authorization` decide si algo se permite, si pide confirmación y si se puede ver, combinando permisos de la persona, filtro de la IA y visibilidad. Al confirmar lo vuelve a comprobar y verifica que la operación es exactamente la misma. La auditoría guarda las dos identidades: la persona y «vía Kira».

## 4. IA, memoria y mecanismos generales

- **Una sola configuración de IA** ([ADR 0011](adr/0011-una-configuracion-de-ia.md), P5): AI SDK Core para las llamadas sueltas y un runtime propio del agent con dos adapters, el Claude Agent SDK con la suscripción y AI SDK Core para modelos por API.
- **Lo compartido llega a Kira** ([ADR 0012](adr/0012-lo-compartido-llega-a-kira.md), P52): una foto, un PDF, un correo reenviado o un mensaje de Telegram llegan a Kira como conversación con adjunto, y lo que propone se confirma por lote. Los trabajos largos van en segundo plano, con aviso al acabar.
- **Fechas dichas con palabras** ([ADR 0013](adr/0013-fechas-dichas-con-palabras.md), P53): las interpreta el modelo y la API las valida. Las frases rápidas solo entienden «hoy», «mañana» y los días de la semana.
- **Memoria** ([ADR 0014](adr/0014-memoria-en-domus.md), P3, P25): vive en Domus, privada de cada persona o pública de la casa, por área. Kira guarda sin pedir aprobación; se puede preguntar «¿qué sabes de mí?» y pedir «olvida…». Las sesiones de Claude Code no son la memoria.
- **Tareas programadas generales** ([ADR 0015](adr/0015-tareas-programadas-generales.md), P29, P30): cualquier módulo declara una tarea con su frecuencia, a la hora de la familia; ajustes muestra la lista, la última ejecución y su resultado, y permite cambiar la hora, pausar o lanzar. Solo ejecutan código del repositorio. Siguen las invariantes de Hermes: la siguiente ejecución se marca antes de lanzar, hay registro de ejecuciones, se recupera lo perdido y hay un vigilante de inactividad. La revisión nocturna de la memoria es una tarea más.
- **Lo que un módulo aporta a Kira** ([ADR 0016](adr/0016-lo-que-un-modulo-aporta-a-kira.md), P31): una skill (`SKILL.md`), frases rápidas y avisos para la iniciativa. Solo texto y descripciones; Kira actúa llamando a acciones por la API.

## 5. Estructura del repositorio

Ver [ADR 0017](adr/0017-estructura-del-repositorio.md), [ADR 0020](adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md) y [ADR 0018](adr/0018-patrones-de-openclaw-y-hermes.md).

```
domus/
  apps/
    api/             la puerta: autentica, sirve la API, arranca platform y los módulos
    web/             Vue SPA / PWA
    assistant/       Kira, la parte que piensa (solo habla con api)
    voice-gateway/   satélites, palabra de activación, STT/TTS, quién habla (solo habla con api)
  modules/<módulo>/
    contracts/       solo lo público: esquemas y acciones que ofrece a otros
    server/          tablas, acciones y trabajos
    web/             pantallas
    assistant/       SKILL.md, frases rápidas y avisos
    tests/
  packages/
    platform/        http (la puerta), contracts, identity, authorization, audit, jobs (con las tareas programadas), events, notifications, storage
    module-sdk/      lo único de platform que un módulo puede usar
    ui/              sistema de diseño (componentes Vue)
    i18n/
    utils/           un tema por carpeta, importado por separado (@domus/utils/date-time…)
    test-utils/      platform en memoria, modelo falso y canal falso
    api-client/      cliente oRPC: clientFor(contrato, transporte), sin contratos propios
  tooling/           configuración de TypeScript compartida y comprobaciones del repositorio
  docker/            Dockerfile con un destino por programa
  docs/architecture/ + adr/
```

**Reglas que se comprueban automáticamente** (`.dependency-cruiser.cjs`, en `pnpm lint`; `tooling/scripts/architecture.test.ts` prueba que cada una salta):

- `apps` son programas, sin lógica de negocio: nada importa una app, y ninguna app usa directamente librerías de datos o de IA.
- Un módulo importa solo `module-sdk` y los `contracts` de otros, además de los paquetes sin negocio (`utils`, `i18n`; en `web/` también `ui` y `api-client`; en `tests/` también `test-utils`).
- `assistant` y `voice-gateway` solo hablan con `api`: no importan `module-sdk`, `ui` ni módulos, y de `platform` solo sus contratos (`@domus/platform/contracts`), igual que `web`. Una regla de alcance lo comprueba también por caminos indirectos.
- Los contratos son puros (sin Node), y toda importación tiene que resolverse: un paquete no declarado no se cuela.

Además, `tooling/scripts` comprueba el índice y los enlaces de los ADR, el tamaño de los `AGENTS.md`, y que ningún fichero nombre código anterior al proyecto. Un hook de pre-commit (`.githooks/`) busca secretos con gitleaks en lo que se va a confirmar y pasa lint, formato y tipos; la CI repite todo en cada PR y revisa con gitleaks todos los commits de la rama, porque el repositorio es público. Las normas que piden criterio están en `CODING_STANDARDS.md`.

**Registro de módulos:** lista fija generada en el build, sin carga en tiempo de ejecución, tienda ni instalación. El generador llega en la fase 1a con el primer módulo; hasta entonces no hay lista.

**`utils`:** entra solo lo que no sabe nada del negocio y usan al menos dos sitios, y un tema no importa otro sin motivo. Temas: `connection` (los estados conectando, listo e incompatible de los programas que hablan con la api) y `program` (puerto, direcciones, `/health` y parada de los tres programas); en la fase 1 llega `date-time`: fechas en la hora de la casa sobre `date-fns` y formatos sobre `Intl`. No lleva intérprete de lenguaje; el tiempo meteorológico va a su módulo.

**Patrones de OpenClaw y Hermes** (P40): skills como carpetas; cada canal declara su formato; pruebas de escenario con canal falso y modelo falso; una prueba de que el prompt y las tools no cambian entre turnos; un `AGENTS.md` por carpeta con tamaño máximo; la «escalera» de dónde va una funcionalidad nueva (en `AGENTS.md`). No se adoptan tiendas de plugins, proveedores de sobra, «un agent por persona» ni manifiestos enormes.

**Herramientas** ([ADR 0019](adr/0019-oxlint-y-oxfmt.md)): Node 22, pnpm con `minimumReleaseAge` (un día), Turborepo, TypeScript 6 estricto sobre tsgo, Vitest, Oxlint con tipos y Oxfmt para lint y formato, `vue-tsc` para los tipos de las plantillas y dependency-cruiser para las reglas.

## 6. Fases

0. **Esqueleto.** Herramientas, reglas de dependencias, CI y Docker con los programas vacíos; las decisiones en `docs/architecture` y en los ADR; `AGENTS.md`. Terminada cuando las comprobaciones pasan y una app vacía corre en la Pi.
1. **Núcleo.** 1a base de datos y módulos; 1b acciones; 1c identidad y autorización; 1d segundo plano (cola, tareas programadas, eventos en directo, avisos, archivos); 1e llaves de API. Terminada cuando un módulo de prueba cubre todos los casos de permiso, confirmación y visibilidad.
2. **Sistema de diseño.** Grilling del aspecto; componentes Vue, plantillas, estructura de la app, claro/oscuro, PWA.
3. **Personas, cuentas y aparatos.** Inicio de sesión, perfiles y permisos, tabla de la IA, emparejar aparatos.
4. **Módulo piloto: listas y compra.** Ciclo completo: revisión → pantallas → servidor y web → pruebas → Pi.
5. **Kira básica.** 5a puerta de la conversación (chat en la app y Telegram); 5b runtime con dos motores, ventanilla única de tools, confirmaciones, skills, consumo por conversación, escenarios; 5c voz (satélites, STT/TTS, quién habla, huellas). Terminada cuando «añade leche» desde la cocina reconoce a quien habla, pide confirmación y aparece en el móvil.
6. **Los demás módulos, uno a uno.** Calendario (con «compartir con Kira»), tareas de casa, cocina y menú, tablón, documentos, Home Assistant… El orden se decide al llegar.
7. **Memoria de Kira.**
8. **Especialistas.** El entrenador primero, con AimHarder.
9. **Iniciativa y domótica por voz.**

En paralelo, desde ya: una prueba corta para ver si el reconocimiento de quién habla distingue a Paco de Rocío en la cocina. Es el mayor riesgo del proyecto (P55).

## 7. Abierto

- **P49, el interruptor para apagar un módulo.** Se decide al revisar los módulos. Si existe, apaga el módulo entero: rutas, tools de Kira y tareas programadas.
- **Se deciden en la fase 5:** la forma del agent, el vocabulario, los evals, los parámetros y el afinado de voz.

## Índice de ADR

| ADR                                                                     | Decisión                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| [0001](adr/0001-domus-con-kira-dentro.md)                               | Domus con Kira dentro                               |
| [0002](adr/0002-vue-spa-sqlite-y-pwa.md)                                | Vue SPA, SQLite y PWA                               |
| [0003](adr/0003-procesos-y-contenedores.md)                             | Tres programas, cada uno en su contenedor           |
| [0004](adr/0004-una-sola-puerta.md)                                     | Una sola puerta: `api`                              |
| [0005](adr/0005-kira-aislada.md)                                        | Kira aislada por construcción                       |
| [0006](adr/0006-identidad-de-kira-y-aparatos.md)                        | Identidad de Kira y de los aparatos                 |
| [0007](adr/0007-perfiles-y-permisos-si-o-no.md)                         | Perfiles para personas y permisos sí o no           |
| [0008](adr/0008-la-ia-como-filtro-de-delegacion.md)                     | La IA como filtro de delegación                     |
| [0009](adr/0009-visibilidad-privado-o-publico.md)                       | Visibilidad: privado o público                      |
| [0010](adr/0010-una-sola-decision-de-autorizacion.md)                   | Una sola decisión de autorización                   |
| [0011](adr/0011-una-configuracion-de-ia.md)                             | Una sola configuración de IA                        |
| [0012](adr/0012-lo-compartido-llega-a-kira.md)                          | Lo compartido llega a Kira                          |
| [0013](adr/0013-fechas-dichas-con-palabras.md)                          | Fechas dichas con palabras                          |
| [0014](adr/0014-memoria-en-domus.md)                                    | La memoria vive en Domus                            |
| [0015](adr/0015-tareas-programadas-generales.md)                        | Tareas programadas generales                        |
| [0016](adr/0016-lo-que-un-modulo-aporta-a-kira.md)                      | Lo que un módulo aporta a Kira                      |
| [0017](adr/0017-estructura-del-repositorio.md)                          | Estructura del repositorio y reglas de dependencias |
| [0018](adr/0018-patrones-de-openclaw-y-hermes.md)                       | Patrones de OpenClaw y Hermes                       |
| [0019](adr/0019-oxlint-y-oxfmt.md)                                      | Oxlint y Oxfmt para lint y formato                  |
| [0020](adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md) | Composición de la API y comunicación entre procesos |
