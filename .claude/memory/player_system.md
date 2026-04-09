---
name: Sistema Bajo Test — Lightning Player
description: Arquitectura real del player v1.0.58 verificada desde el código fuente — API, eventos, ad systems, DRM, HLS
type: reference
---

# Mediastream Lightning Player — Referencia QA (verificada desde código fuente)

**Versión actual del código:** 1.0.58
**Repo player:** `D:\repos\mediastream\lightning-player`
**Repo QA:** `D:\repos\jurrego1771\lightning-player-qa`
**Última verificación desde fuente:** 2026-04-08

> Esta referencia fue construida leyendo el código fuente del player, no solo la documentación.
> Cuando haya conflicto entre esta memoria y `docs/lightning_player.md`, confiar en esta memoria.

---

## Stack Interno del Player (relevante para QA)

- **UI:** React 18.3.1 + Jotai 2.8.0 (atoms de estado reactivo)
- **HLS:** hls.js 1.6.13 (única opción ABR real — ver nota DASH abajo)
- **HTTP:** Axios 1.7.9 para requests a la plataforma
- **Build:** Webpack 5 + Babel 7 con dynamic imports (carga lazy de handlers y plugins)
- **VAST parsing:** @dailymotion/vast-client 6.3.1 + @dailymotion/vmap 3.3.2

**Implicación de React+Jotai para tests:** Las actualizaciones de estado son async
(React render cycle). Si un test lee `player.status` inmediatamente después de una
acción, puede recibir el valor anterior. Usar `expect.poll()` siempre, no assert directo.

---

## CORRECCIÓN CRÍTICA: DASH no tiene handler dedicado

**Lo que decía antes:** "HLS (hls.js), MPEG-DASH (dash.js)"
**Realidad en el código:** No existe dash.js en el proyecto. DASH usa playback nativo del browser.

**Consecuencias para testing:**
- DASH no tiene ABR real controlable desde el player (el browser decide la calidad)
- Las propiedades `level`, `levels`, `bandwidth`, `bitrate`, `nextLevel` NO funcionan en DASH
- Tests de ABR en DASH son inválidos — no hay lógica de player que testear
- `sourceType` devuelve `'native'` para DASH, no `'dash'`
- Tests de calidad manual con DASH están fuera de scope

---

## Tipos de Contenido (type param)

`'media'` | `'live'` | `'dvr'` | `'episode'` | `'audio'` | `'radio'` | `'reels'` | `'podcast'`

**Nota:** `'episode'` es equivalente interno a `'media'` (el player lo remap internamente).

## Views

`'video'` | `'audio'` | `'radio'` | `'podcast'` | `'reels'` | `'compact'` | `'radioSA'` | `'none'`

`'none'` = headless, sin UI (útil para tests de analytics que no necesitan renderizar)

---

## Inicialización

### Config de loadMSPlayer()

```js
loadMSPlayer('container-id', {
  type: 'media',        // REQUERIDO
  id: 'content-id',    // REQUERIDO para contenido de plataforma Mediastream
  autoplay: false,
  volume: 0.8,
  ads: { map: 'https://vast-url' },  // ← IMPORTANTE: es ads.map, NO adsMap como campo raíz
  player: 'player-id',              // UI config ID
  view: 'video',
  dnt: false,                        // Do Not Track
  startPos: 30,                      // Posición inicial en segundos
  accessToken: 'token',             // Para contenido restringido
  customer: 'customer-id',
})
```

**CRÍTICO — `ads.map` vs `adsMap`:**
El player acepta `ads: { map: 'url' }` en la config de JS, que es el equivalente de
`data-ads-map` en el script tag. El harness puede remapear `adsMap → ads.map`
internamente. **Verificar que `harness/index.html` hace este remapeo correctamente.**

### Secuencia de inicialización

1. Parse de `data-*` attributes o config de JS
2. GET `embed.mdstrm.com/{type}/{id}.json?_=timestamp` → content config (src, DRM, ads, poster)
3. GET `embed.mdstrm.com/{type}/{id}/player/{playerId}` → UI config
4. Mount React tree: `LightningPlayerInterface → ContextProvider → View`
5. Emit `ready` cuando el player puede recibir comandos
6. Autoplay si configurado

**Endpoints de plataforma por ambiente:**
- dev: `develop.mdstrm.com`
- staging: `staging.mdstrm.com` (verificar)
- prod: `embed.mdstrm.com`

**El interceptor `page.route()` en tests debe usar el dominio correcto del ambiente activo.**
El `isolatedPlayer` fixture debe interceptar el dominio que corresponde a `PLAYER_ENV`.

---

## API Pública Completa

### Métodos

