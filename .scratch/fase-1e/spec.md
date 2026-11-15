# Fase 1e: llaves de API y mandatos

Status: ready-for-agent

Esta spec sale del grilling de la fase 1e ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-14, preguntas Q1–Q21, con las enmiendas de sus cuatro revisiones, y del acuerdo posterior sobre las costuras de prueba. Las decisiones duraderas están en el [ADR 0030](../../docs/architecture/adr/0030-llaves-y-mandatos.md), que precisa los ADR [0004](../../docs/architecture/adr/0004-una-sola-puerta.md), [0020](../../docs/architecture/adr/0020-composicion-de-la-api-y-comunicacion-entre-procesos.md), [0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md), [0028](../../docs/architecture/adr/0028-archivos.md) y [0029](../../docs/architecture/adr/0029-eventos-en-directo-y-avisos.md). Si esta spec y los ADR no coinciden, mandan los ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): app conectada, llave, mandato, vía Kira, actor, aparato, sesión, contexto verificado, tabla de delegación, confirmación pendiente, comprobante, acción, registro de acciones, clave de idempotencia, mantenimiento y restaurar.

## Problema

Después de la 1d4, Domus solo atiende a personas con una sesión de la app. Kira vive en su propio contenedor, sin datos, y lo único que puede hacer con la api es preguntar `status`, que es público. No tiene forma de autenticarse, y por tanto no puede hacer nada en nombre de nadie: ni leer la lista de la compra de Paco ni añadirle leche.

Darle una contraseña o una cookie no sirve, y dejar que diga de parte de quién habla tampoco:

- si Kira declara «soy Paco», cualquiera que obtenga su credencial actúa como Paco o como Rocío, y la regla de que nada de lo que declara el cliente vale como identidad deja de cumplirse;
- lo que Kira haga en nombre de alguien tiene que morir en cuanto esa persona cierra su sesión, cambia su contraseña o pierde el aparato, igual que muere la sesión;
- Kira nunca puede dar por buena una confirmación: un error del modelo, o una instrucción colada en un correo reenviado, confirmaría por la persona;
- Kira no puede tocar contraseñas, sesiones, permisos ni delegación, ni siquiera con la delegación abierta;
- la credencial de Kira hay que poder cambiarla sin dejar a la casa sin Kira, y revocarla al momento si se escapa, sin que viva nunca en el repositorio, que es público;
- si la llave falta o está mal, `assistant` tiene que notarlo al arrancar, no en el primer «añade leche».

## Solución

`platform` gana las **apps conectadas**: una lista fija en el código, que en la 1e solo contiene a `kira`. Cada app se autentica con su **llave**, `domus_<id>.<secreto>`, que viaja en `Authorization: Bearer`. La base guarda solo su hash. Las llaves se crean, se listan y se revocan con un comando nuevo, `keys`, en el contenedor `api`, nunca con acciones. `assistant` lee la suya de un secreto de Docker.

La llave dice qué app es. De parte de quién lo dice un **mandato**: una fila que la puerta emite, a partir de una interacción que ella autenticó, para una sola app. El mandato guarda el contexto verificado de esa interacción, caduca a los 15 minutos y muere en cuanto termina la sesión de la que nació. Viaja en la cabecera `domus-mandate`. Con llave y mandato, la puerta sella un contexto con la cuenta representada, `via = "kira"` y el canal `contexto`, y lo pasa al único camino de las acciones, donde la tabla de delegación de esa persona decide qué puede hacer Kira.

En la 1e no hay turnos de conversación, así que ninguna ruta, comando ni servicio de producción emite mandatos. Solo los crean las pruebas, por el mismo mecanismo que usará la plataforma en la 5a. Un mandato abre las acciones de los módulos y dos operaciones de la plataforma, `log/read` y `log/undo`. Todo lo demás lo rechaza, y en particular `confirmations/confirm`: el «sí» por `contexto` lo reconocerá la puerta en la 5a, nunca Kira.

`status`, con una llave válida, responde además el nombre de la app. `assistant` manda su llave al comprobar la conexión, y `@domus/utils/connection` gana el estado rechazado. Sin llave, con una llave mala o con la de otra app, `assistant` no hace nada que dependa de la api, sigue vivo y vuelve a comprobar cada 30 s. Una regla de gitleaks caza una llave que se cuele en un commit.

## Historias de usuario

