# Lightning Player — API Coverage Matrix

> **Fuente de verdad**: `D:\Dev\Repos\mediastream\lightning-player` (v1.0.57)  
> **Suite de tests**: `D:\Dev\Repos\jurrego1771\lightning-player-qa`  
> **Última actualización**: 2026-04-05 (text-tracks suite: 19/19 ✅)

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Cubierto — test existe y pasa |
| 🟡 | Parcial — test existe pero incompleto o con TODO pendiente |
| ❌ | Sin cobertura — no existe test |
| ⏭ | Diferido — fuera de scope actual (DRM, Cast, etc.) |
| 🔴 | Bloqueado — test existe pero falla / ID pendiente |

---

## Resumen de Cobertura

| Área | Total | ✅ | 🟡 | ❌ | ⏭ | Cobertura |
|------|-------|----|----|----|----|-----------|
| Init Config (`loadMSPlayer`) | 51 | 7 | 5 | 32 | 7 | ~24% |
| Script Tag (`data-*`) | 8 | 0 | 0 | 1 | 7 | ~0% |
| Propiedades — Lectura/Escritura | 7 | 5 | 0 | 2 | 0 | 71% |
| Propiedades — Solo Lectura | 23 | 10 | 4 | 7 | 2 | ~61% |
| Métodos de Playback | 5 | 5 | 0 | 0 | 0 | 100% |
| Métodos de UI | 3 | 2 | 0 | 1 | 0 | 67% |
| Métodos de Config Runtime | 4 | 0 | 0 | 4 | 0 | 0% |
| Métodos de Ciclo de Vida | 4 | 1 | 0 | 3 | 0 | 25% |
| Métodos de Evento | 6 | 2 | 0 | 4 | 0 | 33% |
| Métodos de Contenido/Playlist | 5 | 0 | 0 | 5 | 0 | 0% |
| Eventos — Custom | 13 | 8 | 2 | 3 | 0 | ~77% |
| Eventos — HTML5 | 22 | 14 | 0 | 8 | 0 | 64% |
| Eventos — View-Specific | 3 | 0 | 0 | 1 | 2 | 0% |
| Eventos — Ads (IMA) | 33 | 9 | 2 | 22 | 0 | ~33% |
| Eventos — Tracks | 6 | 4 | 0 | 2 | 0 | ~67% |
| Eventos — Playlist/Misc | 9 | 0 | 0 | 9 | 0 | 0% |
| Eventos — Cast/PiP | 9 | 0 | 0 | 2 | 7 | 0% |
| Ad API (ad.*) | 8 | 5 | 1 | 2 | 0 | ~75% |
| Text Tracks API | 6 | 6 | 0 | 0 | 0 | 100% |
| Audio Tracks API | 5 | 1 | 2 | 2 | 0 | ~40% |
| View Types | 9 | 2 | 0 | 7 | 0 | 22% |
| Content Types | 4 | 4 | 0 | 0 | 0 | 100% |
| DVR Options | 5 | 1 | 1 | 3 | 0 | ~40% |
| DRM Config | 4 | 0 | 0 | 0 | 4 | N/A |
| **TOTAL** | **263** | **106** | **18** | **122** | **29** | **~48%** |

---

## 1. Inicialización: `loadMSPlayer(container, config)`

**Firma:** `window.loadMSPlayer(containerId: string | HTMLElement, config: object) → Promise<Player>`

### Parámetros de Contenido

| Parámetro | Tipo | Req. | Default | Cobertura | Test(s) |
|-----------|------|------|---------|-----------|---------|
| `type` | `'media'│'live'│'dvr'│'episode'` | ✓ | — | ✅ | smoke, vod-playback, live-playback, player-api |
| `id` | string (24-char hex) | ✓* | — | ✅ | smoke, vod-playback, live-playback |
| `src` | string (URL) | ✓* | — | 🟡 | qoe-metrics (streams externos) |
| `title` | string | — | plataforma | ❌ | — |
| `artist` | string | — | plataforma | ❌ | — |
| `description` | string | — | plataforma | ❌ | — |
| `poster` | string (URL) | — | plataforma | ❌ | — |
| `metadata` | object | — | — | ❌ | — |

> `id` o `src` son mutuamente excluyentes; se requiere uno de los dos.

