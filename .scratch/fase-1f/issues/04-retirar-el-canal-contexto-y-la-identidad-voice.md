# 04. Retirar el canal `contexto` y la identidad `voice`

Status: ready-for-agent
Blocked by: 03

Spec: [`../spec.md`](../spec.md), secciones «El contexto verificado», «La autorización» y «Las confirmaciones», y costura 1. ADR 0034 y ADR 0023.

## Qué construir

Sin mandatos, nada puede producir el canal `contexto` ni la identidad `voice`. Desaparecen, y con ellos el «sí» por voz en 60 s. La regla del aparato compartido se queda solo con su denegación.

- **El contexto verificado:** el canal se queda con un solo valor, `app`; la identidad, con `password` y `device`; sale el campo de la conversación.
- **La autorización:** sale la decisión `confirm-in-context`. En una lectura de un área que declara `confirmOnSharedDevice`, la cuenta de aparato se deniega; el caso del miembro reconocido en un aparato compartido desaparece.
- **Las confirmaciones:** una pendiente se confirma o se rechaza solo desde la app, por la misma persona, en sus 24 h. Sale el plazo de unos 60 s.
- **Compatibilidad temporal con el esquema.** Las columnas de «solo por `contexto`» y del cierre de su ventana siguen existiendo hasta la 05, y el cierre de la ventana no admite nulos ni tiene valor por defecto. Hasta entonces se conserva el mínimo código de persistencia que las escribe, sin significado funcional, y una pendiente antigua marcada «solo por `contexto`» sigue sin poder confirmarse ni rechazarse desde la app. La 05 elimina los dos restos.

## Criterios de aceptación

- [ ] La cuenta de aparato, con el área abierta por el admin, no lee un área de `probe` que declara `confirmOnSharedDevice`, y un miembro sí la lee en su propio aparato.
- [ ] `confirm-in-context` ya no es una decisión, y ninguna pendiente nueva nace «solo por `contexto`».
- [ ] Una pendiente antigua «solo por `contexto`», preparada en la base, no se confirma ni se rechaza desde la app.
- [ ] Las pendientes ordinarias se confirman y se rechazan como antes, con su caducidad de 24 h.
- [ ] Las pruebas de la falsificación por HTTP siguen probando que la puerta ignora el canal y la identidad que declara el cliente.
- [ ] `docs/agents/packages.md` queda sin el canal `contexto`, la identidad `voice` y la ventana.
- [ ] `pnpm check` pasa.
