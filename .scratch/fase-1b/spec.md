# Fase 1b: acciones

Status: ready-for-agent

Resultado del grilling de la fase 1b ([`docs/plan.md`](../../docs/plan.md)), del 2026-11-12, preguntas Q1–Q19, y del acuerdo posterior sobre los puntos de prueba. Las decisiones duraderas están en el [ADR 0022](../../docs/architecture/adr/0022-acciones.md), ya escrito; si esta spec y el ADR no coinciden, manda el ADR. El vocabulario es el de [`GLOSSARY.md`](../../GLOSSARY.md): acción, actor, registro de acciones, clave de idempotencia, inversa.

## Problema

Tras la 1a, un módulo tiene tablas y migraciones, pero su código de producción no puede leer ni cambiar nada: solo las pruebas tocan sus tablas, con `dbFor`. Cada pieza que llegue después (la web, Kira, lo compartido, las tareas programadas) necesitará cambiar datos. Si cada una se abre su propio camino, la autorización, la confirmación y el registro quedan repartidos y acaban contradiciéndose. Kira, además, necesita dos garantías del núcleo: que una operación no se repita si algo se reinicia a medias, y que lo hecho se pueda deshacer. Y hasta la 1c no hay identidad ni autorización real, pero ninguna acción puede ejecutarse sin pasar por la autorización.

## Solución

Un módulo declara sus acciones en `contracts/`, como lectura o escritura y, si es escritura, si se puede deshacer, y las implementa en `server/`. Toda invocación, venga de donde venga, recorre un solo camino en `platform`: validar la entrada, autorizar, ejecutar el manejador en una transacción síncrona, validar el resultado y registrar la escritura en el registro de acciones dentro de la misma transacción. Cada escritura lleva una clave de idempotencia: repetirla devuelve el resultado guardado y nunca ejecuta dos veces. Una escritura deshacible deja su inversa, y deshacer es una operación de la plataforma que la ejecuta por el mismo camino si nada posterior tocó lo mismo. Hasta la 1c, la autorización de producción lo deniega todo; solo las pruebas ponen un autorizador programable. Las acciones no se montan en HTTP.

## Historias de usuario