| Método | Retorna | Descripción |
|---|---|---|
| `play()` | Promise | Iniciar/reanudar reproducción |
| `pause()` | Promise | Pausar |
| `load({ type, id })` | Promise | Cambiar contenido sin destruir el player |
| `on(event, cb)` | - | Suscribir a evento |
| `once(event, cb)` | - | Suscribir una vez |
| `off(event, cb)` | - | Desuscribir |
| `showControls()` | - | Mostrar controles UI |
| `hideControls()` | - | Ocultar controles UI |
| `destroy()` | - | Limpiar y remover del DOM |

**Ad methods (via `player.ad`):**
- `player.ad.skip()` — skip del ad (solo si skippable)
- `player.ad.info` — metadata del ad actual
- `player.ad.cuePoints` — array de tiempos de breaks (VMAP)

### Propiedades

**Estado de playback:**
| Propiedad | Tipo | R/W | Nota |
|---|---|---|---|
| `status` | `'playing'\|'pause'\|'buffering'\|'error'` | R | Custom, no HTML5 |
| `currentTime` | Number | R/W | Seek via setter |
| `duration` | Number | R | - |
| `paused` | Boolean | R | - |
| `ended` | Boolean | R | - |
| `volume` | Number 0-1 | R/W | - |
| `playbackRate` | Number | R/W | - |
| `muted` | Boolean | R/W | - |
| `loop` | Boolean | R/W | - |
| `autoplay` | Boolean | R | Solo lectura post-init |
| `src` | String | R | URL del stream actual |
| `buffered` | TimeRanges | R | Rangos con buffer |
| `seekable` | TimeRanges | R | Rango seekable — crítico para DVR |

**Stream info:**
| Propiedad | Tipo | R/W | Nota |
|---|---|---|---|
| `isLive` | Boolean | R | Stream en vivo |
| `isDVR` | Boolean | R | DVR disponible |
| `isPlayingAd` | Boolean | R | Ad activo |
| `sourceType` | String | R | `'hls'`, `'native'`, etc. |
| `playerType` | String | R | `'video'`, `'audio'`, etc. |
| `type` | String | R | Tipo de contenido cargado |

**HLS-only (solo válido cuando sourceType === 'hls'):**
| Propiedad | Tipo | R/W | Nota |
|---|---|---|---|
| `level` | Number | R | Nivel activo actual |
| `nextLevel` | Number | R/W | Nivel solicitado (puede diferir de `level`) |
| `levels` | Array | R | Niveles disponibles |
| `bandwidth` | Number | R | Bandwidth estimado (bps) |
| `bitrate` | Number | R | Bitrate del nivel activo (bps) |
| `edge` | String | R | CDN edge server activo |
| `droppedFrames` | Number | R | Frames dropped — NO usar getVideoPlaybackQuality() |
| `fps` | Number | R | FPS del stream |

**Video info:**
| Propiedad | Tipo | R/W | Nota |
|---|---|---|---|
| `videoWidth` | Number | R | Resolución efectiva |
| `videoHeight` | Number | R | Resolución efectiva |

**Tracks:**
| Propiedad | Tipo | R | Nota |
|---|---|---|---|
| `textTracks` | TextTrackList | R | Subtítulos/captions |
| `audioTracks` | AudioTrackList | R | Audio tracks |

**Metadata:**
| Propiedad | Tipo | R | Nota |
|---|---|---|---|
| `metadata` | Object | R | Título, thumbnail, etc. de la plataforma |
| `error` | Error | R | Último error |
| `hasAdblocker` | Boolean | R | Solo si `detectAdblocker: true` en config |

---

## Sistema de Eventos

### Arquitectura interna del event system

- `EventEmitter` custom (extiende Node EventEmitter)
- Los eventos se emiten por dos canales en paralelo:
  1. `player.on(event, cb)` — listener directo en la instancia
  2. `window.postMessage({ event: 'msp:eventName', id: uniqueId }, origin)` — cross-iframe

**El harness QA usa postMessage.** El prefijo es `msp:` (ej: `msp:playing`, `msp:adsStarted`).
Cada player tiene un `_uniqueId` único para filtrar sus propios mensajes en multi-instancia.

### Eventos por categoría

**HTML5 estándar:**
`loadstart`, `progress`, `abort`, `suspend`, `emptied`, `stalled`, `loadedmetadata`,
`loadeddata`, `canplay`, `canplaythrough`, `playing`, `pause`, `play`, `seeking`,
`seeked`, `timeupdate`, `ended`, `durationchange`, `ratechange`, `volumechange`, `waiting`

**Custom del player:**
`ready`, `loaded`, `buffering`, `sourcechange`, `error`, `levelchanged`, `levelchange`,
`programdatetime`, `metadata`, `metadataloading`, `metadataloaded`, `metadatachanged`,
`contentFirstPlay`, `adblockerDetected`, `share`, `tabchange`, `tabitemchange`,
`playlistchange`, `nextEpisodeIncoming`, `nextEpisodeConfirmed`, `nextEpisodeLoadRequested`,
`quizAnswered`, `reactionEmitted`

**Tracks:**
`texttrackchange`, `texttrackaddtrack`, `texttrackremovetrak`,
`audiotrackchange`, `audiotrackaddtrack`, `audiotrackremovetrak`

