---
type: observability
feature: youbora
version: "1.0"
status: verified
last_verified: 2026-04-29
---

# Observability — Youbora (NPAW Analytics)

## Eventos del player que disparan acciones Youbora

La siguiente tabla mapea eventos del `internalEmitter` del player (que corresponden 1:1 con los eventos públicos del player en `player.on()`) a las llamadas al SDK de NPAW.

| Evento del player (string) | Constante en código | Acción NPAW (content adapter) | Condición de guarda |
|---|---|---|---|
| `contentFirstPlay` | `Events._contentFirstPlay` | `adapter.fireStart()` + `adapter.fireJoin()` | Solo si `!_started` (una vez por sesión) |
| `playing` | `Events._playing` | `adapter.fireResume()` | Solo si `_started && !_inAdBreak && _paused` |
| `pause` | `Events._pause` | `adapter.firePause()` | Solo si `_started && !_inAdBreak && !_paused` |
| `ended` | `Events._ended` | `adapter.fireStop()` | Solo si `_started` |
| `seeking` | `Events._seeking` | `adapter.fireSeekBegin()` | Solo si `_started && !_inAdBreak` |
| `seeked` | `Events._seeked` | `adapter.fireSeekEnd()` | Solo si `_started && !_inAdBreak` |
| `buffering` | `Events._buffering` | `adapter.fireBufferBegin()` | Solo si `_started && !_inAdBreak` |
| `canplay` | `Events._canplay` | `adapter.fireBufferEnd()` | Solo si `_started && !_inAdBreak` |
| `adsContentPauseRequested` | `Events._adsContentPauseRequested` | `adapter.firePause()` + set `_inAdBreak=true` | Solo si `_started` |
| `adsContentResumeRequested` | `Events._adsContentResumeRequested` | `adapter.fireResume()` + set `_inAdBreak=false` | Solo si `_started && _inAdBreak` |
| `error` | `Events._error` | `adapter.fireFatalError()` o `adapter.fireError()` | Siempre si adapter existe |

[CODE: src/analytics/youbora/tracker.js:81-175]  
[CODE: src/constants.cjs:59,97-109]

| Evento del player (string) | Constante en código | Acción NPAW (ads adapter) | Condición de guarda |
|---|---|---|---|
| `adsStarted` | `Events._adsStarted` | `adsAdapter.fireBreakStart()` (si primer ad del break) + `adsAdapter.fireStart()` + `adsAdapter.fireJoin()` | Solo si `adsAdapter` existe |
| `adsFirstQuartile` | `Events._adsFirstQuartile` | `adsAdapter.fireQuartile(1)` | Solo si `adsAdapter` existe |
| `adsMidpoint` | `Events._adsMidpoint` | `adsAdapter.fireQuartile(2)` | Solo si `adsAdapter` existe |
| `adsThirdQuartile` | `Events._adsThirdQuartile` | `adsAdapter.fireQuartile(3)` | Solo si `adsAdapter` existe |
| `adsComplete` | `Events._adsComplete` | `adsAdapter.fireStop()` | Solo si `adsAdapter` existe |
| `adsAllAdsCompleted` | `Events._adsAllAdsCompleted` | `adsAdapter.fireBreakStop()` | Solo si `adsAdapter` existe |
| `adsPaused` | `Events._adsPaused` | `adsAdapter.firePause()` | Solo si `adsAdapter` existe |
| `adsResumed` | `Events._adsResumed` | `adsAdapter.fireResume()` | Solo si `adsAdapter` existe |
| `adsSkipped` | `Events._adsSkipped` | `adsAdapter.fireSkip()` | Solo si `adsAdapter` existe |
| `adsClick` | `Events._adsClick` | `adsAdapter.fireClick(url?)` | Solo si `adsAdapter` existe |
| `adsError` | `Events._adsError` | `adsAdapter.fireError(code, msg)` | Solo si `adsAdapter` existe |

[CODE: src/analytics/youbora/tracker.js:177-241]  
[CODE: src/constants.cjs:115-140]

---

## Señales de red observables (beacons NPAW)

El SDK `npaw-plugin` hace sus propios requests HTTP hacia los servidores de NPAW. El código del player no controla ni expone estas URLs directamente — son internas al SDK.

### Dominios confirmados empíricamente (npaw-plugin@7.3.28, cuenta `caracoltvdev`, 2026-04-29)

El SDK usa **dos dominios distintos** con propósitos diferentes:

| Sistema | Dominio | Propósito | Patrón de interceptación |
|---|---|---|---|
| **LMA** (Load Management API) | `lma.npaw.com` | Init del plugin: configuración y datos de servidor asignado | `**/*.npaw.com/**` |
| **NQS** (Non-realtime Quality Service) | `*.youboranqs01.com` | Beacons reales de sesión: start, pause, ping, ads, error, etc. | regex `/youboranqs01\.com\//` |
| Legacy fallback | `*.youbora.com` | No observado en v7.3.28 — preservar por compatibilidad | regex `/\.youbora\.com\//` |