1. Como Kira, quiero autenticarme ante la api con mi propia llave, para que cada petición diga qué app la hace.
2. Como Kira, quiero actuar en nombre de la persona con la que hablo presentando un mandato que emite la puerta, para no tener que declarar yo quién es.
3. Como Paco, quiero que nadie que robe la llave de Kira pueda actuar como yo eligiendo mi cuenta, para que la llave sola no sirva para suplantar a nadie.
4. Como Paco, quiero que lo que Kira hace por mí siga mi tabla de delegación, para que Kira nunca pueda más de lo que le dejo.
5. Como Rocío, quiero que un área que no he abierto a Kira le quede cerrada, también la de un módulo nuevo, para no tener que acordarme de cerrarla.
6. Como Paco, quiero que lo que Kira hace por mí nunca supere mis propios permisos, aunque mi delegación diga «sí», para que la delegación solo rebaje.
7. Como Paco, quiero que una acción que dejé en «pedir confirmación» para Kira se detenga en una confirmación pendiente que yo abro en la app, para decidir yo.
8. Como Paco, quiero que al confirmar en la app algo que nació vía Kira se vuelva a comprobar mi delegación de entonces, para que confirmar no me salte el filtro.
9. Como Paco, quiero que Kira no pueda confirmar por mí, ni siquiera con un mandato válido de mi conversación, para que un error del modelo o un correo malicioso no aprueben nada.
10. Como Paco, quiero que Kira no pueda rechazar en mi nombre una confirmación pendiente, para que esa decisión también sea mía.
11. Como Paco, quiero que Kira nunca cambie permisos ni delegación, ni toque contraseñas, sesiones, comprobantes o aparatos, para que lo que protege mi cuenta quede fuera de su alcance.
12. Como Paco, quiero que una acción de nivel `manage` no se pueda completar vía Kira, para que lo que pide mi contraseña solo lo haga yo en la app.
13. Como Paco, quiero que Kira no pueda cambiar los ajustes de las tareas programadas ni pedir el aviso de prueba, para que sigan siendo cosa de la app.
14. Como Rocío, quiero que Kira pueda leer las anotaciones de mis propias entradas del registro, dentro de mi delegación, para que me diga qué hice.
15. Como Rocío, quiero que Kira pueda deshacer por mí una escritura mía, dentro de mi delegación vigente, para corregir un error hablando.
16. Como Rocío, quiero que si retiro la delegación de un área, Kira ya no pueda deshacer en ella aunque la escritura fuera de antes, para que cuente la delegación de ahora.
17. Como Paco, quiero que lo que Kira escribe por mí quede en el registro con mi cuenta y «vía Kira», para saber después quién lo hizo y por quién.
18. Como Paco, quiero que el registro de acciones nunca guarde la llave ni el mandato, para que leerlo no dé credenciales.
19. Como Paco, quiero que la misma clave de idempotencia usada por mí desde la app y por Kira en mi nombre no choque, para que cada una se repita solo dentro de su camino.
20. Como Kira, quiero que repetir una escritura con la misma clave dé un acuse sin ejecutarla otra vez, también con otro mandato de la misma persona, para reintentar sin duplicar.
21. Como Paco, quiero que al cerrar mi sesión deje de valer cualquier mandato nacido de ella, en la siguiente petición, para que Kira no siga actuando por mí después.
22. Como Paco, quiero que revocar una de mis sesiones, revocar un aparato o cambiar mi contraseña invalide los mandatos afectados en la siguiente petición.
23. Como Rocío, quiero que un mandato deje de valer en cuanto caduca su sesión, aunque le queden minutos propios.
24. Como Rocío, quiero que un mandato caduque a los 15 minutos de emitirse, exactos, para que un mandato viejo no sirva mañana.
25. Como Paco, quiero que un mandato emitido para una app no lo pueda usar otra app con su propia llave.
26. Como Paco, quiero que un mandato no sirva para subir ni descargar archivos, abrir el canal en directo ni registrar suscripciones a avisos, hasta que se decida cómo.
27. Como Paco, quiero que una petición con mi cookie de sesión y una llave a la vez se rechace, para que nunca haya un contexto mezclado.
28. Como Paco, quiero que una llave mala nunca se trate como si no hubiera credencial, ni siquiera en `status`, para que fallar al autenticarse no dé acceso anónimo.
29. Como Paco, quiero que una llave desconocida, revocada, mal formada o con el secreto equivocado reciba la misma respuesta, para que la respuesta no dé pistas.
30. Como Paco, quiero que una llave válida sin mandato no pueda llamar a ninguna acción, para que la llave sola no actúe por nadie.
31. Como admin que opera la Pi, quiero crear la llave de Kira con un comando en el contenedor `api` que la escriba solo en stdout, para redirigirla al fichero del secreto sin que pase por la pantalla.
32. Como admin, quiero que el comando rechace crear la llave de una app que no existe, para no repartir llaves sin dueño.
33. Como admin, quiero listar las llaves con su app, cuándo se crearon, su último uso y si están revocadas, sin ver nunca el secreto, para saber cuál usa Kira.
34. Como admin, quiero revocar una llave al momento si se escapa, para que la siguiente petición con ella falle.
35. Como admin, quiero tener dos llaves vivas de Kira durante una rotación, para cambiarla sin dejar a la casa sin Kira.
36. Como admin, quiero ver el último uso de la llave nueva antes de revocar la vieja, para no revocar la que Kira todavía usa.
37. Como admin, quiero que tras restaurar una copia todas las llaves queden revocadas, para que una llave que revoqué después de esa copia no vuelva a valer.
38. Como admin, quiero que las llaves sigan igual tras reiniciar y recrear `api`, para no tener que tocar Kira en cada despliegue.
39. Como admin, quiero que la base guarde solo el hash de cada llave, para que una copia de seguridad no contenga llaves utilizables.
40. Como Kira, quiero saber al arrancar si la api acepta mi llave, para no fallar en la primera petición de una persona.
41. Como admin, quiero que `assistant` quede en rechazado sin su llave, con una llave mala o con la de otra app, sin caerse, para que su `/health` siga respondiendo y el log diga qué pasa.
42. Como admin, quiero que `assistant` pase de rechazado a listo en cuanto corrijo el secreto y lo recreo, para recuperarlo sin más pasos.
43. Como Paco, quiero que una llave colada por error en un commit la detenga gitleaks antes de llegar al repositorio público.
44. Como persona que desarrolla, quiero crear una llave de Kira en local con `pnpm keys` y guardarla en `data/`, para que `pnpm dev` arranque `assistant` con ella.
45. Como persona que desarrolla, quiero probar Kira con el mismo cliente de `assistant` contra la puerta en proceso y un mandato de prueba, para que lo que pruebo sea lo que corre.
46. Como persona que desarrolla, quiero que ningún código de producción pueda crear un mandato, para que la 1e no deje una vía de suplantación abierta hasta la 5a.

