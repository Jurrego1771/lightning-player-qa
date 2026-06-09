# Ads Manager — Overview

## Qué hace

El módulo `ads-manager` (`src/ads/manager/`) es la implementación propia del player de un cliente VAST/VMAP compatible con la API pública de Google IMA SDK HTML5. Actúa como el motor de ejecución de CSAI (Client-Side Ad Insertion): recibe una URL de ad tag (VAST o VMAP), parsea la respuesta XML, construye el schedule de ad breaks (pre-roll en t=0, mid-rolls en offsets positivos, post-roll en t=-1), y orquesta la reproducción de cada ad con pause/resume del contenido.

**Importante:** Este módulo NO es un selector de ad systems externos (IMA/DAI/SGAI/AdsWizz). Es la implementación directa de CSAI (VAST/VMAP). Los sistemas de SSAI (DAI, SGAI, AdsWizz) son plugins separados en `src/ads/googleDAI/`, `src/ads/googleSGAI/`, `src/ads/adswizz/`. La configuración que determina qué sistema usar vive en `src/ads/api.js` y la integración React en `src/ads/manager/render/index.js`.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/ads/manager/render/index.js` | React component `AdsManagerWithBoundary` — monta/desmonta el sistema VAST, lee configuración del context, expone handler vía `setHandler` |
| `src/ads/manager/render/handler.js` | `AdsHandler` — orquestador principal. Crea `AdsDisplayContainer`, `AdsLoader`, `AdsRequest`. Escucha eventos del AdsManager y los traduce a eventos internos del player (`Events.*`) |
| `src/ads/manager/loader/index.js` | `AdsLoader` — hace GET al ad tag URL, parsea la respuesta VAST o VMAP, crea el `AdsManager`. Delega a `vast.js` o `vmap.js` según el root element XML |
| `src/ads/manager/manager/index.js` | `AdsManager` — gestiona el schedule de cue points, controla cuándo iniciar cada ad break, emite `ContentPauseRequested` / `ContentResumeRequested`, maneja preload 8s antes del midroll |
| `src/ads/manager/tracker/index.js` | `AdsTracker` — dispara beacons VAST (impression, quartiles, complete, skip, error) y coordina OMID tracking |
| `src/ads/manager/events.js` | Define `EVENTS`, `AdsEvent`, `AdsManagerLoadedEvent`, `AdErrorEvent`, `AdProgressData`, `AllAdsCompletedEvent` |
| `src/ads/manager/error/codes.js` | Códigos de error VAST estándar (100-900) + VMAP (1000-1008) + custom IMA-compat (1005-1205) |
| `src/ads/manager/request/index.js` | `AdsRequest` — configura el ad tag URL, slot dimensions, timeouts, OMID params, macros de targeting |
| `src/ads/api.js` | Expone API pública del ad al player: `{ skip, info, cuePoints }` — sólo disponible mientras hay un ad activo |

## Flujo de datos

```
Player config (ads.map URL)
        │
        ▼
  AdsManager React component (render/index.js)
        │  [element + container mount]
        ▼
  AdsHandler.initialize()  ──────────── emite: adsRequested
        │
        ├── new AdsDisplayContainer(container, videoElement)
        ├── new AdsLoader(adDisplayContainer)
        └── new AdsRequest() { adTagUrl, slotDimensions, ... }
                │
                ▼
          AdsLoader.requestAds()
                │  [HTTP GET al ad tag URL con macros resueltos]
                ▼
          Parse XML: ¿VMAP o VAST?
                │
          ┌─────┴─────┐
          │           │
        VmapLoader  VastLoader
          │           │
          └─────┬─────┘
                ▼
          new AdsManager(container, loader, macros, request)
                │
                ▼
          emit: AdsManagerLoaded
                │
                ▼
  AdsHandler.#onAdsManagerLoaded()
        │  [configura bindings, sets volume]
        ▼
  AdsHandler.play()
        │  [init → start]
        ▼
  AdsManager.init()    → schedule = [0, mid1, mid2, ..., -1]
  AdsManager.start()   → startSchedule(0)
        │
        ▼
  emit: ContentPauseRequested ──→ player.pause()
  [load + render ad creativo]
  emit: ContentPauseRequested (a internalEmitter)
  emit: adsStarted (con adInfo)
        │
        ▼
  [ad reproduce: quartiles, impression, complete]
        │
        ▼
  emit: ContentResumeRequested ──→ player.play()
        │
        ▼
  [midrolls: AdsManager polling currentTime cada 200ms]
        │
        ▼
  emit: AllAdsCompleted → AdsManager.destroy()
