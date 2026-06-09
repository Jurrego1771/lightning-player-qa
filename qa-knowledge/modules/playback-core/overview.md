# playback-core — Overview

## Qué hace

El módulo `playback-core` es el núcleo de reproducción del Mediastream Lightning Player. Gestiona el ciclo de vida completo de un elemento media HTML5 (audio/video), selecciona el handler correcto según el tipo de stream, expone la API pública de control de playback, y emite los eventos estándar y personalizados del player.

Es el módulo más crítico del sistema: todos los demás módulos (HLS, DASH, DRM, Ads, Subtítulos) dependen de playback-core como capa de orquestación.

### Tipos de player soportados

- `VideoPlayer` — instancia con `playerType: 'video'` (extiende BasePlayer)
- `AudioPlayer` — instancia con `playerType: 'audio'` (extiende BasePlayer)

### Tipos de contenido válidos

`'media'` | `'live'` | `'dvr'` | `'episode'` (equivale a `'media'` internamente) | `'audio'` | `'radio'` | `'reels'` | `'podcast'`

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/base.js` | `BasePlayer` — React.PureComponent que orquesta handler selection, state management, eventos y API pública |
| `src/player/video.js` | `VideoPlayer` — extiende BasePlayer con `videoWidth`/`videoHeight` |
| `src/player/audio.js` | `AudioPlayer` — extiende BasePlayer con `playerType: 'audio'` |
| `src/player/handler/native.js` | `NativeHandler` — handler para contenido nativo (MP4, audio, FairPlay HLS en Safari) |
| `src/player/handler/hls/` | Handlers HLS (normal, light, beta) — se seleccionan según `hlsVariant` |
| `src/player/handler/dash/` | Handler DASH — usa playback nativo del browser, sin dash.js |
| `src/player/textTracks.js` | Gestión de text tracks (subtítulos/captions) |
| `constants.cjs` | `Events.*` y `properties.*` — catálogo completo de eventos y propiedades públicas |

---

## Flujo de datos

```
loadMSPlayer(containerId, config)
  └── React mount: LightningPlayerInterface → ContextProvider → View → BasePlayer
        ├── getDerivedStateFromProps() — valida type, src; calcula srcType (hls/dash/native)
        ├── componentDidMount() → _setBindings() + _exposeMethods() + register('player', this)
        │
        ├── Selección de handler (render):
        │   ├── srcType === 'dash'        → DashHandler
        │   ├── srcType === 'hls' + nativo → NativeHandler
        │   ├── srcType === 'hls' + hls.js → HLSHandler | HLSHandlerLight | HLSHandlerBeta
        │   └── sin src                   → React.Fragment (headless hasta que src llega)
        │
        ├── Handler mount → _load() → internalEmitter.emit('_playerLoaded')
        │                           → platform emite 'loaded'
        │
        ├── Player listo → emite 'ready'
        │
        ├── Autoplay (si config.autoplay === true) → play()
        │   └── emite 'playing' cuando currentTime > 0
        │
        └── componentWillUnmount() → _unsetBindings() + setData('player', null)
