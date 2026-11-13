# Identidad y autorización

Sustituye dos decisiones: Permix, del ADR 0002, y la devolución del resultado guardado al repetir una escritura, del ADR 0022.

Precisa los ADR 0002, 0006, 0007, 0008, 0009, 0010, 0021 y 0022: cómo entra cada persona, qué recibe la autorización y cómo decide permiso, delegación, visibilidad y confirmación.

Precisado por el ADR 0024: un borrado puede decir que lo impiden registros dependientes ocultos solo a quien ya ve el registro padre y puede borrarlo, sin revelar nada más de ellos.
Precisado por el ADR 0028: vincular o soltar un archivo cambia su registro y pasa por `editable(table)`; una descarga que pide confirmación se confirma solo en su ruta, desde cualquier sesión de la misma persona, y el `confirm` genérico la rechaza sin consumirla.

**Sin Permix.** La decisión es una función pura y síncrona de `platform/authorization` sobre tres tablas de búsqueda: permisos, delegación y visibilidad. La web no decide nada. Pregunta a la API, y si un día necesita pintar permisos, lo hará con una consulta. Permix no añadía nada a esa función.

**Acciones en HTTP.** La puerta monta las acciones de los módulos y las operaciones de la plataforma, solo con una sesión válida. Cada llamada sigue el recorrido único de `platform/actions`. La forma de la URL la da la composición de oRPC con `api-client`.

**Cuentas.** Se entra con Better Auth, con correo y contraseña y el registro abierto desactivado. Las cuentas se crean y su contraseña se cambia con un único procedimiento: `pnpm accounts`, un comando en el contenedor `api` que pide el secreto de forma interactiva. Nunca lo recibe como argumento ni lo escribe en un registro. No hay recuperación por correo, porque la Pi no envía correo, ni bloqueo de cuentas. Cambiar la propia contraseña desde la app pide la actual y conserva solo la sesión desde la que se cambia. El comando revoca todas. Los dos caminos invalidan los comprobantes y las confirmaciones pendientes de la cuenta. Cada petición comprueba la sesión en la base, sin caché en la cookie, así que una revocación tiene efecto en la siguiente petición. Las passkeys llegan con las pantallas de la fase 3.

**Aparato, sesión y cuenta.** Son tres cosas distintas. Un aparato es una instalación de un navegador, o un satélite con su credencial cuando se empareje. Se identifica con una cookie propia, distinta de la de sesión. Nace con el primer inicio de sesión, sobrevive a cerrar sesión y puede cambiar de cuenta. La cookie no es una credencial: la relación entre aparato y sesión la guarda el servidor. Un mismo aparato puede guardar sesiones de varias cuentas, y cada persona revoca las suyas sin ver ni tocar las ajenas. Revocar el emparejamiento de un aparato compartido es otra operación, que hace el admin. El emparejamiento con código es de la fase 3.

**El contexto verificado.** La puerta lo construye a partir de credenciales, y nadie lo sustituye después. Lleva:

- la cuenta representada y `via`;
- el aparato y la sesión;
- la cuenta con la que se autenticó el aparato;
- el canal (`app` o `contexto`);
- cómo se acreditó la identidad: `password`, `voice` o `device`. No es una escala de confianza;
- la conversación, vacía hasta la fase 5.

Nada de lo que declare el cliente vale como identidad. Por HTTP, en la 1c, `via` llega siempre vacío y el canal es `app`. La 1e rellena `via` a partir de la llave. Quién habla, que acredita la voz, es distinto de quién ejecuta, que es `via`. El manejador de un módulo sigue recibiendo solo el actor.

**Permisos.** Cada contrato declara el permiso que pide: un área registrada, que por defecto es su módulo, y un nivel. Los niveles son `read`, `write` y `manage`, y cada uno incluye los anteriores. Una escritura no puede pedir `read`. Todo eso se comprueba al arrancar. Cada cuenta tiene un nivel por área. El admin tiene `manage` en todas y no se le puede quitar, pero eso no le salta la visibilidad ni la delegación. El admin cambia el acceso de `member` y de `device`, y nadie se sube su propio acceso.

**Delegación.** Cada persona edita su propia tabla de delegación, y nadie más. La de la cuenta `device` la edita el admin. Cada nivel de cada área vale «no», «sí» o «pedir confirmación», sin que uno arrastre a otro: Kira puede leer sin preguntar y escribir con confirmación. La tabla se crea una sola vez, copiando `read` y `write` del acceso, con `manage` denegado y sin confirmaciones, y no sigue los cambios de acceso posteriores. La IA nunca cambia el acceso ni la delegación. Los ajustes personales y la delegación de cada persona son suyos y privados: el admin no los ve. Los cambios de acceso y de delegación son acciones de la plataforma, auditadas. Las contraseñas no son acciones y nunca entran en el registro.

**Visibilidad.** Las tablas con dueño se declaran con columnas comunes de `module-sdk/db`. El manejador filtra con el predicado que le da la autorización, también en conteos, búsquedas y joins dentro del módulo. Las formas de consulta admitidas se escriben, y las pruebas intentan saltarse el filtro. Las reglas son estas:

- Ver un registro: su dueño, o cualquiera si es público.
- Editarlo o borrarlo: su dueño, salvo que el área declare que lo público lo edita quien tenga `write`. Cada módulo lo decide en su grilling.
- Crear uno: el dueño es el actor representado, con la visibilidad por defecto del área.
- Cambiar la visibilidad: solo el dueño. El dueño no cambia nunca, ni tampoco la clave de una fila con dueño.

