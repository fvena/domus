# Plan por fases

Única fuente del plan de Domus: qué entra en cada fase, cuándo se da por terminada y en qué estado está. Se construye solo lo que pide la fase en curso, y cada funcionalidad entra después de su propia revisión en grilling ([ADR 0001](architecture/adr/0001-domus-con-kira-dentro.md)). Al terminar cada fase, lo que ya funciona se publica en la Pi. Cuando una fase cambia de estado, o su grilling fija qué incluye o cuándo termina, se corrige aquí. Las decisiones que la justifican están en [`architecture/README.md`](architecture/README.md) y en los ADR.

| Fase | Qué                            | Estado             |
| ---- | ------------------------------ | ------------------ |
| 0    | Esqueleto                      | hecha (2026-11-11) |
| 1    | Núcleo                         | en curso (1d2)     |
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

**Estado:** en curso. La 1a está hecha desde el 2026-11-12: la Pi corre `main` con la base de datos. La 1b está hecha desde el 2026-11-12: la Pi corre `main` con el registro de acciones. La 1c está hecha desde el 2026-11-12: la Pi corre `main` con cuentas, sesiones y autorización. La 1d1 está hecha desde el 2026-11-12: la Pi corre `main` con la cola, el planificador y la limpieza diaria.

**Terminada cuando** un módulo de prueba cubre todos los casos de permiso, confirmación y visibilidad. Cada subfase fija en su grilling cuándo termina ella. El tema `date-time` de `utils` (`date-fns` e `Intl`) entra en esta fase, con su primer uso.