**Ejemplo de servidor NQS asignado:** `infinity-c37.youboranqs01.com`, `infinity-c39.youboranqs01.com` — el número de servidor varía por sesión y cuenta. No está fijo.

### Endpoints NQS confirmados por tipo de acción

| Endpoint NQS | Acción NPAW que lo dispara | Observado |
|---|---|---|
| `POST /init` | Inicio de plugin (antes de cualquier `fireXxx`) | ✓ |
| `POST /joinTime` | `fireJoin()` — primer frame de contenido | ✓ |
| `POST /start` | `fireStart()` — inicio de vista de contenido | ✓ |
| `POST /pause` | `firePause()` — contenido pausado | ✓ |
| `POST /resume` | `fireResume()` — contenido reanudado | ✓ (llega ~3s después del evento `playing` — SDK tiene delay interno) |
| `POST /ping` | Heartbeat periódico (~5s) — continúa durante pause, para solo en `_inAdBreak` | ✓ |
| `POST /seek` | `fireSeekBegin()` + `fireSeekEnd()` combinados — NQS usa UN solo endpoint | ✓ |
| `POST /stop` | `fireStop()` — ended o destroy | ✓ |
| `POST /error` | `fireError()` / `fireFatalError()` | ✓ (2 errores al arranque sin ads — investigar) |
| `POST /adBreakStart` | `adsAdapter.fireBreakStart()` | ✓ (solo con ads) |
| `POST /adInit` | `adsAdapter.fireStart()` (init de ad) | ✓ (solo con ads) |
| `POST /adManifest` | Carga de manifiesto del ad | ✓ (solo con ads) |
| `POST /adStart` | `adsAdapter.fireStart()` | ✓ (solo con ads) |
| `POST /adJoin` | `adsAdapter.fireJoin()` | ✓ (solo con ads) |

### Endpoints LMA confirmados

| Endpoint LMA | Cuándo ocurre |
|---|---|
| `GET lma.npaw.com/configuration` | Al instanciar `new NpawPlugin()` — antes de `contentFirstPlay` |
| `GET lma.npaw.com/data` | Al instanciar `new NpawPlugin()` — antes de `contentFirstPlay` |

Los requests LMA se emiten **en el momento de instanciar el plugin**, no cuando se llama `fireStart`. Esto ocurre antes de `contentFirstPlay` — ver EC-07.

### Patrón de interceptación recomendado para tests

```typescript
// CORRECTO — regex es unambiguo y funciona para todos los subdominios NQS
await page.route(/\.npaw\.com\//, captureBeacon)       // LMA
await page.route(/youboranqs01\.com\//, captureBeacon)  // NQS (beacons reales)
await page.route(/\.youbora\.com\//, captureBeacon)     // legacy fallback

// INCORRECTO — glob **youboranqs01.com/** NO matchea infinity-c39.youboranqs01.com
// en Playwright porque ** adyacente a un literal sin separador / falla
await page.route('**youboranqs01.com/**', ...)  // ← ROTO
```

El código del player no expone ninguna interfaz para inspeccionar el estado interno del plugin NPAW.

---

## API pública observable

No hay ningún método o propiedad en la API pública del player que exponga el estado de Youbora.

```js
player.youbora        // undefined — no existe
player.npaw           // undefined — no existe
player.analytics      // undefined — no existe
```

La única forma de observar Youbora desde QA es interceptando requests de red.

---

## Variables globales y console logs

El SDK NPAW puede exponer una variable global `youbora` o `npaw` en `window` según la versión — esto es comportamiento del SDK, no del código del player. No está garantizado ni documentado en el código fuente del player.

[CODE: src/analytics/youbora/tracker.js:76-78]: En modo no-producción (`!IS_PRODUCTION`), si `init()` falla, emite `console.warn('[Youbora] Failed to init:', err?.message)`. En producción, los errores de init son silenciados.

---

## Señales de transición real (para tests)

Para verificar que Youbora se inicializó correctamente, los proxies de red son la única señal confiable. Las señales del player que disparan acciones Youbora son:

1. `contentFirstPlay` → dispara `fireStart` + `fireJoin` → beacons `/joinTime` y `/start` (con ~10s de delay entre sí)
2. `pause` (después de `contentFirstPlay`) → dispara `firePause` → beacon `/pause` (llega casi inmediato)
3. `playing` (después de pause) → dispara `fireResume` → beacon `/resume` (llega con ~3s de delay — usar poll con timeout ≥5s)
4. `seeking` + `seeked` → dispara `fireSeekBegin` + `fireSeekEnd` → beacon NQS único `/seek` (llega tras `seeked`)
5. `ended` → dispara `fireStop` → beacon `/stop`