## Decisiones de implementación

### Dónde vive (estructura)

- **`platform/identity`** gana las apps conectadas, sus llaves y los mandatos, junto a las sesiones, porque son credenciales: la lista de apps, crear, listar y revocar llaves, comprobar una llave, y leer y resolver un mandato en una petición. Emitir un mandato vive en la 1e en `platform/testing` (`testing/mandates.ts`), no en `identity`: así la regla `production-never-reaches-platform-testing`, sin cambiar, prueba que ningún código de producción llega a emitirlo. La 5a lo lleva a `identity` cuando la puerta emita mandatos de interacciones reales. Gana también el núcleo del comando, como el de `accounts`: `parseKeysArguments` y `runKeys`, con su texto de uso.
- **La puerta** (`platform/http`) construye el contexto verificado de una petición con llave en el mismo sitio donde hoy lo construye a partir de una sesión, y aplica la frontera de cada ruta: qué autoridad admite.
- **`platform/authorization`** gana una función pura con la lista de operaciones de la plataforma que admiten un mandato. Lo que no está en esa lista, también una operación desconocida, no lo admite.
- **`platform/background`**: la limpieza gana un paso para los mandatos.
- **`platform/backups`**: al restaurar, el saneamiento borra los mandatos y revoca las llaves.
- **`@domus/platform/contracts`**: `status` gana `app` opcional en su salida. No sube `PROTOCOL`, porque un campo opcional nuevo no rompe a nadie.
- **`@domus/utils/connection`**: el resultado de una comprobación puede ser también `rejected`, y el estado `rejected` se suma a `connecting`, `ready` e `incompatible`.
- **`apps/api`**: un fichero de cableado nuevo para `keys`, como `accounts.ts`, y una tercera entrada en el bundle, `keys.mjs`.
- **`apps/assistant`**: su configuración lee la ruta del fichero de la llave y el fichero, una sola vez al arrancar; su comprobación de la api manda la llave y exige ver su propio nombre de app.
- **`module-sdk`** no cambia: el manejador sigue recibiendo solo el actor, que ya lleva `via`.
- **`api-client`** no cambia: el transporte ya admite cabeceras, también como función.

### Apps conectadas (Q2, Q8, Q15)

- Una lista fija en el código de la plataforma. Cada app tiene un nombre (el valor de `via`) y si puede recibir mandatos. En producción solo hay `kira`, que puede.
- La plataforma de pruebas puede añadir apps de prueba, que nunca reciben mandatos, para probar la llave de otra app. No existen fuera de `test-utils`.
- Ser una app conectada no da permisos. No hay techo de permisos por app ni marcas por acción.

### Llaves (Q3, Q12)

- Forma: `domus_<id>.<secreto>`. El id es aleatorio, de 8 bytes en base64url (11 caracteres), y es público. El secreto son 32 bytes aleatorios en base64url (43 caracteres, sin relleno). Leer la cabecera es una función pura: con cualquier otra forma, la llave es mala.
- Tabla nueva de la plataforma, con su migración generada por `drizzle-kit`. Por llave guarda el id (clave), la app, el SHA-256 del secreto, cuándo se creó, su último uso y cuándo se revocó. Nunca el secreto ni la llave entera.
- Comprobar una llave: se busca por id, se compara el hash del secreto en tiempo constante y se exige que no esté revocada y que su app exista. Una llave mal formada, desconocida, revocada o con el secreto equivocado son el mismo fallo para quien llama. El motivo solo va al log de quien opera, nunca con el valor de la llave.
- El último uso se anota con el reloj de la plataforma, como mucho una vez por minuto por llave, fuera de la transacción de la acción, para no escribir en cada petición.
- No caducan. Puede haber varias vivas por app.

### El comando `keys` (Q3, Q12)

- `keys create <app>`: crea una llave de una app de la lista y escribe en stdout la llave sola, con un salto de línea y nada más. Una app fuera de la lista se rechaza.
- `keys list`: una línea por llave, con su id, su app, cuándo se creó, su último uso (o ninguno) y cuándo se revocó (o viva). Nunca el secreto.
- `keys revoke <id>`: revoca esa llave en el momento, sin borrar su fila. Un id desconocido es un error. Revocar una ya revocada no cambia nada y lo dice.
- Los errores y los mensajes van a stderr, con los códigos de salida de `accounts`: 0 bien, 1 rechazado, 2 uso incorrecto. Nunca aparece un secreto en stderr ni en stdout, salvo la llave recién creada.
- No pide nada por el terminal, así que no exige TTY. Abre la plataforma como `accounts`, con el cerrojo compartido.
- En el contenedor es `node /app/keys.mjs`, y en desarrollo `pnpm keys`, que debe dejar stdout igual de limpio.
- Detalles que fijó la tarea 01:
    - `create` dice en stderr qué llave creó, por su id, para que quien redirige stdout sepa que salió bien.
    - Una línea de `list` es `<id>  <app>  created <instante>  last used <instante>` (o `never used`) `  live` (o `revoked <instante>`), con los instantes en ISO 8601 UTC. Sin llaves, stdout queda vacío y stderr dice `no keys`.
    - `revoke` de una llave ya revocada sale con 0: no es un error, conserva el instante de entonces y lo dice en stderr.
    - Los argumentos se validan por su forma antes de abrir la plataforma, con el código 2: `revoke` pide un id de 11 caracteres en base64url, así que una llave entera pegada por error se rechaza sin repetirla. El nombre de una app solo se repite en un error si tiene forma de nombre (minúsculas, cifras y guiones, hasta 32 caracteres), que ni una llave ni su secreto tienen.
    - `create` con una app fuera de la lista es un rechazo (1), no un uso incorrecto (2), porque la lista es de la plataforma.