- **1a. Base de datos y módulos.** Hecha el 2026-11-12. Decidida en su grilling ([spec de la 1a](../.scratch/fase-1a/spec.md), [ADR 0021](architecture/adr/0021-datos-de-los-modulos-y-migraciones.md)). Incluye SQLite en un solo fichero con `better-sqlite3` en `platform`, y una `platform` en memoria en `test-utils` ([ADR 0002](architecture/adr/0002-vue-spa-sqlite-y-pwa.md)); la forma mínima de `module-sdk`, `defineModule` y tablas con prefijo sobre Drizzle ([ADR 0017](architecture/adr/0017-estructura-del-repositorio.md)); las migraciones, generadas con `drizzle-kit` y aplicadas al arrancar por un ejecutor propio en una sola transacción; el módulo de prueba `probe`; la lista de módulos de `api`, generada, guardada en git y comprobada; la puerta recibe `platform` y la lista, y `apps/api` las compone ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)); y el binario nativo de SQLite en la imagen de la Pi. No trae rutas HTTP nuevas: `status` sigue siendo la única RPC. **Terminada cuando** `probe` existe con su tabla y sus migraciones, entra en las pruebas y queda fuera de la lista de producción; las pruebas de `platform`, `test-utils` y `tooling` cubren las migraciones, el historial, los prefijos y la lista; la CI no deja cambios tras `pnpm db:generate` y `pnpm modules:generate`; pasan todas las comprobaciones y el build; y en la Pi la fila de `platform/0000` es la misma antes y después de reiniciar y de recrear `api`.
- **1b. Acciones.** Hecha el 2026-11-12. Decidida en su grilling ([ADR 0022](architecture/adr/0022-acciones.md)). Un módulo solo lee y cambia sus datos desde el contexto de una acción, declarada en sus `contracts/` como lectura o escritura con `@domus/module-sdk/contracts`, y todo llamante recorre un solo camino en `platform/actions`: validar, autorizar, ejecutar en una transacción síncrona y registrar. Hasta la 1c, `platform/authorization` lo deniega todo en producción, solo las pruebas ponen un autorizador programable y las acciones no se montan en HTTP. Incluye el registro de acciones (`platform/0001`, a mano), la clave de idempotencia y deshacer con la inversa que deja cada escritura deshacible. No incluye llamadas entre acciones de módulos, efectos fuera de SQLite ni un mecanismo de olvido. **Terminada cuando** `probe` tiene lecturas, escrituras deshacibles y una irreversible; las pruebas, cada garantía en el nivel más pequeño que pueda romperla, cubren la validación y la atomicidad (también resultado o inversa no válidos y fallo del registro), la denegación en producción y en el autorizador, la idempotencia (clave ausente, misma clave con otra acción u otra entrada, orden de propiedades, aislamiento por cuenta y `via`, reautorización, reintento tras revertir y tras reiniciar), deshacer (cambio posterior, reglas del módulo, escritura irreversible, dos veces, rehacer, inversa fuera de la respuesta y atomicidad) y la caducidad (límite exacto de `expiresAt`, cambio de plazo y «resultado caducado» sin ejecutar, también tras reiniciar); las reglas comprueban que la entrada de contratos no alcanza Drizzle ni Node, que cada implementación corresponde a un contrato con nombre único y que el SDK no ofrece en producción otro acceso a los datos; pasan todas las comprobaciones y el build; y en la Pi la fila de `platform/0001` conserva posición, hash e instante tras reiniciar, y `status` sigue siendo la única RPC.
- **1c. Identidad y autorización.** Hecha el 2026-11-12. Decidida en su grilling ([ADR 0023](architecture/adr/0023-identidad-y-autorizacion.md)). Incluye las cuentas con Better Auth (correo y contraseña, sin registro abierto, altas y cambio de contraseña con `pnpm accounts`); aparato, sesión y cuenta separados, con revocación; el contexto verificado que construye la puerta; la decisión única en `platform/authorization`, una función pura sin Permix: permisos por área y nivel (`read`, `write`, `manage`) declarados en cada contrato, la tabla de delegación de cada cuenta ([ADR 0008](architecture/adr/0008-la-ia-como-filtro-de-delegacion.md)) y la visibilidad privado o público ([ADR 0009](architecture/adr/0009-visibilidad-privado-o-publico.md)), comprobada al escribir con triggers temporales; las confirmaciones pendientes, también de lecturas; los comprobantes de step-up ligados a la operación; la escritura que ya no guarda su resultado; las migraciones de la plataforma generadas desde `platform/0002`; y las acciones servidas por HTTP con sesión. Las pantallas (iniciar sesión, ajustes, emparejar) son la fase 3; `via` y el canal `contexto` llegan con la 1e y la fase 5. **Terminada cuando** cada garantía tiene su prueba en el nivel más pequeño que pueda romperla, y `probe` demuestra la integración y las reglas de los módulos: permisos por nivel; delegación (rebajar, confirmar y conservarla al confirmar desde la app); visibilidad (ver, editar, crear, cambiar, dueño fijo, salud, intentos de saltarse el filtro y las formas de escritura no cubiertas); las garantías de la confirmación, también de lectura, concurrente, con respuesta perdida y tras reiniciar; el comprobante; la repetición con acuse sin contenido; el acceso al registro y deshacer, también vía Kira; la operación exacta (otra acción, otra entrada, otra entrada deshecha y esquemas que transforman la entrada); la caducidad en el instante exacto; la revocación y el cambio de contraseña, que anulan pendientes y comprobantes; la confirmación de salud desde otro canal sin abrir su divulgación por voz; y la falsificación por HTTP (cuenta, `via`, aparato, canal e identidad declarados por el cliente). La CI cubre por HTTP las llamadas sin sesión, permitidas, denegadas y con confirmación, y dos sesiones de personas distintas en un mismo navegador; las migraciones, la instalación limpia, la actualización desde la 1b, que la base generada nunca se aplica, los hashes intactos y que dos generaciones seguidas no dejan cambios; pasan todas las comprobaciones y el build; en la Pi, `pnpm accounts` crea las dos cuentas, una sesión entra, una operación permitida de la plataforma funciona y una denegada falla, y tras reiniciar la sesión sigue y la revocada no; y `despliegue.md` y la guía recogen lo construido.
- **1d. Segundo plano.** Decidida en su grilling ([ADR 0025](architecture/adr/0025-segundo-plano.md)). Se construye en cuatro subfases, en orden, cada una con su spec, su PR y su comprobación en la Pi. Cada una termina cuando cada garantía tiene su prueba en el nivel más pequeño que pueda romperla, también las caídas en sus puntos críticos; `probe` demuestra la integración; pasa `pnpm check`; la comprobación en la Pi sale bien; y `despliegue.md` y la guía recogen lo construido.
    - **1d1. Cola y tareas programadas.** Hecha el 2026-11-12. La cola en `api` con sus dos carriles y el mantenimiento, el planificador a la hora de la casa con `utils/date-time`, el registro de ejecuciones, el vigilante y las operaciones de ajustes de las tareas. El primer caso real es la limpieza del contenido caducado del registro de acciones. La bandeja de salida llega con la 1d4, su primer uso, y los trabajos pedidos, que rehacen el contexto verificado, con la 5b. **Terminada cuando** además en la Pi el planificador arranca y para con `api`, y la limpieza corre a su hora y sobrevive a un reinicio, y las pruebas cubren el cambio de hora, lo perdido y la caída entre marcar y encolar.
    - **1d2. Copias de seguridad.** Copia diaria de la base con `db.backup()` y restic en `/srv/backups/domus`, en el mismo NVMe de forma provisional, con retención 7/4/3, `check --read-data` semanal y el procedimiento de restaurar. **Terminada cuando** además una copia se restaura en un entorno aislado, la restauración descarta los trabajos pendientes y un reinicio no, y se mide en la Pi que durante la copia la API responde.
    - **1d3. Archivos.** Subida en cuatro pasos, archivos preparados, referencias de la plataforma, descarga ligada al registro y limpieza; la copia incorpora los contenidos que necesita su instantánea. **Terminada cuando** además se restaura en la Pi base y archivos juntos, y las pruebas cubren la carrera entre limpieza y vinculación y deshacer un borrado con archivo.
    - **1d4. Eventos en directo y avisos.** Invalidaciones por SSE, la bandeja de salida desde las acciones y los avisos Web Push que salen por ella, con las suscripciones de cada cuenta y aparato. **Terminada cuando** además dos sesiones de personas distintas reciben solo lo que pueden ver, y un aviso sale contra un servicio de push falso. Recibirlo en el iPhone es criterio de la fase 2.

    Las copias viven por ahora en el mismo NVMe que los datos: protegen de borrados y errores, no de perder el disco o la Pi. La casa acepta ese riesgo para el uso real, también con salud y documentos, hasta que haya un NAS, que se añadirá como destino.

