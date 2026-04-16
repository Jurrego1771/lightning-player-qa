---
type: observability
feature: next-episode
status: active
---

# Observability — Next Episode

## Señales primarias

- `nextEpisodeIncoming`
- `nextEpisodeConfirmed`
- `nextEpisodePlayNext`
- `nextEpisodeKeepWatching`
- `sourcechange`
- `metadataloaded`

## Señales secundarias

- `ready`
- overlay `.next-episode` visible en `view: 'video'`
- foco visual entre botones del overlay

## Señales no confiables o delicadas

- `player.metadata` justo después de `load()` o `playNext()`
- asumir que `playNext()` significa carga finalizada
- asumir que la UI visible y `nextEpisodeIncoming` comparten el mismo umbral

## Reglas de aserción

- Para probar intención de transición: usar `nextEpisode*`.
- Para probar cambio real de contenido: usar `metadataloaded` y/o `sourcechange`.
- Para probar UI: usar visibilidad y screenshots, no solo eventos.
