# Chromecast — Overview

## Qué hace

El módulo Chromecast integra el Google Cast Application Framework (CAF) v3 al Lightning Player, permitiendo que el usuario proyecte contenido de video y audio a dispositivos Chromecast y televisores con Google Cast integrado. La integración es view-agnostic: el núcleo vive en `src/chromecast/` y las vistas (video, radio) consumen la capa de estado reactivo a través de Jotai atoms.

Funcionalidades clave:
- Carga lazy del Cast SDK desde `gstatic.com`
- Detección de soporte por browser (Chromium, no iOS)
- Apertura de dispositivo picker (`requestSession`)
- Carga de media en el dispositivo remoto con metadatos, subtítulos y posición actual
- Sincronización bidireccional de playback (play/pause/seek/volumen)
- Reanudación automática del local player al desconectar (con posición sincronizada)
- Control de subtítulos (text tracks) en el dispositivo remoto
- Exposición de API pública (`player.cast`, `player.isCasting`, `player.castDeviceName`)

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/chromecast/CastManager.js` | Clase principal — gestión de sesión, eventos, playback remoto |
| `src/chromecast/constants.js` | Enums: `CastState`, `CastPlayerState`, `ContentType`, `CAST_EVENT_DELAY_MS=500` |
| `src/chromecast/loader.js` | Carga lazy del SDK con timeout de 10s y singleton promise |
| `src/chromecast/isSupported.js` | Detección de browser (Chromium, no iOS) y contexto seguro (HTTPS/localhost) |
| `src/chromecast/subtitles.js` | Filtrado de formatos incompatibles (ASS/SSA), normalización a HTTPS |
| `src/chromecast/MediaBuilder.js` | Construcción de objetos `MediaInfo` para el Cast SDK |
| `src/chromecast/index.js` | Re-exports del módulo — API pública del módulo |
| `src/view/video/atoms/chromecast.js` | Jotai atoms — estado reactivo, efectos, exposición de `player.cast` |
| `src/view/common/hook/useChromecast.js` | Hook React view-agnostic (no Jotai) |
| `src/view/video/hooks/useChromecastVideo.js` | Hook video-específico sobre Jotai atoms |
| `constants.cjs` | Eventos públicos del player (prefijo `_cast*`) |

## Flujo de datos

```
Usuario click "Cast button"
        │
        ▼
castInitAtom (Jotai) → castManagerAtomEffect
        │
        ▼
CastManager.initialize()
  └─► loadCastSDK() [gstatic.com, timeout 10s]
  └─► CastContext.setOptions({ receiverAppId, autoJoinPolicy: ORIGIN_SCOPED, resumeSavedSession: true })
  └─► RemotePlayer + RemotePlayerController
        │
        ▼
CastManager.requestSession()
  └─► castContext.requestSession() → Picker nativo del browser
        │
  SESSION_STARTED ──────────────────────────────────────────────────────────────
        │                                                                        │
        ▼                                                                        ▼
autoLoadMedia()                                                     SESSION_RESUMED
  └─► buildMediaInfoFromApi(api, activeSubtitle)                 └─► forceTimeSync() [bfcache workaround]
  └─► manager.loadMedia(mediaInfo)                               └─► ignoreTimeUpdates 5s window
  └─► api.pause() [previene doble audio]
  └─► CAST_EVENT_DELAY_MS=500ms → emit 'tracksLoaded'
        │
        ▼
Playback remoto activo
  └─► RemotePlayerController events → Jotai atoms
  └─► internalEmitter.emit(Events._castStateChange, ...)

Usuario desconecta Cast
        │
        ▼
SESSION_ENDED
  └─► Comparar URL local vs remota (base URL sin query params)
  └─► Si mismo contenido: api.currentTime = remoteTime, api.play() si estaba playing
  └─► Reset de todos los atoms remotos
```

## API pública

Expuesta en el player via `expose()` en `src/view/video/atoms/chromecast.js`:

```js
player.cast = {
  state,           // CastState string
  isConnected,     // boolean
  isAvailable,     // boolean
  deviceName,      // string | null
  connect(),       // () => Promise<boolean>
  disconnect(),    // () => Promise<void>
  play(),          // () => void
  pause(),         // () => void
  seek(time),      // (number) => void
  setVolume(level),// (number) => void
  loadMedia(info)  // (MediaInfo) => Promise<boolean>
}

player.isCasting      // boolean getter
player.castDeviceName // string | null getter
```

Configuración del integrador (via `player` config object):
- `view.chromecast`: habilita/deshabilita el módulo (default: true si soporte detectado)
- `view.chromecastReceiverAppId`: ID del Custom Receiver (default: `CC1AD845`)

### Eventos públicos del player

| Evento | Descripción |
|--------|-------------|
| `castStateChange` | Estado cambia: `NO_DEVICES_AVAILABLE`, `NOT_CONNECTED`, `CONNECTING`, `CONNECTED` |
| `castConnected` | Conexión establecida con dispositivo |
| `castDisconnected` | Sesión terminada |
| `castError` | Error del SDK o de la sesión |
| `castMediaLoaded` | Media cargada en el dispositivo Cast |
| `castMediaEnded` | Media finalizada en el dispositivo Cast |
| `castTracksLoaded` | Text tracks disponibles en el dispositivo |
| `castActiveTracksChanged` | Tracks activos modificados |

## Interacciones con otros módulos

| Módulo | Naturaleza | Impacto QA |
|--------|------------|------------|
| **subtitles** | Sincronización bidireccional — cuando se está casting, las acciones de subtítulos van al Cast SDK, no al local player. `subtitle.js` atoms verifican `castConnectedAtom` antes de actuar. | Alto — cambio de ruta de código durante casting |
| **events** | `internalEmitter` para todos los eventos `_cast*` | Medio — eventos internos no testeables sin SDK real |
| **state/context** | `contextValueFamily('view.chromecast')` controla si el módulo está habilitado | Bajo |
| **metadata** | `buildMediaInfoFromApi` lee `api.metadata` para título/poster | Bajo |
| **playback-core** | Al conectar: `api.pause()`. Al desconectar: `api.currentTime = remoteTime` + play si aplica | Alto — puede afectar flujo de reproducción |
| **controls-api** | `expose()` registra `player.cast`, `player.isCasting`, `player.castDeviceName` | Alto — contrato de API pública |