1. Como miembro, quiero que lo que cambio en Domus pase siempre por las mismas comprobaciones, lo pida desde la web, por Kira o por una tarea programada, para que no haya un camino con menos controles.
2. Como miembro, quiero que una operación que Kira repite tras un corte no se haga dos veces, para no encontrarme la leche apuntada dos veces en la lista.
3. Como miembro, quiero poder deshacer lo que acabo de hacer, para corregir un error sin rehacerlo a mano.
4. Como miembro, quiero que deshacer no borre lo que la otra persona cambió después, para no perder su trabajo sin darme cuenta.
5. Como miembro, quiero saber antes de hacer algo si no se podrá deshacer, para pensármelo.
6. Como miembro, quiero que una operación a medias no deje nada a medias, para que los datos sean siempre coherentes.
7. Como miembro, quiero que lo que Kira hace por mí quede registrado con las dos identidades, la mía y «vía Kira», para saber quién hizo qué.
8. Como miembro, quiero que el contenido de lo que hice no se guarde para siempre en el registro, para que mis datos no se acumulen sin plazo.
9. Como miembro, quiero que una operación ya hecha no se vuelva a ejecutar aunque su resultado guardado haya caducado, para que el paso del tiempo no duplique nada.
10. Como miembro, quiero que, si pierdo un permiso, un reintento no me devuelva datos que ya no puedo ver, para que la autorización valga en cada respuesta.
11. Como Kira, quiero dar a cada llamada una clave de idempotencia y reintentar con la misma, para repetir sin miedo una operación cuya respuesta no llegó.
12. Como Kira, quiero recibir el id de la entrada del registro de cada escritura, para poder deshacerla después si la persona me lo pide.
13. Como Kira, quiero que la misma clave con otra entrada dé un conflicto, para detectar mis propios errores en vez de ejecutar algo distinto.
14. Como Kira, quiero que mis claves no choquen con las de la web ni con las de otra cuenta, para que dos canales no compartan resultados.
15. Como Kira, quiero saber por el contrato si una acción lee o escribe, para decidir qué necesita clave y qué puede cambiar datos.
16. Como Kira, quiero que un resultado caducado me responda «resultado caducado» y no se ejecute de nuevo, para no convertir una operación vieja en una nueva sin que la persona lo decida.
17. Como quien escribe un módulo, quiero declarar el contrato de una acción con su entrada, su salida y sus errores, para que la web, Kira y las pruebas compartan sus tipos.
18. Como quien escribe un módulo, quiero que el contrato no arrastre Drizzle ni Node, para que el navegador pueda importarlo.
19. Como quien escribe un módulo, quiero recibir en el manejador mi base de datos, el actor y la hora, para escribir la lógica sin buscar nada por mi cuenta.
20. Como quien escribe un módulo, quiero que el tipo me obligue a devolver una inversa cuando declaro una escritura deshacible, para no olvidarla.
21. Como quien escribe un módulo, quiero declarar qué registros toca cada escritura, para que deshacer detecte los cambios posteriores.
22. Como quien escribe un módulo, quiero que mis propias reglas puedan rechazar una inversa, para proteger dependencias que no son los registros tocados.
23. Como quien escribe un módulo, quiero declarar errores propios en el contrato, para que quien llama los distinga de los de la plataforma.
24. Como quien escribe un módulo, quiero que un error en mi manejador revierta todo, para no tener que deshacer a mano lo que hice antes del fallo.
25. Como quien escribe un módulo, quiero que una lectura que intenta escribir falle, para enterarme de un descuido en las pruebas y no en producción.
26. Como quien escribe un módulo, quiero que el registro rechace dos acciones con el mismo nombre o una implementación sin contrato, para encontrar el error al arrancar.
27. Como quien escribe un módulo, quiero probar mis acciones con actores sintéticos, un autorizador programable y un reloj controlado, para cubrir permisos, reintentos y plazos sin esperar a la 1c.
28. Como quien escribe un módulo, quiero inspeccionar en las pruebas el registro de acciones, para comprobar los registros tocados, «deshecha por» y la caducidad.
29. Como quien escribe un módulo, quiero que el SDK no me ofrezca otro acceso a mis datos en producción, para que la acción sea el único camino.
30. Como quien opera Domus, quiero que en producción ninguna acción se ejecute hasta que exista la autorización real, para que el hueco hasta la 1c quede cerrado.
31. Como quien opera Domus, quiero que una denegación o un error del autorizador impidan ejecutar el manejador, para que la autorización falle siempre cerrada.
32. Como quien opera Domus, quiero que la migración del registro se aplique en la Pi sobre la base existente y no cambie al reiniciar, para saber que la actualización es segura.
33. Como quien opera Domus, quiero que una excepción inesperada salga como error interno sin detalle, para que no se filtre nada por un mensaje de error.
34. Como quien opera Domus, quiero que `status` siga siendo la única RPC pública, para que la 1b no abra nada nuevo hacia fuera.
35. Como quien opera Domus, quiero que deshacer, su registro y el enlace «deshecha por» se confirmen juntos, para que un fallo a medias no deje una entrada deshecha sin su deshacer.
36. Como quien opera Domus, quiero que cambiar el plazo del registro solo afecte a las entradas nuevas, para que ampliar el plazo no haga reaparecer contenido ya caducado.

## Decisiones de implementación

### Contratos (Q3, Q14, Q15)

- Nueva entrada pura de `module-sdk` para contratos, sin Drizzle, sin Node y sin el resto del SDK. Ofrece dos ayudantes mínimos sobre el contrato de oRPC: uno para lecturas y otro para escrituras. Solo añaden las convenciones de Domus como metadatos: el tipo (lectura o escritura) y, en una escritura, si se puede deshacer. Entrada, salida y errores propios son los de oRPC, con zod.
- El contrato de un módulo es un objeto con sus acciones por nombre. El nombre completo de una acción es `<módulo>.<acción>`.
- Las reglas de dependencias dejan que `contracts/` de un módulo importe esa entrada, y comprueban que no alcanza, ni de forma transitiva, Drizzle, Node ni otras partes del SDK.

### Implementación y definición del módulo (Q1, Q4, Q14)

