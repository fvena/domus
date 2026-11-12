# Fase 1c: identidad y autorización

Status: ready-for-agent

Esta spec sale del grilling de la fase 1c ([`docs/plan.md`](../../docs/plan.md)) del 2026-11-12, preguntas Q1–Q32, y del acuerdo posterior sobre los puntos de prueba. Las decisiones duraderas están en el [ADR 0023](../../docs/architecture/adr/0023-identidad-y-autorizacion.md), que ya está escrito. Si esta spec y el ADR no coinciden, manda el ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): miembro, perfil, cuenta de aparato, vía Kira, actor, aparato, área, permiso, tabla de delegación, sesión, visibilidad, confirmación pendiente, comprobante, acción, registro de acciones, clave de idempotencia e inversa.

## Problema

Después de la 1b, todo cambio de datos pasa por un solo recorrido, pero en producción ese recorrido lo deniega todo: no hay identidad ni decisión real, y las acciones no se sirven por HTTP. Antes de que la casa use Domus con datos reales faltan varias cosas:

- que cada persona entre con su cuenta;
- que se sepa desde qué aparato habla;
- que cada operación se permita, se deniegue o pida confirmación según los permisos de esa persona, lo que ha delegado en Kira y la visibilidad de cada registro;
- que lo privado de una persona no llegue a la otra por ningún camino: ni una lectura, ni un reintento, ni el registro, ni deshacer, ni una pantalla compartida de la cocina.

Kira necesita además que un «sí» confirme solo la operación exacta que se preguntó, en el mismo aparato y en la misma conversación.

## Solución

La plataforma gana identidad con Better Auth (correo y contraseña, sin registro abierto) y un comando, `pnpm accounts`, para crear cuentas y cambiar contraseñas. Cada petición HTTP llega con una sesión. La sesión pertenece a un aparato, y la puerta construye con ella un contexto verificado que nadie puede sustituir.

`platform/authorization` pasa a decidir de verdad, con una función pura que combina tres cosas:

- el permiso de la cuenta por área y nivel;
- la tabla de delegación cuando la operación va vía Kira;
- la visibilidad de los registros con dueño.

Una operación sensible pide además un comprobante ligado a esa operación. Cuando la decisión es pedir confirmación, la operación se guarda como confirmación pendiente y se ejecuta solo cuando su persona dice que sí.

Al escribir, los triggers temporales comprueban que nadie se salta las reglas de dueño y visibilidad. Una escritura deja de guardar su resultado: repetirla devuelve un acuse sin contenido. Las migraciones de la plataforma pasan a generarse con `drizzle-kit`. Las acciones y las operaciones de la plataforma se sirven por HTTP con una sesión válida. Las pantallas siguen siendo de la fase 3.

## Historias de usuario

