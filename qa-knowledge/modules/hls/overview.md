# HLS — Overview

## Qué hace

El módulo HLS integra [hls.js v1.6.13](https://github.com/video-dev/hls.js) como motor de reproducción para streams HLS (HTTP Live Streaming) en browsers que soportan Media Source Extensions (MSE). Es el handler primario del player para contenido HLS en Chromium, Firefox y Safari (cuando no se puede usar HLS nativo).

Funcionalidades clave:
- Parseo de manifests M3U8 (master + media playlists)
- Descarga y transcodificación de segmentos TS/fMP4 via Web Worker
- Adaptive Bitrate (ABR) automático usando estimación EWMA de bandwidth
- Control manual de nivel de calidad (level override)
- Soporte DVR para streams live con sliding window
- FairPlay DRM via hls.js EME API (`emeEnabled`)
- Integración P2P opcional con System73 SDK
- CMCD (Common Media Client Data) para telemetría server-side
- Mapeo de eventos internos de hls.js a eventos públicos del player

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/handler/hls/handler.js` | Componente React (`HlsHandler`) — lógica principal de integración hls.js |
| `src/player/handler/hls/hls.js` | Variante normal: importa `hls.js/dist/hls.min.js` con Web Worker |
| `src/player/handler/hls/hls-light.js` | Variante light: importa `hls.js/dist/hls.light.min.js` (sin codecs opcionales) |
| `src/player/handler/hls/hls-beta.js` | Variante beta: usa hls.js-beta (actualmente apunta a la versión estable) |
| `src/player/handler/hls/isHLSJsSupported.js` | Detección de soporte MSE sin cargar hls.js completo |
| `src/player/handler/hls/getSystem73HlsSDK.js` | Lazy-load del SDK P2P System73 con cache de promesa |

## Flujo de datos

```
M3U8 URL
    │
    ▼
hls.attachMedia(videoElement)
    │
    ▼
MEDIA_ATTACHED → hls.loadSource(src)
    │
    ▼
MANIFEST_PARSED
    ├── internalEmitter.emit('ready')       ← player listo
    ├── hls.startLevel = -1                 ← ABR auto desde inicio
    └── audioTracksProxy poblado
    │
    ▼
Descarga segmentos (Web Worker) → MSE SourceBuffer.appendBuffer()
    │
    ├── LEVEL_SWITCHING → emit('levelchange', nextLevel)
    ├── LEVEL_SWITCHED  → emit('levelchanged', currentLevel)
    ├── FRAG_LOADED     → flush buffer si live + stalled
    ├── FRAG_CHANGED    → emit('programdatetime', timestamp)
    ├── LEVEL_LOADED    → emit('programdatetime') si EXT-X-PROGRAM-DATE-TIME
    └── FPS_DROP        → _droppedFrames acumulado
    │
    ▼
HTMLVideoElement eventos → internalEmitter
    (canplay, playing, timeupdate, waiting, error, etc.)
```

## API pública

### Propiedades (get/set via `player.level`, `player.levels`, etc.)

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `player.level` | `number` (get/set) | Nivel de calidad actual. `-1` = ABR auto. Set fuerza nivel manual. |
| `player.levels` | `Array<{index, height, width, bitrate, label}>` | Niveles disponibles del manifest. Solo válido post-`ready`. |
| `player.nextLevel` | `number` (get) | Nivel cargándose actualmente (`hls.loadLevel`). |
| `player.bandwidth` | `number\|null` | Estimación de ancho de banda en bps (promedio EWMA). `null` si no disponible. |
| `player.bitrate` | `number` | Bitrate del nivel actual en bps. |
| `player.autoLevelEnabled` | `boolean` | `true` si ABR está activo (level === -1). |
| `player.droppedFrames` | `number` | Frames perdidos acumulados (FPS_DROP events). |
| `player.programDateTime` | `Date\|null` | Timestamp del programa para streams live con EXT-X-PROGRAM-DATE-TIME. |
| `player.duration` | `number` | Para live: `Infinity`. Para VOD: duración real del elemento. |
| `player.edge` | `string\|null` | Hostname del CDN edge usado para el nivel actual. |
| `player.audioTracks` | `AudioTrackList` (proxy) | Lista de audio tracks (mapeada desde hls.js AUDIO_TRACKS_UPDATED). |
| `player.handler` | `'html5/mse+hls'` | Identificador del handler activo. |

### Métodos

| Método | Descripción |
|--------|-------------|
| `player.play()` | Llama `load()` (si preload=false), seek a live edge si necesario, luego `element.play()`. |
| `player.pause()` | Delega a `element.pause()`. |
| `player.pauseBuffering()` | Pausa el buffering de hls.js (usado por SGAI/ads). |
| `player.resumeBuffering()` | Reanuda el buffering de hls.js. |

### Eventos emitidos (públicos)

| Evento | Cuándo | Payload |
|--------|--------|---------|
| `ready` | MANIFEST_PARSED — player listo para recibir comandos | `{}` |
| `levelchange` | LEVEL_SWITCHING — nuevo nivel solicitado, aún no en buffer | `level: number` |
| `levelchanged` | LEVEL_SWITCHED — nuevo nivel activo en buffer | `level: number` |
| `programdatetime` | FRAG_CHANGED / LEVEL_LOADED — primer timestamp disponible | `Date` |
| `buffering` | Cuando el buffer se vacía y el player está esperando datos | `{}` |
| `stalled` | BUFFER_STALLED_ERROR o LEVEL_LOAD_ERROR (no fatal) | `{}` |
| `error` | Error fatal o no-fatal de hls.js o del elemento nativo | `Error` |
| `canplay` | HTMLVideoElement `canplay` | `{}` |
| `playing` | HTMLVideoElement `playing` | `{}` |
| `timeupdate` | HTMLVideoElement `timeupdate` | `currentTime: number` |
| `waiting` | HTMLVideoElement `waiting` | `{}` |
| (otros estándar) | `pause`, `play`, `ended`, `seeking`, `seeked`, `durationchange`, `volumechange`, etc. | según evento |

## Interacciones con otros sistemas

| Sistema | Relación |
|---------|----------|
| **quality-selector** | Lee `player.levels` y escribe `player.level` para control manual de ABR |
| **ads-sgai** | Usa `player.pauseBuffering()` / `player.resumeBuffering()` + `pLoader` custom en HLSConfig |
| **airplay** | `isAirPlaySupported()` controla `preferManagedMediaSource` — si AirPlay es posible, usa MSE regular (no ManagedMediaSource) para no perder el botón AirPlay |
| **drm** | `_getHlsDrmConfig()` inyecta `emeEnabled + drmSystems` en HLSConfig para FairPlay via EME |
| **events** | `internalEmitter` centraliza la emisión de eventos; HlsHandler escucha y re-emite |
| **platform-config** | `context.mse.bufferSize`, `context.mse.bufferlength`, `context.preloadEnabled`, `context.drm` controlan la configuración de hls.js |
| **system73** | P2P SDK que wraps hls.js via `wrapPlayerConfig()` + `wrapPlayer()`. Lazy-loaded; si falla, el player continúa sin P2P. |

## Configuración de hls.js aplicada por el player

| Config key | Valor aplicado | Razón |
|-----------|----------------|-------|
| `enableWorker` | `true` | Transcodificación en Web Worker para no bloquear el UI thread |
| `capLevelToPlayerSize` | `true` | No cargar calidades mayores al tamaño del contenedor |
| `autoStartLoad` | `context.preloadEnabled` | Preload controlado por la plataforma |
| `startPosition` | `-1` | Empezar desde el inicio (o live edge para live) |
| `nudgeMaxRetry` | `10` | Retry agresivo antes de error fatal |
| `nudgeOffset` | `0.016` | 1 frame a 60fps — mínimo desplazamiento para salir de stall |
| `maxBufferSize` | `bufferSize * 1MB` (default 60MB video, 2MB audio) | Control de memoria MSE |
| `maxBufferLength` | `bufferlength` (default 30s) | Buffer objetivo |
| `maxMaxBufferLength` | `10 * bufferlength` (300s) | Buffer máximo absoluto |
| `liveBackBufferLength` | `0` | No mantener buffer detrás del live edge |
| `liveSyncDuration` | `bufferlength` (30s) | Qué tan lejos del live edge se tolera |
| `preferManagedMediaSource` | `!isAirPlaySupported()` | Usa MMS solo si AirPlay no disponible |
| `cmcd` | `{contentId, sessionId}` | Telemetría CMCD si hay ID de contenido y sesión |
