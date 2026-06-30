# ads-ima — Overview

## Qué hace

El módulo `ads-ima` integra el **Google IMA SDK v3** (Interactive Media Ads) para reproducir anuncios VAST/VMAP en el Lightning Player. Es el sistema de ads principal del player, utilizado para pre-rolls, mid-rolls y post-rolls en contenido VOD y live. El módulo gestiona el ciclo completo: carga del SDK desde CDN, solicitud del VAST tag, pausa del contenido, reproducción del ad, y reanudación del contenido — todo con manejo de errores que garantiza que un fallo en el sistema de ads nunca interrumpa la reproducción del contenido principal.

Adicionalmente, el módulo gestiona **overlay ads (NonLinear IMA)**: anuncios superpuestos sobre el video que se reproducen concurrentemente con el contenido principal sin pausarlo. Se configuran vía `ads.overlay` en la plataforma y su VAST URL pasa por el mismo sistema de resolución de macros que los ads lineales antes de ser enviada al ad server.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/ads/googleIma/index.js` | Componente React `GoogleAds` — punto de entrada, gestiona el ciclo de vida React + contexto |
| `src/ads/googleIma/handler.js` | `AdsHandler` — orquestador principal, extiende EventEmitter, expone API pública de ads |
| `src/ads/googleIma/ima.js` | `GoogleIma` — wrapper del SDK IMA, carga lazy desde CDN, Proxy para delegar métodos |
| `src/ads/googleIma/adsLoader.js` | `AdsLoader` — crea `AdDisplayContainer` + `ima.AdsLoader`, maneja `ADS_MANAGER_LOADED` |
| `src/ads/googleIma/overlayAds.jsx` | `OverlayAds` — componente React para ads nonlinear (overlay). Monta cuando `ads.overlay` está configurado e `isPlayerReady`. Llama `resolveAdTagMacros` antes de `requestAds()` |
| `src/ads/googleIma/adTagMacros.js` | `resolveMacro` + `resolveAdTagMacros` — helper compartido que reemplaza tokens `$...$` en el VAST URL. Usado tanto por `AdsRequest` (lineales) como por `OverlayAds` (overlay) |
| `src/ads/googleIma/adsRequest.js` | `AdsRequest` — construye el `ima.AdsRequest`, delega resolución de macros a `adTagMacros.js`, detecta autoplay |
| `src/ads/googleIma/adsManager.js` | `AdsManager` — wrapper de `ima.AdsManager`, gestiona init/start/resize/destroy |
| `src/ads/googleIma/ad.js` | `Ad` — wrapper de `ima.Ad`, expone metadata (duration, skipOffset, isPreRoll, etc.) |
| `src/ads/googleIma/events.js` | `bindAdsManagerEvents` — mapea eventos IMA SDK → eventos internos del player |
| `src/ads/googleIma/options.js` | `AdsOptions` — valor object con configuración del sistema de ads |
| `constants.cjs` | Todos los eventos públicos `ads*` disponibles vía `player.on()` y `postMessage` |

## Flujo de datos

```
loadMSPlayer({ ads: { map: 'https://vast-url', skipAt: 5 } })
        │
        ▼
GoogleAds (React component) mounts
        │ new AdsOptions({ canPause, custom, volume, autoplay, ... })
        ▼
AdsHandler.initialize({ element, container, map, skipAt })
        │ await GoogleIma.ready()  ← carga SDK desde CDN (imasdk.googleapis.com/js/sdkloader/ima3.js)
        │                            Si CDN falla → emit _adsAllAdsCompleted → content play
        ▼
AdsLoader.init()
  ├─ new ima.AdDisplayContainer(container, videoElement)
  └─ new ima.AdsLoader(adDisplayContainer)
        │
        ▼
AdsRequest.#_getAdsRequest({ map, width, height, volume })
  ├─ Resolver macros en URL ($page-url$, $player-width$, etc.)
  ├─ checkCanAutoplay(isMuted) → setAdWillAutoPlay + setAdWillPlayMuted
  └─ adsLoader.requestAds(adsRequest, { resolve, reject })
        │
        │  [Network: GET VAST/VMAP tag]
        ▼
AdsLoader.#_onAdsManagerLoaded (ADS_MANAGER_LOADED)
  ├─ new ima.AdsRenderingSettings { enablePreloading: true, uiElements: [] }
  └─ event.getAdsManager(wrapper, settings) → AdsManager
        │
        ▼
