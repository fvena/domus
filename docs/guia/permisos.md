# Los permisos

## Qué es

Qué puede hacer cada cuenta, qué puede hacer Kira en nombre de cada persona y quién ve cada registro. Lo decide una sola pieza de Domus, la autorización, para todas las acciones, vengan de la app o de Kira.

## Cómo funciona

La casa se reparte en áreas. Cada módulo es una, y puede partirse en otras más finas, como la salud dentro de probe. En cada área, una cuenta puede no hacer nada, ver, editar o administrar. Cada nivel incluye los anteriores: quien edita la compra también la ve. Cada acción dice qué nivel de qué área necesita, y Domus revisa al arrancar que todas lo digan.

Paco, como admin, administra todas las áreas y nadie se lo puede quitar. Él decide hasta dónde llega Rocío en cada área y hasta dónde llega la cuenta de aparato. Nadie puede subirse su propio acceso. Lo de cada cuenta consigo misma, su tabla de delegación, sus sesiones y su registro de acciones, queda fuera de esos permisos: ni el admin puede bloquearlo.

Kira no tiene cuenta propia. Cuando habla por alguien, usa los permisos de esa persona, rebajados por su tabla de delegación: lo que esa persona deja hacer a Kira en su nombre. En cada área y nivel la respuesta es «no», «sí» o «pregúntame antes». Rocío puede dejar que Kira lea su calendario sin preguntar y pedir que confirme antes de cambiar nada. La tabla nace copiando lo que la persona puede ver y editar, sin administrar nada. Cada persona edita la suya, el admin no la ve, y Kira no puede cambiar ninguna.

Además, cada registro con dueño es privado o público. Uno privado solo lo ve su dueño. Uno público lo ve toda la casa, pero sigue editándolo solo su dueño, salvo que el área diga otra cosa. Solo el dueño cambia la visibilidad, y el dueño no cambia nunca. Si Rocío busca una nota privada de Paco, Domus le responde lo mismo que si no existiera. La salud es siempre privada: no hay forma de guardar un registro de salud público.

Solo hay un caso en que se nota algo que no ves. Si Rocío deja un comentario privado en una nota pública de Paco, Paco no puede borrar la nota mientras el comentario siga ahí, y Domus le dice solo que tiene comentarios: ni cuántos, ni de quién, ni qué dicen. Y eso solo se lo dice a quien podría borrar la nota; a los demás les responde como siempre.

Para ver, la autorización le da al módulo un filtro y el módulo lo aplica en cada consulta. Para cambiar, Domus no se fía solo del módulo: mientras dura la escritura anota cada fila que se crea, se edita o se borra, y antes de guardar comprueba que se respetan el dueño y la visibilidad. Si algo no cuadra, no se guarda nada.

A veces la respuesta es «pregúntame antes». Entonces la operación no se hace y queda como confirmación pendiente: la operación exacta, quién la pidió y desde dónde. La persona la confirma o la rechaza desde la app durante 24 horas. Por voz, un «sí» solo vale en el mismo aparato, en la misma conversación y durante el minuto siguiente. La salud en una pantalla compartida, como la de la cocina, es la excepción: allí solo vale ese «sí» por voz, y pasado el minuto la pendiente caduca. Desde el móvil no se confirma: quien quiera ese dato lo pide otra vez desde allí, y entonces lo ve en el móvil y no en la cocina. Al confirmar se vuelve a comprobar todo, y confirmar dos veces la ejecuta una sola vez.

Hoy las acciones con registros con dueño son las de probe, el módulo de prueba.

## Por qué es así

Con una sola pieza que decide, no hay dos sitios que puedan dar respuestas distintas, ni una puerta trasera.

La tabla de Kira solo puede quitar permisos. Aunque Kira entienda mal una frase, nunca hará algo que la persona no pueda hacer por sí misma.

Responder «no existe» a lo privado ajeno evita que la otra persona sepa siquiera que hay algo.

Comprobar las escrituras al guardar, y no solo fiarse de cada módulo, hace que un fallo en un módulo no acabe enseñando lo privado de nadie.

## En el código

- La decisión: `decide` en `packages/platform/authorization`, una función pura sobre perfiles, filas de permisos, delegación y áreas.
- Áreas y niveles: `areas` en `defineModule` y `level` en `readAction` y `writeAction` de `@domus/module-sdk/contracts`. Permisos en `platform_roles` y `platform_permissions`; delegación en `platform_delegation`.
- Visibilidad: las tablas con dueño se declaran con las columnas comunes de `@domus/module-sdk/db`, y la captura de escrituras usa triggers temporales de SQLite.
- Confirmaciones: `platform_confirmations`, con `CONFIRMATION_REQUIRED` como respuesta y `confirmations/confirm` y `/reject` por HTTP.
- Leer la delegación: `delegation/read`. Cambiar permisos y delegación: `permissions/set` y `delegation/set`, que piden comprobante ([Las cuentas y las sesiones](cuentas.md)). `permissions/set` no acepta el área `platform`.
- Pruebas: las de `modules/probe/tests/` y `packages/platform/authorization`.
- Decisiones: [ADR 0007](../architecture/adr/0007-perfiles-y-permisos-si-o-no.md), [ADR 0008](../architecture/adr/0008-la-ia-como-filtro-de-delegacion.md), [ADR 0009](../architecture/adr/0009-visibilidad-privado-o-publico.md), [ADR 0010](../architecture/adr/0010-una-sola-decision-de-autorizacion.md), [ADR 0023](../architecture/adr/0023-identidad-y-autorizacion.md) y [ADR 0024](../architecture/adr/0024-bloqueo-referencial-al-borrar.md), el bloqueo al borrar.
