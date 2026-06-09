# DASH — Business Rules

## Reglas de selección de handler

**BR-DASH-001** — Selección automática de DashHandler por extensión de URL
El player selecciona automáticamente el DashHandler cuando la URL de la fuente contiene la extensión `.mpd` (case-insensitive). Esta detección ocurre en `src/player/base.js` sin requerir configuración explícita. La presencia de `.mpd` en cualquier parte de la URL (no solo el final) activa el handler.

**BR-DASH-002** — Selección explícita via parámetro `format`
Cuando se llama `player.load({ format: 'dash' })`, el `selectedSrcType` se fuerza a `'dash'` y se monta el DashHandler independientemente de la extensión de la URL. Esta regla tiene prioridad sobre la auto-detección.

**BR-DASH-003** — URL `.m3u8` nunca activa el DashHandler
El auto-detect de DASH no aplica a URLs con extensión `.m3u8`. Esta es una regla de no-regresión: cambios en la lógica de selección no deben afectar el handler HLS.

## Reglas de ABR (Adaptive Bitrate)

**BR-DASH-004** — ABR es gestionado por dash.js, no por el player
El algoritmo ABR (selección de representación según bandwidth) lo ejecuta dash.js internamente (algoritmo DYNAMIC en v5.x). El player no interfiere con el ABR automático a menos que se fije un nivel explícito via `player.level = N`.

**BR-DASH-005** — `player.level = N` desactiva ABR automático en dash.js
Asignar un índice de nivel distinto de -1 llama a `updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } })` en dash.js y fija la representación via `setRepresentationForTypeByIndex(N)`. El cambio es asíncrono (setTimeout 0) para evitar conflicto con eventos en vuelo.

**BR-DASH-006** — `player.level = -1` restaura ABR automático
Asignar -1 llama a `updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } })`. `player.autoLevelEnabled` retorna true. Emite 'levelchange' con -1.

**BR-DASH-007** — `player.levels` retorna representaciones disponibles desde dash.js
El getter `levels` usa `getRepresentationsByType()`. Puede retornar array vacío antes de `MANIFEST_LOADED`. Cada elemento tiene `{ index, height, width, bitrate, label }` donde `bitrate` es en bps.

**BR-DASH-008** — Las propiedades de ABR aplican a DASH con dash.js
A diferencia de la decisión técnica previa (2026-04-08), las propiedades `player.level`, `player.levels`, `player.bandwidth`, `player.bitrate`, `player.autoLevelEnabled`, `player.nextLevel` funcionan en DASH porque el handler usa dash.js. Sin embargo, el comportamiento es diferente a HLS: el cambio de nivel es asíncrono y el ABR interno de dash.js puede ignorar la fijación bajo ciertas condiciones.

## Reglas de DVR

**BR-DASH-009** — DVR en DASH requiere `timeShiftBufferDepth` en el MPD
Un stream DASH es DVR-capable solo si el MPD incluye `timeShiftBufferDepth` con un valor mayor que 0 en el elemento `<MPD type="dynamic">`. Sin este atributo, `getDvrWindow()` de dash.js retorna null o size=0, y el player no puede hacer seek temporal.

**BR-DASH-010** — DVR seek usa offset relativo a la ventana, no tiempo absoluto
En `type: 'dvr'`, `player.currentTime = T` interpreta T como offset desde el inicio de la ventana DVR (0 = inicio de la ventana disponible). El handler calcula el windowStart internamente y llama `player.seek(T)` en dash.js. El evento `_dvrSeekApplied` se emite con el payload `{ windowStart, offset }`.

**BR-DASH-011** — dvrWindow puede estar disponible con delay post-playing
La ventana DVR (`player.dvrWindow`) puede ser null inmediatamente después del evento 'playing'. Los consumidores deben usar polling (`expect.poll()`) con timeout de al menos 10s antes de leer dvrWindow o duration en streams DVR.

## Reglas de ciclo de vida

**BR-DASH-012** — MediaPlayer de dash.js se destruye al cambiar src
Cuando el src cambia (`getDerivedStateFromProps`), el MediaPlayer anterior recibe `destroy()` antes de crear uno nuevo. Esta regla garantiza que no hay múltiples instancias de dash.js activas simultáneamente para el mismo player.

