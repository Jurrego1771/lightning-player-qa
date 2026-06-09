# Ads Manager — Business Rules

## Reglas de configuración

**BR-ADMGR-001** — Ausencia de ads.map inhibe completamente el sistema de ads
Si `ads.map` no está configurado o es `null`, el componente AdsManager no inicializa ningún AdsLoader, AdsDisplayContainer ni AdsRequest. El evento `adsRequested` nunca se emite. El contenido reproduce inmediatamente. Esta es la regla más importante: no hay ads por defecto; los ads son opt-in explícito.

**BR-ADMGR-002** — Los cue points determinan cuándo y cuántos ad breaks hay
La única forma de configurar el schedule de ad breaks es a través de la respuesta VAST/VMAP. Si la respuesta es VAST sin cue points, solo hay un pre-roll (cue point = 0). Si la respuesta es VMAP, los cue points son los definidos en los elementos `<vmap:AdBreak>`. No existe configuración del lado del player para añadir o remover cue points después de que el VMAP es parseado.

**BR-ADMGR-003** — ads.map debe contener una URL válida y accesible desde el browser
El ad tag URL es fetched directamente desde el browser (CORS aplica). Si la URL requiere autenticación o tiene restricciones CORS, la request fallará con error 1005 (AD_REQUEST_FAILED). El player no tiene intermediario server-side para hacer proxy de la request VAST.

## Reglas de ciclo de vida

**BR-ADMGR-004** — El ciclo de vida de ads está ligado al elemento de video
El AdsHandler se inicializa cuando el elemento `<video>` o `<audio>` monta (useEffect con `element` como dependencia). Se destruye cuando el elemento desmonta (cleanup del useEffect). Un cambio de `ads.map` con el mismo `element` también re-inicializa el AdsHandler (ambas son dependencias del useEffect).

**BR-ADMGR-005** — reset() garantiza un estado limpio entre contenidos
Cuando el elemento de video desmonta (source change, navegación), `handler.reset()` es llamado automáticamente. Este reset elimina todos los listeners, destruye AdsManager, AdsLoader y AdsDisplayContainer, y limpia el estado interno. No puede haber memoria de estado del ciclo anterior después de un reset.

**BR-ADMGR-006** — ContentPauseRequested y ContentResumeRequested son simétricos
Por cada `adsContentPauseRequested` emitido, se garantiza exactamente un `adsContentResumeRequested` posterior. Esta simetría es crítica para que el player (y el sistema de controles) sepa cuándo retomar el control. La única excepción es si el player se destruye durante un ad break activo — en ese caso el ErrorBoundary garantiza el emit del ResumeRequested.

**BR-ADMGR-007** — AllAdsCompleted marca el fin irrevocable del sistema de ads
Tras `adsAllAdsCompleted`, `AdsManager.destroy()` es llamado automáticamente. El estado `#done = true` se activa en AdsHandler. Después de AllAdsCompleted, `handler.play()` retorna `false` inmediatamente sin intentar reproducir más ads. El sistema solo puede restablecerse con un nuevo `handler.initialize()`.

## Reglas de error

**BR-ADMGR-008** — Un error en el sistema de ads nunca debe bloquear la reproducción del contenido
Ante cualquier error en el ad system (VAST inaccesible, XML malformado, SDK no carga, React error), el comportamiento esperado es:
1. Emitir `adsError` con el código de error correspondiente
2. Emitir `adsAllAdsCompleted` para limpiar el estado
3. Si había un `contentPauseRequested` pendiente, emitir `contentResumeRequested`
4. Permitir que el contenido reproduce normalmente
Esta regla es implementada en múltiples niveles: `AdsHandler.#onAdError()`, el `ErrorBoundary` React, y la lógica de catch en `#loadAds()`.

**BR-ADMGR-009** — Los errores fatales y no-fatales tienen tratamientos distintos
Un error FATAL (`#onAdError(event, fatal=true)`) emite `adsAllAdsCompleted` y llama `reset()`. Un error NO-FATAL (`#onAdError(event, fatal=false)`) solo emite `adsError` y no destruye el AdsManager — el sistema intenta continuar con el siguiente ad. Los errores del tipo `AdError` emitidos por el AdsManager interno son no-fatales por defecto. Los errores de red/fetch en AdsLoader son fatales.

**BR-ADMGR-010** — El player no debe pausar para buscar ads si autoplay está bloqueado
Si el browser bloquea autoplay (NotAllowedError en playerHandler.play()), el AdsHandler retorna `false` desde `#loadAds()` sin intentar inicializar el ad system. El contenido debe poder reproducir cuando haya interacción del usuario, sin que los ads bloqueen el inicio.

