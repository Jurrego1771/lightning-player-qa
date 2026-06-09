# playback-core — Business Rules

## Reglas de inicialización

**BR-PLAY-001** — autoplay default es true

Si el parámetro `autoplay` no se incluye en la configuración de `loadMSPlayer()`, el player usará `autoplay: true`. Este comportamiento es intencional para facilitar la integración, pero puede causar problemas con la autoplay policy de los browsers en usuarios sin historial de interacción.

Derivado de: `src/player/base.js contextMapper` — `'autoplay' in context ? !!context.autoplay : true`

---

**BR-PLAY-002** — loop default es false

Si el parámetro `loop` no se incluye en la configuración, el player usará `loop: false`. Activar loop requiere pasar explícitamente `loop: true`, `loop: '1'`, o `loop: 1`.

Derivado de: `src/player/base.js contextMapper` — `'loop' in context ? ['true', true, '1', 1].includes(context.loop) : false`

---

**BR-PLAY-003** — volume default es 1 (máximo) cuando no se especifica o es inválido

Si `volume` no está en el rango `[0, 1]` o no es un número válido, el player usa `volume: 1`. Valores fuera de rango son silenciosamente normalizados.

Derivado de: `src/player/base.js contextMapper` — validación con `!isNaN(_volume) && _volume >= 0 && _volume <= 1`

---

**BR-PLAY-004** — tipos de contenido válidos: live, dvr, media

El player solo acepta `type: 'live'`, `type: 'dvr'`, o `type: 'media'`. Si se pasa un tipo diferente, se emite inmediatamente un error con `fatal: true` via `PlayerInitError`.

`'episode'` es remapeado internamente a `'media'` antes de llegar al validador.

Derivado de: `src/player/base.js getDerivedStateFromProps` — `if (!~['live', 'dvr', 'media'].indexOf(props.type))`

---

**BR-PLAY-005** — src null es válido, src undefined o vacío lanza error

El player acepta `src: null` (estado sin contenido asignado). Si `src` no está definido o no tiene valor válido y tampoco hay `selectedSrcType`, el player emite `PlayerInitError('Invalid player src.', true)`.

Derivado de: `src/player/base.js getDerivedStateFromProps` — `if (!props.src && props.src !== null)`

---

**BR-PLAY-006** — hlsVariant default es 'normal'

Si `hlsVariant` no está en `['light', 'beta', 'normal']` o no se especifica, el player usa `'normal'`. El variant 'light' no soporta todas las features (mencionado en el código).

Derivado de: `src/player/base.js contextMapper` — `['light', 'beta', 'normal'].includes(context.hlsVariant) ? context.hlsVariant : 'normal'`

---

## Reglas de selección de handler

**BR-PLAY-007** — DASH siempre usa MSE nativo (sin dash.js)

Cuando `srcType === 'dash'`, el player siempre usa `DashHandler` que implementa reproducción via Media Source Extensions nativas del browser. No se usa dash.js. Las propiedades ABR (`level`, `levels`, `bandwidth`, `bitrate`, `nextLevel`, `autoLevelEnabled`) no están disponibles para contenido DASH. `player.sourceType` retorna `'native'` para DASH.

---

**BR-PLAY-008** — HLS.js tiene prioridad sobre native HLS en todos los browsers

Cuando el stream es HLS y hls.js está disponible en el browser, el player usa HLS.js aunque el browser soporte HLS nativo. La única excepción es Safari con FairPlay DRM configurado, donde se usa el handler nativo para utilizar el flujo `webkitneedkey`.

Derivado de: `src/player/base.js getDerivedStateFromProps` — comentario: "we will use it instead of the native player ALWAYS (even when native is supported)"

---

**BR-PLAY-009** — selectedSrcType override tiene prioridad sobre detección por URL

Si la configuración incluye `selectedSrcType: 'hls'` o `selectedSrcType: 'dash'`, este valor tiene prioridad sobre la extensión de la URL para determinar el handler. Útil para streams con URLs sin extensión estándar.

---

## Reglas de control de reproducción

**BR-PLAY-010** — volume range: 0.0 a 1.0

El setter `player.volume` acepta valores en el rango `[0.0, 1.0]`. El valor `0` equivale a muted (NativeHandler asigna `element.muted = true` cuando `volume === 0`). Los valores fuera del rango son rechazados o clamp por el HTMLMediaElement nativo.

