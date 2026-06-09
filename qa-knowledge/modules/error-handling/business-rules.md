# Error Handling — Business Rules

## Reglas de clasificación de errores

**BR-ERR-001** — Todo error de contenido/player es una instancia de `PlayerError`
Cualquier fallo de inicialización o reproducción del contenido se modela como `PlayerError` o una de sus subclases (`MediaError`, `NetworkError`, `PlayerInitError`), que extienden `Error`. El objeto siempre lleva `message`, `type` y `fatal`; opcionalmente `data`. (Excepción documentada: errores native code 1/2/3 y el `Error` genérico de autoplay no siguen esta forma — ver ERR-DEF-003 y BR-ERR-009.)

**BR-ERR-002** — `error.type` es un string constante del enum `ErrorType`
Los valores válidos son `network_error`, `media_error`, `other`, `init_player`, `default`. La subclase determina el type. No hay código numérico en `PlayerError`; los códigos numéricos solo existen en `AdError` (VAST/VMAP) y en el `HTMLMediaElement` nativo (1–4).

**BR-ERR-003** — `error.fatal` decide si el contenido se detiene
`fatal: true` significa irrecuperable: el `status` pasa a `'error'`, `controls` resetea la readiness y el getter `error` se actualiza. `fatal: false` significa que el evento se emite pero el player intenta recuperarse y el contenido sigue.

## Reglas del getter y el estado

**BR-ERR-004** — El getter público `error` retiene SOLO el último error fatal
`ErrorHandler` escribe al contexto únicamente cuando `err.fatal === true`. Antes de cualquier error fatal, `error` es `null`. Los errores no-fatales nunca aparecen en el getter; para observarlos hay que suscribirse al evento `error`. (Contraintuitivo pero deliberado — ver ERR-LEARN-002.)

**BR-ERR-005** — `status` devuelve `'error'` si y solo si hubo un error fatal
El getter `status` retorna `'error'` cuando `api.error` está seteado (es decir, ocurrió un fatal). Un error no-fatal no cambia `status` a `'error'`.

**BR-ERR-006** — El evento `error` se emite en CADA error (fatal y no-fatal)
A diferencia del getter, el evento público `error` se dispara para todos los errores, incluyendo transitorios y recuperables. Es el único canal fiable para observar fallos no-fatales. (Excepción: `KEY_SYSTEM_NO_ACCESS` no emite evento — entra a buffering, ver ERR-DEF-002.)

## Reglas de recovery

**BR-ERR-007** — El recovery automático difiere según el tipo de error
- Network error fatal NO-manifest → `hls.startLoad()` y se degrada a no-fatal.
- Media error → `hls.recoverMediaError()` y se emite `MediaError` no-fatal.
- Manifest error (load/parse/timeout) → fatal inmediato, sin recovery.
- `KEY_SYSTEM_NO_ACCESS` → buffering silencioso (sin error).

**BR-ERR-008** — Un fallo persistente debe terminar en error fatal, nunca en buffering infinito
Tras agotar el retry budget de hls.js (backoff exponencial), un fallo de red/media persistente emite `error` fatal y pasa a `status: 'error'`. El player no debe quedar colgado en buffering. (Excepción conocida: `KEY_SYSTEM_NO_ACCESS`, ERR-DEF-002.)

**BR-ERR-009** — Autoplay bloqueado es no-fatal y vuelve a `pause`
Cuando el navegador rechaza `play()` sin interacción, se emite un `Error` genérico con `message` que contiene `'Autoplay failed'` y el `status` vuelve a `'pause'`. No es un error fatal y no actualiza el getter `error`.

## Reglas de aislamiento de ads

**BR-ERR-010** — Un error de ad nunca marca el contenido como fatal
`AdError` es una jerarquía separada de `PlayerError`. Un VAST vacío, un MediaFile no encontrado o un VPAID error producen un `AdError` con código VAST/VMAP propio, pero el getter `error` del contenido permanece `null` y la reproducción del contenido continúa o reanuda.

**BR-ERR-011** — `AdError` se clasifica por rango de código
`getType()` devuelve `'AdLoad'` para códigos 100–399 y `'AdPlay'` para el resto. `getVastErrorCode()` devuelve el código si está en 100–999, sino `900` (UNKNOWN_ERROR). En no-producción, el constructor exige que el código sea un entero (lanza si no).

## Reglas de inicialización

**BR-ERR-012** — Fallos de config pre-reproducción son `init_player` fatal con `data.status`
`loadConfig` captura el status HTTP (ej. 403) en `error.data.status` y lanza `PlayerInitError` fatal. Es el único punto donde el código HTTP queda accesible en el objeto de error del player. Los errores de segmento NO exponen status HTTP.

**BR-ERR-013** — Formato forzado no disponible es `init_player` fatal
Solicitar `format=dash` sin fuente mpd (o `format=hls` sin fuente hls en video) lanza `PlayerInitError` fatal con `data === 'FORMAT_NOT_AVAILABLE'`.

## Reglas de la industria aplicables

**BR-ERR-IND-001** — Todo error debe tener una clasificación observable (SVTA)
La SVTA Standardized Player Error Codes establece que cada fallo debe exponer una categoría/código observable; `999` queda reservado para "totalmente desconocido". El player cumple parcialmente vía `type` string, pero no expone un código numérico estandarizado. Anti-patrón a evitar: emitir errores sin `type` o silenciosos.

**BR-ERR-IND-002** — 403/404/manifest inválido deben escalar a error user-facing, no reintentar
hls.js y la práctica OTT coinciden: estos casos indican contenido no disponible (no transitorio) y reintentar produce loop loading. El player ya marca manifests y config 403 como fatales.

**BR-ERR-IND-003** — Errores transitorios de red deben recuperarse antes de escalar
La práctica OTT distingue fallos transitorios (5xx, jitter de CDN) de permanentes (403/404). Solo los transitorios justifican retry con backoff; el resto debe fallar rápido. El player delega esta distinción al budget de hls.js.

**BR-ERR-IND-004** — Los errores de startup (EBVS) son críticos para QoE
NPAW/Conviva tratan los errores antes del inicio de video (Exits Before Video Start) como la métrica QoE más correlacionada con churn. Un error fatal pre-ready debe reportarse a analytics — hoy degradado (ERR-DEF-001 / YBRA-DEF-001).

**BR-ERR-IND-005** — VPAID es legacy; los flujos de ad modernos usan SIMID/OMID
La IAB deprecó VPAID en favor de SIMID (interactividad, VAST 4.1+) y OMID (verificación). `VpaidError` (código 901) se mantiene por compatibilidad, pero no debe considerarse el camino preferente.
