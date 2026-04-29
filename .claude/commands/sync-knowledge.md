---
name: sync-knowledge
description: Sincroniza el conocimiento del QA suite con el estado actual del repo del player. Lee archivos clave del player, detecta diffs vs la memoria actual y propone actualizaciones.
---

# /sync-knowledge — Sincronización de Conocimiento QA ↔ Player

Eres un agente de sincronización de conocimiento para el proyecto `lightning-player-qa`.
Tu trabajo es leer el estado actual del repositorio del player y compararlo con lo que
el proyecto QA tiene documentado, para detectar inconsistencias y proponer actualizaciones.

## Paso 1 — Leer el estado actual de la memoria QA

Lee estos archivos en orden:
1. `.claude/memory/player_system.md` — referencia del player para QA
2. `.claude/memory/player_architecture.md` — arquitectura interna
3. `.claude/memory/testing_gaps.md` — gaps conocidos
4. `.claude/memory/decisions.md` — decisiones técnicas

Anota la versión del player que está documentada y los supuestos principales.

## Paso 2 — Leer el estado actual del player repo

Lee estos archivos del player repo (`$PLAYER_LOCAL_REPO` — leer desde `.env`):

**Versión y dependencias:**
- `package.json` — versión del player, hls.js version, dependencias nuevas

**API pública:**
- `src/api/api.js` — entry point, cómo se inicializa
- `src/controls/index.js` o similar — métodos y propiedades expuestos

**Eventos:**
- `constants.cjs` — todos los eventos definidos
- `src/events/index.js` — cómo se emiten

**Ads:**
- `src/ads/manager/index.js` — flujo de IMA
- Buscar si hay módulos nuevos en `src/ads/` que no estaban antes

**Platform:**
- `src/platform/loadConfig.js` o similar — dominio y estructura de respuesta

**Changelog o commits recientes:**
- Si existe `CHANGELOG.md`, leerlo
- Si no, correr `git log --oneline -20` en el repo del player para ver cambios recientes

## Paso 3 — Comparar y detectar diffs

Compara lo leído en Paso 2 con lo documentado en Paso 1. Busca:

### Cambios en versión
- ¿Cambió la versión del player?
- ¿Cambió la versión de hls.js u otras deps clave?

### Cambios en API
- ¿Hay métodos nuevos en la API pública?
- ¿Hay métodos eliminados o renombrados?
- ¿Hay propiedades nuevas o eliminadas?

### Cambios en eventos
- ¿Hay eventos nuevos en `constants.cjs` que no están en `player_system.md`?
- ¿Hay eventos eliminados?

### Cambios en ads
- ¿Hay módulos de ads nuevos (nuevos ad systems)?
- ¿Cambió el flujo de IMA o SGAI?

### Cambios en la platform config
- ¿Cambió el dominio del endpoint?
- ¿Cambió la estructura del JSON de respuesta?
- Si cambió → los mocks en `fixtures/platform-responses/` pueden estar desactualizados

### Nuevos módulos o features
- ¿Hay directorios nuevos en `src/` que no estaban documentados?
- ¿Hay nuevas integraciones (nuevos analytics, nuevo ad system)?

## Paso 4 — Revisar gaps pendientes

Lee `testing_gaps.md` y para cada ítem marcado como ⬜ pendiente, verifica:
- ¿Sigue siendo relevante?
- ¿Hay alguno que ahora esté implementado y deba marcarse como ✅?
- ¿El bug reportado en SGAI sigue existiendo en el código?

## Paso 5 — Generar reporte de diffs

Presenta al usuario un reporte con esta estructura:

```
## Reporte sync-knowledge — [fecha]

### Versión del player
- Documentada: X.X.X
- Actual en repo: X.X.X
- [CAMBIO / SIN CAMBIO]

### Cambios en API pública
- [lista de cambios o "Sin cambios detectados"]

### Cambios en eventos
- [lista de eventos nuevos/eliminados o "Sin cambios"]

### Cambios en ads
- [descripción o "Sin cambios"]

### Cambios en platform config
- [descripción o "Sin cambios"]

### Nuevos módulos/features
- [descripción o "Ninguno nuevo"]

### Estado de gaps pendientes
- Gap 1: [sigue pendiente / implementado / ya no aplica]
- ...

### Actualizaciones recomendadas
1. [archivo a actualizar] → [qué cambiar]
2. ...
```

## Paso 6 — Aplicar actualizaciones (con confirmación)

Para cada actualización identificada, pregunta al usuario si quiere que la apliques.
Si dice sí, actualiza los archivos correspondientes:
- `player_system.md` — si cambió la API, versión, o eventos
- `player_architecture.md` — si cambió la arquitectura interna
- `testing_gaps.md` — marcar items completados o agregar nuevos gaps
- `decisions.md` — si hay nuevas decisiones técnicas que tomar
- `MEMORY.md` — si se crean archivos nuevos

**Nunca modifiques tests automáticamente** — solo los archivos de memoria/documentación.
Los cambios a tests siempre requieren revisión manual del usuario.

## Cuándo correr este skill

- Cuando el player hace un release (nueva versión en su repo)
- Antes de empezar a escribir tests para una feature nueva
- Cuando un test falla de manera inesperada y sospechas que el player cambió su comportamiento
- Como rutina mensual de mantenimiento

## Tiempo estimado

5-15 minutos dependiendo de cuánto cambió el player.
