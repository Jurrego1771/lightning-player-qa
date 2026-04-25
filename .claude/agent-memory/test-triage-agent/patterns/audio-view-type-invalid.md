---
name: view:'audio' no existe en el Lightning Player
description: 'audio' no es un view type registrado en src/view/index.jsx — causa que loadMSPlayer nunca resuelva
type: project
---

# view:'audio' es un valor invalido de view type

## Hallazgo

El Lightning Player (src/view/index.jsx) tiene un mapa `playerView` con los view types soportados:
`radio`, `radioSA`, `podcast`, `podcast2`, `lightning`/`video`, `none`, `reels`, `compact`.

**`'audio'` NO esta en este mapa.**

Cuando se pasa `view: 'audio'` (ya sea en el init config o en el player config de plataforma),
`view/index.jsx` retorna `<React.Fragment/>`. Sin UI montada, el componente `<Controls>`
nunca llega a `componentDidMount()`, nunca emite `InternalEvents._controlsReady`, y la Promise
de `loadMSPlayer` (api.js:235-243) queda suspendida indefinidamente.

Resultado observable: `waitForFunction(__qa.initialized)` en `fixtures/player.ts:146` timeout-ea
despues de 30s, lo que escala a timeout del test entero a los 60s.

## Distincion importante

- `playerType = 'audio'` → tipo de media element INTERNO para reproducir audio (no es view type)
- `view.type` → interfaz de controles a montar (los valores validos estan en `playerView`)

Para contenido de audio, el view type correcto es `radio`, `compact` o `podcast` segun la UI deseada.

## Archivos afectados

- `fixtures/platform-responses/player/audio.json` → tiene `view.type: 'audio'` (INVALIDO)
- Todos los tests que pasen `view: 'audio'` fallan con el mismo timeout

## Fix requerido

**Why:** El valor 'audio' confunde el tipo de media (playerType interno) con el view type de UI.
**How to apply:** Cuando un test necesite inicializar el player para contenido de audio, usar `view: 'radio'` o `view: 'compact'`. Actualizar `audio.json` en platform-responses/player/ con `view.type: 'radio'`.
