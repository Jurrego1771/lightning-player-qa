# Subtitles — Overview

## Qué hace

Gestiona pistas de texto (subtítulos / closed captions) sobre el video. Soporta tres formatos: **WebVTT**, **ASS/SSA** y **TTML** (solo Chromecast). Expone API pública vía `player.textTracks` y evento `subtitlechange`.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/player/textTracks.js` | Monta las pistas `<track>` en el DOM, expone `api.textTracks` y `api.addTextTrack` |
| `src/view/video/atoms/subtitle.js` | Estado Jotai: listas, selección activa, zoom-VTT overlay, Chromecast-aware |
| `src/view/video/helpers/subtitleHelper.js` | `disableAllSubtitles()` — helper compartido entre TV y web |
| `src/chromecast/subtitles.js` | Filtrado/normalización para Cast SDK |
| `src/view/video/components/container/subtitle/assSubtitle.jsx` | Renderer ASS via `ass-html5` |
| `src/view/video/components/controls/closedCaption/subtitlesPopover.jsx` | UI: popover de selección + toggle On/Off |

## Flujo de datos

```
config.subtitles[]
    ↓ loadConfig.js (normaliza URL a https, lowercase language)
    ↓ textTracks.js (renderiza <track> en <video>)
    ↓ browser TextTrackList
    ↓ getTrackListProxy() [ASS → Proxy con modo interceptado]
    ↓ internalEmitter → Events._texttrackchange
    ↓ trackChangeAtomEffect (Jotai)
    ↓ subtitleListAtom / activeSubtitleAtom / selectedSubtitleAtom
    ↓ UI (SubtitlesPopover, AssSubtitle, NativeVttZoomOverlay)
```

## API pública

```js
// Propiedad expuesta en el prototipo del player
player.textTracks          // TextTrackList proxy (lectura)
player.addTextTrack(kind, label, language)  // añade pista programáticamente

// Evento público
player.on('subtitlechange', (track) => {})  // TextTrack | null
```

## Formatos

| Formato | Renderer | Chromecast |
|---------|----------|-----------|
| `.vtt` | Nativo browser | Sí (WebVTT) |
| `.ass` / `.ssa` | `ass-html5` + Proxy | No (filtrado) |
| TTML | No (solo Cast) | Sí |

## Interacciones con otros sistemas

- **Zoom**: cuando `zoomScale > 1.001` + VTT → pista nativa se fuerza a `hidden`, cues se replican en overlay
- **Chromecast**: lista filtrada a solo WebVTT/TTML; IDs 1-based; URLs forzadas a HTTPS
- **Google DAI**: elimina `subtitles` del config; solo funciona VTT embebido en manifiesto HLS
- **TV skin**: `selectedSubtitle` persiste aunque `mode === 'disabled'` (diferencia vs web)
