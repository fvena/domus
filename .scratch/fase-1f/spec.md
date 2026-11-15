# Fase 1f: retirar las apps conectadas

Status: ready-for-agent

Esta spec sale del grilling de la retirada de las apps conectadas del 2026-11-15 (Q1–Q13), que siguió a una revisión de la arquitectura, y del acuerdo posterior sobre las costuras de prueba. Las decisiones duraderas están en el [ADR 0034](../../docs/architecture/adr/0034-retirar-las-apps-conectadas-antes-de-la-fase-5.md), que precisa los ADR [0003](../../docs/architecture/adr/0003-procesos-y-contenedores.md), [0020](../../docs/architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md), [0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md), [0030](../../docs/architecture/adr/0030-llaves-y-mandatos.md), [0031](../../docs/architecture/adr/0031-domus-con-un-agente-opcional.md) y [0032](../../docs/architecture/adr/0032-autorizacion-del-agente.md). Si esta spec y los ADR no coinciden, mandan los ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): app conectada, llave, mandato, vía Kira, agente conectado, actor, aparato, cuenta de aparato, sesión, contexto verificado, tabla de delegación, confirmación pendiente, comprobante, acción, registro de acciones, clave de idempotencia, mantenimiento, copia de seguridad y restaurar.

## Problema

La 1e construyó el mecanismo de las apps conectadas para que Kira hablara con Domus: la llave, el mandato, el canal `contexto` con su «sí» por voz, y los programas `assistant` y `voice-gateway`. Desde el ADR 0031, Kira es un producto aparte, y el ADR 0032 sustituye todo ese mecanismo en la fase 5 por el perfil OAuth de MCP, sin convertirlo. Mientras tanto:

- nada lo usa: ningún camino de producción emite mandatos, la Pi no escribe ningún `via`, y los dos programas solo comprueban su conexión con la api;
- la puerta, la autorización, la limpieza y restaurar cargan con él, y quien diseñe las pantallas de la fase 3 o el módulo de listas y compra de la fase 4 tiene que tenerlo en cuenta;
- la Pi corre dos contenedores que no hacen nada y guarda una llave que hay que custodiar, rotar y revocar al restaurar;
- la regla del aparato compartido de la 1c tiene una mitad que ya no puede ocurrir: la del miembro reconocido por la voz que confirma en 60 s.

Retirarlo no puede llevarse por delante lo que sí sigue: la tabla de delegación, que la fase 3 enseña en pantalla; `via` en el registro; y las garantías que cualquier agente futuro tendrá que cumplir, que hoy solo se prueban a través del mandato.

## Solución

La 1f borra el mecanismo entero y deja la plataforma como si nunca hubiera habido una app conectada en producción:

- salen las llaves, el comando `keys` y la regla de gitleaks de las llaves; los mandatos; el canal `contexto`, la identidad `voice` y la ventana del «sí» por voz;
- salen `apps/assistant`, `apps/voice-gateway` y `@domus/utils/connection`, con sus reglas de dependencias, sus servicios y su secreto en Docker, `DOMUS_KIRA_KEY` y su parte de la CI;
- una migración nueva borra las tablas de las llaves y de los mandatos y las dos columnas de las confirmaciones que solo servían al «sí» por `contexto`;
- la puerta responde `UNAUTHORIZED` a una petición de `/api` que traiga `Authorization` o la cabecera del mandato, también junto a una cookie válida, y `status` deja de decir qué app llama;
- la regla del aparato compartido se reduce a su denegación: la cuenta `device` no lee un área que declara `confirmOnSharedDevice`.

Se quedan la tabla de delegación, `via` con el valor `kira` y las confirmaciones en la app. Las garantías del ADR 0030 que valen para cualquier agente pasan a la autorización, donde ya se decide todo lo demás, y se prueban sobre el contexto verificado sintético que ya existe, sin HTTP. En la Pi, la 1f se despliega retirando los dos contenedores, y la llave de Kira desaparece con su tabla.

## Historias de usuario