- **1e. Llaves de API.** La de Kira y las de otras apps, con «de parte de». Entre sus criterios de aceptación: el mismo cliente funciona con llave y da error sin ella ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)).

Lo que Kira necesitará del núcleo, para el grilling de cada subfase:

- **1b** (decidido en el [ADR 0022](architecture/adr/0022-acciones.md)): una acción no se repite si algo se reinicia a medias, gracias a la clave de idempotencia. Una escritura declarada deshacible conserva una inversa durante su plazo; deshacer pasa por la autorización y solo se ejecuta si no hay cambios posteriores incompatibles y se cumplen las reglas del módulo. Las escrituras irreversibles lo declaran antes de ejecutarse.
- **1c** (decidido en el [ADR 0023](architecture/adr/0023-identidad-y-autorizacion.md)): un «sí» solo confirma en el turno siguiente de la misma persona, en el mismo aparato y en un plazo corto (del orden de un minuto, ajustable). Pasado ese plazo, la confirmación sigue pendiente en la app y no la hereda otra sesión ni otro aparato; un «sí» sin una pregunta reciente no confirma nada. La excepción es leer la salud en un aparato con la cuenta `device`: solo se confirma allí mismo, por voz y dentro de ese plazo, y después caduca. La salud no se lee ni se muestra en un aparato con la cuenta `device` salvo que su persona lo pida, y su persona la ve, la corrige y la borra. El admin no ve ni cambia los ajustes de la otra persona. Una voz no reconocida en la cuenta `device` no deja memoria ni conversación; lo que ejecuta conserva su entrada en el registro.

## 2. Sistema de diseño

**Estado:** pendiente.

**Incluye:** el grilling del aspecto con Paco (colores, letra, tono y referencias); los componentes Vue, las plantillas de página, la estructura de la app (menú y ajustes), claro y oscuro, y la PWA.

**Terminada cuando** hay un catálogo de componentes y una página de ejemplo que Paco aprueba, y la estructura de la app, hecha con ellos, funciona en claro y en oscuro y se instala como PWA en el móvil, que recibe un aviso real de la 1d con la PWA cerrada.

