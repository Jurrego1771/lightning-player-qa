# State — Business Rules

## Reglas de valores de estado

**BR-STATE-001** — Rango de volumen: [0.0, 1.0] inclusivo
El player acepta valores de volumen en el rango cerrado [0.0, 1.0]. Valores fuera de este
rango (negativos o > 1) son ignorados silenciosamente — el volumen anterior se preserva
sin lanzar excepción. Esto difiere del HTMLMediaElement nativo que clampea automáticamente.
El volumen 0.0 equivale a silenciado por volumen (distinto de `muted`).
Fuente: `src/view/video/atoms/volume.js` — validación en el setter del atom.

**BR-STATE-002** — player.currentTime es de solo lectura para el getter; seek via setter
`player.currentTime` como getter devuelve la posición actual en segundos (Number, puede
ser null durante la carga inicial). Para hacer seek, se asigna via setter:
`player.currentTime = seconds`. El setter delega a Controls.set('currentTime', val) que
propaga al playerHandler. No existe un método `player.seek()` separado.
Fuente: `src/controls/index.js` — _exposeMethods() expone currentTime como getter+setter.

**BR-STATE-003** — player.status es un enum de strings custom, no HTML5 readyState
Los valores válidos de player.status son: `'waiting'` | `'playing'` | `'pause'` | `'buffering'` | `'error'`.
Nota: el estado pausado es `'pause'`, no `'paused'`. No hay estado `'idle'` ni `'stopped'`.
El estado `'waiting'` es el estado inicial al cargar o cambiar source.
Fuente: `src/player/base.js` — _onPlaying, _onPause, _onBuffering, _onCanPlay, _onLoadStart.

**BR-STATE-004** — player.status reporta 'error' si player.error es no-nulo, independientemente del playerStatus interno
Si `api.error` está seteado (error fatal), `player.status` devuelve `'error'` sin importar
el valor de `playerStatus` en el contexto React. El ErrorHandler component es el responsable
de setear `playerStatus` a error en el contexto. Ambos mecanismos deben estar alineados.
Fuente: `src/controls/index.js` líneas 204-210.

**BR-STATE-005** — player.ended === true implica player.paused === true
Cuando un VOD termina, el HTML5 video element queda en estado paused=true (el browser
no reinicia automáticamente). Por tanto, `player.ended === true` siempre implica
`player.paused === true`. La inversa no es verdad: paused no implica ended.
Fuente: comportamiento estándar HTML5 + `src/view/video/atoms/playerStatus.js` — videoEndedAtom.

**BR-STATE-006** — player.duration es NaN para streams en vivo (live) y puede ser Infinity
Para type='live', player.duration puede ser NaN o Infinity dependiendo del browser.
Para type='dvr', player.duration refleja el tamaño de la ventana DVR (no la duración total).
Para type='media' (VOD), player.duration debe ser un número finito positivo después de canplay.
Fuente: estándar HTML5 MSE + comportamiento observado en HLS.js para streams en vivo.

**BR-STATE-007** — player.currentTime en DVR devuelve offset relativo desde inicio de ventana DVR
Para type='dvr', player.currentTime NO devuelve el timestamp Unix del stream ni el
tiempo absoluto del archivo. Devuelve el offset en segundos desde el inicio de la
ventana DVR accesible (dvrWindowStart). El rango es [0, player.duration].
Un currentTime === 0 en DVR significa "inicio de la ventana disponible".
Un currentTime === duration en DVR significa "en vivo / borde del stream".
Fuente: `src/view/video/atoms/currentTime.js` — lógica de transformación DVR.

**BR-STATE-008** — loop solo es configurable en la inicialización, no en runtime
La propiedad player.loop es de solo lectura en runtime. El valor se fija en la
configuración inicial (options.loop: true). Asignar player.loop = true después
de la inicialización no tiene efecto. Para habilitar loop en runtime, se requiere
destroy() y reinicializar con loop: true.
Fuente: `src/player/base.js` — loop en readOnlyProps + tests/contract/player-api-property.spec.ts (test.fixme).