```

### Estado interno del player

| Estado | Descripción |
|--------|-------------|
| `_waiting` | Estado inicial — player esperando datos |
| `_playing` | Reproduciendo activamente |
| `_pause` | Pausado |
| `_buffering` | Sin buffer disponible, descargando |
| `error` | Error fatal — manejado por `ErrorHandler` component |

---

## API pública

### Métodos

| Método | Firma | Descripción |
|--------|-------|-------------|
| `play()` | `async play(): Promise<void>` | Inicia/reanuda reproducción. Delega al handler activo. |
| `pause()` | `pause(): void` | Pausa la reproducción. |
| `load(config)` | `load(options): void` | Cambia contenido. Resetea estado, re-emite `loaded → ready`. |
| `destroy()` | `destroy(): void` | Elimina DOM, remueve listeners, libera recursos. No-op si ya destruido. |
| `on(event, cb)` | `on(event: string, handler: Function): void` | Suscribir a evento público. Eventos inválidos ignorados silenciosamente. |
| `once(event, cb)` | Suscribir una sola vez | — |
| `off(event, cb)` | Desuscribir | — |
| `showControls()` | Mostrar controles UI | — |
| `hideControls()` | Ocultar controles UI | — |
| `pauseBuffering()` | Detener buffering (Reels) | Pausa la carga de buffer (usado por Reels para items que se van a descartar) |
| `resumeBuffering()` | Reanudar buffering (Reels) | — |

### Propiedades (R = solo lectura, R/W = lectura y escritura)

**Estado de playback:**

| Propiedad | Tipo | R/W | Nota |
|-----------|------|-----|------|
| `status` | `'playing'\|'pause'\|'buffering'\|'error'` | R | Estado custom — no HTML5 readyState |
| `currentTime` | Number | R/W | Setter dispara seek. Valores negativos clampeados a 0. |
| `duration` | Number | R | Duración total en segundos |
| `paused` | Boolean | R | `true` cuando pausado o no iniciado |
| `ended` | Boolean | R | `true` cuando currentTime === duration |
| `volume` | Number 0-1 | R/W | Rango: 0.0 (mute) a 1.0 (máximo) |
| `playbackRate` | Number | R/W | Default: 1.0 |
| `muted` | Boolean | R/W | — |
| `loop` | Boolean | R/W | Default: false |
| `autoplay` | Boolean | R | Solo lectura post-init |
| `src` | String | R | URL del stream activo |
| `buffered` | TimeRanges | R | Rangos con buffer descargado |
| `seekable` | TimeRanges | R | Rango seekable — crítico para DVR |
| `readyState` | Number 0-4 | R | HTMLMediaElement readyState estándar |

**Stream info:**

| Propiedad | Tipo | R/W | Nota |
|-----------|------|-----|------|
| `isLive` | Boolean | R | Stream en vivo |
| `isDVR` | Boolean | R | DVR disponible |
| `isPlayingAd` | Boolean | R | Ad activo |
| `sourceType` | String | R | `'hls'`, `'native'`, `'dash'` |
| `playerType` | String | R | `'video'`, `'audio'` |
| `type` | String | R | Tipo de contenido cargado |
| `handler` | String | R | Handler activo (ej: `'html5/native'`, `'hls'`) |
| `programDateTime` | Date | R | Fecha/hora del programa (streams en vivo) |

**HLS-only (solo válido cuando sourceType === 'hls'):**

| Propiedad | Tipo | R/W | Nota |
|-----------|------|-----|------|
| `level` | Number | R | Nivel activo actual |
| `nextLevel` | Number | R/W | Nivel solicitado |
| `levels` | Array | R | Niveles ABR disponibles |
| `bandwidth` | Number | R | Bandwidth estimado (bps) |
| `bitrate` | Number | R | Bitrate del nivel activo |
| `edge` | String | R | CDN edge server activo |
| `droppedFrames` | Number | R | Frames dropped |

**Video info (VideoPlayer únicamente):**

| Propiedad | Tipo | R/W | Nota |
|-----------|------|-----|------|
| `videoWidth` | Number | R | Resolución efectiva horizontal |
| `videoHeight` | Number | R | Resolución efectiva vertical |

**Tracks y metadata:**

| Propiedad | Tipo | R | Nota |
|-----------|------|---|------|
| `textTracks` | TextTrackList | R | Subtítulos/captions |
| `audioTracks` | AudioTrackList | R | Audio tracks (multi-audio) |
| `icyMetadata` | Object | R | Metadata ICY (radio) |
| `textMetadata` | Object | R | Metadata de texto |

---

## Eventos emitidos

### Secuencia de inicialización

```
loaded → ready → [playing] (si autoplay: true)
```

### Ciclo de vida de reproducción

| Evento | Condición | Payload |
|--------|-----------|---------|
| `loaded` | Dependencias cargadas, antes de `ready` | `{}` |
| `ready` | Player inicializado y listo | `{}` |
| `playing` | `video.paused === false && currentTime > 0` | `{}` |
| `pause` | Audio/video pausado | `{}` |
| `ended` | `currentTime === duration` | `{}` |
| `seeking` | Usuario inicia seek | `{}` |
| `seeked` | Seek completado | `{}` |
| `buffering` | Sin buffer disponible | `{}` |
| `sourcechange` | Fuente de contenido cambió | `{}` |
| `timeupdate` | `currentTime` cambió (~250ms) | `currentTime: number` |
| `error` | Error fatal durante carga/reproducción | `{ fatal: boolean, message: string, code: number }` |
| `contentFirstPlay` | Primera vez que el contenido real reproduce (no ads) | `{}` |

### Eventos HTML5 estándar (re-emitidos)

`loadstart`, `loadedmetadata`, `loadeddata`, `canplay`, `canplaythrough`, `durationchange`,
`ratechange`, `volumechange`, `waiting`, `stalled`, `suspend`, `progress`, `abort`, `emptied`

---

## Interacciones con otros sistemas

| Sistema | Tipo de interacción |
|---------|---------------------|
| **HLS handler** | BasePlayer selecciona y monta `HLSHandler` cuando `srcType === 'hls'` y hls.js está soportado |
| **DASH handler** | BasePlayer monta `DashHandler` cuando `srcType === 'dash'`; usa playback nativo del browser (sin dash.js) |
| **Native handler** | Para MP4, audio, y FairPlay HLS en Safari; incluye lógica de FairPlay key management |
| **DRM** | `NativeHandler` implementa FairPlay via `webkitneedkey`; Widevine/PlayReady van por el HLS handler |
| **Ads Manager** | `play()`/`pause()` en controls delegan a `adsManager` cuando hay ad activo |
| **Subtítulos** | `textTracks.js` gestiona TextTrackList; ICY metadata via ID3 tags |
| **Events bus** | Usa `internalEmitter` (EventEmitter custom) para comunicación interna; `externalEmitter` para eventos públicos |
| **Controls** | `src/controls/index.js` expone `currentTime`, `paused`, `status`, `error`, `isPlayingAd` y coordina con adsManager |
| **Platform config** | `getDerivedStateFromProps` consume `context.autoplay`, `context.volume`, `context.loop`, `context.hlsVariant` |

---

## Notas de implementación relevantes para QA

1. **HLS.js siempre preferido sobre native HLS:** Incluso si el browser soporta HLS nativo, se usa hls.js excepto en Safari con FairPlay.
2. **DASH no tiene ABR propio:** `level`, `levels`, `bandwidth`, `bitrate` retornan `undefined`/`null` con DASH. `sourceType` devuelve `'native'`.
3. **autoplay default es `true`:** Si `'autoplay' in context` no existe en la config, el player usa `true` por defecto.
4. **loop default es `false`:** Sólo activo si config incluye `loop: true | '1' | 1`.
5. **volume se normaliza:** Si `volume` no está en rango 0-1 o no es un número, se usa `1` (máximo).
6. **ended event deduplicado:** `NativeHandler` tiene flag `_alreadyEmittedEnded` para evitar doble emisión de `ended` en streams que hacen loop.
7. **volumechange bug workaround:** El handler corrige saltos de volumen a 1 que ocurren aleatoriamente al cargar contenido.
8. **pingReload:** NativeHandler implementa `_pingReload()` (4s interval) para recuperarse de `waiting`/`error` sin que el player quede congelado.