### Mandatos (Q1, Q5, Q6, Q15, Q18)

- Tabla nueva de la plataforma, en su propia migración, generada después de la de las llaves. Por mandato guarda el SHA-256 de su id (clave), la app, la cuenta representada, el aparato, la sesión, la cuenta del aparato, cómo se acreditó la identidad, la conversación (vacía en la 1e), cuándo se emitió y cuándo caduca. Son las columnas del contexto verificado, como en la confirmación pendiente.
- El id de un mandato son 32 bytes aleatorios en base64url. Solo existe en la respuesta de quien lo emite.
- Emitir es una función de `platform/identity` que recibe la sesión de origen y la app. Toma de la sesión la cuenta, el aparato, la cuenta del aparato y `identity`, sin que quien emite pueda cambiarlos. Rechaza una app que no recibe mandatos y una sesión que no vive. En la 1e solo la expone `@domus/platform/testing`.
- Su vida es de 15 minutos por defecto, ajustable en las opciones de la plataforma, como las ventanas de confirmación. Desde el instante exacto `now >= expiresAt` ya no vale.
- Resolverlo en una petición: se busca por el hash de su id y se exige que no haya caducado, que su app sea la de la llave y que su sesión viva según la regla única de la plataforma (la fila existe, es de la cuenta y no ha caducado en el reloj de la plataforma). Esa regla ya cubre cerrar sesión, revocarla, revocar el aparato, cambiar la contraseña con la app o con `pnpm accounts`, que caduque y restaurar. Cualquier fallo responde lo mismo que no traerlo.
- El contexto sellado tiene la cuenta, `via` (la app de la llave), el aparato, la sesión, la cuenta del aparato, el canal `contexto`, la `identity` y la conversación del mandato.
- El mandato no da permisos: cada petición recorre la autorización completa.
- Detalles que fijó la tarea 03:
    - Emitir es `issueMandate` de `platform/testing`, no de `identity`, por la razón de «Dónde vive». Toma de la sesión los mismos campos que la puerta sella de ella (`originOf` de `identity/sessions.ts`, la única forma de ese paso): la cuenta, el aparato, la sesión, la cuenta del aparato igual a la cuenta e `identity: "password"`. Una app fuera de la lista o que no recibe mandatos falla con `connected app "<app>" receives no mandates`, y una sesión que no vive en el reloj de la plataforma con `the session of a mandate must live`.
    - La opción de la plataforma es `mandateLife`, en milisegundos y entera positiva, como `retention`; `test-utils` la pasa con el mismo nombre. Cada mandato guarda su instante de caducidad al nacer.
    - La tabla es `platform_mandates`, en la migración `0016`, con la cuenta atada a `platform_user` en cascada y la sesión sin clave foránea: terminar una sesión no borra sus mandatos, que dejan de resolver por la regla única y los borra la limpieza (04).
    - Leer `domus-mandate` (`readMandate`, pura): exactamente 43 caracteres base64url que sean la codificación exacta de 32 bytes, con los espacios alrededor ignorados. Cualquier otra forma, también vacía, es un mandato malo, nunca ninguno.
    - Una llave buena sin mandato, con uno malo o con uno que no resuelve es un contexto nulo, y la acción responde `UNAUTHORIZED` como sin credencial. El log de quien opera dice `mandate refused: <motivo>`, con `missing`, `malformed`, `unknown`, `expired`, `other-app` o `session-ended`, nunca el mandato. El orden de la comprobación es ese: existe, no ha caducado, es de la app de la llave, su sesión vive.
    - Solo las acciones de los módulos piden a la puerta el contexto con mandato; todas las demás rutas siguen pidiendo el de la sesión, que con `Authorization` es nulo, hasta la 05.

### La puerta (Q4, Q9, Q11, Q14)

- La llave llega en `Authorization: Bearer` y el mandato en `domus-mandate`. Si llega `Authorization` con otro esquema o sin valor, es una llave mala.
- Si una petición trae a la vez una llave y la cookie de sesión de Better Auth, se rechaza con `UNAUTHORIZED`. La cookie del aparato y cualquier otra no cuentan.
- Un mandato sin llave, `domus-mandate` sin `Authorization`, se rechaza con `UNAUTHORIZED` en todas las rutas, `status` y las de Hono y Better Auth incluidas, también junto a una sesión viva: una credencial que no se resuelve nunca cae a otra, ni al anonimato ni a la sesión. El log de quien opera dice `mandate refused: without-key`. Lo fijó la revisión de la fase.
- Cada ruta declara qué autoridad admite:
    - `status`: sin credencial es público. Con una llave válida responde además `app`. Con una llave mala, `UNAUTHORIZED`. Un mandato junto a la llave aquí no cuenta; sin ella, se rechaza.
    - Las acciones de los módulos (`<módulo>/<acción>`): con sesión, como hoy, o con llave y mandato.
    - `log/read` y `log/undo`: con sesión o con llave y mandato.
    - Todas las demás operaciones de la plataforma, también una que se añada mañana, solo con sesión. Eso incluye `confirmations/confirm` y `/reject`, `delegation/read`, contraseña, sesiones, comprobantes, permisos, delegación, aparatos, tareas y el aviso de prueba.
    - Las rutas de Hono (subir y descargar archivos, el canal en directo, la clave VAPID y las suscripciones) y las de Better Auth (iniciar y cerrar sesión): una petición con llave, o con un mandato, responde `UNAUTHORIZED`, con el formato de errores que ya usa cada una.
