# Domus

Vocabulario compartido de Domus, el organizador de una casa con Kira dentro: términos del dominio y conceptos propios de su arquitectura. Entre paréntesis, el nombre en el código.

## Personas y cuentas

**Miembro** (`member`):
Una persona de la casa con cuenta propia, cualquiera que sea su perfil.
_Evitar_: usuario, persona usuaria.

**Perfil** (`role`):
Lo que una cuenta puede hacer en general: `admin`, `member` o `device`. El perfil `member` no es lo mismo que «miembro»: Paco es miembro con perfil `admin`.
_Evitar_: rol de IA, tipo de cuenta.

**Cuenta de aparato** (`device account`):
La cuenta compartida, con perfil `device`, con la que entra un aparato que no es de una persona, como una pantalla de pared.
_Evitar_: tipo de aparato, kiosco.

**Vía Kira** (`onBehalfOf`):
Una operación que ejecuta Kira representando a un miembro o a una cuenta de aparato. Sus permisos efectivos son los del representado, rebajados por la tabla de delegación, y la auditoría guarda a los dos.
_Evitar_: suplantar, actuar como.

**Actor** (`actor`):
Quién pide una acción: la cuenta representada (un miembro o la cuenta de aparato) y, si la lleva otro, la app autenticada que la lleva, como Kira.
_Evitar_: usuario.

## Arquitectura

**Módulo** (`module`):
Un área de la vida de la casa (listas, calendario, cocina…) con sus datos, sus acciones, sus pantallas y lo que aporta a Kira.
_Evitar_: extensión, plugin, funcionalidad.

**Acción** (`action`):
Una operación con nombre que lee o cambia los datos de un módulo, con su entrada validada y autorizada siempre, la pida quien la pida. Es el único acceso a esos datos que el módulo tiene en producción. Las migraciones, la preparación de las pruebas y lo que nunca es acción (contraseñas, PIN, llaves, emparejamiento) van por otro camino.
_Evitar_: comando, endpoint.

**Registro de acciones** (`action log`):
La lista, en orden, de las escrituras confirmadas: qué acción, qué actor, qué registros tocó y, mientras dura su plazo, su entrada, su resultado y su inversa.
_Evitar_: historial, log.

**Clave de idempotencia** (`idempotencyKey`):
El nombre que quien pide una escritura da a esa operación, para que repetirla no la ejecute dos veces.
_Evitar_: id de petición.

**Inversa** (`inverse`):
La acción, con su entrada, que deshace una escritura concreta. La deja la propia escritura al ejecutarse; deshacer es ejecutar la inversa.
_Evitar_: rollback, compensación.

**Contrato** (`contract`):
La cara pública de un módulo o de la plataforma: qué acciones ofrece y la forma de su entrada y su salida.
_Evitar_: API, esquema (para el conjunto).

**Migración** (`migration`):
Un cambio de las tablas de un módulo o de la plataforma, guardado en git (las de los módulos las genera `drizzle-kit`; las pocas de la plataforma se escriben a mano, con la misma forma) y aplicado una sola vez al arrancar, en orden, y anotado en el historial. Una migración aplicada no se cambia nunca: un cambio nuevo es otra migración.
_Evitar_: script de base de datos, cambio de esquema a mano.

**Módulo de prueba** (`testOnly`):
Un módulo con todas las reglas de un módulo que solo existe para las pruebas: la lista de módulos de producción lo deja fuera. El de la fase 1 es `probe`.
_Evitar_: módulo falso, mock.

**Puerta** (`platform/http`):
El único punto de entrada a Domus: autentica cada canal y sirve las acciones.
_Evitar_: gateway, backend.
