# Visibilidad: privado o público

Cada registro tiene dueño y es privado o público; no hay más niveles. Cada área elige su valor por defecto, y la salud es siempre privada.

Fecha: 2026-11-11. Preguntas del grilling: P19.
Precisado por el ADR 0023: la visibilidad la aplica un predicado de la autorización y, al escribir, la comprueban triggers temporales; ser público deja ver, no editar; y la salud lleva un `CHECK` que impide un registro público.
