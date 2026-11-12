# 03. Entrar por HTTP y una lectura permitida de punta a punta

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), secciones «Cuentas y Better Auth» (sin el comando), «Aparato y sesión» (alta del aparato), «El contexto verificado», «Áreas, permisos y perfiles» (sin cambiar permisos), «La decisión» (pasos 1 y la denegación), «HTTP y la puerta» y «`module-sdk`, `test-utils` y la entrada de pruebas». ADR 0023.

## Qué construir

El trazador de la 1c: una persona inicia sesión por HTTP y ejecuta una lectura de `probe` por `api-client`, que recorre la autorización real.

Piezas que llegan con esta tarea:

- **Cuentas.**
    - Better Auth en `platform` con correo y contraseña, sus tablas en el esquema de la plataforma, el registro abierto desactivado y la sesión sin caché en la cookie.
    - El perfil de cada cuenta.
    - La única cuenta de aparato, creada al arrancar sin contraseña.
- **Aparato y contexto.**
    - El aparato, con su cookie propia. Nace al iniciar sesión si falta y se conserva al cerrar sesión y volver a entrar. La sesión guarda en el servidor su aparato.
    - El contexto verificado: la puerta lo construye desde la sesión e ignora lo que declare el cliente. Por HTTP, `via` va siempre vacío, el canal es `app` y la identidad es `password`.
- **Permisos.**
    - Las áreas, que declara el módulo, con la de la plataforma.
    - El permiso declarado en cada contrato (área y nivel), comprobado al arrancar.
    - La decisión pura por área y nivel, con los valores por defecto de cada perfil y la sustitución por fila.
    - La autorización de producción, que sustituye a la que lo denegaba todo.
- **Puerta.** Las acciones y las rutas de Better Auth montadas en la puerta. Sin sesión, no autenticado.
- **Pruebas.** `createTestPlatform` con la autorización real por defecto, la preparación privilegiada (cuentas, perfiles y filas de permisos) y los contextos verificados sintéticos. El autorizador programable queda solo para las pruebas internas de `platform`.
- **`probe`.** Declara su área y el permiso de cada acción.

Ningún estado intermedio abre lo que todavía no está protegido: en esta tarea todavía no existen tablas con dueño. La 05 rechaza en producción los módulos que las tengan hasta que la 06 añade la captura.

## Aceptación

- [ ] **Unitarias de la decisión:** niveles acumulativos, valores por defecto por perfil, sustitución por fila, el admin no baja de `manage`, y una excepción deniega.
- [ ] **Al arrancar** se rechazan: un área no registrada, una escritura con `read` y una acción sin permiso.
- [ ] **`probe` con `createTestPlatform`:** `member` lee y escribe; la cuenta de aparato con `read` no escribe; una fila que baja a ninguno deniega.
- [ ] **HTTP:**
    - sin sesión, no autenticado;
    - iniciar sesión crea un aparato, y cerrar y volver a entrar lo conserva;
    - el registro abierto está desactivado;
    - una lectura permitida funciona por `api-client` con las cookies gestionadas explícitamente;
    - una escritura denegada falla;
    - cuenta, `via`, aparato, canal, identidad y conversación declarados por el cliente se ignoran o se rechazan.
- [ ] **Reglas de dependencias:** producción no alcanza la preparación privilegiada, los contextos sintéticos ni el autorizador programable. `web` no alcanza `platform/authorization` ni por caminos indirectos.
- [ ] Pasan todas las comprobaciones y el build, y la generación no deja cambios.
