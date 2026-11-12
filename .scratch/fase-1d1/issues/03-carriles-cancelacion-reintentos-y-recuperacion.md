# 03. Carriles, cancelación, reintentos y recuperación

Status: ready-for-agent
Blocked by: 01

Spec: [`../spec.md`](../spec.md), sección «El motor de segundo plano». ADR 0025.

## Qué construir

El motor completo sobre lo que dejó la 01: dos carriles que no se estorban, trabajos que no pueden quedarse para siempre, fallos que se reintentan solo cuando tiene sentido y recuperación tras una caída.

- **Carril corto** junto al de mantenimiento. Los dos corren a la vez y cada uno ejecuta un trabajo a la vez. En la 1d1 el carril corto solo lo usan los trabajos sintéticos.
- **Trabajos sintéticos** en la entrada de pruebas de `platform`, de cualquiera de los dos carriles, cuyo final controla la prueba con promesas. No son un contrato público para los módulos.
- **Tiempo máximo** por tipo de trabajo: unos 30 s en el corto y 30 min en el de mantenimiento, para empezar. Al agotarlo, el motor activa la señal de cancelación.
- **Atascado.** Un trabajo que no termina dentro de un margen después de cancelarlo queda atascado. Su carril sigue ocupado y no empieza otro trabajo en él mientras siga corriendo. Al terminar, el carril se libera.
- **Errores.**
    - Los definitivos (entrada no válida, algo que no existe o un error marcado como definitivo) quedan fallidos a la primera.
    - Los pasajeros, incluido agotar el tiempo máximo, se reintentan desde unos 30 s, doblando la espera, hasta 5 intentos, y después quedan fallidos.
- **Recuperación al arrancar.** Lo que la base guarda en ejecución o atascado vuelve a pendiente con un intento más contado, o queda fallido si ya los agotó.
- **Parada ordenada completa.** Si un trabajo no termina dentro del margen, queda en ejecución en la base y se recupera al arrancar.

## Criterios de aceptación

- [ ] Con trabajos sintéticos, un trabajo largo de mantenimiento no retrasa uno corto, y dentro de cada carril nunca corren dos a la vez.
- [ ] Al agotar el tiempo máximo, el trabajo recibe la cancelación. Si la atiende, sale como pasajero y se reintenta.
- [ ] Un trabajo que ignora la cancelación queda atascado, su carril no admite otro mientras corra y se libera cuando termina.
- [ ] Los reintentos siguen la espera creciente y paran en el máximo. Un error definitivo no se reintenta.
- [ ] Prueba interna: un trabajo dejado en ejecución sin parada ordenada se recupera al abrir la plataforma sobre esa base, o queda fallido si agotó sus intentos.
- [ ] Prueba interna: de dos reclamaciones del mismo trabajo solo gana una.
- [ ] La parada ordenada deja en ejecución lo que no termina a tiempo, y se recupera en el arranque siguiente.
- [ ] Todo se prueba con el mando, sin esperas reales.
- [ ] `pnpm check` pasa.