## 3. Personas, cuentas y aparatos

**Estado:** pendiente.

**Incluye:** las pantallas y los flujos sobre lo que construye la 1c: el inicio de sesión, los perfiles y permisos ([ADR 0007](architecture/adr/0007-perfiles-y-permisos-si-o-no.md)), la tabla de la IA ([ADR 0008](architecture/adr/0008-la-ia-como-filtro-de-delegacion.md)) y el emparejamiento de aparatos ([ADR 0006](architecture/adr/0006-identidad-de-kira-y-aparatos.md)). Su grilling decide dos puntos que deja abiertos la 1c. La cookie de sesión va siempre con `Secure` en la Pi, así que un navegador la guarda por Tailscale (https) y no por `http://kira.local:3000` ([`despliegue.md`](despliegue.md), «Las sesiones y su cookie»). Y por HTTP una escritura devuelve su recibo (`{ result, entry }`, o el acuse), pero el tipo que da `api-client` con el contrato de un módulo dice que devuelve el resultado.

**Terminada cuando** Paco y Rocío entran desde el móvil cada uno con su cuenta, un aparato emparejado entra con la cuenta `device`, y los permisos y la tabla de la IA se cambian desde ajustes. Antes del uso real, las copias de seguridad de la 1d funcionan y hay una restauración probada; siguen en el mismo NVMe hasta que haya un NAS ([ADR 0025](architecture/adr/0025-segundo-plano.md)).

## 4. Módulo piloto: listas y compra

**Estado:** pendiente.

**Incluye:** el ciclo completo de un módulo: revisión → pantallas → servidor y web → pruebas → Pi. Antes de admitir datos privados reales, su grilling define cómo afecta su borrado al registro de acciones, a las inversas y a las copias de seguridad ([ADR 0022](architecture/adr/0022-acciones.md)); lo mismo cada módulo de la fase 6.

**Terminada cuando** listas y compra corre en la Pi y la casa lo usa. El ciclo queda como el camino de los módulos de la fase 6.

## 5. Kira básica

**Estado:** pendiente.

- **5a. Puerta de la conversación:** entra texto con adjuntos (fotos, PDF, correos) y quién habla; sale la respuesta por trozos, y se puede cortar a medias ([ADR 0004](architecture/adr/0004-una-sola-puerta.md), [ADR 0012](architecture/adr/0012-lo-compartido-llega-a-kira.md)). Chat en la app y Telegram. La conversación sigue de un aparato a otro sin que uno compartido lea nada privado. Antes de la primera operación que dependa de la api, el seguimiento de la conexión de `assistant` entrega el cliente, y sus llamadas fallan al momento si no está listo ([ADR 0020](architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md)). Su grilling decide si Kira pide los turnos a la api, para que `assistant` no acepte conexiones.
- **5b. Runtime** con dos motores (la suscripción de Claude y modelos por API), ventanilla única de tools, confirmaciones, skills, consumo por turno (tokens, coste equivalente, latencia por fases y resultado) y escenarios. Lo que Kira deja en segundo plano es un trabajo pedido, que se vuelve a autorizar rehaciendo el contexto verificado de quien lo pidió ([ADR 0025](architecture/adr/0025-segundo-plano.md)). Kira guarda con el turno la clave de idempotencia de cada llamada a una tool, para que un reintento repita la misma operación aunque se reconstruya la llamada ([ADR 0022](architecture/adr/0022-acciones.md)). Una sola configuración de IA en ajustes ([ADR 0011](architecture/adr/0011-una-configuracion-de-ia.md)). Cambiar de motor conserva la personalidad y los recuerdos. Sin internet, lo local sigue funcionando y lo demás falla de forma controlada. Lo que tarda más de unos 15 s va en segundo plano y avisa al acabar. Las muletillas son pertinentes a la petición, nunca adelantan un resultado, no se repiten seguidas, no se dicen si la respuesta llega antes de unos 1,5 s y en texto no hay.
- **5c. Voz:** satélites, STT/TTS, reconocer quién habla y huellas; con poca confianza, Kira pregunta «¿Paco o Rocío?». Su grilling decide si la misma voz llega al móvil y al navegador en esta fase o justo después.

