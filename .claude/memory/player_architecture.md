---
name: Arquitectura Interna del Player — Para QA
description: Detalles de implementación interna del Lightning Player relevantes para diseñar tests correctamente
type: reference
---

# Arquitectura Interna del Player — Guía para QA

**Propósito:** Entender el "por qué" detrás de comportamientos del player que afectan cómo escribimos tests.
**Fuente:** Análisis directo del código en `$PLAYER_LOCAL_REPO` (v1.0.58)

---

## Flujo de Inicialización Detallado

```
loadMSPlayer(containerId, config)
  ↓
1. Parse data-attributes del script tag (si aplica)
2. Merge config inline + defaults
3. GET embed.mdstrm.com/{type}/{id}.json?_=timestamp    ← content config
4. GET embed.mdstrm.com/{type}/{id}/player/{playerId}   ← UI config
5. ReactDOM.createRoot(container)
6. Mount <LightningPlayerInterface>
     └─ <ContextProvider atoms={jotaiStore}>
          └─ <View type={viewType}>   (video|radio|compact|reels|podcast|none)
               └─ <PlayerCore>
                    └─ Selecciona handler: HLS | Native
7. Handler.load(src) → media element attached
8. Emit 'ready' → Promise resuelve con player instance
9. Si autoplay: adsManager.init() → content puede pausar por ad
```

**Implicación:** Entre el paso 3 y 8 hay ~2-5 requests HTTP. En tests, el `waitForReady()`
debe tener timeout >= 30s si la plataforma está real. En `isolatedPlayer`, los pasos 3 y 4
son interceptados y responden instantáneamente.

---

## Sistema de Estado: Jotai Atoms

El player usa **Jotai** (librería de state management basada en atoms) con React.

```
jotaiStore:
  - currentTimeAtom
  - durationAtom
  - statusAtom ('playing' | 'pause' | 'buffering')
  - levelAtom (calidad HLS actual)
  - adPlayingAtom
  - seekingAtom
  - ... etc
```

**Por qué importa para tests:**
- Las actualizaciones de atoms son asíncronas (React re-render cycle)
- Un setter (`player.currentTime = 30`) actualiza el atom → React re-renders → el valor
  es efectivo en el siguiente ciclo de rendering, no inmediatamente
- Por eso `assertCurrentTimeNear()` debe usar `expect.poll()`, no un assert instantáneo
- Los tests que leen estado inmediatamente después de una acción son inherentemente frágiles

---

## Handlers de Reproducción

### Selección de handler (lógica de prioridad)

```
¿El browser soporta HLS nativo? → No → ¿Soporte MSE? → Sí → handler: HLS (hls.js)
¿El browser soporta HLS nativo? → Sí (Safari) → handler: Native para HLS
                                               → handler: HLS si se especifica forzar hls.js
Formato MP4/WebM/MP3/OGG → handler: Native siempre
Formato DASH → handler: Native siempre (no dash.js)
```

**Para tests de ABR:** Solo HLS con hls.js tiene ABR controlable. Verificar `player.sourceType === 'hls'`
antes de testear `level`, `levels`, `bandwidth`, `nextLevel`.

### HLS Handler (hls.js 1.6.13)

**Tres variantes cargadas lazy:**
- `hls-beta.js` — últimas features de hls.js (experimental)
- `hls.js` — versión estable (default)
- `hls-light.js` — bundle mínimo (sin funciones avanzadas)

**Cuál se carga depende de la config del player.** Para tests de ABR usar siempre la
variante estándar (default). La variante light puede no tener todas las propiedades.

**Configuración interna relevante:**
- `maxBufferLength`: cuántos segundos de buffer acumula (afecta tests de buffer health)
- `maxMaxBufferLength`: límite máximo del buffer
- `lowLatencyMode`: activado para live streams
- `enableWorker`: Web Worker para segmentos (puede afectar timing en tests)

### Native Handler

Wrapper sobre `<video>` o `<audio>` nativo del browser.
- No tiene ABR
- No tiene `level`, `levels`, `bandwidth`, `bitrate`
- `readyState` sí está disponible (es del HTMLMediaElement)
- La propiedad `sourceType` devuelve `'native'`

---

## Sistema de Eventos Detallado

### Dos canales de emisión

Cuando el player emite un evento internamente, dispara DOS cosas simultáneamente:

```javascript
// Canal 1: internalEmitter (directo, para listeners dentro del player)
internalEmitter.emit('playing', eventData)

// Canal 2: externalEmitter → postMessage (para código externo)
window.postMessage({
  event: 'msp:playing',
  id: '_uniqueId_de_esta_instancia',
  data: eventData
}, location.origin)
```

**El harness QA escucha el Canal 2 (postMessage).** Los listeners de `player.on('playing', cb)`
usan el externalEmitter (que también emite internamente pero expone solo eventos registrados).

### Filtrado de eventos en multi-instancia

Cada instancia tiene un `_uniqueId` (UUID generado al init).
El `window.addEventListener('message', ...)` debe filtrar por `e.data.id === myPlayerId`
para no recibir eventos de otras instancias en la misma página.

**Si el harness no filtra por ID, en tests de multi-instancia los eventos se mezclan.**

### Eventos internos vs externos

Los eventos con prefijo `_` (como `_ready`, `_adsLoaded`) solo se emiten en el canal interno.
No están disponibles via postMessage ni via `player.on()` externo.
No intentar testear estos — no son parte de la API pública.

---

## Módulo de Ads (Google IMA)

