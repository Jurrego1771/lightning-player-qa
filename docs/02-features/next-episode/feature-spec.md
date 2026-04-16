---
type: feature-spec
feature: next-episode
status: active
owner: qa
source_of_truth: true
last_verified: 2026-04-15
---

# Next Episode

## Objetivo

Permitir que el player anuncie, confirme y cargue automáticamente o por acción explícita el siguiente contenido.

## Ámbito

La feature tiene dos modos principales:
- `view: 'none'`: flujo headless controlado por eventos y API
- `view: 'video'`: overlay visual con botones y autoload visual

## APIs públicas relacionadas

- `player.updateNextEpisode(data)`
- `player.keepWatching()`
- `player.playNext()`
- eventos `nextEpisodeIncoming`, `nextEpisodeConfirmed`, `nextEpisodePlayNext`, `nextEpisodeKeepWatching`

## Fuentes del SUT revisadas

- `src/api/player.jsx`
- `src/view/none/hooks/useNextEpisodeEvents.js`
- `src/view/video/hooks/useNextEpisodeTiming.js`
- `src/view/video/components/nextEpisode/index.jsx`
- `src/platform/loadConfig.js`

## Flujos principales

### Headless

1. El contenido actual tiene `next` o `nextEpisodeId`.
2. Cerca del final se emite `nextEpisodeIncoming`.
3. El integrador puede confirmar con `updateNextEpisode()`.
4. El integrador puede cancelar autoload con `keepWatching()`.
5. El integrador puede forzar carga inmediata con `playNext()`.
6. Si no se cancela, el siguiente contenido carga al disparar `ended`.

### Video UI

1. El contenido actual tiene `next`.
2. Cerca del final se emite `nextEpisodeIncoming`.
3. Cuando el tiempo restante cae bajo `nextEpisodeTime`, aparece overlay.
4. El usuario puede ir a créditos o al siguiente episodio.
5. Si hay tiempo suficiente, el botón de siguiente episodio inicia cuenta visual y autoload.

## Dependencias

- metadata del contenido
- tiempo actual y duración
- eventos internos del player
- `loadConfig()` para overrides desde init/load

## Exclusiones

- `live`, `audio` y `dvr` no deben activar esta lógica visual