1. Como miembro, quiero entrar en Domus con mi correo y mi contraseña, para que lo que haga quede a mi nombre.
2. Como miembro, quiero que nadie pueda crearse una cuenta desde fuera, para que en Domus solo esté mi familia.
3. Como miembro, quiero cambiar mi contraseña desde la app dando la actual, para no depender de nadie.
4. Como miembro, quiero que cambiar mi contraseña cierre mis otras sesiones y anule mis confirmaciones pendientes y mis comprobantes, para que un aparato perdido deje de valer.
5. Como miembro, quiero ver y cerrar mis propias sesiones, para cortar el acceso de un aparato que ya no uso.
6. Como miembro, quiero que cerrar mi sesión en un navegador no toque la de la otra persona en ese mismo navegador, para que compartir un portátil no nos estorbe.
7. Como miembro, quiero que una sesión revocada deje de valer en la petición siguiente, para que revocar sea inmediato.
8. Como miembro, quiero que mis registros privados no los vea nadie más, tampoco el admin, para tener mi espacio.
9. Como miembro, quiero que un registro privado ajeno me responda «no encontrado», para que no se sepa ni que existe.
10. Como miembro, quiero que lo que hago público lo vea toda la casa sin que eso permita editarlo, para compartir sin perder el control.
11. Como miembro, quiero que, en un área que lo declare, lo público lo pueda editar quien tenga permiso de editar, para que las cosas de los dos (como la lista de la compra) sean de verdad de los dos.
12. Como miembro, quiero que todo lo que creo sea mío y con la visibilidad por defecto de su área, para no tener que decidirlo cada vez.
13. Como miembro, quiero que solo yo pueda cambiar la visibilidad de lo mío y que nadie pueda quedarse con un registro mío cambiando su dueño, para que lo privado siga siendo privado.
14. Como miembro, quiero que mi salud sea siempre privada, sin forma de hacerla pública, para no exponerla por un descuido.
15. Como miembro, quiero que la pantalla de la cocina no lea ni muestre mi salud salvo que yo lo pida y lo confirme allí mismo, para que no la oiga quien esté al lado.
16. Como miembro, quiero que la lectura de mi salud pedida en la cocina solo se confirme allí, por voz y dentro del minuto, y que desde mi móvil no se pueda confirmar (allí la leo directamente), para que confirmar en el móvil nunca autorice a Kira a decirla después en la cocina.
17. Como miembro, quiero decidir área por área qué puede hacer Kira por mí: no, sí o pedir confirmación, para fiarme de ella a mi ritmo.
18. Como miembro, quiero que Kira pueda leer sin preguntarme y pedirme confirmación para escribir en la misma área, para que me moleste solo cuando importa.
19. Como miembro, quiero que mi tabla de delegación sea solo mía, sin que el admin la vea ni la cambie, para que nadie decida por mí qué hace Kira en mi nombre.
20. Como miembro, quiero que Kira nunca pueda cambiar mis permisos ni mi delegación, para que no se amplíe sus propias capacidades.
21. Como miembro, quiero que mi delegación empiece con lo que puedo ver y editar, y con administrar denegado, para empezar con un punto de partida prudente.
22. Como miembro, quiero que, si gano acceso a un área, Kira no lo gane solo, para que la delegación cambie solo cuando yo la cambie.
23. Como miembro, quiero que un «sí» por voz confirme solo lo que Kira acaba de preguntarme, en el mismo aparato y en la misma conversación, para que un «sí» suelto no confirme otra cosa.
24. Como miembro, quiero que una confirmación que no respondí a tiempo por voz siga esperándome en la app, para decidirla con calma. La lectura de salud en un aparato compartido es la excepción: caduca con su ventana.
25. Como miembro, quiero que una confirmación pendiente caduque si no la decido, para que no se ejecute algo viejo por sorpresa.
26. Como miembro, quiero poder rechazar una confirmación pendiente, para decir que no explícitamente.
27. Como miembro, quiero que confirmar dos veces no ejecute dos veces, para que tocar el botón de más no duplique nada.
28. Como miembro, quiero que confirmar desde la app algo que pidió Kira siga respetando lo que delegué, para que cambiar de canal no salte el filtro.
29. Como miembro, quiero que confirmar vuelva a comprobar mis permisos, mi delegación y la visibilidad de ese momento, para que una pendiente vieja no salte un cambio posterior.
30. Como miembro, quiero que lo que exige confirmación siempre, por su definición, me pregunte una sola vez, para no confirmar dos veces lo mismo.
31. Como miembro, quiero que las operaciones sensibles me pidan la contraseña otra vez para esa operación concreta, para que una sesión abierta no baste para hacerlas.
32. Como miembro, quiero que el comprobante de una operación sensible no valga para otra, para que no se reutilice.
33. Como miembro, quiero que las operaciones sensibles no se puedan hacer por voz, para que nadie las haga desde la cocina.
34. Como miembro, quiero leer en el registro qué hice yo y qué hizo Kira por mí, sin ver el contenido de lo que ya no puedo ver, para saber qué pasó sin abrir una fuga.
35. Como miembro, quiero deshacer solo lo que hice yo, para no deshacer el trabajo de la otra persona.
36. Como miembro, quiero que repetir una operación ya hecha no me devuelva datos que ya no puedo ver, para que un reintento no se salte la visibilidad.
37. Como admin, quiero tener siempre permiso de administrar en todas las áreas sin poder quitármelo, para no dejar la casa sin nadie que la gestione.
38. Como admin, quiero cambiar los permisos de la otra persona y de la cuenta de aparato, con un comprobante, para ajustar el acceso de la casa.
39. Como admin, quiero que mis permisos no me dejen ver lo privado de la otra persona ni su delegación, para que administrar no sea espiar.
40. Como admin, quiero gestionar la delegación de la cuenta de aparato, para decidir qué hace Kira en la cocina cuando no reconoce a nadie.
41. Como admin, quiero revocar las sesiones de la cuenta de aparato, para retirar una pantalla compartida.
42. Como admin, quiero que ningún miembro pueda subirse sus propios permisos, para que el acceso lo decida una sola persona.
43. Como quien opera Domus, quiero crear las cuentas y cambiar contraseñas con un comando en el contenedor `api`, para tener un único procedimiento, también de recuperación.
44. Como quien opera Domus, quiero que el comando pida la contraseña sin aceptarla como argumento ni escribirla en ninguna salida, para que no acabe en el historial ni en los logs.
45. Como quien opera Domus, quiero que el comando revoque todas las sesiones de la cuenta al cambiar su contraseña, para recuperar el control de una cuenta comprometida.
46. Como quien opera Domus, quiero que una sesión siga valiendo tras reiniciar `api` y que la revocada siga sin valer, para que reiniciar no cambie quién está dentro.
47. Como quien opera Domus, quiero que las migraciones nuevas de la plataforma se generen y no se escriban a mano, sin tocar `0000` ni `0001`, para que la Pi actualice sin sorpresas.
48. Como quien opera Domus, quiero que nada de lo que declare el cliente (cuenta, `via`, aparato, canal ni forma de acreditar la identidad) valga como identidad, para que nadie se haga pasar por otro.
49. Como quien opera Domus, quiero que la contraseña y el comprobante no se guarden nunca en una confirmación pendiente ni en el registro, para que los secretos no se queden en la base.
50. Como quien opera Domus, quiero que una autorización que falla o lanza deniegue siempre, para que se falle cerrado.
51. Como Kira, quiero que mis operaciones se decidan con la delegación de la persona por la que hablo, para no hacer nunca más de lo que esa persona permite.
52. Como Kira, quiero recibir `CONFIRMATION_REQUIRED` con el id de la pendiente, para preguntar a la persona y confirmar con ese id.
53. Como Kira, quiero que repetir una petición que pidió confirmación me devuelva la misma pendiente, para que un reintento no cree dos preguntas.
54. Como Kira, quiero que una escritura repetida me devuelva un acuse sin contenido, para saber que ya se hizo sin recibir datos que quizá no deba ver.
55. Como Kira, quiero que la persona reconocida por voz sea quien ejecuta, conservando la cuenta con la que entró el aparato, para que la autorización sepa que está en una pantalla compartida.
56. Como quien escribe un módulo, quiero declarar en cada contrato el área y el nivel que pide, y que el arranque falle si el área no existe o si una escritura pide solo leer, para no olvidarme de autorizar.
57. Como quien escribe un módulo, quiero declarar mis áreas, su visibilidad por defecto, si lo público lo edita cualquiera con permiso de editar y si son siempre privadas, para fijar la política de mi área sin escribir lógica de autorización.
58. Como quien escribe un módulo, quiero declarar tablas con dueño con unas columnas comunes, para que la plataforma aplique y compruebe la visibilidad por mí.
59. Como quien escribe un módulo, quiero filtrar mis lecturas con un predicado que me da la autorización, también en conteos, búsquedas y joins, para no escribir reglas de visibilidad a mano.
60. Como quien escribe un módulo, quiero que una escritura que se salte las reglas de dueño o de visibilidad, o que cambie más de lo que declaró, revierta entera, para descubrir el error en las pruebas.
61. Como quien escribe un módulo, quiero declarar que una acción pide confirmación siempre, para las operaciones que lo merecen sin depender de la delegación.
62. Como quien escribe un módulo, quiero probar mis reglas con la autorización real, un contexto verificado sintético y un reloj controlado, para cubrir permisos, delegación y visibilidad sin HTTP.
63. Como quien escribe un módulo, quiero preparar en mis pruebas las cuentas, sus permisos y su delegación, para no repetir la preparación en cada prueba.
64. Como quien escribe la web, quiero llamar a las acciones por `api-client` con la sesión del navegador, para que la web no decida nada por su cuenta.

