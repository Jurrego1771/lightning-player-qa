# DASH — Overview

## Qué hace

El módulo DASH gestiona la reproducción de streams MPEG-DASH (MPD) mediante **dash.js v5.1.1** como motor de MSE (Media Source Extensions). A diferencia del módulo HLS (que usa hls.js y expone ABR programático completo), el handler DASH delega la gestión del buffer y la selección de representaciones a dash.js, que opera sobre MSE nativo del browser.

El player selecciona automáticamente el handler DASH cuando:
- La URL de la fuente contiene extensión `.mpd` (auto-detect)
- Se configura `format: 'dash'` explícitamente en la llamada al player

Desde el exterior el DashHandler expone la misma interfaz pública que el HLS handler (get/set de propiedades, eventos HTML5 estándar), lo que permite que el player sea agnóstico al protocolo.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/handler/dash/handler.js` | Componente React que encapsula dash.js. Implementa get/set de propiedades, manejo de eventos y lógica DVR |
| `src/player/handler/dash/getSystem73DashSDK.js` | Lazy-load con caché del SDK P2P de System73 para dash.js |
| `src/player/drm/getDashProtectionData.js` | Construye el objeto `protectionData` para DRM Widevine/PlayReady en dash.js |
| `constants.cjs` | Eventos públicos del player (`Events.*`); DASH no tiene eventos propios adicionales |

## Flujo de datos

```
player.load({ id, type }) 
  └→ Platform API → src.mpd URL
       └→ DashHandler._load()
            ├→ MediaPlayer().create()            [dash.js instance]
            ├→ _bindDashEvents()                  [bridge dash.js → player events]
            ├→ getDashProtectionData()            [si hay DRM configurado]
            ├→ getSystem73DashSDK() (opcional)    [P2P wrapper si peering.system73.enabled]
            └→ player.initialize(el, src, false)  [dash.js inicia fetch del MPD]
                 ├→ MANIFEST_LOADED → InternalEvents._ready → 'ready'
                 ├→ QUALITY_CHANGE_REQUESTED → Events._levelchange
                 ├→ QUALITY_CHANGE_RENDERED  → Events._levelchanged
                 └→ ERROR → Events._error (MediaError | NetworkError)
```

Para streams DVR (`type: 'dvr'`):
```
player.currentTime = offset
  └→ DashHandler.set('currentTime', val)
       └→ _getDvrWindow() → { start, size }
            └→ player.seek(offset)  [si offset <= window.size]
                 └→ Events._dvrSeekApplied
```

## API pública

### Propiedades read-only

| Propiedad | Comportamiento en DASH |
|-----------|----------------------|
| `handler` | Retorna `'html5/mse+dash'` — string literal fijo |
| `levels` | Array de representaciones desde `getRepresentationsByType()`. Puede ser `[]` antes de MANIFEST_LOADED |
| `level` | Índice de la representación activa (`getCurrentRepresentationForType()`). Retorna `-1` si no inicializado |
| `bandwidth` | `getAverageThroughput()` convertido a bps. Puede ser `null` |
| `bitrate` | `levels[level].bitrate` — `null` si no hay representaciones |
| `duration` | `player.duration()` via dash.js. Para `type: 'live'` retorna `Infinity`. Para DVR puede tardar en popularse |
| `dvrWindow` | `{ start, size }` via `getDvrWindow()`. `null` si no es DVR o la ventana no está disponible |
| `programDateTime` | Extraído de `getDashAdapter().getAvailabilityStartTime()` en MANIFEST_LOADED. `null` si no disponible |
| `droppedFrames` | Via `getDashMetrics().getCurrentDroppedFrames()` |
| `autoLevelEnabled` | `true` por defecto. `false` cuando se fija nivel manualmente |
| `edge` | Hostname extraído de la URL del source. **No** es el live edge time |

### Propiedades write

| Propiedad | Comportamiento en DASH |
|-----------|----------------------|
| `level = N` | Llama `setRepresentationForTypeByIndex(N)` + deshabilita ABR auto (`autoSwitchBitrate: false`). `level = -1` restaura ABR auto |
| `currentTime = T` | Para DVR: `player.seek(T)` donde T es offset dentro de la ventana. Para VOD/Live: `player.seek(T)` directo |
| `volume = V` | `el.volume = V`, `el.muted = (V === 0)` |

### Métodos

| Método | Comportamiento |
|--------|---------------|
| `play()` | `player.play()` + seekToOriginalLive si latencia excede `bufferlength * 2` |
| `pause()` | `el.pause()` |
| `load()` | Re-inicializa el handler destruyendo el MediaPlayer anterior |
| `destroy()` | `player.destroy()` + `s73Wrapper.destroy()` si activo |
| `pauseBuffering()` | **No-op** — dash.js no tiene API equivalente a HLS pauseBuffering |
| `resumeBuffering()` | **No-op** — dash.js no tiene API equivalente |

### Eventos emitidos (bridge dash.js → player)

| Evento dash.js | Evento player |
|----------------|---------------|
| `MANIFEST_LOADED` | `InternalEvents._ready` → público `'ready'` |
| `QUALITY_CHANGE_REQUESTED` | `Events._levelchange` |
| `QUALITY_CHANGE_RENDERED` | `Events._levelchanged` |
| `ERROR` (fatal) | `Events._error` (MediaError o NetworkError) |
| `PLAYBACK_ERROR` | `Events._error` (MediaError) |
| HTML5 `waiting` | `Events._waiting` + `Events._buffering` |
| HTML5 `timeupdate` | `Events._timeupdate` con `currentTime` actual |
| Todos los demás HTML5 | Bridgeados directamente via `_nativeProps` |

## Interacciones con otros sistemas

- **DRM**: `getDashProtectionData()` construye el objeto Widevine/PlayReady y lo pasa a `player.setProtectionData()` antes de `initialize()`.
- **System73 P2P**: Si `context.metadata.peering.system73.enabled === true`, se lazy-carga el SDK y se llama `wrapper.wrapPlayer(player)` **antes** de `player.initialize()`. Si el SDK falla, el player continúa sin P2P (degradación suave).
- **TextTracks**: Renderizados por el componente `<TextTracks />` dentro del elemento `<video>`.
- **AudioTracks**: Gestionados via `AudioTrackListProxy` (proxy sobre las audio tracks de dash.js).
- **Google DAI con DASH**: El plugin `ads-dai` puede configurar `streamFormat=dash` para entregar un MPD con anuncios insertados en server-side.

## Diferencias clave con HLS en este player

| Aspecto | HLS (hls.js) | DASH (dash.js) |
|---------|-------------|----------------|
| ABR | Programático via `hls.currentLevel` | Via `setRepresentationForTypeByIndex()` + `autoSwitchBitrate` |
| DVR seek | Via `seekable` range de HLS.js | Via `player.getDvrWindow()` + `player.seek(offset)` |
| Live edge | `hls.liveSyncPosition` | `player.getCurrentLiveLatency()` + `player.duration()` |
| `pauseBuffering` | Funcional | No-op |
| `programDateTime` | `EXT-X-PROGRAM-DATE-TIME` en playlist | `getAvailabilityStartTime()` del adapter |
| Buffer config | Configurable en init | Configurable post-`MANIFEST_LOADED` via `updateSettings()` |
| Handler string | `'html5/mse'` | `'html5/mse+dash'` |