## Reglas de reproducción

**BR-ADMGR-011** — Durante la reproducción de un ad, seek del contenido está bloqueado
`handler.set('currentTime')` retorna `null` durante ad playback (`#isPlaying = true`). Esto señaliza a controls-api que el set de currentTime debe ser ignorado. El usuario no puede hacer seek mientras un ad está reproduciéndose.

**BR-ADMGR-012** — El volumen del ad sigue el volumen del contenido
AdsHandler escucha `Events._volumechange` y llama `this.#adsManager.setVolume(volume)` para sincronizar el volumen del ad player con el volumen del contenido. Esta sincronización es automática y transparente para el viewer.

**BR-ADMGR-013** — canPause=false previene que el viewer pause el ad
Si `adsCanPause=false` en la config del player, `handler.pause()` retorna sin llamar `adsManager.pause()`. El ad continúa reproduciéndose aunque el viewer intente pausar. Esto es un requerimiento de algunos tipos de campañas (non-skippable, forced-view).

**BR-ADMGR-014** — El resize del ad slot es responsabilidad del player, no del ad system
`AdsHandler.resize()` es registrado en `window.addEventListener('resize', this.resize)` y también es llamado desde `useAdsResize` hook cuando el player cambia entre fullscreen y windowed. Las dimensiones del slot son recalculadas dinámicamente desde `this.#container.offsetWidth` y `this.#element.offsetWidth`.

## Reglas de tracking y medición

**BR-ADMGR-015** — La impression se dispara en el primer frame de reproducción real, no al cargar el ad
El beacon de impression es disparado en `#onPlaying()` del AdsTracker, que se activa cuando el elemento de video del ad emite el evento `playing`. No se dispara en `loadeddata` ni en `canplay`. Este es el comportamiento correcto según el estándar VAST: la impression se cuenta cuando el ad efectivamente comienza a reproducirse.

**BR-ADMGR-016** — Los beacons de tracking son disparados exactamente una vez (excepto los marcados como TRACK_ALWAYS)
Los eventos como `firstQuartile`, `midpoint`, `thirdQuartile`, `complete`, `skip`, `impression` son disparados una vez y luego eliminados de `#trackingEvents`. Los eventos `mute`, `unmute`, `pause`, `resume`, `rewind`, `fullscreen`, `exitFullscreen`, `expand`, `collapse`, `error` están en `TRACK_ALWAYS_EVENTS` y pueden dispararse múltiples veces.

**BR-ADMGR-017** — El error tracking beacon se dispara automáticamente cuando el AdsManager emite AdError
AdsTracker escucha `EVENTS.AdError` y llama `#pingError(error)` que dispara el beacon de error con el `ERRORCODE` macro resuelto. Este tracking es automático — no requiere intervención del integrador.

## Reglas de la industria aplicables

**BR-ADMGR-IND-001** — VMAP es la forma correcta de definir schedules de ad breaks (no el player)
Según el estándar IAB VMAP, es el content owner (via el ad tag VMAP) quien define cuándo y cuántos breaks hay, no el player. El player debe respetar el schedule del VMAP sin modificarlo. Implementado correctamente en ads-manager: los cue points vienen exclusivamente del VMAP parseado.

**BR-ADMGR-IND-002** — Los Wrappers VAST permiten un máximo de 5 niveles de redirección (recomendación IAB)
Cadenas de Wrappers de más de 5 niveles son señal de daisy-chaining abusivo o de un loop circular. El AdsLoader implementa un límite (WRAPPER_LIMIT_REACHED error 302). Los tests no deben crear Wrapper chains de más de 3 niveles para mantener los tests determinísticos.

**BR-ADMGR-IND-003** — VPAID está deprecated; SIMID + OMID es el stack moderno
Como práctica de la industria, nuevas integraciones de ads deben usar SIMID para interactividad y OMID para viewability, no VPAID. El soporte de VPAID en este player (`adsInsecureVpaidMode`) es un legacy path que no debe usarse en nuevas integraciones.

**BR-ADMGR-IND-004** — El viewable impression standard MRC requiere 50% visible + 2 segundos continuos
La implementación del player sigue correctamente el estándar Media Rating Council para video ads. Tests que simulen viewable impression deben respetar este criterio exacto para ser válidos.

**BR-ADMGR-IND-005** — Empty VAST response (error 303) es un resultado normal, no un error fatal
En redes programáticas (RTB/programmatic), la fill rate puede ser < 100%. Una respuesta VAST vacía no indica un error de configuración del player ni del publisher — simplemente no hubo oferta para esa impression. El player debe tratar error 303 como una degradación silenciosa, no como un fallo.