**Timing crítico para tests:** el beacon `/resume` y `/seek` tienen delay observable respecto al evento del player. `expect.poll` con timeout mínimo de 5s es necesario para capturarlos.

---

## Señales NO confiables

| Señal | Por qué no usarla |
|---|---|
| `player.on('playing', ...)` para verificar que Youbora disparó | `playing` y `contentFirstPlay` son condiciones necesarias pero no suficientes — si `accountCode` es null, el tracker existe pero no hace nada |
| Cualquier propiedad en `player.*` | No hay API pública para el estado de Youbora |
| `window.youbora` o `window.npaw` | No garantizado por el código del player; depende de la versión del SDK |
| Ausencia de `console.warn` | En producción los errores de init son silenciados; la ausencia del warning no confirma que el init fue exitoso |

---

## Secuencias de eventos esperadas

### Sesión VOD normal (sin ads) — secuencia NQS confirmada empíricamente

```
Plugin instanciado (new NpawPlugin)
  → LMA: GET lma.npaw.com/configuration × 2
  → LMA: GET lma.npaw.com/data × 2
  → NQS: POST /init
  → NQS: POST /ping    ← ping inmediato post-init (characteristic del SDK)

player events: canplay → play → buffering → error × 2 → canplay → playing → contentFirstPlay
  → NQS: POST /error × 2    ← errores de arranque (ocurre consistentemente, investigar)
  → NQS: POST /joinTime     ← primer frame (fireJoin)
  → NQS: POST /ping × N     ← heartbeats ~5s
  → NQS: POST /start        ← fireStart, llega ~10s después de init (a la par de contentFirstPlay)

player event: pause
  → NQS: POST /pause        ← casi inmediato

(durante pause: pings continúan — guard no chequea _paused)

player event: playing (tras pause)
  → NQS: POST /resume       ← llega con ~3s de delay vs evento playing

player events: seeking → seeked
  → NQS: POST /seek         ← UN solo endpoint (SDK combina begin+end), llega tras seeked

player event: ended
  → NQS: POST /pause        ← auto-pause antes de ended
  → NQS: POST /stop         ← fireStop
```

**NOTA sobre seek:** el código del player llama `fireSeekBegin()` en `seeking` y `fireSeekEnd()` en `seeked`, pero el SDK NPAW los consolida en un único beacon `/seek` a nivel NQS. Los tests deben buscar `/seek`, no endpoints separados.

### Sesión con ad break (pre-roll) — secuencia NQS confirmada empíricamente

Orden de beacons NQS observado en sesión real con pre-roll (2026-04-29):

```
Plugin instanciado (new NpawPlugin)
  → LMA: GET lma.npaw.com/configuration
  → LMA: GET lma.npaw.com/data

player event: contentFirstPlay (antes del ad — tracker detecta primer play)
  → NQS: POST /init           ← sesión NQS iniciada
  → NQS: POST /joinTime       ← primer frame de contenido detectado

player event: adsContentPauseRequested
  → NQS: POST /pause          ← contenido pausado por ad break  [_inAdBreak = true]
  → NQS: POST /adBreakStart   ← break de ads iniciado

player event: adsStarted
  → NQS: POST /adInit
  → NQS: POST /adManifest
  → NQS: POST /adStart
  → NQS: POST /adJoin

(durante el ad)
  → NQS: POST /ping           ← heartbeats periódicos (~5s)

player event: adsAllAdsCompleted / adsContentResumeRequested
  [_inAdBreak = false]

player event: contentFirstPlay (post-ad — el player re-emite tras el ad)
  → NQS: POST /start          ← inicio de vista de contenido (fireStart)

(durante reproducción de contenido)
  → NQS: POST /ping           ← heartbeats cada ~5s
```

**NOTA sobre el orden:** `/joinTime` dispara antes de `/start` en sesiones con pre-roll porque `contentFirstPlay` se emite al primer play intent (antes del ad), pero `fireStart` se emite al segundo `contentFirstPlay` (post-ad). Esta secuencia puede parecer invertida respecto a la documentación del NPAW SDK, pero es el comportamiento observado.

[CODE: src/analytics/youbora/tracker.js:81-241]

### Reinicio por player.load() (cambio de contenido)

```
player.load() called
  → tracker._cleanup() called
    → NPAW: adapter.fireStop()  [cierra sesión anterior]
    → todos los handlers desvinculados
    → plugin destruido
  → setTimeout(0ms) → tracker.init(newOptions) called
    → nueva sesión NPAW iniciada
    → nuevos handlers vinculados
```

[CODE: src/analytics/youbora/tracker.js:243-249]
