# Error Handling — Overview

## Qué hace

El módulo de manejo de errores del Lightning Player centraliza la **creación, clasificación, propagación y recuperación** de los fallos que ocurren durante la inicialización y la reproducción. No es un módulo monolítico: la lógica está repartida entre una jerarquía de clases de error (`src/error/`), un componente React que escucha el evento interno (`src/error/index.js`), y los handlers de cada motor de reproducción (HLS, DASH, native) que detectan condiciones de fallo del SDK subyacente y las traducen a objetos `PlayerError` antes de emitirlas.

Desde la perspectiva del usuario final, el módulo es lo que hace que un 403 de contenido, un manifest inalcanzable, un segmento perdido o un DRM no soportado terminen en un estado `error` visible y notificado en lugar de un player colgado en buffering. Desde la perspectiva del integrador, expone un único evento público `error` y un getter `error` con el último error **fatal**.

Los errores de ads (`src/ads/manager/error/`) son una jerarquía **completamente separada** (`AdError`) con códigos VAST/VMAP, y por diseño **nunca** marcan el contenido como fatal: un ad que falla no rompe la reproducción del contenido.

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/error/error.js` | Jerarquía de clases: `PlayerError` (base, extiende `Error`), `MediaError`, `NetworkError`, `PlayerInitError`. Define `type`, `fatal`, `data`. |
| `src/error/index.js` | Componente `ErrorHandler` (React.memo). Escucha `Events._error`; si `err.fatal` lo escribe al contexto (`playerStatus: error`). Expone el getter público `error`. |
| `src/constants.js` → `constants.cjs` | `ErrorType` enum (`network_error`, `media_error`, `other`, `init_player`, `default`) y `Events._error = 'error'`. |
| `src/events/index.js` | `internalEmitter` / `externalEmitter`. Re-emisión cross-frame vía `postMessage('msp:error')`. En modo debug, los `error` van a `console.error` (no `console.log`). |
| `src/player/handler/hls/handler.js` | Traduce `Hls.ErrorTypes` (NETWORK/MEDIA/KEY_SYSTEM) a `PlayerError`. Llama `hls.startLoad()` y `hls.recoverMediaError()` para recovery automático. |
| `src/player/handler/dash/handler.js` | Traduce errores de dash.js (`ERROR`, `PLAYBACK_ERROR`) a `NetworkError`/`MediaError` según presencia de `request`/`url`. |
| `src/player/handler/native.js` | Mapea `HTMLMediaElement.error.code === 4` a `MediaError('MEDIA_ERR_SRC_NOT_SUPPORTED', fatal)`. |
| `src/platform/loadConfig.js` | Lanza `PlayerInitError` fatal en fallo de config (incluye `data.status`, ej. 403) y en formato no disponible. |
| `src/player/drm/plugin.jsx` | Emite `PlayerInitError('DRM not supported', { data: 'DRM_NOT_SUPPORTED' }, fatal)`. |
| `src/controls/index.js` | Reacciona a `error` fatal reseteando `_ready`/`_autoplayed`. Autoplay fallido emite `Error` genérico no-fatal y vuelve a estado pause. |
| `src/ads/manager/error/*` | Jerarquía `AdError` separada (códigos VAST/VMAP 100–2025), `VpaidError`. No afecta estado del contenido. |

## Taxonomía de errores

### Errores de contenido/player (`PlayerError`)

Todos extienden `Error`. Estructura del objeto:

```
{
  message: string,        // detalle legible (ej. "manifestLoadError", "MEDIA_ERR_SRC_NOT_SUPPORTED")
  type: string,           // uno de ErrorType (ver abajo) — derivado de la subclase
  fatal: boolean,         // true = irrecuperable, contenido se detiene
  data?: object           // opcional: { status, data, metadata } — ej. { status: 403, data: 'REQUEST_ERROR' }
}
```

`ErrorType` (constante string, NO numérica):

| `type` | Subclase | Origen típico |
|--------|----------|---------------|
| `network_error` | `NetworkError` | manifest/segmento inalcanzable, 403/404/5xx en red, dash.js con `request`/`url` |
| `media_error` | `MediaError` | codec/decode, `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4), buffer stalled, segmento corrupto |
| `init_player` | `PlayerInitError` | config 403, tipo inválido, formato no disponible, DRM no soportado |
| `default` | `PlayerError` (base) | KEY_SYSTEM error, fallo desconocido del handler |
| `other` | — | reservado en el enum, no usado activamente por los handlers |

### Errores de ads (`AdError`) — jerarquía separada

```
AdError {
  getErrorCode(): number       // código VAST/VMAP (100–2025)
  getInnerError(): Error|null
  getMessage(): string
  getType(): 'AdLoad' | 'AdPlay'   // AdLoad si code 100–399, sino AdPlay
  getVastErrorCode(): number       // code si 100–999, sino 900 (UNKNOWN_ERROR)
}
```
`VpaidError extends AdError` (siempre código 901). Códigos definidos en `src/ads/manager/error/codes.js` (VAST 100–1009, VMAP 1000–1008, custom IMA 1004–2025).

## Fatal vs Recoverable

- **Fatal (`fatal: true`)** — el contenido no puede continuar. `ErrorHandler` escribe el error al contexto, `status` pasa a `'error'`, `controls` resetea `_ready`. Casos: manifest load/parse error, KEY_SYSTEM error (excepto no-access), `MEDIA_ERR_SRC_NOT_SUPPORTED`, config 403, DRM no soportado, formato no disponible, fallo total de segmentos tras agotar retries de hls.js.
- **Recoverable / no-fatal (`fatal: false`)** — el evento `error` SE EMITE pero el player intenta recuperarse y el getter `error` NO se actualiza (ver learning ERR-LEARN-002). Casos: error de red transitorio (`hls.startLoad()`), media error recuperable (`hls.recoverMediaError()`), `LEVEL_LOAD_ERROR`, `BUFFER_STALLED_ERROR`, KEY_SYSTEM no-access (entra a buffering silencioso), autoplay bloqueado.

## Flujo de datos / recovery automático

```
                SDK subyacente (hls.js / dash.js / HTMLMediaElement)
                                  │  evento de error nativo
                                  ▼
        ┌──────────────── handler.js (hls/dash/native) ─────────────────┐
        │  data.fatal?                                                    │
        │   ├─ NETWORK_ERROR  ── manifest? ── sí → NetworkError(fatal)    │
        │   │                            └─ no → hls.startLoad()          │
        │   │                                    + NetworkError(no-fatal) │ ◄─ recovery auto
        │   ├─ MEDIA_ERROR    ── hls.recoverMediaError()                  │ ◄─ recovery auto
        │   │                    + MediaError(no-fatal)                   │
        │   ├─ KEY_SYSTEM     ── no-access? → _setBuffering() (silencioso)│
        │   │                    └─ otro    → PlayerError(fatal)          │
        │   └─ default        → PlayerError(fatal)                        │
        └────────────────────────────┬───────────────────────────────────┘
                                      │ internalEmitter.emit(Events._error, errObj)
                  ┌───────────────────┼────────────────────────────────┐
                  ▼                   ▼                                ▼
         ErrorHandler          controls/index.js               externalEmitter
       (src/error/index.js)    if(err.fatal) reset _ready    (suscriptores 'error')
       if(err.fatal):                                         + postMessage('msp:error')
         setData(status=error)                                  (cross-frame)
         actualiza getter `error`
```

loadConfig (pre-reproducción) lanza `PlayerInitError` síncronamente en el `catch`; ese error puede ocurrir **antes** de que cualquier listener de ready esté registrado (ver defecto ERR-DEF-001 y el backfill race documentado en `tests/integration/error-recovery.spec.ts`).

## API pública

| Miembro | Tipo | Acceso | Notas |
|---------|------|--------|-------|
| Evento `error` | `PlayerError` (o `Error` para autoplay) | suscripción | Se emite en CADA error, fatal o no. Nombre interno `Events._error = 'error'`. |
| Getter `error` | `PlayerError \| null` | R | **Solo el último error FATAL.** Los no-fatales no lo actualizan. |
| `status` | `'playing' \| 'pause' \| 'buffering' \| 'error'` | R | Retorna `'error'` cuando `api.error` está seteado (es decir, hubo un fatal). |

> **No existe `getErrors()` en la API pública del player.** El método `getErrors()` que aparece en los tests es un helper del harness QA (`fixtures/player-mixins/QoEMixin.ts`) que lee `window.__qa.errors`, un historial acumulado por el listener del harness sobre el evento `error`. El player solo guarda el ÚLTIMO error fatal. Toda referencia a "historial de errores" en QA es responsabilidad del harness, no del player.

## Interacciones con otros sistemas

- **playback-core / handlers (HLS, DASH, native)** — productores principales de errores; cada handler tiene su propia lógica de traducción y recovery.
- **drm** — emite `PlayerInitError('DRM not supported')` fatal; los errores KEY_SYSTEM de hls.js (license/EME) pasan por el handler HLS.
- **platform-config (loadConfig)** — fuente de errores `init_player` pre-reproducción (403, formato no disponible, tipo inválido).
- **events** — `internalEmitter`/`externalEmitter`; re-emisión cross-frame por `postMessage`. Solo eventos en el enum `Events` se propagan a suscriptores externos.
- **youbora / analytics** — consume el evento `error` para beacons `/error`. Defecto conocido YBRA-DEF-001: errores fatales pre-ready se pierden porque el adapter NPAW aún no existe.
- **ads-manager / ads-ima** — jerarquía `AdError` aislada; un error de ad nunca propaga al estado fatal del contenido.
- **controls-api** — reacciona a errores fatales (reset de readiness) y traduce autoplay bloqueado a estado pause.
