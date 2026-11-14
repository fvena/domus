# En directo y avisos

## Qué es

Si Paco apunta en el tablón que la caldera hace ruido, la pantalla de Rocío debería enseñarlo sin que ella recargue nada. Para eso está el canal en directo: cada app abierta, con su sesión, mantiene una conexión con Domus, y Domus le dice por ella qué registros han cambiado.

Un aviso es otra cosa: un mensaje que llega al móvil aunque la app esté cerrada, como «Paco te ha dejado una nota». Lo lleva el servicio de avisos del navegador del móvil, el de Apple en un iPhone, y Domus solo se lo entrega.

Las pantallas que usan las dos cosas llegan con la fase 2. Lo que ya existe es todo lo de dentro, y lo hemos probado en la Pi con las notas del módulo de pruebas.

## Cómo funciona

Cuando una escritura se guarda, Domus mira qué registros cambió y quién podía verlos antes o puede verlos ahora. A cada una de esas personas le manda por su canal un aviso corto, una invalidación: «la nota 3 ha cambiado». No manda lo que dice la nota. La app vuelve a pedirla con su sesión, y los permisos de siempre deciden qué recibe. Si una escritura se deshace por un error antes de guardarse, no sale nada.

Si Paco pasa a privada una nota que Rocío veía, a Rocío también le llega la invalidación. Al volver a pedirla, Domus le responde como si no existiera, y su pantalla la quita.

El canal comprueba la sesión cada 25 segundos. Si la sesión termina, porque alguien sale, la revoca desde otro aparato o cambia su contraseña, el canal recibe la orden de borrar todo lo que tiene la app y se cierra. Si el admin cambia los permisos de una cuenta, sus canales reciben la orden de volver a pedirlo todo, y si con el cambio perdió acceso a algún área, también se cierran.

Un aviso sale de una acción de un módulo, que lo deja apuntado al guardar su cambio: «avisa a Rocío de esta nota». Domus lo manda en segundo plano, y solo si el cambio sigue en pie. Si Paco deshace la escritura antes, el aviso no sale. Cada aparato tiene como mucho una suscripción, el vínculo con el servicio de avisos de su navegador, y es la de la sesión que entró la última en él. En un portátil que usan los dos, el aviso le llega a quien esté dentro. La pantalla compartida de la cocina nunca recibe avisos.

Antes de cada envío, y en cada reintento, Domus vuelve a comprobar que la persona sigue viendo la nota y que su sesión sigue viva. Si el servicio de avisos falla, lo reintenta durante 24 horas como mucho. Si contesta que la suscripción ya no existe, la borra. La pantalla de bloqueo dice siempre «Tienes un aviso en Domus», nunca lo que dice la nota.

En el ensayo de la Pi abrimos los canales de Paco y de Rocío. Una nota pública nueva de Paco llegó a los dos en 22 milésimas, y una privada, solo a él. Cuando Paco pasó a privada una nota que Rocío acababa de leer, a ella le llegó la invalidación, y al pedirla otra vez ya no estaba. Al revocar una segunda sesión de Paco, su canal recibió la orden de borrar y se cerró en 16 milésimas. Los otros dos no notaron nada.

## Por qué es así

El canal dice qué cambió y no cómo ha quedado para no tener una segunda regla de quién ve qué. Si mandara el contenido, tendría que decidir por su cuenta qué puede ver cada uno, y sería un sitio más donde equivocarse.

El aviso vuelve a comprobarlo todo antes de cada envío porque entre apuntarlo y mandarlo pueden pasar minutos, u horas si el servicio falla. En ese tiempo, la nota puede volverse privada o la sesión cerrarse.

Una suscripción por aparato evita que, en el portátil que compartimos, a Rocío le lleguen los avisos de Paco porque él entró antes. La pantalla de bloqueo lleva siempre el mismo texto porque un móvil encima de la mesa de la cocina lo lee cualquiera, y hasta el nombre de un área, como la salud, ya cuenta algo.

## En el código

- El canal: `GET /api/events` en `packages/platform/events/`, solo con sesión, con los eventos `ready`, `invalidate`, `reset` y `purge`, un latido cada 25 s, 6 canales por sesión y una cola de 100 eventos. Quién recibe cada invalidación lo decide `packages/platform/authorization/invalidations.ts`.
- Las tablas sin dueño de un área, que ve quien tiene `read` en ella: `areaTable` de `@domus/module-sdk/db`, y en `probe` el tablón (`addBoardNote`).
- Los avisos: `packages/platform/notifications/`, con las claves VAPID en la base, las suscripciones (`GET /api/notifications/key`, `PUT` y `DELETE /api/notifications/subscription`), el reparto en entregas (`notices.ts`) y qué hacer con cada respuesta del servicio (`answers.ts`). Un módulo los pide con `ctx.notify({ to, about })`, y el aviso de prueba es `notifications/test`.
- Los trabajos que deja una escritura, la bandeja de salida, están en `packages/platform/background/` ([El trabajo en segundo plano](segundo-plano.md)).
- Toda respuesta de `/api/*` lleva `Cache-Control: no-store`, para que nada quede guardado en el navegador ([Seguridad y privacidad](seguridad.md)).
- Decisión: [ADR 0029](../architecture/adr/0029-eventos-en-directo-y-avisos.md). Las palabras [Invalidación, Aviso, Suscripción, Entrega y Tabla de área](../../GLOSSARY.md). Las comprobaciones en la Pi y el ensayo del canal: [`docs/despliegue.md`](../despliegue.md).