### Parámetros de Playback

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `autoplay` | boolean | plataforma | ✅ | smoke, vod-playback, player-api |
| `volume` | number (0–1) | plataforma | 🟡 | player-api (verifica vía setVolume) |
| `startPos` | number (seg) | 0 | ✅ | player-api |
| `loop` | boolean | false | ❌ | — |
| `playbackRate` | number | 1 | ✅ | player-api |
| `controls` | boolean | plataforma | ❌ | — |
| `preloadEnabled` | boolean | — | ❌ | — |
| `showThumbnail` | boolean | true | ❌ | — |

### Parámetros de UI / View

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `view` | string | plataforma | 🟡 | a11y, visual (solo `video`/`audio`) |
| `renderAs` | string | — | ❌ | — |
| `width` | string (CSS) | — | ❌ | — |
| `height` | string (CSS) | — | ❌ | — |
| `aspectRatio` | string | `16/9` | ❌ | — |

### Parámetros de Acceso / Seguridad

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `accessToken` | string | — | ✅ | live-playback, smoke (live test) |
| `adminToken` | string | — | ❌ | — |
| `withoutCookies` | boolean | false | ❌ | — |
| `dnt` | boolean | false | ❌ | — |

### Parámetros de Ads

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `adsMap` | string (VAST URL) | — | ✅ | ad-beacons |
| `ads` | object | — | ❌ | — |
| `ads.sgai` | object (SGAI config) | — | ⏭ | fuera de scope |
| `detectAdblocker` | boolean | false | ❌ | — |
| `googleImaPpid` | string | — | ⏭ | fuera de scope |

### Parámetros de Analítica / Tracking

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `appName` | string | `lightning-player` | ❌ | — |
| `appVersion` | string | player version | ❌ | — |
| `appType` | string | `web-app` | ❌ | — |
| `customer` | string | — | ❌ | — |
| `distributor` | string | — | ❌ | — |
| `pid` | string | — | ❌ | — |
| `sid` | string | — | ❌ | — |
| `uid` | string | — | ❌ | — |
| `listenerId` | string | — | ❌ | — |
| `ref` | string | location.hostname | ❌ | — |

### Parámetros de Player / Config

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `player` | string (Player ID) | auto | ❌ | — |
| `debug` | boolean | false | ❌ | — |
| `disableMspEvents` | boolean | false | ❌ | — |
| `hlsVariant` | `'normal'│'light'│'beta'` | `normal` | ❌ | — |
| `selectedSrcType` | string | auto | ❌ | — |

### Parámetros DVR / Catchup

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `start` | string (ISO 8601) | — | ❌ | — |
| `end` | string (ISO 8601) | — | ❌ | — |
| `duration` | number | — | ❌ | — |
| `forceDVR` | boolean | — | ❌ | — |

### Parámetros de Episodes / Playlist

| Parámetro | Tipo | Default | Cobertura | Test(s) |
|-----------|------|---------|-----------|---------|
| `nextEpisodeId` | string | — | ❌ | — |
| `nextEpisodeTime` | number (seg) | — | ❌ | — |
| `resumePosition` | boolean | — | ❌ | — |
| `shareUrl` | string | plataforma | ❌ | — |

### DRM

| Parámetro | Tipo | Cobertura | Notas |
|-----------|------|-----------|-------|
| `drm.fairplay` | object | ⏭ | Requiere Safari + certificado |
| `drm.widevine` | object | ⏭ | Requiere CDM |
| `drm.playready` | object | ⏭ | Requiere CDM |
| `drm['com.apple.fps.1_0']` | object | ⏭ | Alias de fairplay |

---

## 2. Script Tag (`data-*` Attributes)

| Atributo | Equivalente Config | Cobertura | Notas |
|----------|--------------------|-----------|-------|
| `data-loaded="fn"` | callback on load | ❌ | Alternativa a Promise |
| `data-global="var"` | window variable | ⏭ | Para integración sin módulos |
| `data-type` | `type` | ⏭ | |
| `data-id` | `id` | ⏭ | |
| `data-autoplay` | `autoplay` | ⏭ | |
| `data-app-name` | `appName` | ⏭ | |
| `data-custom-*` | `custom.*` | ⏭ | Dinámico |
| Evaluación `$var` | Referencia a window | ⏭ | |

> **Decisión de diseño**: Los tests usan exclusivamente `loadMSPlayer()` (método 1). La API de script tag no se testea en esta suite por ser equivalente funcional y cubrir el mismo código interno.

