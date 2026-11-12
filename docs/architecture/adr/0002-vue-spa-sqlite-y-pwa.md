# Vue SPA, SQLite y PWA

La interfaz es Vue como SPA sin SSR, compilada con Vite; la sirve `api` y no tiene contenedor propio. Primero es una PWA, y solo si se queda corta se envuelve la misma SPA con Capacitor. Los datos viven en SQLite, que basta para una casa y cabe en la Pi sin otro servidor. La API son procedimientos oRPC servidos con Hono, que validan su entrada con zod y dan a la web un cliente con tipos sin generar código. El inicio de sesión usa Better Auth, con assurance y step-up ligado a la operación exacta, y los permisos se expresan con Permix. El sistema de diseño se hace justo después del núcleo y antes de las funcionalidades.

Fecha: 2026-11-11. Preguntas del grilling: P36, P37, P38, P39, P45.
Precisado por el ADR 0023: los permisos no se expresan con Permix, sino con una función pura de `platform/authorization`; se entra con correo y contraseña, y el step-up es un comprobante de un solo uso ligado a la operación exacta.