```

## API pública

Accesible a través de `player.ad` (expuesto por `src/ads/api.js`):

| Propiedad/Método | Tipo | Descripción |
|-----------------|------|-------------|
| `player.ad` | `object \| null` | `null` si no hay ad activo |
| `player.ad.skip()` | `void` | Salta el ad si es skippable (`getAdSkippableState() === true`) |
| `player.ad.info` | `AdInfo \| null` | Info del ad activo: `id`, `duration`, `currentTime`, `remainingTime`, `isLinear`, `isPreRoll`, `isMidroll`, `isPostRoll`, `skippable`, `skipOffset`, `title`, `adSystem`, `mediaUrl`, `totalAds`, `adPosition`, `clickThroughUrl`, `contentType`, `hasNativeSkip` |
| `player.ad.cuePoints` | `number[]` | Array de offsets (segundos): 0=preroll, -1=postroll, N=midroll |

### Métodos del AdsHandler (interno, via `components` registry)

| Método | Descripción |
|--------|-------------|
| `handler.play()` | Inicia/reanuda ad si hay un break pendiente. Retorna `false` si no hay ads o si falló. |
| `handler.pause()` | Pausa el ad activo. No-op si no hay ad o si `canPause=false`. |
| `handler.skip()` | Delegado a `adsManager.skip()` |
| `handler.resize()` | Actualiza dimensiones del ad slot |
| `handler.get(prop)` | `currentTime`, `paused`, `status` del ad activo. `null` si no está reproduciendo. |
| `handler.set(prop)` | Bloquea `currentTime` durante reproducción de ad. |
| `handler.reset()` | Destruye y limpia todo el estado. Llamado al cambiar source. |
| `handler.cuePoints` | Acceso a `adsManager.getCuePoints()` |
| `handler.adInfo` | Objeto con info completa del ad activo |

## Eventos emitidos (via internalEmitter → Events públicos)

| Evento interno | Evento público | Cuándo |
|---------------|----------------|--------|
| `Events._adsRequested` | `adsRequested` | Al iniciar request al ad tag URL |
| `Events._adsLoaded` | `adsLoaded` | AdsManager inicializado + init() completado |
| `Events._adsStarted` | `adsStarted` | Ad comienza reproducción (`onPlaying` en tracker) |
| `Events._adsComplete` | `adsComplete` | Ad individual completa |
| `Events._adsAllAdsCompleted` | `adsAllAdsCompleted` | Todos los ad breaks completados |
| `Events._adsContentPauseRequested` | `adsContentPauseRequested` | Antes de reproducir un ad break |
| `Events._adsContentResumeRequested` | `adsContentResumeRequested` | Después del ad break |
| `Events._adsSkipped` | `adsSkipped` | Usuario omite el ad |
| `Events._adsSkippableStateChanged` | `adsSkippableStateChanged` | Cambia si el ad es saltable |
| `Events._adsError` | `adsError` | Error en carga o reproducción del ad |
| `Events._adsImpression` | `adsImpression` | Beacon de impression disparado |
| `Events._adsFirstQuartile` | `adsFirstQuartile` | Playhead al 25% |
| `Events._adsMidpoint` | `adsMidpoint` | Playhead al 50% |
| `Events._adsThirdQuartile` | `adsThirdQuartile` | Playhead al 75% |
| `Events._adsTimeUpdate` | `adsTimeUpdate` | Progreso del ad (currentTime) |
| `Events._adsPaused` | `adsPaused` | Ad pausado |
| `Events._adsResumed` | `adsResumed` | Ad reanudado |

## Interacciones con otros sistemas

| Sistema | Tipo de interacción | Detalle |
|---------|--------------------|---------| 
| `controls-api` | Consumer del AdsHandler | Llama `handler.play()` / `handler.pause()` / `handler.get()` / `handler.set()` para interceptar controles durante ad playback |
| `events` (internalEmitter) | Bidireccional | Escucha `_volumechange`, `_ended`, `_pause`; emite todos los eventos `_ads*` |
| `playback-core` | Coordinado | Recibe `pause()` / `play()` del AdsHandler al inicio/fin de ad breaks |
| `platform-config` | Fuente de config | Props como `ads.map`, `ads.skipAt`, `insecureVpaidMode`, `withoutCookies`, `googleImaPpid`, `adsCanPause` |
| `ErrorBoundary` (React) | Failsafe en producción | `AdsManagerWithBoundary` captura cualquier error React del AdsManager; emite `_adsError`, fuerza resume del player |

## Configuración de entrada

| Prop del player | Descripción |
|----------------|-------------|
| `ads.map` | URL del ad tag (VAST o VMAP). Sin este prop, no se inicializa ningún ad system. |
| `ads.skipAt` | Override de skip offset (actualmente no implementado en AdsHandler.skippable) |
| `adsCanPause` | Si `false`, `handler.pause()` es no-op. Default: `true` |
| `adsInsecureVpaidMode` | Habilita modo inseguro para VPAID. Default: `false` |
| `withoutCookies` | Añade `without_cookies=true` al ad tag URL como macro |
| `googleImaPpid` | Publisher-Provided Identifier (PPID) para targeting |
| `custom` | Objeto clave-valor de custom params añadidos al ad tag URL (macro `$cust_params$`) |
| `listenerId` | ID del listener — añadido como macro `$listenerid$` al ad tag URL |