1. Como Paco, quiero que Domus deje de llevar un mecanismo que nadie usa, para que las fases 2 a 4 se diseñen sobre un núcleo más pequeño.
2. Como Paco, que mantiene Domus, quiero que la Pi corra solo `api`, para no vigilar contenedores que no hacen nada.
3. Como Paco, quiero que la llave de Kira desaparezca de la Pi, para no tener que custodiar, rotar ni revocar una credencial sin uso.
4. Como Paco, quiero que la carpeta del secreto de Kira y su variable se borren solo después de comprobar que `api` arranca y migra, para poder volver atrás si algo falla.
5. Como Paco, quiero que una petición con `Authorization: Bearer` reciba un 401, para que un cliente de la fase 5 desplegado antes de tiempo no vea un Domus anónimo que parece funcionar.
6. Como Paco, quiero que una petición con la cabecera del mandato también reciba un 401, para que ninguna credencial retirada pase como si no estuviera.
7. Como Paco, quiero ese 401 también cuando la petición trae además una cookie de sesión válida, para que una credencial retirada nunca se ignore en silencio.
8. Como Paco, quiero ese 401 también en `status`, para que la regla de que ninguna credencial mala baja a anónima siga sin excepciones.
9. Como Paco, quiero que `/health` y la web compilada respondan igual que antes, para que la vigilancia de la Pi y la app no noten la retirada.
10. Como Paco, quiero que `status` deje de decir qué app llama, porque ya no hay apps.
11. Como Rocío, quiero entrar en la app con mi sesión y usarla igual que antes de la 1f, para que la retirada no me afecte.
12. Como Paco, quiero que una confirmación pendiente de la app que existía antes de la 1f siga ahí con su misma caducidad, para no perder lo que estaba por confirmar.
13. Como Paco, quiero que desaparezcan las pendientes que solo se podían confirmar por `contexto`, porque ya nadie puede confirmarlas.
14. Como Paco, quiero que la migración nueva deje el mismo esquema en una instalación limpia y en una base que viene de la 1e, para que la Pi y un Domus nuevo sean iguales.
15. Como Paco, quiero que las migraciones anteriores no cambien, para que sus hashes sigan valiendo en la Pi.
16. Como Paco, quiero poder restaurar una copia hecha antes de la 1f con el código de después, para que las copias de estas semanas sigan sirviendo.
17. Como Paco, quiero que restaurar esa copia aplique la migración nueva y conserve los datos de la casa, para no perder nada al volver atrás en el tiempo.
18. Como Paco, quiero que la copia de la primera noche tras desplegar la 1f salga bien, para saber que la base sin esas tablas se copia como antes.
19. Como Paco, quiero que la pantalla de la cocina, con la cuenta `device`, siga sin poder leer la salud aunque le abra el área por error, para que lo privado no salga por una pantalla compartida.
20. Como Paco, quiero que desaparezca la confirmación en 60 s por voz en un aparato compartido, porque sin voz no puede darse.
21. Como Rocío, quiero que la tabla de delegación siga existiendo, para poder decidir en la fase 3 qué puede hacer un agente por mí.
22. Como Rocío, quiero que la delegación siga rebajando y nunca ampliando mis permisos, para que un agente futuro no pueda más que yo.
23. Como Rocío, quiero que un área sin fila en mi delegación siga cerrada al agente, para que un módulo nuevo nazca cerrado.
24. Como Rocío, quiero que una pendiente que pide un agente y confirmo yo desde la app conserve la delegación de cuando nació, para que confirmar no le abra más.
25. Como Rocío, quiero que un agente nunca pueda confirmar ni rechazar una pendiente, aunque su contexto diga que viene de la app, para que el «sí» siempre sea mío.
26. Como Paco, quiero que una acción `manage` pedida por un agente no se complete por sí sola, para que la administración siga siendo cosa de una persona.
27. Como Paco, quiero que un comprobante no cuente cuando lo trae un agente, para que el step-up siga siendo de la persona.
28. Como Paco, quiero que la clave de idempotencia siga siendo por cuenta y `via`, para que un reintento del agente no se confunda con uno mío.
29. Como Rocío, quiero que un agente lea mis anotaciones y deshaga mis entradas solo dentro de mi delegación, y que deshacer se le deniegue cuando la retiro, para que retirar el acceso corte también eso.
30. Como Paco, quiero que el registro de acciones siga anotando `via`, para saber qué se hizo vía el agente cuando lo haya.
31. Como Paco, quiero que un agente siga sin llegar a contraseñas, sesiones, comprobantes, acceso, delegación, aparatos, ajustes de las tareas, avisos ni suscripciones, para que esa lista no dependa de un mecanismo que ya no existe.
32. Como quien escriba la fase 5, quiero que esas garantías sigan probadas, para partir de ellas al conectar el agente por OAuth.
33. Como quien escriba la fase 5, quiero que la retirada no invente un mecanismo nuevo de «vía agente», para decidir su forma con el perfil OAuth de MCP.
34. Como quien escriba un módulo, quiero que los ejemplos de `probe` ya no lleven llaves ni mandatos, para copiar solo lo que un módulo necesita.
35. Como quien mantenga el repositorio, quiero que las reglas de dependencias de los programas desaparezcan con ellos, y que `architecture.test.ts` siga probando que salta cada regla que queda.
36. Como quien mantenga el repositorio, quiero que el escaneo de secretos siga funcionando con las reglas por defecto de gitleaks y que su prueba compruebe que una muestra real activa una regla, para que quitar la regla de las llaves no deje el escaneo sin probar.
37. Como quien mantenga el repositorio, quiero que la CI solo construya y arranque `api`, para no gastar tiempo en imágenes que ya no existen.
38. Como Paco, quiero que `despliegue.md` y la guía describan la Pi tal como queda, para no buscar una sección «Las llaves» que ya no aplica.
39. Como Paco, quiero que el glosario deje de definir la llave y la app conectada y que el mandato tenga su sentido de la fase 5, para que el vocabulario diga lo vigente.

