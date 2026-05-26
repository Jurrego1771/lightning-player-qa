# Lightning Player — Arquitectura

Documento de referencia para agentes QA. Describe el funcionamiento interno del player tal como es observable desde la suite de tests externos. **No modifiques este archivo manualmente** — actualizarlo con `/sync-knowledge`.

---

## Flujo de inicialización

```
loadMSPlayer('container-id', config)
  → embed script fetch (api-bootstrap / api.js)
  → React 18 mount en el contenedor
  → platform-config: loadConfig.js resuelve shape final de config
  → handler selection: HLS | DASH (native) | Native HTML5
  → Jotai atoms inicializan estado async
  → plugins registry: src/plugins/index.js registra plugins activos
  → emite evento 'ready' (postMessage externo + internalEmitter)
```

El punto de entrada es `loadMSPlayer`. Si falla el bootstrap (api.js / player.jsx), **ningún player carga** — es el módulo de mayor impacto en cascada.

---

## Stack tecnológico

| Tecnología | Versión | Rol |
|---|---|---|
| React | 18.3.1 | UI + lifecycle |
| Jotai | 2.8.0 | Estado global async |
| hls.js | 1.6.13 | HLS playback (web) |
| Axios | 1.7.9 | HTTP (licencias DRM, config) |
| Webpack | 5 | Bundler |

---

## Sistema de estado (Jotai)

El estado del player es **completamente asíncrono**: los atoms de Jotai se resuelven en microtasks. Esto tiene implicaciones directas en los tests:

- `status`, `currentTime`, `volume`, `muted`, `level`, `levels` son atoms — sus valores no son inmediatamente consistentes tras una acción.
- **Antipatrón:** `expect(await player.status).toBe('playing')` después de `player.play()` sin espera.
- **Patrón correcto:** `await expect.poll(() => player.status).toBe('playing')` con timeout razonable (≥2000 ms).

El árbol de atoms vive en `src/context/index.jsx`. Mutations se propagan vía Jotai store, no Redux.

---

## Handlers de reproducción (HLS / DASH / Native)

### Selección de handler

```
config.src (MIME / extensión / URL pattern)
  → .m3u8 / application/vnd.apple.mpegurl  → HLS handler (hls.js)
  → .mpd / application/dash+xml            → DASH handler (native MSE)
  → cualquier otro                          → Native HTML5
```

### HLS handler (src/player/handler/hls/)

- Usa hls.js 1.6.13. Soporta ABR automático y manual (`player.level`, `player.levels`).
- Variantes: `full` (todas las features), `light` (menor bundle), `beta` (features experimentales).
- ABR controlable: `player.level = -1` (auto), `player.level = N` (fija nivel N).
- DVR: seek dentro del rango `[seekableStart, liveEdge - seekableEnd]`.
- Buffer management: hls.js gestiona internamente el buffer; no hay API pública para forzar flush.

### DASH handler (native MSE)

- **NO usa dash.js** — reproducción vía MSE nativo del browser.
- ABR **no es controlable** desde la API pública; el browser decide.
- `player.level` y `player.levels` pueden estar vacíos o no responder en DASH.
- Protección DRM: `protectionData` en la config, gestionado por EME nativo.

### Native HTML5

- Fallback para MP4, WebM, y streams sin manifiesto.
- Sin ABR, sin DRM complejo.

---

## Sistema de eventos (2 canales)

El player expone **dos canales** de comunicación:

### 1. postMessage (canal externo)
- Usado por integradores externos (iframes, embeds).
- `window.addEventListener('message', handler)` en el host.
- Payload: `{ type: 'msplayer:eventName', data: {...} }`.

### 2. player.on() / player.off() (API pública directa)
- Canal principal para tests E2E.
- `player.on('ready', cb)`, `player.on('playing', cb)`, etc.
- Internamente usa `internalEmitter` (src/events/index.js).

### Eventos clave

| Evento | Descripción |
|---|---|
| `ready` | Player inicializado, API disponible |
| `playing` | Reproducción activa |
| `pause` | Pausado |
| `buffering` | Buffering en curso |
| `error` | Error de reproducción |
| `timeupdate` | `currentTime` actualizado |
| `seeking` / `seeked` | Seek iniciado / completado |
| `ended` | Stream terminó |
| `levelChanged` | Cambio de calidad ABR |
| `adsStarted` / `adsComplete` | Ads IMA lifecycle |

**Regla:** en tests, siempre usar `player.on()` para observar eventos. Nunca hacer polling de DOM para inferir estado del player.

---

## Módulo de Ads (IMA lifecycle)

### Google IMA (ads-ima / src/ads/googleIma/)

Lifecycle completo en orden garantizado:

```
adsRequested
  → adsLoaded
  → adsContentPauseRequested   ← contenido pausa aquí
  → adsStarted
  → adsImpression
  → adsFirstQuartile
  → adsMidpoint
  → adsThirdQuartile
  → adsComplete
  → adsAllAdsCompleted
  → adsContentResumeRequested  ← contenido reanuda aquí
```

### cuePoints

- Con `autoplay: true` en la config, los `cuePoints` se procesan desde el inicio.
- Con `autoplay: false`, los cuePoints solo se activan cuando el usuario inicia reproducción.
- Los beacons OMID se emiten en `adsImpression` y `adsComplete`.

### VAST / VMAP

- VAST: un ad a la vez (pre-roll, mid-roll, post-roll).
- VMAP: múltiples ad breaks definidos en el manifiesto VAST.
- El parser vive en ads-manager (`src/ads/manager/`).

---

## DRM (orden de resolución)

El player resuelve DRM en este orden de preferencia:

```
1. Widevine L1 (hardware TEE)  → Chrome / Android
2. Widevine L3 (software)      → Chrome sin TEE
3. PlayReady                   → Edge / Windows
4. FairPlay                    → Safari (vía webkitneedkey event)
```

### FairPlay (Safari)

- Usa el evento no-estándar `webkitneedkey` en lugar del estándar `encrypted`.
- Requiere certificado FairPlay en la config: `config.drm.fairplay.certificateUrl`.
- No testeable con Playwright (Chromium) — requiere Safari real.

### getDRMSupport.js

- Archivo utilitario que detecta qué DRM soporta el browser actual.
- Usado en `loadConfig.js` para seleccionar el esquema correcto.

### protectionData (DASH)

- Para streams DASH con DRM, la config debe incluir `protectionData` con el esquema EME.
- Widevine L1 vs L3 se determina por la respuesta del CDM, no por la config.

---

## SGAI (flujo + bug conocido)

### Flujo SGAI (Google Server-Guided Ad Insertion)

```
HLS manifest descargado
  → custom pLoader intercepta segmentos
  → ManifestParser detecta #EXT-X-DATERANGE tags
  → AdBreakService marca timestamps de ad breaks
  → Al llegar al timestamp: pausa contenido
  → IMA StreamManager solicita / reproduce ad
  → resume contenido al completar
```

Fuente: `src/ads/googleSGAI/`.

### Bug conocido: buffering + DVR = loop infinito

Cuando el player está en estado `buffering` **y** el stream tiene DVR activo **y** SGAI está habilitado:
- El resume después del ad break intenta hacer seek al live edge.
- Si el buffer está stale durante el seek, se vuelve a entrar en `buffering`.
- SGAI detecta buffering como señal de "no se puede continuar" y re-lanza el ad break.
- Resultado: loop infinito de buffering → ad → buffering.

**Tests relacionados:** `tests/integration/ads-sgai-mute-state-lifecycle.spec.ts`.
**Gap conocido:** `useGoogleSGAILifecycle.js` — casos edge `buffering + DVR` sin cobertura completa.

---

## Platform Module (shape de la config)

`src/platform/loadConfig.js` resuelve la configuración final. Shape mínimo esperado:

```typescript
{
  src: string,                    // URL del stream
  type?: string,                  // MIME type (inferido si no se pasa)
  autoplay?: boolean,             // default: false
  muted?: boolean,                // default: false
  volume?: number,                // 0-1, default: 1
  drm?: {
    widevine?: { licenseUrl: string },
    playready?: { licenseUrl: string },
    fairplay?: { certificateUrl: string, licenseUrl: string }
  },
  ads?: {
    ima?: { tag: string, cuePoints?: number[] },
    sgai?: { enabled: boolean },
    dai?: { assetKey: string },
    adswizz?: { zoneId: string }
  },
  analytics?: { ... },
  platform?: 'web' | 'tv' | 'mobile'
}
```

---

## Implicaciones para tests (antipatrones comunes)

| Antipatrón | Correcto |
|---|---|
| `expect(player.status).toBe('playing')` | `await expect.poll(() => player.status).toBe('playing')` |
| `player.play(); expect(currentTime).toBeGreaterThan(0)` | Esperar evento `timeupdate` o usar `expect.poll` |
| Asertar sobre clases CSS internas | Solo API pública: `player.status`, `player.currentTime` |
| `page.waitForTimeout(3000)` para esperar ads | Escuchar `adsStarted` event con `player.on()` |
| Importar desde `@playwright/test` directamente | Siempre importar desde `fixtures/` |
| Testear ABR en DASH | ABR solo funciona en HLS handler |
| DRM FairPlay en Playwright | No testeable — requiere Safari real |
| Assert directo post-seek en DVR | `seeked` event + `expect.poll` en `currentTime` |