---

## 3. Propiedades del Player — Lectura/Escritura

| Propiedad | Tipo | Cobertura | Test(s) | Notas |
|-----------|------|-----------|---------|-------|
| `currentTime` | number (seg) | ✅ | smoke, vod-playback, player-api | Seek mediante asignación |
| `volume` | number (0–1) | ✅ | vod-playback, player-api | |
| `level` | number | ✅ | hls-abr, vod-playback | -1 = auto. HLS.js only |
| `playbackRate` | number | ✅ | player-api | |
| `muted` | boolean | ✅ | player-api | |
| `fullscreen` | boolean | ❌ | — | `setFullscreen()` en PO pero sin test E2E |
| `controls` | boolean | ❌ | — | Alternativa a show/hideControls() |

---

## 4. Propiedades del Player — Solo Lectura

| Propiedad | Tipo | Cobertura | Test(s) | Notas |
|-----------|------|-----------|---------|-------|
| `paused` | boolean | ✅ | vod-playback | |
| `duration` | number (seg) | ✅ | vod-playback, live-playback | Infinity para live |
| `ended` | boolean | ✅ | vod-playback | |
| `status` | `'playing'│'pause'│'buffering'│'error'│'waiting'` | ✅ | smoke, vod-playback, player-api | |
| `isLive` | boolean | ✅ | live-playback, smoke | |
| `isDVR` | boolean | ✅ | live-playback | |
| `readyState` | number (0–4) | 🟡 | player-api | Verificado vía evento canplay; propiedad no expuesta directamente |
| `seekable` | TimeRanges | 🟡 | live-playback | Solo DVR test; no VOD |
| `bandwidth` | number (bps) | 🟡 | hls-abr (getQoEMetrics) | Incluido en QoEMetrics |
| `bitrate` | number (bps) | 🟡 | hls-abr (getQoEMetrics) | Incluido en QoEMetrics |
| `levels` | array | ✅ | vod-playback, hls-abr | |
| `metadata` | object | 🟡 | player-api | Verificado vía evento; objeto no inspeccionado (vacío) |
| `textTracks` | TextTrackList | ✅ | vod-playback, text-tracks | 5 tracks: ru-ru, fr-fr, it-it, es-co, es-cl |
| `audioTracks` | AudioTrackList | 🔴 | vod-playback | ID vodMultiAudio pendiente |
| `droppedFrames` | number | 🟡 | qoe-metrics | Incluido en QoEMetrics |
| `type` | string | ❌ | — | `'audio'│'video'` |
| `handler` | string | ❌ | — | `'hls'│'dash'│'html5/native'` |
| `autoplay` | boolean | ❌ | — | |
| `loop` | boolean | ❌ | — | |
| `fps` | number | ❌ | — | HLS.js only |
| `version` | string | ❌ | — | |
| `programDateTime` | Date | ❌ | — | Live only |
| `error` | Error | ✅ | player-api | Test con ID inválido |
| `hasAdblocker` | boolean | ❌ | — | Requiere detectAdblocker=true |
| `icyMetadata` | object | ⏭ | — | Solo radio streams |

---

## 5. Métodos — Playback

| Método | Firma | Cobertura | Test(s) |
|--------|-------|-----------|---------|
| `play()` | `→ Promise` | ✅ | smoke, vod-playback, live-playback, player-api |
| `pause()` | `→ Promise│void` | ✅ | smoke, vod-playback |
| `load(options)` | `→ Promise` | ✅ | smoke, vod-playback, live-playback, player-api |
| `destroy()` | `→ Promise` | ✅ | smoke, vod-playback |
| `seek(seconds)` | via `currentTime =` | ✅ | smoke, vod-playback |

### `load(options)` — Parámetros Detallados

| Parámetro | Tipo | Req. | Cobertura | Notas |
|-----------|------|------|-----------|-------|
| `type` | ContentType | ✓ | ✅ | media, live, dvr, episode |
| `id` | string | ✓ | ✅ | |
| `accessToken` | string | — | ✅ | live-playback (live.load) |
| `src` | string | — | ❌ | Direct URL |
| `startPos` | number | — | ❌ | |
| `title` | string | — | ❌ | |
| `start` | string (ISO 8601) | — | ❌ | DVR catchup |
| `end` | string (ISO 8601) | — | ❌ | DVR catchup |
| `duration` | number | — | ❌ | |
| `forceDVR` | boolean | — | ❌ | |
| `force` | boolean | — | ❌ | Forzar carga en estado error |
| `nextEpisodeId` | string | — | ❌ | |
| `metadata` | object | — | ❌ | |
| `withoutCookies` | boolean | — | ❌ | |