## Decisiones de implementación

### Qué sale y qué queda (Q1, Q9)

- Sale de `platform` todo lo de las llaves y los mandatos: su lectura de las cabeceras, su comprobación, su emisión de pruebas, su anotación del último uso, su barrido en la limpieza, su revocación al restaurar, la lista fija de apps conectadas, las opciones de la plataforma que solo servían a ellas y el comando `keys` con su entrada en el bundle de `api` y su script.
- Salen `apps/assistant`, `apps/voice-gateway` y el tema `connection` de `@domus/utils`. El tema `program` se queda, porque `api` lo usa.
- Salen de `@domus/platform/contracts` las constantes de la cabecera de la llave, su esquema y la del mandato, y el campo `app` de la respuesta de `status`. `PROTOCOL` no sube: ningún cliente que quede lee ese campo.
- Se quedan la tabla de delegación y sus operaciones, `via` en el contexto verificado, en el registro de acciones, en las pendientes y en la clave de idempotencia, y las confirmaciones en la app con sus 24 h. `via` conserva el valor `kira` hasta la fase 5.

### El contexto verificado (Q1, Q6)

- El canal se queda con un solo valor, `app`. No se quita el campo: lo leen el origen guardado de cada pendiente y las reglas de los comprobantes, y la fase 5 decide si llega otro.
- La identidad acreditada se queda con `password` y `device`; sale `voice`.
- Sale el campo de la conversación, que solo servía al «sí» por `contexto`.

### La autorización (Q1, Q5, Q6)

- Sale la decisión `confirm-in-context`. Las decisiones quedan en permitir, denegar, confirmar y comprobante.
- La regla del aparato compartido queda así: en una lectura de un área que declara `confirmOnSharedDevice`, si la cuenta representada es la cuenta de aparato, se deniega. El caso del miembro reconocido en un aparato compartido desaparece, porque sin voz no puede darse.
- Las garantías que la 1e cumplía por el canal `contexto` del mandato se cumplen ahora por `via`, dentro de la decisión, para que no dependan de un canal que ya no existe:
    - un comprobante no cuenta en un contexto con `via`; vía el agente, una operación que pide comprobante solo se completa cuando la persona confirma desde la app, como hoy. La petición a la autorización lleva quién confirmó (`confirmedBy`), y el comprobante cuenta solo si lo trae una persona por el canal `app` y sin `via`: la que confirma, o la que pide por sí misma. Una repetición vía el agente con la misma clave no la confirma nadie, así que no cuenta su comprobante, ni uno recién pedido por la persona;
    - un contexto con `via` no confirma ni rechaza, aunque declare el canal `app`. Endurece la regla de hoy, que solo cerraba confirmar al mandato porque el mandato llevaba siempre el canal `contexto`. Responde `FORBIDDEN` antes de buscar la pendiente;
    - la lista de operaciones de la plataforma que admite un contexto con `via`, hoy `log/read` y `log/undo`, pasa de la puerta a la autorización; cualquier otra operación de la plataforma, también una nueva o desconocida, se deniega vía el agente. Dentro de `decide`, la lista va por el nombre completo de la acción (`platform.readLog`), y deshacer pasa entero, porque lo que se autoriza es la inversa, que sigue el resto de la decisión. Las operaciones que no van por el camino de las acciones (cambiar la contraseña, listar las sesiones, pedir un comprobante, confirmar y rechazar) preguntan a `asksByItself` de la autorización, que deniega todo contexto con `via`.
