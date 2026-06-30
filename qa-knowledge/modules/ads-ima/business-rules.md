# ads-ima — Business Rules

## Reglas de reproducción de ads

**BR-IMA-001** — Pre-roll siempre antes del contenido principal

El pre-roll (podIndex === 0) se reproduce antes de que el contenido principal sea visible
para el usuario. El contenido principal se pausa inmediatamente al recibir CONTENT_PAUSE_REQUESTED
del IMA SDK. El usuario no puede acceder al contenido principal hasta que el pre-roll complete,
sea skippeado, o falle con error.

**BR-IMA-002** — Mid-roll interrumpe el contenido en el cue point exacto

El mid-roll se reproduce cuando el playback del contenido alcanza el cue point definido en el
VMAP. El IMA SDK pausa el contenido y retoma la reproducción desde la misma posición (±1s por
truncamiento de parseInt) después de que el mid-roll completa.

**BR-IMA-003** — Post-roll se ejecuta solo después de que el contenido termina (ended)

El post-roll se triggerea cuando AdsLoader.contentComplete() se llama en respuesta al evento
'ended' del elemento de video. Para live streams sin DVR, no hay post-roll definido (no hay
'ended'). El listener de 'ended' se registra/desregistra dinámicamente para evitar triggering
prematuro.

**BR-IMA-004** — Un error en el sistema de ads NUNCA debe interrumpir el contenido principal

Cualquier fallo del sistema de ads (VAST vacío, SDK CDN caído, error de red, timeout) resulta
en que el contenido principal reproduce normalmente. El player debe emitir adsError pero NO
'error' fatal del player. Este es el principio de graceful degradation más importante del módulo.

**BR-IMA-005** — Seeking durante un ad break no tiene efecto

Cuando isPlayingAd === true, el setter de currentTime del player retorna null sin aplicar el
seek. Los controles del player deben deshabilitar la seekbar y los botones de FF/RW durante
el ad. El usuario no puede saltar el ad usando seek.

## Reglas de skip

**BR-IMA-006** — Skip solo disponible después del skipOffset

El ad es skippable (ad.skippable === true) solo cuando:
a) El ad server indicó un skipOffset y el currentTime del ad supera ese valor, O
b) El ads.skipAt de la config del player fue configurado y el ad es un pre-roll y el currentTime supera ese valor.

Antes del skipOffset, player.ad.skip() no tiene efecto. El estado de skippable se notifica
via el evento adsSkippableStateChanged.

**BR-IMA-007** — discardAdBreak cancela todos los ads del break, no solo el actual

Si el skip programático (adsManager.skip()) no procesa el skip en 500ms, el player usa
discardAdBreak() como fallback. Esto cancela todos los ads del break actual, no solo el
ad en curso. Es una limitación conocida del IMA SDK cuando el SDK renderiza su propio
botón de skip.

**BR-IMA-008** — Ads nativos del IMA SDK no se muestran — el player usa su propia UI

El player establece uiElements = [] en AdsRenderingSettings, ocultando el countdown timer
y el skip button nativos del IMA SDK. El player implementa su propia UI de ads basada en
el contexto React (_adsPlaying, _adsSkippable). Los tests no deben buscar elementos UI
del IMA SDK en el DOM.

## Reglas de volumen y mute

**BR-IMA-009** — El volumen del ad se inicializa al volumen del player

Al inicializar el AdsManager, se llama adsManager.setVolume(playerVolume) donde
playerVolume es el volumen actual del player. Cambios de volumen durante el ad se
propagan en tiempo real via internalEmitter._volumechange.

**BR-IMA-010** — vpmute se fija en el momento de requestAds() y no cambia durante la sesión VMAP

Para sesiones VMAP (pre/mid/post-roll en el mismo request), el parámetro vpmute se fija
al volumen del player en el momento de requestAds(). Cambios posteriores de volumen del
usuario no afectan el vpmute de los ad breaks siguientes. Esto es un comportamiento
intencional del IMA SDK, no un bug.

**BR-IMA-011** — Con autoplay muted, el ad arranca muted y vpmute=1

Si el player detecta que no puede hacer autoplay unmuted (checkCanAutoplay con isMuted=false
falla), usa setAdWillPlayMuted(true) y setAdWillAutoPlay(true con muted). El ad server
recibe vpmute=1 y retorna creatives apropiados para muted playback.

## Reglas de configuración

**BR-IMA-012** — ads.map es requerido para activar el sistema de ads

Si ads.map no está configurado (undefined/null), el handler emite _adsAllAdsCompleted
inmediatamente y el contenido reproduce sin ads. No se emite adsError. Es el comportamiento
esperado para contenido sin monetización.

**BR-IMA-013** — Macros en el VAST URL se resuelven en el momento de la request

El player resuelve macros $macro-name$ en el VAST URL justo antes de llamar requestAds().
Las macros incluyen dimensiones del player, URL de la página, timestamp, y parámetros
custom. Para dominios mdstrm.com, los macros forzados (page-url, player-width, etc.)
se añaden como query params incluso si no estaban en la URL original.

## Reglas de overlay ads (NonLinear IMA)

**BR-IMA-OVL-001** — El overlay NUNCA pausa el video (regla definitoria del formato NonLinear)