- `server/` implementa cada acción de su contrato con un manejador síncrono. `defineModule` añade `actions`: la implementación del contrato del módulo.
- El manejador recibe un contexto con la entrada ya validada, la base de datos del módulo (su cliente de Drizzle sobre la transacción en curso), el actor y la hora del reloj de la plataforma. Es el único sitio donde el código de producción de un módulo obtiene su base de datos; el SDK no exporta otra forma de conseguirla. Que un manejador no guarde el contexto para usarlo después es disciplina comprobada en la revisión.
- Un manejador de lectura devuelve su resultado. Uno de escritura devuelve su resultado, los registros que tocó (tipo e id, dentro de su módulo) y, si su contrato la declara deshacible, su inversa. El tipo exige la inversa solo cuando la escritura es deshacible.
- La inversa nombra una acción del mismo módulo y su entrada. Una inversa hacia otro módulo se rechaza: la 1b no implementa llamadas entre módulos (Q6).
- Al registrar los módulos, la plataforma comprueba que cada acción del contrato tiene implementación, que no hay implementaciones sin contrato y que no se repite ningún nombre completo. Falla al arrancar, nombrando el módulo y la acción.

### El recorrido (Q1, Q2, Q4, Q10, Q13)

Una pieza nueva de `platform`, `actions`, ejecuta cada invocación en una sola secuencia:

1. Busca la acción por su nombre completo; si no existe, no encontrado.
2. Valida la entrada con el contrato; si no vale, entrada no válida. La entrada validada tiene que ser JSON sin pérdida (ver «Valores persistidos»).
3. **Lectura**: pide la decisión a `authorization`; si deniega o lanza, termina sin ejecutar. Ejecuta el manejador con `PRAGMA query_only` activado y lo restaura en un `finally`. Valida el resultado y lo devuelve. No lleva clave ni registra nada.
4. **Escritura**: exige la clave de idempotencia (sin ella, entrada no válida) y calcula la huella. Después abre una transacción de `better-sqlite3`, que abre y confirma `actions`, y dentro de ella, sin salir de una sola sección síncrona:
    1. Busca la entrada del registro para esa cuenta, `via` y clave.
    2. Si existe y su huella es otra: conflicto `key-reused`.
    3. Si existe con la misma huella: pide la decisión a `authorization`; si deniega o lanza, no permitido y no entrega nada. Si permite y el contenido está vigente, devuelve el resultado guardado y el mismo número de entrada; si caducó, conflicto `result-expired`. En ningún caso ejecuta el manejador.
    4. Si no existe: pide la decisión a `authorization`; si deniega o lanza, termina sin ejecutar. Ejecuta el manejador, valida el resultado, valida la inversa y `audit` escribe la entrada del registro y sus registros tocados. Devuelve el resultado y el número de la entrada; la inversa nunca sale.

    Cualquier fallo dentro de la transacción, errores de dominio incluidos, revierte el cambio y la entrada.

La inversa es válida si nombra una acción **de escritura** del mismo módulo y su entrada pasa el contrato de esa acción y es JSON sin pérdida. Una inversa hacia una lectura, hacia una acción desconocida o hacia otro módulo revierte la escritura original.

El autorizador es síncrono, porque se consulta dentro de la transacción.

Errores comunes de la plataforma, sobre los códigos de oRPC: entrada no válida, no permitido, no encontrado, conflicto con un motivo (`key-reused`, `changed-since`, `already-undone`, `result-expired`) y no se puede deshacer con un motivo (`irreversible`, `expired`). Los errores propios que declara un contrato salen tal cual. Cualquier otra excepción sale como error interno, sin el mensaje ni la pila.

### Autorización hasta la 1c (Q2)

- `platform/authorization` es el único sitio de la decisión. Su interfaz recibe la petición descrita arriba y responde permitir o denegar; la 1c añadirá pedir confirmación y la decisión real.
- `createPlatform` usa siempre el autorizador de producción, que en la 1b lo deniega todo. No admite otro autorizador ni ninguna opción que lo permita todo.
- La entrada de pruebas de `platform` construye una plataforma con un autorizador y un reloj dados. Una regla de dependencias deja que solo `test-utils` la importe, como ya ocurre con `dbFor`.

### Actor (Q11)

- El actor es la cuenta representada y, opcionalmente, `via`, la app autenticada que lleva la petición. Los dos son identificadores opacos en la 1b. La 1c los sacará de la autenticación.
- `test-utils` fabrica actores sintéticos y permite probar la diferencia entre la misma cuenta con y sin `via`, y con `via` distintas.

### Registro de acciones (Q5, Q9, Q12, Q17, Q18)

