# controls-api — Overview

## Qué hace

El módulo `controls-api` es el núcleo de control programático del player. Expone la API pública de reproducción (`play`, `pause`, `currentTime`, `paused`, `status`, `isPlayingAd`, `onNext`, `onPrev`) sobre el prototype de `LightningPlayer` mediante `Object.defineProperty`. Orquesta la delegación de comandos entre el `playerHandler` (hls.js / video nativo), el `adsManager` (IMA/AdSwizz) y overrides de terceros, en ese orden de prioridad.

Responsabilidades principales:
- Gestión del ciclo de vida de reproducción (play/pause/ready/autoplay)
- Guards de concurrencia para `play()` y `pause()` (`_calledPlaying`, `_calledPause`)
- Coordinación con `adsManager`: los comandos se delegan al gestor de anuncios cuando hay un ad activo
- Exposición de propiedades reactivas vía getters/setters sobre `LightningPlayer.prototype`
- Manejo de `startPos` y `resumePosition` al inicializar
- Sincronización de progreso de reproducción (`resumePlaying` platform API)

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/controls/index.js` | Componente React `Controls` — lógica principal del módulo |
| `src/controls/methods.js` | Helper `expose()` — monta getters/setters en `LightningPlayer.prototype` |
| `src/api/player.jsx` | `LightningPlayer` — clase wrapper que recibe los métodos expuestos |
| `src/api/api.js` | Bootstrap — espera `InternalEvents._controlsReady` antes de resolver `loadMSPlayer()` |
| `constants.cjs` | Eventos públicos (`Events._ready`, `Events._playing`, `Events._pause`, etc.) |

## Flujo de datos

```
loadMSPlayer()
    │
    ├─► mount LightningPlayer (player.jsx)
    │       └─► mount React tree → Controls.componentDidMount()
    │               └─► _exposeMethods() → Object.defineProperty(prototype, 'play', ...)
    │               └─► _createBindings() → escucha 'canplay', 'emptied', 'error'
    │               └─► emite InternalEvents._controlsReady
    │
    ├─► api.js espera _controlsReady → resuelve loadMSPlayer()
    │
    └─► integrador obtiene player instance con play/pause/currentTime/paused/status expuestos

Llamada a player.play():
    player.play()
        │
        ├─ Guard: ¿_calledPlaying? → return early (previene concurrencia)
        ├─ Check: ¿state._ready? → throw Error('Player is not ready...')
        ├─ await _awaitViewReady()
        ├─ ¿_hasAds && adsManager.play() !== false? → delega a adsManager → return
        ├─ ¿overrides.play() !== false? → delega a override → return
        └─ playerHandler.play() → emite 'playing'
