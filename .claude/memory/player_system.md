---
name: Sistema Bajo Test — Lightning Player
description: API real del player según lightning_player.md — loadMSPlayer, load(), eventos, propiedades
type: reference
---

# Mediastream Lightning Player — Referencia QA

**Versión al momento de este documento:** 1.0.56
**Repo:** `D:\Dev\Repos\mediastream\lightning-player`
**Doc oficial:** `docs/lightning_player.md` en el repo del player

## Tipos de Contenido (type)

`'media'` | `'live'` | `'dvr'` | `'episode'`

## Views

`'video'` | `'audio'` | `'radio'` | `'podcast'` | `'reels'` | `'compact'` | `'none'`

## Método de Inicialización Principal (para QA)

`loadMSPlayer(containerId, config)` → `Promise<player>`

```js
loadMSPlayer('player-container', {
  type: 'media',       // REQUERIDO
  id: 'content-id',   // REQUERIDO — ID en la plataforma Mediastream
  autoplay: false,
  volume: 0.8,
  adsMap: 'https://vast-url',  // camelCase de data-ads-map
}).then(player => { /* usar player */ })
```

**IMPORTANTE:** El campo obligatorio es `id` (ID de contenido de la plataforma).
`src` es una propiedad HTML5 (get/set post-init), NO un config de inicialización oficial.

## Método de Carga Dinámica — PRIORIDAD

```js
player.load({ type: 'media', id: 'new-content-id' })
```

Options: `type` (required), `id` (required). Para cambiar contenido sin destruir el player.

## API Pública Completa

### Métodos
- `play()` → Promise
- `pause()`
- `load({ type, id })` — carga dinámica — PRIORIDAD en tests
- `showControls()` / `hideControls()`
- `destroy()`
- `on(event, cb)` / `once(event, cb)` / `off(event, cb)`
- `ad.skip()` — skip del ad (solo si skippable)

### Propiedades Custom (no HTML5 estándar)
- `status` → `'playing' | 'pause' | 'buffering'`
- `isLive` → boolean
- `isDVR` → boolean
- `playerType` → string
- `controls` (get/set) — visibilidad de la UI
- `fullscreen` (get/set)
- `level` (get/set) — calidad actual, HLS.js only
- `levels` — niveles disponibles, HLS.js only
- `bandwidth` — HLS.js only
- `bitrate` — HLS.js only
- `droppedFrames` — Custom Attribute (NO usar getVideoPlaybackQuality() para esto)
- `fps` — HLS.js only
- `sourceType` → `'hls'` | `'mp4'` etc.
- `edge` — CDN edge server, HLS.js only
- `metadata` — título, thumbnail, etc.
- `hasAdblocker` — solo si detectAdblocker=true
- `videoWidth` / `videoHeight`
- `ad.info` → `{ clickThroughUrl, contentType, currentTime, duration, podIndex, remainingTime, skippable, isLinear }`
- `ad.cuePoints` → array de tiempos de ad breaks (VMAP)

### Propiedades HTML5
- `currentTime` (get/set) — seek
- `duration` (readonly)
- `volume` (get/set) — 0 a 1
- `paused` (readonly)
- `ended` (readonly)
- `readyState` (readonly)
- `seekable` (readonly) — TimeRanges
- `src` (get/set) — URL actual del stream
- `autoplay` (readonly)
- `textTracks` — TextTrackList
- `audioTracks` — AudioTrackList

## Eventos del Player (via player.on())

**Custom:** loaded, ready, sourcechange, error, buffering, programdatetime,
adblockerDetected, share, levelchange, levelchanged,
metadataloading, metadataloaded, metadatachanged

**HTML5:** abort, canplay, canplaythrough, durationchange, emptied, ended,
loadeddata, loadedmetadata, loadstart, pause, play, playing, progress,
ratechange, seeked, seeking, stalled, suspend, timeupdate, volumechange, waiting

**Ads:** adsAdBreakReady, adsAdMetadata, adsAllAdsCompleted, adsClick,
adsComplete, adsContentPauseRequested, adsContentResumeRequested,
adsDurationChange, adsFirstQuartile, adsImpression, adsLinearChanged,
adsLoaded, adsLog, adsMidpoint, adsPaused, adsResumed,
adsSkippableStateChanged, adsSkipped, adsStarted, adsThirdQuartile,
adsTimeUpdate, adsUserClose, adsVolumeChanged, adsVolumeMuted,
adsError, adsAdBuffering, adsAdProgress, adsInteraction,
adsVideoClicked, adsVideoIconClicked

**Tracks:** texttrackchange, texttrackaddtrack, texttrackremovetrak,
audiotrackchange, audiotrackaddtrack, audiotrackremovetrak

## Ad Systems Integrados

1. Google IMA — VAST/VMAP via SDK (más común, config via `adsMap`)
2. Google DAI — Dynamic Ad Insertion en manifest
3. Google SGAI — Server-Guided, HLS live only
4. AWS MediaTailor DAI
5. AdSwizz — radio/podcast
6. ITG (In The Game) — ads interactivos

## Notas Importantes para Testing

- Inicializar SIEMPRE con `loadMSPlayer()` — es la API Promise-based oficial
- Los eventos se trackean en `window.__qa.events` por el harness
- `window.__player` es la instancia del player expuesta al Page Object
- Usar `player.on()` para eventos de ads (no beacons HTTP como primera opción)
- `droppedFrames` viene de `player.droppedFrames`, NO de `getVideoPlaybackQuality()`
- El `<video>/<audio>` es creado internamente, no directamente accesible en config
- Para subtítulos: `player.textTracks[i].mode = 'showing'`
- Para audio tracks: `player.audioTracks.getTrackById(id).enabled = true`