- Una pieza nueva de `platform`, `audit`, sobre una migración nueva escrita a mano, `platform/0001`, que no toca `0000`. `audit` usa sentencias preparadas de `better-sqlite3`, sin esquema de Drizzle, y nunca confirma por su cuenta.
- Cada entrada tiene un número de secuencia creciente y persistente, que define «posterior», y dos partes:
    - **Anotación**: módulo y acción, cuenta, `via`, clave, huella de la petición, instante, `expiresAt`, «deshace a» (si la entrada es un deshacer) y «deshecha por».
    - **Contenido**: entrada, resultado e inversa. La limpieza física del contenido caducado llega con la 1d; hasta entonces el contenido caducado sigue en disco pero no se usa.
- Los registros tocados de cada entrada (módulo, tipo e id) se guardan aparte, con un índice para buscar las entradas posteriores que tocaron el mismo registro.
- La clave es única por cuenta, `via` y clave, con una restricción única en SQLite; la ausencia de `via` cuenta como un valor propio.
- `expiresAt` se calcula al confirmar: instante más el plazo. El plazo es una opción de la plataforma, 30 días por defecto, y cambiarlo solo afecta a las entradas nuevas.
- El reloj de la plataforma da los instantes en milisegundos desde el epoch, como fija el ADR 0021. El contenido está caducado cuando `now >= expiresAt`.

### Valores persistidos

- La entrada validada, el resultado y la entrada de la inversa tienen que ser JSON sin pérdida: objetos simples, listas, textos, números finitos, booleanos y `null`. Se comprueba que el valor, convertido a JSON y leído de nuevo, es igual en profundidad al original. Así se rechazan `undefined` en una propiedad, `Date`, `bigint`, `NaN`, `Map` y similares.
- Una entrada que no cumple es entrada no válida. Un resultado o una inversa que no cumplen son un error interno y revierten la escritura.
- Las transformaciones que haga el esquema de una entrada tienen que ser deterministas, para que un reintento produzca la misma entrada validada y la misma huella.
- El resultado que se recupera del registro en una repetición es igual en profundidad al que se devolvió la primera vez.

### Idempotencia (Q7, Q17)

- La huella de una invocación es el nombre completo de la acción más el SHA-256 de la entrada validada en una forma canónica de JSON (claves ordenadas), de modo que el orden de las propiedades no cambia la huella.
- Buscar la clave, ejecutar e insertar la entrada forman una sola sección síncrona dentro de la transacción, como describe «El recorrido».
- Misma clave y misma huella, contenido vigente: se vuelve a autorizar y se devuelve el resultado guardado y el mismo número de entrada, sin ejecutar. Si se deniega, no se entrega nada.
- Misma clave y misma huella, contenido caducado: conflicto `result-expired`, sin ejecutar. Nunca se reintenta solo con otra clave.
- Misma clave con otra huella (otra acción u otra entrada): conflicto `key-reused`.
- Una escritura sin clave se rechaza como entrada no válida.
- Un intento revertido no deja ni entrada ni clave, y se puede repetir con la misma.

### Deshacer (Q8, Q9, Q15)

- Una operación de la plataforma, `undo`, recibe el actor, el número de una entrada y una clave de idempotencia propia. Nunca acepta una inversa que traiga quien llama.
- La huella de `undo` es la propia operación más el número de la entrada. Un reintento de `undo` con la misma clave y la misma entrada devuelve el resultado anterior; invocar directamente la acción inversa con esa misma clave es otra huella y da `key-reused`.
- Dentro de una sola transacción y una sola sección síncrona:
    1. Busca la clave como en «El recorrido», con la huella de `undo`: otra huella, `key-reused`; misma huella, reautoriza y devuelve el resultado guardado o `result-expired`.
    2. Si la entrada ya tiene «deshecha por», conflicto `already-undone`.
    3. Si su escritura no es deshacible, no se puede deshacer `irreversible`; si su contenido caducó, `expired`.
    4. Si alguna entrada posterior tocó alguno de sus registros, conflicto `changed-since`, aunque esa entrada posterior se haya deshecho después.
    5. Pide la decisión a `authorization` para la acción inversa, con el contexto de la entrada original. Ejecuta la inversa por dentro, con sus validaciones y las reglas del módulo, sin abrir otra operación idempotente ni otra transacción.
    6. Escribe **una sola entrada nueva**: con la clave y la huella de la petición `undo`, la acción inversa que se ejecutó con su entrada, resultado, registros tocados e inversa propia, y «deshace a» la original. Marca la original con «deshecha por».
