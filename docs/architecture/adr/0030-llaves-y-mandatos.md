# Llaves y mandatos

Precisa los ADR 0004, 0020, 0023, 0028 y 0029: cómo se autentica una app conectada, cómo dice de parte de quién actúa sin que la puerta se crea lo que declara, qué acepta la puerta de ella y cómo se confirma lo que pide.

**Cuatro responsabilidades separadas.** La llave autentica a la app. La puerta atribuye la identidad. El mandato lleva esa atribución a la app. La autorización decide con la delegación vigente. La llave nunca dice de parte de quién: que Kira «en cada petición dice de parte de quién habla» (ADR 0004) se cumple presentando un mandato, no declarando una cuenta. Una cuenta declarada convertiría la llave en una credencial para actuar como cualquiera dentro de su delegación, y contradiría que nada de lo que declara el cliente vale como identidad (ADR 0023).

**Apps conectadas.** Son una lista fija en el código, como la de módulos. En la 1e solo hay una, `kira`, y es la única que puede recibir mandatos; añadir otra que los reciba es una decisión expresa. Ser una app conectada no da permisos. Lo que Kira hace en nombre de una cuenta lo decide la tabla de delegación de esa cuenta, que solo rebaja. Un área sin fila es «no», así que un módulo nuevo nace cerrado a Kira hasta que cada persona lo abra. No hay techo de permisos por app ni modos de autenticación por acción, que serían los permisos por acción suelta que descarta el ADR 0007. Las operaciones propias de una app, sin cuenta, como pedir turnos o el catálogo de tools, no existen todavía. Las llaves de `voice-gateway` y de otras apps llegan con su primer consumidor. Si una segunda app recibe mandatos, su grilling decide si la delegación pasa a ser por app.

**Llaves.** Tienen la forma `domus_<id>.<secreto>`: un id público y 32 bytes aleatorios en base64url. La base guarda el SHA-256 del secreto, nunca el secreto, y la comparación es en tiempo constante. El prefijo deja que gitleaks cace una llave colada en un commit, porque el repositorio es público. Las llaves no son acciones (ADR 0008). Las gestiona un comando en el contenedor `api`, `keys`, con tres órdenes:

- `create <app>` rechaza una app fuera de la lista y escribe en stdout solo la llave, para redirigirla al fichero del secreto sin que pase por la pantalla;
- `list` muestra el id, la app, cuándo se creó, su último uso y si está revocada, nunca el secreto;
- `revoke <id>` la revoca sin borrar nunca la fila.

Las llaves no caducan. Puede haber varias vivas por app, para rotar sin cortar el servicio, y el último uso se anota como mucho una vez por minuto. `assistant` lee la suya al arrancar, de un secreto de Docker. Rotar sigue este orden:

1. crear la nueva en un fichero aparte y comprobarla;
2. guardar una copia de la vieja;
3. sustituir el fichero y recrear `assistant`, porque un reinicio no ve un fichero nuevo;
4. revocar la vieja solo cuando la nueva funciona, y si no funciona, volver a la vieja.

Una llave comprometida se revoca en el momento.

**Cómo viajan.** La llave va en `Authorization: Bearer` y el mandato en `domus-mandate`. Una petición que trae a la vez una cookie de sesión y una llave se rechaza, en vez de elegir entre las dos; las demás cookies no cuentan. Una credencial mala nunca baja a anónima. Las respuestas son estas:

- una llave desconocida, revocada o con el secreto equivocado: `UNAUTHORIZED` en todas las rutas, también en `status`;
- sin credencial, `status` sigue siendo público, y con una llave válida responde además el nombre de la app;
- una llave válida sin mandato, o con un mandato caducado, de otra app o cuyo origen ya no vive: `UNAUTHORIZED`;
- llave y mandato válidos que la delegación niega: `FORBIDDEN`, y un registro privado ajeno, `NOT_FOUND`, como en cualquier llamada.

**El mandato.** Lo emite solo la puerta, a partir de una interacción que ella autenticó, y para una sola app. Es una fila con:

- un id opaco y aleatorio, guardado como hash;
- la app para la que se emite;
- los campos del contexto verificado en columnas, como en la confirmación pendiente: la cuenta representada, el aparato, la sesión, la cuenta del aparato, cómo se acreditó la identidad y la conversación;
- su caducidad: 15 minutos por defecto, ajustable, e inválido desde el instante exacto en que caduca.