---

## 6. Métodos — UI y Controles

| Método | Firma | Cobertura | Test(s) |
|--------|-------|-----------|---------|
| `showControls()` | `→ void` | ✅ | player-api |
| `hideControls()` | `→ void` | ✅ | player-api |
| `setFullscreen(bool)` | via `fullscreen =` | ❌ | PO implementado, sin test E2E |

---

## 7. Métodos — Configuración en Runtime

| Método | Firma | Cobertura | Test(s) |
|--------|-------|-----------|---------|
| `getOption(key)` | `→ any` | ❌ | — |
| `getOptions()` | `→ object` | ❌ | — |
| `setOption(key, value)` | `→ void` | ❌ | — |
| `loadConfig(options)` | `→ Promise` | ❌ | — |

---

## 8. Métodos — Event Listeners

| Método | Firma | Cobertura | Test(s) |
|--------|-------|-----------|---------|
| `on(event, cb)` | `→ unsubscriber fn` | ✅ | Implícito vía harness |
| `once(event, cb)` | `→ unsubscriber fn` | ❌ | — |
| `off(event, cb)` | `→ void` | ❌ | — |
| `addEventListener(event, cb)` | alias de `on()` | ❌ | — |
| `removeEventListener(event, cb)` | alias de `off()` | ❌ | — |

---

## 9. Métodos — Playlist / Contenido

| Método | Firma | Cobertura | Test(s) | Notas |
|--------|-------|-----------|---------|-------|
| `addToPlaylist(item)` | `→ Promise` | ❌ | — | Radio/podcast only |
| `removeFromPlaylist(id)` | `→ void` | ❌ | — | Radio/podcast only |
| `isMediaInPlaylist(id)` | `→ boolean` | ❌ | — | Radio/podcast only |
| `updateNextEpisode(data)` | `→ void` | ❌ | — | |
| `pauseBuffering()` | `→ void` | ❌ | — | Reels view only |
| `resumeBuffering()` | `→ void` | ❌ | — | Reels view only |

---

## 10. API de Ads (`player.ad`)

| Elemento | Tipo | Cobertura | Test(s) |
|----------|------|-----------|---------|
| `player.ad` | `AdObject│null` | ✅ | ad-beacons |
| `player.ad.info` | `AdInfo│null` | ✅ | ad-beacons |
| `player.ad.cuePoints` | `number[]` | ✅ | ad-beacons |
| `player.ad.skip()` | `→ void` | ✅ | ad-beacons |

### Estructura `AdInfo`

| Campo | Tipo | Cobertura | Notas |
|-------|------|-----------|-------|
| `duration` | number | ✅ | ad-beacons |
| `isLinear` | boolean | ✅ | ad-beacons |
| `skippable` | boolean | ✅ | ad-beacons |
| `clickThroughUrl` | string | ❌ | |
| `contentType` | string | ❌ | |
| `currentTime` | number | ❌ | |
| `remainingTime` | number | ❌ | |
| `podIndex` | number | ❌ | |
| `id` | string | ❌ | |
| `title` | string | ❌ | |
| `advertiser` | string | ❌ | |
| `creativeUrl` | string | ❌ | |
| `adVerifications` | array | ⏭ | OM SDK |

---

## 11. Eventos — Custom del Player

| Evento | Payload | Cobertura | Test(s) | Notas |
|--------|---------|-----------|---------|-------|
| `loaded` | — | ✅ | player-api | Config plataforma procesada |
| `ready` | — | ✅ | smoke, vod-playback, player-api | Player listo para llamadas de API |
| `sourcechange` | — | ✅ | player-api | Nuevo src cargado (después de load()) |
| `metadataloading` | — | ❌ | — | |
| `metadataloaded` | object | ✅ | player-api, vod-playback | |
| `metadatachanged` | object | ❌ | — | |
| `error` | Error | ✅ | player-api | ID inválido → error |
| `buffering` | — | ❌ | — | |
| `programdatetime` | Date | ❌ | — | Live only |
| `levelchange` | object | 🟡 | hls-abr | Solicitado cambio de calidad |
| `levelchanged` | object | ✅ | vod-playback, hls-abr | Cambio efectuado |
| `adblockerDetected` | — | ❌ | — | Requiere detectAdblocker=true |
| `share` | — | ❌ | — | |

