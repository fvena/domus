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

**Aparato** (`device`):
Un navegador instalado o un satélite desde el que se usa Domus. Sobrevive a cerrar sesión y puede cambiar de cuenta. No es la cuenta de aparato: un móvil de Paco es un aparato que entra con la cuenta de Paco.
_Evitar_: dispositivo, terminal.

**Área** (`area`):
Una parte de la vida de la casa a la que se da o se quita permiso. Por defecto, cada módulo es un área.
_Evitar_: sección, categoría.

**Permiso** (`permission`):
Lo que una cuenta puede hacer en un área: nada, ver (`read`), editar (`write`) o administrar (`manage`). Cada nivel incluye los anteriores.
_Evitar_: capacidad, rol.

**Tabla de delegación** (`delegation`):
Lo que una cuenta deja hacer a Kira en su nombre, área por área: solo puede rebajar sus permisos o pedir confirmación, nunca ampliarlos. Es de su persona; la de la cuenta de aparato la lleva el admin.
_Evitar_: perfil de IA, permisos de Kira.

**Sesión** (`session`):
Una entrada de una cuenta desde un aparato. Un mismo aparato puede guardar sesiones de varias cuentas, y revocar una no toca las demás.
_Evitar_: login, conexión.

**Visibilidad** (`visibility`):
Si un registro con dueño lo ve solo su dueño (privado) o toda la casa (público). Ser público deja verlo, no editarlo.
_Evitar_: compartido, nivel de acceso.

**Confirmación pendiente** (`pending confirmation`):
Una operación exacta que la autorización ha detenido hasta que su persona diga que sí. Caduca, se usa como mucho una vez y no la confirma otra persona ni otra conversación.
_Evitar_: aprobación, propuesta.

**Comprobante** (`step-up proof`):
La prueba, renovada con la contraseña, de que una persona aprueba una operación sensible concreta. Vale solo para esa operación y una vez.
_Evitar_: sesión reciente, reautenticación.

## Arquitectura

**Módulo** (`module`):
Un área de la vida de la casa (listas, calendario, cocina…) con sus datos, sus acciones, sus pantallas y lo que aporta a Kira.
_Evitar_: extensión, plugin, funcionalidad.

**Acción** (`action`):
Una operación con nombre que lee o cambia los datos de un módulo, con su entrada validada y autorizada siempre, la pida quien la pida. Es el único acceso a esos datos que el módulo tiene en producción. Las migraciones, la preparación de las pruebas y lo que nunca es acción (contraseñas, PIN, llaves, emparejamiento) van por otro camino.
_Evitar_: comando, endpoint.

**Registro de acciones** (`action log`):
La lista, en orden, de las escrituras confirmadas: qué acción, qué actor, qué registros tocó y, mientras dura su plazo, su entrada y su inversa. Nunca guarda el resultado.
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
Un cambio de las tablas de un módulo o de la plataforma, guardado en git (las genera `drizzle-kit`, salvo las dos primeras de la plataforma, escritas a mano con la misma forma) y aplicado una sola vez al arrancar, en orden, y anotado en el historial. Una migración aplicada no se cambia nunca: un cambio nuevo es otra migración.
_Evitar_: script de base de datos, cambio de esquema a mano.

**Módulo de prueba** (`testOnly`):
Un módulo con todas las reglas de un módulo que solo existe para las pruebas: la lista de módulos de producción lo deja fuera. El de la fase 1 es `probe`.
_Evitar_: módulo falso, mock.

**Puerta** (`platform/http`):
El único punto de entrada a Domus: autentica cada canal y sirve las acciones.
_Evitar_: gateway, backend.