---

**BR-PLAY-011** — seek (currentTime setter): valores negativos van a 0, valores > duration van al final

El setter `currentTime` clampea valores negativos a 0. Valores mayores que `duration` posicionan el playhead al final del contenido (comportamiento del HTMLMediaElement spec).

Para seeks a posición > 0, NativeHandler espera a que la posición sea seekable via `_awaitSeekable()` antes de asignar `currentTime`. Esto previene seeks en áreas fuera del buffer.

---

**BR-PLAY-012** — seek en HLS espera a que el rango sea seekable

El método `set` de NativeHandler tiene la condición: `if (prop === 'currentTime' && val > 0) { await this._awaitSeekable(val) }`. El player espera activamente hasta que `seekable.end(0) >= val` antes de ejecutar el seek. No hay timeout — puede esperar indefinidamente si el rango nunca es seekable.

---

**BR-PLAY-013** — destroy() es idempotente

Llamar `destroy()` múltiples veces en la misma instancia es seguro. La segunda llamada es un no-op porque el componente React ya fue desmontado.

---

**BR-PLAY-014** — ended event es emitido una sola vez por reproducción

NativeHandler tiene el flag `_alreadyEmittedEnded` que previene la doble emisión del evento `ended`. El flag se resetea automáticamente cuando se carga nuevo contenido (en `loadedmetadata`). Intentar que `ended` se emita de nuevo en el mismo contenido requiere llamar `load()` o navegar a otro contenido.

---

**BR-PLAY-015** — audioTrack change requiere listener explícito

Los cambios de `audioTracks` se exponen via eventos `audiotrackchange`, `audiotrackaddtrack`, `audiotrackremovetrak`. El player escucha el `AudioTrackList.change` nativo y lo re-emite via `internalEmitter`. El cambio de track activo se realiza habilitando/deshabilitando tracks en `AudioTrackList` directamente.

---

## Reglas de la industria aplicables

**BR-PLAY-IND-001** — Autoplay con audio requiere interacción previa o MEI alto

Los browsers modernos bloquean autoplay con audio para usuarios sin historial de interacción con el dominio. La solución estándar de la industria es: (1) iniciar con `muted: true` o `volume: 0`, y (2) mostrar un botón prominente de unmute. Muted autoplay es siempre permitido por Chrome, Firefox, y Safari.

Fuente: Chrome autoplay policy (developer.chrome.com/blog/autoplay)

---

**BR-PLAY-IND-002** — play() siempre retorna una Promise que puede ser rechazada

El spec HTML5 define que `HTMLMediaElement.play()` retorna una Promise. Si el autoplay es bloqueado por la política del browser, la Promise es rechazada con un `NotAllowedError`. El integrador debe manejar este rechazo para evitar errores no capturados en la consola.

Fuente: MDN HTMLMediaElement.play(), WHATWG spec

---

**BR-PLAY-IND-003** — preload='auto' descarga agresiva al inicio

El elemento video en NativeHandler usa `preload="auto"`, que indica al browser que puede descargar todo el contenido. En conexiones celulares (2G-4G), Chrome ignora este hint y usa 'metadata'. En producción, `preload="auto"` puede generar consumo innecesario de ancho de banda para usuarios que no reproducen el video.

Fuente: web.dev/fast-playback-with-preload

---

**BR-PLAY-IND-004** — HTMLMediaElement readyState debe ser >= 3 para reproducción confiable

Para que un seek o una reproducción inmediata funcionen sin buffering, `player.readyState` debe ser al menos `HAVE_FUTURE_DATA (3)`. `HAVE_ENOUGH_DATA (4)` garantiza reproducción hasta el final sin interrupciones según el browser. Los tests de reproducción deben esperar `canplay` (readyState >= 3) antes de assertar posición.

Fuente: WHATWG HTML spec, MDN HTMLMediaElement.readyState

---

**BR-PLAY-IND-005** — destroy() debe ser llamado explícitamente por el integrador

La industria considera responsabilidad del integrador llamar `destroy()` antes de remover el container del DOM. Si el container se elimina sin llamar `destroy()`, se crean leaks de memoria (event listeners del EventEmitter no se limpian, intervals continúan activos). React.componentWillUnmount proporciona una segunda línea de defensa, pero no es suficiente si React no puede hacer unmount normalmente.

Fuente: Industria OTT, Video.js documentation, análisis de código