AdsHandler.play() [primer user interaction o autoplay]
  ├─ AdsLoader.initialize() → adDisplayContainer.initialize()
  ├─ playerHandler.play() + playerHandler.pause()  ← hack requerido por IMA SDK
  └─ AdsManager.initialize({ width, height }) → ima.init() + ima.start()
        │
        ▼
IMA SDK emite CONTENT_PAUSE_REQUESTED
  → AdsHandler.#_onContentPauseRequested()
    ├─ #_resumeTime = element.currentTime
    ├─ #_resumeSource = element.src
    └─ playerHandler.pause() → emit adsContentPauseRequested
        │
        ▼
[AD PLAYBACK: STARTED → FIRST_QUARTILE → MIDPOINT → THIRD_QUARTILE → COMPLETE]
        │
        ▼
IMA SDK emite ALL_ADS_COMPLETED → CONTENT_RESUME_REQUESTED
  → AdsHandler.#_onContentResumeRequested()
    ├─ Restaurar src + tiempo si isCustomPlaybackUsed
    ├─ emit adsContentResumeRequested
    └─ playerHandler.play()
```

### Flujo de error (cualquier etapa)

```
VAST 4xx/5xx | SDK CDN falla | VAST vacío
        │
        ▼
AdsHandler.#_onAdError(event, fatal)
  ├─ emit adsError
  ├─ emit adsAllAdsCompleted (solo si fatal=true)
  └─ adsManager.destroy()
        │
        ▼
Content reproduce normalmente (no crash, no estado colgado)
```

## API pública

### Config (`ads` objeto en `loadMSPlayer`)

```js
loadMSPlayer('container', {
  ads: {
    map: 'https://vast-tag-url',   // REQUERIDO — VAST o VMAP URL
    skipAt: 5                       // Opcional — segundos hasta habilitar skip en pre-rolls
  }
})
```

### Propiedades del player (vía `player.ad`)

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `player.ad.skip()` | method | Skip del ad activo (solo si `skippable === true`) |
| `player.ad.info` | object\|null | Metadata del ad: `{ id, duration, skipOffset, isPreRoll, isMidroll, isPostRoll, isLinear, adPosition, totalAds, clickThroughUrl, currentTime, remainingTime, skippable }` |
| `player.ad.cuePoints` | number[] | Array de tiempos (segundos) de los ad breaks del VMAP |
| `player.isPlayingAd` | boolean | `true` durante reproducción de ad |

## Flujo overlay ads (NonLinear)

```
Platform config: ads.overlay = "https://vast-url?tag=$custom.tag_custom$"
                 ads.overlayPosition = 0  (segundos, 0 = inmediato)
        │
        ▼
OverlayAds mounts cuando:
  overlayUrl !== null  AND  isPlayerReady === true
        │
        ▼
contextMapper(context) → extrae:
  overlay, overlayPosition, element, width, height,
  custom, listenerId, withoutCookies,
  metadata.adMarkers → markers (CSV de posiciones)
        │
        ▼
resolveAdTagMacros(overlay, { custom, listenerId, withoutCookies, markers, width, height })
  → Reemplaza todos los tokens $...$ en la URL
  → Ej: $custom.tag_custom$ → "web"  (via lodash get en custom object)
        │
        ▼
req.adTagUrl = URL resuelta
AdsLoader → IMA SDK → requestAds()
        │
        ▼
IMA SDK renderiza el overlay superpuesto sobre el video
  - pointerEvents activos solo durante el ad
  - Video NO se pausa (CONTENT_PAUSE_REQUESTED nunca se emite para nonlinear)
  - Close button gestionado por IMA internamente (uiElements = [])
  - Posición CSS: bottom = controlHeight + 20px (sobre la barra de controles)
        │
        ▼
ALL_ADS_COMPLETED o AD_ERROR
  → disablePointerEvents() → overlay ya no intercepta clicks
