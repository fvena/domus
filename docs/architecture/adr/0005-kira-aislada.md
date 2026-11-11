# Kira aislada por construcción

Kira no puede tocar los datos aunque se equivoque o la engañen, porque no tiene cómo: su contenedor no monta el volumen de datos, la sesión de Claude Code arranca sin herramientas propias (ni terminal ni ficheros) y lo único que tiene es su llave para la API. Todo lo que hace pasa por `api` y, por tanto, por la autorización y la auditoría. Las reglas de dependencias lo refuerzan en el código: `assistant` no importa `platform`, `module-sdk` ni módulos.

Fecha: 2026-11-11. Preguntas del grilling: P51.