---

## 12. Eventos — HTML5 (Proxied)

| Evento | Cobertura | Test(s) |
|--------|-----------|---------|
| `loadstart` | ❌ | — |
| `loadedmetadata` | ✅ | vod-playback, smoke, player-api |
| `loadeddata` | ❌ | — |
| `canplay` | ✅ | vod-playback, player-api |
| `canplaythrough` | ❌ | — |
| `play` | ✅ | player-api |
| `playing` | ✅ | smoke, vod-playback, live-playback, player-api |
| `pause` | ✅ | vod-playback |
| `ended` | ✅ | vod-playback |
| `seeking` | ❌ | — |
| `seeked` | ✅ | smoke, vod-playback |
| `timeupdate` | ✅ | vod-playback |
| `durationchange` | ❌ | — |
| `volumechange` | ❌ | — |
| `ratechange` | ❌ | — |
| `waiting` | ❌ | — |
| `stalled` | ❌ | — |
| `suspend` | ❌ | — |
| `abort` | ❌ | — |
| `emptied` | ❌ | — |
| `progress` | ❌ | — |

---

## 13. Eventos — View-Specific

| Evento | Cobertura | Test(s) | Notas |
|--------|-----------|---------|-------|
| `fullscreenchange` | ❌ | — | Video view |
| `enterpictureinpicture` | ⏭ | — | |
| `leavepictureinpicture` | ⏭ | — | |

---

## 14. Eventos — Ads (Google IMA)

| Evento | Cobertura | Test(s) |
|--------|-----------|---------|
| `adsStarted` | ✅ | ad-beacons |
| `adsComplete` | ✅ | ad-beacons |
| `adsAllAdsCompleted` | ✅ | ad-beacons |
| `adsFirstQuartile` | ✅ | ad-beacons |
| `adsMidpoint` | ✅ | ad-beacons |
| `adsThirdQuartile` | ✅ | ad-beacons |
| `adsImpression` | 🟡 | ad-beacons (beacon HTTP) | |
| `adsSkipped` | 🟡 | ad-beacons (condicional) | |
| `adsError` | ✅ | ad-beacons |
| `adsContentPauseRequested` | ✅ | ad-beacons |
| `adsContentResumeRequested` | ✅ | ad-beacons |
| `adsLoaded` | ❌ | — |
| `adsAdMetadata` | ❌ | — |
| `adsAdBreakReady` | ❌ | — |
| `adsDurationChange` | ❌ | — |
| `adsLinearChanged` | ❌ | — |
| `adsPaused` | ❌ | — |
| `adsResumed` | ❌ | — |
| `adsSkippableStateChanged` | ❌ | — |
| `adsClick` | ❌ | — |
| `adsTimeUpdate` | ❌ | — |
| `adsUserClose` | ❌ | — |
| `adsVolumeChanged` | ❌ | — |
| `adsVolumeMuted` | ❌ | — |
| `adsAdBuffering` | ❌ | — |
| `adsAdCanPlay` | ❌ | — |
| `adsAdProgress` | ❌ | — |
| `adsExpandedChange` | ❌ | — |
| `adsInteraction` | ❌ | — |
| `adsViewableImpression` | ❌ | — |
| `adsVideoClicked` | ❌ | — |
| `adsVideoIconClicked` | ❌ | — |
| `adsRequested` | ❌ | — |
| `adsLog` | ❌ | — |

---

## 15. Eventos — Text Tracks

| Evento | Cobertura | Test(s) | Notas |
|--------|-----------|---------|-------|
| `texttrackchange` | ✅ | text-tracks (activar, desactivar, cambiar) | 3 tests dedicados |
| `texttrackaddtrack` | ❌ | — | |
| `texttrackremovetrak` | ❌ | — | Typo en fuente (`trak`) |
| `audiotrackchange` | 🟡 | vod-playback (condicional) | Requiere `vodMultiAudio` ID |
| `audiotrackaddtrack` | ❌ | — | |
| `audiotrackremovetrak` | ❌ | — | Typo en fuente (`trak`) |

---

## 16. Eventos — Playlist / Misc