- Llave válida sin mandato, o con un mandato que no resuelve, en una ruta que pide cuenta: `UNAUTHORIZED`. Llave y mandato válidos que la autorización niega: `FORBIDDEN`. Un registro privado ajeno: `NOT_FOUND`, como en cualquier llamada.
- Ni los valores de `Authorization` ni los de `domus-mandate` aparecen en mensajes de error ni en logs.
- Detalles que fijó la tarea 02:
    - Leer la cabecera (`readAuthorization` de `identity/keys.ts`): el esquema `Bearer` en cualquier combinación de mayúsculas, uno o más espacios y una sola llave de la forma acordada; los espacios alrededor no cuentan, como en HTTP. Un tabulador en lugar del espacio es otro esquema, y dos valores, también unidos por una coma, son una forma mala.
    - La cookie de sesión es la que reconoce Better Auth (`getSessionCookie`: `better-auth.session_token`, también con el prefijo `__Secure-`). Una vacía no cuenta.
    - El log de quien opera es la opción `log` de la puerta, `console.warn` si no se da, con una línea `key refused: <motivo>`: `empty`, `scheme`, `malformed`, `unknown`, `wrong-secret`, `revoked`, `unknown-app` o `session-cookie`. `test-utils` lo calla, porque sus pruebas mandan llaves malas a propósito; la prueba de los motivos está en la puerta de `platform`.
    - Las rutas que no admiten llave la rechazan por traer `Authorization`, sin comprobarla: no anotan su último uso ni dejan motivo en el log. Solo `status` comprueba la llave en la 02; la 03 lo hace también en las rutas que admiten un mandato.
    - Iniciar y cerrar sesión con llave lo rechaza Better Auth con su propio error, un 401 `{ code: "UNAUTHORIZED", message }`, desde un `before` de sus hooks.
    - El último uso se reescribe cuando ha pasado un minuto o más desde el anotado: a los 59 999 ms no, al minuto justo sí.
- Detalles que fijó la tarea 05:
    - La lista es `admitsMandate` de `authorization/mandates.ts`, que recibe la ruta `<grupo>/<nombre>` con que la puerta sirve cada operación (`log/read`, `log/undo`). Cualquier otro texto, también otra forma de escribir una de las dos (`log.read`, `/log/read`, `Log/read`), no la admite.
    - La puerta la aplica en el único paso por el que cada operación de la plataforma pide su contexto, con la ruta que oRPC da al manejador del procedimiento al que encaminó la petición, nunca con la que escribió el cliente. Así una operación nueva escrita con ese paso nace cerrada a los mandatos sin tocar nada más. La 03 decía pasar `{ mandate: true }` en esos dos manejadores; se eligió esto para que lo decida solo la lista.
    - La prueba de las superficies cerradas recorre el contrato de la plataforma: una operación nueva la rompe hasta que se pone entre las cerradas o se añade a la lista.

### Autorización vía Kira (Q8, Q13, Q14)

- No cambia la decisión. Con `via`, ya se aplica la delegación por área y nivel, y un área sin fila deniega. Una operación sensible pide una identidad acreditada por contraseña y un comprobante, y vía Kira cambiar acceso o delegación se deniega siempre.
- Una acción `manage` vía Kira con `identity: password` llega a pedir comprobante, pero `proofs/request` no admite mandatos y un comprobante solo cuenta por el canal `app`, así que no se completa: ni con uno que la persona pidió en la app desde la misma sesión del mandato.
- Una pendiente creada vía Kira guarda el contexto con el canal `contexto` y la delegación de entonces. Se confirma por la app desde cualquier sesión de la misma persona, durante sus 24 h, como cualquier otra. Por `contexto` no hay forma de confirmarla en la 1e.
- La clave de idempotencia sigue siendo única por cuenta y `via`.
- Vía Kira, `log/read` pide la delegación del área `platform` en `read`, porque leer el registro es una lectura de esa área, y `log/undo` la de la inversa, con el área y el nivel de la acción que deshace y la delegación del momento de deshacer, no la de la escritura. Las dos ya lo hacían en el camino de las acciones; la 05 solo les abre la puerta.

### `status` y la conexión de `assistant` (Q11, Q16)

