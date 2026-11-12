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

## Arquitectura

**Módulo** (`module`):
Un área de la vida de la casa (listas, calendario, cocina…) con sus datos, sus acciones, sus pantallas y lo que aporta a Kira.
_Evitar_: extensión, plugin, funcionalidad.

**Acción** (`action`):
Una operación con nombre que cambia o lee datos de Domus, con entrada validada, autorizada siempre y registrada en la auditoría, la pida quien la pida.
_Evitar_: comando, endpoint.

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
