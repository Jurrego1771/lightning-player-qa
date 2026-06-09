# Chromecast — Business Rules

## Reglas de soporte de browser

**BR-CAST-001** — Solo browsers Chromium (no iOS)
El módulo Chromecast solo funciona en browsers basados en Chromium (Chrome desktop, Edge, Opera, Brave). iOS está explícitamente bloqueado via regex `/iphone|ipad|ipod/i` en `isSupported.js`. Firefox y Safari no soportan el Cast SDK y tampoco son habilitados. Android Chrome sí está permitido.

**BR-CAST-002** — Contexto seguro obligatorio
Chromecast solo se inicializa en contextos seguros: HTTPS, localhost (127.0.0.1), o cuando `window.isSecureContext === true`. En HTTP (no-localhost), `isChromecastSupported()` retorna false y el SDK no se carga. Esta restricción es impuesta por los browsers modernos para las APIs de presentación.

**BR-CAST-003** — Solo en top frame (verificación documentada pero no aplicada como guard)
`isTopFrame()` está disponible pero no se usa como guard obligatorio en la inicialización. El módulo puede intentar inicializarse en iframes, aunque el Cast SDK no funcionará en iframes cross-origin.

## Reglas de configuración

**BR-CAST-004** — Chromecast habilitado por defecto en browsers soportados
Si `view.chromecast` no está configurado o es cualquier valor truthy (incluido undefined/null), el módulo se habilita automáticamente en browsers Chromium con HTTPS. Para deshabilitar, se debe pasar explícitamente `view.chromecast=false`, `view.chromecast='false'`, `view.chromecast=0`, o `view.chromecast='0'`.

**BR-CAST-005** — Default Receiver App ID es CC1AD845
Si no se especifica `view.chromecastReceiverAppId`, se usa el Default Media Receiver de Google (`CC1AD845`). Este receiver es mantenido por Google y no requiere hosting. Si el integrador necesita comportamiento personalizado (DRM, UI propia), debe hospedar un Custom CAF v3 Receiver y pasar su App ID.

**BR-CAST-006** — autoJoinPolicy es ORIGIN_SCOPED
El player usa `ORIGIN_SCOPED` por defecto, lo que permite reconectar automáticamente sesiones del mismo origen (dominio) sin mostrar el picker al usuario. No es configurable por el integrador en la API actual.

## Reglas de sesión y playback

**BR-CAST-007** — El player local pausa al iniciar sesión Cast
Al recibir `SESSION_STARTED`, el player local pausa automáticamente (`api.pause()`) para evitar doble audio. Esta es una regla de UX no negociable — el audio no puede reproducirse simultáneamente en el dispositivo local y el Cast device.

**BR-CAST-008** — Prevención activa de doble audio durante casting
Durante una sesión Cast activa, si el player local recibe un evento `play`, el handler `onLocalPlay` lo intercepta y pausa el player local en el siguiente tick (`setTimeout(0)`). Esta regla aplica mientras `manager.isConnected === true`.

**BR-CAST-009** — El player resume en la posición del Cast al desconectar
Al terminar la sesión (`SESSION_ENDED`), si el contenido local y el remoto son el mismo (base URL igual, ignorando query params), el player local restaura `currentTime` al valor del dispositivo remoto y, si el casting estaba en play, inicia reproducción local automáticamente.

**BR-CAST-010** — La posición actual se transfiere al iniciar Cast
Al construir el MediaInfo para cargar en el dispositivo Cast, siempre se incluye `currentTime` del player local. El casting siempre inicia desde la posición exacta donde el usuario estaba.

## Reglas de subtítulos en Cast

**BR-CAST-011** — ASS/SSA son filtrados automáticamente
Formatos de subtítulo ASS y SSA se filtran automáticamente al construir el MediaInfo para Cast, ya que el Google Cast SDK no los soporta. Solo se envían WebVTT y TTML. El filtrado es silencioso — no hay error ni warning al usuario.

**BR-CAST-012** — URLs de subtítulos se normalizan a HTTPS
Todas las URLs de subtítulos se convierten a HTTPS antes de enviarlas al Cast device. El Cast receiver requiere URLs absolutas seguras para recursos externos. URLs relativas que no son paths absolutos retornan null y el track es omitido.

**BR-CAST-013** — Solo un text track activo simultáneamente
El API de text tracks de Cast solo soporta un track activo a la vez. `enableTextTrack(id)` desactiva cualquier track previo. `disableTextTracks()` desactiva todos. `toggleTextTrack(id)` es un toggle on/off del track específico.

**BR-CAST-014** — El subtítulo activo en el player local se transfiere al Cast
Al cargar media en el Cast device, si hay un track con `mode==='showing'` en el local player, se incluye su `activeTrackId` en el LoadRequest. El Cast device inicia con el mismo subtítulo que tenía el local player.

**BR-CAST-015** — tracksLoaded se emite 500ms después de mediaLoaded
Hay un delay intencional de `CAST_EVENT_DELAY_MS=500ms` entre `castMediaLoaded` y `castTracksLoaded`. Este delay existe porque el Cast SDK necesita tiempo para procesar los tracks en el receiver. Si el player se destruye durante ese delay, el evento no se emite.

## Reglas de manejo de errores

**BR-CAST-016** — Fallo del SDK no bloquea el player
Si el Cast SDK falla al cargar (error de script, timeout de 10s, o `isAvailable=false` en el callback), el player continúa funcionando normalmente. `hasCastSDKFailed()` retorna true. El singleton promise se limpia para permitir un retry en la próxima inicialización.

**BR-CAST-017** — Cancelación del picker no es un error
Si el usuario cancela el picker de dispositivos Cast (`err.code === 'cancel'`), el error no se emite vía `castError`. Solo errores reales (no cancelaciones de usuario) disparan `castError`.

## Reglas de la industria aplicables

**BR-CAST-IND-001** — CAF v3 es el único framework soportado por Google
El SDK v2 de Cast está deprecated. El player usa CAF v3 correctamente. Todo nuevo desarrollo debe usar `cast.framework.*` (no `chrome.cast.*` como capa primaria). Fuente: developers.google.com/cast/docs/migrate_v2

**BR-CAST-IND-002** — MPL deprecated para HLS en el receiver — usar Shaka Player
Google anunció en septiembre 2024 que MPL (el player del receiver) ya no adoptará features para HLS. Para Custom Receivers con contenido HLS, la industria recomienda migrar a Shaka Player en el receiver. El Default Receiver (CC1AD845) no está afectado. Fuente: Google Cast Release Notes, Sept 2024.

**BR-CAST-IND-003** — Subtítulos requieren CORS en el servidor de origen
El receiver de Cast no puede acceder a subtítulos que no tengan `Access-Control-Allow-Origin: *` (o el origen del receiver) en su servidor. El player normaliza URLs pero no puede garantizar que el CDN de subtítulos tenga CORS configurado. Fuente: developers.google.com/cast/docs/media

**BR-CAST-IND-004** — Solo un sender Cast activo por página
La industria recomienda un único sender Cast activo por página. El singleton de `castManagerInstance` refleja este patrón. Para multi-instancia, solo una instancia debe tener Cast habilitado. Fuente: Práctica estándar de la industria (Netflix, YouTube, Bitmovin).

**BR-CAST-IND-005** — El Cast receiver sigue reproduciéndose después de cerrar el sender
Si el usuario cierra el tab o navega sin llamar `endSession()`, el Cast device continúa reproduciendo. Este es el comportamiento esperado y deseado (permite al usuario cerrar el browser y seguir viendo en TV). Fuente: Diseño de UX de Google Cast.
