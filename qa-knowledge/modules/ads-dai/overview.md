# ads-dai — Overview

## Qué hace

El módulo `ads-dai` implementa **Server-Side Ad Insertion (SSAI)** para Lightning Player mediante dos mecanismos distintos:

1. **Google DAI (Dynamic Ad Insertion)** — usa el IMA DAI SDK de Google para solicitar un stream HLS o DASH con ads ya integrados ("baked in") por el servidor de Google Ad Manager. El player recibe una única URL de stream que contiene tanto el contenido como los breaks publicitarios; no gestiona ads por separado.

2. **MediaTailor DAI** — usa AWS Elemental MediaTailor para SSAI en streams live/DVR. Obtiene una sesión SSAI del servidor Mediastream (`/live-stream/{id}/ssai-session.json`), recibe una URL de manifest modificada y opcionalmente un `trackingUrl` para polling de beacons.

Ambos mecanismos contrastan con **CSAI (Client-Side Ad Insertion)** — implementado en `ads-ima` — donde el player descarga ads VAST por separado e interrumpe el stream de contenido para reproducirlos. En SSAI, la transición content→ad→content es seamless porque el stream ya viene "cosido" con las tandas.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/ads/googleDAI/plugin.jsx` | Plugin React principal: `GoogleDAIManager` (clase EventEmitter), componente `GoogleDAI` con lógica de carga del SDK, fallback, eventos |
| `src/ads/googleDAI/render.jsx` | Componente `GoogleDAIRender`: monta el contenedor `<div>` donde el SDK de Google DAI renderiza overlays de click |
| `src/ads/mediaTailorDAI/plugin.jsx` | Plugin React: `MediaTailorDAIGuard` + `MediaTailorDAIRunner`, obtiene sesión SSAI y arranca el manager de tracking |
| `src/ads/mediaTailorDAI/manager.js` | `MediaTailorDAIManager`: polling del `trackingUrl` de MediaTailor para detectar ads y disparar beacons |

## Flujo de datos — Google DAI

```
Config: ads.googleDAI { key, keyDash, backup, sourceId, authToken, streamFormat }
        ↓
GoogleDAI plugin [plugin.jsx]
  1. Carga IMA DAI SDK desde CDN: https://imasdk.googleapis.com/js/sdkloader/ima3_dai.js
  2. Espera evento 'ready' del SDK
  3. Crea StreamManager con el <video> element y el <div> container
  4. Construye LiveStreamRequest (isLive/isDVR) o VODStreamRequest
     - assetKey / assetKeyDash (DASH priorizado cuando streamFormat=dash)
     - contentSourceId, videoId (solo VOD)
     - apiKey, authToken
     - adTagParameters: { ppid, cust_params, vpmute }
  5. Llama manager.requestStream(request)
        ↓
  Evento LOADED → streamData { url, streamId }
        ↓
  Para live/DVR con CDN Mediastream:
    originalSrc.searchParams.set('adInsertionGoogleStreamId', streamId)
    setData({ src: originalSrc })   ← player carga el stream DAI via proxy CDN
  Para VOD o skipCdn:
    setData({ src: url })           ← player carga la URL DAI directamente
        ↓
  Eventos de progreso DAI → internalEmitter (adsStarted, adsComplete, etc.)
  Seek a ad breaks → #handleSeeked fuerza reproducción de breaks no vistos (VOD)
  Volume change → replaceAdTagParameters({ vpmute }) vía internalEmitter._volumechange
```

## Flujo de datos — MediaTailor DAI

```
Config: ads.mediaTailorDAI { enabled, interval, baseSrc, host, skipCdn }
        ↓
MediaTailorDAI plugin [plugin.jsx]
  1. Guard: solo corre para type=live o type=dvr (no VOD)
  2. Fetch: GET /live-stream/{id}/ssai-session.json?format=hls|mpd&drm=true
  3. Respuesta: { session_id, manifest_url, tracking_url }
  4. Si manifest_url → setData({ src: manifest_url })
     Si solo session_id → appends adInsertionSessionId al src original
  5. Si tracking_url → arranca MediaTailorDAIManager
        ↓
  MediaTailorDAIManager [manager.js]
    - Polling cada N segundos al trackingUrl
    - Detecta avails (breaks) → dispara beacons (impression, quartiles, complete)
    - Emite adsStarted / adsComplete via internalEmitter
