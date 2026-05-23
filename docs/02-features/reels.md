---
feature: reels
version: "1.0"
last_verified: 2026-04-26
spec: tests/integration/reels.spec.ts
status: pending-tests
---

# Reels

Player vertical tipo TikTok. Un player padre (`view: 'reels'`) gestiona N instancias Lightning Player hijo, una por slide. Activado con `view: 'reels'` en la config.

## Arquitectura

- **Player padre** — gestiona el feed, navegación (Swiper), preload, volumen compartido.
- **Players hijos** — uno por slide, cargados dinámicamente vía script tag + `data-loaded` callback.
  - `data-player="dynamic"` — no consulta plataforma repetidamente
  - `data-disable-msp-events="true"` — no emiten eventos MSP globales
  - `loadConfig()` con `view: 'none'`, tipo `'media'`, `autoplay: false`
- **Sin plugins en el padre** — analytics, DRM, IMA, SGAI no se montan en el contenedor padre (retorna `{}`). Los hijos tampoco (none view).

## Activación y config

```js
player.init('container', { type: 'media', id: 'content-id', view: 'reels', autoplay: true })
```

La plataforma NO se consulta para el padre cuando `view === 'reels'` (se omite el request de content config del padre).

El primer ítem usa el `id` y `type` del contexto. Los demás se obtienen de `GET /api/media/{lastItemId}/related/reels?player=...&display=N`.

## Parámetros configurables

| Parámetro | Fuente | Default | Mínimo |
|---|---|---|---|
| `videosPreload` | `data-videos-preload` / `view.reelsPreload` | 2 | 1 |
| `videosInMemory` | `data-videos-in-memory` / `view.keepInMemory` | 2 | 1 |
| `adsVast` | `data-ads-vast` / `view.ads.vast` | — | Ads deshabilitados si vacío |
| `adsInterval` | `data-ads-interval` / `view.ads.interval` | 5 | 4 |

## API pública del player padre

```js
player.goNext()       // Avanza al siguiente slide (swiper.slideNext() + 10ms delay)
player.goPrevious()   // Retrocede al slide anterior (swiper.slidePrev() + 10ms delay)
player.play()         // Del ítem activo
player.pause()        // Del ítem activo
player.currentTime    // get/set — del ítem activo
player.paused         // boolean — del ítem activo
player.status         // 'playing' | 'pause' | 'error' — del ítem activo
player.metadata       // { title, description, tags, date, playerType: 'reels' } — del ítem activo
player.volume         // get/set — volumen persistido entre ítems
```

## Eventos públicos (solo 2)

| Evento | Cuándo |
|---|---|
| `ready` | Una vez, cuando el primer player hijo registra su API. No re-emitido en navegaciones. |
| `metadatachanged` | Cuando el ítem activo tiene metadata diferente (deduplicado por `id\|src` key). **Ads NO emiten** este evento al padre. |

**Eventos NO reenviados:** `play`, `pause`, `playing`, `seeking`, `seeked`, `buffering`, `error`, etc. — quedan dentro del player hijo.

## Reglas de negocio clave

**BR-09 — Autoplay primer ítem:** Solo el ítem con `index === 0` recibe `mustAutoplay = autoplay && isFirstItem`. Los demás se inicializan con `autoplay: false`.

**BR-10 — Cambio de slide:** Al cambiar `currentItemApiAtom`, el ítem anterior recibe `api.pause()` y el nuevo `api.play()`.

**BR-11 — Preload por primera interacción:** El primer click/touch/keydown del usuario dispara `initializeItemApi()` sobre ítems prev y next (necesario para desbloquear autoplay del browser).

**BR-13 — Memory management:** Ítems fuera del rango `[currentIndex - itemsToKeepInMemory, currentIndex + itemsToPreload)` tienen `loadAtom = false`, se desmontan y se llama `api.destroy()`.

**BR-14 — Volumen persistido:** `volumeAtomEffect` escucha `volumechange` del ítem activo y aplica el valor al siguiente ítem al navegar. Ítems no-primeros se crean con `volume: 1`.

**BR-16 — Botones extremos:** `goNext` deshabilitado en último ítem (`isLast = currentIndex === itemsLength - 1`); `goPrevious` deshabilitado en el primero.

**BR-26 — Ad loop:** Cuando el `AdsManager` recibe `Complete`, establece `loop = true` sobre el player del ad. El ad se repite indefinidamente hasta que el usuario navegue.

## Señales confiables vs no confiables

**Para verificar reproducción del ítem activo:**
- `player.paused === false` o `player.status === 'playing'`

**Para verificar cambio de slide:**
- `metadatachanged` Y `player.metadata.title` cambió

**No usar:**
- `metadatachanged` para confirmar cambio a ítem ya visitado (deduplicado por `id|src`)
- `player.status === 'playing'` durante setup (race condition con preload)
- `player.metadata` durante cambio de slide (puede ser null o del ítem anterior)
- `player.currentTime` en ad slot (tiempo del ad interno, no del contenido)

## Edge cases clave

| EC | Regla |
|---|---|
| Swipe rápido iOS | `setTimeout(..., 0)` en `onSlideChange` — sin este delay Swiper crashea |
| Autoplay bloqueado | `NotAllowedError` → ítem no marcado como inicializado → reintento en próxima interacción |
| Swipe antes de que hijo cargue | `currentItemApiAtom === null` → handler retorna sin crash |
| Feed vacío / error de red | `fetchItems.length === 0` → feed no crece, sin evento público |
| Ítem fuera de rango vuelve al rango | Player hijo se recrea desde cero (key incluye `Date.now()`) |
| Ad slot falla (VAST timeout/error) | `isValidAtom = false` → `removeBadAdsAtomEffect` lo elimina de la lista |
| Race condition: hijo desmontado antes de callback | `mounted = false` → `setApi` no llamado → `api.destroy()` en su lugar |
| Locale hardcodeado | Fechas en `es-CL` — puede fallar en entornos sin ese locale |

## Interceptar feed en tests

```typescript
// Mock del endpoint related/reels
await page.route('**/api/media/*/related/reels*', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ medias: [{ id: 'item-2', type: 'media' }, { id: 'item-3', type: 'media' }] })
  })
})

// Verificar que la plataforma NO se consulta para el padre en view=reels
let platformCalled = false
await page.route('**/media/*.json*', () => { platformCalled = true; })
// después del init: expect(platformCalled).toBe(false)
```

## Anti-patrones

```typescript
// ❌ Eventos de reproducción del player padre — no se reenvían en view=reels
player.on('playing', handler)  // nunca dispara

// ✅ Verificar reproducción via API pública
expect(!player.paused || player.status === 'playing').toBe(true)

// ❌ metadatachanged garantizado al navegar a cualquier ítem
// Si id|src es el mismo, el evento no se emite de nuevo

// ❌ Acceder al player hijo directamente

// ❌ waitForTimeout para goNext (tiene 10ms delay interno)
await player.goNext()
await page.waitForTimeout(500)

// ✅ Esperar la señal correcta
const meta = new Promise(res => player.once('metadatachanged', res))
await player.goNext()
await meta
```

## Prioridades de testing

**CRÍTICO:** TB-01 (ready), TB-02 (autoplay primer ítem), TB-03 (goNext + metadatachanged), TB-10 (plataforma no consultada)
**ALTO:** TB-04 (goPrevious), TB-05 (botón deshabilitado en extremo), TB-06 (volumen persistido), TB-07 (metadata.playerType)
**MEDIO:** TB-08 (ad no emite metadatachanged), TB-09 (fetch related/reels)
