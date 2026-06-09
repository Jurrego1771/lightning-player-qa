# Metadata — Overview

## Qué hace

El módulo `metadata` reúne, normaliza y expone la información descriptiva del contenido que el player está reproduciendo, y la sincroniza con el sistema operativo a través de la **Media Session API**. Maneja dos clases de metadata:

- **Metadata estática (de contenido / plataforma):** título, subtítulo, descripción, póster/thumbnail, tipo (`video`/`audio`/`live`), `id`/`mediaId`, temporada, show, fechas, `src`, `startPos`, tags. Procede de la config de plataforma (`context.viewMetadata`, `context.metadata`, `context.view`) y se expone vía `player.metadata`.
- **Metadata dinámica (timed / now-playing):** en radios de audio, la canción que suena ahora (título + artista + artwork) se lee en tiempo real desde **Firebase Firestore** (`onSnapshot`) y se fusiona en `player.metadata`. En streams HLS live el browser/hls.js emite `programdatetime` (PROGRAM-DATE-TIME) e ID3/`emsg` timed metadata vía el evento `metadata`.

La metadata no es solo informativa: alimenta la **Media Session** del SO (lock screen, notificación, controles de auriculares, Android Auto, CarPlay), incluyendo `MediaMetadata` (título/artista/artwork) y `setPositionState` (duración/posición/velocidad).

## Archivos clave

| Archivo | Rol |
|---|---|
| `src/metadata/playingMetadata.js` | Hook compositor: combina `useExposeMetadata` + `useMediaSession`. Punto de entrada del módulo. |
| `src/metadata/exposeMetadata.js` | Reduce el `context` a un objeto de metadata válido, lo expone como getter `player.metadata`, emite `metadatachanged` (con dedup por `isEqual` + debounce 100 ms). |
| `src/metadata/mediaSession.js` | Integración Media Session API: `MediaMetadata`, action handlers (play/pause/seek/skipad/prev/next), `setPositionState`, multi-instancia (`_isCurrentMediaSession`). |
| `src/metadata/connect.js` | Inicializa la app Firebase `msp_meta` (apiKey/authDomain/projectId desde constants). |
| `src/metadata/firebase.js` | Provider React legacy del cursor Firestore (now-playing, last songs). |
| `src/metadata/firestore/useFirestore.js` | Hook de consulta Firestore: cursores, `onSnapshot`, paginación (`loadMore`, `prev`/`next`). |
| `src/metadata/firestore/wrapper.js` | Wrapper sobre la SDK modular de `firebase/firestore` (where/orderBy/limit/startAfter…). |
| `src/metadata/README.md` | Doc del plugin `nowplaying` (config Firebase). |

## Flujo de datos

```
PLATAFORMA (config/view)                FIRESTORE (now-playing)         HLS/DASH stream
   context.viewMetadata │                   onSnapshot                  PROGRAM-DATE-TIME
   context.metadata     │                   (canción actual)            ID3 / emsg
   context.view.images  │                        │                          │
            ▼            │                        ▼                          ▼
   reduceToValidMetadata()  ◄── fusión por prioridad ──┐            Events._programdatetime
            │            (viewMetadata > metadata >     │            Events._metadata
            │             originalType > context >      │
            │             metadata.preloadData)         │
            ▼                                           │
   isEqual(prev, current)? ── no ──► debounce 100ms ──► emit metadatachanged
            │ sí                                        │
            ▼ (suprime duplicado)                       ▼
   player.metadata (getter, omite goPrevItem/goNextItem)
            │
            ▼
   useMediaSession(metadata)
            │
            ├─ new MediaMetadata({title, artist=subtitle, artwork[6 tamaños]})
            ├─ setActionHandler(play/pause/stop/seek*/skipad/prev/next)
            └─ setPositionState({duration, position, playbackRate})  ◄── timeupdate/durationchange/canplay/pause
                       │
                       ▼
            navigator.mediaSession  (SO: lock screen, notif, auto/carplay)
```

## API pública

**Propiedad (getter):**
- `player.metadata` → objeto con (cuando aplica): `playerType`, `type`, `id`, `mediaId`, `src`, `startPos`, `poster`, `season`, `show`, `showTitle`, `firstEmision`, `title`, `subtitle`, `description`, `tags`, `date_recorded`, `date_created`. **Nunca** incluye `goPrevItem`/`goNextItem` (se omiten con `omitPrevNext`).

**Eventos emitidos (definidos en `constants.cjs > Events`):**
- `metadatachanged` — la metadata de contenido cambió (nuevo item / nueva canción). Payload = objeto metadata sin `goPrev/Next`.
- `metadata` — metadata puntual desde cualquier fuente (now-playing, ID3 tag de stream HLS live).
- `metadataloading` — metadata está cargando (fetch now-playing en progreso). Opcional.
- `metadataloaded` — metadata cargada exitosamente. Opcional.
- `programdatetime` — un segmento HLS informó su PROGRAM-DATE-TIME (live).

**Eventos HTML5 relacionados con duración/posición:**
- `loadedmetadata` — el browser cargó la metadata técnica del media (dimensiones, duración inicial).
- `durationchange` — la duración cambió (relevante en live/DVR).

**Evento interno (no público):**
- `_isCurrentMediaSession` — indica qué instancia controla la Media Session en multi-player.

## Interacciones con otros sistemas

- **platform-config:** fuente primaria de metadata estática (título, póster, tipo) vía `context.view`/`viewMetadata`.
- **events:** todo el flujo se propaga por `internalEmitter`; QA observa vía `msp:metadatachanged` etc.
- **hls:** origen de `programdatetime` e ID3/`emsg` timed metadata en live; también del `useID3Sync` que gobierna el matching de now-playing en radios.
- **playback-core / controls-api:** `mediaSession.js` llama a `getComponent('api')` para `play/pause/currentTime/duration/ad.skip` — la Media Session actúa como un cliente remoto del API público.
- **quality-selector / dash:** `duration`/`durationchange` provienen del pipeline de reproducción (HLS/DASH).
- **subtitles:** dependiente del módulo (según `context.yaml` legacy `depended_by: subtitles`).
- **ads-manager:** `mediaSession` neutraliza posición (`position:0`, `duration:0`) y expone `skipad` cuando hay un ad skippable.