| Evento | Cobertura | Test(s) |
|--------|-----------|---------|
| `playlistchange` | ❌ | — |
| `quizAnswered` | ❌ | — |
| `reactionEmitted` | ❌ | — |
| `nextEpisodeIncoming` | ❌ | — |
| `nextEpisodeConfirmed` | ❌ | — |
| `nextEpisodeLoadRequested` | ❌ | — |
| `restriction` | ❌ | — |
| `alert` | ❌ | — |
| `contentFirstPlay` | ❌ | — |

---

## 17. Eventos — Cast / PiP

| Evento | Cobertura | Notas |
|--------|-----------|-------|
| `castStateChange` | ⏭ | Requiere Chromecast SDK |
| `castConnected` | ⏭ | |
| `castDisconnected` | ⏭ | |
| `castError` | ⏭ | |
| `castMediaLoaded` | ⏭ | |
| `castMediaEnded` | ⏭ | |
| `castTracksLoaded` | ⏭ | |
| `castActiveTracksChanged` | ⏭ | |
| `pip` | ❌ | Picture-in-Picture |

---

## 18. Text Tracks API (`player.textTracks`)

| Elemento | Cobertura | Test(s) | Notas |
|----------|-----------|---------|-------|
| `textTracks.length` | ✅ | text-tracks (inventario) | Verificado: 5 tracks |
| `textTracks[index]` | ✅ | text-tracks (inventario) | Iterado en todos los tests de estructura |
| `textTracks.getTrackById(id)` | ✅ | text-tracks (activación) | Usado en `setTextTrackMode` vía PO |
| `track.id` | ✅ | text-tracks (inventario, lectura) | URL del .vtt |
| `track.kind` | ✅ | text-tracks (inventario) | Todos `subtitles` |
| `track.label` | ✅ | text-tracks (lectura) | ru, fr, it, es-co, base |
| `track.language` | ✅ | text-tracks (inventario, lectura) | BCP-47 codes |
| `track.mode` | ✅ | text-tracks (activación, persistencia) | disabled/showing |
| `addTextTrack(kind, label, lang)` | ❌ | — | No expuesto en la API pública del player |

---

## 19. Audio Tracks API (`player.audioTracks`)

| Elemento | Cobertura | Test(s) | Notas |
|----------|-----------|---------|-------|
| `audioTracks.length` | 🟡 | vod-playback | Bloqueado: ID pendiente |
| `audioTracks[index]` | ❌ | — | |
| `audioTracks.getTrackById(id)` | ❌ | — | Usado en PO `setAudioTrack` |
| `track.id` | ❌ | — | |
| `track.kind` | ❌ | — | |
| `track.label` | ❌ | — | |
| `track.language` | ❌ | — | |
| `track.enabled` | 🟡 | vod-playback (condicional) | |

---

## 20. View Types (`view` param)

| View | Descripción | Cobertura | Notas |
|------|-------------|-----------|-------|
| `video` (alias: `lightning`) | Video completo con controles | ✅ | Default en todos los tests VOD/Live |
| `audio` | Audio-only | ✅ | a11y, visual tests |
| `compact` | Audio mínimo (sidebar) | ❌ | — |
| `radio` | Stream de radio | ❌ | — |
| `radioSA` | Radio SA variant | ❌ | — |
| `podcast` | Podcast v1 | ❌ | — |
| `podcast2` | Podcast v2 | ❌ | — |
| `reels` | Video vertical (TikTok-like) | ❌ | — |
| `none` | Sin UI (requiere `renderAs`) | ❌ | — |

---

## 21. Content Types (`type` param)

| Type | Descripción | Cobertura | Test(s) |
|------|-------------|-----------|---------|
| `media` | VOD video/audio | ✅ | smoke, vod-playback, player-api |
| `episode` | Episode (serie) | ✅ | vod-playback (`load` test) |
| `live` | Stream en vivo | ✅ | smoke, live-playback |
| `dvr` | Live con rewind | ✅ | live-playback |

---

## 22. DVR / Catchup

| Funcionalidad | Cobertura | Test(s) | Notas |
|---------------|-----------|---------|-------|
| `isDVR=true` | ✅ | live-playback | |
| `seekable` window | 🟡 | live-playback | Condicional (skip si no disponible) |
| `start`/`end` ISO config | ❌ | — | Catchup time range |
| `forceDVR` option | ❌ | — | |
| `duration` override | ❌ | — | |

---