## Decisiones de implementación

### Cuentas y Better Auth (Q7, Q16, Q27, Q28)

- Better Auth vive en `platform`, con su adaptador de Drizzle sobre la base de la plataforma. Sus tablas llevan el prefijo `platform_` y entran en el esquema de la plataforma (ver «Migraciones de la plataforma»).
- Solo correo y contraseña. El registro abierto está desactivado. No hay recuperación por correo, magic link, OAuth, bloqueo de cuentas ni passkeys en la 1c.
- Cada cuenta tiene un perfil: `admin`, `member` o `device`. Hay exactamente una cuenta de aparato. La plataforma la crea al arrancar si falta, sin contraseña. Hasta que la fase 3 traiga el emparejamiento, no puede iniciar sesión por HTTP. Solo se llega a ella con un contexto sintético en las pruebas.
- La sesión no se guarda en caché en la cookie. Cada petición consulta la sesión en la base, así que una revocación vale desde la petición siguiente.
- **`pnpm accounts`** se ejecuta en el contenedor `api` y tiene dos subcomandos: crear una cuenta (correo, nombre y perfil `admin` o `member`) y cambiar una contraseña.
    - La contraseña se pide de forma interactiva, sin eco, y nunca se acepta como argumento: el análisis de argumentos rechaza esa opción.
    - Ni la salida ni los errores incluyen el secreto.
    - Cambiar una contraseña con el comando revoca todas las sesiones de la cuenta.
    - El núcleo del comando es una función que recibe la plataforma, una forma de pedir el secreto y una salida. El envoltorio de terminal no tiene lógica.
- **Cambiar la propia contraseña desde la app** es una operación de la plataforma, no una acción. Pide la contraseña actual y conserva solo la sesión desde la que se hace.
- Los dos caminos invalidan todos los comprobantes, también los ya usados, y todas las confirmaciones pendientes de la cuenta.

### Aparato y sesión (Q8, Q17, Q21)

- Un aparato es una fila de la plataforma con un identificador aleatorio largo, su instante de alta y su nombre opcional. La puerta lo identifica con una cookie propia, distinta de la de sesión, `HttpOnly`, larga y que no caduca al cerrar sesión.
- Al iniciar sesión, si la cookie de aparato falta o no corresponde a un aparato conocido, nace un aparato nuevo. La sesión guarda en el servidor su aparato. Lo que vale es esa asociación, no la cookie.
- Un aparato puede tener sesiones de varias cuentas. Al cambiar de cuenta en el mismo navegador se conserva el aparato, y ninguna sesión, pendiente ni comprobante de una cuenta pasa a la otra.
- Operaciones de la plataforma sobre sesiones:
    - Listar mis sesiones: solo las de mi cuenta, con su aparato.
    - Cerrar la sesión actual: no pide comprobante.
    - Revocar otra sesión mía: pide comprobante.
    - Revocar las sesiones de la cuenta de aparato: solo el admin, con comprobante.
    - Revocar un aparato de la cuenta de aparato: solo el admin, con comprobante. Cierra todas las sesiones de ese aparato y caducan sus pendientes y comprobantes. Es distinto de revocar mis sesiones en un navegador, que no toca las de otras cuentas.
    - Una sesión o un aparato que no existe y uno que no se puede revocar (de otra cuenta, o de la cuenta de aparato para quien no es admin) responden igual, «no encontrado», antes de pedir el comprobante.
- Al revocar una sesión caducan con ella las confirmaciones pendientes y los comprobantes nacidos en esa sesión.
- El emparejamiento con código y las credenciales de los satélites son de la fase 3.

### El contexto verificado (Q9, Q29, Q30)

- La puerta construye para cada petición un **contexto verificado** con:
    - la cuenta representada;
    - `via`;
    - el aparato y la sesión;
    - la cuenta con la que se autenticó el aparato;
    - el canal (`app` o `contexto`);
    - cómo se acreditó la identidad (`password`, `voice` o `device`);
    - la conversación.
- Por HTTP, en la 1c, la cuenta representada es la de la sesión, `via` va siempre vacío, el canal es `app`, la identidad es `password` y la conversación va vacía. La puerta ignora cualquier campo de la entrada que pretenda fijar alguno de esos valores. Esos valores no forman parte de la entrada de ninguna acción.
- El contexto llega a `platform/actions` y a `platform/authorization` sin que nada lo pueda sustituir por el camino. El manejador del módulo sigue recibiendo solo el actor (cuenta representada y `via`).
- `password`, `voice` y `device` no se comparan como niveles: la autorización solo pregunta cuál es.
- La entrada de pruebas de `platform` puede construir un contexto verificado sintético con cualquier combinación de esos valores, incluido un miembro reconocido por voz en un aparato con la cuenta de aparato. Producción no puede.

### Áreas, permisos y perfiles (Q3, Q4, Q11, Q12)

- **Áreas.** Un módulo declara sus áreas en su definición. Su área por defecto tiene el id del módulo, y puede declarar otras con ese id como prefijo. Cada área declara:
    - su visibilidad por defecto (`private` o `public`);
    - si lo público lo edita cualquiera con `write` (por defecto, no);
    - si es `alwaysPrivate`;
    - si leerla en un aparato compartido pide confirmación (`confirmOnSharedDevice`). Es independiente de `alwaysPrivate`: un área puede ser siempre privada sin esta regla. La salud declara las dos.

    La plataforma tiene su propia área, `platform`, para sus operaciones.

- **Permiso del contrato.** Cada contrato de acción declara su permiso: un área (por defecto, la del módulo) y un nivel (`read`, `write` o `manage`), y opcionalmente que pide confirmación siempre. Al arrancar, la plataforma rechaza:
    - un área que no esté registrada;
    - una escritura con nivel `read`;
    - una acción sin permiso declarado.
