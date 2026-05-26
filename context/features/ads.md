# Ads

Feature: inserción de publicidad (IMA, SGAI, DAI, AdSwizz, MediaTailor).

---

## Descripción

El player soporta múltiples sistemas de inserción de anuncios. El módulo ads-manager (`src/ads/manager/`) coordina los distintos adaptadores. Solo un sistema de ads puede estar activo a la vez por instancia del player.

---

## Archivos del player (src/)

- `src/ads/manager/` — orquestador de ads: gestión de lifecycle, cuePoints, coordinator.
- `src/ads/googleIma/` — adaptador Google IMA (VAST/VMAP).
- `src/ads/googleSGAI/` — adaptador Server-Guided Ad Insertion (HLS + IMA StreamManager).
- `src/ads/googleDAI/` — adaptador Google Dynamic Ad Insertion.
- `src/ads/adswizz/` — adaptador AdSwizz (radio / audio).
- `src/player/handler/hls/` — custom `pLoader` para SGAI (intercepta segmentos HLS).
- `constants.cjs` — constantes de estados de ads.

---

## API pública expuesta

```typescript
// Config ads al inicializar
{
  ads: {
    ima?: {
      tag: string,                       // VAST tag URL
      cuePoints?: number[],              // tiempos de mid-roll en segundos
      ppid?: string,                     // Publisher Provided ID
    },
    sgai?: {
      enabled: boolean,
      streamUrl: string                  // URL stream SGAI de IMA
    },
    dai?: {
      assetKey: string,                  // para live DAI
      contentSourceId?: string,          // para VOD DAI
      videoId?: string
    },
    adswizz?: {
      zoneId: string,
      parameters?: Record<string, string>
    }
  }
}

// Eventos de ads (player.on)
player.on('adsRequested', cb)
player.on('adsLoaded', cb)
player.on('adsContentPauseRequested', cb)
player.on('adsStarted', cb)
player.on('adsImpression', cb)
player.on('adsFirstQuartile', cb)
player.on('adsMidpoint', cb)
player.on('adsThirdQuartile', cb)
player.on('adsComplete', cb)
player.on('adsAllAdsCompleted', cb)
player.on('adsContentResumeRequested', cb)
player.on('adsError', cb)
player.on('adSkipped', cb)
```

---

## Señales de observabilidad (eventos, estados)

### Lifecycle IMA (orden garantizado)

```
adsRequested              ← tag URL enviada al SDK IMA
  → adsLoaded             ← VAST parseado, ad listo
  → adsContentPauseRequested  ← contenido pausa (player.status = 'pause')
  → adsStarted            ← video de ad comienza
  → adsImpression         ← beacon OMID / pixel impression enviado
  → adsFirstQuartile      ← 25% del ad completado
  → adsMidpoint           ← 50%
  → adsThirdQuartile      ← 75%
  → adsComplete           ← 100% del ad completado
  → adsAllAdsCompleted    ← todos los ads del break completados
  → adsContentResumeRequested ← contenido reanuda
```

### Beacons OMID

- Se emiten en `adsImpression` (viewability tracking start) y `adsComplete` (viewability end).
- No hay API pública para verificar beacons directamente. Usar network interception en tests.

| Señal | Tipo | Descripción |
|---|---|---|
| `adsStarted` | evento | Ad break comenzó |
| `adsComplete` | evento | Un ad individual terminó |
| `adsAllAdsCompleted` | evento | Todos los ads del break terminaron |
| `adsError` | evento | Error en SDK IMA o VAST |
| `adSkipped` | evento | Usuario saltó el ad (skip button) |

---

## Tipos de contenido soportados

| Sistema | Protocolo | VOD | Live | DVR | Notas |
|---|---|---|---|---|---|
| Google IMA | VAST / VMAP | Si | Si | Limitado | Pre/mid/post-roll via cuePoints |
| SGAI | HLS manifest | Si | Si | Bug conocido | Server-side timing, custom pLoader |
| DAI | Google DAI API | Si | Si | Si | Stream único con ads integrados |
| AdSwizz | XML | Si | Si (radio) | No | Principalmente audio/radio |
| MediaTailor | HLS / DASH | Si | Si | Si | AWS MediaTailor |

