---
type: observability
feature: youbora
version: "1.0"
status: draft
last_verified: 2026-04-28
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

Lo que se puede observar desde QA:

| Tipo de señal | Dominio esperado | Cuándo ocurre | Fuente |
|---|---|---|---|
| Beacon de inicio de sesión | `*.npaw.com` o `*.youbora.com` | Tras `fireStart()` + `fireJoin()` | [INDUSTRY: NPAW Plugin SDK v7 docs] |
| Ping/heartbeat de sesión | `*.npaw.com` o `*.youbora.com` | Periódico durante reproducción | [INDUSTRY: NPAW Plugin SDK v7 docs] |
| Beacon de pausa | `*.npaw.com` o `*.youbora.com` | Tras `firePause()` | [INDUSTRY: NPAW Plugin SDK v7 docs] |
| Beacon de stop/fin | `*.npaw.com` o `*.youbora.com` | Tras `fireStop()` | [INDUSTRY: NPAW Plugin SDK v7 docs] |
| Beacon de error | `*.npaw.com` o `*.youbora.com` | Tras `fireError()` o `fireFatalError()` | [INDUSTRY: NPAW Plugin SDK v7 docs] |
| Beacons de ads | `*.npaw.com` o `*.youbora.com` | Durante lifecycle de ad | [INDUSTRY: NPAW Plugin SDK v7 docs] |

**IMPORTANTE para QA:** Los dominios exactos, paths de endpoints y estructura del payload de los beacons NO están en el código fuente del player. Son internos al paquete `npaw-plugin@7.3.28`. Para interceptarlos en tests, se debe usar `page.route('**/*.npaw.com/**', ...)` o `page.route('**/*.youbora.com/**', ...)` y observar qué requests se hacen empíricamente.

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

1. `contentFirstPlay` → dispara `fireStart` + `fireJoin` → debe producir beacon de inicio hacia NPAW
2. `pause` (después de `contentFirstPlay`) → dispara `firePause` → beacon de pausa
3. `playing` (después de pause) → dispara `fireResume` → beacon de resume
4. `ended` → dispara `fireStop` → beacon de stop

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

### Sesión VOD normal (sin ads)

```
player event: contentFirstPlay
  → NPAW: adapter.fireStart()
  → NPAW: adapter.fireJoin()
  → Red: beacon de inicio hacia *.npaw.com

player event: buffering
  → NPAW: adapter.fireBufferBegin()

player event: canplay
  → NPAW: adapter.fireBufferEnd()

player event: pause
  → NPAW: adapter.firePause()

player event: playing
  → NPAW: adapter.fireResume()

player event: seeking
  → NPAW: adapter.fireSeekBegin()

player event: seeked
  → NPAW: adapter.fireSeekEnd()

player event: ended
  → NPAW: adapter.fireStop()
```

### Sesión con ad break (pre-roll)

```
player event: adsStarted (primer ad del break)
  → NPAW ads: adsAdapter.fireBreakStart()
  → NPAW ads: adsAdapter.fireStart()
  → NPAW ads: adsAdapter.fireJoin()

player event: adsContentPauseRequested
  → NPAW content: adapter.firePause()   [_inAdBreak = true]

player event: adsFirstQuartile
  → NPAW ads: adsAdapter.fireQuartile(1)

player event: adsMidpoint
  → NPAW ads: adsAdapter.fireQuartile(2)

player event: adsThirdQuartile
  → NPAW ads: adsAdapter.fireQuartile(3)

player event: adsComplete
  → NPAW ads: adsAdapter.fireStop()

player event: adsAllAdsCompleted
  → NPAW ads: adsAdapter.fireBreakStop()  [_adBreakStarted = false]

player event: adsContentResumeRequested
  → NPAW content: adapter.fireResume()   [_inAdBreak = false]

player event: contentFirstPlay
  → NPAW content: adapter.fireStart()
  → NPAW content: adapter.fireJoin()
```

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