- `CheckResult` gana `rejected`. El estado rechazado no ejecuta nada que dependa de la api y vuelve a comprobar cada 30 s, como incompatible, y sale de ahí en cuanto la comprobación cambia. El proceso sigue vivo y su `/health` no cambia.
- La comprobación de `assistant` manda su llave en `status`. Es `ready` solo si el protocolo coincide y la respuesta trae `app: "kira"`. Si `status` responde bien sin `app` o con otra app, o responde `UNAUTHORIZED`, es `rejected`. Un protocolo distinto es `incompatible` aunque la llave sea buena.
- La configuración de `assistant` lee `DOMUS_API_KEY_FILE`, por defecto `/run/secrets/kira-key`. Lee el fichero al arrancar. Si falta, está vacío o no se puede leer, arranca sin llave, y la comprobación lo deja en rechazado con un mensaje que lo dice. El log nunca imprime la llave.
- Compose monta en `assistant` el secreto `kira-key` desde el fichero del host que dice `DOMUS_KIRA_KEY`, que es obligatorio como `DOMUS_BACKUP_PASSWORD`. En la Pi es `/home/fvena/.config/domus/kira-key`. La CI de contenedores usa un fichero vacío.
- En desarrollo, `.env.local.example` apunta `DOMUS_API_KEY_FILE` a `data/kira-key` y dice cómo crearla con `pnpm keys create kira > data/kira-key`.
- Detalles que fijó la tarea 06:
    - `assistant` tiene un solo cliente, `apiClient(contrato, acceso, mandato?)` de `src/api.ts`: pone la llave en `Authorization: Bearer` y, si se le da, el mandato en `domus-mandate`. `checkApi` lo usa, y lo usarán las llamadas de la 5a. `api-client` no cambia.
    - El fichero de la llave se lee sin los espacios ni el salto de línea de los extremos, porque `keys create kira > fichero` deja uno al final. Un fichero que es una carpeta cuenta como uno que no se puede leer.
    - En `pnpm dev`, `apps/assistant/src/dev.ts` resuelve un `DOMUS_API_KEY_FILE` relativo desde la raíz del repositorio, donde lo escribe `pnpm keys create kira > data/kira-key`, como `dev-env` de `api` hace con `data`. En Docker se usa el valor por defecto.
    - El log de rechazado nombra el fichero y dice si no había llave o si la api no acepta la que hay, y que hay que arrancar `assistant` otra vez (en Docker, recrear el contenedor). Nunca repite la llave.
    - La CI de contenedores crea el fichero vacío con permisos 600 y dueño 1000, como el de la contraseña de las copias.

### Limpieza (Q5, Q18)

- La limpieza diaria borra, por lotes en su propia transacción, los mandatos caducados y los de una sesión que ya no vive. Nunca cambia una respuesta: un mandato que ya no resuelve sigue sin resolver cuando se borra su fila.
- Detalles que fijó la tarea 04: un mandato caduca para la limpieza con la misma regla que al resolverlo, desde `expiresAt <= now`, y su sesión vive por `sessionLivesWhere`, la regla única. La tabla de mandatos no gana índices: guarda unos minutos de mandatos, y la limpieza corre una vez al día.

### Restaurar

- El saneamiento de la copia ya cierra todas las sesiones, y con eso los mandatos dejan de valer. Además borra sus filas, y revoca todas las llaves con el instante de la restauración. Una llave revocada después de la copia volvería a valer, igual que una sesión revocada, que es por lo que restaurar ya cierra todas las sesiones (ADR 0026). Tras restaurar, el admin crea una llave nueva para Kira. `despliegue.md` lo añade a los pasos de restaurar.
- Esta decisión no se tomó en el grilling: sale de la regla del ADR 0026, y se añade al ADR 0030 en la misma rama que esta spec.
- Detalles que fijó la tarea 04: el saneamiento revoca las llaves vivas de la copia con el instante de restaurar; una que ya venía revocada conserva su instante, como `keys revoke` de una ya revocada. Lo hace en la misma transacción que cierra las sesiones.

### Gitleaks (Q12)

- `.gitleaks.toml` en la raíz extiende la configuración por defecto con una regla para `domus_<id>.<secreto>`. La usan el hook de pre-commit y la CI, que ya leen la configuración de la raíz del repositorio.
- No hay ninguna llave literal en el repositorio. Las pruebas la construyen en tiempo de ejecución.
- La regla es `domus-api-key`: `domus_`, 11 caracteres base64url, un punto y 43, sin formar parte de una tira base64url más larga. Así no caza otro prefijo (`xdomus_…`, `domux_…`) ni un secreto de otra longitud, y sí una llave dentro de una línea (`DOMUS_KIRA_KEY="…"`).
- Su prueba (`tooling/scripts/gitleaks.test.ts`) usa el `gitleaks` del PATH o, si no, la imagen que fija `.githooks/pre-commit`, leída de allí para no repetir la versión. En la CI, el trabajo `unit` usa el Docker del runner. La exige la propia prueba, no un `globalSetup`: solo un archivo la necesita.

### La comprobación en la Pi (Q20)

En el Domus real, sin `probe`, ejecutada por ssh, porque aquí nadie teclea una contraseña:

1. Crear `~/.config/domus/kira-key` vacío, con `umask 077` y la carpeta en `700`, y apuntar `DOMUS_KIRA_KEY` a él. `assistant` queda en rechazado.
2. `docker compose exec -T api node /app/keys.mjs create kira > ~/.config/domus/kira-key.new`, comprobando el código de salida y la forma, y `mv` sobre `kira-key`. Recrear `assistant`: queda listo.
3. `status` con una llave inventada responde 401.
4. Rotación: llave nueva a `.new`, copiar la vieja a `.old`, `mv`, `docker compose up -d --force-recreate assistant`, comprobar listo y el último uso de la nueva en `keys list`, revocar la vieja y borrar `.old`. La vieja responde 401.
5. Segunda rotación con un fallo simulado, una llave inventada en lugar de la nueva: `assistant` queda en rechazado. Se vuelve a `.old`, se recrea `assistant` y queda listo.
6. `keys list` muestra la revocada y el último uso.
7. Tras reiniciar y recrear `api`, la llave sigue valiendo.