```

### Opciones de configuración avanzada (via contexto del player)

| Opción | Tipo | Default | Descripción |
|--------|------|---------|-------------|
| `ads.map` | string | - | VAST/VMAP tag URL |
| `ads.skipAt` | number | - | Segundos para habilitar skip en pre-rolls sin skipOffset nativo |
| `adsCanPause` | boolean | `true` | Si el usuario puede pausar el ad |
| `adsInsecureVpaidMode` | boolean | `false` | VPAID en modo inseguro (deprecated — usar solo si necesario) |
| `withoutCookies` | boolean | `false` | Deshabilita cookies en el SDK IMA |
| `googleImaPpid` | string | null | Publisher Provided Identifier para targeting |
| `listenerId` | string | null | Listener ID para ads de audio |
| `ads.overlay` | string | null | VAST URL del overlay ad (NonLinear). Activa el componente `OverlayAds` |
| `ads.overlayPosition` | number | `0` | Tiempo en segundos para mostrar el overlay. 0 = inmediato al primer play |

### Macros de VAST URL

El player reemplaza automáticamente estas macros en el VAST URL:

| Macro | Valor |
|-------|-------|
| `$page-url$` | URL actual del player (encoded) |
| `$player-width$` | Ancho del player en píxeles |
| `$player-height$` | Alto del player en píxeles |
| `$timestamp$` | Unix timestamp (segundos) |
| `$listenerid$` | `listenerId` de la config |
| `$without_cookies$` | `'true'` si `withoutCookies === true` |
| `$markers$` | Ad markers (cue points) como string |
| `$random-number$` | Número aleatorio 0–10000000000 |
| `$mobile$` | `'true'` si es mobile/tablet |
| `$cust_params$` | Custom params encoded (merge de `custom` object + params existentes en la URL) |
| `$custom.X$` | Acceso directo a campo `X` del objeto `custom` via lodash get (ej: `$custom.tag_custom$` → `custom.tag_custom`) |

Las macros se resuelven vía `adTagMacros.js` (helper compartido entre `AdsRequest` y `OverlayAds`). Una macro desconocida permanece sin sustituir — no se borra de la URL. La macro `$without_cookies$` solo se reemplaza si `withoutCookies === true`; en caso contrario el token queda intacto.

### Eventos emitidos (todos via `player.on()` y `postMessage msp:`)

**Ciclo principal de un ad break:**
1. `adsRequested` — VAST request enviada
2. `adsLoaded` — VAST parseado, AdsManager creado
3. `adsContentPauseRequested` — content se pausa
4. `adsStarted` — primer frame del ad (payload: adInfo object)
5. `adsImpression` — beacon de impresión enviado
6. `adsFirstQuartile` — 25% del ad completado
7. `adsMidpoint` — 50% del ad completado
8. `adsThirdQuartile` — 75% del ad completado
9. `adsComplete` — ad llegó al final
10. `adsAllAdsCompleted` — todos los ads del break completaron
11. `adsContentResumeRequested` — content reanuda

**Eventos opcionales/condicionales:**
- `adsSkipped` — usuario skippeó el ad
- `adsPaused` / `adsResumed` — ad pausado/reanudado
- `adsError` — error en el sistema de ads (payload: AdError object)
- `adsSkippableStateChanged` — el estado de "skippable" cambió (payload: boolean)
- `adsClick` / `adsVideoClicked` — usuario hizo clic en el ad
- `adsVolumeMuted` / `adsVolumeChanged` — volumen del ad cambió
- `adsAdBreakReady` / `adsAdBuffering` / `adsAdCanPlay` — eventos de buffering
- `adsAdProgress` — progreso del ad (emite internamente `adsTimeUpdate`)
- `adsViewableImpression` — ad fue visible en el viewport
- `adsInteraction` — interacción con el ad
- `adsLinearChanged` / `adsExpandedChange` — cambios en el tipo de ad

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Impacto QA |
|---------|---------------------|------------|
| `playback-core` | `AdsHandler` pausa/reanuda via `playerHandler.play/pause()` | Un bug aquí deja el player colgado |
| `events` | `internalEmitter` propaga todos los eventos de ads | Si falla el emitter, los listeners externos no reciben ads events |
| `controls-api` | Lee `isPlayingAd` para deshabilitar seek y controles durante ad | Si `isPlayingAd` está mal, el usuario puede intentar seekear durante el ad |
| `platform-config` | Config `ads.map` viene del backend de Mediastream + override de config JS | VAST URL incorrecta = no hay ads sin error claro |
| Google IMA CDN | SDK cargado desde `imasdk.googleapis.com/js/sdkloader/ima3.js` | Si CDN falla, el player debe continuar sin ads — caso crítico |
| `ads-dai` | Comparte `window.google.ima` — la detección usa `ima.AdsRenderingSettings` | Cargar DAI puede interferir con la detección del SDK IMA |
