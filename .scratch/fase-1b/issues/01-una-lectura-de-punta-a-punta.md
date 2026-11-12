# 01. Una lectura de `probe` de punta a punta

Status: resolved
Blocked by: ninguna (puede empezar ya)

Spec: [`../spec.md`](../spec.md), secciones «Contratos», «Implementación y definición del módulo», «El recorrido» (la parte de lectura), «Autorización hasta la 1c», «Actor» y «`test-utils` y la entrada de pruebas de `platform`». ADR 0022.

## Qué construir

Una prueba de `probe` invoca `probe.listNotes` y `probe.getNote` con un actor sintético por `createTestPlatform`, y la lectura recorre el camino real de `platform`: busca la acción, valida la entrada, pide la decisión a `platform/authorization`, ejecuta el manejador con `PRAGMA query_only` y valida el resultado. Con la configuración de producción, la misma lectura se deniega sin ejecutar el manejador.

Piezas que llegan con esta tarea:

- La entrada pura de contratos de `module-sdk`, con el ayudante de lectura (metadato de tipo sobre el contrato de oRPC). El de escritura llega en la 02.
- `defineModule` con `actions`, y las comprobaciones al registrar: nombre completo repetido, acción del contrato sin implementación e implementación sin contrato.
- El contexto del manejador: entrada validada, base de datos del módulo, actor y hora del reloj. El SDK no exporta otra forma de obtener la base de datos.
- `platform/actions` (solo lecturas) y `platform/authorization`, síncrono, con la interfaz permitir o denegar; en producción lo deniega todo y `createPlatform` no admite otro autorizador.
- La entrada de pruebas de `platform` construye una plataforma con autorizador y reloj dados.
- `createTestPlatform` gana el autorizador programable (permite, deniega o lanza, cambiable entre llamadas), el reloj controlable, la fabricación de actores (cuenta y `via` opcional) e `invoke` con los nombres y tipos de los módulos que recibe. Una lectura no lleva clave ni devuelve número de entrada.
- `probe`: su contrato con `listNotes` y `getNote`, y su implementación.
- Los errores comunes de la plataforma que aplican aquí: entrada no válida, no permitido, no encontrado y error interno sin detalle.

## Aceptación

- [x] Pruebas de `probe`: las dos lecturas devuelven lo que se preparó con `dbFor`; una entrada no válida se rechaza; una denegación y una excepción del autorizador terminan sin ejecutar el manejador.
- [x] Pruebas de `platform` con definiciones escritas en la prueba: `createPlatform` deniega toda acción; nombre repetido, acción sin implementación e implementación sin contrato fallan al arrancar nombrando módulo y acción; una lectura que intenta escribir falla y una escritura legítima posterior por la construcción de pruebas funciona (`query_only` restaurado); una excepción inesperada sale como error interno sin mensaje ni pila.
- [x] `architecture.test.ts` y sus fixtures: la entrada de contratos de `module-sdk` no alcanza Drizzle, Node ni el resto del SDK; solo `test-utils` importa la entrada de pruebas de `platform`. Una comprobación de las exportaciones del SDK demuestra que no ofrece otra forma de obtener la base de datos de un módulo.
- [x] La puerta sigue sin montar acciones: `status` es la única RPC.
- [x] Pasan `pnpm format:check`, `pnpm lint`, `pnpm type-check` y `pnpm test`, y `pnpm db:generate && pnpm modules:generate` dejan `git status --porcelain` vacío.

## Comments

- Hecha en `1ad9a53`.
- Un nombre completo repetido solo puede darse con dos definiciones del mismo módulo (los ids no llevan punto), por eso `checkModules` comprueba las acciones antes que el id repetido: así el error nombra la acción.