```

## API pública

Google DAI expone su módulo a través de la config del player. No hay métodos directos en la API pública del player para controlar DAI; la interacción es mediante:

| Parámetro de config | Tipo | Descripción |
|---------------------|------|-------------|
| `ads.googleDAI.key` | `string` | assetKey para stream HLS live |
| `ads.googleDAI.keyDash` | `string` | assetKey para stream DASH live |
| `ads.googleDAI.backup` | `string` | URL de stream fallback si DAI falla |
| `ads.googleDAI.sourceId` | `string` | contentSourceId (VOD) |
| `ads.googleDAI.authToken` | `string` | Token de autenticación DAI |
| `ads.googleDAI.streamFormat` | `'hls'\|'dash'` | Formato del stream (default: `'hls'`) |
| `ads.googleDAI.skipCdn` | `boolean` | Si true, usa URL DAI directa (sin proxy CDN) |
| `googleImaPpid` | `string` | Publisher Provided Identifier para targeting |
| `custom` | `object` | Parámetros custom en `cust_params` |

## Eventos DAI emitidos (internalEmitter → API pública)

| Evento interno | Evento público | Cuándo |
|---|---|---|
| `_adsStarted` | `adsStarted` | Al inicio de cada ad individual (SDK STARTED) |
| `_adsComplete` | `adsComplete` | Al finalizar cada ad (SDK COMPLETE) |
| `_adsContentPauseRequested` | `adsContentPauseRequested` | Al inicio de un ad break (AD_BREAK_STARTED) |
| `_adsContentResumeRequested` | `adsContentResumeRequested` | Al fin de un ad break (AD_BREAK_ENDED) |
| `_adsFirstQuartile` | `adsFirstQuartile` | Primer cuartil del ad (25%) |
| `_adsMidpoint` | `adsMidpoint` | Punto medio del ad (50%) |
| `_adsThirdQuartile` | `adsThirdQuartile` | Tercer cuartil del ad (75%) |
| `_adsPaused` | `adsPaused` | Ad pausado |
| `_adsResumed` | `adsResumed` | Ad reanudado |
| `_adsAdProgress` | `adsAdProgress` | Actualización de progreso del ad |
| `_adsTimeUpdate` | `adsTimeUpdate` | Actualización de tiempo del ad |

## Interacciones con otros sistemas

| Sistema | Tipo de interacción |
|---------|---------------------|
| `ads-manager` | GoogleDAIManager llama `setHandler(this)` durante ad break para tomar control del player |
| `controls-api` | `controls.addOverride(this)` durante ad break deshabilita controles; `removeOverride` al terminar |
| `hls` | El stream DAI es un stream HLS/DASH estándar; `hls.js` o `dash.js` lo reproduce normalmente |
| `drm` | Integración DRM-DAI: `_daiDeferredManifestUrl` en estado DRM para coordinar Widevine/PlayReady con DAI DASH |
| `events` | `internalEmitter._volumechange` → GoogleDAIManager actualiza `vpmute` en tiempo real |
| `subtitles` | Bug conocido: la config de subtítulos puede perderse al hacer `setData({src: daiUrl, ...stripDrmForPlayerState(drm)})` porque `stripDrmForPlayerState` solo conserva DRM; ver defects.yaml |

## Diferencias clave SSAI vs CSAI

| Aspecto | SSAI (DAI) | CSAI (IMA) |
|---------|-----------|------------|
| URL del stream | Modificada — devuelve URL con ads integrados | Unchanged — stream de contenido separado de ads |
| Ad blocking | Alta resistencia — ads son segmentos del mismo stream | Vulnerable — requests de ads son bloqueables |
| Latencia de init | Mayor — requiere round-trip al servidor DAI antes de iniciar | Menor — manifest de contenido carga inmediato |
| Skip de ad | Controlado por el servidor (posición en el stream) | Controlado por el cliente (player omite la URL del ad) |
| Targeting | Parámetros en el stream request (ppid, cust_params, vpmute) | Parámetros en la VAST tag URL |
| Timestamps | Son del stream DAI, no del contenido original | Son del contenido original |
| Beacons | Gestionados por el SDK DAI o por MediaTailorDAIManager | Gestionados por el IMA SDK client-side |