La fase empieza cerrando lo que quedó abierto del diseño de Kira con lo que ya fija Domus: la forma del agent (uno con skills o un equipo), el vocabulario, los evals, los parámetros, las trazas, el clasificador local y los modelos locales. También decide el afinado de voz y cómo llega la sesión de Claude al contenedor `assistant` sin montar datos ([ADR 0003](architecture/adr/0003-procesos-y-contenedores.md)).

**Terminada cuando** «añade leche» dicho desde la cocina reconoce a quien habla, pide confirmación y aparece en el móvil. Las latencias medidas, de callar al primer audio, quedan cerca de los objetivos: nivel 0, p50 ≤ 1,2 s y p95 ≤ 1,5 s; conversación o una tool, p50 ≤ 2 s y p95 ≤ 3 s; en texto, el primer trozo ≤ 2 s. Son objetivos deseables, que se revisan al medir.

## 6. Los demás módulos, uno a uno

**Estado:** pendiente.

**Incluye:** calendario (con «compartir con Kira»), tareas de casa, cocina y menú, tablón, obligaciones, documentos, Home Assistant… El orden se decide al llegar.

**Terminada:** cada módulo, cuando completa el ciclo de la fase 4. La lista de módulos de la fase se fija al empezarla, y la fase termina cuando están todos.

## 7. Memoria de Kira

**Estado:** pendiente.

**Incluye:** la memoria en Domus, privada de cada persona o pública de la casa, por área, y su revisión nocturna como tarea programada ([ADR 0014](architecture/adr/0014-memoria-en-domus.md)). Un recuerdo deducido es una hipótesis, con su fuente, hasta que su persona lo confirma. Lo privado de una persona no llega a la otra, ni siquiera por recuerdos derivados. El contexto de cada turno se monta bajo demanda y tiene un tope que no crece con el tiempo.

**Terminada cuando** Kira guarda lo que aprende, responde a «¿qué sabes de mí?» y cumple «olvida…».

## 8. Especialistas

**Estado:** pendiente.

**Incluye:** el entrenador primero, con AimHarder; después la nutricionista y el coach.

- Cada persona elige sus especialistas en sus ajustes. A uno se llega por el tema o nombrándolo; si la persona no lo tiene activo, responde Kira sin la memoria de ese especialista.
- Las sesiones largas (la entrevista de la nutricionista, el plan de la semana) se retoman donde se dejaron, también desde otro canal, y lo largo se entrega en pantalla.
- Se distingue lo previsto de lo hecho (una reserva no prueba que se entrenó), y se avisa cuando faltan datos.
- Cada persona conecta su cuenta de AimHarder sin tocar el núcleo, y revocar una no afecta a la otra.
- El entrenador cubre también lo que Paco y Rocío entrenan juntos para competir.
- El consumo se ve también por persona y por especialista, con un aviso si un día se dispara.
- La muletilla llega en ≤ 1,5 s y la respuesta completa en ≤ 8 s.

**Terminada cuando** los tres funcionan. El entrenador, con los datos de AimHarder. Cada especialista se revisa en su propio grilling al llegar.

## 9. Iniciativa y domótica por voz

**Estado:** pendiente.

**Incluye:** la iniciativa de Kira con los avisos que aporta cada módulo ([ADR 0016](architecture/adr/0016-lo-que-un-modulo-aporta-a-kira.md)), con horas de silencio y un límite diario por persona, y la domótica por voz. Lo privado va al móvil de su persona y lo de la casa, a la cocina. Cada persona ajusta o apaga su iniciativa.

**Terminada cuando** Kira avisa por su cuenta con los avisos de los módulos, respeta las horas de silencio y el límite diario, y la casa se maneja por voz.

## Después de la fase 9

Sin fase todavía. No se construye, pero nada de lo anterior debe impedirlo: vehículos, mascotas, finanzas (solo lectura) y música; la voz desde el móvil fuera de casa; y que la conversación acepte audio directo (modelos de voz a voz). Al terminar la fase 9 se decide si entran y en qué orden.

## En paralelo, desde ya

Una prueba corta para ver si el reconocimiento de quién habla distingue a Paco de Rocío en la cocina. Es el mayor riesgo del proyecto (P55). **Estado:** en curso, esperando las grabaciones de Paco y Rocío.