## 23. Source Handlers

| Handler | Activación | Cobertura | Test(s) |
|---------|------------|-----------|---------|
| HLS.js (`hls`) | `.m3u8` | ✅ | hls-abr, vod-playback, smoke |
| DASH (`dash`) | `.mpd` | 🟡 | qoe-metrics (streams externos) |
| Native HTML5 (`mp4`) | `.mp4` | ❌ | — |
| Native Safari HLS | FairPlay DRM | ⏭ | Requiere Safari |

---

## 24. IDs de Contenido DEV

> Registrados en `fixtures/streams.ts`. Reemplazar TODOs con IDs reales cuando estén disponibles.

| Constante | ID | Estado | Notas |
|-----------|-----|--------|-------|
| `ContentIds.vodShort` | `69d2f1e0461dd502cd921ad6` | ✅ Activo | ~2 min |
| `ContentIds.vodLong` | `6900ffde6ddf33fd39a523ee` | ✅ Activo | >10 min |
| `ContentIds.live` | `6971288e64b2477e2b935259` | ✅ Activo | Requiere accessToken |
| `ContentIds.dvr` | `6971288e64b2477e2b935259` | ✅ Activo | Mismo que live |
| `ContentIds.audio` | `698b4a88d9cc56fe7a404079` | ✅ Activo | |
| `ContentIds.radio` | `698b4a88d9cc56fe7a404079` | 🟡 Mismo que audio | Confirmar ID dedicado |
| `ContentIds.vodWithAds` | `6900fffb6ddf33fd39a5288e` | 🟡 Sin usar en E2E | Pre-roll + mid-roll (10s) |
| `ContentIds.vodWithSubtitles` | `69d3081d5493800312af8b6e` | ✅ Activo | 5 subtítulos: ru-ru, fr-fr, it-it, es-co, es-cl |
| `ContentIds.vodMultiAudio` | `TODO_VOD_MULTI_AUDIO_ID` | 🔴 Pendiente | Bloquea track tests |
| `ContentIds.podcast` | `TODO_PODCAST_ID` | 🔴 Pendiente | |

---

## 25. Acceso Restringido (Access Tokens)

| Recurso | Token | Estado |
|---------|-------|--------|
| live / dvr | `clLCZenCE5zwB7w...BhVbG` | ✅ Activo |

> Tokens almacenados en `fixtures/streams.ts` (`ContentAccess`). Solo tokens de DEV — no commitear tokens de producción.

---

## 26. Cobertura por Suite de Tests

| Suite | Archivo | Tipo | Ámbito |
|-------|---------|------|--------|
| Smoke | `tests/smoke/player-smoke.spec.ts` | E2E real | Salud mínima — todos los ambientes |
| VOD Playback | `tests/e2e/vod-playback.spec.ts` | E2E real | API VOD completa |
| Live Playback | `tests/e2e/live-playback.spec.ts` | E2E real | Live + DVR |
| Player API | `tests/e2e/player-api.spec.ts` | E2E real | Propiedades, eventos, API avanzada |
| HLS ABR | `tests/integration/hls-abr.spec.ts` | Integración aislada | Adaptive Bitrate (local streams) |
| Ad Beacons | `tests/integration/ad-beacons.spec.ts` | Integración aislada | Ciclo de vida de ads + beacons HTTP |
| Accessibility | `tests/a11y/accessibility.spec.ts` | A11y aislada | WCAG 2.1 AA |
| Visual | `tests/visual/player-ui.spec.ts` | Visual regression | Screenshots deterministas |
| Text Tracks | `tests/e2e/text-tracks.spec.ts` | E2E real | 19 tests — inventario, activación, eventos, persistencia |
| QoE Performance | `tests/performance/qoe-metrics.spec.ts` | Performance (CDP) | Startup, buffer, seek latency |

---

## 27. Backlog de Tests Prioritarios

Ordenados por impacto de cobertura / riesgo de regresión.

### Alta Prioridad (bloquean funcionalidad documentada)

