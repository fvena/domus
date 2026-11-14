# 07. La regla de gitleaks

Status: resolved
Blocked by: —

Spec: [`../spec.md`](../spec.md), sección «Gitleaks». ADR 0030.

## Qué construir

Una llave de Domus que se cuele en un commit la detiene gitleaks, en el hook de pre-commit y en la CI, porque el repositorio es público. Conviene hacerla antes de manejar llaves reales en pruebas a mano, aunque nada técnico lo exija.

- **`.gitleaks.toml`** en la raíz, que extiende la configuración por defecto con una regla para `domus_<id>.<secreto>`. El hook y la CI ya leen la configuración de la raíz.
- **Su prueba en `tooling/scripts`**, con el ejecutable real. Escribe en una carpeta temporal fuera del repositorio una llave de muestra válida y una cadena parecida que no lo es, ejecuta `gitleaks dir` con la configuración del repositorio y borra la carpeta. Usa el `gitleaks` del PATH o la imagen de Docker fijada en el hook. Sin ninguno de los dos, falla con un mensaje que dice cómo instalarlo, como hace restic.
- **Ninguna llave literal en el repositorio**: la prueba construye la muestra en tiempo de ejecución.

## Criterios de aceptación

- [x] gitleaks encuentra la llave de muestra y no la cadena parecida (otro prefijo, un secreto más corto).
- [x] Las reglas por defecto siguen activas: un secreto de otro tipo en la carpeta temporal, construido también en tiempo de ejecución, se encuentra.
- [x] Sin gitleaks ni Docker, la prueba falla con el mensaje de instalación.
- [x] El escaneo del repositorio entero, en el hook y en la CI, sigue sin encontrar nada.
- [x] `pnpm check` pasa.