### Reglas y documentación

- Las reglas de dependencias no cambian: `assistant` sigue sin importar nada de `platform` salvo sus contratos, y emitir mandatos vive solo en lo que alcanza `@domus/platform/testing`.
- Al cerrar: `despliegue.md` (la llave de Kira, la rotación, el paso tras restaurar), el `AGENTS.md` de `packages` y el de `apps`, y la guía (`docs/guia/`), donde las llaves y los mandatos entran en su tema de cuentas o de seguridad.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba lo que se ve desde fuera:
    - lo que responde la puerta a cada petición, con su código;
    - lo que hace o deja de hacer una acción de `probe`;
    - lo que se lee del registro de acciones (`log()`) y de las pendientes;
    - lo que imprime el comando por stdout y por stderr, con su código de salida;
    - el estado de la conexión;
    - lo que se ve al reabrir la plataforma o tras restaurar.

    No comprueba sentencias SQL, columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla, y cada variante que esta spec permite tiene su prueba.

- **Costura 1, la principal: `createTestPlatform` con `probe`, su puerta y `browser()`.**
    - `test.prepare.key(app)` crea una llave real con la misma función de la plataforma que usa el comando, y devuelve la llave entera.
    - `test.mandate(browser, { app?, conversation? })` emite un mandato real por la función de emisión de la plataforma, que solo alcanza `testing`. Nace de la sesión de ese `browser()` y hereda su cuenta, su aparato, su cuenta del aparato y su `identity`, sin poder cambiarlos. Pasa por la misma tabla, el mismo hash y la misma caducidad que usará la 5a. Si una prueba necesita un contexto imposible, como otra identidad, usa los contextos sintéticos que ya existen sobre el camino de las acciones, nunca un mandato.
    - Las llamadas de Kira usan el mismo `clientFor` y el mismo transporte que `assistant`, con `Authorization` y `domus-mandate`, y `fetch` igual al de la puerta. No pasan por `browser()`, así que no llevan su cookie. La cookie mezclada se prueba aparte, a propósito.
    - Opción nueva, `apps`: apps de prueba que nunca reciben mandatos, para la llave de otra app. Un nombre repetido, también `kira`, no abre la plataforma.
    - Para ver y cambiar las llaves sin el comando, como con las sesiones: `test.keys()`, lo que muestra `keys list`, y `test.revokeKey(id)`, que revoca como `keys revoke`. `test-utils` exporta también `PROTOCOL`.
    - Con el reloj de pruebas se prueban la caducidad del mandato en el instante exacto, la de su sesión, el último uso por minuto y la limpieza. Con `restoreBackup` y reabriendo sobre fichero, restaurar y reiniciar.
- **Costura 2: el núcleo de `keys`**, con un terminal de prueba que anota stdout y stderr:
    - `create` (una app de la lista, una desconocida, sin argumentos);
    - `list` (vacía, con llaves vivas y revocadas, y que nunca lleva un secreto);
    - `revoke` (viva, ya revocada, desconocida);
    - stdout con solo la llave en `create`, y sin secretos en ningún error.

    Que `create` guarda solo el hash se comprueba por fuera: la llave funciona, y ni `list` ni el fichero de la base, con su WAL, contienen el secreto. La prueba del bundle de `api` gana `keys.mjs`: arranca, se para en su configuración y, ante un fallo, no escribe nada en stdout.

- **Costura 3: `@domus/utils/connection` y `checkApi`.**
    - Las pruebas con respuestas programadas ganan `rejected`: se queda y vuelve a comprobar cada 30 s, y pasa de `rejected` a `ready` cuando cambia la respuesta, sin reiniciar la comprobación.
    - El `checkApi` de `assistant` contra la puerta en proceso: sin llave, con una llave mala, con la de otra app y con la suya. Nunca da `ready` cuando `status` responde bien sin acreditar a `kira`.
    - La configuración de `assistant`: fichero ausente, vacío y con llave.
    - El criterio del ADR 0020 vive en `tooling/scripts/assistant-acts.test.ts`: el `apiClient` de `assistant` contra la plataforma de pruebas con `probe`. Las pruebas de `assistant` no pueden importar un módulo (`assistant-and-voice-gateway-only-talk-to-api`) y un módulo no puede importar una app (`nothing-imports-an-app`); `tooling` ya compone módulos reales y las reglas no cambian.
