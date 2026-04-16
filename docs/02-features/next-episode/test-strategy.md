---
type: test-strategy
feature: next-episode
status: active
---

# Test Strategy — Next Episode

## Smoke

- Happy path headless:
  cargar player en `view: 'none'`, provocar `nextEpisodeIncoming`, ejecutar `playNext()`, validar transición con `sourcechange` + `metadataloaded`.

## Integration

- Confirmación explícita con `updateNextEpisode()`
- Cancelación con `keepWatching()`
- Override de contenido siguiente por ID

## Visual

- Overlay visible en `view: 'video'`
- Estado inicial con foco en botón principal
- Cambio visual al moverse a botón de créditos

## Performance

- Medir latencia entre `playNext()` y `ready` del siguiente contenido

## Contract

- Verificar presencia de métodos `updateNextEpisode`, `keepWatching`, `playNext`
- Verificar catálogo de eventos `nextEpisode*`

## Riesgos

- Si se usa `player.metadata` como señal primaria, aumenta el riesgo de falso positivo.
- Si se usa configuración override equivocada en `video`, la UI puede no aparecer por diseño y confundirse con bug.