**BR-STATE-009** — Estado se resetea completamente al cambiar contenido con player.load()
Cuando se llama player.load({ type, id }), el player genera un nuevo loadKey único
que invalida el estado anterior. Los átomos Jotai se resetean vía el cleanup de
playerReadyAtom (false → cleanup de effects → null en átomos). El ciclo completo es:
load() → metadataloading → ContextProvider state update → playerReady=false → atoms cleanup → nueva fuente → canplay → playerReady=true → atoms re-populate.
Fuente: `src/api/player.jsx` — load() + `src/controls/index.js` — getDerivedStateFromProps (src change → _playerReady: false).

**BR-STATE-010** — player.paused durante ads refleja el estado del ad, no del contenido
Mientras player.isPlayingAd === true, player.paused devuelve el estado de pausa del
ad (no del contenido principal). Esto es porque Controls.get() pasa primero por
adsManager.get(). El contenido principal queda pausado internamente durante los ads,
pero player.paused puede ser false si el ad está reproduciéndose.
Fuente: `src/controls/index.js` — get() con adsManager override.

## Reglas de sincronización async

**BR-STATE-011** — Todas las propiedades de estado son async — requieren polling en tests
Los átomos Jotai se actualizan dentro del React render cycle. Toda lectura de
player.status, player.currentTime, player.paused, etc. inmediatamente después de
una acción (play, pause, load, seek) puede devolver el valor anterior.
Regla de tests: SIEMPRE usar expect.poll() con timeout ≥ 500ms para propiedades de estado.
NUNCA usar expect() directo para propiedades de estado del player.
Fuente: `player_system.md` — "React+Jotai para tests" + behavior.json — test_anti_patterns.

**BR-STATE-012** — playerStatus tiene un debounce mínimo de 100ms por diseño
El átomo playerStatusAtom aplica un setTimeout de 100ms antes de actualizar el
estado interno. Esto es por diseño para absorber micro-transiciones de ads. Por tanto,
player.status puede tardar hasta 100ms en reflejar una transición real.
En tests: timeout mínimo de 500ms para expect.poll() de player.status.
Fuente: `src/view/video/atoms/playerStatus.js` líneas 29-38.

## Reglas de la industria aplicables

**BR-STATE-IND-001** — El modelo atómico (Jotai) requiere tests con polling, no asserts síncronos
En players basados en React con Jotai o Recoil, el estado no es inmediatamente consistente
tras una acción. Es análogo a cómo Vue.js requiere nextTick() para leer cambios de estado.
La práctica de la industria para Playwright es usar waitForFunction() o expect.poll()
para verificar estado asíncrono de players. Ver: ExoPlayer docs "listening to player events".

**BR-STATE-IND-002** — El estado 'error' debe ser terminal y no auto-recuperable sin intervención del usuario
La práctica de la industria (Apple AVPlayer, ExoPlayer, Video.js) es que un error fatal
deja el player en estado error permanente hasta que el usuario o el integrador ejecuta
una acción explícita (retry, reload, destroy+reinit). El player no debe intentar
auto-recuperarse de errores fatales de DRM o source inválida.
Esta regla aplica al Lightning Player: una vez player.status === 'error', debe mantenerse
hasta player.load() o player.destroy().

**BR-STATE-IND-003** — Volume y mute son conceptos separados en HTML5 y deben permanecer separados
HTML5 MediaElement define volume (0.0-1.0) y muted (boolean) como propiedades independientes.
Un player puede tener volume = 0.8 y muted = true simultáneamente — el usuario ve silencio
pero al desmutear recupera el volumen original. El Lightning Player sigue este modelo via
muteAtom que preserva el volumen anterior en lastVolumeAtom antes de setear volume = 0.
Fuente: `src/view/video/atoms/volume.js` — muteAtom con lastVolumeAtom.
