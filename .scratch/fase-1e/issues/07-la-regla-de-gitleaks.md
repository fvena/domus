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

## Comments

- Hecho en `d032517`. La regla se llama `domus-api-key` y no caza una llave pegada a más caracteres base64url, así que otro prefijo (`xdomus_…`) o un secreto de otra longitud no cuentan; una llave dentro de una línea (`DOMUS_KIRA_KEY="…"`) sí. Las pruebas que manejen llaves deben seguir construyéndolas en tiempo de ejecución: una llave literal en un archivo la para el hook.
- La prueba usa el `gitleaks` del PATH o la imagen que fija `.githooks/pre-commit`, leída de allí; en la CI, el trabajo `unit` usa el Docker del runner. La exige la propia prueba, no un `globalSetup`, porque solo la necesita un archivo. El gitleaks local (8.30.1) y la imagen fijada (8.24.3) dan lo mismo con esta configuración; el escaneo de toda la historia con la imagen, como en la CI, recorre 215 commits sin hallazgos.
- Tras abrir el PR: la CI (8.24.3) cazó con `generic-api-key` un secreto inventado de `keys.test.ts` que el 8.30.1 local dejaba pasar. Va en `.gitleaksignore` por su huella, y la prueba lo construye en tiempo de ejecución. El hook y `tooling/scripts/gitleaks.ts` usan ahora el gitleaks del PATH solo si es la versión fijada; si no, la imagen. `gitleaks.test.ts` prueba que no se acepta otra versión y que el flujo de la CI fija la misma imagen que el hook.