- **Permiso de una cuenta.** Es un nivel por área: ninguno, `read`, `write` o `manage`, acumulativos. Cada perfil tiene unos valores por defecto:
    - `admin`: `manage` en todas las áreas. No se puede cambiar.
    - `member`: `write` en todas las áreas.
    - `device`: `read`, salvo en las áreas `alwaysPrivate`, donde no tiene ninguno.

    Una fila guardada para la cuenta y el área sustituye al valor por defecto. Un área nueva toma el valor por defecto del perfil.

- **Cambiar permisos.** Solo puede el admin, sobre las cuentas `member` y `device`, y siempre con comprobante. Es una acción de la plataforma (de escritura, auditada, con clave) y la decide la autorización por perfil, no por nivel. Nadie cambia los suyos.

### Delegación (Q9, Q12, Q18)

- La tabla de delegación de una cuenta guarda, para cada área y cada nivel, `no`, `sí` o `confirmar`. Un valor no arrastra a los demás.
- Se crea una sola vez, al crear la cuenta:
    - `read` y `write` copian el permiso de la cuenta en ese momento: `sí` si lo tiene y `no` si no;
    - `manage` empieza en `no`;
    - ningún valor empieza en `confirmar`.

    Después no sigue los cambios de permisos. Un área sin fila vale `no`.

- **Quién la cambia.** Cada persona cambia la suya, y nadie más. La de la cuenta de aparato la cambia el admin. Cambiarla es una acción de la plataforma, auditada y con comprobante. Nunca se puede cambiar vía Kira.
- **Quién la lee.** Cada persona lee la suya. El admin lee la de la cuenta de aparato y nunca la de otra persona.

### La decisión (Q2, Q12, Q13, Q22, Q29)

- `platform/authorization` es una función pura y síncrona. Recibe el contexto verificado, la acción con su permiso declarado, la entrada validada y, si hay, el contexto de deshacer o de confirmación. También recibe una vista de solo lectura de los permisos, la delegación y los perfiles. Responde una de cuatro decisiones:
    - permitir;
    - denegar, con el motivo `forbidden` o `not-found`;
    - pedir confirmación;
    - pedir comprobante.

    Una excepción deniega.

- El orden:
    1. El permiso de la cuenta representada en el área tiene que alcanzar el nivel pedido.
    2. Vía Kira, la delegación de esa cuenta para ese área y nivel: `no` deniega y `confirmar` pide confirmación.
    3. Las operaciones sensibles piden comprobante (ver «Comprobantes»). Si la identidad se acreditó por `voice` o por `device`, se deniegan. Vía Kira, cambiar el acceso o la delegación se deniega siempre, aunque traiga comprobante.
    4. Si la acción declara que pide confirmación siempre, se pide confirmación una sola vez, nunca dos.
    5. Regla del aparato compartido: si la cuenta del aparato es la de aparato, leer un área con `confirmOnSharedDevice` pide confirmación cuando hay un miembro reconocido y se deniega cuando no lo hay. Esa confirmación es solo por `contexto` (la decisión es `confirm-in-context`). Es un mecanismo general que la salud activa por configuración.
- La visibilidad de cada registro no la decide esta función fila a fila. La aplica el predicado que reciben los manejadores y la comprueba la captura de escrituras, las dos construidas sobre las mismas reglas de la autorización.
- La autorización de producción sustituye a la que lo denegaba todo. El autorizador programable de la 1b sigue existiendo solo en la entrada de pruebas de `platform`, para las pruebas internas que necesitan forzar un fallo.

### Visibilidad en las lecturas (Q5, Q13)

- `module-sdk/db` ofrece una forma de declarar una tabla con dueño: añade las columnas de dueño (la cuenta) y de visibilidad (`private` o `public`), y declara el tipo de registro y el área de la tabla. Una tabla con dueño tiene que usar la columna `id` entera de `module-sdk/db` como clave. No admite claves compuestas, y la plataforma rechaza al arrancar una tabla con dueño que no cumpla.
- Un área `alwaysPrivate` pone en sus tablas un `CHECK` que rechaza `public`. Lo genera `drizzle-kit`.
- El contexto del manejador da un predicado de visibilidad por tabla con dueño: «el dueño es la cuenta representada, o el registro es público». Se aplica en `where`, también en conteos y búsquedas.
- Una sola excepción admitida, el bloqueo referencial ([ADR 0024](../../docs/architecture/adr/0024-bloqueo-referencial-al-borrar.md)): un borrado puede responder que lo impiden registros dependientes, aunque alguno quede oculto, solo cuando quien lo pide ya ve el registro padre y puede borrarlo; la respuesta no revela cuántos, ni ids, dueños, visibilidad o contenido. Para saber si puede borrarlo, el contexto da `editable(table)`, con la misma regla que la captura, y `forbidden()`. La comprobación sin predicado sirve solo para la integridad referencial; lecturas, búsquedas y conteos siguen con el predicado. Cada módulo que la quiera la justifica en su grilling.
- En un join entre tablas con dueño del mismo módulo, cada tabla lleva su propio predicado. Las formas admitidas (consulta simple, conteo, búsqueda y join dentro del módulo) quedan escritas en el `AGENTS.md` de `modules/`. Lo demás es disciplina comprobada en la revisión.
- Un registro que el predicado oculta se trata como inexistente: la acción responde «no encontrado».

### Comprobar las escrituras (Q13, Q25)

- Al abrir la conexión, después de las migraciones y antes de aceptar acciones, la plataforma:
    - activa `recursive_triggers`, para que `REPLACE` dispare los triggers de borrado;
    - crea una tabla temporal de captura;
    - crea triggers temporales en cada tabla con dueño de los módulos registrados: `AFTER INSERT`, `AFTER UPDATE` (con `OLD` y `NEW`) y `AFTER DELETE`.

    Cada trigger anota una fila de captura por transición, con la tabla, la clave antigua y la nueva, el dueño y la visibilidad antiguos y nuevos, y la operación.