**Ads (Google IMA):**
`adsRequested`, `adsLoaded`, `adsStarted`, `adsComplete`, `adsAllAdsCompleted`,
`adsContentPauseRequested`, `adsContentResumeRequested`,
`adsClick`, `adsSkipped`, `adsUserClose`,
`adsAdBreakReady`, `adsAdMetadata`, `adsSkippableStateChanged`,
`adsFirstQuartile`, `adsMidpoint`, `adsThirdQuartile`,
`adsImpression`, `adsError`, `adsAdBuffering`, `adsAdCanPlay`, `adsAdProgress`,
`adsLinearChanged`, `adsVolumeChanged`, `adsVolumeMuted`,
`adsExpandedChange`, `adsInteraction`, `adsViewableImpression`, `adsVideoClicked`

**Chromecast:**
`castStateChange`, `castConnected`, `castDisconnected`, `castError`,
`castMediaLoaded`, `castMediaEnded`

**Internos (NO disponibles via postMessage, solo player.on() interno):**
`_ready`, `_adsLoaded`, `_playerLoaded`, `pluginsReady`, `controlsReady`,
`_federationLoaded`, `_isCurrentMediaSession`

---

## Ad Systems

### Google IMA (VAST/VMAP) — el más común

**Flujo interno:**
1. `AdsLoader.requestAds(adsRequest)` → envía request al tag URL
2. VAST/VMAP parseado → `AdsManager` creado
3. `adsManager.init(width, height, viewMode)` — NO inicia playback aún
4. En primer interaction: `adDisplayContainer.initialize()`
5. `adsManager.start()` → content pausa, ad inicia
6. `CONTENT_RESUME_REQUESTED` → content resume

**Con `autoplay: false`:** AdsManager **no se inicializa hasta que el usuario hace play**.
Esto afecta `player.ad.cuePoints` — estará vacío hasta que el usuario interactúe.

**Con `autoplay: true`:** AdsManager se inicializa automáticamente al cargar.

### Google SGAI (nuevo en v1.0.58 — RIESGO ALTO)

**Qué hace:** Intercepta manifests HLS buscando cue markers (`#EXT-X-DATERANGE`).
Cuando detecta un ad break, lanza IMA StreamManager.

**Implementación:** Custom `pLoader` middleware inyectado en hls.js.
Módulos: `SGAIService`, `AdBreakService`, `AdPlaybackController`, `ManifestParser`, `DisplayModeService`

**Bugs conocidos en el código (detectados en code review de v1.0.58):**
1. **Timing del cue handler:** Si el plugin SGAI monta después de que HLS procesa
   el primer manifest, los primeros cue markers se pierden
2. **Registro global de `pLoader`:** En multi-instancia, el pLoader puede contaminar
   otras instancias en la misma página
3. **CSS dependency:** Depende de clase `.player-container` sin documentar
4. **Import síncrono de hls.js:** Puede aumentar el bundle inicial

**Sin cobertura de tests actualmente** — prioridad alta.

### Google DAI

Ads insertados en el manifest HLS/DASH por el servidor de Google.
Transparente para el player — no hay manejo explícito de ads.
Añadido en v1.0.56 con soporte para DRM.

### AdSwizz / ITG

Plugins opcionales. AdSwizz para radio/audio, ITG para ads interactivos.
Se cargan lazy según la config.

---

## DRM

| DRM | Browsers | Test environment |
|---|---|---|
| Widevine | Chrome, Firefox, Edge, Android | Playwright Chromium ✅ |
| PlayReady | Edge, Xbox | Playwright Chromium parcial |
| FairPlay | Safari, iOS | Playwright WebKit ❌ (no CDM real) |

**FairPlay:** Requiere Safari real en macOS físico. Solo testeable en BrowserStack Tier 2.

**Flujo Widevine:**
1. HLS manifest con `EXT-X-SESSION-KEY`
2. EME `requestMediaKeySystemAccess()`
3. License request al servidor
4. License instalada → playback inicia

---

## Multi-instancia — Bug conocido

El player usa `Object.defineProperty()` en `LightningPlayer.prototype` para exponer la API.
El registro de `pLoader` para SGAI usa estado global.

**Consecuencia:** Múltiples players en la misma página pueden contaminar el estado de SGAI entre sí.
**Mitigación:** Sin fix disponible aún. Documentar en tests de multi-instancia.

---

## Notas de implementación para el harness QA

- `window.__player` debe ser la instancia devuelta por `loadMSPlayer().then(p => p)`
- `window.__qa.events` debe escuchar `window.addEventListener('message', ...)` filtrando por `msp:` prefix
- El harness debe remapear `adsMap → ads: { map }` si usa la forma simplificada
- `window.__qa.initialized = true` debe setearse como última línea del `.then()` del harness
- Para tests de multi-instancia, el harness necesita soportar 2 instancias con IDs distintos
