---
name: Sistema Bajo Test — Lightning Player
description: Arquitectura del Lightning Player, tipos de player, ad systems, eventos, API pública relevante para QA
type: reference
---

# Mediastream Lightning Player — Referencia QA

**Versión al momento de este documento:** 1.0.56
**Repo:** `D:\Dev\Repos\mediastream\lightning-player`
**Branch activo:** develop

## Tipos de Player

| Tipo Config | Descripción | Handler de playback |
|---|---|---|
| `type: 'media'` o `'vod'` | Video bajo demanda | HLS.js / dash.js / native |
| `type: 'live'` | Stream en vivo | HLS.js / dash.js |
| `type: 'dvr'` | Live con rewind | HLS.js / dash.js |
| `type: 'audio'` | Audio only | HLS.js / native |
| `type: 'radio'` | Radio con metadata nowplaying | HLS.js / native |
| `type: 'reels'` | Video vertical (TikTok-like) | HLS.js / native |
| `type: 'podcast'` | Podcast con capítulos | HLS.js / native |

## Views

`view: 'lightning'|'video'` | `'audio'` | `'radio'` | `'radioSA'` | `'podcast'` | `'podcast2'` | `'reels'` | `'compact'` | `'none'`

## Ad Systems Integrados

1. **Google IMA** — VAST/VMAP via SDK de Google (más común)
2. **Google DAI** — Dynamic Ad Insertion en stream manifest (HLS/DASH)
3. **Google SGAI** — Server-Guided Ad Insertion via HLS cues
4. **AWS MediaTailor DAI** — Alternativa a Google DAI
5. **AdSwizz** — Para radio/podcast
6. **ITG (In The Game)** — Ads interactivos

## API Pública Relevante

El player expone via la instancia global:
- `play()` / `pause()`
- `currentTime` (get/set) — seek
- `duration` (get)
- `volume` (get/set)
- `paused` (get)
- `status` → `'playing' | 'pause' | 'buffering'`
- `isPlayingAd()` → boolean
- `destroy()`

## Sistema de Eventos

Eventos via `window.postMessage` con prefijo `msp:`:
- Eventos de playback: `play`, `pause`, `playing`, `seeking`, `seeked`, `timeupdate`, `ended`
- Eventos de loading: `loadstart`, `loadedmetadata`, `canplay`, `buffering`, `waiting`
- Eventos de ads: `adsStarted`, `adsComplete`, `adsAllAdsCompleted`, `adsError`, `adsContentPauseRequested`, `adsContentResumeRequested`
- Eventos de calidad: `levelchanged`
- Eventos de tracks: `texttrackchange`, `audiotrackchange`
- Evento `ready` — player listo para recibir commands
- Evento `error` — error fatal o no-fatal

## Configuración Mínima

```js
{
  type: 'media',          // requerido
  src: 'https://...',     // URL del stream O
  id: 'content-id',      // ID de contenido en la plataforma Mediastream
  autoplay: false,
  controls: true,
  volume: 1,
}
```

## Cómo se Inicializa

1. Tag `<script>` con data-attributes en la página
2. O via `window.loadMSPlayer(containerId, config)`
3. El player crea un contenedor, carga React, monta el componente
4. Emite evento `ready` cuando está listo

## Notas para Testing

- El player hace requests a `embed.mdstrm.com` o similar para cargar config remota
- En tests hay que interceptar estas requests o usar config local inline
- El elemento `<video>` o `<audio>` lo crea el player internamente
- Los controles están en React — usar selectores semánticos (aria-label) no clases CSS