- La captura se vacía al empezar cada escritura y al terminarla, confirme o revierta.
- Antes de confirmar una escritura, la plataforma recorre la captura en orden y comprueba cada transición:
    - **Insertar:** el dueño es la cuenta representada.
    - **Actualizar:** el dueño no cambia; la clave no cambia; antes del cambio, quien edita es el dueño, o el registro era público, el área lo permite y la cuenta tiene `write`; la visibilidad solo la cambia el dueño.
    - **Borrar:** mismas condiciones que editar.
    - **Áreas `alwaysPrivate`:** ninguna fila pública. El `CHECK` ya lo impide.
    - **Registros tocados:** cada registro con dueño que aparece en la captura está entre los que declaró el manejador. Cualquier transición cuenta, también la de una fila creada y borrada en la misma operación.
- Un fallo revierte toda la escritura, con su entrada del registro, y sale como error interno, salvo «no permitido» cuando el problema es de autorización (editar lo público ajeno sin que el área lo permita).
- Una forma de escribir que la captura no cubra se rechaza y se prueba. Las tablas sin dueño siguen dependiendo de lo que declare el manejador. Ese límite queda escrito.

### Resultados, registro y deshacer (Q14, Q24)

- **Qué guarda una escritura.** Ya no guarda su resultado. El contenido de una entrada pasa a ser la entrada y la inversa. La columna del resultado deja de escribirse, y una migración generada la retira.
- **La primera ejecución** devuelve el resultado y el número de la entrada.
- **Repetir** la misma clave con la misma huella vuelve a autorizar y devuelve un acuse sin contenido, `{ entry, repeated: true }`. No ejecuta, tampoco si el contenido caducó ni si la entrada se deshizo después. El conflicto `result-expired` de la 1b desaparece para las repeticiones: una repetición caducada devuelve el mismo acuse. Con otra huella, el conflicto sigue siendo `key-reused`.
- La clave sigue siendo única por cuenta y `via`.
- **Leer el registro** es una lectura de la plataforma. Devuelve solo la anotación de las entradas de la cuenta representada, nunca la entrada ni la inversa. Vía Kira pasa además por la delegación del área `platform`.
- **Deshacer** sigue el recorrido de la 1b, con dos cambios:
    - solo lo puede pedir la misma cuenta representada que hizo la escritura (si no, «no encontrado»), y vía Kira, dentro de la delegación vigente;
    - la inversa pasa por la autorización completa y por la captura de escrituras.
- Las lecturas no se registran.

### Confirmaciones pendientes (Q6, Q15, Q26)

- **Qué se guarda.** Cuando la decisión es pedir confirmación, la operación no se ejecuta: se revierte lo que hubiera abierto y, en una transacción propia, se guarda una pendiente con:
    - un id aleatorio;
    - la huella de la operación exacta: acción y entrada canónica, o la operación de deshacer con el número de la entrada que se deshace;
    - si es lectura o escritura;
    - la clave de idempotencia, si es escritura;
    - el contexto verificado de origen;
    - el instante en que se cierra la ventana de voz (60 s) y el de caducidad (24 h). Los dos son absolutos y se fijan al crearla. Los plazos son opciones de la plataforma, y cambiarlos solo afecta a las nuevas.

    Después se responde `CONFIRMATION_REQUIRED` con el id.

- **La misma petición, repetida, devuelve la misma pendiente.** Una escritura se reconoce por su cuenta, `via` y clave, con la misma huella. Una lectura, por su huella y su sesión o conversación de origen, y solo donde se puede responder: con conversación, la misma sesión (si la hay) y la misma conversación; sin conversación, la misma sesión. Dos conversaciones vacías nunca coinciden, y otra conversación de la misma sesión recibe su propia pendiente. Con la misma clave y otra huella, el conflicto es `key-reused`.
- **Confirmar** es una operación de la plataforma que recibe el id. El canal lo acredita la puerta:
    - Por `contexto` hace falta el mismo aparato, la misma conversación (no vacía) y la ventana abierta. En la 1c no se llega por HTTP: solo se prueba con un contexto sintético.
    - Por `app` hace falta la misma cuenta representada, desde cualquiera de sus sesiones vigentes.
    - Excepción: una pendiente nacida de la regla del aparato compartido se confirma solo por `contexto` (misma persona, aparato y conversación, dentro de la ventana). Su caducidad es el cierre de la ventana, sin las 24 h de la app, y por `app` responde «no encontrado», también desde el móvil de esa persona. Desde el móvil se hace una lectura nueva.
- **Al confirmar se vuelve a evaluar todo:**
    - con la cuenta, el `via` y la delegación del origen;
    - con los permisos, la visibilidad y el contexto de ahora;
    - el requisito de confirmación cuenta como cumplido, y solo ese;
    - si hace falta comprobante, se exige como siempre.
- **Una escritura** se ejecuta por el recorrido normal con la clave guardada. En esa misma transacción la pendiente pasa a consumida, enlazada con su entrada del registro.
- **Una lectura** se ejecuta con `query_only` durante su manejador y valida su resultado. Después, fuera de ese tramo y en la misma transacción, la pendiente se marca consumida. El resultado sale solo en esa respuesta y no se guarda nunca.
- **Errores:**
    - otra cuenta o una pendiente ajena: «no encontrado»;
    - ventana cerrada por `contexto`: conflicto `window-closed`;
    - caducada: conflicto `confirmation-expired`;
    - ya consumida o rechazada: conflicto `confirmation-consumed`;
    - la reevaluación deniega: «no permitido».

    Confirmar dos veces ejecuta una sola, y la segunda vez responde `confirmation-consumed`, también en una lectura cuya respuesta se perdió.

- **Rechazar** es una operación de la plataforma con las mismas reglas de quién puede, y marca la pendiente como rechazada.
- La caducidad se comprueba al acceder. La limpieza física llega con la 1d.

### Comprobantes (Q20)

- **Qué es sensible:**
    - cambiar permisos o delegación;
    - revocar sesiones que no sean la propia actual;
    - revocar sesiones de la cuenta de aparato;
    - cualquier acción de nivel `manage`.
