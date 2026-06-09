# ads-sgai — Overview

## Qué hace

Google **Server-Guided Ad Insertion (SGAI)** es el sistema de inserción de anuncios en streams HLS en vivo que usa cue markers en el manifiesto para sincronizar la reproducción de ad pods generados por Google DAI Pod Serving API, sin interrumpir el stream de contenido principal.

A diferencia de SSAI (que reemplaza segmentos en el servidor) o CSAI (que interrumpe el stream para cargar un VAST tag), SGAI mantiene el stream de contenido intacto y reproduce el pod de anuncios en un segundo `<video>` elemento superpuesto al contenido. El resultado visible para el usuario es equivalente a un ad break normal, pero el mecanismo es "overlay" —el stream del programa nunca se interrumpe.

**Nota de señalización:** El player NO usa `#EXT-X-DATERANGE` (etiqueta HLS estándar para SGAI). En cambio, usa `#EXT-X-CUE-OUT` y `#EXT-OATCLS-SCTE35` — el formato nativo de encoders AWS Elemental. La decisión se documenta en `ManifestParser.js`: hls.js tiene soporte nativo de `EXT-X-DATERANGE` pero no de `EXT-X-CUE-OUT`/`SCTE-35`, por eso se usa un `pLoader` personalizado.

---

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/ads/googleSGAI/plugin.jsx` | Componente React raíz (`GoogleSGAI`), monta el DOM del ad overlay |
| `src/ads/googleSGAI/hooks/useGoogleSGAILifecycle.js` | Hook React que orquesta el lifecycle completo: init, ad break UI, audio, cleanup |
| `src/ads/googleSGAI/services/SGAIService.js` | Orquestador central: state machine, cue deduplication, fragment timing, pod URL build |
| `src/ads/googleSGAI/services/ManifestParser.js` | Parsea manifests HLS buscando `#EXT-X-CUE-OUT` y `#EXT-OATCLS-SCTE35` |
| `src/ads/googleSGAI/services/HlsLoader.js` | Custom `pLoader` para hls.js — intercepta manifests y llama ManifestParser |
| `src/ads/googleSGAI/services/AdBreakService.js` | Llama al endpoint de plataforma para obtener el `adBreakId` de Google |
| `src/ads/googleSGAI/services/AdPlaybackController.js` | Controla reproducción del `<video>` de anuncios (preload, play, events) |
| `src/ads/googleSGAI/services/SDKLoader.js` | Carga lazy el Google IMA DAI SDK (`ima3_dai.js`) desde CDN |
| `src/ads/googleSGAI/services/DisplayModeService.js` | Aplica clases CSS para los 4 formatos: `fullscreen`, `pip`, `sidebyside`, `lbanner` |
| `src/ads/googleSGAI/services/SgaiAudioService.js` | Gestiona mute/volumen entre el stream de contenido y el video de anuncio |
| `src/ads/googleSGAI/services/startFragmentTracking.js` | Engancha el evento `FRAG_CHANGED` de hls.js en el stream de contenido |

---

## Flujo de datos end-to-end

```
HLS Manifest (con EXT-X-CUE-OUT)
  ↓
HlsLoader (custom pLoader)
  ↓ texto raw del manifest
ManifestParser.parse()
  → detecta EXT-X-CUE-OUT + EXT-OATCLS-SCTE35
  → extrae: duration, segmentUrl, scte35, programDateTime
  ↓ cues[]
SGAIService.handleCues(cues)
  → dedup por cueId (scte35 || segmentName)
  → guarda en pendingCues Map (segmentName → {cue, id, adPodUrl: null})
  → llama AdBreakService.fetchAdBreakId()
         ↓ GET platform/api/live-stream/{id}/sgai-ad-break?currentTime=...&pd=...&scte35=...
         ← {adBreakId, googleDaiToken, format}
  → construye URL: dai.google.com/linear/pods/v1/hls/.../ad_break_id/{id}.m3u8?stream_id=...&pd=...
  → SGAIService.#probeCompatibility() → verifica MediaCapabilities + requestVideoFrameCallback + hardwareConcurrency ≥ 2
  → AdPlaybackController.preload(adPodUrl) si compatible

HLS Content Stream: FRAG_CHANGED event
  ↓ fragmentUrl
SGAIService.handleFragmentChange(fragmentUrl)
  → extrae segmentName
  → busca en pendingCues
  → sets triggerExpiresAt = now + 1200ms
  → #attemptPendingCuePlayback()
    → si adPodUrl listo: adController.play() + emit AD_BREAK_STARTED
    → si no listo y dentro de 1200ms: retry cada 100ms
    → si timeout o fragmento avanzó: skip del ad break

AD_BREAK_STARTED
  ↓
useGoogleSGAILifecycle.activateAdUi(format)
  → setData({_adsPlaying: true})
  → applyDisplayMode() → CSS class sgai-format-{format}
  → applySgaiAdAudio() → mute content, sync volumes
  → controls.addOverride() → intercepta play/pause/volume del player

AD_BREAK_ENDED (via SDK events o AdPlaybackController.ended)
  ↓
useGoogleSGAILifecycle.deactivateAdUi()
  → setData({_adsPlaying: false})
  → resetDisplayMode() → CSS exit transition (600ms)
  → controls.removeOverride()
  → restoreSgaiAdAudio() → restaura volumen del contenido
```

