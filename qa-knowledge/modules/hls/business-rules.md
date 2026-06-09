# HLS — Business Rules

## Reglas de ABR (Adaptive Bitrate)

**BR-HLS-001** — ABR solo aplica a streams HLS (no DASH)
El player no usa hls.js para DASH. Las propiedades `player.level`, `player.levels`, `player.nextLevel`, `player.bandwidth`, `player.bitrate`, `player.autoLevelEnabled` solo tienen valores válidos cuando el stream es HLS. Para DASH, estas propiedades retornan `undefined` o `null`. Verificado en `decisions.md` (2026-04-08).

**BR-HLS-002** — `player.level = -1` significa ABR automático
El valor `-1` es el modo ABR. hls.js decide el nivel basándose en el bandwidth estimado EWMA. Asignar `-1` después de un nivel manual restaura el control automático. Al inicio, `hls.startLevel = -1` se establece explícitamente en MEDIA_ATTACHED.

**BR-HLS-003** — El nivel se aplica al siguiente segmento, no inmediatamente
Cuando se asigna `player.level = N`, el nivel actual cambia al siguiente segmento descargado. `player.nextLevel` refleja el cambio inmediatamente; `player.level` refleja el cambio después de `levelchanged`. Este delay es intrínseco al protocolo HLS (chunked streaming).

**BR-HLS-004** — `player.nextLevel` es `hls.loadLevel` (nivel en carga), no `hls.nextLevel`
La implementación mapea `player.nextLevel → hls.loadLevel`. Al hacer `set('level', N)`, se escribe tanto `hls.nextLevel` como `hls.loadLevel` para mantener consistencia. Esto hace el cambio predecible e inmediatamente observable.

**BR-HLS-005** — `capLevelToPlayerSize=true` limita el ABR al tamaño del contenedor
El player nunca solicitará una calidad mayor al tamaño visual del contenedor del player. En un player de 360p de ancho, el ABR no elegirá 1080p aunque el bandwidth sea suficiente. Este comportamiento es intencional para evitar el desperdicio de datos del usuario.

## Reglas de Live y DVR

**BR-HLS-006** — `player.duration` retorna `Infinity` para cualquier stream live
Para streams con `type === 'live'` (incluyendo DVR), `player.duration` retorna `Infinity`. Esto es correcto según la MSE spec. Para conocer la ventana DVR disponible, usar `player.seekable.end - player.seekable.start`.

**BR-HLS-007** — DVR requiere `PLAYLIST_TYPE=EVENT` o sliding window en el manifest
La ventana DVR solo existe si el servidor HLS la configura correctamente. Con `PLAYLIST_TYPE=EVENT`, todos los segmentos históricos se mantienen. Con sliding window, solo los últimos N segundos. El player no puede crear una ventana DVR si el servidor no la provee.

**BR-HLS-008** — Live stream stalled: el player hace flush y retoma desde live edge
Si un stream live pierde conexión y la recupera, el player (mediante el flag `_wasStalled`) flushea todo el buffer acumulado y resetea `currentTime = 0`. Esto evita que hls.js intente bufferar desde el punto de la desconexión (que podría ser horas atrás). El comportamiento es intencional y brusco.

**BR-HLS-009** — Live edge seek: el player salta al live edge si el lag es excesivo
Al llamar `play()`, si el tipo es `live` y `liveMaxLatencyDurationEnabled !== false` y el lag > `max(bufferlength*2, 60)` segundos, el player seekea automáticamente al `liveSyncPosition`. Para DVR (type !== 'live') NO se fuerza el seek al live edge. Para Google DAI, `liveMaxLatencyDurationEnabled=false` deshabilita este comportamiento para no saltear anuncios.

## Reglas de Configuración de hls.js

**BR-HLS-010** — La importación debe ser `.min.js`, nunca `.mjs`
Los tres entry points del handler (hls.js, hls-light.js, hls-beta.js) importan explícitamente `hls.min.js` en lugar de `hls.mjs`. El archivo `.mjs` no incluye el Web Worker para procesamiento asíncrono, lo que degrada significativamente el rendimiento.

