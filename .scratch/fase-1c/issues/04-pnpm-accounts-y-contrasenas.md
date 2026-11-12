# 04. `pnpm accounts` y cambiar la contraseña

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «Cuentas y Better Auth» y «Aparato y sesión» (mis sesiones). ADR 0023.

## Qué construir

Un único procedimiento para crear cuentas y recuperarlas, y la gestión de las sesiones propias:

- **`pnpm accounts`**, en el contenedor `api`, crea una cuenta (`admin` o `member`) y cambia una contraseña.
    - El secreto se pide de forma interactiva, sin eco. El análisis de argumentos rechaza la contraseña como argumento, y ni la salida ni los errores la incluyen.
    - Cambiar una contraseña con el comando revoca **todas** las sesiones de la cuenta.
    - Su núcleo es una función que recibe la plataforma, una forma de pedir el secreto y una salida.
- **Cambiar la propia contraseña desde la app**: es una operación de la plataforma que pide la actual y conserva **solo** la sesión actual.
- **Mis sesiones**: listar las propias, con su aparato, y cerrar la actual. Revocar otras sesiones exige comprobante y llega con la 09.

Los dos caminos de cambiar la contraseña invalidan también las pendientes y los comprobantes de la cuenta. Esas pruebas se completan en la 08 y la 09, cuando existan esas piezas.

## Aceptación

- [ ] **Núcleo del comando,** con un proveedor falso del secreto y una salida capturada: crea `admin` y `member`; rechaza un correo repetido; cambiar la contraseña revoca todas las sesiones; ni la salida ni los errores contienen el secreto.
- [ ] **Argumentos:** la prueba del análisis rechaza recibir la contraseña como argumento.
- [ ] **HTTP:**
    - cambiar la contraseña desde la app pide la actual y conserva solo la sesión actual;
    - una sesión revocada falla en la petición siguiente;
    - listar sesiones devuelve solo las propias;
    - dos personas en el mismo navegador: al cambiar de cuenta se conserva el aparato y ninguna sesión de la primera pasa a la segunda.
- [ ] Pasan todas las comprobaciones y el build.
