# Tareas programadas generales

Cualquier módulo declara una tarea con su frecuencia, a la hora de la familia, y todas comparten una sola mecánica en `platform/jobs`. En ajustes se ve la lista, la última ejecución y su resultado, y se puede cambiar la hora, pausar o lanzar. Solo ejecutan código del repositorio, nunca scripts escritos desde ajustes. Siguen las invariantes de Hermes: la siguiente ejecución se marca antes de lanzar, hay un registro de ejecuciones, se recupera lo perdido y hay un vigilante de inactividad.

Fecha: 2026-11-11. Preguntas del grilling: P29, P30.