| # | Test a Escribir | Área | Bloqueador |
|---|-----------------|------|------------|
| 1 | ~~Text tracks: seleccionar/desactivar subtítulos~~ | textTracks API | ✅ COMPLETADO — 19 tests en text-tracks.spec.ts |
| 2 | Audio tracks: cambiar idioma | audioTracks API | Necesita `vodMultiAudio` ID real |
| 3 | `load()` con `startPos` | load() options | — |
| 4 | `load()` DVR con `start`/`end` catchup | DVR load options | — |
| 5 | Player `type='media'` con `src` directo (MP4) | source handlers | — |
| 6 | `view: 'compact'` — player compacto | view types | — |
| 7 | `view: 'radio'` — radio stream | view types | Necesita radio ID |
| 8 | `view: 'podcast'` — podcast player | view types | Necesita podcast ID |
| 9 | `contentFirstPlay` evento (sin ads vs con ads) | custom events | — |
| 10 | `vodWithAds` — secuencia completa pre-roll E2E | ad lifecycle E2E | ID disponible |

### Media Prioridad

| # | Test a Escribir | Área |
|---|-----------------|------|
| 11 | `getOption()` / `setOption()` runtime | config runtime |
| 12 | `once()` — listener de un solo disparo | event API |
| 13 | `off()` — deregistrar listener | event API |
| 14 | `loop: true` — repetición de contenido | playback options |
| 15 | `nextEpisodeId` / `nextEpisodeTime` | episode API |
| 16 | `programDateTime` — timestamp en live | live properties |
| 17 | `handler` property — detectar HLS vs DASH vs native | source handler |
| 18 | `version` property | player metadata |
| 19 | Evento `buffering` | custom events |
| 20 | Evento `volumechange` | HTML5 events |

### Baja Prioridad / Fuera de Scope Actual

| # | Test a Escribir | Área | Notas |
|---|-----------------|------|-------|
| 21 | `addToPlaylist()` / `removeFromPlaylist()` | playlist | Radio/podcast only |
| 22 | `view: 'reels'` + `pauseBuffering()` | reels API | TikTok-like UI |
| 23 | `detectAdblocker` + evento `adblockerDetected` | ads | |
| 24 | DRM FairPlay | DRM | Safari + certificado |
| 25 | DRM Widevine | DRM | Chrome + CDM |
| 26 | Chromecast API | cast | SDK externo |
| 27 | PiP (Picture-in-Picture) | UI | Browser API |
| 28 | `data-loaded` callback (script tag init) | init alternativo | |
| 29 | `loadConfig()` — reinicialización | config runtime | |
| 30 | SGAI (Server-Guided Ad Insertion) | ads avanzado | |

---

## 28. Notas Técnicas

### Comportamiento Verificado en DEV (observado en tests)

- `player.readyState` **no está expuesto** como propiedad del player. Se debe leer del elemento HTML5 (`document.querySelector('video').readyState`) o inferir vía evento `canplay` (≥ 3).
- `player.metadata` retorna `{}` vacío después de `ready`. El contrato del evento `metadataloaded` es más confiable que leer la propiedad.
- `player.volume` puede retornar `1` hasta que el elemento `<video>` exista (después de `playing` o `canplay`). Usar `expect.poll()` para verificarlo.
- Después de `load()`, el player requiere un nuevo evento `ready` antes de que `play()` sea válido (error: *"Player is not ready. Wait for ready event"*).
- Para streams live/dvr, `load()` requiere el mismo `accessToken` que el init original.
- Los eventos `loaded` y `metadataloaded` se emiten **antes** de que la Promise de `loadMSPlayer()` resuelva (antes del `.then()`), por lo que se perdían sin backfill. Solucionado en `harness/index.html`.
- `sourcechange` se emite síncronamente al inicio de `load()`, por lo que limpiar el array de eventos **antes** de llamar a `load()` es crítico para capturarlo.
- Orden real de eventos en init: `metadataloading → metadataloaded → loaded → ready` (no `loaded → metadataloaded`).

### Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `fixtures/player.ts` | Page Object Model — toda interacción con el player |
| `fixtures/index.ts` | Fixtures de Playwright (`player`, `isolatedPlayer`, `adBeaconInterceptor`) |
| `fixtures/streams.ts` | ContentIds, ContentAccess, LocalStreams, NetworkProfiles |
| `fixtures/platform-mock.ts` | Interceptación de `develop.mdstrm.com` para tests aislados |
| `harness/index.html` | Harness HTML que inicializa el player con `loadMSPlayer()` |
| `playwright.config.ts` | Config de Playwright (webServers, projects, timeouts) |
| `helpers/qoe-metrics.ts` | CDP helpers para métricas de performance |
| `helpers/network-conditions.ts` | Network throttling utilities |