---

## cuePoints API

- `cuePoints: [0, 60, 120]` — ad breaks a los 0s (pre-roll), 60s y 120s.
- `cuePoints: [0]` — solo pre-roll.
- `cuePoints: []` — sin cuePoints (o VMAP gestiona los breaks).

### Comportamiento con autoplay

| Config | Efecto |
|---|---|
| `autoplay: true` | cuePoints se procesan desde el inicio; pre-roll (cuePoint=0) dispara inmediatamente |
| `autoplay: false` | cuePoints solo se activan cuando el usuario inicia reproducción |

---

## Flujo SGAI (Server-Guided Ad Insertion)

```
1. HLS manifest descargado por hls.js
2. custom pLoader en src/player/handler/hls/ intercepta respuestas
3. ManifestParser detecta tags #EXT-X-DATERANGE en el manifiesto
4. AdBreakService registra timestamps de ad breaks
5. Al alcanzar el timestamp durante reproducción:
   → player pausa contenido
   → IMA StreamManager solicita el ad
   → ad se reproduce (lifecycle IMA normal)
   → resume al completar el break
```

### Bug conocido: buffering + DVR = loop infinito

**Condición:** `buffering` activo + DVR habilitado + SGAI habilitado.

**Comportamiento:**
1. Ad break completa → `adsContentResumeRequested`.
2. Player intenta seek al live edge para continuar.
3. Buffer está stale durante el seek → entra en `buffering`.
4. SGAI interpreta `buffering` como señal de "posición de ad" → re-lanza el mismo ad break.
5. Loop infinito.

**Workaround conocido:** ninguno en producción actualmente.
**Tests relacionados:** `tests/integration/ads-sgai-mute-state-lifecycle.spec.ts`.

---

## VAST / VMAP parsing

- **VAST 2.0 / 3.0 / 4.x:** soportados por el SDK IMA. El player no parsea VAST directamente.
- **VMAP:** soportado para definir múltiples ad breaks sin especificar `cuePoints` manualmente.
- **Wrapper chains:** IMA sigue las cadenas de wrappers. Límite de profundidad configurable en IMA SDK.
- El mock server VAST para tests vive en `mock-vast/` (Express).

---

## Riesgos conocidos

- **IMA SDK load:** el SDK de Google IMA se carga dinámicamente. En CI sin internet, puede fallar. Usar mock VAST server local.
- **Ad blockers:** en entornos de test con extensiones, IMA puede bloquearse. Usar Playwright en modo sin extensiones.
- **cuePoint timing en DVR:** seek hacia atrás puede re-trigger cuePoints ya reproducidos. El player tiene un guard, pero puede fallar si el timestamp del cuePoint coincide con la ventana DVR activa.
- **SGAI + buffer:** bug conocido documentado arriba.
- **adsError silencioso:** algunos errores IMA (VAST empty response) emiten `adsError` pero el player continúa reproducción normalmente. No siempre es un fallo.

---

## Casos edge

- **Pre-roll con autoplay bloqueado:** si el browser bloquea autoplay, el pre-roll no dispara. El player queda en estado idle esperando interacción.
- **Ad break mid-roll en live edge:** si el cuePoint coincide con el live edge actual, el seek post-ad puede superar el liveEdge y causar error.
- **VMAP + cuePoints simultáneos:** comportamiento no definido. Usar uno u otro.
- **Ad muy corto (<1s):** algunos eventos del lifecycle pueden emitirse de forma comprimida o incluso omitirse. `adsFirstQuartile` puede no emitirse si el ad dura menos de 4s.
- **Skip button:** el tiempo mínimo de skip está configurado en la tag VAST. `adSkipped` solo se emite si el usuario puede saltar.
- **Volume mute durante ad:** `muted: true` durante un ad IMA afecta la medición de viewability OMID. Test crítico en `tests/integration/ads-dai-vpmute-sync.spec.ts`.