### Inicialización del IMA SDK

El SDK de IMA (`imasdk.googleapis.com/js/sdkloader/ima3.js`) se carga dinámicamente
la primera vez que se necesita. Si el SDK ya está en la página (ej: cacheado), se reutiliza.

**Para tests:** El QA cachea el SDK en `fixtures/ima-sdk/ima3.js` y lo sirve via `page.route()`.
Esto garantiza que el SDK no necesita red y que la versión es consistente.

### Diferencia autoplay=true vs autoplay=false para ads

```
autoplay: true
  → Al cargar, IMA inicializa AdsManager automáticamente
  → adDisplayContainer.initialize() puede llamarse sin user gesture (con --autoplay-policy flag)
  → adsManager.start() inicia el ad
  → player.ad.cuePoints disponible después de AdsManagerLoadedEvent

autoplay: false
  → AdsManager NO se inicializa hasta que el usuario hace play()
  → player.ad.cuePoints está VACÍO hasta el primer play()
  → Los tests de cuePoints deben usar autoplay:true o simular un click de play primero
```

### Lifecycle de IMA

```
adsRequested
  → adsLoaded (VAST recibido y parseado)
    → [content pausa → adsContentPauseRequested]
    → adsStarted (primer ad del pod)
      → adsImpression (cuando el ad es visible)
      → adsFirstQuartile (25%)
      → adsMidpoint (50%)
      → adsThirdQuartile (75%)
      → adsComplete (un ad terminó)
    → adsStarted (siguiente ad del pod, si hay)
    ...
    → adsAllAdsCompleted (pod completo)
    → [content resume → adsContentResumeRequested]
```

**Nota:** `adsComplete` se emite por cada ad individual. `adsAllAdsCompleted` se emite
cuando todos los ads del pod completo terminaron.

---

## Arquitectura del Módulo SGAI (v1.0.58)

SGAI (Server-Guided Ad Insertion) funciona así:

```
HLS manifest request
  → Custom pLoader middleware intercepta la respuesta
  → ManifestParser busca #EXT-X-DATERANGE con ad cue markers
  → Si encuentra cue: AdBreakService registra el break
  → AdPlaybackController espera hasta llegar al punto del cue en currentTime
  → Cuando llega: pausa el contenido, inicia IMA StreamManager
  → DisplayModeService maneja la UI durante el ad
  → Al completar: resume el contenido
```

**El bug de timing:** Si hls.js procesa el primer manifest antes de que el plugin SGAI
monte y registre su pLoader, los cue markers del primer manifest se pierden. Esto puede
causar que el primer ad break no se dispare en streams con ad breaks al inicio.

**El bug de multi-instancia:** El pLoader se registra en un objeto global (no por instancia).
Dos players en la misma página comparten el mismo pLoader, que puede confundir el contexto
del break entre instancias.

---

## Platform Module — Carga de Config

```
GET {platformBase}/{type}/{id}.json?_={timestamp}

Response shape (relevante para mocks):
{
  src: {
    hls: 'https://cdn.../stream.m3u8',    // URL del stream HLS
    mp4: 'https://cdn.../video.mp4',       // Fallback MP4
    dash: 'https://cdn.../stream.mpd',     // DASH (si disponible)
  },
  drm: {
    widevine: { licenseUrl: '...' },
    fairplay: { certificateUrl: '...', licenseUrl: '...' }
  },
  ads: {
    map: 'https://vast-server/tag',        // VAST tag URL
    sgai: { ... }                          // SGAI config (nuevo)
  },
  poster: 'https://cdn.../poster.jpg',
  metadata: { title: '...', description: '...', ... },
  analytics: { ... }
}
```

**Los mocks en `fixtures/platform-responses/content/*.json` deben mantener este shape.**
Si el player team agrega/cambia campos en la respuesta, los mocks pueden quedar desfasados.
Ver `testing_gaps.md` ítem 12 (Contract validation).

---

## Build y Carga del Player Script

El player se distribuye como un bundle único:
- dev: `https://player.cdn.mdstrm.com/lightning_player/develop/api.js`
- staging: `https://player.cdn.mdstrm.com/lightning_player/staging/api.js`
- prod: `https://player.cdn.mdstrm.com/lightning_player/api.js`

**Carga lazy (dynamic imports) de:**
- Handlers HLS (hls.js se carga cuando se detecta un stream HLS)
- Plugins (AdSwizz, ITG, Chromecast)
- Analytics (GA4, Comscore, StreamMetrics)

**Implicación para tests:** Después de `loadMSPlayer()`, la función `loadMSPlayer` está
disponible, pero los handlers aún pueden estar cargando. El `waitForReady()` garantiza
que el handler ya está activo y los streams ya pueden reproducirse.

---

## Chromecast

Usa el Google Cast SDK (sender side).
El player emite `castStateChange` cuando el estado del Cast cambia.
Para testear Chromecast se necesita un dispositivo físico o un simulador.
No testeable con Playwright puro.

## Federation (Login)

Plugin que maneja autenticación con la plataforma Mediastream.
Relevante solo para contenido con `accessToken`.
Para tests de contenido restringido, pasar `accessToken` en la config.

---

## Puntos de Extensión del Player (Plugins)

El player tiene un sistema de plugins que se montan después del core:
```
federation → analytics → ads → chromecast → (otros)
```
El orden de mounting importa porque algunos plugins dependen de eventos de otros.
Si un plugin falla al montar, los eventos `pluginsReady` no se emiten o se emiten con error.