- **Costura 4: la regla de gitleaks con el ejecutable real.** Una prueba de `tooling/scripts` escribe en una carpeta temporal, fuera del repositorio, una llave de muestra válida y una cadena parecida que no lo es. Ejecuta `gitleaks dir` con la configuración del repositorio, comprueba que caza solo la primera y borra la carpeta. Usa el `gitleaks` del PATH o la imagen de Docker fijada del hook. Sin ninguno de los dos, falla con un mensaje que dice cómo instalarlo, como hace restic.
- **Costura 5: funciones puras de `platform`.** Leer la cabecera de la llave (cada forma mala, `Bearer` con otro esquema, espacios, longitudes), leer el mandato, y la lista de operaciones de la plataforma que admiten un mandato, incluida una desconocida, que no lo admite. La frontera se prueba además por la puerta, en la costura 1.
- **Con `probe` sobre la costura 1:**
    - llave: ausente, mal formada, desconocida, revocada, con un id válido y el secreto equivocado, de una app que se quitó de la lista; con la cookie de sesión (rechazada) y con otras cookies (aceptada); mala en `status`; buena en `status` con y sin mandato;
    - mandato: el camino positivo (una lectura y una escritura de `probe` con la delegación abierta, y su entrada en el registro con la cuenta y `via`); ausente; mal formado; desconocido; caducado en el instante exacto y un milisegundo antes; de otra app; ya usado con éxito y luego con su sesión terminada de cada una de las cinco formas, y por caducar; tras restaurar; tras reiniciar sobre fichero, que sigue valiendo;
    - autorización: la delegación en «no», «sí» y «pedir confirmación» en cada nivel; un área sin fila; la delegación nunca supera el permiso; una pendiente vía Kira confirmada por `app` desde otra sesión de la persona, que conserva la delegación de entonces; la misma pendiente confirmada con el mandato, rechazada sin consumirla; una acción `manage`; `log/read` y `log/undo` dentro de la delegación, y `log/undo` tras retirarla; la misma clave de idempotencia desde la app y vía Kira; repetir con otro mandato de la misma persona, que da un acuse;
    - superficies cerradas: cada operación de la plataforma fuera de la lista, `confirmations/confirm` y `/reject`, `delegation/read`, subir, descargar, el canal en directo, la clave VAPID, las suscripciones, y las rutas de Better Auth;
    - llaves: dos vivas de la misma app a la vez, revocar una sin tocar la otra, y el último uso que no se reescribe antes de un minuto;
    - restaurar: todas las llaves revocadas, ningún mandato vale, y una llave creada después funciona;
    - la limpieza: borra los caducados y los de sesiones terminadas, y deja los vigentes.
- **Prior art:**
    - las pruebas de la puerta con `browser()`, sesiones, comprobantes y la falsificación por HTTP de la 1c;
    - las de `accounts` (`parseAccountsArguments`, `runAccounts`) y del bundle de `api`;
    - las de la conexión de la fase 0 y el `checkApi` de `assistant`;
    - las de la limpieza y el reloj de pruebas de la 1d1;
    - `restoreBackup` de la 1d2;
    - la caducidad en `sessionLives` de la 1d4.

## Fuera de alcance

- Emitir mandatos desde interacciones reales (la app, Telegram, la voz) y sus reglas de vida sin sesión: fase 5a, y la voz en la 5c.
- Reconocer el «sí» por `contexto`, con su lista cerrada de afirmaciones, y confirmar por esa vía: fase 5a.
- Que Kira acceda a los adjuntos de sus conversaciones, y cualquier ruta de archivos para mandatos: fase 5a.
- El canal en directo y las suscripciones para apps conectadas.
- Las operaciones propias de una app sin cuenta, como pedir turnos o el catálogo de tools: fases 5a y 5b.
- Los trabajos pedidos de Kira y su relación con los mandatos: fase 5b.
- La llave de `voice-gateway`: fase 5c. Las de otras apps: con su primer consumidor.
- La delegación por app y cualquier techo de permisos por app: con la segunda app que reciba mandatos.
- Pantallas para las llaves: el comando basta.
- Caducidad de las llaves y rotación automática.
- Anotar denegaciones en el registro de acciones.

## Notas

- El ADR 0030, sus enlaces de vuelta, el README de arquitectura, el glosario y el plan ya están al día en la rama del grilling. Esta spec añade al ADR 0030 que restaurar revoca todas las llaves.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling: la longitud del id de la llave, las dos tablas, `DOMUS_API_KEY_FILE` y `DOMUS_KIRA_KEY`, arrancar sin llave cuando el fichero falta, los códigos de salida de `keys`, que `status` no sube `PROTOCOL`, la opción `apps` de la plataforma de pruebas y que restaurar revoca las llaves. Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.
- La 1d3 sigue en curso hasta comprobar la copia del 2026-11-15 y la limpieza del 2026-11-16 en la Pi. La 1e puede construirse antes, pero no se cierra antes que la 1d3 y la 1d4.

## Tareas

| Tarea                                                                  | Qué                                                         | Bloqueada por                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| [01](issues/01-llaves-y-el-comando-keys.md)                            | Llaves y el comando `keys`                                  | —                                    |
| [02](issues/02-la-llave-en-la-puerta-y-en-status.md)                   | La llave en la puerta y en `status`                         | 01                                   |
| [03](issues/03-kira-llama-a-acciones-con-un-mandato.md)                | Kira llama a acciones con un mandato                        | 02                                   |
| [04](issues/04-cuando-muere-un-mandato-limpieza-y-restaurar.md)        | Cuándo muere un mandato, la limpieza y restaurar            | 03                                   |
| [05](issues/05-operaciones-de-la-plataforma-y-superficies-cerradas.md) | Las operaciones de la plataforma y las superficies cerradas | 03                                   |
| [06](issues/06-assistant-con-su-llave.md)                              | `assistant` con su llave                                    | 02, 03                               |
| [07](issues/07-la-regla-de-gitleaks.md)                                | La regla de gitleaks                                        | —                                    |
| [08](issues/08-la-pi-y-el-cierre.md)                                   | La Pi y el cierre de la 1e                                  | todas y el cierre de la 1d3 y la 1d4 |

La 01 y la 03 generan cada una una migración de la plataforma; como la 03 espera a la 01, no se pisan. La 04 y la 05 pueden ir a la vez tras la 03. La 06 puede adelantar su conexión y su configuración tras la 02. La 07 no espera a nada y conviene hacerla antes de probar llaves a mano.