Un registro privado ajeno responde «no encontrado». Un área `alwaysPrivate`, como la salud, lleva un `CHECK` que hace imposible un registro público.

**Comprobar las escrituras.** La plataforma usa una sola conexión. Al abrirla, después de las migraciones y antes de aceptar acciones, crea triggers temporales sobre cada tabla con dueño. Esos triggers anotan cada transición de fila (`OLD` y `NEW` en cada cambio, más inserciones y borrados) en una captura que se limpia en cada operación. Antes de confirmar, la plataforma comprueba con esa captura dos cosas: las reglas de visibilidad, y que los registros tocados que declaró el manejador cubren lo que cambió. Cualquier fallo lo revierte todo, y una forma de escribir que la captura no cubra se rechaza. Las tablas sin dueño siguen dependiendo de lo que declare el manejador.

**Repetir sin devolver contenido.** Una escritura ya no guarda su resultado. Repetir la misma clave con la misma huella, después de volver a autorizar, devuelve un acuse sin contenido y nunca ejecuta nada. Pasa lo mismo si el contenido ya caducó o si la operación se deshizo después. Quien necesite los datos los pide con una lectura, que aplica la visibilidad del momento. Así no hace falta que cada acción declare de qué depende su resultado. La clave sigue siendo única por cuenta y `via`. Leer el registro devuelve solo la anotación de las propias entradas, y vía Kira, solo dentro de la delegación vigente. La entrada y la inversa quedan para los mecanismos internos. Solo puede deshacer la cuenta representada que hizo la escritura, con el permiso y la visibilidad que pida la inversa. Si deshace vía Kira, también dentro de la delegación vigente. Las lecturas no se registran.

**Confirmaciones pendientes.** Cuando la decisión es pedir confirmación, la operación no se ejecuta. En su propia transacción se guarda una pendiente con:

- la huella de la operación exacta, que en un deshacer incluye la entrada que se deshace;
- la clave;
- el contexto verificado;
- una ventana de voz de 60 s y una caducidad de 24 h, con instantes absolutos fijados al crearla.

Después se responde `CONFIRMATION_REQUIRED`, y la misma petición repetida devuelve la misma pendiente. Hay dos maneras de confirmar:

- Por el canal `contexto`, un «sí» confirma solo en el mismo aparato, en la misma conversación vigente (dos conversaciones vacías no coinciden) y con la ventana abierta. En la 1c, ese canal no llega por HTTP.
- Por `app`, la misma persona abre la pendiente a propósito desde cualquiera de sus sesiones. Eso no es heredar un «sí».

Al confirmar se vuelve a evaluar todo, también la delegación original si la operación nació vía Kira, y la confirmación solo cuenta como la confirmación que faltaba. Ejecutar y consumir la pendiente van en la misma transacción, así que confirmar dos veces ejecuta una sola. Una lectura confirmada se ejecuta como mucho una vez, y su resultado sale solo en esa respuesta. Si la respuesta se pierde, repetir responde «ya consumida».

En un aparato con la cuenta `device`, leer la salud de un miembro reconocido pide siempre confirmación. Esa pendiente se confirma solo por `contexto`: la misma persona, en el mismo aparato, en la misma conversación vigente y dentro de la ventana de voz. Vale para una sola divulgación. Cuando la ventana se cierra, caduca sin más: no tiene las 24 h de la app. Por `app`, también desde el móvil de esa persona, responde «no encontrado», igual que cualquier pendiente que no se puede confirmar. Desde el móvil se hace una lectura nueva, y confirmar allí nunca autoriza a Kira a decirlo después en la cocina. Es una excepción solo para esta divulgación: las demás pendientes conservan su confirmación por `app` durante 24 h. Sin miembro reconocido, se deniega.

**Comprobantes.** Hay operaciones sensibles: cambiar el acceso, cambiar la delegación, revocar sesiones o aparatos (salvo cerrar la sesión propia) y cualquier acción de nivel `manage`. Todas exigen un comprobante, aunque la sesión sea reciente. Al volver a dar la contraseña se obtiene un comprobante ligado a la cuenta, la sesión, el aparato y la huella de la operación. Es de un solo uso, dura 5 minutos y se consume en la misma transacción que la operación. Cuando la identidad se acreditó por `voice` o por `device` no se puede pedir comprobante: esas operaciones se hacen en la app. Ni la contraseña ni el comprobante se guardan en la pendiente ni en el registro.

**Voz no reconocida.** En la cuenta `device`, una voz no reconocida no deja memoria, y su conversación se descarta al acabar. Lo que ejecuta sí conserva su entrada en el registro y su clave, que impiden repetirlo.

**Migraciones de la plataforma.** Desde `platform/0002` se generan con `drizzle-kit`, a partir de un esquema que declara también las tablas de `0000` y `0001`. Una base generada representa esas dos tablas. Su SQL solo sirve para comparar y nunca se ejecuta, y la posición en que se aplica cada migración va separada del nombre generado. `0000` y `0001` siguen escritas a mano, con su hash y su posición intactos. `audit` sigue con sentencias preparadas.

Fecha: 2026-11-12. Preguntas del grilling: Q1–Q32 de la fase 1c.
