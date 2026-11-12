# Las acciones

## Qué es

Una acción es una operación con nombre que lee o cambia los datos de un módulo, como «ver las notas» o «añadir una nota». Es la única forma que tiene un módulo de tocar sus datos, y el camino es el mismo para cualquiera que la pida.

Hoy solo tiene acciones probe, el módulo de prueba. En la Pi la autorización dice que no a todo y la puerta no ofrece ninguna acción, así que solo las ejecutan las pruebas.

## Cómo funciona

Cada módulo declara sus acciones y dice de cada una si solo lee o si cambia algo. A las que cambian algo las llamamos escrituras, y cada escritura dice además si se puede deshacer.

Todas recorren los mismos pasos. Se comprueba que lo que llega tiene la forma que la acción espera, se pregunta si quien la pide puede hacerla, se ejecuta y se comprueba lo que devuelve. Una lectura no puede cambiar nada mientras corre.

Una escritura sale entera o no sale. El cambio se guarda junto con su anotación en el registro de acciones, que es la lista, en orden, de todas las escrituras: qué acción fue, quién la pidió, qué datos tocó y cuándo. Si algo falla por el camino, no queda ni el cambio ni la anotación.

Cada escritura lleva una clave que elige quien la pide. Si se corta la conexión y no sabe si llegó, la vuelve a pedir con la misma clave. Si ya se hizo, Domus no la repite: devuelve el resultado de la primera vez. Si con esa clave llega otra petición, responde que la clave ya está usada. A esto se le llama idempotencia: pedir lo mismo dos veces deja la casa igual que pedirlo una.

Una escritura que se puede deshacer deja guardada su inversa, la acción que la deshace. La de añadir una nota es borrarla. Deshacer ejecuta esa inversa por el mismo camino que cualquier otra acción, con su propia clave y su propia anotación, y las dos anotaciones quedan enlazadas. Rehacer es deshacer lo deshecho.

No todo se puede deshacer. Si después de añadir la nota alguien la editó, deshacer el alta ya no vale, porque se llevaría por delante esa edición. La inversa también tiene que cumplir las reglas del módulo: si la nota tiene comentarios, borrarla se rechaza. Y las escrituras que no se pueden deshacer, como borrar un comentario, lo declaran antes de ejecutarse.

Lo que entró, lo que salió y la inversa de cada escritura se guardan 30 días. Pasado ese plazo no se devuelven ni se pueden deshacer, y repetir la petición con la misma clave responde que el resultado ha caducado, sin ejecutar nada. La anotación de qué se hizo y quién lo hizo se queda.

## Por qué es así

Con un solo camino, el permiso se decide en un único sitio y no hay una puerta trasera que se lo salte.

Las conexiones se cortan. Sin la clave, un reintento podría apuntar dos veces lo mismo.

Quien deshace no elige qué hacer: ejecuta lo que dejó la propia escritura. Así nadie puede colar otra operación disfrazada de deshacer.

Y guardar para siempre todo lo que entra y sale de cada acción sería acumular datos privados que nadie necesita.

## En el código

- Contratos: `modules/<id>/contracts/`, con `readAction` y `writeAction({ undoable })` de `@domus/module-sdk/contracts`. Cada acción se llama `<módulo>.<acción>` y se implementa en `actions` de `defineModule`, en `server/`.
- El camino: `packages/platform/actions` valida, autoriza, ejecuta la escritura en una transacción y la registra; ahí viven también la clave, deshacer y la caducidad.
- La autorización: `packages/platform/authorization`, que en producción lo deniega todo.
- El registro: `packages/platform/audit`, sobre las tablas `platform_action_log` y `platform_action_log_touched` de la migración `platform/0001`.
- El plazo: la opción `retention` de `createPlatform`, en milisegundos, con 30 días por defecto.
- Probar: `createTestPlatform` de `@domus/test-utils`, con `authorize`, `clock`, `actor`, `invoke`, `undo` y `log()`. Las pruebas de probe están en `modules/probe/tests/`.
- Decisiones: [ADR 0010](../architecture/adr/0010-una-sola-decision-de-autorizacion.md) y [ADR 0022](../architecture/adr/0022-acciones.md).
