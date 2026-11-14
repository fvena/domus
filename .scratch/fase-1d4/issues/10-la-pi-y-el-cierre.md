# 10. La Pi y el cierre de la 1d4

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, y el cierre de la 1d3

Spec: [`../spec.md`](../spec.md), secciones «La comprobación en la Pi» y «Reglas y documentación». Plan, 1d4.

## Qué construir

La comprobación en la Pi y el cierre de la 1d4. La 1d3 tiene que estar cerrada antes: su copia del 2026-11-15 y su limpieza del 2026-11-16. Las órdenes que tiene que ejecutar una persona en la Pi se dan una a una, en español, y sus resultados se anotan en `despliegue.md`.

- **En el ensayo**, con `domus-api:ensayo`, por Tailscale (https), con dos cuentas y `curl` sobre `/api/events`: una nota pública nueva llega a las dos (se anota cuánto tarda; el objetivo nuevo es menos de 1 s), una privada solo a su dueño, el paso a privada llega al lector anterior, que al volver a pedirla ya no la ve, revocar una sesión cierra su canal con `purge`, y las claves VAPID son las mismas tras reiniciar y tras recrear `api`.
- **En el Domus real**: `/api/events` sin sesión responde `401` con `no-store`, y `GET /api/notifications/key` con sesión responde una clave.
- **Documentación**: `despliegue.md`, la guía (`docs/guia/`, con sus reglas y el `humanizer`), `packages/AGENTS.md` dentro de su límite, el plan con la 1d4 hecha, y comprobar que el ADR 0029, sus enlaces y el glosario (Suscripción, Entrega y Tabla de área) recogen lo que se construyó al final. Si la implementación cambió una decisión de la spec, se corrige allí también.

## Criterios de aceptación

- [ ] La 1d3 está cerrada en el plan.
- [ ] En el ensayo, las cinco comprobaciones salen bien y quedan anotadas, con el tiempo medido de la nota pública.
- [ ] En el Domus real, las dos comprobaciones salen bien y quedan anotadas.
- [ ] `despliegue.md`, la guía, `packages/AGENTS.md`, el plan, el ADR 0029 y el glosario recogen lo construido.
- [ ] `pnpm check` pasa.