**BR-DASH-013** — System73 wrapper se destruye al cambiar src o al destruir el player
Si el P2P wrapper de System73 está activo, recibe `destroy()` cuando: (a) el src cambia via `getDerivedStateFromProps`, o (b) el componente se desmonta via `componentWillUnmount`. La llamada a `destroy()` está envuelta en try/catch para ser tolerante a fallos del SDK.

**BR-DASH-014** — Stale-src guard: no aplicar wrapper si src cambió durante await
Después de `await getSystem73DashSDK()`, si `this.state.src !== src` (el src que inició el load), `_load()` retorna sin aplicar el wrapper ni inicializar dash.js. Esta regla previene la race condition P2P.

**BR-DASH-015** — `pauseBuffering` y `resumeBuffering` son no-op en DASH
Estos métodos no tienen implementación funcional en DashHandler porque dash.js no expone una API equivalente. Los plugins o features que dependen de estas funciones deben verificar el handler activo.

## Reglas de eventos

**BR-DASH-016** — 'ready' se emite al recibirMANIFEST_LOADED de dash.js
El evento público 'ready' se emite cuando dash.js completa el parse del MPD y el buffer está disponible. Este evento puede emitirse hasta 2 veces (segundo ready en un reload edge case) — esto es aceptable pero no deseable.

**BR-DASH-017** — 'error' con fatal=false + isNetwork activa buffering
Si dash.js emite un error no fatal de red, el handler llama `_setBuffering()` además de emitir el evento 'error'. El player espera el evento 'canplay' para limpiar el estado de buffering. Esto implementa un recovery automático transparente.

**BR-DASH-018** — 'timeupdate' emite currentTime, no el evento nativo
El handler intercept el evento HTML5 `timeupdate` y re-emite con `this.get('currentTime')` en lugar del evento nativo. Esto garantiza consistencia con la lógica de offset DVR.

## Reglas de play/pause en live

**BR-DASH-019** — `play()` busca el live edge si la latencia supera el threshold
Al llamar `play()`, si el stream es live y la latencia actual excede `max(bufferlength * 2, 60)` segundos, el handler llama `player.seekToOriginalLive()` para llevar al viewer al live edge. Esto previene que un viewer que estaba pausado mucho tiempo reproduzca desde una posición muy atrasada.

## Reglas de la industria aplicables

**BR-DASH-IND-001** — DASH no funciona en iOS Safari — siempre proveer HLS para Apple
DASH requiere MSE que no está completamente soportado en iOS Safari para video con DRM. La práctica universal de la industria es: usar HLS para dispositivos Apple, DASH para Android/Web. La plataforma Mediastream debe garantizar que src.hls esté disponible para dispositivos iOS, independientemente de si src.mpd existe.

**BR-DASH-IND-002** — timeShiftBufferDepth determina el DVR window, no el servidor
La duración del DVR window disponible para el usuario la define el valor de `timeShiftBufferDepth` en el MPD, no el estado del servidor. Un stream puede tener más buffer disponible en el servidor pero si el MPD no declara `timeShiftBufferDepth`, los players lo tratan como un stream live sin DVR.

**BR-DASH-IND-003** — Errores de segmento non-fatal deben gatillar retry, no detener el player
La industria (dash.js, Shaka) implementa retry automático para errores non-fatal de descarga de segmentos. Un error con `fatal=false` no debe mostrar pantalla de error al usuario. Solo `fatal=true` justifica una UI de error. El DashHandler implementa esta distinción via `isFatal = get(e, 'error.fatal', true)`.

**BR-DASH-IND-004** — CMAF es el formato de empaque estándar para DASH+HLS
La industria usa CMAF (ISO BMFF / fMP4) para empaquetar una sola vez y servir tanto como DASH como HLS. Los streams que funcionan como DASH probablemente usen fMP4 internamente. Los tests no deben asumir que los segmentos son `.ts` (HLS legacy) o `.m4s` exclusivamente.