- Lo demás de la decisión no cambia: permisos por área y nivel, delegación que rebaja, `manage` y operaciones sensibles con comprobante, acciones que siempre piden confirmación, y visibilidad.

### Las confirmaciones (Q6, Q7)

- Desaparecen la marca de «solo por `contexto`» y el cierre de su ventana. Una pendiente se confirma o se rechaza solo desde la app, por la misma persona, en sus 24 h.
- Sale el plazo de unos 60 s de la configuración de los plazos de confirmación.
- La comprobación al confirmar sigue igual: vuelve a autorizar con el contexto de origen, con su delegación de entonces, y verifica que la operación es exactamente la misma. Quien confirma no es quien pidió: la persona confirma por el canal `app` y sin `via`, y la operación conserva el `via` de origen para la delegación y para el registro.
- Mientras las dos columnas sigan en el esquema, se conserva el mínimo código que las escribe, sin significado funcional, porque el cierre de la ventana no admite nulos ni tiene valor por defecto, y una pendiente antigua «solo por `contexto`» sigue sin poder confirmarse desde la app. La migración se lleva los dos restos.

### La migración (Q7)

- Una migración nueva de la plataforma, generada como las demás desde el esquema, borra la tabla de las llaves, la de los mandatos y las columnas de «solo por `contexto`» y del cierre de su ventana de las confirmaciones.
- Antes de quitar las columnas, borra las pendientes marcadas como «solo por `contexto`». El generador no deduce ese borrado: la sentencia se añade a la migración nueva antes de su commit, y dos generaciones seguidas siguen sin dejar cambios. Las demás pendientes se conservan con sus datos y su caducidad.
- Las migraciones anteriores no cambian. La regla de comprobación de la identidad de los mandatos desaparece con su tabla.

### La puerta (Q8)

- Toda petición a `/api` que traiga la cabecera `Authorization`, con cualquier valor, o la cabecera del mandato responde `UNAUTHORIZED`, antes de mirar la cookie y también en `status`. Las rutas de archivos y el canal en directo siguen su regla de errores como JSON plano.
- `/health` y la web compilada no miran esas cabeceras.
- Sin esas cabeceras, la puerta hace lo de siempre: con una sesión válida, el contexto verificado de la sesión; sin ninguna, `status` sigue siendo público.
- La comprobación de Better Auth que rechazaba una llave o un mandato desaparece con ellos; la de la puerta la cubre.

### Restaurar y la limpieza (Q1)

- Restaurar deja de revocar llaves y de borrar mandatos. Sigue cerrando todas las sesiones y anulando pendientes y comprobantes, y no cambia de orden.
- La limpieza diaria pierde el barrido de los mandatos caducados.

### Herramientas, Docker y CI (Q9)

- Salen las reglas de dependencias que solo existían por los programas y sus casos en `architecture.test.ts`. La que alcanzaba la plataforma por cualquier cadena de imports se queda para `web`, como `web-never-reaches-platform`.
- Del tema `program` de `@domus/utils` salen también lo que solo usaban los dos programas: `readUrl` y el servidor de `/health`. Se quedan `readPort` y `onShutdown`, que usa `api`.
- `.gitleaks.toml` pierde la regla de las llaves y se queda con las reglas por defecto.
- `docker-compose.yml` pierde los servicios `assistant` y `voice-gateway` y el secreto `kira-key`; el `Dockerfile`, sus destinos; `.env.local.example`, `DOMUS_API_URL` y `DOMUS_API_KEY_FILE`, las variables locales de los dos programas (`DOMUS_KIRA_KEY` solo está en el `.env` de la Pi); la CI, su matriz de build y su clave vacía.
- Sale `tooling/scripts/assistant-acts.test.ts`, que probaba el criterio del ADR 0020 con el cliente de `assistant`.

### La comprobación en la Pi (Q10)

En el Domus real, en este orden:

1. desplegar la imagen nueva con `docker compose up -d --remove-orphans`;
2. comprobar que `docker compose ps` muestra solo `api`, que la fila de la migración nueva está, y que sigue igual tras reiniciar y tras recrear `api`;
3. comprobar que `status` con un `Bearer` inventado da 401 y que una sesión normal entra y lee;
4. borrar la carpeta del secreto de Kira y quitar `DOMUS_KIRA_KEY` de la configuración de la Pi;
5. al día siguiente, comprobar que la copia de esa noche salió bien.

La persona solo teclea contraseñas; el resto lo ejecuta el agente con la sesión que ella deja.

### Reglas y documentación (Q11)

Quedan al día, al cerrar la 1f:

- `despliegue.md`, sin la sección «Las llaves», sin las filas y los logs de los dos programas y sin la revocación de las llaves al restaurar;
- la guía, en `seguridad.md`, `permisos.md`, `programas.md`, `arquitectura.md`, `la-pi.md` y su portada, revisadas con `humanizer`;
- los `AGENTS.md` de `apps/` y `packages/`, y `docs/agents/packages.md`;
- `docs/architecture/README.md`, que deja de describir los programas y la llave como vigentes;
- el glosario: salen **Llave** y **App conectada**, **Agente conectado** deja de definirse como una app conectada, **Mandato** queda con el sentido del ADR 0032 marcado para la fase 5, y **Vía Kira** sigue;
- el plan, con la 1f hecha cuando se cumpla todo.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba lo que se ve desde fuera:
    - lo que responde la puerta a cada petición, con su código;
    - lo que hace o deja de hacer una acción de `probe` o una operación de la plataforma;
    - lo que se lee del registro de acciones y de las pendientes;
    - lo que se ve al migrar, al reabrir la plataforma y tras restaurar.

    No comprueba sentencias SQL, columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla, y cada variante que esta spec permite tiene su prueba.

- **Costura 1, la principal: `createTestPlatform` con `probe`, su puerta y `browser()`.**
    - La puerta: `Authorization` con `Bearer` y con otro esquema, y la cabecera del mandato, cada una sola y junto a la cookie de `browser()`, en una acción de `probe`, en una operación de la plataforma y en `status`, dan `UNAUTHORIZED`; las rutas de archivos y el canal en directo, con su formato de error; sin esas cabeceras, `status` responde sin app.
    - El aparato compartido: la cuenta `device`, con el área abierta por el admin, no lee un área de `probe` que declara `confirmOnSharedDevice`, y un miembro sí la lee en su propio aparato.
    - Las obligaciones vía el agente, sobre `test.context(account, { via })` y `test.member(id, { via })`, por el camino de las acciones, sin HTTP: la delegación en «no», «sí» y «pedir confirmación»; un área sin fila; la delegación que nunca supera el permiso; una acción `manage` que no se completa; un comprobante que no cuenta; la misma clave de idempotencia desde la persona y vía el agente; `log/read` y `log/undo` dentro de la delegación, y `log/undo` tras retirarla; `via` en el registro; cada otra operación de la plataforma, también una desconocida, denegada; y confirmar y rechazar denegados, también con el canal `app`.
    - Cuando la persona confirma: la pendiente nace con el contexto sintético con `via` y la persona la confirma con `browser()` por HTTP, desde otra sesión suya, y conserva la delegación de entonces. Es la forma de `confirmations.test.ts`.
    - Salen de `test-utils` y de `@domus/platform/testing` `test.mandate`, `test.prepare.key`, `test.keys`, `test.revokeKey` y la opción `apps`.
- **Costura 2: una base anterior a la 1f, preparada dentro de las pruebas.**
    - La base sigue siendo anterior hasta que se copia: se prepara con el ejecutor de migraciones aplicando las de la plataforma y las de `probe` solo hasta las de la 1e, sin abrir `createTestPlatform`, que aplicaría las actuales.
    - La actualización: sobre esa base, una pendiente ordinaria y una «solo por `contexto`»; tras aplicar las actuales, la ordinaria sigue con su caducidad, la otra ya no está, y el esquema es el mismo que en una instalación limpia. Es la forma de «una base de la fase 1b» en `platform-migrations.test.ts`.
    - Restaurar: esa base, con notas de `probe`, se cierra y se copia con restic real en el formato que espera restaurar; después `restoreBackup` la restaura con el código actual, la plataforma se abre, la migración nueva está aplicada y las notas siguen. No se añade a la plataforma de pruebas una opción para arrancar con migraciones a medias; si hace falta una ayuda, prepara el fichero y vive en las pruebas.