- **Pedir un comprobante** es una operación de la plataforma. Recibe la contraseña y la operación que se quiere hacer (acción y entrada, o la operación de la plataforma con su entrada). Calcula la huella y devuelve un comprobante aleatorio ligado a la cuenta, la sesión, el aparato y esa huella, de un solo uso y válido 5 minutos. En la base solo se guarda su hash.
- **Usarlo.** La operación sensible lleva el comprobante junto a su petición. Se valida y se consume en la misma transacción que la operación, así que si la operación se revierte, el comprobante sigue sin usar. Un reintento idempotente de una escritura ya hecha devuelve el acuse tras volver a autorizar, comprobante incluido: vale el mismo comprobante que usó la escritura, y si trae uno nuevo y válido, ese se gasta y queda enlazado con la entrada anterior. Tras cambiar la contraseña, ni siquiera el comprobante ya usado sirve para el reintento: responde `STEP_UP_REQUIRED`.
- Si falta, sobra o no coincide (otra operación, otra sesión, caducado o ya usado), la respuesta es `STEP_UP_REQUIRED`.
- Ni la contraseña ni el comprobante entran en una pendiente, en el registro ni en ningún mensaje de error. Una operación sensible que además pide confirmación exige el comprobante al confirmar, no al pedirla.

### Voz no reconocida (Q23)

- Es una regla escrita para Kira (5b) y para la memoria (fase 7). La 1c no construye nada para ella. Lo que se ejecuta como cuenta de aparato conserva su entrada en el registro y su clave, como cualquier escritura.

### Migraciones de la plataforma (Q10, Q19, Q31)

- La plataforma declara su esquema en Drizzle con el prefijo `platform_`:
    - las tablas de `0000` y `0001`;
    - las de Better Auth;
    - aparatos, permisos, delegación, perfiles, confirmaciones pendientes y comprobantes.
- `drizzle-kit` genera las migraciones de la plataforma en su propia carpeta. La primera migración generada es una **base**: representa `0000` + `0001` y existe solo para que `drizzle-kit` tenga de dónde partir. El generador la reconoce, compara su esquema con el de `0000` + `0001` y no la emite como ejecutable. Las siguientes reciben sus posiciones ejecutables a partir de la 2, sin cambiar su nombre generado. Así, la primera ejecutable es `platform/0002`.
- `0000` y `0001` siguen escritas a mano, con su hash y su posición intactos. `audit` sigue con sentencias preparadas sobre las tablas que ahora también declara el esquema.
- `pnpm db:generate` genera también las de la plataforma. La CI comprueba que dos generaciones seguidas no dejan cambios.

### HTTP y la puerta (Q1)

- La puerta monta las rutas de Better Auth (iniciar sesión y cerrar sesión), las operaciones de la plataforma y las acciones de los módulos registrados, compuestas en el router de oRPC. Cambiar la contraseña desde la app no es una ruta de Better Auth: es la operación de la plataforma `password/change`, que pide la actual y deja abierta solo la sesión desde la que se cambia. La forma de la URL la fija la composición con `api-client`. Sin sesión válida, toda acción y toda operación de la plataforma responde no autenticado, y no se ejecuta nada.
- Errores nuevos sobre los códigos de oRPC:
    - no autenticado;
    - `CONFIRMATION_REQUIRED`, con el id de la pendiente;
    - `STEP_UP_REQUIRED`;
    - los conflictos de confirmación.

    Un registro invisible y una pendiente ajena salen como «no encontrado».

- `status` sigue sin sesión. `apps/api` compone igual que en la 1b. `probe` sigue fuera de la lista de producción.

### `module-sdk`, `test-utils` y la entrada de pruebas

- `module-sdk/contracts` amplía `readAction` y `writeAction` con el permiso (área y nivel) y «pide confirmación siempre». La entrada sigue siendo pura.
- `module-sdk` amplía `defineModule` con las áreas, y `module-sdk/db` con las tablas con dueño. El contexto del manejador gana el predicado de visibilidad.
- `createTestPlatform` usa por defecto la autorización real y un reloj controlable, y ofrece además:
    - **una preparación privilegiada**, solo en la entrada de pruebas, que crea cuentas con su perfil y su contraseña, la cuenta de aparato y filas de permisos y de delegación sin sesión ni comprobante;
    - **contextos verificados sintéticos**;
    - **las operaciones reales de la plataforma**: confirmar, rechazar, pedir comprobante, deshacer, leer el registro, cambiar permisos y delegación, y revocar. Cuando el comprobante es lo que se prueba, se emite por el mecanismo real;
    - **`log()`**, que sigue devolviendo la instantánea completa del registro, solo para las pruebas.
- Reiniciar en una prueba es cerrar y volver a abrir la plataforma sobre el mismo fichero temporal.

### `probe`

`probe` gana áreas, tablas con dueño y acciones para que cada regla tenga un caso:

- **Áreas:**
    - `probe`: privada por defecto; lo público no lo edita cualquiera.
    - `probe.board`: pública por defecto; lo público lo edita quien tenga `write`.
    - `probe.health`: `alwaysPrivate` y `confirmOnSharedDevice`.
    - `probe.secret`: `alwaysPrivate` sin `confirmOnSharedDevice`, para probar que una regla no implica la otra.
- **Datos:**
    - Las notas y los comentarios de la 1b pasan a tener dueño.
    - Una tabla `board`, con dueño, en `probe.board`, con acciones para añadir, editar y borrar.
    - Una tabla `health`, con dueño, en `probe.health`, con acciones para leer y apuntar.
    - Una tabla `secret`, con dueño, en `probe.secret`, con acciones para leer y apuntar.
- **Acciones nuevas o cambiadas:**
    - Una acción para cambiar la visibilidad de una nota.
    - Una acción de nivel `manage` en `probe` (`configure`), para el comprobante.
    - `deleteComment` declara que pide confirmación siempre.
    - Un conteo y una búsqueda de notas con el predicado.
    - Un join de notas con comentarios, con un predicado por tabla.
- **Para las pruebas de reglas,** acciones deliberadamente incorrectas, declaradas solo en el código de prueba con módulos escritos dentro de la prueba, no en `probe`:
    - una que cambia el dueño y lo restaura;
    - una que escribe con `REPLACE`;
    - una que hace UPSERT;
    - una que cambia la clave;
    - una que toca un registro sin declararlo;
    - una que crea y borra en la misma operación.

