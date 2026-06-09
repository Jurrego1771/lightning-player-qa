# State — Overview

## Qué hace

El módulo `state` es la capa de estado reactivo del Lightning Player. Gestiona la
sincronización bidireccional entre el estado interno del browser/HTML5 video element y la
API pública del player. No es un módulo con UI propia — es la infraestructura que conecta
eventos del DOM, el contexto React y los átomos Jotai con los getters/setters públicos que
el integrador consume.

Su responsabilidad central es garantizar que en todo momento `player.currentTime`,
`player.volume`, `player.status`, `player.paused`, etc. devuelvan valores frescos y
consistentes con el estado real del media element, sin importar si hay ads jugando,
si el stream es DVR, o si el player acaba de ser destruido y reconstruido.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/context/index.jsx` | `ContextProvider` React — fuente de verdad para estado de configuración (src, type, playerStatus, volume…) |
| `src/context/useContext.js` | Hook para consumir el contexto con memoización profunda |
| `src/view/video/atoms/store.js` | Jotai store aislado (`videoStore`) — separado del store global de React |
| `src/view/video/atoms/provider.js` | `VideoProvider` — monta el Jotai store y sincroniza contexto React → átomos |
| `src/view/video/atoms/context.js` | Re-exporta `contextAtom` y `contextValueFamily` desde atoms comunes |
| `src/view/video/atoms/playerStatus.js` | Átomos derivados de `playerStatus`: `isPlayingAtom`, `isBufferingAtom`, `playerStatusAtom`, `firstPlayAtom`, `contentFirstPlayAtom`, `videoEndedAtom` |
| `src/view/video/atoms/currentTime.js` | `currentTimeAtom` — sincronizado con `timeupdate`, `seeking`, `seeked`; tiene lógica especial DVR |
| `src/view/video/atoms/duration.js` | `durationAtom` — silencia actualizaciones durante ads para evitar race condition |
| `src/view/video/atoms/volume.js` | `volumeAtom` (R/W), `muteAtom` (R/W) — sincronizados con `volumechange` del HTML5 element |
| `src/view/video/atoms/seeking.js` | `isSeekingAtom` — sincronizado con eventos `seeking`/`seeked` del API |
| `src/view/video/atoms/buffer.js` | `bufferAtom`, `bufferAheadAtom` — rangos del buffer actualizados en `progress`/`timeupdate` |
| `src/view/video/atoms/level.js` | `levelAtom`, `levelsAtom`, `selectedLevelAtom` — solo relevante para HLS |
| `src/view/video/atoms/dvrState.js` | `dvrWindowStartAtom`, `isDVRLiveAtom` — estado específico de streams DVR |
| `src/view/video/atoms/status.js` | `statusAtom` — copia del `playerStatus` del contexto con debounce de 100ms |
| `src/controls/index.js` | `Controls` — expone `player.currentTime` (R/W), `player.paused`, `player.status`, `player.play()`, `player.pause()` |
| `src/player/base.js` | `BasePlayer` — expone el resto de propiedades de estado via `_exposeMethods()` |

## Arquitectura de estado: dos capas

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    API PÚBLICA (player.*)                    │
 │  player.currentTime  player.volume  player.status           │
 │  player.paused       player.duration player.ended           │
 └────────────────────┬────────────────────────────────────────┘
                      │ Object.defineProperty (LightningPlayer.prototype)
                      │ expuesto por Controls._exposeMethods() + BasePlayer._exposeMethods()
 ┌────────────────────▼────────────────────────────────────────┐
 │              CAPA 1 — React Context (ContextProvider)        │
 │  Estado de configuración + playerStatus                      │
 │  setData(key, value) → setState → re-render de consumidores  │
 │  Fuente primaria para: src, type, playerStatus, volume (init)│
 └────────────────────┬────────────────────────────────────────┘
                      │ MapContextToAtomHandler → setContext(context)
 ┌────────────────────▼────────────────────────────────────────┐
 │              CAPA 2 — Jotai Atoms (videoStore)               │
 │  Estado de playback en tiempo real                           │
 │  Átomos primitivos + efectos (atomEffect de jotai-effect)    │
 │  Fuente primaria para: currentTime, duration, buffered,      │
 │  isPlaying, isSeeking, volume (sync), level                  │
 └────────────────────┬────────────────────────────────────────┘
                      │ internalEmitter events
 ┌────────────────────▼────────────────────────────────────────┐
 │            HTML5 Video Element / HLS.js / Handler            │
 │  timeupdate, canplay, play, pause, volumechange, ended...    │
 └─────────────────────────────────────────────────────────────┘
```