- **Costura 3: las comprobaciones del repositorio, con su forma de siempre.**
    - `architecture.test.ts` prueba que salta cada regla que queda.
    - `gitleaks.test.ts`, con el ejecutable real: la configuración carga y una muestra genérica activa una regla por defecto, comprobando que de verdad la caza.
    - `compose-ci.test.ts` y el bundle de `api` siguen con solo `api`.
    - La web compilada se comprueba en las pruebas de `apps/api`, porque la puerta de pruebas no sirve esos archivos.
- **Lo que se borra.** Las pruebas que solo prueban el mecanismo: las llaves en la puerta, el comando `keys`, la lectura de la llave y del mandato, la muerte del mandato, restaurar con llaves, el barrido de los mandatos, los casos de mandatos y apps de la plataforma, las de los dos programas y las de `utils/connection`. Se borran después de llevar a la costura 1 los casos que describen obligaciones que siguen.
- **Prior art:**
    - el contexto sintético con `via` de `delegation`, `log`, `idempotency`, `proofs`, `writes`, `undo` y `audit` en `probe`, y de «decide via Kira» en la autorización;
    - la falsificación por HTTP de la 1c, que prueba que la puerta ignora las cabeceras declaradas;
    - «una base de la fase 1b» en `platform-migrations.test.ts`;
    - `restoreBackup` y las pruebas de restaurar con restic real de la 1d2, también la de una copia antigua;
    - las pruebas de gitleaks y de las reglas de dependencias de la 1e y de la fase 0.

## Fuera de alcance

- El perfil OAuth de MCP, el enlace del agente, el mandato de la conversación alojada y la confirmación siempre en Domus: fase 5 (ADR 0032).
- La regla de la salud vía el agente: fase 5.
- Un nombre o un mecanismo nuevo de «vía agente», y cambiar el valor `kira` de `via`: fase 5.
- Cambiar la regla de creación de la delegación, que copia el acceso sin `manage`: fase 5.
- Las demás oportunidades de la revisión de la arquitectura: el resultado de una escritura por HTTP frente al tipo de `api-client` (grilling de la fase 3), la visibilidad al leer, la limpieza que conoce las tablas de otras áreas y las pruebas de la plataforma dentro de `probe`.
- Borrar `ui` e `i18n`, que llena la fase 2.

## Notas

- El ADR 0034, sus enlaces de vuelta, el README de arquitectura, el glosario y el plan ya están al día en la rama del grilling, con lo que sale marcado como «sale en la 1f». La 1f los deja como vigentes.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling: que el canal se queda con un solo valor; que las garantías del canal `contexto` pasan a `via` dentro de la decisión; que la lista de operaciones de la plataforma que admite `via` pasa de la puerta a la autorización; que `PROTOCOL` no sube; y que la migración borra las pendientes «solo por `contexto`» antes de quitar sus columnas. Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.
- Los `AGENTS.md` y `docs/agents/packages.md` cambian en el mismo ticket que retira lo que describen; el último ticket completa la guía, `despliegue.md` y el estado del plan tras comprobar la Pi y la copia de la noche.
- La 1f no espera a la 1d3 ni a la 1d4, pero no puede solaparse con un cambio incompatible en sus migraciones o en el despliegue. Al empezar, se comprueba en el plan si alguna sigue abierta.

## Tareas

| Tarea                                                                 | Qué                                                       | Bloqueada por |
| --------------------------------------------------------------------- | --------------------------------------------------------- | ------------- |
| [01](issues/01-las-garantias-via-el-agente-en-la-autorizacion.md)     | Las garantías vía el agente, en la autorización           | —             |
| [02](issues/02-retirar-assistant-voice-gateway-y-utils-connection.md) | Retirar `assistant`, `voice-gateway` y `utils/connection` | —             |
| [03](issues/03-retirar-las-llaves-y-los-mandatos.md)                  | Retirar las llaves y los mandatos                         | 01, 02        |
| [04](issues/04-retirar-el-canal-contexto-y-la-identidad-voice.md)     | Retirar el canal `contexto` y la identidad `voice`        | 03            |
| [05](issues/05-la-migracion.md)                                       | La migración                                              | 03, 04        |
| [06](issues/06-la-pi-y-el-cierre.md)                                  | La Pi y el cierre                                         | 05            |