### Documentos y la Pi

- `docs/despliegue.md` explica cómo crear las dos cuentas con `pnpm accounts` en la Pi y cómo comprobar la 1c allí:
    - entra una sesión;
    - una operación permitida de la plataforma funciona;
    - una denegada falla;
    - tras `restart` y tras recrear `api`, la sesión sigue y la revocada no;
    - las filas de `platform/0000` y `0001` conservan posición, hash e instante, y `platform/0002` en adelante se aplica sobre la base existente.
- Al cerrar, `docs/plan.md` marca la 1c como hecha y `docs/guia/` recoge lo construido, según `docs/AGENTS.md`.

## Decisiones de prueba

- **Qué es una buena prueba.** Comprueba el comportamiento visible desde fuera: lo que devuelven las acciones y las operaciones de la plataforma, lo que leen después las lecturas, las respuestas HTTP y sus cookies y, solo cuando no hay otra forma de verlo, la instantánea de `log()`. No comprueba sentencias SQL, nombres de columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla. `probe` demuestra la integración y las reglas de los módulos.
- **Pruebas unitarias de la decisión** (`platform/authorization`), con la vista de permisos, delegación y perfiles construida en la prueba:
    - niveles acumulativos;
    - valores por defecto por perfil y sustitución por fila;
    - el admin no se puede bajar;
    - delegación no acumulativa;
    - `no` y `confirmar` vía Kira, y un área sin fila;
    - confirmación siempre, una sola vez;
    - operaciones sensibles con `voice` y `device`;
    - la regla de `confirmOnSharedDevice`, con y sin miembro reconocido, y que un área `alwaysPrivate` sin ella no la aplica;
    - vía Kira, cambiar el acceso o la delegación se deniega aunque haya comprobante;
    - una excepción deniega.
- **Pruebas de la captura de escrituras** (`platform`), con módulos escritos dentro de la prueba:
    - insertar con otro dueño;
    - cambiar el dueño y restaurarlo;
    - editar o borrar lo ajeno, privado o público, según el área;
    - cambiar la visibilidad sin ser el dueño;
    - cambiar la clave;
    - crear y borrar en la misma operación;
    - modificaciones múltiples;
    - UPSERT y `REPLACE`;
    - un registro cambiado sin declararlo;
    - que todo revierte, con su entrada;
    - que la captura empieza vacía en cada escritura, también después de una revertida;
    - que los triggers existen antes de aceptar la primera acción.
- **`createTestPlatform` con `probe`**, el punto principal:
    - **Permisos por nivel:** `member` con `write` lee y escribe; la cuenta de aparato con `read` no escribe; una fila que baja a ninguno deniega.
    - **Delegación:** vía Kira con `no` deniega, con `confirmar` pide confirmación, leer sí y escribir confirmar en la misma área; confirmar desde la app algo nacido vía Kira sigue aplicando la delegación del origen; quitar la delegación entre pedir y confirmar deniega al confirmar.
    - **Visibilidad:** privado ajeno es «no encontrado» en lectura, conteo, búsqueda y join; público se ve; público ajeno no se edita en `probe` y sí en `probe.board`; crear deja dueño y visibilidad por defecto; cambiar la visibilidad solo el dueño; `probe.health` no admite público; borrar una nota con comentarios ocultos responde «tiene comentarios» sin más datos solo a quien la ve y puede borrarla, «no permitido» a quien la ve sin poder borrarla y «no encontrado» a quien no la ve.
    - **Confirmaciones:**
        - la misma escritura y la misma lectura repetidas devuelven la misma pendiente;
        - misma clave con otra entrada da `key-reused`;
        - confirmar por `app` desde otra sesión de la misma cuenta funciona, y desde otra cuenta da «no encontrado»;
        - por `contexto`: mismo aparato y conversación dentro de la ventana funciona; otro aparato, otra conversación, una conversación vacía o la ventana cerrada en el milisegundo exacto fallan;
        - caducidad en el milisegundo exacto;
        - dos confirmaciones dan una sola ejecución;
        - una lectura confirmada se ejecuta una vez, y repetir la confirmación da `confirmation-consumed`;
        - rechazar;
        - tras cerrar y abrir sobre el mismo fichero, la pendiente sigue con sus plazos;
        - cambiar los plazos no altera las existentes;
        - `deleteComment` pide confirmación una sola vez aunque la delegación también diga `confirmar`.
    - **Operación exacta:** otra acción, otra entrada, otra entrada del registro en un deshacer o un esquema que transforma la entrada no confirman ni consumen la pendiente o el comprobante de otra operación.
    - **Comprobantes:**
        - `configure` sin comprobante da `STEP_UP_REQUIRED`, y con uno funciona;
        - el comprobante de otra operación, de otra sesión, caducado en el milisegundo exacto o ya usado no vale;
        - una operación revertida no lo gasta;
        - un reintento con la misma clave devuelve el acuse;
        - con `voice` o `device` se deniega;
        - la contraseña y el comprobante no aparecen en `log()` ni en ninguna pendiente.
    - **Repetición:** una escritura repetida devuelve el acuse sin contenido, también tras caducar el contenido y tras deshacerse; si su registro pasó a privado de otro, el acuse no revela nada.
    - **Registro y deshacer:** leer el registro devuelve solo anotaciones propias; vía Kira, con la delegación; deshacer lo ajeno da «no encontrado»; deshacer vía Kira sin delegación se deniega.
    - **Salud en el aparato compartido:**
        - la cuenta de aparato sin miembro reconocido no lee `probe.health`;
        - un miembro reconocido por voz pide confirmación, y al confirmar se lee una vez;
        - una pendiente de salud no se confirma desde la app («no encontrado», también desde el móvil del miembro), que lee de nuevo;
        - por `contexto` se confirma una vez dentro de la ventana, y al cerrarse caduca para todos los canales;
        - otra pendiente nacida en la misma pantalla sigue confirmándose desde la app durante 24 h.
    - **Revocación y contraseña:** revocar una sesión o cambiar la contraseña invalida sus pendientes y comprobantes.