La puerta rellena el contexto a partir del mandato, con `via` igual a la app de la llave y siempre el canal `contexto`. El mandato no da permisos ni prueba que la persona apruebe nada: cada uso vuelve a pasar por la autorización. `identity` va tal cual, sin puntuación de confianza (ADR 0023), y el umbral de la voz vive en `voice-gateway` (5c).

Se guarda en la base y no es un token firmado porque tiene que morir con su origen en la siguiente petición (ADR 0023), y eso obliga a consultar la base en cada uso. Un token firmado añadiría otro secreto que custodiar sin ahorrar esa consulta. En la 1e su único origen es una sesión viva, y vale mientras esa sesión siga viva según la regla única de la plataforma. Revocarla, cerrarla, cambiar la contraseña, revocar el aparato, que la sesión caduque o restaurar lo invalidan en la siguiente petición. Los orígenes sin sesión, como Telegram o los satélites, traen su propia regla en la 5a y en la 5c. La limpieza diaria borra los mandatos caducados y los de sesiones terminadas.

El mandato es una credencial. No sale en logs, errores ni trazas. El registro de acciones anota la cuenta y `via`, nunca la llave, su id ni el mandato. Que un mandato estaba caducado o revocado solo lo distingue el log de quien opera.

**La 1e no emite mandatos.** Ninguna ruta, comando ni servicio de producción crea mandatos hasta la 5a, que los emite desde interacciones reales. Las pruebas los crean desde `@domus/platform/testing`, al que ningún código de producción llega por ninguna cadena de importaciones.

**Qué acepta un mandato.** Todas las acciones de los módulos, gobernadas por la delegación. De la plataforma, solo una lista expresa: `log/read` y `log/undo`, con la delegación vigente. Una operación nueva de la plataforma no acepta mandatos hasta que se la añade a la lista. Lo que nunca acepta un mandato:

- contraseñas, sesiones, comprobantes, acceso, delegación (tampoco `delegation/read`), aparatos, ajustes de las tareas, el aviso de prueba y las suscripciones;
- confirmar o rechazar por `app`;
- el canal en directo, porque Kira no guarda caché;
- subir y descargar archivos: la 5a decide cómo accede Kira a los adjuntos de sus conversaciones (ADR 0012), sin abrir por ello las rutas generales de archivos a los mandatos.

Una acción `manage` vía Kira no se completa, porque `proofs/request` no acepta mandatos.

**El «sí» lo reconoce la puerta.** Un mandato prueba de dónde viene un contexto, no que la persona apruebe una operación. Por eso `confirmations/confirm` nunca acepta un mandato: si Kira pudiera confirmar, un error del modelo o una instrucción colada en un correo reenviado confirmaría por la persona. Por `contexto` confirma la puerta, que recibe cada turno antes que Kira. Confirma con el contexto de ese turno cuando se cumple todo esto:

- es el turno siguiente al que creó la pendiente;
- llega a la misma conversación, en el mismo aparato y de la misma cuenta, con la ventana abierta;
- el texto que la persona escribió o dijo en ese turno es solo una afirmación de una lista cerrada, normalizada solo en mayúsculas y puntuación, sin interpretar la intención.

Ejecutar y consumir la pendiente siguen en una sola transacción. Nunca cuenta un adjunto, un mensaje reenviado ni texto de Kira. Un turno que no confirma cierra esa oportunidad por `contexto`, y la pendiente sigue en la app sus 24 h. A Kira le llega el resultado. La lista y el reconocedor llegan con la 5a; la 1e cierra `confirm` a los mandatos.

**El arranque de `assistant`.** Manda su llave también en `status`, y `@domus/utils/connection` gana un cuarto estado, rechazado. Sin llave, con una llave mala o con la de otra app, el proceso no ejecuta nada que dependa de la api, sigue vivo y vuelve a comprobar cada 30 s, como con incompatible. Listo significa una conexión autenticada y compatible, no que el proceso ya haya actuado por nadie. El criterio del ADR 0020 se prueba en la integración: el mismo `clientFor` de `assistant`, contra la puerta en proceso, ejecuta una acción con la llave y un mandato de prueba, y sin la llave da `UNAUTHORIZED`.

Fecha: 2026-11-14. Preguntas del grilling: Q1–Q21 de la fase 1e.