```

## API pública

### Métodos

| Método | Firma | Retorna | Precondición |
|--------|-------|---------|--------------|
| `play()` | `play(): Promise<void>` | Promise | `state._ready === true` |
| `pause()` | `pause(): Promise<void>` | Promise | `state._ready === true` |
| `load(opt)` | `load({ type, id, ... }): Promise<void>` | Promise | Ninguna |
| `destroy()` | `destroy(): Promise<void>` | Promise | Ninguna |
| `loadConfig(opt)` | `loadConfig(opt): Promise<void>` | Promise | Ninguna |
| `on(event, cb)` | `on(event: string, cb: Function)` | EventEmitter | Ninguna |
| `off(event, cb)` | `off(event: string, cb: Function)` | EventEmitter | Ninguna |
| `once(event, cb)` | `once(event: string, cb: Function)` | EventEmitter | Ninguna |
| `showControls()` | `showControls(): void` | void | Ninguna |
| `hideControls()` | `hideControls(): void` | void | Ninguna |
| `isPlayingAd()` | `isPlayingAd(): boolean` | boolean | Ninguna |
| `keepWatching()` | `keepWatching(): { success: boolean }` | Object | Ninguna |
| `playNext()` | `playNext(): { success: boolean }` | Object | Ninguna |
| `updateNextEpisode(data)` | `updateNextEpisode(data): void` | void | Ninguna |

### Propiedades (getters/setters expuestos por controls)

| Propiedad | Tipo | R/W | Comportamiento |
|-----------|------|-----|----------------|
| `currentTime` | `number` | R/W | Getter: retorna tiempo del adsManager si hay ad, sino playerHandler. Setter: ejecuta seek. Valores negativos → 0 (clamping silencioso). |
| `paused` | `boolean` | R | Delega a adsManager si hay ad, sino playerHandler. Retorna `true` si no está listo. |
| `status` | `string` | R | `'playing'` \| `'pause'` \| `'buffering'` \| `'error'`. Si `api.error`, fuerza `'error'`. |
| `isPlayingAd` | `boolean` | R | `true` si hay ad linear activo en adsManager o en algún override. |
| `onNext` | `Function\|null` | R/W | Callback para botón "Siguiente". Setter valida que sea función o null. |
| `onPrev` | `Function\|null` | R/W | Callback para botón "Anterior". Setter valida que sea función o null. |

### Propiedades adicionales (expuestas vía playerHandler)

| Propiedad | Tipo | R/W | Nota |
|-----------|------|-----|------|
| `volume` | `number [0,1]` | R/W | Clampeado a [0,1]. Emite `volumechange`. |
| `muted` | `boolean` | R/W | Emite `volumechange`. |
| `loop` | `boolean` | R | Solo lectura efectiva en runtime — `setLoop(true)` es no-op conocido en v1.0.75. |
| `playbackRate` | `number` | R/W | Rango válido: [0.25, 2.0] sin crash. |
| `duration` | `number` | R | Duración total en segundos. |
| `buffered` | `TimeRanges` | R | Rangos con buffer descargado. |
| `seekable` | `TimeRanges` | R | Rango seekable — crítico para DVR. |
| `src` | `string` | R | URL del stream activo. |
| `ended` | `boolean` | R | True si el contenido terminó. |
| `level` | `number` | R | Nivel de calidad HLS activo (solo HLS). |
| `levels` | `Array` | R | Niveles disponibles (solo HLS). |

### Eventos relevantes al módulo

| Evento | Cuándo | Notas |
|--------|--------|-------|
| `ready` | `_playerReady=true && _viewReady=true` | Precondición de `play()`/`pause()`. |
| `playing` | Resolución de `playerHandler.play()` | También se emite en autoplay exitoso. |
| `pause` | Resolución de `playerHandler.pause()` | |
| `seeking` | Setter `currentTime` invocado | Inmediato. |
| `seeked` | Seek completado por el video element | Puede tardar hasta ~2s en HLS (snap a keyframe). |
| `volumechange` | Cambio de `volume` o `muted` | |
| `error` | Fallo fatal o autoplay bloqueado | `play()` emite este evento si autoplay es rechazado por política de browser. |
| `ended` | Final del contenido | |
| `contentFirstPlay` | Primera reproducción de contenido real (no ad) | |

## Interacciones con otros módulos

| Módulo | Tipo | Descripción |
|--------|------|-------------|
| `ads-manager` (IMA/AdSwizz) | Delegación | `play()`/`pause()`/`get()`/`set()` se delegan primero al adsManager cuando `_hasAds` es true. |
| `playback-core` / `hls` | Delegación final | `playerHandler.play()/.pause()/.set()/.get()` — el destino final de los comandos si no hay ad. |
| `events` | Escucha + emisión | Usa `internalEmitter.on/emit`. Escucha `canplay`, `emptied`, `error`, `timeupdate`. |
| `state` / `Context` | Lectura/escritura | Lee `_autoplay`, `_src`, `_ads`. Escribe `_playerReady`, `_ready`, `_autoplayed`. |
| `platform/resumePlaying` | Persistencia | Lee/escribe progreso de reproducción cuando `_shouldResumePosition` está activo. |
| `api/player.jsx` | Protocolo | `methods.js` monta los métodos sobre `LightningPlayer.prototype`. |