A diferencia de los ads lineales, el overlay se muestra concurrentemente con el contenido. No
se llama `element.pause()` en `overlayAds.jsx`. IMA no recibe un proxy con control de pausa —
solo un getter de `currentTime`. Si se observa que el video se pausa al aparecer un overlay,
es un bug. Esta es la diferencia definitoria entre NonLinear (overlay) y Linear (pre/mid/post-roll)
según la especificación IAB VAST 3.0/4.x.

**BR-IMA-OVL-002** — El overlay VAST URL debe tener las macros resueltas antes de enviarse al ad server

`OverlayAds` llama `resolveAdTagMacros(overlay, options)` antes de asignar `req.adTagUrl`.
Si la URL llega al ad server con tokens `$...$` sin resolver, el ad server la rechaza con
HTTP 400 (comportamiento observado con Google Ad Manager). Este fue el bug corregido en PR #725:
`overlayAds.jsx` asignaba la URL cruda sin pasar por `resolveAdTagMacros`.

**BR-IMA-OVL-003** — `OverlayAds` solo se monta si `ads.overlay` tiene valor y el player está listo

Condición de montaje: `overlayUrl !== null` (la plataforma devuelve un URL válido, no la
cadena `'null'`) AND `isPlayerReady === true`. Si falta cualquiera de las dos condiciones,
el componente no se monta y no se hace ninguna request al ad server de overlay.

**BR-IMA-OVL-004** — `overlayPosition` controla el tiempo de aparición en segundos

El overlay escucha `timeupdate` del elemento de media y se activa cuando `currentTime >=
overlayPosition`. Si `overlayPosition === 0`, el overlay se activa en el primer play
(inmediatamente). La plataforma expone este campo como `ads.overlayPosition` en la config
del content. Si el campo no está configurado, el default es `0`.

**BR-IMA-OVL-005** — El close button del overlay lo gestiona IMA internamente

`OverlayAds` usa `settings.uiElements = []` (igual que los ads lineales). El cierre del
overlay queda a cargo del IMA SDK según las instrucciones del VAST (`minSuggestedDuration`).
El player no implementa un botón de cierre propio para el overlay. Según IAB, el close
button debe estar siempre visible o aparecer al cumplirse `minSuggestedDuration`.

**BR-IMA-OVL-006** — El overlay no bloquea la interacción del usuario con el player

`OverlayAds` inicia con `pointerEvents: 'none'` en el contenedor. Solo activa
`pointerEvents: 'auto'` mientras el IMA SDK está reproduciendo el overlay (entre
`adsManager.start()` y `ALL_ADS_COMPLETED` / `AD_ERROR`). Los controles del player
permanecen accesibles durante el overlay.

**BR-IMA-OVL-007** — La posición vertical del overlay es sobre la barra de controles

El contenedor del overlay se posiciona a `bottom = controlHeight + 20px`. El contenido
visual nunca oculta la barra de controles del player. La altura del overlay no debe
superar el 20% de la altura total del player (lineamiento IAB Digital Video Ad Format
Guidelines — altura máxima recomendada: 1/5 del player + 20px por sombras).

**BR-IMA-OVL-008** — `$custom.X$` permite acceso directo a campos del objeto custom

La macro `$custom.X$` usa lodash `get(custom, 'X')` para resolver campos arbitrarios
del objeto `custom` (ej: `$custom.tag_custom$` → `custom.tag_custom`). Esto permite a
la plataforma definir custom params específicos por plataforma (web/android/ios) que el
player inyecta en la URL del overlay antes de la request. Es el mecanismo detrás de la
configuración `schedule[overlay_custom_params][web][params][tag_custom]` en la plataforma.

## Reglas de la industria aplicables

**BR-IMA-IND-001** — IMA SDK es Chromium-only en tests automatizados

El IMA SDK de Google no emite eventos de ad lifecycle en headless WebKit ni Firefox.
Todos los tests de ads deben ejecutarse exclusivamente en Chromium (test.skip para otros browsers).
Esto es una limitación del SDK, no del player.

**BR-IMA-IND-002** — VPAID está deprecado — no agregar nuevas dependencias de VPAID

VPAID está siendo eliminado por la industria (IAB Tech Lab) en favor de SIMID y VAST 4.x.
El player mantiene soporte legacy via insecureVpaidMode pero no debe introducir nuevas
dependencias de VPAID. Las campañas nuevas deben usar VAST standard o SIMID cuando esté disponible.

**BR-IMA-IND-003** — Beacons de tracking deben dispararse exactamente una vez

Los beacons VAST/OMID (impression, firstQuartile, midpoint, thirdQuartile, complete)
son eventos de billing y viewability. Duplicados inflan los reportes del ad server y
pueden resultar en overbilling. El player no debe disparar beacons más de una vez por
ad break bajo ninguna circunstancia.

**BR-IMA-IND-004** — AdDisplayContainer.initialize() requiere user gesture en mobile

En iOS Safari y Android Chrome, la inicialización del AdDisplayContainer debe ocurrir
dentro del handler de un user gesture (touch/click). El player intenta mantener esta
cadena via el play() + pause() inicial, pero múltiples awaits en la cadena pueden
romper el contexto del gesture. Los tests de mobile deben verificar este comportamiento.