## Máquina de estados del player (playerStatus)

Los valores de `playerStatus` son un enum custom (no equivalentes a HTMLMediaElement.readyState):

```
waiting → playing → buffering → playing
         ↘ pause ↗
         ↘ error (fatal)
```

| Estado | Valor string | Descripción |
|--------|-------------|-------------|
| Inicial / cargando | `"waiting"` | Estado por defecto al montar o cambiar source |
| Reproduciendo | `"playing"` | `_onPlaying` emitido por el handler |
| Pausado | `"pause"` | Llamada a `pause()` o `autoplay: false` post-canplay |
| Buffering | `"buffering"` | `_buffering` emitido por el handler |
| Error | `"error"` | Error fatal — gestionado por `ErrorHandler` |

**Nota de debounce:** `playerStatusAtom` y `statusAtom` aplican un delay de 100ms antes
de actualizar el átomo interno. Esto evita flickers cuando los ads inicializan (play + pause
en ~50ms). Consecuencia para tests: usar `expect.poll()` siempre.

## Sincronización de currentTime en DVR

En tipo `dvr`, `currentTimeAtom` transforma el tiempo absoluto del stream (puede ser >86400s)
a un offset relativo desde el inicio de la ventana DVR (`dvrWindowStartAtom`). El getter
`player.currentTime` devuelve este offset, no el tiempo absoluto del stream.

## API pública de estado

### Getters

| Propiedad | Tipo | Fuente interna |
|-----------|------|----------------|
| `player.currentTime` | `Number` (seconds) | Controls → playerHandler → `api.currentTime` |
| `player.duration` | `Number` (seconds) | BasePlayer → handler |
| `player.paused` | `Boolean` | Controls → `get('paused')` |
| `player.ended` | `Boolean` | BasePlayer → handler |
| `player.volume` | `Number [0,1]` | BasePlayer → handler |
| `player.status` | `String` | Controls → `get('status')` (verifica `api.error` primero) |
| `player.isLive` | `Boolean` | BasePlayer → `_isLive` state |
| `player.isDVR` | `Boolean` | BasePlayer → `_isDVR` state |
| `player.isPlayingAd` | `Boolean` | Controls → `isPlayingAd()` |
| `player.src` | `String` | BasePlayer → handler |
| `player.buffered` | `TimeRanges` | BasePlayer → handler |
| `player.seekable` | `TimeRanges` | BasePlayer → handler |
| `player.readyState` | `Number` | BasePlayer → handler |
| `player.playbackRate` | `Number` | BasePlayer → handler (R/W) |
| `player.loop` | `Boolean` | BasePlayer → handler |
| `player.autoplay` | `Boolean` | BasePlayer → state (R only) |
| `player.error` | `Error\|null` | BasePlayer via Controls |
| `player.version` | `String` | LightningPlayer constructor |

### Setters / Métodos de estado

| Operación | Cómo | Nota |
|-----------|------|------|
| Seek | `player.currentTime = seconds` | Controls expone setter |
| Volumen | `player.volume = 0..1` | BasePlayer expone setter; range validado en `volumeAtom` |
| Playback rate | `player.playbackRate = rate` | BasePlayer expone setter |
| Mute | `player.muted = bool` | BasePlayer → handler |
| Siguiente nivel HLS | `player.nextLevel = n` | BasePlayer expone setter |

### Métodos de ciclo de vida que afectan el estado

| Método | Efecto en estado |
|--------|-----------------|
| `player.play()` | `playerStatus → "playing"` (async, via evento interno) |
| `player.pause()` | `playerStatus → "pause"` (async) |
| `player.load({ type, id })` | Reset de `currentTime`, `paused`, `duration`; nuevo `loadKey` |
| `player.destroy()` | Todos los átomos reset a `null`; `internalEmitter.reset()` |

## Interacciones con otros módulos

- **playback-core / handlers:** Emiten los eventos HTML5 (`timeupdate`, `canplay`, etc.) que alimentan los átomos
- **ads-manager:** Silencia `currentTime` y `duration` mientras ads playing; expone estado de ad via `get('paused')`, `get('currentTime')` con override
- **controls-api:** Orquesta play/pause y expone los getters de estado al exterior
- **events:** `internalEmitter` es el bus de sincronización entre el DOM y los átomos Jotai
- **DVR (dvrState):** Transforma `currentTime` absoluto a offset relativo para la UI y el getter público
