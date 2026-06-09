# AirPlay — Business Rules

Reglas derivadas del código fuente del player (`src/airplay/`, `src/view/video/atoms/airplay.js`,
`src/player/handler/hls/handler.js`) y de estándares/práctica de la industria
(WebKit, Apple Developer, hls.js).

## Reglas de soporte y activación

**BR-APLY-001** — Soporte determinado por feature-detect, no por user-agent
El módulo AirPlay se activa única y exclusivamente si
`HTMLVideoElement.prototype.webkitShowPlaybackTargetPicker` es una función
(`isAirPlaySupported()`). No se inspecciona user-agent ni nombre de navegador. Si la
función no existe, el módulo entero queda inactivo.

**BR-APLY-002** — AirPlay solo en WebKit; degradación elegante en el resto
En navegadores no-WebKit (Chromium, Firefox) y plataformas TV (WebOS, Tizen), AirPlay
no está disponible. El player NO debe instanciar el manager, NO debe renderizar el
botón/indicador, y registrar los eventos AirPlay debe ser un no-op silencioso (sin
excepciones).

**BR-APLY-003** — AirPlay habilitado por defecto, desactivable por configuración
AirPlay está activo por defecto cuando la plataforma lo soporta. El flag de contexto
`view.airplay` lo desactiva solo si su valor es `false`, `'false'`, `0` o `'0'`.
Cualquier otro valor (incluida la ausencia) lo deja habilitado.

## Reglas de disponibilidad y conexión

**BR-APLY-004** — El botón AirPlay solo se muestra cuando hay un receptor disponible
La UI de AirPlay (botón) aparece cuando `airplayAvailable` es `true`
(WebKit reportó `availability='available'`). El indicador "AirPlay activo" se muestra
solo cuando `airplay` (conectado) es `true`.

**BR-APLY-005** — El picker solo se abre si hay disponibilidad
`showPicker()` solo invoca `webkitShowPlaybackTargetPicker()` si el manager está
adjunto y `isAvailable` es `true`. Sin receptor disponible, la invocación es no-op.

**BR-APLY-006** — Al abrir el picker, el audio se fuerza audible
Antes de mostrar el picker, el player setea `volume=1` y `muted=false` en el `<video>`,
para que el contenido sea audible en el receptor tras el handoff.

**BR-APLY-007** — La reproducción continúa en el dispositivo destino
Al conectar AirPlay, el SO hace handoff del elemento `<video>` completo: la reproducción
continúa en el receptor desde la posición actual. Al desconectar, vuelve al dispositivo
local.

## Reglas de compatibilidad con HLS / MSE

**BR-APLY-008** — ManagedMediaSource se desactiva en dispositivos AirPlay
Cuando AirPlay es soportado, el handler HLS usa MSE clásico
(`preferManagedMediaSource = false`). MMS no debe usarse en dispositivos AirPlay-capaces
porque oculta el botón y rompe el handoff.

**BR-APLY-009** — Si MMS está presente, debe existir un segundo `<source>` HLS
Cuando `window.ManagedMediaSource` existe y hay una URL `.m3u8`, el player añade un
segundo `<source>` con `type='application/x-mpegurl'` para que el receptor pueda
fetchear el stream real. Ese `<source>` debe eliminarse al hacer detach.

**BR-APLY-010** — `disableRemotePlayback` se fuerza a false al adjuntar y se restaura al detach
Al adjuntar el manager, `video.disableRemotePlayback` se setea a `false` (para no ocultar
AirPlay). Su valor previo se restaura al detach/destroy, sin efectos colaterales.

## Reglas de analytics

**BR-APLY-011** — El estado AirPlay se reporta como external playback
El player reporta `ext_pb = 1` en los beacons de playback mientras AirPlay está conectado,
y `ext_pb = 0` cuando no. Refleja que el playback ocurre en un dispositivo externo.

## Reglas de la industria aplicables

**BR-APLY-IND-001** — AirPlay requiere misma red local (Bonjour/mDNS)
El dispositivo Apple y el receptor deben estar en la misma red WiFi/LAN con descubrimiento
mDNS funcional. Redes segmentadas, VLANs o redes invitado aisladas impiden el
descubrimiento; el player no puede distinguir "no soportado" de "sin receptor visible".
Fuente: Apple Support, foros Jamf.

**BR-APLY-IND-002** — Recomendar contexto seguro (HTTPS) extremo a extremo
Las capacidades de media en Safari moderno se restringen a secure contexts. El player y el
contenido HLS deben servirse por HTTPS para garantizar AirPlay en producción.

**BR-APLY-IND-003** — Usar la API WebKit para AirPlay, no la Remote Playback API (W3C)
Safari implementa AirPlay solo mediante APIs webkit-prefijadas
(`webkitShowPlaybackTargetPicker`, `webkitCurrentPlaybackTargetIsWireless`). La Remote
Playback API estándar de W3C (`video.remote.*`) NO habilita AirPlay en Safari. Es correcto
que el player use la API webkit; migrar a W3C no es viable para AirPlay.
Fuente: w3c/remote-playback issues #1, #114.

**BR-APLY-IND-004** — `x-webkit-airplay` está deprecado; no setearlo para habilitar
El atributo `x-webkit-airplay='allow'` está deprecado por Apple. AirPlay está habilitado
por defecto; el opt-out se hace con `x-webkit-airplay='deny'` o `disableRemotePlayback=true`,
no con la presencia del atributo. Fuente: Apple AirPlay Programming Guide.

**BR-APLY-IND-005** — El evento de disponibilidad dispara un estado inicial automáticamente
Al registrar `webkitplaybacktargetavailabilitychanged`, WebKit emite un evento inicial con
el estado actual. No se necesita polling para obtener la disponibilidad inicial.
Fuente: Apple Developer "Adding an AirPlay button".