---

## API pública del módulo

El módulo SGAI no expone API pública directa. Se activa a través de la configuración del player:

```js
loadMSPlayer('container', {
  type: 'live',  // SGAI solo funciona con streams HLS
  id: 'content-id',
  // La plataforma devuelve en el loadConfig:
  // ads: {
  //   sgai: {
  //     networkCode: 'string',      // REQUERIDO — Google Ad Manager network code
  //     customAssetKey: 'string',   // REQUERIDO — Google DAI custom asset key
  //     adBreakIdEndpoint: 'url'    // OPCIONAL — endpoint custom para resolver adBreakId
  //   }
  // }
})
```

**Propiedades del player relevantes durante SGAI:**
- `player.isPlayingAd` → `true` durante un ad break SGAI
- `player.status` → puede ser `'playing'` aun durante el ad (el stream de contenido no para)

**Eventos del player relevantes:**
- `adsStarted` — ad break SGAI iniciado
- `adsComplete` — ad break SGAI completado
- `adsContentResumeRequested` — restauración del contenido solicitada
- `adsError` — error durante SGAI

---

## Eventos internos (SGAI_EVENTS)

Definidos en `SGAIService.js`, no expuestos vía postMessage:

| Evento interno | Cuándo |
|---|---|
| `adBreakStarted` | Ad pod listo y reproduciendo |
| `adStarted` | Creativo individual iniciado (SDK `STARTED` event) |
| `adBreakEnded` | Ad break completado (todos los creativos o error) |
| `adPeriodEnded` | Periodo de ad finalizado (SDK `AD_PERIOD_ENDED`) |
| `streamInitialized` | SDK StreamManager inicializado, `streamId` disponible |
| `error` | Error en SDK, AdBreakService, o AdPlaybackController |

---

## Formatos de display soportados

| Formato | Comportamiento |
|---------|---------------|
| `fullscreen` | Ad cubre todo el player (default si formato desconocido) |
| `pip` | Ad en picture-in-picture, contenido visible de fondo |
| `sidebyside` | Ad y contenido lado a lado |
| `lbanner` | Banner en L (lbanner) — multi-creativo, cierre especial |

El formato es determinado por la plataforma y devuelto en `fetchAdBreakId()`.

---

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Riesgo QA |
|---------|-------------------|-----------|
| `hls.js` | Custom `pLoader` inyectado en la config — intercepta manifests | Alto: si el player ya tiene `pLoader`, se sobreescribe |
| `controls` | `addOverride()` / `removeOverride()` — intercepta play/pause/volume | Medio: si el override queda colgado, el player no responde |
| `internalEmitter` | `Events._volumechange` — sincroniza mute state con `vpmute` | Medio: race condition si STREAM_INITIALIZED llega tarde |
| `platform API` | `GET /api/live-stream/{id}/sgai-ad-break` — obtiene adBreakId | Alto: si plataforma no responde, ad break se skipea |
| `Google IMA DAI SDK` | CDN load + StreamManager + PodStreamRequest | Alto: si CDN falla, SGAI no inicializa (content continúa) |
| `DisplayModeService` | CSS classes `sgai-format-*` + `sgai-exiting` | Bajo: si cleanup falla, clases quedan en el DOM |

---

## Compatibilidad y restricciones

- **Solo HLS**: SGAI requiere hls.js como handler de stream. No es compatible con streams DASH ni con HLS nativo sin hls.js.
- **Probe de compatibilidad**: Antes de precargar el ad pod, `SGAIService` verifica que el device soporte dual-video HLS (`MediaCapabilities` + `requestVideoFrameCallback` + `hardwareConcurrency ≥ 2`). En dispositivos débiles o TVs antiguas, SGAI se deshabilita automáticamente (política "content-first").
- **Multi-instancia**: El `pLoader` se inyecta globalmente en la config del player. En multi-instancia puede contaminar otras instancias. Bug conocido documentado.
- **Deduplicación de cues**: `processedCues` Set con límite de 100 entradas (FIFO) para evitar duplicados en streams de larga duración.
- **Ventana de gracia**: 1200ms desde que el fragmento trigger es detectado para que el ad pod esté listo. Si no llega a tiempo, el ad break se skipea.