- **Pruebas HTTP** (`createHttpHandler` con `probe` compuesto en la prueba, Better Auth por sus rutas y `api-client` sobre el mismo `fetch`, con las cookies gestionadas explícitamente por el cliente de prueba):
    - Sesión e identidad:
        - sin sesión, toda acción y operación de la plataforma responde no autenticado;
        - iniciar sesión crea un aparato, y cerrar y volver a entrar lo conserva;
        - el registro abierto está desactivado.
    - Llamadas con sesión: una permitida, una denegada y una con `CONFIRMATION_REQUIRED` seguida de su confirmación por `app`.
    - Falsificación: cuenta, `via`, aparato, canal, identidad o conversación declarados por el cliente se ignoran o se rechazan.
    - Revocación: una sesión revocada falla en la petición siguiente.
    - Contraseña: cambiarla conserva solo la sesión actual.
    - Dos personas en el mismo navegador: al cambiar de cuenta se conserva el aparato y no pasa ninguna sesión, pendiente ni comprobante de la primera a la segunda.
- **`pnpm accounts`:**
    - el núcleo, con un proveedor falso del secreto y una salida capturada: crea `admin` y `member`; rechaza un correo repetido; cambiar la contraseña revoca todas las sesiones, los comprobantes y las pendientes; ni la salida ni los errores contienen el secreto;
    - una prueba pequeña del análisis de argumentos rechaza recibir la contraseña como argumento.
- **Migraciones** (generador de `tooling/scripts` y pruebas de migraciones de `platform`):
    - el esquema de la base generada coincide con el de `0000` + `0001`;
    - la base nunca se aplica, tampoco sobre una instalación existente;
    - los hashes y las posiciones de `0000` y `0001` no cambian;
    - las posiciones ejecutables siguen desde la 2;
    - el esquema final coincide en una instalación limpia y tras actualizar una base de la 1b;
    - dos generaciones seguidas no dejan cambios.
- **Reglas de dependencias** (`architecture.test.ts` y sus fixtures):
    - producción no alcanza la preparación privilegiada, los contextos sintéticos ni el autorizador programable;
    - `web` no alcanza `platform/authorization` ni por caminos indirectos;
    - `contracts/` sigue sin alcanzar Drizzle ni Node.
- **Prior art:**
    - las pruebas de `probe` y de `platform` de la 1b;
    - `http.test.ts` para la puerta;
    - `module-migrations.test.ts`, `real-modules.test.ts` y `fresh-start.test.ts` para las migraciones;
    - `architecture.test.ts` para las reglas.
- **Comprobaciones finales:** pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`, y `pnpm db:generate && pnpm modules:generate` dejan `git status --porcelain` vacío.

## Fuera de alcance

- Las pantallas de iniciar sesión, ajustes, permisos, delegación y emparejamiento: fase 3.
- Las passkeys, el emparejamiento con código y las credenciales de los satélites: fase 3.
- Las llaves de API y el `via` real: 1e.
- El canal `contexto` por HTTP, los turnos y las conversaciones: fase 5.
- El reconocimiento de voz: 5c.
- Recuperar la contraseña por correo, el bloqueo de cuentas y el OAuth: no entran.
- La limpieza física del contenido caducado, de las pendientes y de los comprobantes: 1d.
- El actor de las tareas programadas: 1d.
- Las llamadas entre acciones de módulos y las acciones con efectos fuera de SQLite: con su primer caso real.
- Un mecanismo general de olvido: antes de admitir datos privados reales.
- Los cambios de dueño de un registro: no existen.
- Una vista del registro para el admin: no existe en la 1c.

## Notas

- Los documentos de arquitectura, el glosario y el plan ya están al día en la rama del grilling. Al cerrar, se actualizan `docs/plan.md`, `docs/despliegue.md` y `docs/guia/`.
- Algunas decisiones de detalle se toman en esta spec y no en el grilling: los valores por defecto de cada perfil (`admin`, `manage` fijo; `member`, `write`; `device`, `read` salvo en las áreas `alwaysPrivate`), la bandera `confirmOnSharedDevice`, separada de `alwaysPrivate`, que haya una sola cuenta de aparato creada al arrancar, los nombres de los errores nuevos y la forma del acuse. Si la implementación muestra que alguna no encaja, se corrige aquí antes de seguir.
- La 1c cambia una decisión de la 1b (la devolución del resultado guardado). Las pruebas de la 1b que la comprobaban se reescriben con el acuse, no se borran.
- La migración `probe/0001_broad_namor` se retocó a mano después de generarla: `drizzle-kit` copiaba columnas que no existen al reconstruir una tabla. Se acepta solo porque `probe` es `testOnly` y nunca llega a una base real; en un módulo de producción, una migración generada no se edita.

## Tareas

| Tarea                                                     | Qué                                                      | Bloqueada por      |
| --------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
| [01](issues/01-migraciones-de-la-plataforma-generadas.md) | Migraciones de la plataforma generadas                   | —                  |
| [02](issues/02-repetir-sin-devolver-contenido.md)         | Repetir sin devolver contenido                           | 01                 |
| [03](issues/03-entrar-por-http-y-una-lectura.md)          | Entrar por HTTP y una lectura permitida de punta a punta | 01                 |
| [04](issues/04-pnpm-accounts-y-contrasenas.md)            | `pnpm accounts` y cambiar la contraseña                  | 03                 |
| [05](issues/05-visibilidad-al-leer.md)                    | Visibilidad al leer                                      | 03                 |
| [06](issues/06-comprobar-las-escrituras.md)               | Comprobar las escrituras con triggers temporales         | 05                 |
| [07](issues/07-delegacion.md)                             | Delegación                                               | 03                 |
| [08](issues/08-confirmaciones-pendientes.md)              | Confirmaciones pendientes                                | 02, 06, 07         |
| [09](issues/09-comprobantes-y-operaciones-sensibles.md)   | Comprobantes y operaciones sensibles                     | 04, 07, 08         |
| [10](issues/10-registro-y-deshacer.md)                    | Registro y deshacer con autorización real                | 02, 06, 07, 08, 09 |
| [11](issues/11-la-pi-y-el-cierre.md)                      | La Pi y el cierre de la 1c                               | todas              |
