# Subtítulos y Captions

Feature: visualización de subtítulos y captions en el player.

---

## Descripción

El player soporta subtítulos y captions para accesibilidad y experiencia multilingüe. La implementación se basa en el estándar `HTMLTrackElement` y el formato WebVTT. Los subtítulos pueden estar embebidos en el manifiesto HLS/DASH o ser archivos `.vtt` externos.

---

## Archivos del player (src/)

- `src/metadata/` — parseo de metadatos de stream, incluyendo tracks de texto.
- `src/view/video/` — componente de video donde se montan los `<track>` elements.
- `src/context/index.jsx` — atoms Jotai para estado de subtítulos (track activo, visibility).
- `src/controls/` — controls-api que expone la selección de track al usuario/API.

---

## API pública expuesta

```typescript
// Obtener tracks disponibles
player.subtitles: SubtitleTrack[]
// Shape de SubtitleTrack:
// { id: string, label: string, language: string, kind: 'subtitles' | 'captions', active: boolean }

// Activar un track
player.subtitles.select(trackId: string): void

// Desactivar subtítulos
player.subtitles.disable(): void

// Track activo actual
player.subtitles.active: SubtitleTrack | null

// Eventos
player.on('subtitleTrackChanged', (track: SubtitleTrack | null) => void)
player.on('subtitleCueChanged', (cue: VTTCue) => void)
```

---

## Señales de observabilidad (eventos, estados)

| Señal | Tipo | Descripción |
|---|---|---|
| `subtitleTrackChanged` | evento | Se seleccionó o desactivó un track |
| `subtitleCueChanged` | evento | Un nuevo cue (línea) de subtítulo está activo |
| `player.subtitles` | propiedad | Array de tracks disponibles |
| `player.subtitles.active` | propiedad | Track actualmente activo |

---

## Tipos de contenido soportados

| Tipo | Fuente | Formato | Notas |
|---|---|---|---|
| WebVTT inline | HLS manifest (`#EXT-X-MEDIA:TYPE=SUBTITLES`) | WebVTT | Entregado con los segmentos HLS |
| WebVTT externo | URL `.vtt` en la config | WebVTT | Cargado por el player vía fetch |
| TTML / DFXP | DASH manifest | TTML | Soporte según browser |
| CEA-608/708 | HLS TS segments | CEA | Requiere hls.js full variant |
| SRT | No soportado nativamente | — | Convertir a VTT antes |

---

## Riesgos conocidos

- **CORS en archivos .vtt externos:** el servidor que sirve los `.vtt` debe incluir cabeceras CORS correctas. Fallo silencioso si CORS no está configurado (track cargado pero vacío).
- **Sincronización en live:** los timestamps WebVTT deben estar sincronizados con el reloj del stream. Una desincronización de >500ms es perceptible.
- **CEA-608 requiere hls.js full:** la variante `light` no incluye el parser CEA. Tests con captions CEA deben forzar `full` variant.
- **Track disponible vs activo:** `player.subtitles` puede tener tracks disponibles antes de que el player esté en `playing`. Verificar estado con `expect.poll`.
- **Accesibilidad WCAG:** los captions son requeridos para cumplir WCAG 2.1 AA (criterio 1.2.2). Testear con axe-core en `tests/a11y/`.

---

## Casos edge

- **Track sin cues:** un track `.vtt` válido pero vacío no genera errores. `player.subtitles.active` tendrá el track pero no se renderizará nada.
- **Cambio de track durante reproducción:** `player.subtitles.select(id)` mid-playback puede causar un frame de subtítulo incorrecto mientras el nuevo track carga. El evento `subtitleTrackChanged` se emite antes de que el nuevo track esté listo.
- **DVR y subtítulos:** en DVR, al hacer seek, los cues deben re-sincronizarse. hls.js gestiona esto, pero puede haber un retraso de hasta 1-2s antes de que los subtítulos aparezcan en la nueva posición.
- **Subtítulos en ads:** durante un ad break IMA, los subtítulos del contenido principal deben estar ocultos. La transición `adsContentPauseRequested` debería ocultar los tracks. Si no lo hace, los subtítulos del contenido pueden sobreponerse al ad.
- **Idioma y RTL:** tracks en idiomas RTL (árabe, hebreo) requieren CSS para alineación correcta. No verificable con axe-core; requiere visual regression.
- **Múltiples tracks simultáneos:** el player soporta solo un track activo a la vez. Llamar `select()` con otro track desactiva el anterior automáticamente.

---

## Selección de track

El player selecciona automáticamente el track de subtítulos si la config incluye un idioma preferido:

```typescript
// Config
{
  subtitles: {
    defaultLanguage: 'es',    // selecciona automáticamente el track en español
    enabled: true
  }
}
```

Sin `defaultLanguage`, los subtítulos están deshabilitados por defecto. El usuario o la API deben activarlos explícitamente.