**BR-HLS-011** — CORS es obligatorio en el CDN para crossOrigin='anonymous'
El elemento `<video>` se renderiza con `crossOrigin='anonymous'`. Esto hace que el browser envíe el header `Origin` en todas las requests de segmentos. Si el CDN no responde con `Access-Control-Allow-Origin`, la reproducción falla con CORS error. Para DRM con `withCredentials=true`, el CDN debe incluir `Access-Control-Allow-Credentials: true`.

**BR-HLS-012** — Audio player usa buffer más pequeño que video
El buffer por defecto para tipo `audio` es 2 MB vs 60 MB para video (`bufferSize = playerType === 'audio' ? 2 : 60`). Esto es intencional para reducir uso de memoria en reproductores de audio donde la decodificación es más ligera.

**BR-HLS-013** — ManagedMediaSource se desactiva cuando AirPlay está disponible
`preferManagedMediaSource: !isAirPlaySupported()`. Si el browser soporta AirPlay (Safari en macOS/iOS), el player usa MediaSource regular para preservar la funcionalidad AirPlay. ManagedMediaSource (Safari 17.1+) desactivaría el botón AirPlay al eliminar el elemento `<source>` de fallback.

## Reglas de Error Handling

**BR-HLS-014** — Errores de manifest son siempre fatales
`MANIFEST_LOAD_ERROR`, `MANIFEST_PARSING_ERROR`, y `MANIFEST_LOAD_TIMEOUT` emiten `NetworkError` con `fatal=true`. No hay retry de manifest — si el manifest no carga, el player reporta error inmediatamente.

**BR-HLS-015** — Errores de segmento (no manifest) hacen startLoad() antes de reportar
Para errores de red no relacionados con el manifest (p.ej. segmento 404 no persistente), el handler llama `hls.startLoad()` y luego emite `NetworkError` con `fatal=false`. hls.js gestiona los retries internamente.

**BR-HLS-016** — MediaError fatal usa `recoverMediaError()` de hls.js
Cuando hls.js reporta un MEDIA_ERROR fatal (p.ej. codec incompatible), el handler llama `hls.recoverMediaError()` (la estrategia de recovery recomendada por hls.js) antes de emitir el error al exterior.

**BR-HLS-017** — KEY_SYSTEM_NO_ACCESS dispara buffering, no error fatal inmediato
Si el key system DRM no tiene acceso (`KEY_SYSTEM_NO_ACCESS`), el handler llama `_setBuffering()` antes de que el error sea fatal. Esto da tiempo al sistema DRM para reintentar. Otros errores de key system sí son fatales inmediatamente.

## Reglas de la industria aplicables

**BR-HLS-IND-001** — ABR con hysteresis: bajar rápido, subir lento
La industria OTT establece que el ABR debe degradar la calidad agresivamente cuando el buffer está bajo (para evitar stalls) pero subir la calidad gradualmente cuando el bandwidth mejora (para evitar ABR hunting). hls.js implementa esto con EWMA dual (fast/slow windows). Los tests de ABR deben respetar este comportamiento: no esperar upgrade de calidad inmediato después de restaurar bandwidth.

**BR-HLS-IND-002** — Streams HLS locales en CI, no streams CDN externos
La industria (Netflix, Shaka Player, dash.js) usa streams locales deterministas para tests de integración. Streams CDN externos son frágiles: latencia variable, bitrate cambiante, posibles 403/404. Los tests HLS del player usan streams locales en `localhost:9001` generados con ffmpeg.

**BR-HLS-IND-003** — ABR real requiere CDP network throttling (solo Chromium)
No es posible testear el comportamiento ABR real sin simular condiciones de red. CDP (Chrome DevTools Protocol) es la única API de test que permite throttling de red preciso. Por esto, los tests ABR solo corren en el proyecto "performance" de Playwright (Chromium). Firefox y Safari no tienen API equivalente.

**BR-HLS-IND-004** — player.levels solo disponible después de 'ready'
El manifest HLS se parsea asíncronamente después de `hls.loadSource()`. Leer `player.levels` antes de que se emita el evento `ready` puede retornar `undefined` o array vacío. Este comportamiento es estándar en todos los players HLS de la industria.