- Rehacer es deshacer la entrada del deshacer, y solo es posible si la inversa también dejó otra.

### `test-utils` y la entrada de pruebas de `platform`

- `createTestPlatform` gana un autorizador programable (permite, deniega o lanza, y se puede cambiar entre llamadas), un reloj controlable y la fabricación de actores. Sigue aceptando `file`; para probar reinicios se usa una ruta explícita, porque con `file: true` el directorio se borra al cerrar.
- Ofrece `invoke` y `undo`, que delegan en el recorrido real de `platform`: `test-utils` no repite la validación, la transacción ni la idempotencia. Los nombres de acción y sus tipos de entrada y salida salen de los módulos que recibe, sin una firma genérica de texto. Una lectura no lleva clave ni devuelve número de entrada; una escritura exige clave y devuelve resultado y número de entrada.
- Ofrece `log()`, que devuelve una instantánea de solo lectura del registro, con el contenido aunque haya caducado. Esa excepción es solo de las pruebas.
- La entrada de pruebas de `platform`, que ya existe, se amplía con la construcción con autorizador y reloj y con la lectura del registro.

### `probe` (Q15, Q19)

Acciones nuevas en su contrato, con sus tipos de registro `note` y `comment`:

- Lecturas: `listNotes` y `getNote`.
- `addNote`: deshacible; su inversa es `deleteNote`.
- `editNote`: deshacible; su inversa es `editNote` con el texto anterior.
- `deleteNote`: deshacible; su inversa es `restoreNote` con el mismo id y texto. Rechaza borrar una nota con comentarios con un error propio del contrato.
- `restoreNote`: deshacible; su inversa es `deleteNote`.
- `addComment`: deshacible; toca solo el comentario, y su inversa es `deleteComment`.
- `deleteComment`: irreversible. Por eso, deshacer `addComment` funciona y rehacerlo no.

Con esto, deshacer `addNote` después de añadir un comentario a la nota lo rechaza la regla del módulo, aunque ninguna entrada posterior haya tocado la nota.

### Puerta, `apps/api` y la Pi

- La puerta sigue recibiendo `platform` y la lista de módulos sin montar acciones: `status` sigue siendo la única RPC.
- `apps/api` no cambia su composición; arranca con `platform/0001` aplicada.
- `docs/despliegue.md` amplía la comprobación de la 1a: la fila de `platform/0001` conserva posición, hash e instante de aplicación tras `restart` y tras recrear `api`, y `status` sigue siendo la única RPC.

## Decisiones de prueba

- Una buena prueba comprueba el comportamiento visible desde fuera: lo que devuelven `invoke` y `undo`, lo que leen después las lecturas del módulo y, solo cuando no hay otra forma de verlo, la instantánea de `log()`. No comprueba sentencias SQL, nombres de columnas ni llamadas internas. Cada garantía se prueba una vez, en el nivel más pequeño que pueda romperla.
- **`createTestPlatform` con `probe`** (en las pruebas de `probe`), el punto principal:
    - Validación: entrada no válida rechazada; escritura sin clave rechazada.
    - Autorización: denegación y excepción del autorizador sin ejecutar el manejador; un reintento con la misma clave tras revocar no entrega el resultado; deshacer se deniega igual.
    - Atomicidad: un error de dominio (borrar una nota con comentarios) no deja ni cambio ni entrada.
    - Valores persistidos: el resultado recuperado en una repetición es igual en profundidad al primero.
    - Idempotencia: el reintento devuelve el mismo resultado y número sin ejecutar; misma clave con otra acción y con otra entrada dan `key-reused`; reordenar las propiedades no da conflicto; misma clave en otra cuenta, con otra `via` o sin `via` son operaciones distintas; tras revertir, la misma clave se ejecuta; tras cerrar y abrir sobre fichero, la misma clave no se ejecuta.
    - Deshacer: funciona para crear, editar y borrar; un cambio posterior bloquea con `changed-since`, también si después se deshizo; la regla del módulo rechaza deshacer `addNote` con comentarios; la escritura irreversible da `irreversible`; dos veces con la misma clave devuelve el resultado anterior y con otra da `already-undone`; invocar directamente la inversa con la clave de un `undo` da `key-reused`; rehacer funciona cuando la inversa es deshacible y no cuando no lo es; la inversa no aparece en ningún resultado.
    - Caducidad: con el reloj, un milisegundo antes de `expiresAt` se repite y se deshace, y en `expiresAt` exacto y después se responde `result-expired` y `expired`; cambiar el plazo no altera las entradas existentes; tras caducar y reiniciar sobre fichero, la clave sigue sin ejecutarse.
    - Prior art: las pruebas de almacenamiento de `probe` y las de `test-utils` de la 1a.
- **Pruebas de `platform`**, con definiciones escritas dentro de la propia prueba, como en las del ejecutor de migraciones:
    - `createPlatform` deniega toda acción con su configuración de producción.
    - Registro de definiciones: nombre repetido, acción sin implementación e implementación sin contrato.
    - Con la construcción de pruebas y un autorizador que permite: una lectura que intenta escribir falla y deja `query_only` desactivado, de modo que una escritura legítima posterior funciona; resultado no válido, resultado o inversa que no son JSON sin pérdida, entrada con `undefined` en una propiedad, inversa ausente cuando es obligatoria, inversa hacia una lectura, hacia una acción desconocida o de otro módulo, entrada de la inversa no válida y un fallo al escribir el registro revierten el cambio y la entrada; una excepción inesperada sale como error interno sin detalle; deshacer revierte junto la inversa, su entrada y «deshecha por» si algo falla.
    - Migraciones: `0001` se aplica sobre una base que solo tiene `0000` y las consultas del registro funcionan sobre las tablas reales.
    - Prior art: las pruebas de la plataforma y del ejecutor de migraciones de la 1a.
- **Pruebas de `tooling`**:
    - `real-modules.test.ts`: la composición completa sigue funcionando y la lista de migraciones aplicadas incluye `platform/0001`. No repite las pruebas del registro.
    - `architecture.test.ts` y sus fixtures: la entrada de contratos de `module-sdk` no alcanza Drizzle, Node ni el resto del SDK; solo `test-utils` importa la entrada de pruebas de `platform`. Además, una comprobación de las exportaciones del SDK demuestra que no ofrece otra forma de obtener la base de datos de un módulo. Que un manejador no guarde su contexto queda como disciplina comprobada.
- Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check`, `pnpm test` y `pnpm build`, y `pnpm db:generate && pnpm modules:generate` dejan `git status --porcelain` vacío.

## Fuera de alcance

- Montar las acciones en HTTP y la llamada desde la web con `clientFor`: llegan con la autorización real (1c).
- Identidad, autorización real, confirmación (incluido «siempre pide confirmación»), visibilidad, quién lee el registro y si se registra alguna lectura: 1c.
- Llamadas entre acciones de módulos y acciones con efectos fuera de SQLite: con su primer caso real.
- Un mecanismo general de olvido y el borrado de datos privados del registro: antes de admitir datos privados reales (fase 4 y 6).
- La limpieza física del contenido caducado y el actor de las tareas programadas: 1d.
- Guardar la clave con el turno de Kira: 5b.
- `@domus/utils/date-time`, `instant()` y `localDate()`: con su primer uso real; los instantes del registro son milisegundos de un reloj inyectado.
- Pasar las migraciones de la plataforma a `drizzle-kit`: se decide en la 1c.

## Notas

- Los documentos de arquitectura, el glosario y el plan ya están al día (commit del grilling); a diferencia de la 1a, no hace falta una tarea de documentos al principio. Al cerrar la subfase se actualiza su estado en el plan y se revisa `docs/guia/` según `docs/AGENTS.md`.
- La 1b no cambia nada que vea la familia; la guía puede necesitar solo una mención en su parte de arquitectura.

## Tareas

| Tarea                                           | Qué                                     | Bloqueada por |
| ----------------------------------------------- | --------------------------------------- | ------------- |
| [01](issues/01-una-lectura-de-punta-a-punta.md) | Una lectura de `probe` de punta a punta | —             |
| [02](issues/02-escrituras-con-su-registro.md)   | Escrituras con su registro              | 01            |
| [03](issues/03-idempotencia.md)                 | Idempotencia                            | 02            |
| [04](issues/04-deshacer.md)                     | Deshacer                                | 03            |
| [05](issues/05-caducidad.md)                    | Caducidad del contenido del registro    | 04            |
| [06](issues/06-la-pi-y-el-cierre.md)            | La Pi y el cierre de la 1b              | 05            |
